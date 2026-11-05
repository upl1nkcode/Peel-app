import type { Point } from '../geometry/types'
import { signedArea } from '../geometry/polygon'
import { CONTOUR_LEVEL, type Contour, type CoverageMask } from './types'

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

  const next = new Map<number, number>()
  let top = new Uint8Array(GW)
  let bottom = new Uint8Array(GW)
  // Crossings in clockwise order around a cell (top, right, bottom, left).
  const edges = [0, 0, 0, 0]
  const entering = [false, false, false, false]

  for (let Y = 0; Y <= H; Y++) {
    ;[top, bottom] = [bottom, top]
    if (Y === 0) top.fill(0)
    bottom.fill(0)
    if (Y + 1 <= H) {
      const row = Y * W
      for (let X = 1; X <= W; X++) {
        bottom[X] = (data[row + X - 1] as number) >= CONTOUR_LEVEL ? 1 : 0
      }
    }
    for (let X = 0; X <= W; X++) {
      const tl = top[X] as number
      const tr = top[X + 1] as number
      const br = bottom[X + 1] as number
      const bl = bottom[X] as number
      const sum = tl + tr + br + bl
      if (sum === 0 || sum === 4) continue

      const s = Y * GW + X
      const corners = [tl, tr, br, bl]
      const ids = [2 * s, 2 * (s + 1) + 1, 2 * (s + GW), 2 * s + 1]
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
        const [entry, exit] = entering[0]
          ? [edges[0], edges[1]]
          : [edges[1], edges[0]]
        next.set(entry as number, exit as number)
        continue
      }
      // Saddle: crossings alternate exit/entry around the cell.
      const mean =
        (value(X, Y) +
          value(X + 1, Y) +
          value(X + 1, Y + 1) +
          value(X, Y + 1)) /
        4
      const joined = mean >= CONTOUR_LEVEL
      for (let k = 0; k < 4; k++) {
        if (!entering[k]) continue
        const exit = joined ? (k + 3) % 4 : (k + 1) % 4
        next.set(edges[k] as number, edges[exit] as number)
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
