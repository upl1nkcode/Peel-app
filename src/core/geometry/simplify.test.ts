import { describe, expect, it } from 'vitest'

import { mulberry32, noisyCircle } from '../../test/random'
import { simplifyPath, simplifyRing } from './simplify'
import type { Point } from './types'

const pts = (...xy: [number, number][]): Point[] =>
  xy.map(([x, y]) => ({ x, y }))

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const u =
    len2 === 0
      ? 0
      : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(a.x + u * dx - p.x, a.y + u * dy - p.y)
}

const distToPolyline = (p: Point, line: readonly Point[]): number => {
  let best = Infinity
  for (let i = 0; i + 1 < line.length; i++) {
    best = Math.min(
      best,
      distToSegment(p, line[i] as Point, line[i + 1] as Point),
    )
  }
  return line.length === 1
    ? Math.hypot(p.x - (line[0] as Point).x, p.y - (line[0] as Point).y)
    : best
}

/** Indices of `out` within `input`, matched in order; null if not a subsequence. */
function subsequenceIndices(
  out: readonly Point[],
  input: readonly Point[],
): number[] | null {
  const idx: number[] = []
  let j = 0
  for (const p of out) {
    while (
      j < input.length &&
      ((input[j] as Point).x !== p.x || (input[j] as Point).y !== p.y)
    )
      j++
    if (j === input.length) return null
    idx.push(j++)
  }
  return idx
}

const key = (p: Point) => `${String(p.x)},${String(p.y)}`

function randomWalk(rand: () => number, n: number): Point[] {
  const path: Point[] = [{ x: 0, y: 0 }]
  for (let i = 1; i < n; i++) {
    const last = path[i - 1] as Point
    path.push({
      x: last.x + (rand() - 0.5) * 6,
      y: last.y + (rand() - 0.5) * 6,
    })
  }
  return path
}

describe('simplifyPath', () => {
  // AC-9
  it('should_collapse_collinear_points_to_the_two_endpoints', () => {
    expect(
      simplifyPath(pts([0, 0], [1, 1], [2, 2], [5, 5], [9, 9]), 0.1),
    ).toEqual(pts([0, 0], [9, 9]))
    expect(simplifyPath(pts([0, 0], [3, 0], [7, 0], [10, 0]), 0)).toEqual(
      pts([0, 0], [10, 0]),
    )
  })

  // AC-10: zig-zag of amplitude 1 between (0,0) and (4,0)
  const zigzag = pts([0, 0], [1, 1], [2, 0], [3, 1], [4, 0])
  it.each([
    { epsilon: 0.5, expected: zigzag },
    // (1,1) is 1 from the chord; the rest are 2/√10 ≈ 0.632 from (1,1)→(4,0)
    { epsilon: 0.7, expected: pts([0, 0], [1, 1], [4, 0]) },
    { epsilon: 1, expected: pts([0, 0], [4, 0]) },
    { epsilon: 2, expected: pts([0, 0], [4, 0]) },
  ])(
    'should_reduce_a_known_zigzag_to_the_known_output (ε=$epsilon)',
    ({ epsilon, expected }) => {
      expect(simplifyPath(zigzag, epsilon)).toEqual(expected)
    },
  )

  // AC-11
  it('should_keep_every_removed_point_within_epsilon_and_output_a_subsequence', () => {
    const rand = mulberry32(17)
    for (let trial = 0; trial < 200; trial++) {
      const n = 10 + Math.floor(rand() * 291)
      const path = randomWalk(rand, n)
      for (const epsilon of [0.25, 0.75, 2]) {
        const out = simplifyPath(path, epsilon)
        const idx = subsequenceIndices(out, path)
        expect(idx).not.toBeNull()
        expect(idx?.[0]).toBe(0)
        expect(idx?.at(-1)).toBe(path.length - 1)
        const kept = new Set(idx)
        path.forEach((p, i) => {
          if (!kept.has(i)) {
            expect(distToPolyline(p, out)).toBeLessThanOrEqual(epsilon + 1e-9)
          }
        })
      }
    }
  })

  it('should_keep_a_hairpin_tip_beyond_the_chord_end (AC-11)', () => {
    // the tip (12, 0) is on the chord's line but 2 px past its end
    const hairpin = pts([0, 0], [12, 0], [10, 0.1])
    expect(simplifyPath(hairpin, 1)).toEqual(hairpin)
  })

  // AC-12
  it('should_not_remove_shape_changing_points_at_epsilon_0', () => {
    expect(simplifyPath(pts([0, 0], [5, 0], [10, 0], [10, 10]), 0)).toEqual(
      pts([0, 0], [10, 0], [10, 10]),
    )
    const rand = mulberry32(3)
    const path = randomWalk(rand, 200)
    expect(simplifyPath(path, 0)).toHaveLength(200)
  })

  // AC-25
  it('should_handle_identical_points_without_throwing', () => {
    expect(simplifyPath(pts([2, 2], [2, 2], [2, 2]), 0.5)).toEqual(
      pts([2, 2], [2, 2]),
    )
    expect(simplifyPath([], 1)).toEqual([])
    expect(simplifyPath(pts([1, 1]), 1)).toEqual(pts([1, 1]))
    // a zero-length chord falls back to point distance
    expect(simplifyPath(pts([0, 0], [3, 4], [0, 0]), 1)).toEqual(
      pts([0, 0], [3, 4], [0, 0]),
    )
  })
})

describe('simplifyRing', () => {
  it('should_simplify_a_ring_to_a_valid_ring_within_epsilon (AC-11)', () => {
    const ring = noisyCircle(300, 100, 1, 5)
    const out = simplifyRing(ring, 0.75)
    expect(out.length).toBeGreaterThanOrEqual(3)
    expect(out.length).toBeLessThan(ring.length)
    const closedOut = [...out, out[0] as Point]
    for (const p of ring) {
      expect(distToPolyline(p, closedOut)).toBeLessThanOrEqual(0.75 + 1e-9)
    }
    // output points are input points
    const input = new Set(ring.map(key))
    expect(out.every((p) => input.has(key(p)))).toBe(true)
  })

  // AC-26
  it('should_not_depend_on_where_the_ring_starts', () => {
    const ring = noisyCircle(64, 50, 1, 9)
    const reference = simplifyRing(ring, 0.75).map(key).sort()
    for (let k = 1; k < ring.length; k++) {
      const rotated = [...ring.slice(k), ...ring.slice(0, k)]
      expect(simplifyRing(rotated, 0.75).map(key).sort()).toEqual(reference)
    }
    // a square has two equally long diagonals: still start-independent
    const square = pts([0, 0], [5, 0], [10, 0], [10, 10], [0, 10])
    const sq = simplifyRing(square, 0.5).map(key).sort()
    for (let k = 1; k < square.length; k++) {
      const rotated = [...square.slice(k), ...square.slice(0, k)]
      expect(simplifyRing(rotated, 0.5).map(key).sort()).toEqual(sq)
    }
    expect(sq).toEqual(['0,0', '0,10', '10,0', '10,10'])
  })

  it('should_keep_at_least_3_points_for_a_thin_sliver (AC-26)', () => {
    const sliver = pts([0, 0], [50, 0.2], [100, 0], [50, -0.1])
    const out = simplifyRing(sliver, 0.75)
    expect(out).toHaveLength(3)
  })

  // AC-25
  it('should_handle_identical_and_collinear_rings_without_throwing', () => {
    expect(simplifyRing(pts([2, 2], [2, 2], [2, 2]), 0.5)).toEqual(pts([2, 2]))
    expect(simplifyRing(pts([0, 0], [5, 5], [10, 10]), 0.5)).toEqual(
      pts([0, 0], [10, 10]),
    )
    expect(simplifyRing([], 0.5)).toEqual([])
  })
})
