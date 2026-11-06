import type { RgbaImage } from '../mask/types'

/** A rectangle of whole image pixels, inside the image. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Edge strength and cost per pixel of `rect`, row-major (spec 0006). */
export interface EdgeMap {
  rect: Rect
  /** Colour Sobel magnitude: √Σ over R, G, B of (gx² + gy²), channels 0..1. */
  strength: Float32Array
  /** 1 − strength / (max strength in rect); 1 everywhere when that max is 0. */
  cost: Float32Array
  /** Unit direction across the edge (main eigenvector of the colour structure tensor). */
  normalX: Float32Array
  normalY: Float32Array
}

/**
 * Colour edge map over `rect` (spec 0006 Decisions 4 and 6). Sobel kernels
 * (1-2-1, divided by 8) per channel; neighbours outside the image repeat the
 * nearest border pixel, so a sub-rect matches the whole-image map.
 */
export function edgeMap(image: RgbaImage, rect: Rect): EdgeMap {
  const { width: W, height: H, data } = image
  if (
    !Number.isInteger(rect.x) ||
    !Number.isInteger(rect.y) ||
    !Number.isInteger(rect.width) ||
    !Number.isInteger(rect.height) ||
    rect.width < 1 ||
    rect.height < 1 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > W ||
    rect.y + rect.height > H
  ) {
    throw new RangeError('rect must be whole pixels inside the image')
  }
  const n = rect.width * rect.height
  const strength = new Float32Array(n)
  const normalX = new Float32Array(n)
  const normalY = new Float32Array(n)
  const v = (x: number, y: number, ch: number): number => {
    const cx = x < 0 ? 0 : x >= W ? W - 1 : x
    const cy = y < 0 ? 0 : y >= H ? H - 1 : y
    return data[(cy * W + cx) * 4 + ch] as number
  }
  // Sums of whole 8-bit values are exact, so a flat area gives exactly 0.
  const SCALE = 1 / (255 * 8)
  let max = 0
  for (let j = 0; j < rect.height; j++) {
    const y = rect.y + j
    for (let i = 0; i < rect.width; i++) {
      const x = rect.x + i
      let jxx = 0
      let jyy = 0
      let jxy = 0
      for (let ch = 0; ch < 3; ch++) {
        const a = v(x - 1, y - 1, ch)
        const b = v(x, y - 1, ch)
        const c = v(x + 1, y - 1, ch)
        const d = v(x - 1, y, ch)
        const f = v(x + 1, y, ch)
        const g = v(x - 1, y + 1, ch)
        const h = v(x, y + 1, ch)
        const k = v(x + 1, y + 1, ch)
        const gx = (c + 2 * f + k - a - 2 * d - g) * SCALE
        const gy = (g + 2 * h + k - a - 2 * b - c) * SCALE
        jxx += gx * gx
        jyy += gy * gy
        jxy += gx * gy
      }
      const o = j * rect.width + i
      const s = Math.sqrt(jxx + jyy)
      strength[o] = s
      if (s > max) max = s
      if (s > 0) {
        const theta = 0.5 * Math.atan2(2 * jxy, jxx - jyy)
        normalX[o] = Math.cos(theta)
        normalY[o] = Math.sin(theta)
      } else {
        normalX[o] = 1
      }
    }
  }
  const cost = new Float32Array(n).fill(1)
  if (max > 0)
    for (let o = 0; o < n; o++) cost[o] = 1 - (strength[o] as number) / max
  return { rect: { ...rect }, strength, cost, normalX, normalY }
}
