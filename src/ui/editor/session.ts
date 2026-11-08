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
  /** Every ring re-simplified to `tolerancePx` (spec 0010 AC-15), off the main thread. */
  resimplify(
    selection: Selection,
    tolerancePx: number,
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
 * download start with the first photo (spec 0007 AC-19). Each history
 * snapshot keeps the model alpha it was made with, so undo and redo render
 * and save an older Auto result with its own soft edge (spec 0009 Review
 * Focus 1). That alpha goes to the renderer before the selection changes.
 * Each photo starts a new history (spec 0009 AC-19).
 */
export function createSession(deps: SessionDeps) {
  const history = createHistory(emptySelection())
  let renderer: Renderer | null = null
  let started = false
  let photos = 0
  let photo: Photo | null = null
  let selection = history.current
  /** The model alpha each snapshot's soft edge uses. */
  const alphas = new WeakMap<Selection, AlphaMask>()
  /** The model alpha the renderer holds for the current photo. */
  let sentAlpha: AlphaMask | null = null
  /** The saved sticker this photo belongs to, if any (spec 0008 AC-9). */
  let sticker: StickerRef | null = null
  const auto = createAutoCutout({
    ...deps.engines,
    history,
    missingBytes: (files) => deps.missingBytes(files),
    ...(deps.supported && { supported: deps.supported }),
    onChange: (s) => {
      // The snapshot holding an applied result is the one its alpha belongs to.
      if (s.autoResultSelection && s.modelAlpha) {
        alphas.set(s.autoResultSelection, s.modelAlpha)
      }
      syncSelection()
      deps.onState(s)
    },
  })

  /** Tells the screen about a new current snapshot, after giving the renderer its alpha. */
  function syncSelection() {
    const current = history.current
    if (current === selection) return
    // An edit of a model-edged selection keeps that selection's alpha.
    if (!alphas.has(current) && current.softEdge?.source === 'model') {
      const inherited = alphas.get(selection)
      if (inherited) alphas.set(current, inherited)
    }
    selection = current
    const alpha = alphas.get(current)
    if (alpha && alpha !== sentAlpha && photo) {
      renderer?.setModelAlpha(photo.id, copyMask(alpha))
      sentAlpha = alpha
    }
    deps.onSelection(current)
  }

  /** Shows `image` as a new photo: renderer, controller and empty selection. */
  async function show(loaded: LoadedPhoto, modelAlpha: AlphaMask | null) {
    const { image, bytes, type } = loaded
    const id = `photo-${String(++photos)}`
    photo = { id, image, bytes, type, source: photoCanvas(image) }
    sticker = null
    sentAlpha = modelAlpha
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
    // The controller shows an empty selection at once; the history starts there.
    const ready = auto.setImage(id, image)
    history.reset(history.current)
    syncSelection()
    await ready
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
        modelAlpha:
          sel.softEdge?.source === 'model' ? (alphas.get(sel) ?? null) : null,
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
      const restored = history.execute({ type: 'restore', selection: saved })
      if (modelAlpha) alphas.set(restored, modelAlpha)
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
    get canUndo() {
      return history.canUndo
    },
    get canRedo() {
      return history.canRedo
    },
    /** Steps back through every selection change (spec 0009 AC-19). */
    undo() {
      if (!history.canUndo) return
      history.undo()
      syncSelection()
    },
    redo() {
      if (!history.canRedo) return
      history.redo()
      syncSelection()
    },
    /** Makes the latest Auto result the selection, as one undoable step (AC-20). */
    resetToAuto() {
      auto.resetToAuto()
    },
    /** The model alpha `selection`'s soft edge uses, if any. */
    alphaFor(sel: Selection): AlphaMask | null {
      return alphas.get(sel) ?? null
    },
    useLasso() {
      auto.useLasso()
    },
    retry() {
      auto.retry()
    },
  }
}
