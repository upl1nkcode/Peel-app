import { wrap, type IDBPDatabase, type IDBPTransaction } from 'idb'
import { isVersionError, StorageOutdatedError } from './errors'

export const DB_NAME = 'peel'

/** One schema step: migration k upgrades version k to k + 1 (spec 0008 AC-10). */
export type Migration = (
  db: IDBPDatabase,
  tx: IDBPTransaction<unknown, string[], 'versionchange'>,
) => void

/** The schema, in order. The database version is `MIGRATIONS.length`. */
export const MIGRATIONS: readonly Migration[] = [
  (db) => {
    const stickers = db.createObjectStore('stickers', { keyPath: 'id' })
    stickers.createIndex('updatedAt', 'updatedAt')
    db.createObjectStore('files', { keyPath: ['id', 'kind'] })
    db.createObjectStore('meta', { keyPath: 'name' })
  },
]

export const SCHEMA_VERSION = MIGRATIONS.length

/**
 * Opens `peel` at version `migrations.length` on `factory`, running each
 * migration from the stored version up, once, in order. A database at a
 * newer version rejects with `StorageOutdatedError`. When another tab
 * upgrades, the connection closes and `onVersionChange` runs.
 */
export function openDatabase(
  factory: IDBFactory,
  migrations: readonly Migration[],
  onVersionChange: () => void,
): Promise<IDBPDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, migrations.length)
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    request.onupgradeneeded = (event) => {
      const db = wrap(request.result)
      const tx = wrap(
        request.transaction as IDBTransaction,
      ) as unknown as IDBPTransaction<unknown, string[], 'versionchange'>
      for (let v = event.oldVersion; v < migrations.length; v++) {
        migrations[v]?.(db, tx)
      }
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        onVersionChange()
      }
      resolve(wrap(db))
    }
    request.onerror = () => {
      const error = request.error
      reject(
        isVersionError(error)
          ? new StorageOutdatedError({ cause: error })
          : (error ?? new Error('could not open the sticker database')),
      )
    }
  })
}
