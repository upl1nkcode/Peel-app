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
  dragTo,
  hitDots,
  loupePlacement,
  needsFinerMask,
  nodesInBox,
  previewScale,
  refsAfterDelete,
  startDrag,
  visiblePhotoRect,
  type DotDrag,
  type DotHit,
  type Rect,
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
import { applyCommand } from '../../core/selection/commands'
import type { Command, NodeRef, Selection } from '../../core/selection/types'
import {
  buildCutout,
  drawDots,
  drawFrame,
  drawLoupe,
  type DotsLayer,
} from './drawView'

export interface CanvasPhoto {
  id: string
  width: number
  height: number
  /** The photo at full size. */
  source: HTMLCanvasElement
}

export type EditorTool = 'auto' | 'dots' | 'view'

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
  /** The selected dots, against `selection` (spec 0010 AC-11). */
  selectedDots?: readonly NodeRef[]
  /** Fine mode allowed for dot drags (AC-6); on unless false. */
  fine?: boolean
  /** One dot edit, and the dots to select after it (spec 0010). */
  onEdit?(command: Command, selectAfter: readonly NodeRef[]): void
  /** A new dot selection, against the current `selection` (AC-11). */
  onSelectDots?(refs: readonly NodeRef[]): void
  now?: () => number
}

/** What the component shows as attributes (test hooks). */
export interface CanvasSnapshot {
  zoom: number | null
  displayScale: number | null
  maskScale: number | null
  center: Point | null
  /**
   * The loupe while aiming or dragging a dot (AC-13, AC-14): where it sits,
   * what it aims at, and whether fine mode is on (spec 0010 AC-5, AC-6).
   */
  loupe: { center: Point; below: boolean; aim: Point; fine: boolean } | null
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
  a.loupe?.aim.y === b.loupe?.aim.y &&
  a.loupe?.fine === b.loupe?.fine

const sameRef = (a: NodeRef) => (b: NodeRef) =>
  a.ring === b.ring && a.node === b.node

/** What a press went down on in the Dots tool, and the selection it was hit against. */
interface DownHit {
  hit: DotHit | null
  sel: Selection
}

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
  /** Dots tool: what each press went down on, by its down point. */
  const downHits = new WeakMap<Point, DownHit>()
  /** The last two presses' hits, for a double-tap on a dot (AC-9). */
  let lastHits: [DownHit | null, DownHit | null] = [null, null]
  /** The press in progress: its down point and time. */
  let pressDown: { pt: Point; t: number } | null = null
  /** A dot drag in progress (AC-3, AC-6, AC-12). */
  let dotDrag: {
    from: Selection
    refs: NodeRef[]
    /** Which of `refs` the finger is on (the loupe aims at it). */
    held: number
    starts: Point[]
    drag: DotDrag
    positions: Point[]
  } | null = null
  /** A box being drawn, in canvas px (AC-11). */
  let box: { a: Point; b: Point } | null = null
  /** The selection as the drag shows it, until the drag ends (AC-21). */
  let preview: Selection | null = null
  /** Every preview of the current drag, so their renders can be shown. */
  let previews = new WeakSet<Selection>()
  /** The loupe's aim when it isn't the finger (a dragged dot), and fine mode. */
  let loupeAim: Point | null = null
  let loupeFine = false

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
              aim: loupeAim ?? canvasToImage(vp, view, loupeAt),
              fine: loupeFine,
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
    const dots = dotsLayer()
    if (dots) drawDots(ctx, { vp, view }, dots)
    const lctx = loupeAt && loupeCanvas?.getContext('2d')
    if (lctx && loupeAt) {
      drawLoupe(lctx, {
        vp,
        view,
        photo: photo.source,
        cutout: held && cutout && cutout.width > 0 ? cutout : null,
        mode: p.viewMode,
        comparing: p.comparing,
        aim: loupeAim ?? canvasToImage(vp, view, loupeAt),
        ...(dots && { dots: { ...dots, box: null } }),
      })
    }
    performance.measure('peel-frame', FRAME_MARK)
    performance.clearMarks(FRAME_MARK)
    if (++frames % MEASURES_KEPT === 0) performance.clearMeasures('peel-frame')
  }

  /** The best mask held or on its way for the current selection. */
  const bestScale = (): number | null => {
    if (!p) return null
    const sel = current()
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
    if (preview) {
      renderPreview()
      return
    }
    request(wanted)
  }

  function request(scale: number) {
    if (!p?.photo) return
    const inputs = p
    const sel = current()
    const id = inputs.photo?.id
    const mine = ++token
    pending = { selection: sel, scale, token: mine }
    const done = () => {
      if (pending?.token === mine) pending = null
    }
    inputs.renderMask(sel, scale).then(
      (mask) => {
        done()
        // A drag's older preview is still worth showing until the newest arrives.
        const wanted =
          sel === current() || (preview !== null && previews.has(sel))
        if (mask && id === photoId && wanted && p) {
          if (!(held?.selection === sel && held.scale > scale)) {
            const photo = p.photo
            if (cutout && photo) buildCutout(cutout, photo.source, mask)
            held = { selection: sel, scale }
            schedule()
            emit()
          }
        }
        renderPreview()
      },
      () => {
        done()
        renderPreview()
      },
    )
  }

  /** The selection on screen: a drag's preview, else the input. */
  function current(): Selection {
    return preview ?? (p as CanvasInputs).selection
  }

  /** Asks for the preview's render, one at a time (spec 0010 AC-21). */
  function renderPreview() {
    const vp = viewport()
    if (!preview || pending || !vp || !view) return
    if (held?.selection === preview) return
    request(previewScale(vp, view))
  }

  function dotsLayer(): DotsLayer | null {
    if (p?.tool !== 'dots') return null
    const selection = current()
    if (selection.rings.length === 0) return null
    return {
      selection,
      selected: dotDrag ? dotDrag.refs : (p.selectedDots ?? []),
      box,
      accent: accentColour(),
    }
  }

  function accentColour(): string {
    const value =
      canvas && typeof getComputedStyle === 'function'
        ? getComputedStyle(canvas).getPropertyValue('--accent').trim()
        : ''
    return value || '#2459c9'
  }

  /** Drops a dot drag or box without editing (AC-4, Review Focus 1). */
  function dropDots() {
    const had = dotDrag !== null || box !== null
    dotDrag = null
    box = null
    preview = null
    previews = new WeakSet()
    loupeAt = null
    loupeAim = null
    loupeFine = false
    if (had) {
      ensureMask(false)
      schedule()
      emit()
    }
  }

  function dotHitAt(canvasPt: Point): DownHit | null {
    const vp = viewport()
    if (!p || !vp || !view) return null
    const sel = p.selection
    return { hit: hitDots(sel, canvasPt, vp, view), sel }
  }

  /** The press's hit, if it was hit against the selection still shown. */
  const fresh = (d: DownHit | null | undefined): DotHit | null =>
    d && p && d.sel === p.selection ? d.hit : null

  function dotTap(down: DownHit | undefined) {
    if (!p || !down || down.sel !== p.selection) return
    if (p.selection.rings.length === 0) return
    const hit = down.hit
    if (!hit) p.onSelectDots?.([])
    else if (hit.kind === 'node') p.onSelectDots?.([hit.ref])
    else {
      p.onEdit?.(
        {
          type: 'insertNode',
          ring: hit.ring,
          afterNode: hit.afterNode,
          point: hit.imagePt,
        },
        [{ ring: hit.ring, node: hit.afterNode + 1 }],
      )
    }
  }

  function beginDots(canvasPt: Point) {
    const vp = viewport()
    if (!p || !vp || !view || !pressDown) return
    const down = downHits.get(pressDown.pt)
    if (!down || down.sel !== p.selection) return
    if (p.selection.rings.length === 0) return
    const hit = down.hit
    if (hit?.kind !== 'node') {
      box = { a: pressDown.pt, b: canvasPt }
      schedule()
      return
    }
    const selected = p.selectedDots ?? []
    const inSelection = selected.some(sameRef(hit.ref))
    const refs = inSelection ? [...selected] : [hit.ref]
    if (!inSelection) p.onSelectDots?.([hit.ref])
    const starts: Point[] = []
    for (const r of refs) {
      const n = p.selection.rings[r.ring]?.nodes[r.node]
      if (!n) return
      starts.push({ x: n.x, y: n.y })
    }
    dotDrag = {
      from: p.selection,
      refs,
      held: refs.findIndex(sameRef(hit.ref)),
      starts,
      drag: startDrag(
        starts,
        pressDown.pt,
        pressDown.t,
        vp,
        view,
        p.fine ?? true,
      ),
      positions: starts,
    }
    moveDots(canvasPt)
  }

  function moveDots(canvasPt: Point) {
    if (box) {
      box = { ...box, b: canvasPt }
      schedule()
      return
    }
    if (!dotDrag) return
    const r = dragTo(dotDrag.drag, canvasPt, now())
    const first = dotDrag.starts[0] as Point
    const moved = r.positions[0] as Point
    dotDrag = { ...dotDrag, drag: r.drag, positions: r.positions }
    preview = applyCommand(dotDrag.from, {
      type: 'moveNodes',
      refs: dotDrag.refs,
      delta: { x: moved.x - first.x, y: moved.y - first.y },
    })
    previews.add(preview)
    loupeAt = canvasPt
    loupeAim = r.positions[dotDrag.held] ?? null
    loupeFine = r.fine
    renderPreview()
    schedule()
    emit()
  }

  function endDots(canvasPt: Point) {
    const vp = viewport()
    if (box) {
      const b = box
      box = null
      schedule()
      if (p && vp && view) {
        p.onSelectDots?.(nodesInBox(p.selection, b.a, canvasPt, vp, view))
      }
      return
    }
    if (!dotDrag) return
    moveDots(canvasPt)
    const d = dotDrag
    const first = d.starts[0] as Point
    const moved = d.positions[0] as Point
    const delta = { x: moved.x - first.x, y: moved.y - first.y }
    dropDots()
    if (delta.x === 0 && delta.y === 0) return
    const only = d.refs.length === 1 ? d.refs[0] : undefined
    p?.onEdit?.(
      only
        ? { type: 'moveNode', ring: only.ring, node: only.node, to: moved }
        : { type: 'moveNodes', refs: d.refs, delta },
      d.refs,
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
    dotDrag = null
    box = null
    preview = null
    previews = new WeakSet()
    pressDown = null
    lastHits = [null, null]
    loupeAim = null
    loupeFine = false
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

  /** A double-tap whose two presses hit the same dot deletes it (spec 0010 AC-9). */
  function deleteDoubleTapped(): boolean {
    if (p?.tool !== 'dots') return false
    const a = fresh(lastHits[0])
    const b = fresh(lastHits[1])
    if (a?.kind !== 'node' || b?.kind !== 'node') return false
    if (!sameRef(a.ref)(b.ref)) return false
    p.onEdit?.(
      { type: 'deleteNode', ring: a.ref.ring, node: a.ref.node },
      refsAfterDelete(p.selection, p.selectedDots ?? [], a.ref),
    )
    return true
  }

  function intents(list: readonly PressIntent[]) {
    const vp = viewport()
    for (const it of list) {
      switch (it.type) {
        case 'doubleTap':
          if (deleteDoubleTapped()) break
          if (vp && view) {
            setView(toggleActualSize(vp, view, it.canvasPt))
            ensureMask(false)
          }
          break
        case 'tap':
          if (p?.tool === 'dots') dotTap(downHits.get(it.canvasPt))
          else act('add', downImagePts.get(it.canvasPt) ?? null)
          break
        case 'longPress':
          if (p?.tool === 'dots') {
            const hit = fresh(downHits.get(it.canvasPt))
            if (hit?.kind === 'node') {
              p.onEdit?.(
                { type: 'toggleKind', ring: hit.ref.ring, node: hit.ref.node },
                p.selectedDots ?? [],
              )
            }
          } else act('remove', downImagePts.get(it.canvasPt) ?? null)
          break
        case 'aimEnd':
          if (p?.tool === 'dots') {
            endDots(it.canvasPt)
            break
          }
          setLoupe(null)
          act('add', toImagePt(it.canvasPt))
          break
        case 'aimStart':
          // Only tools that use drags aim; in View one finger pans (AC-13).
          if (p?.tool === 'auto') setLoupe(it.canvasPt)
          else if (p?.tool === 'dots') beginDots(it.canvasPt)
          break
        case 'aimMove':
          if (p?.tool === 'auto') setLoupe(it.canvasPt)
          else if (p?.tool === 'dots') moveDots(it.canvasPt)
          break
        case 'cancel':
          dropDots()
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
        case 'toolStart': {
          downImagePts.set(a.point, toImagePt(a.point))
          pressDown = { pt: a.point, t: now() }
          if (p?.tool === 'dots') {
            const down = dotHitAt(a.point)
            if (down) downHits.set(a.point, down)
            lastHits = [lastHits[1], down]
          }
          if (p?.tool === 'view' && view) {
            gesture = { view, points: [a.point, a.point] }
          }
          break
        }
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
    /** The part of the photo on screen, in image px (spec 0010 AC-17). */
    visibleRect(): Rect | null {
      measure()
      const vp = viewport()
      return vp && view ? visiblePhotoRect(vp, view) : null
    },

    setInputs(next: CanvasInputs) {
      const prev = p
      p = next
      const photoChanged =
        (prev?.photo?.id ?? null) !== (next.photo?.id ?? null)
      // A change under a dot drag or box drops it (Review Focus 1).
      if (
        (dotDrag || box) &&
        (photoChanged ||
          prev?.selection !== next.selection ||
          next.tool !== 'dots')
      ) {
        dropDots()
      }
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
