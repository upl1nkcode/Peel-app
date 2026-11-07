import { canvasToImage, initialView } from '../../core/coords/transform'
import type { View, Viewport } from '../../core/coords/types'
import {
  applyTwoFingerGesture,
  applyWheelZoom,
  clampView,
  resizeView,
  toggleActualSize,
} from '../../core/coords/view'
import {
  displayScale,
  loupePlacement,
  needsFinerMask,
  previewScale,
  type ViewMode,
} from '../../core/editor'
import type { Point } from '../../core/geometry/types'
import { createGestureMachine } from '../../core/gestures/machine'
import {
  createPressSequencer,
  type PressIntent,
} from '../../core/gestures/sequence'
import type { GestureAction } from '../../core/gestures/types'
import type { AlphaMask } from '../../core/mask'
import type { Selection } from '../../core/selection/types'
import { buildCutout, drawFrame, drawLoupe } from './drawView'

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
  /** The loupe while aiming (AC-13, AC-14): where it sits and what it aims at. */
  loupe: { center: Point; below: boolean; aim: Point } | null
}

export const EMPTY_SNAPSHOT: CanvasSnapshot = {
  zoom: null,
  displayScale: null,
  maskScale: null,
  center: null,
  loupe: null,
}

/** The pointer fields the controller reads (React's and the DOM's events both have them). */
export interface PointerLike {
  clientX: number
  clientY: number
  pointerId: number
  /** 0 is the primary button; other mouse buttons are ignored. */
  button?: number
  pointerType?: string
}

/** Wheel zoom asks for a finer render this long after the last wheel event (AC-10). */
const WHEEL_SETTLE_MS = 150
/** Wheel `deltaMode` 1 (lines) counts as this many px (AC-6). */
const WHEEL_LINE_PX = 16

const sameSnapshot = (a: CanvasSnapshot, b: CanvasSnapshot) =>
  a.zoom === b.zoom &&
  a.displayScale === b.displayScale &&
  a.maskScale === b.maskScale &&
  a.center?.x === b.center?.x &&
  a.center?.y === b.center?.y &&
  a.loupe?.center.x === b.loupe?.center.x &&
  a.loupe?.center.y === b.loupe?.center.y &&
  a.loupe?.below === b.loupe?.below &&
  a.loupe?.aim.x === b.loupe?.aim.x &&
  a.loupe?.aim.y === b.loupe?.aim.y

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
  let loupeCanvas: HTMLCanvasElement | null = null
  /** The finger, in canvas px, while aiming. */
  let loupeAt: Point | null = null
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
  const machine = createGestureMachine()
  const sequencer = createPressSequencer()
  /** The photo point under each press's down point, as it was when it went down. */
  const downImagePts = new WeakMap<Point, Point | null>()
  /** The view and finger points a pinch or one-finger pan started from. */
  let gesture: { view: View; points: readonly [Point, Point] } | null = null
  let tapTimer: number | null = null
  let wheelTimer: number | null = null

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
      loupe:
        loupeAt && vp && view
          ? {
              ...loupePlacement(loupeAt, size),
              aim: canvasToImage(vp, view, loupeAt),
            }
          : null,
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
    const lctx = loupeAt && loupeCanvas?.getContext('2d')
    if (lctx && loupeAt) {
      drawLoupe(lctx, {
        vp,
        view,
        photo: photo.source,
        cutout: held && cutout && cutout.width > 0 ? cutout : null,
        mode: p.viewMode,
        comparing: p.comparing,
        aim: canvasToImage(vp, view, loupeAt),
      })
    }
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
    resetGestures()
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

  function resetGestures() {
    machine.reset()
    sequencer.reset()
    gesture = null
    loupeAt = null
    if (tapTimer !== null) window.clearTimeout(tapTimer)
    tapTimer = null
  }

  /** Reads the canvas's size; keeps the centre imagePt and the display scale on a change. */
  function measure() {
    if (!canvas) return
    const r = canvas.getBoundingClientRect()
    origin = { x: r.left, y: r.top }
    const d = window.devicePixelRatio || 1
    if (r.width === size.width && r.height === size.height && d === dpr) return
    const before = viewport()
    size = { width: r.width, height: r.height }
    dpr = d
    const vp = viewport()
    if (vp) {
      view = !view
        ? initialView(vp)
        : before
          ? resizeView(before, vp, view)
          : clampView(vp, view)
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

  function setView(next: View) {
    view = next
    schedule()
    emit()
  }

  function setLoupe(at: Point | null) {
    loupeAt = at
    schedule()
    emit()
  }

  /** Waits for the sequencer's deadline, then lets the waiting tap through. */
  function armTapTimer() {
    if (tapTimer !== null) window.clearTimeout(tapTimer)
    tapTimer = null
    const deadline = sequencer.deadline
    if (deadline === null) return
    tapTimer = window.setTimeout(
      () => {
        tapTimer = null
        // The timer firing means the deadline has passed, whatever the clock says.
        intents(sequencer.poll(Math.max(now(), deadline)))
        armTapTimer()
      },
      Math.max(0, deadline - now()),
    )
  }

  function act(type: 'add' | 'remove', imagePt: Point | null) {
    if (imagePt && p?.tool === 'auto') p.onIntent({ type, imagePt })
  }

  function intents(list: readonly PressIntent[]) {
    const vp = viewport()
    for (const it of list) {
      switch (it.type) {
        case 'doubleTap':
          if (vp && view) {
            setView(toggleActualSize(vp, view, it.canvasPt))
            ensureMask(false)
          }
          break
        case 'tap':
          act('add', downImagePts.get(it.canvasPt) ?? null)
          break
        case 'longPress':
          act('remove', downImagePts.get(it.canvasPt) ?? null)
          break
        case 'aimEnd':
          setLoupe(null)
          act('add', toImagePt(it.canvasPt))
          break
        case 'aimStart':
        case 'aimMove':
          // Only tools that use drags aim; in View one finger pans (AC-13).
          if (p?.tool === 'auto') setLoupe(it.canvasPt)
          break
        case 'cancel':
          setLoupe(null)
          break
      }
    }
  }

  function actions(list: readonly GestureAction[]) {
    const vp = viewport()
    for (const a of list) {
      switch (a.type) {
        case 'viewStart':
          if (view) gesture = { view, points: a.points }
          break
        case 'viewUpdate':
          if (vp && gesture) {
            setView(
              applyTwoFingerGesture(vp, gesture.view, gesture.points, a.points),
            )
          }
          break
        case 'viewEnd':
          gesture = null
          ensureMask(false)
          break
        case 'toolStart':
          downImagePts.set(a.point, toImagePt(a.point))
          if (p?.tool === 'view' && view) {
            gesture = { view, points: [a.point, a.point] }
          }
          break
        case 'toolMove':
          if (p?.tool === 'view' && vp && gesture) {
            setView(
              applyTwoFingerGesture(vp, gesture.view, gesture.points, [
                a.point,
                a.point,
              ]),
            )
          }
          break
        case 'toolEnd':
        case 'toolCancel':
          if (p?.tool === 'view') gesture = null
          break
      }
      if (a.type.startsWith('tool')) intents(sequencer.input(a, now()))
    }
    armTapTimer()
  }

  const ignored = (e: PointerLike) =>
    e.pointerType === 'mouse' && e.button !== undefined && e.button > 0

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    measure()
    const vp = viewport()
    if (!vp || !view) return
    const px =
      e.deltaMode === 1
        ? e.deltaY * WHEEL_LINE_PX
        : e.deltaMode === 2
          ? e.deltaY * size.height
          : e.deltaY
    if (!Number.isFinite(px)) return
    setView(
      applyWheelZoom(vp, view, canvasPtOf(e as PointerLike & WheelEvent), px),
    )
    if (wheelTimer !== null) window.clearTimeout(wheelTimer)
    wheelTimer = window.setTimeout(() => {
      wheelTimer = null
      ensureMask(false)
    }, WHEEL_SETTLE_MS)
  }

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
      canvas?.removeEventListener('wheel', onWheel)
      canvas = el
      if (!el) return
      // Not passive, so the page itself doesn't zoom or scroll (AC-6).
      el.addEventListener('wheel', onWheel, { passive: false })
      measure()
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(() => {
          measure()
        })
        observer.observe(el)
      }
    },

    attachLoupe(el: HTMLCanvasElement | null) {
      loupeCanvas = el
      if (el) schedule()
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
      if (ignored(e)) return
      measure()
      actions(
        machine.dispatch({
          type: 'down',
          pointerId: e.pointerId,
          point: canvasPtOf(e),
        }),
      )
    },

    pointerMove(e: PointerLike) {
      actions(
        machine.dispatch({
          type: 'move',
          pointerId: e.pointerId,
          point: canvasPtOf(e),
        }),
      )
    },

    pointerUp(e: PointerLike) {
      actions(
        machine.dispatch({
          type: 'up',
          pointerId: e.pointerId,
          point: canvasPtOf(e),
        }),
      )
    },

    pointerCancel(e: PointerLike) {
      actions(
        machine.dispatch({
          type: 'cancel',
          pointerId: e.pointerId,
          point: canvasPtOf(e),
        }),
      )
    },

    destroy() {
      observer?.disconnect()
      observer = null
      canvas?.removeEventListener('wheel', onWheel)
      canvas = null
      resetGestures()
      if (wheelTimer !== null) window.clearTimeout(wheelTimer)
      wheelTimer = null
    },
  }
}

export type CanvasController = ReturnType<typeof createCanvasController>
