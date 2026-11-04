import type { Size } from '../geometry/types'

/** 8-bit alpha, row-major, `width × height`. A value is the selected fraction of the pixel × 255. */
export interface AlphaMask {
  width: number
  height: number
  data: Uint8Array
}

/** RGBA, 4 bytes per pixel, row-major, not premultiplied. */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8Array
}

/** A mask with no selected pixel cannot be trimmed. */
export class EmptyMaskError extends Error {
  constructor() {
    super('The mask has no selected pixel')
    this.name = 'EmptyMaskError'
  }
}

/** The one rounding to 8 bits: `round(clamp01(v) · 255)` per pixel. */
export function toAlphaMask(coverage: Float32Array, size: Size): AlphaMask {
  const data = new Uint8Array(size.width * size.height)
  for (let k = 0; k < data.length; k++) {
    const v = coverage[k] as number
    data[k] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
  }
  return { width: size.width, height: size.height, data }
}
