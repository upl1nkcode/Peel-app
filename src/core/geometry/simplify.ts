import type { Point } from './types'

/**
 * Ramer–Douglas–Peucker. Epsilon is in image px (sub-pixel allowed). A point is
 * kept when its distance to the current chord *segment* exceeds epsilon, so
 * every removed point is within epsilon of the output polyline (a point beyond
 * a chord's end, like a hairpin tip, is measured to the nearer endpoint).
 * Iterative: no recursion depth limit. Distances are compared squared
 * (Math.hypot is slow and the comparison is monotonic).
 */

function distToSegmentSq(p: Point, a: Point, b: Point): number {
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

const copy = (p: Point): Point => ({ x: p.x, y: p.y })

/** Simplifies an open path; both endpoints are always kept. */
export function simplifyPath(path: readonly Point[], epsilon: number): Point[] {
  return simplifyPathIndices(path, epsilon).map((i) => copy(path[i] as Point))
}

/** `simplifyPath`, returning the kept indices into `path` (ascending). */
export function simplifyPathIndices(
  path: readonly Point[],
  epsilon: number,
): number[] {
  const n = path.length
  if (n <= 2) return Array.from({ length: n }, (_, i) => i)
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  // Negative epsilon keeps everything, like comparing d > epsilon would.
  const eps2 = epsilon < 0 ? -1 : epsilon * epsilon
  const stack: number[] = [0, n - 1]
  while (stack.length > 0) {
    const end = stack.pop() as number
    const start = stack.pop() as number
    const a = path[start] as Point
    const b = path[end] as Point
    // distToSegmentSq inlined with the chord terms hoisted: this loop is the hot path.
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    let maxD2 = -1
    let index = -1
    for (let i = start + 1; i < end; i++) {
      const p = path[i] as Point
      let ex = p.x - a.x
      let ey = p.y - a.y
      if (len2 !== 0) {
        const u = Math.min(1, Math.max(0, (ex * dx + ey * dy) / len2))
        ex -= u * dx
        ey -= u * dy
      }
      const d2 = ex * ex + ey * ey
      if (d2 > maxD2) {
        maxD2 = d2
        index = i
      }
    }
    if (maxD2 > eps2) {
      keep[index] = 1
      stack.push(start, index, index, end)
    }
  }
  const kept: number[] = []
  for (let i = 0; i < n; i++) if (keep[i] === 1) kept.push(i)
  return kept
}

const lexLess = (a: Point, b: Point): boolean =>
  a.x < b.x || (a.x === b.x && a.y < b.y)

const cross = (o: Point, a: Point, b: Point): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** Convex hull (Andrew's monotone chain), collinear points removed. */
function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const unique = sorted.filter(
    (p, i) => i === 0 || p.x !== sorted[i - 1]?.x || p.y !== sorted[i - 1]?.y,
  )
  if (unique.length <= 2) return unique
  const build = (pts: readonly Point[]): Point[] => {
    const chain: Point[] = []
    for (const p of pts) {
      while (
        chain.length >= 2 &&
        cross(
          chain[chain.length - 2] as Point,
          chain[chain.length - 1] as Point,
          p,
        ) <= 0
      ) {
        chain.pop()
      }
      chain.push(p)
    }
    chain.pop()
    return chain
  }
  return [...build(unique), ...build([...unique].reverse())]
}

/**
 * The two mutually farthest points (rotating calipers over the hull), ordered
 * so the lexicographically smaller comes first. Ties between equally long
 * diameters go to the lexicographically smallest pair, so the result depends
 * only on the point set, never on where the ring starts.
 */
function diameter(points: readonly Point[]): [Point, Point] | null {
  const hull = convexHull(points)
  const m = hull.length
  const h0 = hull[0]
  if (h0 === undefined) return null
  if (m === 1) return [h0, h0]
  const at = (i: number): Point => hull[i % m] as Point
  let best: [Point, Point] = lexLess(at(0), at(1))
    ? [at(0), at(1)]
    : [at(1), at(0)]
  let bestD2 = -1
  const consider = (p: Point, q: Point): void => {
    const pair: [Point, Point] = lexLess(p, q) ? [p, q] : [q, p]
    const d2 = (p.x - q.x) ** 2 + (p.y - q.y) ** 2
    const better =
      d2 > bestD2 ||
      (d2 === bestD2 &&
        (lexLess(pair[0], best[0]) ||
          (pair[0].x === best[0].x &&
            pair[0].y === best[0].y &&
            lexLess(pair[1], best[1]))))
    if (better) {
      bestD2 = d2
      best = pair
    }
  }
  if (m === 2) {
    consider(at(0), at(1))
    return best
  }
  let j = 1
  for (let i = 0; i < m; i++) {
    const a = at(i)
    const b = at(i + 1)
    while (Math.abs(cross(a, b, at(j + 1))) > Math.abs(cross(a, b, at(j)))) {
      j = (j + 1) % m
    }
    consider(a, at(j))
    consider(b, at(j))
    consider(a, at(j + 1))
    consider(b, at(j + 1))
  }
  return best
}

const indexOf = (ring: readonly Point[], p: Point): number =>
  ring.findIndex((q) => q.x === p.x && q.y === p.y)

/** Indices from..to following ring order (length n), wrapping around, inclusive. */
function walk(n: number, from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; ; i = (i + 1) % n) {
    out.push(i)
    if (i === to) return out
  }
}

/**
 * Simplifies a ring (implicit closure). It is split at its two mutually
 * farthest points and each half is simplified as a path, so the result does
 * not depend on where the user began. A non-degenerate ring keeps at least
 * 3 points; identical points give 1, collinear points give 2.
 */
export function simplifyRing(ring: readonly Point[], epsilon: number): Point[] {
  return simplifyRingIndices(ring, epsilon).map((i) => copy(ring[i] as Point))
}

/** `simplifyRing`, returning the kept indices into `ring` in output order. */
export function simplifyRingIndices(
  ring: readonly Point[],
  epsilon: number,
): number[] {
  const n = ring.length
  if (n < 3) return Array.from({ length: n }, (_, i) => i)
  const pair = diameter(ring)
  if (pair === null) return []
  const [p, q] = pair
  const a = indexOf(ring, p)
  if (p.x === q.x && p.y === q.y) return [a]
  const b = indexOf(ring, q)
  const halves = [walk(n, a, b), walk(n, b, a)] as const
  const simplifyHalf = (half: readonly number[]): number[] =>
    simplifyPathIndices(
      half.map((i) => ring[i] as Point),
      epsilon,
    ).map((k) => half[k] as number)
  const out = [
    ...simplifyHalf(halves[0]),
    ...simplifyHalf(halves[1]).slice(1, -1),
  ]
  if (out.length >= 3) return out

  // Everything is within epsilon of the chord: keep the farthest point so the
  // ring still encloses something (a thin sliver stays a sliver).
  let farD = 0
  let far: { index: number; half: number } | null = null
  for (const [h, half] of halves.entries()) {
    for (const i of half) {
      const d = distToSegmentSq(ring[i] as Point, p, q)
      if (d > farD) {
        farD = d
        far = { index: i, half: h }
      }
    }
  }
  if (far === null) return out
  return far.half === 0 ? [a, far.index, b] : [a, b, far.index]
}
