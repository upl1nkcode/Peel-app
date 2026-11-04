import type { Bounds, Point } from './types'

/**
 * Rings are `Point[]` with an implicit closing edge from last to first.
 * In image space (y down) a positive signed area means clockwise on screen.
 */

/**
 * Absolute tolerance (image px) for "on the boundary". Rounding error for a
 * point computed on an edge near 1e4 px is ~1e-12, far below this; a point
 * 1e-6 px outside is outside at any edge length.
 */
const BOUNDARY_EPSILON = 1e-9

/**
 * Shoelace sum ½ Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ). For a self-intersecting ring, lobes
 * wound in opposite directions cancel (a figure-8 gives 0).
 */
export function signedArea(ring: readonly Point[]): number {
  const n = ring.length
  if (n < 3) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Point
    const b = ring[(i + 1) % n] as Point
    sum += a.x * b.y - b.x * a.y
  }
  // Normalise -0 to 0.
  return sum / 2 + 0
}

export function area(ring: readonly Point[]): number {
  return Math.abs(signedArea(ring))
}

/** Throws `RangeError` for an empty ring. */
export function bounds(ring: readonly Point[]): Bounds {
  const first = ring[0]
  if (first === undefined) throw new RangeError('bounds of an empty ring')
  const b: Bounds = {
    minX: first.x,
    minY: first.y,
    maxX: first.x,
    maxY: first.y,
  }
  for (const p of ring) {
    b.minX = Math.min(b.minX, p.x)
    b.minY = Math.min(b.minY, p.y)
    b.maxX = Math.max(b.maxX, p.x)
    b.maxY = Math.max(b.maxY, p.y)
  }
  return b
}

/** As seen on screen (y down). Zero area counts as `'cw'`. */
export function orientation(ring: readonly Point[]): 'cw' | 'ccw' {
  return signedArea(ring) < 0 ? 'ccw' : 'cw'
}

/** z-component of (b − a) × (p − a); its sign tells which side of a→b the point p is on. */
const cross = (a: Point, b: Point, p: Point): number =>
  (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)

function onSegment(p: Point, a: Point, b: Point): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return p.x === a.x && p.y === a.y
  const u = Math.min(
    1,
    Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
  )
  const d = Math.hypot(a.x + u * dx - p.x, a.y + u * dy - p.y)
  return d <= BOUNDARY_EPSILON
}

/** Fewer than 3 points, or every point on one line (encloses nothing). */
function isDegenerate(ring: readonly Point[]): boolean {
  const p0 = ring[0]
  if (ring.length < 3 || p0 === undefined) return true
  const p1 = ring.find((p) => p.x !== p0.x || p.y !== p0.y)
  if (p1 === undefined) return true
  return ring.every((p) => cross(p0, p1, p) === 0)
}

/**
 * Nonzero winding rule (matches the renderer), boundary inclusive.
 * Degenerate rings contain nothing.
 */
export function contains(point: Point, ring: readonly Point[]): boolean {
  if (isDegenerate(ring)) return false
  const n = ring.length
  let winding = 0
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Point
    const b = ring[(i + 1) % n] as Point
    if (onSegment(point, a, b)) return true
    if (a.y <= point.y) {
      if (b.y > point.y && cross(a, b, point) > 0) winding++
    } else if (b.y <= point.y && cross(a, b, point) < 0) {
      winding--
    }
  }
  return winding !== 0
}
