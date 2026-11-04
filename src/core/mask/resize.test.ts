import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../test/random'
import { resizeRgba } from './resize'
import type { RgbaImage } from './types'

function image(
  width: number,
  height: number,
  px: (i: number, j: number) => number[],
): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) data.set(px(i, j), (j * width + i) * 4)
  }
  return { width, height, data }
}

describe('resizeRgba', () => {
  it('should_downscale_by_exact_area_averages (AC-16)', () => {
    const rand = mulberry32(7)
    const src = image(4, 4, () => [
      Math.floor(rand() * 256),
      Math.floor(rand() * 256),
      Math.floor(rand() * 256),
      255,
    ])
    const out = resizeRgba(src, 2, 2)
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0
          for (const [dx, dy] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ] as const) {
            sum += src.data[((2 * y + dy) * 4 + 2 * x + dx) * 4 + c] as number
          }
          const v = out.data[(y * 2 + x) * 4 + c] as number
          expect(Math.abs(v - sum / 4)).toBeLessThanOrEqual(0.5 + 1e-9)
        }
      }
    }
  })

  it('should_not_bleed_transparent_colour (AC-16)', () => {
    const src = image(5, 5, (i, j) =>
      i === 2 && j === 2 ? [255, 0, 0, 255] : [17, 200, 99, 0],
    )
    for (const [w, h] of [
      [2, 2],
      [3, 3],
      [1, 1],
      [4, 2],
    ] as const) {
      const out = resizeRgba(src, w, h)
      for (let k = 0; k < w * h; k++) {
        const px = Array.from(out.data.subarray(k * 4, k * 4 + 4))
        if ((px[3] as number) > 0) expect(px.slice(0, 3)).toEqual([255, 0, 0])
        else expect(px).toEqual([0, 0, 0, 0])
      }
    }
  })

  it('should_conserve_colour_at_non_integer_ratios (AC-16)', () => {
    const rand = mulberry32(3)
    const src = image(5, 3, () => [
      Math.floor(rand() * 256),
      Math.floor(rand() * 256),
      Math.floor(rand() * 256),
      255,
    ])
    const out = resizeRgba(src, 2, 2)
    const area = (5 / 2) * (3 / 2)
    for (let c = 0; c < 3; c++) {
      let inSum = 0
      for (let k = 0; k < 15; k++) inSum += src.data[k * 4 + c] as number
      let outSum = 0
      for (let k = 0; k < 4; k++) outSum += out.data[k * 4 + c] as number
      expect(Math.abs(outSum * area - inSum)).toBeLessThanOrEqual(
        4 * 0.5 * area,
      )
    }
    expect(Array.from(out.data.filter((_, k) => k % 4 === 3))).toEqual([
      255, 255, 255, 255,
    ])
  })

  it('should_copy_at_the_same_size_and_refuse_upscaling (AC-16)', () => {
    const src = image(3, 2, (i, j) => [i * 40, j * 90, 7, 128 + i])
    expect(resizeRgba(src, 3, 2)).toEqual(src)
    expect(() => resizeRgba(src, 4, 2)).toThrow(RangeError)
    expect(() => resizeRgba(src, 3, 3)).toThrow(RangeError)
    expect(() => resizeRgba(src, 0, 1)).toThrow(RangeError)
    expect(() => resizeRgba(src, 1.5, 1)).toThrow(RangeError)
  })
})
