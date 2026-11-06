import type { Size } from '../core/geometry/types'
import type { RgbaImage } from '../core/mask/types'
import { mulberry32 } from './random'

/** A colour with channels in 0..1. */
export type RGB = [number, number, number]

const to8 = (v: number) => Math.min(255, Math.max(0, Math.round(v * 255)))

/**
 * An opaque photo-like image: each channel is coverage·fg + (1 − coverage)·bg,
 * plus a texture on the object (texture·sin(0.9x)·cos(0.7y)) and seeded noise
 * (noise·(u1 + u2 + u3 − 1.5)), rounded to 8 bits.
 */
export function paintScene(
  coverage: Float32Array,
  size: Size,
  fg: RGB,
  bg: RGB,
  opts: { noise: number; seed: number; texture?: number },
): RgbaImage {
  const rand = mulberry32(opts.seed)
  const data = new Uint8Array(size.width * size.height * 4)
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const k = y * size.width + x
      const c = coverage[k] as number
      const tex = (opts.texture ?? 0) * Math.sin(0.9 * x) * Math.cos(0.7 * y)
      for (let ch = 0; ch < 3; ch++) {
        const noise = opts.noise * (rand() + rand() + rand() - 1.5)
        data[k * 4 + ch] = to8(
          c * ((fg[ch] as number) + tex) + (1 - c) * (bg[ch] as number) + noise,
        )
      }
      data[k * 4 + 3] = 255
    }
  }
  return { width: size.width, height: size.height, data }
}

/** Columns left of `column` are `left`, the rest `right`: a vertical step between column − 1 and column. */
export function stepImage(
  width: number,
  height: number,
  column: number,
  left: RGB,
  right: RGB,
): RgbaImage {
  const coverage = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < column; x++) coverage[y * width + x] = 1
  }
  return paintScene(coverage, { width, height }, left, right, {
    noise: 0,
    seed: 1,
  })
}
