import type { Size } from '../geometry/types'

/** The photo pixel budget: 4096 × 3072 (spec 0008 decision 4). */
export const MAX_PHOTO_PIXELS = 12_582_912
/** The longest side a photo keeps, within every browser's canvas limit. */
export const MAX_PHOTO_SIDE_PX = 16_384

const isSize = (n: number) => Number.isInteger(n) && n > 0

/**
 * The size a W × H photo loads at (spec 0008 AC-2): unchanged when it fits
 * both limits, else ⌊W·s⌋ × ⌊H·s⌋ (each at least 1) with
 * s = min(√(MAX_PHOTO_PIXELS / (W·H)), MAX_PHOTO_SIDE_PX / max(W, H)).
 * Never enlarges.
 */
export function cappedSize(width: number, height: number): Size {
  if (!isSize(width) || !isSize(height)) {
    throw new RangeError(
      `size must be positive integers, got ${String(width)}×${String(height)}`,
    )
  }
  const long = Math.max(width, height)
  if (width * height <= MAX_PHOTO_PIXELS && long <= MAX_PHOTO_SIDE_PX) {
    return { width, height }
  }
  const s = Math.min(
    Math.sqrt(MAX_PHOTO_PIXELS / (width * height)),
    MAX_PHOTO_SIDE_PX / long,
  )
  let w = Math.max(1, Math.floor(width * s))
  let h = Math.max(1, Math.floor(height * s))
  // Float rounding can land one pixel over; shrink the longer side until it fits.
  while (w * h > MAX_PHOTO_PIXELS || Math.max(w, h) > MAX_PHOTO_SIDE_PX) {
    if (w >= h) w--
    else h--
  }
  return { width: w, height: h }
}
