import type { Bounds } from '../geometry/types'
import { EmptyMaskError, type AlphaMask, type RgbaImage } from './types'

/**
 * Integer pixel bounds (max exclusive) of every non-zero mask pixel, grown by
 * `paddingPx` (a non-negative integer) on each side; the result may extend
 * past the image. Throws `EmptyMaskError` when no pixel is non-zero.
 */
export function trimBounds(mask: AlphaMask, paddingPx: number): Bounds {
  if (!Number.isInteger(paddingPx) || paddingPx < 0) {
    throw new RangeError(
      `padding must be a non-negative integer, got ${String(paddingPx)}`,
    )
  }
  const { width: w, height: h, data } = mask
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (data[j * w + i] === 0) continue
      if (i < minX) minX = i
      if (i > maxX) maxX = i
      if (j < minY) minY = j
      maxY = j
    }
  }
  if (maxX < 0) throw new EmptyMaskError()
  return {
    minX: minX - paddingPx,
    minY: minY - paddingPx,
    maxX: maxX + 1 + paddingPx,
    maxY: maxY + 1 + paddingPx,
  }
}

/** Copies the integer rectangle `bounds` (max exclusive); parts outside the source are (0, 0, 0, 0). */
export function cropRgba(image: RgbaImage, bounds: Bounds): RgbaImage {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const data = new Uint8Array(width * height * 4)
  const x0 = Math.max(bounds.minX, 0)
  const x1 = Math.min(bounds.maxX, image.width)
  if (x1 > x0) {
    for (
      let y = Math.max(bounds.minY, 0);
      y < Math.min(bounds.maxY, image.height);
      y++
    ) {
      const from = (y * image.width + x0) * 4
      const to = ((y - bounds.minY) * width + (x0 - bounds.minX)) * 4
      data.set(image.data.subarray(from, from + (x1 - x0) * 4), to)
    }
  }
  return { width, height, data }
}
