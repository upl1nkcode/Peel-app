import { describe, expect, it } from 'vitest'

import { bounds } from './polygon'
import { smoothRing, type SmoothStrength } from './smooth'
import type { Point } from './types'

const strengths: SmoothStrength[] = [0, 1, 2, 3, 4]

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

describe('smoothRing', () => {
  // AC-5
  it('should_return_the_input_unchanged_at_strength_0', () => {
    const out = smoothRing(square, 0)
    expect(out).toEqual(square)
    expect(out).not.toBe(square)
  })

  it('should_cut_each_edge_at_one_quarter_and_three_quarters (AC-6)', () => {
    expect(smoothRing(square, 1)).toEqual([
      { x: 2.5, y: 0 },
      { x: 7.5, y: 0 },
      { x: 10, y: 2.5 },
      { x: 10, y: 7.5 },
      { x: 7.5, y: 10 },
      { x: 2.5, y: 10 },
      { x: 0, y: 7.5 },
      { x: 0, y: 2.5 },
    ])
  })

  // AC-6
  it.each(strengths)('should_produce_n_times_2_to_the_k_points (k=%i)', (k) => {
    const pentagon: Point[] = Array.from({ length: 5 }, (_, i) => ({
      x: Math.cos((i * 2 * Math.PI) / 5) * 10,
      y: Math.sin((i * 2 * Math.PI) / 5) * 10,
    }))
    expect(smoothRing(pentagon, k)).toHaveLength(5 * 2 ** k)
  })

  // AC-7
  it.each(strengths)(
    'should_stay_within_the_original_bounds_of_a_square (k=%i)',
    (k) => {
      const b = bounds(square)
      for (const p of smoothRing(square, k)) {
        expect(p.x).toBeGreaterThanOrEqual(b.minX)
        expect(p.x).toBeLessThanOrEqual(b.maxX)
        expect(p.y).toBeGreaterThanOrEqual(b.minY)
        expect(p.y).toBeLessThanOrEqual(b.maxY)
      }
    },
  )

  // AC-25
  it('should_return_finite_points_for_identical_and_collinear_input', () => {
    const identical: Point[] = [
      { x: 3, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 3 },
    ]
    const collinear: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ]
    for (const ring of [identical, collinear, [], [{ x: 1, y: 2 }]]) {
      for (const k of strengths) {
        const out = smoothRing(ring, k)
        expect(out).toHaveLength(ring.length * 2 ** k)
        for (const p of out) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
        }
      }
    }
    expect(smoothRing(identical, 2).every((p) => p.x === 3 && p.y === 3)).toBe(
      true,
    )
  })
})
