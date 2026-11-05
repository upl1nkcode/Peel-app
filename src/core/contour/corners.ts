import type { Point } from '../geometry/types'

/** Soft edges: a dot is a corner when the outline turns by at least this much… */
export const CORNER_ANGLE_DEG = 45
/** …between the chords to the contour points this far before and after it (arc length). */
export const CORNER_SUPPORT_PX = 2
/** Hard edges: at least this much, after one smoothing pass over the hard points… */
export const HARD_CORNER_ANGLE_DEG = 50
/** …between the edge directions from 4 px to 1 px of arc before the dot and from 1 px to 4 px after it. */
export const HARD_CORNER_SUPPORT_PX = 4
export const HARD_CORNER_GAP_PX = 1

const EPS = 1e-9
const rad = (deg: number) => (deg * Math.PI) / 180

/** Cumulative arc length of a closed polyline: `cum[k]` at point k, `cum[n]` = perimeter. */
export function arcTable(points: readonly Point[]): Float64Array {
  const n = points.length
  const cum = new Float64Array(n + 1)
  for (let k = 0; k < n; k++) {
    const a = points[k] as Point
    const b = points[(k + 1) % n] as Point
    cum[k + 1] = (cum[k] as number) + Math.hypot(b.x - a.x, b.y - a.y)
  }
  return cum
}

/** The point at arc length `s` (any real; wraps around the closed polyline). */
export function pointAtArc(
  points: readonly Point[],
  cum: Float64Array,
  s: number,
): Point {
  const n = points.length
  const perimeter = cum[n] as number
  let a = s % perimeter
  if (a < 0) a += perimeter
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((cum[mid] as number) <= a) lo = mid
    else hi = mid
  }
  const p = points[lo] as Point
  const q = points[(lo + 1) % n] as Point
  const len = (cum[lo + 1] as number) - (cum[lo] as number)
  const t = len > 0 ? (a - (cum[lo] as number)) / len : 0
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
}

/** One pass of ½ itself + ¼ each neighbour over the hard points; soft points stay put. */
export function smoothHard(
  points: readonly Point[],
  hard: readonly boolean[],
): Point[] {
  const n = points.length
  return points.map((v, k) => {
    if (!hard[k]) return v
    const a = points[(k + n - 1) % n] as Point
    const b = points[(k + 1) % n] as Point
    return { x: v.x / 2 + (a.x + b.x) / 4, y: v.y / 2 + (a.y + b.y) / 4 }
  })
}

/** Unsigned angle between two direction vectors, in radians. */
function angle(ux: number, uy: number, vx: number, vy: number): number {
  return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy))
}

/** Where and how the turn at each point is measured (spec 0005 Decision 3). */
export interface CornerFrame {
  /** Points the turn is measured on: hard points smoothed once. */
  points: Point[]
  cum: Float64Array
  /** Support (arc length) for soft and hard points, shrunk on short rings. */
  soft: number
  hard: number
  /** Hard gap: the edge directions start this far from the dot. */
  gap: number
}

export function cornerFrame(
  points: readonly Point[],
  hard: readonly boolean[],
): CornerFrame {
  const smoothed = hard.some(Boolean) ? smoothHard(points, hard) : [...points]
  const cum = arcTable(smoothed)
  const quarter = (cum[smoothed.length] as number) / 4
  const hardSupport = Math.min(HARD_CORNER_SUPPORT_PX, quarter / 2)
  return {
    points: smoothed,
    cum,
    soft: Math.min(CORNER_SUPPORT_PX, quarter),
    hard: hardSupport,
    gap: Math.min(HARD_CORNER_GAP_PX, hardSupport / 4),
  }
}

/** The two edge lines meeting at point k: [a, b] before it and [c, d] after it. */
export function edgeLines(
  frame: CornerFrame,
  k: number,
  isHard: boolean,
): [Point, Point, Point, Point] {
  const { points, cum } = frame
  const at = cum[k] as number
  const s = isHard ? frame.hard : frame.soft
  const g = isHard ? frame.gap : 0
  const p = (d: number) => pointAtArc(points, cum, at + d)
  return [p(-s), p(-g), p(g), p(s)]
}

/**
 * Indices (ascending) of the contour points where the outline turns
 * sharply (spec 0005 Decision 3). Soft points: ≥ 45° between the chords to
 * the points 2 px of arc before and after. Hard points: ≥ 50° between the
 * edge directions from 4 px to 1 px before and from 1 px to 4 px after, on
 * the contour with its hard points smoothed once. That hard turn is flat for
 * about ±1 px around a corner, so candidates are ranked by the chord turn over
 * the same support (which peaks at the corner itself): of candidates closer
 * than 2 px along the arc (shrunk on short rings), only the highest-ranked
 * survives (ties: the smaller index).
 */
export function findCorners(
  points: readonly Point[],
  hard: readonly boolean[] = [],
): number[] {
  const n = points.length
  if (n < 3) return []
  const frame = cornerFrame(points, hard)
  const perimeter = frame.cum[n] as number
  const rank = new Float64Array(n)
  const candidates: number[] = []
  for (let k = 0; k < n; k++) {
    const isHard = hard[k] === true
    const [a, b, c, d] = edgeLines(frame, k, isHard)
    const t = angle(b.x - a.x, b.y - a.y, d.x - c.x, d.y - c.y)
    const min = rad(isHard ? HARD_CORNER_ANGLE_DEG : CORNER_ANGLE_DEG)
    if (t < min - EPS) continue
    candidates.push(k)
    const p = frame.points[k] as Point
    rank[k] = isHard ? angle(p.x - a.x, p.y - a.y, d.x - p.x, d.y - p.y) : t
  }
  const m = candidates.length
  const arcGap = (a: number, b: number): number => {
    const d = Math.abs((frame.cum[a] as number) - (frame.cum[b] as number))
    return Math.min(d, perimeter - d)
  }
  const beats = (j: number, k: number): boolean =>
    (rank[j] as number) > (rank[k] as number) ||
    ((rank[j] as number) === (rank[k] as number) && j < k)
  return candidates.filter((k, c) => {
    for (const dir of [1, -1]) {
      for (let step = 1; step < m; step++) {
        const j = candidates[(((c + dir * step) % m) + m) % m] as number
        if (arcGap(j, k) >= frame.soft - EPS) break
        if (beats(j, k)) return false
      }
    }
    return true
  })
}
