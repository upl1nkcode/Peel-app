import { toBezierSegments } from '../geometry/bezier'
import type { BezierSegment, Node, Point } from '../geometry/types'

/** Maximum distance between a flattened outline and its Bézier curve, in output px. */
export const FLATTEN_TOLERANCE = 0.05
/** Guard against runaway subdivision (2^24 pieces per segment is far past any real curve). */
const MAX_DEPTH = 24

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

const mid = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
})

/**
 * Appends the end points of chords approximating `seg`, excluding p0.
 * A piece is flat when both control points are within the tolerance of the
 * chord segment; the curve lies in the control points' convex hull, so it is
 * then within the tolerance of the chord too.
 */
function flattenSegment(seg: BezierSegment, out: Point[], depth: number): void {
  if (
    depth >= MAX_DEPTH ||
    (distToSegment(seg.c1, seg.p0, seg.p3) <= FLATTEN_TOLERANCE &&
      distToSegment(seg.c2, seg.p0, seg.p3) <= FLATTEN_TOLERANCE)
  ) {
    out.push(seg.p3)
    return
  }
  // de Casteljau split at t = 0.5: the split point lies on the curve.
  const ab = mid(seg.p0, seg.c1)
  const bc = mid(seg.c1, seg.c2)
  const cd = mid(seg.c2, seg.p3)
  const abc = mid(ab, bc)
  const bcd = mid(bc, cd)
  const m = mid(abc, bcd)
  flattenSegment({ p0: seg.p0, c1: ab, c2: abc, p3: m }, out, depth + 1)
  flattenSegment({ p0: m, c1: bcd, c2: cd, p3: seg.p3 }, out, depth + 1)
}

/**
 * The ring's closed curve as a polyline within `FLATTEN_TOLERANCE` px, with
 * coordinates multiplied by `scale`. The first point is node 0 and is not
 * repeated at the end. Corner-only rings give exactly their nodes.
 */
export function flattenRing(nodes: readonly Node[], scale = 1): Point[] {
  const s = (p: Point): Point => ({ x: p.x * scale, y: p.y * scale })
  const segs = toBezierSegments(nodes, true)
  const first = segs[0]
  if (first === undefined) return []
  const out: Point[] = [s(first.p0)]
  for (const seg of segs) {
    flattenSegment(
      { p0: s(seg.p0), c1: s(seg.c1), c2: s(seg.c2), p3: s(seg.p3) },
      out,
      0,
    )
  }
  out.pop() // the last chord ends back at node 0
  return out
}
