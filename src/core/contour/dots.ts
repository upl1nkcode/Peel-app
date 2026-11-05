import { sampleSegment, toBezierSegments } from '../geometry/bezier'
import type { BezierSegment, Node, Point } from '../geometry/types'
import { cornerFrame, findCorners, pointAtArc, smoothHard } from './corners'
import type { Contour } from './types'

/** The drawn curve stays within this of the traced line on soft edges… */
export const DOT_TOLERANCE_PX = 0.5
/** …and within this along hard edges (between exact 0 and 1 values). */
export const HARD_EDGE_TOLERANCE_PX = 1

/** Curve checks sample every this many px (spec 0005 AC-9). */
const STEP = 0.1
/**
 * Checked against tolerance − margin: AC-9 measures between samples ≤ 0.1 px
 * apart, which can overstate a distance by up to half a step.
 */
const MARGIN = 0.06
/**
 * First placement: a chord may stray this many × its tolerance from the
 * trace. Catmull-Rom curves hug arcs far closer than chords do, so 2 gives
 * the fewest dots; the curve check below adds any that are still needed.
 */
const CHORD_FRACTION = 2

const hypot = (ax: number, ay: number) => Math.sqrt(ax * ax + ay * ay)

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segDistXY(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return hypot(px - ax - t * dx, py - ay - t * dy)
}

const segDist = (p: Point, a: Point, b: Point): number =>
  segDistXY(p.x, p.y, a.x, a.y, b.x, b.y)

/** Nearest segment of a polyline: its index and the distance. */
function nearestOnPolyline(
  p: Point,
  poly: readonly Point[],
): { k: number; d: number } {
  let best = { k: 0, d: Infinity }
  for (let k = 0; k + 1 < poly.length; k++) {
    const d = segDist(p, poly[k] as Point, poly[k + 1] as Point)
    if (d < best.d) best = { k, d }
  }
  if (poly.length === 1) {
    const q = poly[0] as Point
    best = { k: 0, d: hypot(p.x - q.x, p.y - q.y) }
  }
  return best
}

/** Intersection of line ab with line cd, or undefined when (nearly) parallel. */
function intersect(a: Point, b: Point, c: Point, d: Point): Point | undefined {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const vx = d.x - c.x
  const vy = d.y - c.y
  const den = ux * vy - uy * vx
  if (Math.abs(den) < 1e-9 * hypot(ux, uy) * hypot(vx, vy)) return undefined
  const t = ((c.x - a.x) * vy - (c.y - a.y) * vx) / den
  return { x: a.x + t * ux, y: a.y + t * uy }
}

/**
 * Dots along one contour (spec 0005 Decisions 2–3): corner dots where it
 * turns sharply, placed where the two edges meet when that point is within
 * tolerance of the trace; smooth dots elsewhere, added until the drawn curve
 * is within 0.5 px of the trace (1 px along hard edges) both ways.
 */
export function contourToNodes(contour: Contour): Node[] {
  const { points, hard } = contour
  const n = points.length
  const vertexTol = (k: number) =>
    hard[k % n] ? HARD_EDGE_TOLERANCE_PX : DOT_TOLERANCE_PX
  const segTol = (k: number) =>
    hard[k % n] && hard[(k + 1) % n] ? HARD_EDGE_TOLERANCE_PX : DOT_TOLERANCE_PX
  const at = (k: number) => points[k % n] as Point
  // Smooth dots on hard edges sit on the staircase smoothed once: closer to the true shape.
  const placed = smoothHard(points, hard)
  const place = (k: number) => placed[k % n] as Point

  // 1. Corners, each moved to where its two edges meet when that stays within tolerance.
  const corners = findCorners(points, hard)
  const frame = cornerFrame(points, hard)
  const cornerAt = new Map<number, Point>()
  for (const k of corners) cornerAt.set(k, cornerPosition(k))

  /**
   * Soft corners move to where the two edges (1–2 px either side) meet. Hard
   * corners stay on the trace: extending a pixel staircase across one step
   * tilts the edge by up to ~15°, which misplaces the meeting point more than
   * the trace itself (≤ 0.7 px from the true corner).
   */
  function cornerPosition(k: number): Point {
    const raw = at(k)
    if (hard[k] === true) return raw
    const c = frame.cum[k] as number
    const s = frame.soft
    const p = (d: number) => pointAtArc(frame.points, frame.cum, c + d)
    const q = intersect(p(-s), p(-s / 2), p(s / 2), p(s))
    if (!q || hypot(q.x - raw.x, q.y - raw.y) > s) return raw
    // The meeting point must stay within tolerance of the trace near the corner.
    const near: Point[] = []
    for (let d = -6; d <= 6; d++) near.push(at(k + d + n))
    return nearestOnPolyline(q, near).d <= vertexTol(k) - MARGIN ? q : raw
  }

  // 2. Anchors: the corners, or two far-apart points on a ring without them.
  let anchors = [...corners]
  if (anchors.length < 2) {
    const from = anchors[0] ?? 0
    let far = from
    let best = -1
    for (let k = 0; k < n; k++) {
      const d = hypot(at(k).x - at(from).x, at(k).y - at(from).y)
      if (d > best) {
        best = d
        far = k
      }
    }
    anchors = [...new Set([from, far])].sort((a, b) => a - b)
  }

  // 3. Within each span, step forward as far as the chord stays close to the trace.
  const chosen = new Set(anchors)
  const fits = (a: number, b: number): boolean => {
    for (let k = a + 1; k < b; k++) {
      if (
        segDist(place(k), place(a), place(b)) >
        CHORD_FRACTION * vertexTol(k)
      ) {
        return false
      }
    }
    return true
  }
  for (const [i, a] of anchors.entries()) {
    const next = anchors[(i + 1) % anchors.length] as number
    const end = next > a ? next : next + n
    let pos = a
    while (pos < end) {
      // Exponential then binary search for the farthest fitting chord end.
      let good = pos + 1
      let bad = -1
      for (let step = 2; ; step *= 2) {
        const e = Math.min(end, pos + step)
        if (!fits(pos, e)) {
          bad = e
          break
        }
        good = e
        if (e === end) break
      }
      if (bad > 0) {
        while (bad - good > 1) {
          const mid = (good + bad) >> 1
          if (fits(pos, mid)) good = mid
          else bad = mid
        }
      }
      if (good < end) chosen.add(good % n)
      pos = good
    }
  }

  // 4. A ring needs 3 dots: add the point farthest from the existing ones.
  while (chosen.size < Math.min(3, n)) {
    let far = 0
    let best = -1
    for (let k = 0; k < n; k++) {
      if (chosen.has(k)) continue
      let d = Infinity
      for (const c of chosen)
        d = Math.min(d, hypot(at(k).x - at(c).x, at(k).y - at(c).y))
      if (d > best) {
        best = d
        far = k
      }
    }
    chosen.add(far)
  }

  // 5. Check the drawn curve gap by gap; insert a dot where it strays.
  let dots = [...chosen].sort((a, b) => a - b)
  const toNodes = (): Node[] =>
    dots.map((k) => {
      const c = cornerAt.get(k)
      return c
        ? { x: c.x, y: c.y, kind: 'corner' }
        : { x: place(k).x, y: place(k).y, kind: 'smooth' }
    })
  let dirty = new Set(dots.map((_, g) => g))
  while (dirty.size > 0) {
    const segments = toBezierSegments(toNodes(), true)
    const inserts: number[] = []
    for (const g of dirty) {
      const a = dots[g] as number
      const b0 = dots[(g + 1) % dots.length] as number
      const b = b0 > a ? b0 : b0 + n
      const worst = checkGap(segments[g] as BezierSegment, a, b)
      if (worst !== undefined) inserts.push(worst % n)
    }
    if (inserts.length === 0) break
    const next = [...new Set([...dots, ...inserts])].sort((x, y) => x - y)
    const added = new Set(inserts)
    dirty = new Set()
    for (const [g, k] of next.entries()) {
      if (!added.has(k)) continue
      for (let d = -2; d <= 1; d++)
        dirty.add((g + d + next.length) % next.length)
    }
    dots = next
  }
  return toNodes()

  /**
   * The contour index (strictly between a and b) to insert when the curve of
   * this gap strays from the trace from a to b, or undefined when it does not
   * (or there is no point to insert).
   */
  function checkGap(
    seg: BezierSegment,
    a: number,
    b: number,
  ): number | undefined {
    const m = b - a // trace segments
    const tx = new Float64Array(m + 1)
    const ty = new Float64Array(m + 1)
    for (let k = 0; k <= m; k++) {
      tx[k] = at(a + k).x
      ty[k] = at(a + k).y
    }
    const curve = sampleSegment(seg, STEP)
    const nc = curve.length
    const cx = new Float64Array(nc)
    const cy = new Float64Array(nc)
    for (const [i, c] of curve.entries()) {
      cx[i] = c.x
      cy[i] = c.y
    }
    let worstExcess = 0
    let worstX = 0
    let worstY = 0

    // Both lines run the same way, so each sample first searches a small
    // window around the previous nearest segment. A window distance can only
    // overstate the true one, so a pass is exact; a window result over the
    // tolerance is confirmed by a full scan until the gap is known to fail,
    // after which window distances only steer where the next dot goes.
    const nearestTrace = (x: number, y: number, from: number, to: number) => {
      let d = Infinity
      let k = from
      for (let j = Math.max(0, from); j <= Math.min(m - 1, to); j++) {
        const dj = segDistXY(
          x,
          y,
          tx[j] as number,
          ty[j] as number,
          tx[j + 1] as number,
          ty[j + 1] as number,
        )
        if (dj < d) {
          d = dj
          k = j
        }
      }
      return { d, k }
    }
    const nearestCurve = (x: number, y: number, from: number, to: number) => {
      let d = Infinity
      let k = from
      if (nc === 1)
        return {
          d: Math.hypot(x - (cx[0] as number), y - (cy[0] as number)),
          k: 0,
        }
      for (let j = Math.max(0, from); j <= Math.min(nc - 2, to); j++) {
        const dj = segDistXY(
          x,
          y,
          cx[j] as number,
          cy[j] as number,
          cx[j + 1] as number,
          cy[j + 1] as number,
        )
        if (dj < d) {
          d = dj
          k = j
        }
      }
      return { d, k }
    }
    const gap = { failing: false }
    const record = (e: number, x: number, y: number) => {
      if (e > 0) gap.failing = true
      if (e > worstExcess) {
        worstExcess = e
        worstX = x
        worstY = y
      }
    }

    // Curve → trace: each curve sample within the tolerance of its nearest trace segment.
    let tp = 0
    for (let i = 0; i < nc; i++) {
      const x = cx[i] as number
      const y = cy[i] as number
      let hit = nearestTrace(x, y, tp - 3, tp + 3)
      if (!gap.failing && hit.d > segTol(a + hit.k) - MARGIN) {
        hit = nearestTrace(x, y, 0, m - 1)
      }
      tp = hit.k
      record(hit.d - (segTol(a + hit.k) - MARGIN), x, y)
    }
    // Trace → curve: samples along each trace segment within that segment's tolerance.
    let cp = 0
    for (let k = 0; k < m; k++) {
      const px = tx[k] as number
      const py = ty[k] as number
      const qx = tx[k + 1] as number
      const qy = ty[k + 1] as number
      const tol = segTol(a + k) - MARGIN
      const steps = Math.max(1, Math.ceil(hypot(qx - px, qy - py) / STEP))
      for (let s = k === 0 ? 0 : 1; s <= steps; s++) {
        const t = s / steps
        const x = px + (qx - px) * t
        const y = py + (qy - py) * t
        let hit = nearestCurve(x, y, cp - 8, cp + 8)
        if (!gap.failing && hit.d > tol) hit = nearestCurve(x, y, 0, nc - 2)
        cp = hit.k
        record(hit.d - tol, x, y)
      }
    }
    if (!gap.failing || b - a < 2) return undefined
    const worstAt = { x: worstX, y: worstY }
    // Insert the interior trace point nearest the worst sample.
    let pick = a + 1
    let best = Infinity
    for (let k = a + 1; k < b; k++) {
      const d = hypot(at(k).x - worstAt.x, at(k).y - worstAt.y)
      if (d < best) {
        best = d
        pick = k
      }
    }
    return pick
  }
}
