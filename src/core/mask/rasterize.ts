import type { Point, Size } from '../geometry/types'
import type { Ring } from '../selection/types'
import { flattenRing } from './flatten'

/** Sub-rows sampled per pixel row; each contributes exact horizontal coverage. */
export const SUBROWS = 256

/** Sorted, non-overlapping [start, end) intervals in a reusable buffer. */
class Intervals {
  s: Float64Array
  e: Float64Array
  n = 0
  constructor(capacity: number) {
    this.s = new Float64Array(capacity)
    this.e = new Float64Array(capacity)
  }
  push(start: number, end: number): void {
    if (end <= start) return
    this.s[this.n] = start
    this.e[this.n] = end
    this.n++
  }
}

/** One ring's edges, sorted by top y, scanned top to bottom with an active list. */
class RingScan {
  readonly count: number
  readonly minY: number
  readonly maxY: number
  private readonly y0: Float64Array
  private readonly y1: Float64Array
  private readonly x0: Float64Array
  private readonly dxdy: Float64Array
  private readonly dir: Int8Array
  private readonly active: Int32Array
  private readonly xs: Float64Array
  private readonly ds: Int8Array
  private next = 0
  private activeCount = 0

  constructor(pts: readonly Point[]) {
    const edges: {
      y0: number
      y1: number
      x0: number
      dxdy: number
      dir: number
    }[] = []
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k] as Point
      const b = pts[(k + 1) % pts.length] as Point
      if (a.y === b.y) continue // horizontal or zero-length: never crosses a sub-row
      const [lo, hi, dir] = a.y < b.y ? [a, b, 1] : [b, a, -1]
      edges.push({
        y0: lo.y,
        y1: hi.y,
        x0: lo.x,
        dxdy: (hi.x - lo.x) / (hi.y - lo.y),
        dir,
      })
    }
    edges.sort((p, q) => p.y0 - q.y0)
    const n = edges.length
    this.count = n
    this.y0 = new Float64Array(n)
    this.y1 = new Float64Array(n)
    this.x0 = new Float64Array(n)
    this.dxdy = new Float64Array(n)
    this.dir = new Int8Array(n)
    let minY = Infinity
    let maxY = -Infinity
    edges.forEach((e, k) => {
      this.y0[k] = e.y0
      this.y1[k] = e.y1
      this.x0[k] = e.x0
      this.dxdy[k] = e.dxdy
      this.dir[k] = e.dir
      minY = Math.min(minY, e.y0)
      maxY = Math.max(maxY, e.y1)
    })
    this.minY = minY
    this.maxY = maxY
    this.active = new Int32Array(n)
    this.xs = new Float64Array(n)
    this.ds = new Int8Array(n)
  }

  /**
   * Writes the intervals where the ring's winding number is non-zero on the
   * horizontal line `y` (nonzero rule). An edge counts for y0 ≤ y < y1, so a
   * line through a vertex counts each crossing once. Calls must have
   * non-decreasing `y`.
   */
  scan(y: number, out: Intervals): void {
    out.n = 0
    if (y < this.minY || y >= this.maxY) return
    while (this.next < this.count && (this.y0[this.next] as number) <= y) {
      this.active[this.activeCount++] = this.next++
    }
    // Drop finished edges and insertion-sort the rest by x, moving the active
    // list along with xs/ds. The list stays in x order between sub-rows and
    // crossings barely move from one sub-row to the next, so the sort is
    // close to linear instead of quadratic in the number of crossings.
    let m = 0
    for (let k = 0; k < this.activeCount; k++) {
      const e = this.active[k] as number
      if ((this.y1[e] as number) <= y) continue
      const x =
        (this.x0[e] as number) +
        (y - (this.y0[e] as number)) * (this.dxdy[e] as number)
      let p = m++
      while (p > 0 && (this.xs[p - 1] as number) > x) {
        this.xs[p] = this.xs[p - 1] as number
        this.ds[p] = this.ds[p - 1] as number
        this.active[p] = this.active[p - 1] as number
        p--
      }
      this.xs[p] = x
      this.ds[p] = this.dir[e] as number
      this.active[p] = e
    }
    this.activeCount = m
    let winding = 0
    let start = 0
    for (let k = 0; k < m; k++) {
      const before = winding
      winding += this.ds[k] as number
      if (before === 0 && winding !== 0) start = this.xs[k] as number
      else if (before !== 0 && winding === 0)
        out.push(start, this.xs[k] as number)
    }
  }
}

/** a ∪ b into out (all sorted, non-overlapping); touching intervals merge, so shared edges leave no seam. */
function union(a: Intervals, b: Intervals, out: Intervals): void {
  out.n = 0
  let i = 0
  let j = 0
  while (i < a.n || j < b.n) {
    let s: number
    let e: number
    if (j >= b.n || (i < a.n && (a.s[i] as number) <= (b.s[j] as number))) {
      s = a.s[i] as number
      e = a.e[i++] as number
    } else {
      s = b.s[j] as number
      e = b.e[j++] as number
    }
    if (out.n > 0 && s <= (out.e[out.n - 1] as number)) {
      out.e[out.n - 1] = Math.max(out.e[out.n - 1] as number, e)
    } else {
      out.push(s, e)
    }
  }
}

/** a − b into out (all sorted, non-overlapping). */
function difference(a: Intervals, b: Intervals, out: Intervals): void {
  out.n = 0
  let j = 0
  for (let i = 0; i < a.n; i++) {
    let s = a.s[i] as number
    const e = a.e[i] as number
    while (j < b.n && (b.e[j] as number) <= s) j++
    let k = j
    while (k < b.n && (b.s[k] as number) < e) {
      out.push(s, b.s[k] as number)
      s = Math.max(s, b.e[k] as number)
      if (s >= e) break
      k++
    }
    out.push(s, e)
  }
}

/**
 * Anti-aliased coverage (0..1) of the rings, `size.width × size.height`,
 * with ring coordinates multiplied by `scale`. Each pixel row is sampled on
 * `SUBROWS` sub-rows; on each, every ring's inside intervals (nonzero rule)
 * are folded in order (add = union, subtract = difference) and the exact
 * horizontal overlap of the result with each pixel is added.
 * Nothing outside the image is written.
 */
export function rasterizeRings(
  rings: readonly Ring[],
  size: Size,
  scale = 1,
): Float32Array {
  const { width: w, height: h } = size
  const out = new Float32Array(w * h)
  const scans = rings.map((r) => new RingScan(flattenRing(r.nodes, scale)))
  const ops = rings.map((r) => r.op)
  const capacity = scans.reduce((s, r) => s + r.count, 0) + 1
  let ring = new Intervals(capacity)
  let acc = new Intervals(capacity)
  let spare = new Intervals(capacity)

  const minY = Math.min(...scans.map((r) => r.minY))
  const maxY = Math.max(...scans.map((r) => r.maxY))
  const jStart = Math.max(0, Math.floor(minY))
  const jEnd = Math.min(h, Math.ceil(maxY))

  const cov = new Float64Array(w + 1)
  const diff = new Float64Array(w + 1)
  const weight = 1 / SUBROWS

  for (let j = jStart; j < jEnd; j++) {
    cov.fill(0)
    diff.fill(0)
    for (let s = 0; s < SUBROWS; s++) {
      const y = j + (s + 0.5) / SUBROWS
      acc.n = 0
      // Fold in order: add = union, subtract = difference. A scan may be
      // skipped (nothing to subtract from); it catches up on its next call.
      for (let r = 0; r < scans.length; r++) {
        const subtract = ops[r] === 'subtract'
        if (subtract && acc.n === 0) continue
        ;(scans[r] as RingScan).scan(y, ring)
        if (ring.n === 0) continue
        if (acc.n === 0) {
          // Nothing to combine with: the ring's intervals are the result.
          ;[acc, ring] = [ring, acc]
          continue
        }
        if (subtract) difference(acc, ring, spare)
        else union(acc, ring, spare)
        ;[acc, spare] = [spare, acc]
      }
      for (let k = 0; k < acc.n; k++) {
        const a = Math.max(0, acc.s[k] as number)
        const b = Math.min(w, acc.e[k] as number)
        if (b <= a) continue
        const ia = Math.floor(a)
        const ib = Math.floor(b)
        if (ia === ib) {
          cov[ia] = (cov[ia] as number) + (b - a) * weight
          continue
        }
        cov[ia] = (cov[ia] as number) + (ia + 1 - a) * weight
        diff[ia + 1] = (diff[ia + 1] as number) + weight
        diff[ib] = (diff[ib] as number) - weight
        if (ib < w) cov[ib] = (cov[ib] as number) + (b - ib) * weight
      }
    }
    let run = 0
    const base = j * w
    for (let i = 0; i < w; i++) {
      run += diff[i] as number
      const v = (cov[i] as number) + run
      out[base + i] = v <= 0 ? 0 : v >= 1 ? 1 : v
    }
  }
  return out
}
