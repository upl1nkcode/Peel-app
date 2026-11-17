import type { MessageKey } from '../../ui/i18n'
import type { StickerStore } from './stickerStore'

/** The part of `navigator.storage` used here; either method may be missing. */
export type StorageManagerLike = Partial<
  Pick<StorageManager, 'persist' | 'persisted'>
>

export type PersistenceStatus = 'persisted' | 'atRisk'

/** The storage status line (spec 0008 AC-14), as catalog keys (spec 0013). */
export const STORAGE_STATUS_TEXT: Record<PersistenceStatus, MessageKey> = {
  persisted: 'storage.persisted',
  atRisk: 'storage.notPersisted',
}

const META_KEY = 'persistRequested'
const asking = new WeakSet<StickerStore>()

/**
 * Asks the browser to keep Peel's storage, once ever on this device (spec
 * 0008 AC-13): call it after a successful save. The request is recorded
 * before `persist()` is awaited, so a slow prompt never causes a second one.
 * Missing APIs and refusals are ignored.
 */
export async function requestPersistence(
  storage: StorageManagerLike | undefined,
  store: StickerStore,
): Promise<void> {
  if (!storage?.persist || asking.has(store)) return
  asking.add(store)
  try {
    if ((await store.getMeta(META_KEY)) === true) return
    await store.setMeta(META_KEY, true)
    await storage.persist().catch(() => false)
  } finally {
    asking.delete(store)
  }
}

/** Whether the browser has granted persistence; asks the user nothing (spec 0008 AC-14). */
export async function persistenceStatus(
  storage: StorageManagerLike | undefined,
): Promise<PersistenceStatus> {
  if (!storage?.persisted) return 'atRisk'
  try {
    return (await storage.persisted()) ? 'persisted' : 'atRisk'
  } catch {
    return 'atRisk'
  }
}
