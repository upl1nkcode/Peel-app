import type { Point, Size } from '../geometry/types'
import type { BrushStroke } from '../selection/types'

/**
 * Brush strength at distance `d` from the stroke's polyline:
 * `1 − smoothstep(r·hardness − 0.5, r + 0.5, d)`. Full strength for
 * d ≤ r·hardness − 0.5, none for d ≥ r + 0.5.
 */
export function strokeStrength(
  d: number,
  radius: number,
  hardness: number,
): number {
  const e0 = radius * hardness - 0.5
  const e1 = radius + 0.5
  if (d <= e0) return 1
  if (d >= e1) return 0
  const t = (d - e0) / (e1 - e0)
  return 1 - t * t * (3 - 2 * t)
}

function distToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - a.x - t * dx, py - a.y - t * dy)
}

/** Pixel index range whose centres (i + 0.5) lie within [lo, hi], clipped to [0, n). */
function centreRange(lo: number, hi: number, n: number): [number, number] {
  return [
    Math.max(0, Math.ceil(lo - 0.5)),
    Math.min(n - 1, Math.floor(hi - 0.5)),
  ]
}

/** Slack on every span edge, so pixels on a boundary are evaluated rather than skipped. */
const SPAN_EPS = 1e-9

/** [x0, x1] on one pixel row; empty when x0 > x1. */
type Span = [number, number]

/** Narrows `span` to the x where lo ≤ coef·(x − ox) + off ≤ hi. */
function clip(
  span: Span,
  coef: number,
  ox: number,
  off: number,
  lo: number,
  hi: number,
): void {
  if (coef === 0) {
    if (off < lo || off > hi) span[1] = -Infinity
    return
  }
  const p = ox + (lo - off) / coef
  const q = ox + (hi - off) / coef
  span[0] = Math.max(span[0], Math.min(p, q))
  span[1] = Math.min(span[1], Math.max(p, q))
}

/** A polyline segment in its own frame: unit direction (ux, uy) and length. */
interface Seg {
  a: Point
  b: Point
  ux: number
  uy: number
  len: number
}

/** Narrows `span` on row `py` to points whose position along `seg` is in [lo, hi]. */
const clipAlong = (
  span: Span,
  seg: Seg,
  py: number,
  lo: number,
  hi: number,
) => {
  clip(span, seg.ux, seg.a.x, (py - seg.a.y) * seg.uy, lo, hi)
}
/** Narrows `span` on row `py` to points within `d` of the line through `seg`. */
const clipAcross = (span: Span, seg: Seg, py: number, d: number) => {
  clip(span, seg.uy, seg.a.x, -(py - seg.a.y) * seg.ux, -d, d)
}

/**
 * Applies the strokes to `coverage` in place, in order, with sizes and points
 * multiplied by `scale`. Each stroke's strength is the maximum over its
 * segments (so overlapping parts count once), then erase: m·(1 − a);
 * restore: m + a·(1 − m). Only pixels inside the image are touched.
 */
export function applyStrokes(
  coverage: Float32Array,
  size: Size,
  strokes: readonly BrushStroke[],
  scale = 1,
): void {
  const { width: w, height: h } = size
  for (const stroke of strokes) {
    const r = (stroke.sizePx * scale) / 2
    const reach = r + 0.5
    const core = r * stroke.hardness - 0.5
    const pts = stroke.points.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const [i0, i1] = centreRange(
      Math.min(...xs) - reach,
      Math.max(...xs) + reach,
      w,
    )
    const [j0, j1] = centreRange(
      Math.min(...ys) - reach,
      Math.max(...ys) + reach,
      h,
    )
    if (i1 < i0 || j1 < j0) continue
    const bw = i1 - i0 + 1
    const box = new Float32Array(bw * (j1 - j0 + 1))

    // Every pixel's nearest point on the stroke lies inside a segment (the
    // pixel projects onto that segment's body) or at a vertex (the pixel lies
    // in the wedge beyond both neighbouring segments). Evaluating each body
    // and each wedge, never the whole capsule of every segment, gives the
    // same minimum distance with each pixel looked at a few times only.
    const path = pts.filter(
      (p, k) =>
        k === 0 ||
        p.x !== (pts[k - 1] as Point).x ||
        p.y !== (pts[k - 1] as Point).y,
    )
    const segs: Seg[] = []
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k] as Point
      const b = path[k + 1] as Point
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      segs.push({ a, b, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, len })
    }
    const span: Span = [0, 0]
    const coreSpan: Span = [0, 0]
    const evaluate = (
      j: number,
      from: number,
      to: number,
      skipFrom: number,
      skipTo: number,
      dist: (x: number) => number,
    ) => {
      const row = (j - j0) * bw - i0
      for (let i = from; i <= to; i++) {
        if (i === skipFrom) {
          i = skipTo
          continue
        }
        if (box[row + i] === 1) continue // already full strength
        const v = strokeStrength(dist(i + 0.5), r, stroke.hardness)
        if (v > (box[row + i] as number)) box[row + i] = v
      }
    }

    for (const seg of segs) {
      const { a, b } = seg
      const [sj0, sj1] = centreRange(
        Math.min(a.y, b.y) - reach,
        Math.max(a.y, b.y) + reach,
        h,
      )
      for (let j = sj0; j <= sj1; j++) {
        const py = j + 0.5
        span[0] = -Infinity
        span[1] = Infinity
        clipAlong(span, seg, py, -SPAN_EPS, seg.len + SPAN_EPS)
        clipAcross(span, seg, py, reach + SPAN_EPS)
        if (!(span[0] <= span[1])) continue
        const [oi0, oi1] = centreRange(span[0], span[1], w)
        // Inside the full-strength core (d ≤ r·hardness − 0.5) the strength is exactly 1.
        let ci0 = oi1 + 1
        let ci1 = oi1
        if (core > SPAN_EPS) {
          coreSpan[0] = -Infinity
          coreSpan[1] = Infinity
          clipAlong(coreSpan, seg, py, SPAN_EPS, seg.len - SPAN_EPS)
          clipAcross(coreSpan, seg, py, core - SPAN_EPS)
          if (coreSpan[0] <= coreSpan[1]) {
            const [c0, c1] = centreRange(coreSpan[0], coreSpan[1], w)
            if (c0 <= c1) {
              const row = (j - j0) * bw - i0
              box.fill(1, row + c0, row + c1 + 1)
              ci0 = c0
              ci1 = c1
            }
          }
        }
        evaluate(j, oi0, oi1, ci0, ci1, (x) => distToSegment(x, py, a, b))
      }
    }

    for (let v = 0; v < path.length; v++) {
      const c = path[v] as Point
      const before = segs[v - 1]
      const after = segs[v]
      const [vj0, vj1] = centreRange(c.y - reach, c.y + reach, h)
      const rr = reach + SPAN_EPS
      for (let j = vj0; j <= vj1; j++) {
        const py = j + 0.5
        const dy = py - c.y
        if (Math.abs(dy) > rr) continue
        const half = Math.sqrt(rr * rr - dy * dy)
        span[0] = c.x - half
        span[1] = c.x + half
        // The wedge: beyond the end of the segment before, and before the start of the one after.
        if (before) clipAlong(span, before, py, before.len - SPAN_EPS, Infinity)
        if (after) clipAlong(span, after, py, -Infinity, SPAN_EPS)
        if (!(span[0] <= span[1])) continue
        const [oi0, oi1] = centreRange(span[0], span[1], w)
        evaluate(j, oi0, oi1, oi1 + 1, oi1, (x) => Math.hypot(x - c.x, dy))
      }
    }

    const erase = stroke.mode === 'erase'
    for (let j = j0; j <= j1; j++) {
      const row = (j - j0) * bw - i0
      for (let i = i0; i <= i1; i++) {
        const a = box[row + i] as number
        if (a === 0) continue
        const k = j * w + i
        const m = coverage[k] as number
        coverage[k] = erase ? m * (1 - a) : m + a * (1 - m)
      }
    }
  }
}
