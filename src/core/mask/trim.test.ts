import { describe, expect, it } from 'vitest'
import { cropRgba, trimBounds } from './trim'
import { EmptyMaskError, type AlphaMask, type RgbaImage } from './types'

function mask(
  width: number,
  height: number,
  on: [number, number][],
): AlphaMask {
  const data = new Uint8Array(width * height)
  for (const [i, j] of on) data[j * width + i] = 1
  return { width, height, data }
}

describe('trimBounds', () => {
  it('should_trim_with_padding (AC-14)', () => {
    const m = mask(10, 8, [
      [3, 2],
      [6, 5],
    ])
    expect(trimBounds(m, 0)).toEqual({ minX: 3, minY: 2, maxX: 7, maxY: 6 })
    expect(trimBounds(m, 4)).toEqual({ minX: -1, minY: -2, maxX: 11, maxY: 10 })
    expect(trimBounds(mask(1, 1, [[0, 0]]), 0)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    })
  })

  it('should_refuse_an_empty_mask (AC-14)', () => {
    expect(() => trimBounds(mask(4, 4, []), 2)).toThrow(EmptyMaskError)
  })

  it('should_refuse_bad_padding (AC-14)', () => {
    const m = mask(2, 2, [[0, 0]])
    for (const p of [-1, 1.5, Number.NaN]) {
      expect(() => trimBounds(m, p)).toThrow(RangeError)
    }
  })
})

describe('cropRgba', () => {
  it('should_crop_with_transparent_outside (AC-15)', () => {
    const src: RgbaImage = {
      width: 2,
      height: 2,
      data: new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      ]),
    }
    const out = cropRgba(src, { minX: 1, minY: -1, maxX: 3, maxY: 2 })
    expect(out.width).toBe(2)
    expect(out.height).toBe(3)
    expect(Array.from(out.data)).toEqual([
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // row −1: outside
      5,
      6,
      7,
      8,
      0,
      0,
      0,
      0, // row 0: (1,0), then x = 2 outside
      13,
      14,
      15,
      16,
      0,
      0,
      0,
      0, // row 1
    ])
  })
})
