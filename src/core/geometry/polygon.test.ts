import { describe, expect, it } from 'vitest'

import {
  area,
  bounds,
  contains,
  isDegenerateRing,
  orientation,
  signedArea,
} from './polygon'
import type { Point } from './types'

const pts = (...xy: [number, number][]): Point[] =>
  xy.map(([x, y]) => ({ x, y }))

// Clockwise on screen (y down): right along the top, then down.
const square = pts([0, 0], [10, 0], [10, 10], [0, 10])
const squareCcw = [...square].reverse()
// 30×30 with a 20×10 notch cut from the right side (x 10..30, y 10..20).
const cShape = pts(
  [0, 0],
  [30, 0],
  [30, 10],
  [10, 10],
  [10, 20],
  [30, 20],
  [30, 30],
  [0, 30],
)
// Bow-tie: two triangular lobes wound in opposite directions.
const figure8 = pts([0, 0], [10, 10], [10, 0], [0, 10])
const hole = pts([3, 3], [3, 7], [7, 7], [7, 3])

describe('polygon utilities', () => {
  // AC-19
  it('should_compute_signed_area_bounds_and_orientation', () => {
    expect(signedArea(square)).toBe(100)
    expect(orientation(square)).toBe('cw')
    expect(signedArea(squareCcw)).toBe(-100)
    expect(area(squareCcw)).toBe(100)
    expect(orientation(squareCcw)).toBe('ccw')

    expect(signedArea(cShape)).toBe(700)
    expect(bounds(cShape)).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 30 })

    // Documented: a figure-8's lobes have opposite signs and cancel out.
    expect(signedArea(figure8)).toBe(0)
    expect(area(figure8)).toBe(0)

    // A hole is wound the other way from its outer ring.
    expect(orientation(hole)).toBe('ccw')
    expect(area(hole)).toBe(16)
  })

  it('should_throw_range_error_for_bounds_of_an_empty_ring (AC-19)', () => {
    expect(() => bounds([])).toThrow(RangeError)
    expect(bounds(pts([2, 3]))).toEqual({ minX: 2, minY: 3, maxX: 2, maxY: 3 })
  })

  // AC-20
  it('should_use_nonzero_winding_for_contains', () => {
    expect(contains({ x: 5, y: 5 }, square)).toBe(true)
    expect(contains({ x: 5, y: 5 }, squareCcw)).toBe(true)
    expect(contains({ x: 11, y: 5 }, square)).toBe(false)

    expect(contains({ x: 20, y: 5 }, cShape)).toBe(true)
    expect(contains({ x: 20, y: 25 }, cShape)).toBe(true)
    expect(contains({ x: 5, y: 15 }, cShape)).toBe(true)
    expect(contains({ x: 20, y: 15 }, cShape)).toBe(false)

    expect(contains({ x: 2, y: 5 }, figure8)).toBe(true)
    expect(contains({ x: 8, y: 5 }, figure8)).toBe(true)
    expect(contains({ x: 5, y: 1 }, figure8)).toBe(false)
  })

  // AC-21
  it('should_treat_boundary_as_inside_and_1e-6_outside_as_outside', () => {
    expect(contains({ x: 10, y: 5 }, square)).toBe(true) // on an edge
    expect(contains({ x: 0, y: 0 }, square)).toBe(true) // on a vertex
    expect(contains({ x: 10, y: 10 }, square)).toBe(true)
    expect(contains({ x: 20, y: 10 }, cShape)).toBe(true) // notch edge
    expect(contains({ x: 10 + 1e-6, y: 5 }, square)).toBe(false)
    expect(contains({ x: -1e-6, y: -1e-6 }, square)).toBe(false)
    expect(contains({ x: 5, y: -1e-6 }, square)).toBe(false)
  })

  it('should_keep_the_1e-6_boundary_exact_on_photo_sized_edges (AC-21)', () => {
    for (const side of [1000, 4000, 10000]) {
      const big = pts([0, 0], [side, 0], [side, side], [0, side])
      expect(contains({ x: side, y: side / 2 }, big)).toBe(true)
      expect(contains({ x: side / 3, y: 0 }, big)).toBe(true)
      expect(contains({ x: side + 1e-6, y: side / 2 }, big)).toBe(false)
      expect(contains({ x: side / 2, y: -1e-6 }, big)).toBe(false)
    }
    // a point computed on a long diagonal edge still counts as on it
    const tri = pts([0, 0], [4032, 3024], [0, 3024])
    const t = 0.37
    expect(contains({ x: 4032 * t, y: 3024 * t }, tri)).toBe(true)
  })

  // AC-22
  it('should_handle_degenerate_rings_without_throwing', () => {
    const degenerate = [
      [],
      pts([1, 1]),
      pts([1, 1], [5, 5]),
      pts([0, 0], [5, 5], [10, 10]),
      pts([0, 0], [0, 0], [0, 0]),
    ]
    for (const ring of degenerate) {
      expect(area(ring)).toBe(0)
      expect(signedArea(ring)).toBe(0)
      expect(contains({ x: 5, y: 5 }, ring)).toBe(false)
      expect(contains({ x: 1, y: 1 }, ring)).toBe(false)
    }
  })

  // spec 0003 AC-13 support
  it('should_detect_degenerate_rings', () => {
    expect(isDegenerateRing([])).toBe(true)
    expect(isDegenerateRing(pts([0, 0], [5, 5]))).toBe(true)
    expect(isDegenerateRing(pts([0, 0], [5, 5], [10, 10]))).toBe(true)
    expect(isDegenerateRing(pts([1, 1], [1, 1], [1, 1]))).toBe(true)
    expect(isDegenerateRing(pts([0, 0], [10, 0], [0, 10]))).toBe(false)
    expect(isDegenerateRing(figure8)).toBe(false)
  })

  // AC-24
  it('should_give_finite_results_for_a_self_intersecting_ring', () => {
    const star = pts([50, 0], [80, 100], [0, 35], [100, 35], [20, 100])
    expect(Number.isFinite(signedArea(star))).toBe(true)
    expect(Number.isFinite(area(star))).toBe(true)
    // Nonzero winding fills the pentagram's centre too.
    expect(contains({ x: 50, y: 55 }, star)).toBe(true)
    expect(contains({ x: 50, y: 20 }, star)).toBe(true)
    expect(contains({ x: 5, y: 5 }, star)).toBe(false)
  })
})
