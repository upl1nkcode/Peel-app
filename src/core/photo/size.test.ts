import { describe, expect, it } from 'vitest'
import { cappedSize, MAX_PHOTO_PIXELS, MAX_PHOTO_SIDE_PX } from './size'

describe('cappedSize', () => {
  it('should_keep_photos_within_the_cap (AC-2)', () => {
    for (const [w, h] of [
      [4032, 3024],
      [4000, 3000],
      [4096, 3072],
      [1, 1],
    ] as const) {
      expect(cappedSize(w, h)).toEqual({ width: w, height: h })
    }
  })

  it('should_scale_larger_photos_into_the_cap (AC-2)', () => {
    const cases: [number, number, number, number][] = [
      [8064, 6048, 4096, 3072],
      [6000, 4000, 4344, 2896],
      [5000, 3000, 4579, 2747],
      [30000, 3000, 11217, 1121],
      [100000, 1, 16384, 1],
      [20000, 100, 16384, 81],
      [1, 20000000, 1, 16384],
      [4097, 3072, 4096, 3071],
    ]
    for (const [w, h, ew, eh] of cases) {
      const got = cappedSize(w, h)
      expect(got).toEqual({ width: ew, height: eh })
      expect(got.width * got.height).toBeLessThanOrEqual(MAX_PHOTO_PIXELS)
      expect(Math.max(got.width, got.height)).toBeLessThanOrEqual(
        MAX_PHOTO_SIDE_PX,
      )
    }
  })

  it('should_reject_bad_sizes', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => cappedSize(bad, 10)).toThrow(RangeError)
      expect(() => cappedSize(10, bad)).toThrow(RangeError)
    }
  })

  it('should_use_the_spec_constants (AC-2)', () => {
    expect(MAX_PHOTO_PIXELS).toBe(12_582_912)
    expect(MAX_PHOTO_SIDE_PX).toBe(16_384)
  })
})
