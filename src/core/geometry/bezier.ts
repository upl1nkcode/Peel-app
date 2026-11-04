import type { BezierSegment, Node, Point } from './types'

/** Centripetal Catmull-Rom: knot spacing |Δ|^α with α = 0.5 (no cusps or self-loops within a segment). */
const ALPHA = 0.5

const xy = (p: Point): Point => ({ x: p.x, y: p.y })
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k })
const knot = (a: Point, b: Point): number =>
  Math.hypot(b.x - a.x, b.y - a.y) ** ALPHA

/** Handle one third of the way along the chord from `at` toward `toward`. */
const chordHandle = (at: Point, toward: Point): Point =>
  add(at, scale(sub(toward, at), 1 / 3))

/**
 * Incoming and outgoing handles of an interior node p1 between p0 and p2.
 * Smooth: both lie on the centripetal Catmull-Rom tangent, on opposite sides
 * of the node (C¹). Corner: each points along the chord to its neighbour.
 * Zero-length neighbours fall back to one-sided tangents, then to the node.
 */
function interiorHandles(
  p0: Point,
  p1: Node,
  p2: Point,
): { in: Point; out: Point } {
  if (p1.kind === 'corner') {
    return { in: chordHandle(p1, p0), out: chordHandle(p1, p2) }
  }
  const t01 = knot(p0, p1)
  const t12 = knot(p1, p2)
  let m: Point
  if (t01 === 0 && t12 === 0) m = { x: 0, y: 0 }
  else if (t01 === 0) m = scale(sub(p2, p1), 1 / t12)
  else if (t12 === 0) m = scale(sub(p1, p0), 1 / t01)
  else {
    m = add(
      sub(scale(sub(p1, p0), 1 / t01), scale(sub(p2, p0), 1 / (t01 + t12))),
      scale(sub(p2, p1), 1 / t12),
    )
  }
  return {
    in: sub(p1, scale(m, t01 / 3)),
    out: add(p1, scale(m, t12 / 3)),
  }
}

/**
 * One cubic Bézier per edge between nodes; the curve passes through every
 * node. Closed rings give n segments (the last ends at node 0), open paths
 * n − 1 whose end nodes have handles toward their single neighbour.
 * Fewer than 2 nodes give [].
 */
export function toBezierSegments(
  nodes: readonly Node[],
  closed: boolean,
): BezierSegment[] {
  const n = nodes.length
  if (n < 2) return []
  const at = (i: number): Node => nodes[(i + n) % n] as Node

  const handles = nodes.map((p, i) => {
    if (!closed && i === 0) return { in: xy(p), out: chordHandle(p, at(1)) }
    if (!closed && i === n - 1) {
      return { in: chordHandle(p, at(n - 2)), out: xy(p) }
    }
    return interiorHandles(at(i - 1), p, at(i + 1))
  })

  const count = closed ? n : n - 1
  return Array.from({ length: count }, (_, i) => {
    const j = (i + 1) % n
    return {
      p0: xy(at(i)),
      c1: (handles[i] as { out: Point }).out,
      c2: (handles[j] as { in: Point }).in,
      p3: xy(at(j)),
    }
  })
}

/**
 * Points along a cubic Bézier from p0 to p3 (both exact), consecutive samples
 * at most `maxStepPx` apart. Uniform in t with n = ⌈3·maxLeg / step⌉ because
 * the speed |B′(t)| never exceeds 3 × the longest control-polygon leg.
 */
export function sampleSegment(seg: BezierSegment, maxStepPx: number): Point[] {
  const leg = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
  const maxLeg = Math.max(
    leg(seg.p0, seg.c1),
    leg(seg.c1, seg.c2),
    leg(seg.c2, seg.p3),
  )
  const n = Math.max(1, Math.ceil((3 * maxLeg) / maxStepPx))
  const out: Point[] = [xy(seg.p0)]
  for (let i = 1; i < n; i++) out.push(pointOnSegment(seg, i / n))
  out.push(xy(seg.p3))
  return out
}

/** Point on a cubic Bézier at t ∈ [0, 1] (exact at t = 0 and t = 1). */
export function pointOnSegment(seg: BezierSegment, t: number): Point {
  const u = 1 - t
  const b0 = u * u * u
  const b1 = 3 * u * u * t
  const b2 = 3 * u * t * t
  const b3 = t * t * t
  return {
    x: b0 * seg.p0.x + b1 * seg.c1.x + b2 * seg.c2.x + b3 * seg.p3.x,
    y: b0 * seg.p0.y + b1 * seg.c1.y + b2 * seg.c2.y + b3 * seg.p3.y,
  }
}
