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
import type { Cancelled } from '../../services/workerClient'
import type { FromRenderWorker } from '../../workers/protocol'
import './AutoScreen.css'

/** The part of the render worker client this screen uses (spec 0006). */
export interface Renderer {
  setImage(imageId: string, image: RgbaImage): void
  setModelAlpha(imageId: string, modelAlpha: AlphaMask): void
  render(
    imageId: string,
    selection: Selection,
    scale: number,
  ): Promise<FromRenderWorker | Cancelled>
}

export interface AutoScreenProps {
  engines: { fast: SegmentationEngine; precise: SegmentationEngine }
  missingBytes(files: readonly ModelFile[]): Promise<number>
  createRenderer(): Renderer
  loadPhoto(file: File): Promise<RgbaImage>
  /** Whether the browser can run the engines; checked before any download. */
  supported?: () => boolean
  now?: () => number
}

interface Photo {
  id: string
  image: RgbaImage
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
  let photoId: string | null = null
  let selection = history.current
  let modelAlpha: AlphaMask | null = null
  const auto = createAutoCutout({
    ...deps.engines,
    history,
    missingBytes: (files) => deps.missingBytes(files),
    ...(deps.supported && { supported: deps.supported }),
    onChange: (s) => {
      if (s.modelAlpha && s.modelAlpha !== modelAlpha && photoId) {
        renderer?.setModelAlpha(photoId, copyMask(s.modelAlpha))
      }
      modelAlpha = s.modelAlpha
      if (history.current !== selection) {
        selection = history.current
        deps.onSelection(selection)
      }
      deps.onState(s)
    },
  })
  return {
    get renderer() {
      return renderer
    },
    async pick(file: File): Promise<Photo> {
      const image = await deps.loadPhoto(file)
      const id = `photo-${String(++photos)}`
      photoId = id
      renderer ??= deps.createRenderer()
      renderer.setImage(id, copyImage(image))
      modelAlpha = null
      if (!started) {
        started = true
        void auto.start()
      }
      await auto.setImage(id, image)
      return { id, image, source: photoCanvas(image) }
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
    setPhoto(await session.pick(file))
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
      <div className="auto-stage" ref={stageRef}>
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
    </section>
  )
}
