import { canvasToImage, imageToCanvas, viewScale } from '../coords/transform'
import type { View, Viewport } from '../coords/types'
import { pointOnSegment, toBezierSegments } from '../geometry/bezier'
import { TOUCH_RADIUS_PX } from '../geometry/hitTest'
import type { BezierSegment, Node, Point } from '../geometry/types'
import { MIN_RING_NODES } from '../selection/commands'
import type { NodeRef, Selection } from '../selection/types'

/** A rectangle in image px. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** What a press in the Dots tool is on (spec 0010 AC-8, AC-11). */
export type DotHit =
  | { kind: 'node'; ref: NodeRef }
  | { kind: 'edge'; ring: number; afterNode: number; imagePt: Point }

/** A starting shape is this fraction of the visible photo (AC-17). */
export const SHAPE_FRACTION = 0.6
/** Dots on a starting ellipse (AC-17). */
export const ELLIPSE_NODES = 8

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Steps of the search for the nearest point between two samples. */
const REFINE_STEPS = 60

/** The point of `seg` nearest `imagePt`: samples ≤ `stepPx` apart, then a ternary search. */
function nearestOnSegment(
  seg: BezierSegment,
  imagePt: Point,
  stepPx: number,
): Point {
  const legs =
    dist(seg.p0, seg.c1) + dist(seg.c1, seg.c2) + dist(seg.c2, seg.p3)
  // |B′(t)| ≤ 3 × the longest leg ≤ 3 × the legs' sum.
  const n = Math.max(1, Math.ceil((3 * legs) / stepPx))
  let best = 0
  let bestD = Infinity
  for (let i = 0; i <= n; i++) {
    const d = dist(pointOnSegment(seg, i / n), imagePt)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  let lo = Math.max(0, best - 1) / n
  let hi = Math.min(n, best + 1) / n
  for (let k = 0; k < REFINE_STEPS; k++) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    if (
      dist(pointOnSegment(seg, m1), imagePt) <=
      dist(pointOnSegment(seg, m2), imagePt)
    ) {
      hi = m2
    } else {
      lo = m1
    }
  }
  return pointOnSegment(seg, (lo + hi) / 2)
}

/** Whether `p` is within `r` of the box around a segment's control points. */
function nearBox(seg: BezierSegment, p: Point, r: number): boolean {
  const xs = [seg.p0.x, seg.c1.x, seg.c2.x, seg.p3.x]
  const ys = [seg.p0.y, seg.c1.y, seg.c2.y, seg.p3.y]
  return (
    p.x >= Math.min(...xs) - r &&
    p.x <= Math.max(...xs) + r &&
    p.y >= Math.min(...ys) - r &&
    p.y <= Math.max(...ys) + r
  )
}

/**
 * The dot or edge under `canvasPt`, within 22 canvas px (AC-8, AC-11). Dots
 * win over edges; the nearest wins, ties to the lowest ring and index. Edges
 * are the drawn curves, sampled at most 1 canvas px apart.
 */
export function hitDots(
  sel: Selection,
  canvasPt: Point,
  vp: Viewport,
  view: View,
): DotHit | null {
  let node: NodeRef | null = null
  let nodeD = Infinity
  for (const [r, ring] of sel.rings.entries()) {
    for (const [i, n] of ring.nodes.entries()) {
      const d = dist(imageToCanvas(vp, view, n), canvasPt)
      if (d <= TOUCH_RADIUS_PX && d < nodeD) {
        node = { ring: r, node: i }
        nodeD = d
      }
    }
  }
  if (node) return { kind: 'node', ref: node }

  const scale = viewScale(vp, view)
  const imagePt = canvasToImage(vp, view, canvasPt)
  const reach = TOUCH_RADIUS_PX / scale
  let edge: DotHit | null = null
  let edgeD = Infinity
  for (const [r, ring] of sel.rings.entries()) {
    for (const [i, seg] of toBezierSegments(ring.nodes, true).entries()) {
      if (!nearBox(seg, imagePt, reach)) continue
      const on = nearestOnSegment(seg, imagePt, 1 / scale)
      const d = dist(on, imagePt) * scale
      if (d <= TOUCH_RADIUS_PX && d < edgeD) {
        edge = { kind: 'edge', ring: r, afterNode: i, imagePt: on }
        edgeD = d
      }
    }
  }
  return edge
}

/** Every dot inside the box between canvasPts `a` and `b`, edges included (AC-11). */
export function nodesInBox(
  sel: Selection,
  a: Point,
  b: Point,
  vp: Viewport,
  view: View,
): NodeRef[] {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  const refs: NodeRef[] = []
  sel.rings.forEach((ring, r) => {
    ring.nodes.forEach((n, i) => {
      const c = imageToCanvas(vp, view, n)
      if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) {
        refs.push({ ring: r, node: i })
      }
    })
  })
  return refs
}

/**
 * The density slider's tolerance for a position `s` in [−1, 1] (AC-15):
 * 0.5 × 16^(−s) left of the middle (up to 8 px), 0.5 × 0.02^s right of it
 * (down to 0.01 px), and null at the middle (no change, AC-16).
 */
export function densityTolerance(s: number): number | null {
  if (!Number.isFinite(s) || s < -1 || s > 1) {
    throw new RangeError(`slider position ${String(s)} is outside [-1, 1]`)
  }
  if (s === 0) return null
  return s < 0 ? 0.5 * 16 ** -s : 0.5 * 0.02 ** s
}

/** The part of the photo the view shows, in image px. */
export function visiblePhotoRect(vp: Viewport, view: View): Rect {
  const a = canvasToImage(vp, view, { x: 0, y: 0 })
  const b = canvasToImage(vp, view, {
    x: vp.canvas.width,
    y: vp.canvas.height,
  })
  const x0 = Math.max(0, a.x)
  const y0 = Math.max(0, a.y)
  const x1 = Math.min(vp.image.width, b.x)
  const y1 = Math.min(vp.image.height, b.y)
  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  }
}

/**
 * A starting shape centred on `visible`, 60% of its width and height
 * (AC-17): a rectangle of 4 corners, or an ellipse of 8 smooth dots that
 * each lie exactly on it.
 */
export function startingShape(
  kind: 'rectangle' | 'ellipse',
  visible: Rect,
): Node[] {
  const cx = visible.x + visible.width / 2
  const cy = visible.y + visible.height / 2
  const rx = (visible.width * SHAPE_FRACTION) / 2
  const ry = (visible.height * SHAPE_FRACTION) / 2
  if (kind === 'rectangle') {
    return [
      { x: cx - rx, y: cy - ry, kind: 'corner' },
      { x: cx + rx, y: cy - ry, kind: 'corner' },
      { x: cx + rx, y: cy + ry, kind: 'corner' },
      { x: cx - rx, y: cy + ry, kind: 'corner' },
    ]
  }
  return Array.from({ length: ELLIPSE_NODES }, (_, i) => {
    const a = (i / ELLIPSE_NODES) * 2 * Math.PI
    return {
      x: cx + rx * Math.cos(a),
      y: cy + ry * Math.sin(a),
      kind: 'smooth' as const,
    }
  })
}

/**
 * The refs that still point at the same dots after `deleted` is removed from
 * `sel` (the selection before the delete). The deleted dot is dropped; if its
 * ring is removed for having fewer than 3 dots (spec 0003 AC-8), so are that
 * ring's refs, and later rings shift down one (AC-13).
 */
export function refsAfterDelete(
  sel: Selection,
  refs: readonly NodeRef[],
  deleted: NodeRef,
): NodeRef[] {
  const ring = sel.rings[deleted.ring]
  const ringGone = !ring || ring.nodes.length - 1 < MIN_RING_NODES
  const out: NodeRef[] = []
  for (const ref of refs) {
    if (ref.ring === deleted.ring) {
      if (ringGone || ref.node === deleted.node) continue
      out.push(ref.node > deleted.node ? { ...ref, node: ref.node - 1 } : ref)
    } else if (ringGone && ref.ring > deleted.ring) {
      out.push({ ...ref, ring: ref.ring - 1 })
    } else {
      out.push(ref)
    }
  }
  return out
}

/** Whether two selections have the same rings: ops, kinds and exact coordinates (AC-16). */
export function sameRings(a: Selection, b: Selection): boolean {
  if (a.rings.length !== b.rings.length) return false
  return a.rings.every((ra, r) => {
    const rb = b.rings[r]
    if (!rb || ra.op !== rb.op || ra.nodes.length !== rb.nodes.length) {
      return false
    }
    return ra.nodes.every((n, i) => {
      const m = rb.nodes[i]
      return !!m && n.x === m.x && n.y === m.y && n.kind === m.kind
    })
  })
}

/** Fine mode engages after the finger holds this still… (AC-6) */
export const FINE_STILL_PX = 2
/** …for this long. */
export const FINE_HOLD_MS = 300
/** In fine mode the dots move this fraction of the finger's movement. */
export const FINE_FACTOR = 0.25

/** A dot drag in progress: plain data, advanced by `dragTo` (AC-3, AC-6). */
export interface DotDrag {
  readonly start: readonly Point[]
  readonly finger: Point
  /** CSS px per image px when the drag started. */
  readonly scale: number
  readonly fineEnabled: boolean
  /** Where and when the finger last moved more than 2 px. */
  readonly still: { pt: Point; t: number }
  /** The finger's last point, where the dots were last shown. */
  readonly last: Point
  /** Once fine mode is on: the finger and the dots at that moment. */
  readonly engaged: { finger: Point; dots: readonly Point[] } | null
}

export function startDrag(
  nodes: readonly Point[],
  fingerCanvasPt: Point,
  t: number,
  vp: Viewport,
  view: View,
  fineEnabled: boolean,
): DotDrag {
  return {
    start: nodes.map(({ x, y }) => ({ x, y })),
    finger: fingerCanvasPt,
    scale: viewScale(vp, view),
    fineEnabled,
    still: { pt: fingerCanvasPt, t },
    last: fingerCanvasPt,
    engaged: null,
  }
}

const moved = (dots: readonly Point[], dx: number, dy: number): Point[] =>
  dots.map((p) => ({ x: p.x + dx, y: p.y + dy }))

/** The dots for the finger at `pt`, one to one from where it went down (AC-3). */
const oneToOne = (drag: DotDrag, pt: Point): Point[] =>
  moved(
    drag.start,
    (pt.x - drag.finger.x) / drag.scale,
    (pt.y - drag.finger.y) / drag.scale,
  )

/**
 * The dots' positions for the finger at `fingerCanvasPt` at time `t` (ms).
 * They move by the finger's movement since it went down, in image px, so the
 * press slop isn't lost (AC-3). With fine mode allowed, once the finger has
 * stayed within 2 px for 300 ms, they move a quarter as far from there on
 * (AC-6). A still finger sends no events, so the hold is judged when the
 * next one comes, whatever its distance: fine mode engages at the finger's
 * last point, with the dots where they were shown, and this movement already
 * counts a quarter. Asked again at the same point (the canvas's timer), the
 * dots don't move. Positions are never rounded (AC-7).
 */
export function dragTo(
  drag: DotDrag,
  fingerCanvasPt: Point,
  t: number,
): { drag: DotDrag; positions: Point[]; fine: boolean } {
  let engaged = drag.engaged
  if (!engaged && drag.fineEnabled && t - drag.still.t >= FINE_HOLD_MS) {
    engaged = { finger: drag.last, dots: oneToOne(drag, drag.last) }
  }
  const still =
    dist(fingerCanvasPt, drag.still.pt) > FINE_STILL_PX
      ? { pt: fingerCanvasPt, t }
      : drag.still
  const next: DotDrag = { ...drag, still, last: fingerCanvasPt, engaged }
  if (!engaged) {
    return {
      drag: next,
      positions: oneToOne(next, fingerCanvasPt),
      fine: false,
    }
  }
  const k = FINE_FACTOR / drag.scale
  const positions = moved(
    engaged.dots,
    (fingerCanvasPt.x - engaged.finger.x) * k,
    (fingerCanvasPt.y - engaged.finger.y) * k,
  )
  return { drag: next, positions, fine: true }
}
