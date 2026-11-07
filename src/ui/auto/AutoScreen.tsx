import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Point } from '../../core/geometry/types'
import { classifyPress, type PressSample } from '../../core/gestures/press'
import { createHistory } from '../../core/history/history'
import type { AlphaMask, RgbaImage } from '../../core/mask'
import { emptySelection } from '../../core/selection/model'
import type { Tap } from '../../core/segmentation'
import type { Selection } from '../../core/selection/types'
import {
  createAutoCutout,
  statusLines,
  USE_LASSO_LABEL,
  type AutoState,
  type ModelFile,
  type SegmentationEngine,
} from '../../services/segmentation'
import type { StickerRecord } from '../../core/backup'
import { parseSelection } from '../../core/selection/serialize'
import { PhotoUnreadableError, type LoadedPhoto } from '../../services/photo'
import { inflateModelAlpha } from '../../services/sticker'
import type { Cancelled } from '../../services/workerClient'
import type { FromRenderWorker } from '../../workers/protocol'
import { StickerPanel } from './StickerPanel'
import {
  useStickers,
  type SaveSnapshot,
  type StickerDeps,
  type StickerHost,
  type StickerRef,
} from './useStickers'
import './AutoScreen.css'

/** Shown when a re-opened photo decodes at another size (spec 0008 AC-9). */
export const DIFFERENT_SIZE =
  'This photo opened at a different size here; the outline may be off.'

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

export interface AutoScreenProps {
  engines: { fast: SegmentationEngine; precise: SegmentationEngine }
  missingBytes(files: readonly ModelFile[]): Promise<number>
  createRenderer(): Renderer
  /** Decodes a picked file; rejects (e.g. `PhotoUnreadableError`) when it can't. */
  loadPhoto(file: Blob): Promise<LoadedPhoto>
  /** Whether the browser can run the engines; checked before any download. */
  supported?: () => boolean
  now?: () => number
  /** Saving and keeping stickers (spec 0008); without it there is no panel. */
  stickers?: StickerDeps
}

interface Photo {
  id: string
  image: RgbaImage
  /** The picked file, unchanged (spec 0008 AC-4). */
  bytes: Uint8Array
  type: string
  /** The photo at full size, drawn once, for compositing the preview. */
  source: HTMLCanvasElement
}

const copyMask = (m: AlphaMask): AlphaMask => ({ ...m, data: m.data.slice() })
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

/** Draws the photo at the mask's size with the mask as its alpha (the preview, never saved). */
function drawCutout(
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  mask: AlphaMask,
) {
  canvas.width = mask.width
  canvas.height = mask.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, mask.width, mask.height)
  const pixels = ctx.getImageData(0, 0, mask.width, mask.height)
  for (let i = 0; i < mask.data.length; i++) {
    pixels.data[i * 4 + 3] = mask.data[i] ?? 0
  }
  ctx.putImageData(pixels, 0, 0)
}

/** Fits the photo inside the stage, never enlarging it (spec 0007 AC-24). */
function fitScale(image: RgbaImage, stage: { width: number; height: number }) {
  if (stage.width <= 0 || stage.height <= 0) return 1
  return Math.min(1, stage.width / image.width, stage.height / image.height)
}

interface SessionDeps extends AutoScreenProps {
  onState(state: AutoState): void
  onSelection(selection: Selection): void
}

/**
 * The screen's controller, history and renderer. The renderer and the
 * download start with the first photo (spec 0007 AC-19). The model alpha
 * goes to the renderer before the selection changes, so renders use it.
 */
function createSession(deps: SessionDeps) {
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

/**
 * The temporary tap-to-cut screen (spec 0007 decision 8, AC-24): pick a
 * photo, tap to add, long-press to remove. The cutout is drawn over a
 * checkerboard at screen resolution by the render worker. Phase 8's editor
 * replaces it.
 */
export function AutoScreen(props: AutoScreenProps) {
  const now = props.now ?? (() => performance.now())
  const [state, setState] = useState<AutoState | null>(null)
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backdropRef = useRef<HTMLCanvasElement>(null)
  /** Where the press started, on screen and on the photo. */
  const down = useRef<{ press: PressSample; imagePt: Point } | null>(null)
  const [selection, setSelection] = useState<Selection>(emptySelection())
  // One controller, history and renderer for the screen's life.
  const [session] = useState(() =>
    createSession({ ...props, onState: setState, onSelection: setSelection }),
  )

  // A download that failed offline is tried again when the connection returns.
  useEffect(() => {
    const retry = () => {
      session.retry()
    }
    window.addEventListener('online', retry)
    return () => {
      window.removeEventListener('online', retry)
    }
  }, [session])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      setStage({ width: el.clientWidth, height: el.clientHeight })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [])

  const scale = photo ? fitScale(photo.image, stage) : 1
  const renderScale = Math.min(1, scale * (window.devicePixelRatio || 1))

  // The photo behind the cutout, drawn once per photo and size.
  useEffect(() => {
    const canvas = backdropRef.current
    if (!photo || !canvas) return
    canvas.width = Math.max(1, Math.round(photo.image.width * renderScale))
    canvas.height = Math.max(1, Math.round(photo.image.height * renderScale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(photo.source, 0, 0, canvas.width, canvas.height)
  }, [photo, renderScale])

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = session.renderer
    if (!renderer || !photo || !canvas) return
    let stale = false
    void renderer.render(photo.id, selection, renderScale).then((res) => {
      if (stale || res.type !== 'rendered') return
      drawCutout(canvas, photo.source, res.mask)
    })
    return () => {
      stale = true
    }
  }, [session, photo, selection, renderScale, state?.modelAlpha])

  const pick = async (file: File) => {
    let next: Photo
    try {
      next = await session.pick(file)
    } catch (e) {
      if (!(e instanceof PhotoUnreadableError)) throw e
      // The current photo and cutout stay as they were (spec 0008 AC-3).
      setPhotoError(e.message)
      return
    }
    setPhotoError(null)
    setPhoto(next)
  }

  /** The photo point under the pointer, kept at least half a pixel inside the photo. */
  const toImagePt = (e: PointerEvent<HTMLCanvasElement>): Point | null => {
    const rect = e.currentTarget.getBoundingClientRect()
    const image = photo?.image
    if (!image || rect.width <= 0 || rect.height <= 0) return null
    const inside = (v: number, size: number) =>
      Math.min(Math.max(v, 0.5), size - 0.5)
    return {
      x: inside(
        ((e.clientX - rect.left) / rect.width) * image.width,
        image.width,
      ),
      y: inside(
        ((e.clientY - rect.top) / rect.height) * image.height,
        image.height,
      ),
    }
  }

  // The tap goes where the finger went down: touch keeps sending events to
  // the canvas after the finger slides past its edge.
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const imagePt = toImagePt(e)
    down.current = imagePt && {
      press: { screenPt: { x: e.clientX, y: e.clientY }, t: now() },
      imagePt,
    }
  }
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const start = down.current
    down.current = null
    if (!start) return
    const kind = classifyPress(start.press, {
      screenPt: { x: e.clientX, y: e.clientY },
      t: now(),
    })
    if (!kind) return
    session.tap({
      imagePt: start.imagePt,
      mode: kind === 'tap' ? 'add' : 'remove',
    })
  }

  const loadSaved = async (record: StickerRecord): Promise<LoadedPhoto> => {
    try {
      return await props.loadPhoto(
        new Blob([record.photo.bytes as BlobPart], { type: record.photo.type }),
      )
    } catch (e) {
      throw e instanceof PhotoUnreadableError
        ? e
        : new PhotoUnreadableError({ cause: e })
    }
  }

  const host: StickerHost = {
    snapshot: () => session.snapshot(),
    renderFull: async (photoId, sel, alpha) => {
      const renderer = session.renderer
      if (!renderer) throw new Error('no renderer yet')
      const res = await renderer.renderFull(
        photoId,
        sel,
        alpha ? copyMask(alpha) : undefined,
      )
      if (res.type !== 'rendered') throw new Error(`full render: ${res.type}`)
      return res.mask
    },
    saved: (photoId, ref) => {
      session.saved(photoId, ref)
    },
    deleted: (id) => {
      session.deleted(id)
    },
    open: async (record) => {
      const loaded = await loadSaved(record)
      const saved = parseSelection(record.selection).selection
      const sameSize =
        loaded.image.width === record.imageSize.width &&
        loaded.image.height === record.imageSize.height
      const alpha =
        sameSize && record.modelAlpha && props.stickers
          ? await inflateModelAlpha(
              record.modelAlpha,
              props.stickers.codecs.inflate,
            )
          : null
      // A model soft edge can't be drawn without a model alpha of this size.
      const restore: Selection =
        saved.softEdge?.source === 'model' && !alpha
          ? {
              rings: saved.rings,
              strokes: saved.strokes,
              feather: saved.feather,
            }
          : saved
      const shown = await session.reopen(record, loaded, alpha, restore)
      setPhotoError(null)
      setPhoto(shown)
      return sameSize ? null : DIFFERENT_SIZE
    },
  }
  const panel = useStickers(props.stickers, host, photo?.id ?? null, selection)

  const lines = state ? statusLines(state) : []
  const hasCutout = selection.rings.length > 0

  return (
    <section
      className="auto-screen"
      data-testid="auto-screen"
      data-phase={state?.phase ?? 'idle'}
      data-fallback={state?.fallbackTool ?? undefined}
    >
      <label className="auto-pick">
        Pick a photo
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            if (file) void pick(file)
          }}
        />
      </label>
      {photoError && (
        <p className="auto-error" role="alert">
          {photoError}
        </p>
      )}
      <div className="auto-status" role="status" aria-live="polite">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {state?.unavailable && (
          <button
            type="button"
            onClick={() => {
              session.useLasso()
            }}
          >
            {USE_LASSO_LABEL}
          </button>
        )}
      </div>
      <div
        className="auto-stage"
        ref={stageRef}
        data-image-size={
          photo
            ? `${String(photo.image.width)}x${String(photo.image.height)}`
            : undefined
        }
      >
        {photo && (
          <div
            className="auto-photo"
            style={{
              width: photo.image.width * scale,
              height: photo.image.height * scale,
            }}
          >
            <canvas
              ref={backdropRef}
              className="auto-backdrop"
              data-testid="photo"
              data-dim={hasCutout || undefined}
              aria-hidden="true"
            />
            <canvas
              ref={canvasRef}
              data-testid="cutout"
              className="auto-cutout"
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                down.current = null
              }}
              onContextMenu={(e) => {
                e.preventDefault()
              }}
            />
          </div>
        )}
      </div>
      {panel && <StickerPanel {...panel} />}
    </section>
  )
}
