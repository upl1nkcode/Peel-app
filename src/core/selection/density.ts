import { sampleSegment, toBezierSegments } from '../geometry/bezier'
import { simplifyPathIndices, simplifyRingIndices } from '../geometry/simplify'
import type { Node, Point } from '../geometry/types'

/** Curves are compared through samples at most this far apart (image px). */
export const DENSITY_SAMPLE_STEP = 0.1

/** Checks run at 95% of the tolerance: headroom for points between samples. */
const CHECK_MARGIN = 0.95

/** Safety stop for the repair loop; on hitting it the ring is left unchanged. */
const MAX_REPAIR_PASSES = 50

interface Dense {
  pts: Point[]
  /** Dense index of each node. */
  nodeAt: number[]
}

/** The closed curve through `nodes`, sampled; samples of segment i start at nodeAt[i]. */
function denseSamples(nodes: readonly Node[]): Dense {
  const pts: Point[] = []
  const nodeAt: number[] = []
  for (const seg of toBezierSegments(nodes, true)) {
    nodeAt.push(pts.length)
    const samples = sampleSegment(seg, DENSITY_SAMPLE_STEP)
    for (let i = 0; i < samples.length - 1; i++) pts.push(samples[i] as Point)
  }
  return { pts, nodeAt }
}

function segDistSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let ex = p.x - a.x
  let ey = p.y - a.y
  if (len2 !== 0) {
    const u = Math.min(1, Math.max(0, (ex * dx + ey * dy) / len2))
    ex -= u * dx
    ey -= u * dy
  }
  return ex * ex + ey * ey
}

/** Own cell first, then its 8 neighbours. */
const NEIGHBOURHOOD: readonly (readonly [number, number])[] = [
  [0, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]

const OFFSET = 2 ** 20
const cellKey = (cx: number, cy: number): number =>
  (cx + OFFSET) * 2 ** 21 + (cy + OFFSET)

/**
 * Uniform grid over the segments of a closed polyline, for "is p within
 * `limit`?" queries. The cell size is at least `limit`, so every segment
 * within `limit` of p touches p's cell or one of its 8 neighbours.
 */
class PolylineGrid {
  private readonly cells = new Map<number, number[]>()
  private readonly pts: readonly Point[]
  private readonly cell: number
  private readonly limitSq: number

  constructor(pts: readonly Point[], limit: number) {
    this.pts = pts
    const cell = Math.max(limit, 0.5)
    this.cell = cell
    this.limitSq = limit * limit
    const m = pts.length
    for (let i = 0; i < m; i++) {
      const a = pts[i] as Point
      const b = pts[(i + 1) % m] as Point
      const x1 = Math.floor(Math.max(a.x, b.x) / cell)
      const y0 = Math.floor(Math.min(a.y, b.y) / cell)
      const y1 = Math.floor(Math.max(a.y, b.y) / cell)
      for (let cx = Math.floor(Math.min(a.x, b.x) / cell); cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cellKey(cx, cy)
          const list = this.cells.get(key)
          if (list === undefined) this.cells.set(key, [i])
          else list.push(i)
        }
      }
    }
  }

  /**
   * 0 when some segment is within the limit of p (stops at the first one,
   * own cell first: this is the hot path); otherwise the distance to the
   * nearest segment in the 3×3 neighbourhood, or Infinity if there is none.
   */
  excess(p: Point): number {
    const m = this.pts.length
    const cx = Math.floor(p.x / this.cell)
    const cy = Math.floor(p.y / this.cell)
    let best = Infinity
    for (const [dx, dy] of NEIGHBOURHOOD) {
      const list = this.cells.get(cellKey(cx + dx, cy + dy))
      if (list === undefined) continue
      for (const i of list) {
        const d = segDistSq(
          p,
          this.pts[i] as Point,
          this.pts[(i + 1) % m] as Point,
        )
        if (d <= this.limitSq) return 0
        if (d < best) best = d
      }
    }
    return Math.sqrt(best)
  }
}

/** Indices from..to around a ring of length n, inclusive (from === to: full loop). */
function walk(n: number, from: number, to: number): number[] {
  const out = [from]
  for (let i = (from + 1) % n; ; i = (i + 1) % n) {
    out.push(i)
    if (i === to) return out
  }
}

const sortedUnique = (xs: readonly number[]): number[] =>
  [...new Set(xs)].sort((a, b) => a - b)

/** Dense index between kept[k] and kept[k+1] (wrapping), or null if they are adjacent. */
function midOfGap(
  kept: readonly number[],
  k: number,
  n: number,
): number | null {
  const a = kept[k] as number
  const b =
    k + 1 < kept.length ? (kept[k + 1] as number) : (kept[0] as number) + n
  if (b - a < 2) return null
  return Math.floor((a + b) / 2) % n
}

/**
 * Recomputes a ring's dots for a tolerance (image px) without changing its
 * shape by more than that: every point of the old drawn curve is within the
 * tolerance of the new curve and vice versa. Corner nodes are always kept,
 * exactly; other new dots are smooth and lie on the old curve.
 */
export function resimplifyRing(
  nodes: readonly Node[],
  tolerancePx: number,
): Node[] {
  const copy = (): Node[] =>
    nodes.map((p) => ({ x: p.x, y: p.y, kind: p.kind }))
  if (nodes.length < 3) return copy()
  const { pts, nodeAt } = denseSamples(nodes)
  const n = pts.length
  const isCorner = new Uint8Array(n)
  const corners: number[] = []
  nodes.forEach((p, i) => {
    if (p.kind === 'corner') {
      isCorner[nodeAt[i] as number] = 1
      corners.push(nodeAt[i] as number)
    }
  })
  const limit = tolerancePx * CHECK_MARGIN

  // 1. Pick dots with RDP on the dense samples; corners split the ring into spans.
  let kept: number[]
  if (corners.length === 0) {
    kept = sortedUnique(simplifyRingIndices(pts, limit))
  } else {
    const picked: number[] = []
    corners.forEach((start, k) => {
      const span = walk(n, start, corners[(k + 1) % corners.length] as number)
      const idx = simplifyPathIndices(
        span.map((i) => pts[i] as Point),
        limit,
      )
      for (const j of idx) picked.push(span[j] as number)
    })
    kept = sortedUnique(picked)
  }
  // Fewer than 3 dots only when the whole ring fits inside the tolerance of
  // its corner: add the middle of the widest gap. n ≥ 3 makes that gap ≥ 2
  // samples wide, so the middle is a new index and this terminates.
  while (kept.length < 3) {
    let start = 0
    let widest = -1
    kept.forEach((a, k) => {
      const b =
        k + 1 < kept.length ? (kept[k + 1] as number) : (kept[0] as number) + n
      if (b - a > widest) {
        widest = b - a
        start = a
      }
    })
    kept = sortedUnique([...kept, (start + Math.floor(widest / 2)) % n])
  }

  // 2. Repair: until both curves are within the limit of each other, add the
  //    worst old sample in every gap (between consecutive new dots) that fails.
  const oldGrid = new PolylineGrid(pts, limit)
  const toNodes = (idx: readonly number[]): Node[] =>
    idx.map((i) => {
      const p = pts[i] as Point
      return { x: p.x, y: p.y, kind: isCorner[i] === 1 ? 'corner' : 'smooth' }
    })

  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    const candidate = toNodes(kept)
    const fresh = denseSamples(candidate)
    const newGrid = new PolylineGrid(fresh.pts, limit)
    const k = kept.length
    const worst = new Map<number, { d: number; index: number | null }>()
    const flag = (gap: number, d: number, index: number | null): void => {
      const w = worst.get(gap)
      if (
        w === undefined ||
        (index !== null && (w.index === null || d > w.d))
      ) {
        worst.set(gap, { d, index })
      }
    }

    // old curve → new curve; old dense indices before kept[0] belong to the last gap
    for (let i = 0; i < n; i++) {
      const g = i < (kept[0] as number) ? k - 1 : upperGap(kept, i)
      const d = newGrid.excess(pts[i] as Point)
      if (d > 0 && isCorner[i] !== 1) flag(g, d, i)
    }

    // new curve → old curve
    for (let s = 0; s < k; s++) {
      const from = fresh.nodeAt[s] as number
      const to = s + 1 < k ? (fresh.nodeAt[s + 1] as number) : fresh.pts.length
      for (let j = from; j < to; j++) {
        const d = oldGrid.excess(fresh.pts[j] as Point)
        if (d > 0) {
          flag(s, d, null)
          break
        }
      }
    }

    if (worst.size === 0) return candidate
    const additions: number[] = []
    for (const [g, w] of worst) {
      const index = w.index ?? midOfGap(kept, g, n)
      if (index !== null && !kept.includes(index)) additions.push(index)
    }
    if (additions.length === 0) return copy()
    kept = sortedUnique([...kept, ...additions])
  }
  return copy()
}

/** The gap k with kept[k] ≤ i < kept[k+1], for i ≥ kept[0] (binary search). */
function upperGap(kept: readonly number[], i: number): number {
  let lo = 0
  let hi = kept.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((kept[mid] as number) <= i) lo = mid
    else hi = mid - 1
  }
  return lo
}
