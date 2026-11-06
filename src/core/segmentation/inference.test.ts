import { describe, expect, it } from 'vitest'
import type { CoverageMask } from '../contour'
import { resizeRgba, type RgbaImage } from '../mask'
import { mulberry32 } from '../../test/random'
import { inferenceImage, inferenceSize, upscaleMask } from './index'

const image = (width: number, height: number): RgbaImage => {
  const rand = mulberry32(7)
  const data = new Uint8Array(width * height * 4)
  for (let k = 0; k < data.length; k++) data[k] = Math.floor(rand() * 256)
  return { width, height, data }
}

const mask = (
  width: number,
  height: number,
  f: (x: number, y: number) => number,
): CoverageMask => {
  const data = new Float32Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data[y * width + x] = f(x, y)
  return { width, height, data }
}

/** Linear-interpolated position (pixel coordinates) where a row/column sequence crosses 0.5. */
const crossing = (values: number[]): number => {
  for (let k = 0; k + 1 < values.length; k++) {
    const a = values[k] as number
    const b = values[k + 1] as number
    if ((a - 0.5) * (b - 0.5) <= 0 && a !== b)
      return k + 0.5 + (a - 0.5) / (a - b)
  }
  return NaN
}

describe('inferenceSize and inferenceImage', () => {
  it('should_downscale_the_long_side_to_1024 (AC-5)', () => {
    expect(inferenceSize({ width: 4032, height: 3024 })).toEqual({
      width: 1024,
      height: 768,
    })
    expect(inferenceSize({ width: 3024, height: 4032 })).toEqual({
      width: 768,
      height: 1024,
    })
    expect(inferenceSize({ width: 1000, height: 1000 })).toEqual({
      width: 1000,
      height: 1000,
    })
    expect(inferenceSize({ width: 3000, height: 1 })).toEqual({
      width: 1024,
      height: 1,
    })
    expect(inferenceSize({ width: 1, height: 3000 })).toEqual({
      width: 1,
      height: 1024,
    })
    expect(inferenceSize({ width: 1, height: 1 })).toEqual({
      width: 1,
      height: 1,
    })
    const small = image(1000, 1000)
    expect(inferenceImage(small)).toBe(small)
    const big = image(2048, 1100)
    const copy = inferenceImage(big)
    expect({ width: copy.width, height: copy.height }).toEqual({
      width: 1024,
      height: 550,
    })
    expect(copy.data).toEqual(resizeRgba(big, 1024, 550).data)
  })
})

describe('upscaleMask', () => {
  it('should_upscale_2x_bilinearly (AC-6)', () => {
    const row = upscaleMask(
      mask(2, 1, (x) => x),
      { width: 4, height: 1 },
    )
    expect(Array.from(row.data)).toEqual([0, 0.25, 0.75, 1])
    const square = upscaleMask(
      mask(2, 2, (x, y) => (x === 0 && y === 0 ? 0 : 1)),
      { width: 4, height: 4 },
    )
    // Source coordinates per output pixel: [0 (clamped), 0.25, 0.75, 1 (clamped)].
    const w = [0, 0.25, 0.75, 1]
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const fx = w[x] as number
        const fy = w[y] as number
        const expected = 1 - (1 - fx) * (1 - fy)
        expect(square.data[y * 4 + x]).toBeCloseTo(expected, 6)
      }
    }
    expect({ width: square.width, height: square.height }).toEqual({
      width: 4,
      height: 4,
    })
  })

  it('should_keep_the_50_percent_line_when_upscaling (AC-7)', () => {
    const s = 37
    for (const [src, dst] of [
      [100, 200],
      [1024, 4032],
      [768, 3024],
      [1000, 1000],
    ] as const) {
      const vertical = upscaleMask(
        mask(src, 3, (x) => (x < s ? 1 : 0)),
        { width: dst, height: 5 },
      )
      expect({ width: vertical.width, height: vertical.height }).toEqual({
        width: dst,
        height: 5,
      })
      for (let y = 0; y < 5; y++) {
        const values = Array.from(
          vertical.data.subarray(y * dst, (y + 1) * dst),
        )
        expect(
          Math.abs(crossing(values) - (s * dst) / src),
        ).toBeLessThanOrEqual(0.01)
      }
      const horizontal = upscaleMask(
        mask(3, src, (_, y) => (y < s ? 1 : 0)),
        { width: 5, height: dst },
      )
      for (let x = 0; x < 5; x++) {
        const values = Array.from(
          { length: dst },
          (_, y) => horizontal.data[y * 5 + x] as number,
        )
        expect(
          Math.abs(crossing(values) - (s * dst) / src),
        ).toBeLessThanOrEqual(0.01)
      }
    }
    const flat = upscaleMask(
      mask(7, 5, () => 0.3),
      { width: 31, height: 17 },
    )
    for (const v of flat.data) expect(v).toBeCloseTo(0.3, 6)
  })
})
