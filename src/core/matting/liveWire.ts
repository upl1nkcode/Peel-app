import type { Point } from '../geometry/types'
import type { EdgeMap } from './edges'

/** Added to every step's cost so that, among equally strong edges, the shorter path wins. */
const LENGTH_COST = 0.05

/** Index of the rect pixel containing p, or RangeError when p is outside the rect. */
function pixelOf(map: EdgeMap, p: Point, name: string): number {
  const { x, y, width, height } = map.rect
  const i = Math.floor(p.x) - x
  const j = Math.floor(p.y) - y
  if (
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.y) ||
    i < 0 ||
    j < 0 ||
    i >= width ||
    j >= height
  ) {
    throw new RangeError(`${name} is outside the edge map`)
  }
  return j * width + i
}

/** A binary min-heap of pixel indices keyed by path cost, on typed arrays. */
class Heap {
  private ids = new Int32Array(1024)
  private keys = new Float64Array(1024)
  size = 0

  push(id: number, key: number): void {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.size * 2)
      const keys = new Float64Array(this.size * 2)
      ids.set(this.ids)
      keys.set(this.keys)
      this.ids = ids
      this.keys = keys
    }
    let i = this.size++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((this.keys[parent] as number) <= key) break
      this.ids[i] = this.ids[parent] as number
      this.keys[i] = this.keys[parent] as number
      i = parent
    }
    this.ids[i] = id
    this.keys[i] = key
  }

  /** Removes the smallest entry; its id and key are left in `topId` / `topKey`. */
  topId = 0
  topKey = 0
  pop(): void {
    this.topId = this.ids[0] as number
    this.topKey = this.keys[0] as number
    const last = --this.size
    const id = this.ids[last] as number
    const key = this.keys[last] as number
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      if (l >= last) break
      const r = l + 1
      const c =
        r < last && (this.keys[r] as number) < (this.keys[l] as number) ? r : l
      if ((this.keys[c] as number) >= key) break
      this.ids[i] = this.ids[c] as number
      this.keys[i] = this.keys[c] as number
      i = c
    }
    this.ids[i] = id
    this.keys[i] = key
  }
}

/**
 * Cheapest 8-connected path of pixel centres from the pixel containing `from`
 * to the pixel containing `to` (spec 0006 AC-4, AC-6). A step into pixel q
 * costs (cost(q) + 0.05) × its length (1 or √2). `allowed` (over map.rect,
 * 1 = may pass) limits the search; both ends must be allowed.
 */
export function liveWire(
  map: EdgeMap,
  from: Point,
  to: Point,
  allowed?: Uint8Array,
): Point[] {
  const { width, height } = map.rect
  const start = pixelOf(map, from, 'from')
  const goal = pixelOf(map, to, 'to')
  if (allowed && (allowed[start] !== 1 || allowed[goal] !== 1)) {
    throw new RangeError('from and to must be in the allowed area')
  }
  const n = width * height
  const dist = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const heap = new Heap()
  dist[start] = 0
  heap.push(start, 0)
  while (heap.size > 0) {
    heap.pop()
    const k = heap.topId
    const d = heap.topKey
    if (d > (dist[k] as number)) continue
    if (k === goal) break
    const i = k % width
    const j = (k - i) / width
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj
      if (jj < 0 || jj >= height) continue
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue
        const ii = i + di
        if (ii < 0 || ii >= width) continue
        const q = jj * width + ii
        if (allowed && allowed[q] !== 1) continue
        const step = di !== 0 && dj !== 0 ? Math.SQRT2 : 1
        const nd = d + ((map.cost[q] as number) + LENGTH_COST) * step
        if (nd < (dist[q] as number)) {
          dist[q] = nd
          prev[q] = k
          heap.push(q, nd)
        }
      }
    }
  }
  const path: Point[] = []
  for (let k = goal; k !== -1; k = prev[k] as number) {
    const i = k % width
    path.push({
      x: map.rect.x + i + 0.5,
      y: map.rect.y + (k - i) / width + 0.5,
    })
  }
  return path.reverse()
}

/** Edge strength at a point (image px), bilinear over pixel centres, clamped to the rect. */
function strengthAt(map: EdgeMap, x: number, y: number): number {
  const { width, height } = map.rect
  const fx = Math.min(width - 1, Math.max(0, x - map.rect.x - 0.5))
  const fy = Math.min(height - 1, Math.max(0, y - map.rect.y - 0.5))
  const i0 = Math.min(width - 2, Math.floor(fx))
  const j0 = Math.min(height - 2, Math.floor(fy))
  if (i0 < 0 || j0 < 0) {
    // A rect one pixel wide or tall: nearest sample.
    return map.strength[Math.round(fy) * width + Math.round(fx)] as number
  }
  const tx = fx - i0
  const ty = fy - j0
  const s = map.strength
  const k = j0 * width + i0
  return (
    (1 - ty) * ((1 - tx) * (s[k] as number) + tx * (s[k + 1] as number)) +
    ty *
      ((1 - tx) * (s[k + width] as number) + tx * (s[k + width + 1] as number))
  )
}

/**
 * Moves each point across the edge to the peak of edge strength (spec 0006
 * Decision 5): a parabola through the strength 1 px either side along the
 * edge normal. Points where the strength does not peak stay put; no point
 * moves more than 1 px.
 */
export function refineSubpixel(map: EdgeMap, path: readonly Point[]): Point[] {
  return path.map((p) => {
    const k = pixelOf(map, p, 'path point')
    const nx = map.normalX[k] as number
    const ny = map.normalY[k] as number
    const before = strengthAt(map, p.x - nx, p.y - ny)
    const here = strengthAt(map, p.x, p.y)
    const after = strengthAt(map, p.x + nx, p.y + ny)
    const den = before - 2 * here + after
    if (!(den < 0)) return { x: p.x, y: p.y }
    const t = Math.max(-1, Math.min(1, (0.5 * (before - after)) / den))
    return { x: p.x + t * nx, y: p.y + t * ny }
  })
}
