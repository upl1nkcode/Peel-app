import type { Point } from '../core/geometry/types'

/** Clip a polygon to the half-plane where `inside` holds (one Sutherland–Hodgman pass). */
function clipEdge(
  poly: readonly Point[],
  inside: (p: Point) => boolean,
  cross: (a: Point, b: Point) => Point,
): Point[] {
  const out: Point[] = []
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k] as Point
    const b = poly[(k + 1) % poly.length] as Point
    const aIn = inside(a)
    const bIn = inside(b)
    if (aIn) out.push(a)
    if (aIn !== bIn) out.push(cross(a, b))
  }
  return out
}

const atX = (a: Point, b: Point, x: number): Point => ({
  x,
  y: a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x),
})
const atY = (a: Point, b: Point, y: number): Point => ({
  x: a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y),
  y,
})

/**
 * Exact area of a simple polygon inside pixel (i, j) = [i, i+1) × [j, j+1):
 * Sutherland–Hodgman clip to the square, then the shoelace formula.
 */
export function pixelArea(
  polygon: readonly Point[],
  i: number,
  j: number,
): number {
  let p: Point[] = [...polygon]
  p = clipEdge(
    p,
    (q) => q.x >= i,
    (a, b) => atX(a, b, i),
  )
  p = clipEdge(
    p,
    (q) => q.x <= i + 1,
    (a, b) => atX(a, b, i + 1),
  )
  p = clipEdge(
    p,
    (q) => q.y >= j,
    (a, b) => atY(a, b, j),
  )
  p = clipEdge(
    p,
    (q) => q.y <= j + 1,
    (a, b) => atY(a, b, j + 1),
  )
  let twice = 0
  for (let k = 0; k < p.length; k++) {
    const a = p[k] as Point
    const b = p[(k + 1) % p.length] as Point
    twice += a.x * b.y - b.x * a.y
  }
  return Math.abs(twice) / 2
}
