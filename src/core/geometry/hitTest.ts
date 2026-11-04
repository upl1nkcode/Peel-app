import { imageToCanvas } from '../coords/transform'
import type { View, Viewport } from '../coords/types'
import type { Point } from './types'

/** Default touch radius in canvas CSS px (constant on screen at any zoom). */
export const TOUCH_RADIUS_PX = 22

export interface NodeHit {
  index: number
  distancePx: number
}

export interface EdgeHit {
  edgeIndex: number
  /** Arc-length fraction along the edge, in [0, 1]. */
  t: number
  /** Closest point on the edge, in image px. */
  imagePt: Point
  distancePx: number
}

const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)

const lerp = (a: Point, b: Point, u: number): Point => ({
  x: a.x + (b.x - a.x) * u,
  y: a.y + (b.y - a.y) * u,
})

/** Parameter in [0, 1] of the point on segment ab closest to p (0 for a zero-length segment). */
function projectOnSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return 0
  const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  return Math.min(1, Math.max(0, u))
}

/** Nearest node within `radiusPx` screen px of `canvasPt`; ties go to the lowest index. */
export function nearestNode(
  nodes: readonly Point[],
  canvasPt: Point,
  vp: Viewport,
  view: View,
  radiusPx = TOUCH_RADIUS_PX,
): NodeHit | null {
  let best: NodeHit | null = null
  nodes.forEach((imagePt, index) => {
    const d = dist(imageToCanvas(vp, view, imagePt), canvasPt)
    if (d <= radiusPx && (best === null || d < best.distancePx)) {
      best = { index, distancePx: d }
    }
  })
  return best
}

/** Closest point on one polyline, measured in canvas px. */
function closestOnEdge(
  edge: readonly Point[],
  canvasPt: Point,
  vp: Viewport,
  view: View,
): Omit<EdgeHit, 'edgeIndex'> | null {
  const first = edge[0]
  if (first === undefined) return null
  if (edge.length === 1) {
    return {
      t: 0,
      imagePt: { ...first },
      distancePx: dist(imageToCanvas(vp, view, first), canvasPt),
    }
  }
  const canvasPts = edge.map((p) => imageToCanvas(vp, view, p))
  let total = 0
  let bestD = Infinity
  let bestArc = 0
  let bestPt: Point = first
  for (let i = 0; i + 1 < edge.length; i++) {
    const a = edge[i] as Point
    const b = edge[i + 1] as Point
    const ca = canvasPts[i] as Point
    const cb = canvasPts[i + 1] as Point
    const segLen = dist(a, b)
    // The transform is a uniform scale plus translation, so u is the same in both spaces.
    const u = projectOnSegment(canvasPt, ca, cb)
    const d = dist(lerp(ca, cb, u), canvasPt)
    if (d < bestD) {
      bestD = d
      bestArc = total + u * segLen
      bestPt = lerp(a, b, u)
    }
    total += segLen
  }
  return {
    t: total === 0 ? 0 : bestArc / total,
    imagePt: bestPt,
    distancePx: bestD,
  }
}

/**
 * Nearest edge (a polyline in image px) within `radiusPx` screen px of
 * `canvasPt`; ties go to the lowest edge index, then the earliest segment.
 */
export function nearestEdge(
  edges: readonly (readonly Point[])[],
  canvasPt: Point,
  vp: Viewport,
  view: View,
  radiusPx = TOUCH_RADIUS_PX,
): EdgeHit | null {
  let best: EdgeHit | null = null
  edges.forEach((edge, edgeIndex) => {
    const hit = closestOnEdge(edge, canvasPt, vp, view)
    if (
      hit !== null &&
      hit.distancePx <= radiusPx &&
      (best === null || hit.distancePx < best.distancePx)
    ) {
      best = { edgeIndex, ...hit }
    }
  })
  return best
}
