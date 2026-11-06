import type { Point } from '../geometry/types'
import type { Contour } from './types'

/** On thin parts the tolerance is at most this × the local width (spec 0005 Decision 2)… */
export const THIN_PART_FRACTION = 0.25
/** …and never below this. */
export const MIN_TOLERANCE_PX = 0.1

/**
 * Widths beyond this cannot lower any tolerance (the largest is 1 px, which a
 * quarter of 4 px already allows), so the search stops here: they read as
 * Infinity.
 */
const SEARCH_PX = 4
const CELL = 2

/**
 * Width across each traced point (spec 0005 Decision 2), over all contours of
 * the mask: the distance to the nearest traced line across from it. That is a
 * segment of another contour, or of the same contour farther along it (either
 * way round) than twice the distance plus 1 px, so neighbours along the same
 * edge do not count. Infinity when nothing is within 4 px.
 */
export function localWidths(contours: readonly Contour[]): number[][] {
  // Every segment on a 2 px grid: [contour, index] pairs.
  const cells = new Map<number, number[]>()
  const key = (i: number, j: number) => i * 131_071 + j
  const cums = contours.map(arcLengths)
  for (const [ci, c] of contours.entries()) {
    const n = c.points.length
    for (let k = 0; k < n; k++) {
      const a = c.points[k] as Point
      const b = c.points[(k + 1) % n] as Point
      const i1 = Math.floor(Math.max(a.x, b.x) / CELL)
      const j1 = Math.floor(Math.max(a.y, b.y) / CELL)
      for (let i = Math.floor(Math.min(a.x, b.x) / CELL); i <= i1; i++) {
        for (let j = Math.floor(Math.min(a.y, b.y) / CELL); j <= j1; j++) {
          const list = cells.get(key(i, j))
          if (list) list.push(ci, k)
          else cells.set(key(i, j), [ci, k])
        }
      }
    }
  }

  return contours.map((c, ci) => {
    const n = c.points.length
    const cum = cums[ci] as number[]
    const perimeter = cum[n] as number
    return c.points.map((p, k) => {
      let best = Infinity
      const r = SEARCH_PX
      for (
        let i = Math.floor((p.x - r) / CELL);
        i <= Math.floor((p.x + r) / CELL);
        i++
      ) {
        for (
          let j = Math.floor((p.y - r) / CELL);
          j <= Math.floor((p.y + r) / CELL);
          j++
        ) {
          const list = cells.get(key(i, j))
          if (!list) continue
          for (let e = 0; e < list.length; e += 2) {
            const cj = list[e] as number
            const kj = list[e + 1] as number
            const other = contours[cj] as Contour
            const m = other.points.length
            const a = other.points[kj] as Point
            const b = other.points[(kj + 1) % m] as Point
            const { d, t } = project(p, a, b)
            if (d >= best || d > SEARCH_PX) continue
            if (cj === ci) {
              const lenAB = Math.hypot(b.x - a.x, b.y - a.y)
              const along = Math.abs(
                (cum[kj] as number) + t * lenAB - (cum[k] as number),
              )
              const arc = Math.min(along, perimeter - along)
              if (arc <= 2 * d + 1) continue
            }
            best = d
          }
        }
      }
      return best
    })
  })
}

/** Cumulative arc length at each point, closing back to point 0 at index n. */
function arcLengths(c: Contour): number[] {
  const n = c.points.length
  const cum = [0]
  for (let k = 0; k < n; k++) {
    const a = c.points[k] as Point
    const b = c.points[(k + 1) % n] as Point
    cum.push((cum[k] as number) + Math.hypot(b.x - a.x, b.y - a.y))
  }
  return cum
}

/** Distance from p to segment ab, and where along it (0..1) the nearest point lies. */
function project(p: Point, a: Point, b: Point): { d: number; t: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return { d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t }
}
