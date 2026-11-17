import { useCallback, useEffect, useRef, useState } from 'react'
import type { StickerRecord } from '../../core/backup'
import type { AlphaMask, RgbaImage } from '../../core/mask'
import { serializeSelection } from '../../core/selection/serialize'
import type { Selection } from '../../core/selection/types'
import { sameFinish, type FinishSettings } from '../../core/sticker'
import { buildSticker } from '../../services/sticker'
import type { MessageKey } from '../i18n'
import { messageFor, type Library } from '../library/useLibrary'

/** The saved sticker the editor is showing, if any. */
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
  /** The Finish settings to save beside the sticker (spec 0012 AC-11). */
  finish: FinishSettings
}

/** What a saved sticker looks like once it's shown (spec 0013 AC-4). */
export interface Opened {
  photoId: string
  selection: Selection
  finish: FinishSettings
  /** Shown in the status strip, e.g. a different photo size (spec 0008 AC-9). */
  warning: MessageKey | null
}

/** The editor's side of saving. */
export interface SaveHost {
  snapshot: () => SaveSnapshot | null
  /** The scale-1 render of `selection` on the photo, with `modelAlpha`. */
  renderFull: (
    photoId: string,
    selection: Selection,
    modelAlpha: AlphaMask | null,
  ) => Promise<AlphaMask>
  /** `ref` was saved from `photoId`; later saves of that photo update it. */
  saved: (photoId: string, ref: StickerRef) => void
  /** Shows a saved sticker. */
  open: (record: StickerRecord) => Promise<Opened>
}

export interface Save {
  /** There's a photo with a cutout, and stickers can be stored. */
  canSave: boolean
  /** What's on screen is what was last saved or opened. */
  saved: boolean
  busy: boolean
  /** True once stored; false with `message` set. */
  save: () => Promise<boolean>
  /** Shows sticker `id`; false when it's gone or can't be shown. */
  open: (id: string) => Promise<boolean>
  /** A save error or an open warning, for the status strip. */
  message: MessageKey | null
  /** Forgets "saved" (the sticker it named was deleted, spec 0013 Review Focus 2). */
  forget: () => void
}

/**
 * Save and open from the editor (spec 0008 AC-5 to AC-13, spec 0013 AC-4 to
 * AC-6). `photoId`, `selection` and `finish` are what the editor shows:
 * changing any of them turns "Saved" back into "Save".
 */
export function useSave(
  library: Library | undefined,
  host: SaveHost,
  photoId: string | null,
  selection: Selection,
  finish: FinishSettings,
): Save {
  const [savedAs, setSavedAs] = useState<{
    photoId: string
    selection: Selection
    finish: FinishSettings
  } | null>(null)
  const [message, setMessage] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const hostRef = useRef(host)
  useEffect(() => {
    hostRef.current = host
  }, [host])

  const store = library?.store ?? null
  const usable = store !== null && library?.blocked == null
  const clock = library?.deps.clock ?? Date.now

  const save = useCallback(async (): Promise<boolean> => {
    // Everything is taken now, before any await (a sharper result may land mid-save).
    const snap = hostRef.current.snapshot()
    if (!snap || !library || !store || running.current) return false
    running.current = true
    setBusy(true)
    setMessage(null)
    try {
      const { photo, selection: sel, modelAlpha, sticker, finish: fin } = snap
      const built = await buildSticker(
        { image: photo.image, selection: sel, modelAlpha },
        {
          renderFull: (x) =>
            hostRef.current.renderFull(photo.id, x, modelAlpha),
          deflate: library.deps.codecs.deflate,
        },
      )
      const now = clock()
      const size = { width: photo.image.width, height: photo.image.height }
      const ref: StickerRef = {
        id: sticker?.id ?? crypto.randomUUID(),
        createdAt: sticker?.createdAt ?? now,
        updatedAt: sticker ? Math.max(now, sticker.updatedAt + 1) : now,
      }
      await store.save({
        ...ref,
        imageSize: size,
        photo: { bytes: photo.bytes, type: photo.type },
        selection: serializeSelection(sel, size),
        sticker: built.sticker,
        thumbnail: built.thumbnail,
        ...(built.modelAlpha && { modelAlpha: built.modelAlpha }),
        finish: fin,
      })
      hostRef.current.saved(photo.id, ref)
      setSavedAs({ photoId: photo.id, selection: sel, finish: fin })
      await library.afterSave()
      return true
    } catch (e) {
      setMessage(messageFor(e))
      return false
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [library, store, clock])

  const open = useCallback(
    async (id: string): Promise<boolean> => {
      if (!store) return false
      setMessage(null)
      try {
        const record = await store.get(id)
        if (!record) {
          await library?.refresh()
          return false
        }
        const shown = await hostRef.current.open(record)
        setSavedAs({
          photoId: shown.photoId,
          selection: shown.selection,
          finish: shown.finish,
        })
        setMessage(shown.warning)
        return true
      } catch (e) {
        library?.say([{ key: messageFor(e) }])
        return false
      }
    },
    [library, store],
  )

  return {
    canSave: usable && photoId !== null && selection.rings.length > 0,
    saved:
      savedAs !== null &&
      savedAs.photoId === photoId &&
      savedAs.selection === selection &&
      sameFinish(savedAs.finish, finish),
    busy,
    save,
    open,
    message,
    forget: () => {
      setSavedAs(null)
    },
  }
}
