import type { Bounds, Node, Point } from '../geometry/types'
import { bounds, contains, signedArea } from '../geometry/polygon'
import type { Ring } from '../selection/types'
import { contourToNodes } from './dots'
import type { Contour } from './types'

/** Every contour point as a `corner` dot: the polygon of the trace itself. */
export const cornerNodes = (contour: Contour): Node[] =>
  contour.points.map(({ x, y }) => ({ x, y, kind: 'corner' }))

/**
 * How many other contours enclose each contour. Contours never cross, so one
 * probe point (the midpoint of the contour's first segment) decides. Only
 * contours whose bounds cover this one's are tested.
 */
export function nestingDepth(contours: readonly Contour[]): number[] {
  const boxes = contours.map((c) => bounds(c.points))
  return contours.map((c, k) => {
    const box = boxes[k] as Bounds
    const a = c.points[0] as Point
    const b = c.points[1] as Point
    const probe = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    let depth = 0
    for (const [m, other] of contours.entries()) {
      if (m === k || !covers(boxes[m] as Bounds, box)) continue
      if (contains(probe, other.points)) depth++
    }
    return depth
  })
}

const covers = (outer: Bounds, inner: Bounds): boolean =>
  outer.minX <= inner.minX &&
  outer.minY <= inner.minY &&
  outer.maxX >= inner.maxX &&
  outer.maxY >= inner.maxY

/**
 * Rings in nesting order (depth 0, then 1, …; trace order within a depth).
 * Outer contours (negative signed area, from `traceContours`) are `add`,
 * holes `subtract`. Nothing is dropped.
 */
export function contoursToRings(
  contours: readonly Contour[],
  toNodes: (contour: Contour) => Node[] = contourToNodes,
): Ring[] {
  const depth = nestingDepth(contours)
  return contours
    .map((c, k) => ({ c, depth: depth[k] as number, k }))
    .sort((p, q) => p.depth - q.depth || p.k - q.k)
    .map(({ c }) => ({
      op: signedArea(c.points) < 0 ? 'add' : 'subtract',
      nodes: toNodes(c),
    }))
}
