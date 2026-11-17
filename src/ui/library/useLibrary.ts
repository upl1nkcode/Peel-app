import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NotABackupError } from '../../core/backup'
import { EmptyMaskError } from '../../core/mask'
import type { Deflate } from '../../core/png'
import { ZipLimitError, type Inflate } from '../../core/zip'
import {
  duplicateStickers,
  exportAll,
  importBackup,
  importMessage,
} from '../../services/backup'
import { downloadBlob } from '../../services/export'
import { PhotoUnreadableError } from '../../services/photo'
import {
  persistenceStatus,
  requestPersistence,
  STORAGE_STATUS_TEXT,
  StorageFullError,
  StorageOutdatedError,
  type StickerStore,
  type StickerSummary,
  type StorageManagerLike,
} from '../../services/storage'
import type { Message, MessageKey } from '../i18n'

/** What the app needs to save and keep stickers (spec 0008). */
export interface StickerDeps {
  store: Promise<StickerStore>
  /** `navigator.storage`; undefined where the browser has none. */
  storage: StorageManagerLike | undefined
  codecs: { deflate: Deflate; inflate: Inflate; inflateRaw: Inflate }
  /** Wall-clock ms for created/updated times and the backup's date. */
  clock?: () => number
}

/** The message for an error from a sticker action (spec 0008), as a catalog key (spec 0013). */
export function messageFor(e: unknown): MessageKey {
  if (e instanceof StorageFullError) return 'storage.full'
  if (e instanceof StorageOutdatedError) return 'storage.outdated'
  if (e instanceof PhotoUnreadableError) return 'photo.unreadable'
  if (e instanceof EmptyMaskError) return 'stickers.nothingToSave'
  if (e instanceof NotABackupError) return 'stickers.notABackup'
  if (e instanceof ZipLimitError) return 'stickers.tooBigForZip'
  return 'common.somethingWrong'
}

const note = (key: MessageKey): Message[] => [{ key }]

/** The saved stickers and what the Library does with them. */
export interface Library {
  deps: StickerDeps
  /** Null until the store opens, and if it can't. */
  store: StickerStore | null
  /** Newest first. */
  stickers: readonly StickerSummary[]
  /** Set when stickers can't be used at all (spec 0008 AC-11, spec 0013 AC-12). */
  blocked: MessageKey | null
  /** The last result or error of a Library action. */
  message: readonly Message[] | null
  /** A Library action is running. */
  busy: boolean
  /** The storage status line (spec 0008 AC-14). */
  status: MessageKey | null
  /** Shows `message` on the Library. */
  say: (message: readonly Message[] | null) => void
  refresh: () => Promise<void>
  /** After a save: refresh, then ask to keep stickers (spec 0008 AC-13). */
  afterSave: () => Promise<void>
  remove: (ids: readonly string[]) => Promise<void>
  duplicate: (ids: readonly string[]) => Promise<void>
  /** The ticked stickers, or all of them with `null` (spec 0013 AC-10, spec 0008 AC-15). */
  exportSome: (ids: readonly string[] | null) => Promise<void>
  importFile: (file: File) => Promise<void>
  meta: {
    get: (name: string) => Promise<unknown>
    set: (name: string, value: unknown) => Promise<void>
  }
}

/**
 * The sticker store's life (spec 0008 AC-11 to AC-19), shared by the Library
 * and the editor (spec 0013): opening it, the outdated and storage states,
 * and the Library's actions, one at a time.
 */
export function useLibrary(deps: StickerDeps): Library {
  const [store, setStore] = useState<StickerStore | null>(null)
  const [blocked, setBlocked] = useState<MessageKey | null>(null)
  const [stickers, setStickers] = useState<readonly StickerSummary[]>([])
  const [status, setStatus] = useState<MessageKey | null>(null)
  const [message, setMessage] = useState<readonly Message[] | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const clock = deps.clock ?? Date.now

  const fail = useCallback((e: unknown) => {
    if (e instanceof StorageOutdatedError) setBlocked('storage.outdated')
    setMessage(note(messageFor(e)))
  }, [])

  const refreshWith = useCallback(
    async (s: StickerStore) => {
      try {
        setStickers(await s.list())
      } catch (e) {
        fail(e)
      }
    },
    [fail],
  )

  const showStatus = useCallback(async () => {
    setStatus(STORAGE_STATUS_TEXT[await persistenceStatus(deps.storage)])
  }, [deps.storage])

  useEffect(() => {
    let alive = true
    void persistenceStatus(deps.storage).then((st) => {
      if (alive) setStatus(STORAGE_STATUS_TEXT[st])
    })
    deps.store.then(
      (s) => {
        if (!alive) return
        s.onOutdated(() => {
          setBlocked('storage.outdated')
          setMessage(note('storage.outdated'))
        })
        setStore(s)
        void refreshWith(s)
      },
      (e: unknown) => {
        if (!alive) return
        const key =
          e instanceof StorageOutdatedError
            ? 'storage.outdated'
            : 'storage.unavailable'
        setBlocked(key)
        setMessage(note(key))
      },
    )
    return () => {
      alive = false
    }
  }, [deps, refreshWith])

  return useMemo(() => {
    /** Runs one Library action at a time; errors become the message. */
    const run = async (action: (s: StickerStore) => Promise<void>) => {
      if (!store || blocked !== null || running.current) return
      running.current = true
      setBusy(true)
      setMessage(null)
      try {
        await action(store)
      } catch (e) {
        fail(e)
      } finally {
        running.current = false
        setBusy(false)
      }
    }
    const keep = async (s: StickerStore) => {
      await requestPersistence(deps.storage, s)
      await showStatus()
    }
    return {
      deps,
      store,
      stickers,
      blocked,
      message,
      busy,
      status,
      say: setMessage,
      refresh: async () => {
        if (store) await refreshWith(store)
      },
      afterSave: async () => {
        if (!store) return
        await refreshWith(store)
        await keep(store)
      },
      remove: (ids) =>
        run(async (s) => {
          try {
            for (const id of ids) await s.delete(id)
          } finally {
            await refreshWith(s)
          }
        }),
      duplicate: (ids) =>
        run(async (s) => {
          try {
            await duplicateStickers(s, ids, clock())
          } finally {
            await refreshWith(s)
          }
        }),
      exportSome: (ids) =>
        run(async (s) => {
          const out = await exportAll(s, new Date(clock()), ids ?? undefined)
          if (out) downloadBlob(out.blob, out.name)
        }),
      importFile: (file) =>
        run(async (s) => {
          try {
            const result = await importBackup(s, file, deps.codecs)
            setMessage(importMessage(result))
            // A restored backup needs keeping as much as a fresh save (spec 0008 AC-13).
            if (result.added > 0) await keep(s)
          } finally {
            await refreshWith(s)
          }
        }),
      meta: {
        get: async (name) => (store ? store.getMeta(name) : undefined),
        set: async (name, value) => {
          if (store) await store.setMeta(name, value)
        },
      },
    }
  }, [
    deps,
    store,
    stickers,
    blocked,
    message,
    busy,
    status,
    fail,
    refreshWith,
    showStatus,
    clock,
  ])
}
