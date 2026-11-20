import { describe, expect, it } from 'vitest'
import { scoreCutout, type Mask } from './score'

/** A mask whose alpha is `value(x, y)`. */
function mask(
  width: number,
  height: number,
  value: (x: number, y: number) => number,
): Mask {
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = value(x, y)
  }
  return { width, height, data }
}

/** Opaque inside [x0, x1) × [y0, y1). */
const box = (
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) =>
  mask(width, height, (x, y) =>
    x >= x0 && x < x1 && y >= y0 && y < y1 ? 255 : 0,
  )

describe('scoreCutout (spec 0014)', () => {
  it('should_score_identical_masks_as_perfect (AC-4)', () => {
    const m = box(40, 40, 10, 10, 30, 30)
    expect(scoreCutout(m, m)).toEqual({
      iou: 1,
      edgeMean: 0,
      edgeP99: 0,
      extra: 0,
      softError: null,
    })
  })

  it('should_score_two_empties_as_iou_1 (AC-4)', () => {
    const empty = box(8, 8, 0, 0, 0, 0)
    const s = scoreCutout(empty, empty)
    expect(s.iou).toBe(1)
    expect(s.edgeMean).toBe(0)
  })

  it('should_measure_a_2px_shift_along_the_shift (AC-4)', () => {
    const truth = box(40, 40, 10, 10, 30, 30)
    const got = box(40, 40, 12, 10, 32, 30)
    const s = scoreCutout(got, truth)
    expect(s.iou).toBeCloseTo((18 * 20) / (22 * 20), 12)
    expect(s.edgeMean).toBeGreaterThan(0)
    expect(s.edgeMean).toBeLessThanOrEqual(2)
    expect(s.edgeP99).toBe(2)
  })

  it('should_count_the_image_border_as_boundary (AC-4)', () => {
    const truth = box(40, 40, 0, 0, 40, 40)
    const got = box(40, 40, 1, 1, 39, 39)
    // Each boundary pixel is 1 px from the other ring, the 4 corners √2.
    expect(scoreCutout(got, truth).edgeMean).toBeCloseTo(1, 1)
  })

  it('should_measure_extra_share (AC-4)', () => {
    const truth = box(40, 40, 0, 0, 10, 10)
    const got = box(40, 40, 20, 0, 30, 10)
    const extra = box(40, 40, 25, 0, 40, 10)
    expect(scoreCutout(got, truth, extra).extra).toBe(0.5)
    expect(scoreCutout(got, truth).extra).toBe(0)
  })

  it('should_report_soft_error_only_over_500_band_pixels (AC-4)', () => {
    // Opaque left of x = 50, a soft column at x = 50: the band is 7 columns.
    const truthOf = (h: number) =>
      mask(100, h, (x) => (x < 50 ? 255 : x === 50 ? 128 : 0))
    const hardOf = (h: number) => mask(100, h, (x) => (x < 50 ? 255 : 0))
    expect(scoreCutout(hardOf(57), truthOf(57)).softError).toBeNull()
    const s = scoreCutout(hardOf(100), truthOf(100))
    expect(s.softError).toBeCloseTo((100 * 128) / 255 / 700, 12)
  })

  it('should_score_an_empty_got_as_a_miss (AC-4)', () => {
    const truth = box(20, 20, 5, 5, 15, 15)
    const s = scoreCutout(box(20, 20, 0, 0, 0, 0), truth)
    expect(s.iou).toBe(0)
    expect(s.edgeMean).toBe(Infinity)
    expect(s.edgeP99).toBe(Infinity)
    expect(s.extra).toBe(0)
  })

  it('should_reject_mismatched_sizes (AC-4)', () => {
    expect(() =>
      scoreCutout(box(10, 10, 0, 0, 5, 5), box(10, 11, 0, 0, 5, 5)),
    ).toThrow(RangeError)
    const m = box(10, 10, 0, 0, 5, 5)
    expect(() => scoreCutout(m, m, box(9, 10, 0, 0, 5, 5))).toThrow(RangeError)
  })
})
