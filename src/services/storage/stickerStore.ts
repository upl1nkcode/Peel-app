import type { IDBPDatabase } from 'idb'
import type { StickerRecord } from '../../core/backup'
import type { Size } from '../../core/geometry/types'
import { MIGRATIONS, openDatabase, type Migration } from './db'
import { isQuotaError, StorageFullError, StorageOutdatedError } from './errors'

/** What the sticker list shows; no photo, sticker or model-alpha bytes (spec 0008 AC-8). */
export interface StickerSummary {
  id: string
  createdAt: number
  updatedAt: number
  imageSize: Size
  thumbnail: Uint8Array
}

export interface StickerStore {
  /** Stores or replaces `record`, all or nothing (AC-5, AC-12). */
  save(record: StickerRecord): Promise<void>
  /** Newest first by `updatedAt`, reading only the `stickers` store (AC-8). */
  list(): Promise<StickerSummary[]>
  get(id: string): Promise<StickerRecord | undefined>
  /** Removes every part; an unknown id does nothing. */
  delete(id: string): Promise<void>
  has(id: string): Promise<boolean>
  getMeta(name: string): Promise<unknown>
  setMeta(name: string, value: unknown): Promise<void>
  /** Runs once another tab upgrades the database; every call then rejects (AC-11). */
  onOutdated(callback: () => void): void
  close(): void
}

interface StickerRow {
  id: string
  createdAt: number
  updatedAt: number
  imageSize: Size
  photoType: string
  selection: string
  modelAlphaSize?: Size
  thumbnail: ArrayBuffer
}

type FileKind = 'photo' | 'sticker' | 'modelAlpha'
const KINDS: readonly FileKind[] = ['photo', 'sticker', 'modelAlpha']
interface FileRow {
  id: string
  kind: FileKind
  bytes: ArrayBuffer
}

/** IndexedDB keeps ArrayBuffers (not Blobs: older Safari lost them); copy a view of a larger buffer. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const whole =
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  return whole ? bytes.buffer : bytes.slice().buffer
}

const copySize = (s: Size): Size => ({ width: s.width, height: s.height })

/**
 * Runs a write transaction's requests and waits for all of them and the
 * commit. If any fails (or `start` throws, as a full disk can make `put`
 * do), the transaction is aborted, so nothing is kept, and the
 * transaction's error (a QuotaExceededError at commit) is thrown.
 */
async function writeAll(
  tx: { done: Promise<void>; error: DOMException | null; abort(): void },
  start: (ops: Promise<unknown>[]) => void,
): Promise<void> {
  const ops: Promise<unknown>[] = [tx.done]
  let thrown: unknown = null
  try {
    start(ops)
  } catch (e) {
    thrown = e
    try {
      tx.abort()
    } catch {
      // already aborted or finished
    }
  }
  const results = await Promise.allSettled(ops)
  const failed = results.find((r) => r.status === 'rejected')
  if (thrown === null && !failed) return
  throw tx.error ?? thrown ?? (failed as PromiseRejectedResult).reason
}

/**
 * The sticker repository over IndexedDB (spec 0008 AC-5, AC-8, AC-10 to
 * AC-12). `factory` is `indexedDB` in the app and a fake in tests.
 */
export async function openStickerStore(
  factory: IDBFactory,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<StickerStore> {
  let outdated = false
  // Read through a call: TypeScript would narrow a closure-mutated flag.
  const isOutdated = () => outdated
  const callbacks: (() => void)[] = []
  const db: IDBPDatabase = await openDatabase(factory, migrations, () => {
    outdated = true
    for (const cb of callbacks) cb()
  })

  /** Runs `op`, mapping quota failures and a closed (outdated) database to typed errors. */
  async function guarded<T>(op: () => Promise<T>): Promise<T> {
    if (isOutdated()) throw new StorageOutdatedError()
    try {
      return await op()
    } catch (e) {
      if (isOutdated()) throw new StorageOutdatedError({ cause: e })
      if (isQuotaError(e)) throw new StorageFullError({ cause: e })
      throw e
    }
  }

  return {
    save: (record) =>
      guarded(async () => {
        const tx = db.transaction(['stickers', 'files'], 'readwrite')
        const stickers = tx.objectStore('stickers')
        const files = tx.objectStore('files')
        const row: StickerRow = {
          id: record.id,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          imageSize: copySize(record.imageSize),
          photoType: record.photo.type,
          selection: record.selection,
          thumbnail: toBuffer(record.thumbnail),
          ...(record.modelAlpha && {
            modelAlphaSize: copySize(record.modelAlpha),
          }),
        }
        const file = (kind: FileKind, bytes: Uint8Array) =>
          files.put({ id: record.id, kind, bytes: toBuffer(bytes) })
        await writeAll(tx, (ops) => {
          ops.push(stickers.put(row))
          ops.push(file('photo', record.photo.bytes))
          ops.push(file('sticker', record.sticker))
          ops.push(
            record.modelAlpha
              ? file('modelAlpha', record.modelAlpha.deflated)
              : files.delete([record.id, 'modelAlpha']),
          )
        })
      }),

    list: () =>
      guarded(async () => {
        const rows = (await db.getAllFromIndex(
          'stickers',
          'updatedAt',
        )) as StickerRow[]
        return rows.reverse().map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          imageSize: copySize(r.imageSize),
          thumbnail: new Uint8Array(r.thumbnail),
        }))
      }),

    get: (id) =>
      guarded(async () => {
        const tx = db.transaction(['stickers', 'files'])
        const row = (await tx.objectStore('stickers').get(id)) as
          StickerRow | undefined
        if (!row) return undefined
        const files = tx.objectStore('files')
        const [photo, sticker, modelAlpha] = (await Promise.all(
          KINDS.map((kind) => files.get([id, kind])),
        )) as (FileRow | undefined)[]
        if (!photo || !sticker) return undefined
        const record: StickerRecord = {
          id: row.id,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          imageSize: copySize(row.imageSize),
          photo: { bytes: new Uint8Array(photo.bytes), type: row.photoType },
          selection: row.selection,
          sticker: new Uint8Array(sticker.bytes),
          thumbnail: new Uint8Array(row.thumbnail),
        }
        if (row.modelAlphaSize && modelAlpha) {
          record.modelAlpha = {
            ...copySize(row.modelAlphaSize),
            deflated: new Uint8Array(modelAlpha.bytes),
          }
        }
        return record
      }),

    delete: (id) =>
      guarded(async () => {
        const tx = db.transaction(['stickers', 'files'], 'readwrite')
        const files = tx.objectStore('files')
        await writeAll(tx, (ops) => {
          ops.push(tx.objectStore('stickers').delete(id))
          for (const kind of KINDS) ops.push(files.delete([id, kind]))
        })
      }),

    has: (id) =>
      guarded(async () => (await db.getKey('stickers', id)) !== undefined),

    getMeta: (name) =>
      guarded(async () => {
        const row = (await db.get('meta', name)) as
          { name: string; value: unknown } | undefined
        return row?.value
      }),

    setMeta: (name, value) =>
      guarded(async () => {
        await db.put('meta', { name, value })
      }),

    onOutdated(callback) {
      callbacks.push(callback)
    },

    close() {
      db.close()
    },
  }
}
