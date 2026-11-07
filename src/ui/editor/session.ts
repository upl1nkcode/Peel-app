import type { StickerRecord } from '../../core/backup'
import { createHistory } from '../../core/history/history'
import type { AlphaMask, RgbaImage } from '../../core/mask'
import type { Tap } from '../../core/segmentation'
import { emptySelection } from '../../core/selection/model'
import type { Selection } from '../../core/selection/types'
import { PhotoUnreadableError, type LoadedPhoto } from '../../services/photo'
import { createAutoCutout, type AutoState } from '../../services/segmentation'
import type { Cancelled } from '../../services/workerClient'
import type { FromRenderWorker } from '../../workers/protocol'
import type { EditorScreenProps } from './EditorScreen'
import type { SaveSnapshot, StickerRef } from './useStickers'

/** The part of the render worker client this screen uses (spec 0006). */
export interface Renderer {
  setImage(imageId: string, image: RgbaImage, modelAlpha?: AlphaMask): void
  setModelAlpha(imageId: string, modelAlpha: AlphaMask): void
  render(
    imageId: string,
    selection: Selection,
    scale: number,
  ): Promise<FromRenderWorker | Cancelled>
  /** The scale-1 render for saving, with the model alpha being saved (spec 0008 AC-6). */
  renderFull(
    imageId: string,
    selection: Selection,
    modelAlpha?: AlphaMask,
  ): Promise<FromRenderWorker | Cancelled>
}

export interface Photo {
  id: string
  image: RgbaImage
  /** The picked file, unchanged (spec 0008 AC-4). */
  bytes: Uint8Array
  type: string
  /** The photo at full size, drawn once, for compositing the preview. */
  source: HTMLCanvasElement
}

export const copyMask = (m: AlphaMask): AlphaMask => ({
  ...m,
  data: m.data.slice(),
})
const copyImage = (i: RgbaImage): RgbaImage => ({ ...i, data: i.data.slice() })

function photoCanvas(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  canvas
    .getContext('2d')
    ?.putImageData(
      new ImageData(
        new Uint8ClampedArray(image.data),
        image.width,
        image.height,
      ),
      0,
      0,
    )
  return canvas
}

export interface SessionDeps extends EditorScreenProps {
  onState(state: AutoState): void
  onSelection(selection: Selection): void
}

/**
 * The screen's controller, history and renderer. The renderer and the
 * download start with the first photo (spec 0007 AC-19). The model alpha
 * goes to the renderer before the selection changes, so renders use it.
 */
export function createSession(deps: SessionDeps) {
  const history = createHistory(emptySelection())
  let renderer: Renderer | null = null
  let started = false
  let photos = 0
  let photo: Photo | null = null
  let selection = history.current
  /** The controller's latest model alpha (null after a new photo). */
  let autoAlpha: AlphaMask | null = null
  /** The model alpha a re-opened sticker was saved with, for its photo. */
  let restored: { photoId: string; alpha: AlphaMask } | null = null
  /** The saved sticker this photo belongs to, if any (spec 0008 AC-9). */
  let sticker: StickerRef | null = null
  const auto = createAutoCutout({
    ...deps.engines,
    history,
    missingBytes: (files) => deps.missingBytes(files),
    ...(deps.supported && { supported: deps.supported }),
    onChange: (s) => {
      if (s.modelAlpha !== autoAlpha) {
        autoAlpha = s.modelAlpha
        if (s.modelAlpha && photo) {
          renderer?.setModelAlpha(photo.id, copyMask(s.modelAlpha))
        }
      }
      syncSelection()
      deps.onState(s)
    },
  })
  function syncSelection() {
    if (history.current !== selection) {
      selection = history.current
      deps.onSelection(selection)
    }
  }
  const currentAlpha = (): AlphaMask | null =>
    autoAlpha ??
    (restored && restored.photoId === photo?.id ? restored.alpha : null)

  /** Shows `image` as a new photo: renderer, controller and empty selection. */
  async function show(loaded: LoadedPhoto, modelAlpha: AlphaMask | null) {
    const { image, bytes, type } = loaded
    const id = `photo-${String(++photos)}`
    photo = { id, image, bytes, type, source: photoCanvas(image) }
    sticker = null
    restored = modelAlpha ? { photoId: id, alpha: modelAlpha } : null
    renderer ??= deps.createRenderer()
    if (modelAlpha) {
      renderer.setImage(id, copyImage(image), copyMask(modelAlpha))
    } else {
      renderer.setImage(id, copyImage(image))
    }
    if (!started) {
      started = true
      void auto.start()
    }
    await auto.setImage(id, image)
    return photo
  }

  return {
    get renderer() {
      return renderer
    },
    /** What a save stores, as it is now (spec 0008 Review Focus 1). */
    snapshot(): SaveSnapshot | null {
      if (!photo) return null
      const sel = history.current
      return {
        photo,
        selection: sel,
        modelAlpha: sel.softEdge?.source === 'model' ? currentAlpha() : null,
        sticker,
      }
    },
    saved(photoId: string, ref: StickerRef) {
      if (photo?.id === photoId) sticker = ref
    },
    deleted(id: string) {
      if (sticker?.id === id) sticker = null
    },
    /**
     * Shows a saved sticker: its photo, then its selection as one undoable
     * step (spec 0008 AC-9). The model alpha is used only when the photo
     * loads at the saved size; otherwise a model soft edge is dropped.
     */
    async reopen(
      record: StickerRecord,
      loaded: LoadedPhoto,
      modelAlpha: AlphaMask | null,
      saved: Selection,
    ): Promise<Photo> {
      const shown = await show(loaded, modelAlpha)
      history.execute({ type: 'restore', selection: saved })
      syncSelection()
      sticker = {
        id: record.id,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }
      return shown
    },
    /** Loads `file`; if it can't be decoded, rejects before anything changes (AC-3). */
    async pick(file: File): Promise<Photo> {
      let loaded: LoadedPhoto
      try {
        loaded = await deps.loadPhoto(file)
      } catch (e) {
        throw e instanceof PhotoUnreadableError
          ? e
          : new PhotoUnreadableError({ cause: e })
      }
      return show(loaded, null)
    },
    tap(t: Tap) {
      auto.tap(t)
    },
    useLasso() {
      auto.useLasso()
    },
    retry() {
      auto.retry()
    },
  }
}
