import type { Point } from '../geometry/types'
import { signedArea } from '../geometry/polygon'
import { CONTOUR_LEVEL, type Contour, type CoverageMask } from './types'

const LEVEL_BITS = new Int32Array(
  new Float32Array([CONTOUR_LEVEL]).buffer,
)[0] as number

/**
 * Marching squares over pixel centres. The sample grid is padded by one ring
 * of zeros, so grid sample (X, Y) is pixel (X − 1, Y − 1), centred at
 * (X − 0.5, Y − 0.5). Edge ids: 2·(first sample index) + 0 for the edge to
 * the right, + 1 for the edge downward.
 *
 * Each contour has the selected side on its left in image coordinates
 * (y down), so outer contours have negative `signedArea` and holes positive.
 * Saddles join the selected corners when the mean of the four samples is
 * ≥ 0.5. Contours enclosing no area (e.g. a lone pixel of exactly 0.5) are
 * dropped. Each contour starts at its smallest (y, x) point; contours are
 * listed in order of those start points.
 */
export function traceContours(mask: CoverageMask): Contour[] {
  const { width: W, height: H, data } = mask
  const GW = W + 2
  const value = (X: number, Y: number): number =>
    X >= 1 && X <= W && Y >= 1 && Y <= H
      ? (data[(Y - 1) * W + X - 1] as number)
      : 0

  // For non-negative floats, v ≥ 0.5 exactly when the IEEE bit pattern is ≥
  // that of 0.5 (0x3F000000); negative values read as negative integers.
  const bits = new Int32Array(data.buffer, data.byteOffset, data.length)
  const next = new Map<number, number>()
  // Rows of the padded grid packed 32 samples per word: bit X set when selected.
  const NW = ((GW + 31) >>> 5) + 1
  let top = new Int32Array(NW)
  let bottom = new Int32Array(NW)
  const bit = (row: Int32Array, X: number): number =>
    ((row[X >>> 5] as number) >>> (X & 31)) & 1
  // Crossings in clockwise order around a cell (top, right, bottom, left).
  const corners = [0, 0, 0, 0]
  const ids = [0, 0, 0, 0]
  const edges = [0, 0, 0, 0]
  const entering = [false, false, false, false]

  const cell = (X: number, Y: number) => {
    corners[0] = bit(top, X)
    corners[1] = bit(top, X + 1)
    corners[2] = bit(bottom, X + 1)
    corners[3] = bit(bottom, X)
    const s = Y * GW + X
    ids[0] = 2 * s
    ids[1] = 2 * (s + 1) + 1
    ids[2] = 2 * (s + GW)
    ids[3] = 2 * s + 1
    let n = 0
    for (let k = 0; k < 4; k++) {
      const a = corners[k] as number
      const b = corners[(k + 1) % 4] as number
      if (a !== b) {
        edges[n] = ids[k] as number
        entering[n] = b === 1
        n++
      }
    }
    if (n === 2) {
      if (entering[0]) next.set(edges[0] as number, edges[1] as number)
      else next.set(edges[1] as number, edges[0] as number)
      return
    }
    // Saddle: crossings alternate exit/entry around the cell.
    const mean =
      (value(X, Y) + value(X + 1, Y) + value(X + 1, Y + 1) + value(X, Y + 1)) /
      4
    const joined = mean >= CONTOUR_LEVEL
    for (let k = 0; k < 4; k++) {
      if (!entering[k]) continue
      const exit = joined ? (k + 3) % 4 : (k + 1) % 4
      next.set(edges[k] as number, edges[exit] as number)
    }
  }

  for (let Y = 0; Y <= H; Y++) {
    ;[top, bottom] = [bottom, top]
    if (Y === 0) top.fill(0)
    bottom.fill(0)
    if (Y + 1 <= H) {
      const row = Y * W - 1
      for (let w = 0; w <= W >>> 5; w++) {
        const x0 = w << 5
        const hi = Math.min(W, x0 + 31)
        let word = 0
        for (let X = Math.max(1, x0); X <= hi; X++) {
          if ((bits[row + X] as number) >= LEVEL_BITS) word |= 1 << (X - x0)
        }
        bottom[w] = word
      }
    }
    // Cell X is active unless its four corners agree: tl ≠ tr, bl ≠ br or tl ≠ bl.
    for (let w = 0; w + 1 < NW; w++) {
      const t = top[w] as number
      const b = bottom[w] as number
      const hTop = t ^ ((t >>> 1) | ((top[w + 1] as number) << 31))
      const hBottom = b ^ ((b >>> 1) | ((bottom[w + 1] as number) << 31))
      let active = hTop | hBottom | (t ^ b)
      while (active !== 0) {
        const low = active & -active
        active ^= low
        const X = (w << 5) + 31 - Math.clz32(low)
        if (X <= W) cell(X, Y)
      }
    }
  }

  const crossing = (id: number): { p: Point; hard: boolean } => {
    const s = id >> 1
    const X = s % GW
    const Y = (s - X) / GW
    const down = (id & 1) === 1
    const a = value(X, Y)
    const b = down ? value(X, Y + 1) : value(X + 1, Y)
    const t = (CONTOUR_LEVEL - a) / (b - a)
    const hard = (a === 0 && b === 1) || (a === 1 && b === 0)
    const p = down
      ? { x: X - 0.5, y: Y - 0.5 + t }
      : { x: X - 0.5 + t, y: Y - 0.5 }
    return { p, hard }
  }

  const contours: Contour[] = []
  const visited = new Set<number>()
  for (const startId of next.keys()) {
    if (visited.has(startId)) continue
    const points: Point[] = []
    const hard: boolean[] = []
    let id = startId
    do {
      visited.add(id)
      const c = crossing(id)
      const last = points[points.length - 1]
      if (last && last.x === c.p.x && last.y === c.p.y) {
        hard[hard.length - 1] = (hard[hard.length - 1] as boolean) && c.hard
      } else {
        points.push(c.p)
        hard.push(c.hard)
      }
      id = next.get(id) as number
    } while (id !== startId)
    const first = points[0] as Point
    const last = points[points.length - 1] as Point
    if (points.length > 1 && first.x === last.x && first.y === last.y) {
      points.pop()
      hard[0] = (hard[0] as boolean) && (hard.pop() as boolean)
    }
    if (points.length < 3 || signedArea(points) === 0) continue
    contours.push(startAtSmallest(points, hard))
  }
  return contours.sort((a, b) =>
    compare(a.points[0] as Point, b.points[0] as Point),
  )
}

const compare = (p: Point, q: Point): number => p.y - q.y || p.x - q.x

function startAtSmallest(points: Point[], hard: boolean[]): Contour {
  let best = 0
  for (let k = 1; k < points.length; k++) {
    if (compare(points[k] as Point, points[best] as Point) < 0) best = k
  }
  return {
    points: [...points.slice(best), ...points.slice(0, best)],
    hard: [...hard.slice(best), ...hard.slice(0, best)],
  }
}
