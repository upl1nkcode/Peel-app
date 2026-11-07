import { useCallback, useEffect, useRef, useState } from 'react'
import { NotABackupError, type StickerRecord } from '../../core/backup'
import { EmptyMaskError, type AlphaMask, type RgbaImage } from '../../core/mask'
import type { Deflate } from '../../core/png'
import { serializeSelection } from '../../core/selection/serialize'
import type { Selection } from '../../core/selection/types'
import { ZipLimitError, type Inflate } from '../../core/zip'
import { exportAll, importBackup, importMessage } from '../../services/backup'
import { PhotoUnreadableError } from '../../services/photo'
import { buildSticker } from '../../services/sticker'
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
import type { StickerPanelProps } from './StickerPanel'

/** What the screen needs to save and keep stickers (spec 0008). */
export interface StickerDeps {
  store: Promise<StickerStore>
  /** `navigator.storage`; undefined where the browser has none. */
  storage: StorageManagerLike | undefined
  codecs: { deflate: Deflate; inflate: Inflate; inflateRaw: Inflate }
  /** Wall-clock ms for created/updated times and the backup's date. */
  clock?: () => number
}

/** The saved sticker the screen is showing, if any. */
export interface StickerRef {
  id: string
  createdAt: number
  updatedAt: number
}

/** Everything a save needs, taken at the moment Save is tapped. */
export interface SaveSnapshot {
  photo: { id: string; image: RgbaImage; bytes: Uint8Array; type: string }
  selection: Selection
  /** The model alpha the selection's soft edge uses, if it is a model one. */
  modelAlpha: AlphaMask | null
  sticker: StickerRef | null
}

/** The screen's side of the panel. */
export interface StickerHost {
  snapshot(): SaveSnapshot | null
  /** The scale-1 render of `selection` on the photo, with `modelAlpha`. */
  renderFull(
    photoId: string,
    selection: Selection,
    modelAlpha: AlphaMask | null,
  ): Promise<AlphaMask>
  /** `ref` was saved from `photoId`; later saves of that photo update it. */
  saved(photoId: string, ref: StickerRef): void
  /** The sticker `id` was deleted; a later save makes a new one. */
  deleted(id: string): void
  /** Shows a saved sticker; resolves to a warning to show, or null. */
  open(record: StickerRecord): Promise<string | null>
}

export const NOTHING_TO_SAVE = 'Nothing to save: the cutout is empty.'
export const NOT_A_BACKUP = "This file isn't a Peel backup."
export const TOO_BIG_FOR_ZIP =
  'Too many stickers for one backup file. Delete some, then export again.'
export const STORAGE_UNAVAILABLE = "Stickers can't be saved in this browser."
export const SOMETHING_WENT_WRONG = 'Something went wrong. Try again.'

function messageFor(e: unknown): string {
  if (
    e instanceof StorageFullError ||
    e instanceof StorageOutdatedError ||
    e instanceof PhotoUnreadableError
  ) {
    return e.message
  }
  if (e instanceof EmptyMaskError) return NOTHING_TO_SAVE
  if (e instanceof NotABackupError) return NOT_A_BACKUP
  if (e instanceof ZipLimitError) return TOO_BIG_FOR_ZIP
  return SOMETHING_WENT_WRONG
}

/**
 * The temporary panel's state and actions (spec 0008 AC-5 to AC-20). Without
 * `deps` there is no panel. `photoId` and `selection` are what the screen
 * shows, for the Save button.
 */
export function useStickers(
  deps: StickerDeps | undefined,
  host: StickerHost,
  photoId: string | null,
  selection: Selection,
): StickerPanelProps | null {
  const [store, setStore] = useState<StickerStore | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [stickers, setStickers] = useState<readonly StickerSummary[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedAs, setSavedAs] = useState<{
    photoId: string
    selection: Selection
  } | null>(null)
  const hostRef = useRef(host)
  useEffect(() => {
    hostRef.current = host
  }, [host])
  const clock = deps?.clock ?? Date.now

  const fail = useCallback((e: unknown) => {
    if (e instanceof StorageOutdatedError) setBlocked(e.message)
    setMessage(messageFor(e))
  }, [])

  const refresh = useCallback(
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
    setStatus(STORAGE_STATUS_TEXT[await persistenceStatus(deps?.storage)])
  }, [deps?.storage])

  useEffect(() => {
    if (!deps) return
    let alive = true
    void persistenceStatus(deps.storage).then((st) => {
      if (alive) setStatus(STORAGE_STATUS_TEXT[st])
    })
    deps.store.then(
      (s) => {
        if (!alive) return
        s.onOutdated(() => {
          setBlocked(new StorageOutdatedError().message)
          setMessage(new StorageOutdatedError().message)
        })
        setStore(s)
        void refresh(s)
      },
      (e: unknown) => {
        if (!alive) return
        const text =
          e instanceof StorageOutdatedError ? e.message : STORAGE_UNAVAILABLE
        setBlocked(text)
        setMessage(text)
      },
    )
    return () => {
      alive = false
    }
  }, [deps, refresh, showStatus])

  if (!deps) return null
  const disabled = !store || blocked !== null || busy

  /** Runs one panel action at a time. */
  const run = (action: (s: StickerStore) => Promise<void>) => {
    if (!store || disabled) return
    setBusy(true)
    setMessage(null)
    void action(store)
      .catch(fail)
      .finally(() => {
        setBusy(false)
      })
  }

  const save = () => {
    // Everything is taken now, before any await (a sharper result may land mid-save).
    const snap = hostRef.current.snapshot()
    if (!snap) return
    run(async (s) => {
      const { photo, selection: sel, modelAlpha, sticker } = snap
      const built = await buildSticker(
        { image: photo.image, selection: sel, modelAlpha },
        {
          renderFull: (x) =>
            hostRef.current.renderFull(photo.id, x, modelAlpha),
          deflate: deps.codecs.deflate,
        },
      )
      const now = clock()
      const size = { width: photo.image.width, height: photo.image.height }
      const ref: StickerRef = {
        id: sticker?.id ?? crypto.randomUUID(),
        createdAt: sticker?.createdAt ?? now,
        updatedAt: sticker ? Math.max(now, sticker.updatedAt + 1) : now,
      }
      await s.save({
        ...ref,
        imageSize: size,
        photo: { bytes: photo.bytes, type: photo.type },
        selection: serializeSelection(sel, size),
        sticker: built.sticker,
        thumbnail: built.thumbnail,
        ...(built.modelAlpha && { modelAlpha: built.modelAlpha }),
      })
      hostRef.current.saved(photo.id, ref)
      setSavedAs({ photoId: photo.id, selection: sel })
      await refresh(s)
      await requestPersistence(deps.storage, s)
      await showStatus()
    })
  }

  return {
    stickers,
    canSave: photoId !== null && selection.rings.length > 0,
    saved:
      savedAs !== null &&
      savedAs.photoId === photoId &&
      savedAs.selection === selection,
    disabled,
    status,
    message,
    onSave: save,
    onOpen: (id) => {
      run(async (s) => {
        const record = await s.get(id)
        if (!record) {
          await refresh(s)
          return
        }
        setMessage(await hostRef.current.open(record))
        setSavedAs(null)
      })
    },
    onDelete: (id) => {
      run(async (s) => {
        await s.delete(id)
        hostRef.current.deleted(id)
        await refresh(s)
      })
    },
    onExport: () => {
      run(async (s) => {
        const out = await exportAll(s, new Date(clock()))
        if (!out) return
        const url = URL.createObjectURL(out.blob)
        const link = document.createElement('a')
        link.href = url
        link.download = out.name
        link.click()
        // Safari may still be reading the URL just after the click.
        setTimeout(() => {
          URL.revokeObjectURL(url)
        }, 30_000)
      })
    },
    onImport: (file) => {
      run(async (s) => {
        try {
          const result = await importBackup(s, file, deps.codecs)
          setMessage(importMessage(result))
          // A restored backup needs keeping as much as a fresh save (AC-13).
          if (result.added > 0) {
            await requestPersistence(deps.storage, s)
            await showStatus()
          }
        } finally {
          await refresh(s)
        }
      })
    },
  }
}
