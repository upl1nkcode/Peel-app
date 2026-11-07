// @vitest-environment node
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotABackupError, type StickerRecord } from '../../core/backup'
import { emptySelection } from '../../core/selection/model'
import { serializeSelection } from '../../core/selection/serialize'
import { readZip, utf8Encode, writeZip } from '../../core/zip'
import { browserDeflate, browserInflate, browserInflateRaw } from '../deflate'
import {
  openStickerStore,
  StorageFullError,
  type StickerStore,
} from '../storage'
import { exportAll, importBackup, importMessage } from './index'

const codecs = { inflate: browserInflate, inflateRaw: browserInflateRaw }
const png = (n: number) =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n])
const when = new Date(2026, 10, 7, 23, 30)

async function record(
  id: string,
  seed: number,
  alpha = false,
): Promise<StickerRecord> {
  const imageSize = { width: 3, height: 2 }
  const r: StickerRecord = {
    id,
    createdAt: 1000 + seed,
    updatedAt: 2000 + seed,
    imageSize,
    photo: { bytes: Uint8Array.from([seed, 1, 2, 3]), type: 'image/jpeg' },
    selection: serializeSelection(emptySelection(), imageSize),
    sticker: png(seed),
    thumbnail: png(seed + 1),
  }
  if (alpha) {
    r.modelAlpha = {
      width: 3,
      height: 2,
      deflated: await browserDeflate(
        Uint8Array.from([0, 50, 100, 150, 200, 255]),
      ),
    }
  }
  return r
}

const stores: StickerStore[] = []
async function newStore() {
  const s = await openStickerStore(new IDBFactory())
  stores.push(s)
  return s
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close()
})

async function filled(): Promise<{
  store: StickerStore
  records: StickerRecord[]
}> {
  const store = await newStore()
  const records = [
    await record('a', 1, true),
    await record('b', 2),
    await record('c', 3),
  ]
  for (const r of records) await store.save(r)
  return { store, records }
}

describe('backup', () => {
  it('should_round_trip_through_a_zip (AC-15, AC-16)', async () => {
    const { store: a, records } = await filled()
    const exported = await exportAll(a, when)
    expect(exported?.blob.type).toBe('application/zip')
    const b = await newStore()
    const result = await importBackup(b, exported?.blob as Blob, codecs)
    expect(result).toEqual({ added: 3, existing: 0, damaged: 0 })
    for (const r of records)
      expect(await b.get(r.id)).toEqual(await a.get(r.id))
  })

  it('should_merge_and_skip_existing (AC-17)', async () => {
    const { store: a } = await filled()
    const exported = await exportAll(a, when)
    const b = await newStore()
    const mine = {
      ...(await record('b', 9)),
      photo: { bytes: Uint8Array.from([9, 9]), type: '' },
    }
    await b.save(mine)
    const result = await importBackup(b, exported?.blob as Blob, codecs)
    expect(result).toEqual({ added: 2, existing: 1, damaged: 0 })
    expect(await b.get('b')).toEqual(mine)
    expect((await b.list()).map((s) => s.id).sort()).toEqual(['a', 'b', 'c'])

    expect(importMessage(result)).toBe(
      'Imported 2 stickers. 1 were already here.',
    )
    expect(importMessage({ added: 1, existing: 0, damaged: 0 })).toBe(
      'Imported 1 sticker. 0 were already here.',
    )
    expect(importMessage({ added: 0, existing: 2, damaged: 1 })).toBe(
      "Imported 0 stickers. 2 were already here. 1 couldn't be read.",
    )
  })

  it('should_count_damaged_stickers_on_import (AC-17)', async () => {
    const { store: a } = await filled()
    const exported = await exportAll(a, when)
    const bytes = new Uint8Array(await (exported?.blob as Blob).arrayBuffer())
    const { files } = await readZip(bytes, browserInflateRaw)
    files.set('stickers/c/sticker.png', Uint8Array.from([1, 2, 3]))
    const blob = new Blob(
      writeZip(
        [...files].map(([name, data]) => ({ name, data })),
        when,
      ) as BlobPart[],
    )
    const b = await newStore()
    expect(await importBackup(b, blob, codecs)).toEqual({
      added: 2,
      existing: 0,
      damaged: 1,
    })
    expect(await b.has('c')).toBe(false)
  })

  it('should_refuse_non_backups (AC-18)', async () => {
    const b = await newStore()
    const notZip = new Blob([png(1)], { type: 'image/png' })
    const noManifest = new Blob(
      writeZip(
        [{ name: 'hello.txt', data: utf8Encode('hi') }],
        when,
      ) as BlobPart[],
    )
    for (const file of [notZip, noManifest]) {
      await expect(importBackup(b, file, codecs)).rejects.toThrow(
        NotABackupError,
      )
    }
    expect(await b.list()).toEqual([])
  })

  it('should_keep_stickers_added_before_storage_filled (AC-12)', async () => {
    const { store: a } = await filled()
    const exported = await exportAll(a, when)
    const b = await newStore()
    let saves = 0
    const full: StickerStore = {
      ...b,
      save: vi.fn(async (r: StickerRecord) => {
        if (++saves === 2) throw new StorageFullError()
        await b.save(r)
      }),
    }
    await expect(
      importBackup(full, exported?.blob as Blob, codecs),
    ).rejects.toThrow(StorageFullError)
    expect((await b.list()).length).toBe(1)
  })

  it('should_name_the_export_by_local_date (AC-15)', async () => {
    const { store } = await filled()
    expect((await exportAll(store, when))?.name).toBe(
      'peel-stickers-2026-11-07.zip',
    )
    expect((await exportAll(store, new Date(2027, 0, 3, 0, 5)))?.name).toBe(
      'peel-stickers-2027-01-03.zip',
    )
    expect(await exportAll(await newStore(), when)).toBeNull()
  })
})
