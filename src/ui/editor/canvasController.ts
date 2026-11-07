import { canvasToImage, initialView } from '../../core/coords/transform'
import type { View, Viewport } from '../../core/coords/types'
import { clampView } from '../../core/coords/view'
import {
  displayScale,
  needsFinerMask,
  previewScale,
  type ViewMode,
} from '../../core/editor'
import type { Point } from '../../core/geometry/types'
import { classifyPress, type PressSample } from '../../core/gestures/press'
import type { AlphaMask } from '../../core/mask'
import type { Selection } from '../../core/selection/types'
import { buildCutout, drawFrame } from './drawView'

export interface CanvasPhoto {
  id: string
  width: number
  height: number
  /** The photo at full size. */
  source: HTMLCanvasElement
}

export type EditorTool = 'auto' | 'view'

export interface ToolIntent {
  type: 'add' | 'remove'
  imagePt: Point
}

export interface CanvasInputs {
  photo: CanvasPhoto | null
  selection: Selection
  /** Renders `selection` at `scale`; null when the render was cancelled. */
  renderMask(selection: Selection, scale: number): Promise<AlphaMask | null>
  viewMode: ViewMode
  comparing: boolean
  tool: EditorTool
  onIntent(intent: ToolIntent): void
  now?: () => number
}

/** What the component shows as attributes (test hooks). */
export interface CanvasSnapshot {
  zoom: number | null
  displayScale: number | null
  maskScale: number | null
  center: Point | null
}

export const EMPTY_SNAPSHOT: CanvasSnapshot = {
  zoom: null,
  displayScale: null,
  maskScale: null,
  center: null,
}

/** The pointer fields the controller reads (React's and the DOM's events both have them). */
export interface PointerLike {
  clientX: number
  clientY: number
  pointerId: number
}

const sameSnapshot = (a: CanvasSnapshot, b: CanvasSnapshot) =>
  a.zoom === b.zoom &&
  a.displayScale === b.displayScale &&
  a.maskScale === b.maskScale &&
  a.center?.x === b.center?.x &&
  a.center?.y === b.center?.y

const FRAME_MARK = 'peel-frame-start'
/** User-timing entries are cleared this often, so a long session doesn't pile them up. */
const MEASURES_KEPT = 1000

/**
 * The editor canvas without React (spec 0009 AC-1 to AC-10): the view, the
 * held mask, render requests and drawing. The component feeds it props and
 * DOM elements, and shows its snapshot.
 */
export function createCanvasController(
  onSnapshot: (s: CanvasSnapshot) => void,
) {
  let canvas: HTMLCanvasElement | null = null
  let cutout: HTMLCanvasElement | null = null
  let photoHost: HTMLElement | null = null
  let observer: ResizeObserver | null = null
  let p: CanvasInputs | null = null
  let size = { width: 0, height: 0 }
  let origin: Point = { x: 0, y: 0 }
  let dpr = 1
  let view: View | null = null
  let photoId: string | null = null
  /** The mask in the cutout canvas: which selection, at which scale. */
  let held: { selection: Selection; scale: number } | null = null
  let pending: { selection: Selection; scale: number; token: number } | null =
    null
  let token = 0
  let frame: number | null = null
  let frames = 0
  let snapshot = EMPTY_SNAPSHOT
  let press: { sample: PressSample; canvasPt: Point; id: number } | null = null

  const now = () => (p?.now ?? (() => performance.now()))()

  const viewport = (): Viewport | null => {
    const photo = p?.photo
    if (!photo || !(size.width > 0) || !(size.height > 0)) return null
    return {
      canvas: size,
      image: { width: photo.width, height: photo.height },
      dpr,
    }
  }

  function emit() {
    const vp = viewport()
    const next: CanvasSnapshot = {
      zoom: view?.zoom ?? null,
      displayScale: vp && view ? displayScale(vp, view) : null,
      maskScale: held?.scale ?? null,
      center: view ? { ...view.center } : null,
    }
    if (sameSnapshot(next, snapshot)) return
    snapshot = next
    onSnapshot(next)
  }

  function schedule() {
    if (frame !== null) return
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: () => void) => window.setTimeout(cb, 16)
    frame = raf(() => {
      frame = null
      draw()
    })
  }

  function draw() {
    const vp = viewport()
    const photo = p?.photo
    if (!canvas || !vp || !view || !photo || !p) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    performance.mark(FRAME_MARK)
    drawFrame(ctx, {
      vp,
      view,
      photo: photo.source,
      cutout: held && cutout && cutout.width > 0 ? cutout : null,
      mode: p.viewMode,
      comparing: p.comparing,
    })
    performance.measure('peel-frame', FRAME_MARK)
    performance.clearMarks(FRAME_MARK)
    if (++frames % MEASURES_KEPT === 0) performance.clearMeasures('peel-frame')
  }

  /** The best mask held or on its way for the current selection. */
  const bestScale = (): number | null => {
    if (!p) return null
    const sel = p.selection
    const scales = [
      held && held.selection === sel ? held.scale : null,
      pending && pending.selection === sel ? pending.scale : null,
    ].filter((s): s is number => s !== null)
    return scales.length ? Math.max(...scales) : null
  }

  /** Asks for a render: always (`force`, a new selection) or when the held one is too coarse. */
  function ensureMask(force: boolean) {
    const vp = viewport()
    if (!vp || !view || !p?.photo) return
    const wanted = previewScale(vp, view)
    if (!force && !needsFinerMask(bestScale(), wanted)) return
    request(wanted)
  }

  function request(scale: number) {
    if (!p?.photo) return
    const inputs = p
    const sel = inputs.selection
    const id = inputs.photo?.id
    const mine = ++token
    pending = { selection: sel, scale, token: mine }
    const done = () => {
      if (pending?.token === mine) pending = null
    }
    inputs.renderMask(sel, scale).then(
      (mask) => {
        done()
        if (!mask || id !== photoId || sel !== p?.selection) return
        if (held?.selection === sel && held.scale > scale) return
        const photo = p.photo
        if (cutout && photo) buildCutout(cutout, photo.source, mask)
        held = { selection: sel, scale }
        schedule()
        emit()
      },
      () => {
        done()
      },
    )
  }

  function newPhoto(photo: CanvasPhoto | null) {
    photoId = photo?.id ?? null
    held = null
    pending = null
    press = null
    if (cutout) {
      cutout.width = 0
      cutout.height = 0
    }
    if (photoHost) {
      if (photo) {
        photo.source.setAttribute('data-testid', 'photo')
        photoHost.replaceChildren(photo.source)
      } else {
        photoHost.replaceChildren()
      }
    }
    const vp = viewport()
    view = vp ? initialView(vp) : null
  }

  /** Reads the canvas's size; keeps the centre imagePt and clamps on a change. */
  function measure() {
    if (!canvas) return
    const r = canvas.getBoundingClientRect()
    origin = { x: r.left, y: r.top }
    const d = window.devicePixelRatio || 1
    if (r.width === size.width && r.height === size.height && d === dpr) return
    size = { width: r.width, height: r.height }
    dpr = d
    const vp = viewport()
    if (vp) {
      view = view ? clampView(vp, view) : initialView(vp)
      ensureMask(false)
      schedule()
    }
    emit()
  }

  /** The photo point under `canvasPt`, kept half a pixel inside; null outside the photo. */
  function toImagePt(canvasPt: Point): Point | null {
    const vp = viewport()
    if (!vp || !view) return null
    const ip = canvasToImage(vp, view, canvasPt)
    const { width: w, height: h } = vp.image
    if (!(ip.x >= 0 && ip.x <= w && ip.y >= 0 && ip.y <= h)) return null
    const inside = (v: number, s: number) => Math.min(Math.max(v, 0.5), s - 0.5)
    return { x: inside(ip.x, w), y: inside(ip.y, h) }
  }

  const canvasPtOf = (e: PointerLike): Point => ({
    x: e.clientX - origin.x,
    y: e.clientY - origin.y,
  })

  return {
    setInputs(next: CanvasInputs) {
      const prev = p
      p = next
      const photoChanged =
        (prev?.photo?.id ?? null) !== (next.photo?.id ?? null)
      if (photoChanged) newPhoto(next.photo)
      if (
        photoChanged ||
        prev?.selection !== next.selection ||
        prev.renderMask !== next.renderMask
      ) {
        ensureMask(true)
      }
      schedule()
      emit()
    },

    attachCanvas(el: HTMLCanvasElement | null) {
      observer?.disconnect()
      observer = null
      canvas = el
      if (!el) return
      measure()
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(() => {
          measure()
        })
        observer.observe(el)
      }
    },

    attachCutout(el: HTMLCanvasElement | null) {
      cutout = el
    },

    attachPhotoHost(el: HTMLElement | null) {
      photoHost = el
      if (el && p?.photo) {
        p.photo.source.setAttribute('data-testid', 'photo')
        el.replaceChildren(p.photo.source)
      }
    },

    pointerDown(e: PointerLike) {
      measure()
      const canvasPt = canvasPtOf(e)
      press = {
        sample: { screenPt: canvasPt, t: now() },
        canvasPt,
        id: e.pointerId,
      }
    },

    pointerUp(e: PointerLike) {
      const start = press
      press = null
      if (start?.id !== e.pointerId || !p) return
      const kind = classifyPress(start.sample, {
        screenPt: canvasPtOf(e),
        t: now(),
      })
      if (!kind) return
      const imagePt = toImagePt(start.canvasPt)
      if (!imagePt) return
      p.onIntent({ type: kind === 'tap' ? 'add' : 'remove', imagePt })
    },

    pointerCancel(e: PointerLike) {
      if (press?.id === e.pointerId) press = null
    },

    destroy() {
      observer?.disconnect()
      observer = null
      canvas = null
    },
  }
}

export type CanvasController = ReturnType<typeof createCanvasController>
