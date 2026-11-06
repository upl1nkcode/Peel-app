import { sampleSegment, toBezierSegments } from '../core/geometry/bezier'
import type { Node, Point } from '../core/geometry/types'
import type { Contour } from '../core/contour/types'

const STEP = 0.1
const SOFT = 0.5
const HARD = 1
const CELL = 2

interface Sample {
  p: Point
  tol: number
}

/**
 * Points along the closed contour, at most 0.1 px apart, each with its
 * segment's tolerance: hard only if both ends are hard, and with `widths`
 * (spec 0005 Decision 2) at most a quarter of the narrower end's width,
 * never below 0.1 px.
 */
function contourSamples(
  contour: Contour,
  widths?: readonly number[],
): Sample[] {
  const { points, hard } = contour
  const n = points.length
  const out: Sample[] = []
  const cap = (k: number) =>
    widths ? Math.max(0.1, (widths[k % n] as number) / 4) : Infinity
  for (let k = 0; k < n; k++) {
    const a = points[k] as Point
    const b = points[(k + 1) % n] as Point
    const base = hard[k] && hard[(k + 1) % n] ? HARD : SOFT
    const tol = Math.min(base, cap(k), cap(k + 1))
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP),
    )
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      out.push({
        p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        tol,
      })
    }
  }
  return out
}

class Grid<T extends { p: Point }> {
  private readonly cells = new Map<string, T[]>()
  constructor(items: readonly T[]) {
    for (const it of items) {
      const key = this.key(Math.floor(it.p.x / CELL), Math.floor(it.p.y / CELL))
      const list = this.cells.get(key)
      if (list) list.push(it)
      else this.cells.set(key, [it])
    }
  }
  private key(i: number, j: number): string {
    return `${String(i)},${String(j)}`
  }
  /** Nearest item within 2 cells (≥ 2 px); undefined when none. */
  nearest(p: Point): { item: T; d: number } | undefined {
    const ci = Math.floor(p.x / CELL)
    const cj = Math.floor(p.y / CELL)
    let best: { item: T; d: number } | undefined
    for (let j = cj - 2; j <= cj + 2; j++) {
      for (let i = ci - 2; i <= ci + 2; i++) {
        for (const it of this.cells.get(this.key(i, j)) ?? []) {
          const d = Math.hypot(it.p.x - p.x, it.p.y - p.y)
          if (!best || d < best.d) best = { item: it, d }
        }
      }
    }
    return best
  }
}

/**
 * Spec 0005 AC-9 oracle: the largest amount by which the drawn curve of
 * `nodes` and the traced `contour` exceed their tolerance of each other,
 * both ways, on samples at most 0.1 px apart (≤ 0 means pass). A contour
 * sample uses its own segment's tolerance; a curve sample uses the tolerance
 * of the nearest contour sample. Distances are sample to sample, so they
 * can only overstate the true distance: a pass is a real pass.
 */
export function curveExcess(
  contour: Contour,
  nodes: readonly Node[],
  widths?: readonly number[],
): number {
  const cs = contourSamples(contour, widths)
  const curve = toBezierSegments(nodes, true).flatMap((seg) =>
    sampleSegment(seg, STEP).map((p) => ({ p })),
  )
  const contourGrid = new Grid(cs)
  const curveGrid = new Grid(curve)
  let excess = -Infinity
  for (const s of cs) {
    const hit = curveGrid.nearest(s.p)
    excess = Math.max(excess, hit ? hit.d - s.tol : Infinity)
  }
  for (const c of curve) {
    const hit = contourGrid.nearest(c.p)
    excess = Math.max(excess, hit ? hit.d - hit.item.tol : Infinity)
  }
  return excess
}

/**
 * Distance from a point to the nearest traced contour (over all contours,
 * sampled every 0.1 px), and whether that nearest trace sample is on a hard
 * edge. Points farther than about 2 px get `Infinity`.
 */
export function traceDistance(
  contours: readonly Contour[],
): (p: Point) => { d: number; hard: boolean } {
  const samples = contours.flatMap((c) => contourSamples(c))
  const grid = new Grid(samples)
  return (p) => {
    const hit = grid.nearest(p)
    return hit
      ? { d: hit.d, hard: hit.item.tol === HARD }
      : { d: Infinity, hard: false }
  }
}
