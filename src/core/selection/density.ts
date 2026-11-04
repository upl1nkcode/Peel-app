import { sampleSegment, toBezierSegments } from '../geometry/bezier'
import { simplifyPathIndices, simplifyRingIndices } from '../geometry/simplify'
import type { BezierSegment, Node, Point } from '../geometry/types'

/** Curves are compared through samples at most this far apart (image px). */
export const DENSITY_SAMPLE_STEP = 0.1

/**
 * Checks run at 95% of the tolerance: a little headroom for the curve between
 * samples (the guarantee itself is on curves sampled every 0.1 px, AC-21).
 */
const CHECK_MARGIN = 0.95

/** Safety stop for the repair loop; on hitting it the ring is left unchanged. */
const MAX_REPAIR_PASSES = 50

/** Sampling step of the local check while removing dots (a filter; `repair` re-checks at DENSITY_SAMPLE_STEP). */
const LOCAL_STEP = 0.25
/** Old samples (≤ 0.1 px apart) taken every 2nd in that check. */
const OLD_STRIDE = 2

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
 * Uniform grid over the segments of a polyline, for "is p within
 * `limit`?" queries. The cell size is at least `limit`, so every segment
 * within `limit` of p touches p's cell or one of its 8 neighbours.
 */
class PolylineGrid {
  private readonly cells = new Map<number, number[]>()
  private readonly pts: readonly Point[]
  private readonly cell: number
  private readonly limitSq: number

  constructor(pts: readonly Point[], limit: number, closed = true) {
    this.pts = pts
    const cell = Math.max(limit, 0.5)
    this.cell = cell
    this.limitSq = limit * limit
    const m = pts.length
    for (let i = 0; i < (closed ? m : m - 1); i++) {
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

interface Context {
  /** The old curve, sampled. */
  pts: Point[]
  /** Dense index of each old node. */
  nodeAt: number[]
  isCorner: Uint8Array
  limit: number
  oldGrid: PolylineGrid
}

const nodesAt = (ctx: Context, kept: readonly number[]): Node[] =>
  kept.map((i) => {
    const p = ctx.pts[i] as Point
    return {
      x: p.x,
      y: p.y,
      kind: ctx.isCorner[i] === 1 ? 'corner' : 'smooth',
    }
  })

/** Dots picked by RDP on the old curve's samples; corners split the ring into spans. */
function pickByRdp(ctx: Context, corners: readonly number[]): number[] {
  const n = ctx.pts.length
  let kept: number[]
  if (corners.length === 0) {
    kept = sortedUnique(simplifyRingIndices(ctx.pts, ctx.limit))
  } else {
    const picked: number[] = []
    corners.forEach((start, k) => {
      const span = walk(n, start, corners[(k + 1) % corners.length] as number)
      const idx = simplifyPathIndices(
        span.map((i) => ctx.pts[i] as Point),
        ctx.limit,
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
  return kept
}

/** `count` samples of `pts` from `start` (wrapping), every `stride`-th; the last is always included. */
interface Run {
  pts: readonly Point[]
  start: number
  count: number
  stride: number
}

const whole = (pts: readonly Point[]): Run => ({
  pts,
  start: 0,
  count: pts.length,
  stride: 1,
})
const runLength = (run: Run): number =>
  Math.ceil((run.count - 1) / run.stride) + 1
const runAt = (run: Run, t: number): Point =>
  run.pts[
    (run.start + Math.min(t * run.stride, run.count - 1)) % run.pts.length
  ] as Point

/**
 * Whether every point of `from` is within `limitSq` (squared) of the open
 * polyline `to`, both ordered the same way along the outline. A pointer walks
 * along `to` to each point's nearest segment; a miss is re-checked against
 * every segment, so the walk only ever saves time.
 */
function followsWithin(from: Run, to: Run, limitSq: number): boolean {
  const last = runLength(to) - 1
  const distAt = (j: number, p: Point): number =>
    segDistSq(p, runAt(to, j), runAt(to, Math.min(j + 1, last)))
  const fromLength = runLength(from)
  let j = 0
  for (let t = 0; t < fromLength; t++) {
    const p = runAt(from, t)
    let d = distAt(j, p)
    while (j + 1 < last) {
      const next = distAt(j + 1, p)
      if (next > d) break
      d = next
      j++
    }
    if (d <= limitSq) continue
    let near = false
    for (let i = 0; i < last && !near; i++) near = distAt(i, p) <= limitSq
    if (!near) return false
  }
  return true
}

/**
 * Whether removing the dot just before `cand[r]` keeps the curve close to the
 * old one. Removing a dot changes the 3 segments around it (its neighbours'
 * handles move). Checked locally and conservatively, as a filter: those
 * segments against the old curve around them, and the old samples they span
 * against the new curve around them. `repair` then checks the whole ring at
 * the full sampling density.
 */
function removalHolds(
  ctx: Context,
  nodes: readonly Node[],
  cand: readonly number[],
  r: number,
): boolean {
  const m = cand.length
  const n = ctx.pts.length
  const wrap = (k: number): number => (((r + k) % m) + m) % m
  const node = (k: number): Node => nodes[cand[wrap(k)] as number] as Node
  /** Old samples from cand[r + fromK] to cand[r + toK], every OLD_STRIDE-th. */
  const oldSpan = (fromK: number, toK: number): Run => {
    const from = ctx.nodeAt[cand[wrap(fromK)] as number] as number
    const to = ctx.nodeAt[cand[wrap(toK)] as number] as number
    return {
      pts: ctx.pts,
      start: from,
      count: ((to - from + n) % n) + 1,
      stride: OLD_STRIDE,
    }
  }

  if (m < 8) {
    // Small ring: the whole new curve, against grids over whole curves.
    const all = toBezierSegments(
      cand.map((i) => nodes[i] as Node),
      true,
    )
    const fresh: Point[] = []
    for (const seg of all) {
      fresh.push(...sampleSegment(seg, DENSITY_SAMPLE_STEP).slice(0, -1))
    }
    if (fresh.some((p) => ctx.oldGrid.excess(p) > 0)) return false
    const grid = new PolylineGrid(fresh, ctx.limit)
    return ctx.pts.every((p) => grid.excess(p) === 0)
  }

  // Segment k runs from cand[r + k] to cand[r + k + 1]. Its handles depend
  // only on the nodes next to its ends, so for k in -3..1 the open path
  // through cand[r - 4 .. r + 3] gives the same segments as the whole ring.
  const segs = toBezierSegments(
    Array.from({ length: 8 }, (_, i) => node(i - 4)),
    false,
  )
  const local: Point[] = []
  const changed: Point[] = []
  for (let k = -3; k <= 1; k++) {
    const samples = sampleSegment(segs[k + 4] as BezierSegment, LOCAL_STEP)
    if (k >= -2 && k <= 0) changed.push(...samples)
    local.push(...(k === -3 ? samples : samples.slice(1)))
  }
  const limitSq = ctx.limit * ctx.limit
  return (
    followsWithin(whole(changed), oldSpan(-3, 2), limitSq) &&
    followsWithin(oldSpan(-2, 1), whole(local), limitSq)
  )
}

/** Old-node indices: the old dots minus every smooth dot that can go while the curve holds. */
function removeDots(ctx: Context, nodes: readonly Node[]): number[] {
  let cand = nodes.map((_, i) => i)
  let removed = true
  while (removed && cand.length > 3) {
    removed = false
    for (let r = 0; r < cand.length && cand.length > 3;) {
      if ((nodes[cand[r] as number] as Node).kind === 'corner') {
        r++
        continue
      }
      const next = cand.filter((_, k) => k !== r)
      if (removalHolds(ctx, nodes, next, r % next.length)) {
        cand = next
        removed = true
      } else r++
    }
  }
  return cand
}

/**
 * Adds dots (old-curve samples) until both curves are within the limit of
 * each other: in every gap between consecutive new dots that fails, the worst
 * old sample. Null if it cannot finish (the caller then keeps the ring).
 */
function repair(ctx: Context, start: readonly number[]): Node[] | null {
  const { pts, isCorner, limit, oldGrid } = ctx
  const n = pts.length
  let kept = [...start]
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    const candidate = nodesAt(ctx, kept)
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
    if (additions.length === 0) return null
    kept = sortedUnique([...kept, ...additions])
  }
  return null
}

/**
 * Recomputes a ring's dots for a tolerance (image px) without changing its
 * shape by more than that: every point of the old drawn curve is within the
 * tolerance of the new curve and vice versa. Corner nodes are always kept,
 * exactly; other new dots are smooth and lie on the old curve.
 *
 * Two candidates: dots picked afresh by RDP (more dots at small tolerances),
 * and the old dots with every removable smooth dot taken out (hand-placed
 * dots are often already efficient, and RDP's picks would need more). If an
 * old dot can go, the candidate with fewer dots wins; otherwise the RDP one,
 * so a smaller tolerance still gives more dots.
 */
export function resimplifyRing(
  nodes: readonly Node[],
  tolerancePx: number,
): Node[] {
  const copy = (): Node[] =>
    nodes.map((p) => ({ x: p.x, y: p.y, kind: p.kind }))
  if (nodes.length < 3) return copy()
  const { pts, nodeAt } = denseSamples(nodes)
  const isCorner = new Uint8Array(pts.length)
  const corners: number[] = []
  nodes.forEach((p, i) => {
    if (p.kind === 'corner') {
      isCorner[nodeAt[i] as number] = 1
      corners.push(nodeAt[i] as number)
    }
  })
  const limit = tolerancePx * CHECK_MARGIN
  const ctx: Context = {
    pts,
    nodeAt,
    isCorner,
    limit,
    oldGrid: new PolylineGrid(pts, limit),
  }

  const picked = pickByRdp(ctx, corners)
  // RDP spaces dots for this tolerance. Wanting more than the ring has, the
  // ring is coarser than asked: give RDP's denser dots.
  if (picked.length > nodes.length) return repair(ctx, picked) ?? copy()
  // Otherwise: the fewest dots that still hold the curve.
  let best = copy()
  const pruned = removeDots(ctx, nodes)
  if (pruned.length < nodes.length) {
    const fewer = repair(
      ctx,
      pruned.map((i) => nodeAt[i] as number),
    )
    if (fewer !== null && fewer.length < best.length) best = fewer
  }
  // Repair only adds dots, so RDP can win only if its picks are fewer already.
  if (picked.length < best.length) {
    const fresh = repair(ctx, picked)
    if (fresh !== null && fresh.length < best.length) best = fresh
  }
  return best
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
