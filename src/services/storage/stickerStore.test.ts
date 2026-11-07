// @vitest-environment node
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StickerRecord } from '../../core/backup'
import {
  MIGRATIONS,
  openStickerStore,
  SCHEMA_VERSION,
  StorageFullError,
  StorageOutdatedError,
  type Migration,
  type StickerStore,
} from './index'

const bytes = (...b: number[]) => Uint8Array.from(b)

function record(id: string, updatedAt: number, alpha = false): StickerRecord {
  const r: StickerRecord = {
    id,
    createdAt: 1000,
    updatedAt,
    imageSize: { width: 4, height: 3 },
    photo: { bytes: bytes(1, 2, 3, updatedAt % 256), type: 'image/jpeg' },
    selection: `{"version":1,"id":"${id}"}`,
    sticker: bytes(0x89, 0x50, 9),
    thumbnail: bytes(0x89, 0x50, 7),
  }
  if (alpha) r.modelAlpha = { width: 4, height: 3, deflated: bytes(120, 1, 5) }
  return r
}

const open: StickerStore[] = []
async function store(
  factory: IDBFactory,
  migrations: readonly Migration[] = MIGRATIONS,
) {
  const s = await openStickerStore(factory, migrations)
  open.push(s)
  return s
}

/** A raw connection to the same database, for checks the store has no method for. */
function raw(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open('peel')
    req.onsuccess = () => {
      resolve(req.result)
    }
    req.onerror = () => {
      reject(req.error ?? new Error('open failed'))
    }
  })
}

async function fileCount(factory: IDBFactory, id: string): Promise<number> {
  const db = await raw(factory)
  const count = await new Promise<number>((resolve) => {
    const req = db
      .transaction('files')
      .objectStore('files')
      .count(IDBKeyRange.bound([id], [id, []]))
    req.onsuccess = () => {
      resolve(req.result)
    }
  })
  db.close()
  return count
}

afterEach(() => {
  for (const s of open.splice(0)) s.close()
  vi.restoreAllMocks()
})

/** Names of the object stores read (get, getAll, cursors, counts) while `run` runs. */
async function storesRead(run: () => Promise<unknown>): Promise<Set<string>> {
  const read = new Set<string>()
  const methods = [
    'get',
    'getAll',
    'getAllKeys',
    'getKey',
    'openCursor',
    'openKeyCursor',
    'count',
  ] as const
  for (const m of methods) {
    const storeProto = IDBObjectStore.prototype as unknown as Record<
      string,
      (...a: unknown[]) => unknown
    >
    const original = storeProto[m] as (...a: unknown[]) => unknown
    vi.spyOn(storeProto, m).mockImplementation(function (
      this: IDBObjectStore,
      ...a: unknown[]
    ) {
      read.add(this.name)
      return original.apply(this, a)
    })
    const indexProto = IDBIndex.prototype as unknown as Record<
      string,
      (...a: unknown[]) => unknown
    >
    const originalIndex = indexProto[m] as (...a: unknown[]) => unknown
    vi.spyOn(indexProto, m).mockImplementation(function (
      this: IDBIndex,
      ...a: unknown[]
    ) {
      read.add(this.objectStore.name)
      return originalIndex.apply(this, a)
    })
  }
  await run()
  vi.restoreAllMocks()
  return read
}

describe('sticker store', () => {
  it('should_save_list_get_and_delete (AC-5, AC-8)', async () => {
    const factory = new IDBFactory()
    const s = await store(factory)
    const a = record('a', 2000, true)
    const b = record('b', 3000)
    const c = record('c', 1500)
    for (const r of [a, b, c]) await s.save(r)

    const list = await s.list()
    expect(list.map((x) => x.id)).toEqual(['b', 'a', 'c'])
    expect(list[1]).toEqual({
      id: 'a',
      createdAt: 1000,
      updatedAt: 2000,
      imageSize: { width: 4, height: 3 },
      thumbnail: a.thumbnail,
    })
    expect(await s.get('a')).toEqual(a)
    expect(await s.get('b')).toEqual(b)
    expect(await s.has('a')).toBe(true)

    await s.delete('a')
    expect(await s.get('a')).toBeUndefined()
    expect(await s.has('a')).toBe(false)
    expect((await s.list()).map((x) => x.id)).toEqual(['b', 'c'])
    expect(await fileCount(factory, 'a')).toBe(0)

    expect(await s.get('nope')).toBeUndefined()
    await expect(s.delete('nope')).resolves.toBeUndefined()
  })

  it('should_replace_a_saved_sticker (AC-9)', async () => {
    const factory = new IDBFactory()
    const s = await store(factory)
    await s.save(record('a', 2000, true))
    const updated = record('a', 5000)
    await s.save(updated)
    expect(await s.get('a')).toEqual(updated)
    expect(await fileCount(factory, 'a')).toBe(2)
    expect((await s.list()).map((x) => x.id)).toEqual(['a'])
  })

  it('should_store_views_of_larger_buffers (AC-5)', async () => {
    const s = await store(new IDBFactory())
    const big = bytes(9, 9, 1, 2, 3, 9)
    const r = {
      ...record('a', 1),
      photo: { bytes: big.subarray(2, 5), type: '' },
    }
    await s.save(r)
    expect((await s.get('a'))?.photo).toEqual({
      bytes: bytes(1, 2, 3),
      type: '',
    })
  })

  it('should_list_without_reading_large_files (AC-8)', async () => {
    const s = await store(new IDBFactory())
    await s.save(record('a', 1, true))
    const read = await storesRead(() => s.list())
    expect(read.has('stickers')).toBe(true)
    expect(read.has('files')).toBe(false)
  })

  it('should_save_all_or_nothing (AC-5, AC-12)', async () => {
    const factory = new IDBFactory()
    const s = await store(factory)
    const before = record('old', 1)
    await s.save(before)

    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with apply below
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (
        this.name === 'files' &&
        (args[0] as { kind?: string }).kind === 'sticker'
      ) {
        throw new DOMException('full', 'QuotaExceededError')
      }
      return put.apply(this, args)
    })
    await expect(s.save(record('new', 2))).rejects.toThrow(StorageFullError)
    vi.restoreAllMocks()

    expect(await s.get('new')).toBeUndefined()
    expect(await fileCount(factory, 'new')).toBe(0)
    expect(await s.get('old')).toEqual(before)
  })

  it('should_report_full_storage_at_commit (AC-12)', async () => {
    const s = await store(new IDBFactory())
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with apply below
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      const request = put.apply(this, args)
      if (this.name === 'files') {
        // Browsers abort the transaction with QuotaExceededError as its error.
        const tx = this.transaction
        Object.defineProperty(tx, 'error', {
          configurable: true,
          get: () => new DOMException('full', 'QuotaExceededError'),
        })
        queueMicrotask(() => {
          try {
            tx.abort()
          } catch {
            // already finished
          }
        })
      }
      return request
    })
    await expect(s.save(record('new', 2))).rejects.toThrow(StorageFullError)
    vi.restoreAllMocks()
    expect(await s.get('new')).toBeUndefined()
  })

  it('should_migrate_v1_to_v2 (AC-10)', async () => {
    const factory = new IDBFactory()
    expect(SCHEMA_VERSION).toBe(1)
    expect(MIGRATIONS).toHaveLength(1)
    const v1 = await openStickerStore(factory)
    await v1.save(record('a', 1))
    v1.close()

    const second = vi.fn<Migration>((db) => {
      db.createObjectStore('extra')
    })
    const v2 = await store(factory, [...MIGRATIONS, second])
    expect(await v2.get('a')).toEqual(record('a', 1))
    v2.close()
    const db = await raw(factory)
    expect([...db.objectStoreNames]).toContain('extra')
    db.close()
    await store(factory, [...MIGRATIONS, second])
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('should_run_every_migration_in_order_on_a_new_database (AC-10)', async () => {
    const order: number[] = []
    const steps: Migration[] = [
      (db, tx) => {
        order.push(0)
        MIGRATIONS[0]?.(db, tx)
      },
      () => order.push(1),
      () => order.push(2),
    ]
    await store(new IDBFactory(), steps)
    expect(order).toEqual([0, 1, 2])
  })

  it('should_refuse_a_newer_database (AC-11)', async () => {
    const factory = new IDBFactory()
    const v2 = await openStickerStore(factory, [...MIGRATIONS, () => undefined])
    v2.close()
    await expect(openStickerStore(factory)).rejects.toThrow(
      StorageOutdatedError,
    )
  })

  it('should_close_when_another_tab_upgrades (Review Focus 3)', async () => {
    const factory = new IDBFactory()
    const a = await store(factory)
    const outdated = vi.fn()
    a.onOutdated(outdated)
    const b = await store(factory, [...MIGRATIONS, () => undefined])
    expect(outdated).toHaveBeenCalledTimes(1)
    await expect(a.save(record('x', 1))).rejects.toThrow(StorageOutdatedError)
    await expect(a.list()).rejects.toThrow(StorageOutdatedError)
    await b.save(record('y', 1))
    expect(await b.has('y')).toBe(true)
  })

  it('should_keep_meta', async () => {
    const factory = new IDBFactory()
    const s = await openStickerStore(factory)
    expect(await s.getMeta('persistRequested')).toBeUndefined()
    await s.setMeta('persistRequested', true)
    s.close()
    const again = await store(factory)
    expect(await again.getMeta('persistRequested')).toBe(true)
  })
})
