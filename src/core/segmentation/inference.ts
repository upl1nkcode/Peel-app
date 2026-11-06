import type { CoverageMask } from '../contour'
import type { Size } from '../geometry/types'
import { resizeRgba, type RgbaImage } from '../mask'

/** Both tap models work at 512–768 px internally, so inference runs on a copy this long (spec 0007 decision 5). */
export const INFERENCE_LONG_SIDE_PX = 1024

/** The inference copy's size: long side at most 1024 px, aspect kept, at least 1×1 (AC-5). */
export function inferenceSize(size: Size): Size {
  const long = Math.max(size.width, size.height)
  if (long <= INFERENCE_LONG_SIDE_PX)
    return { width: size.width, height: size.height }
  const short = (n: number) =>
    Math.max(1, Math.round((n * INFERENCE_LONG_SIDE_PX) / long))
  return size.width >= size.height
    ? { width: INFERENCE_LONG_SIDE_PX, height: short(size.height) }
    : { width: short(size.width), height: INFERENCE_LONG_SIDE_PX }
}

/** The area-averaged inference copy; the image itself when it is already small enough. */
export function inferenceImage(image: RgbaImage): RgbaImage {
  const { width, height } = inferenceSize(image)
  if (width === image.width && height === image.height) return image
  return resizeRgba(image, width, height)
}

/** Per output index: the two source indices and the weight of the second. */
function axis(
  src: number,
  dst: number,
): { lo: Int32Array; hi: Int32Array; t: Float32Array } {
  const lo = new Int32Array(dst)
  const hi = new Int32Array(dst)
  const t = new Float32Array(dst)
  for (let o = 0; o < dst; o++) {
    const u = Math.min(src - 1, Math.max(0, ((o + 0.5) * src) / dst - 0.5))
    const i = Math.floor(u)
    lo[o] = i
    hi[o] = Math.min(src - 1, i + 1)
    t[o] = u - i
  }
  return { lo, hi, t }
}

const isSize = (n: number) => Number.isInteger(n) && n >= 1

/**
 * Bilinear resample with pixel centres aligned: output pixel x samples the
 * source at u = (x + 0.5) · src / dst − 0.5, clamped to the edge pixels
 * (AC-6, AC-7). Separable: rows first, then columns.
 */
export function upscaleMask(mask: CoverageMask, size: Size): CoverageMask {
  if (!isSize(size.width) || !isSize(size.height)) {
    throw new RangeError(
      `size must be positive integers, got ${String(size.width)}×${String(size.height)}`,
    )
  }
  const sw = mask.width
  const sh = mask.height
  const { width: dw, height: dh } = size
  const ax = axis(sw, dw)
  const ay = axis(sh, dh)
  const rows = new Float32Array(sh * dw)
  for (let y = 0; y < sh; y++) {
    const src = y * sw
    const dst = y * dw
    for (let x = 0; x < dw; x++) {
      const a = mask.data[src + (ax.lo[x] as number)] as number
      const b = mask.data[src + (ax.hi[x] as number)] as number
      rows[dst + x] = a + (b - a) * (ax.t[x] as number)
    }
  }
  const data = new Float32Array(dw * dh)
  for (let y = 0; y < dh; y++) {
    const r0 = (ay.lo[y] as number) * dw
    const r1 = (ay.hi[y] as number) * dw
    const t = ay.t[y] as number
    const out = y * dw
    for (let x = 0; x < dw; x++) {
      const a = rows[r0 + x] as number
      const b = rows[r1 + x] as number
      data[out + x] = a + (b - a) * t
    }
  }
  return { width: dw, height: dh, data }
}
