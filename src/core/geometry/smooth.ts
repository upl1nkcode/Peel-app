import type { Point } from './types'

/** Number of Chaikin iterations. 0 leaves the ring unchanged. */
export type SmoothStrength = 0 | 1 | 2 | 3 | 4

/**
 * Chaikin corner cutting on a closed ring: every edge (a, b) becomes the two
 * points at ¼ and ¾ along it, repeated `strength` times (n → n·2ᵏ points).
 * Each output point is a convex combination of input points, so the result
 * never leaves the input's bounds. It does round sharp corners slightly.
 */
export function smoothRing(
  ring: readonly Point[],
  strength: SmoothStrength,
): Point[] {
  let current = ring.map((p) => ({ x: p.x, y: p.y }))
  for (let k = 0; k < strength; k++) {
    const n = current.length
    const next: Point[] = []
    for (let i = 0; i < n; i++) {
      const a = current[i] as Point
      const b = current[(i + 1) % n] as Point
      next.push(
        { x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y },
        { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y },
      )
    }
    current = next
  }
  return current
}

/**
 * Chaikin corner cutting on an open path, keeping its two ends (spec 0011
 * AC-15): every edge becomes the points at ¼ and ¾ along it, and the first
 * and last points stay, so sections still meet where they did. Strength 0
 * returns the input unchanged.
 */
export function smoothPath(
  path: readonly Point[],
  strength: SmoothStrength,
): Point[] {
  let current = path.map((p) => ({ x: p.x, y: p.y }))
  if (current.length < 3) return current
  for (let k = 0; k < strength; k++) {
    const n = current.length
    const next: Point[] = [current[0] as Point]
    for (let i = 0; i + 1 < n; i++) {
      const a = current[i] as Point
      const b = current[i + 1] as Point
      next.push(
        { x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y },
        { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y },
      )
    }
    next.push(current[n - 1] as Point)
    current = next
  }
  return current
}
