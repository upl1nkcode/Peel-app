import { viewScale } from '../coords/transform'
import type { View, Viewport } from '../coords/types'

/** Held renders within 1% of the wanted scale are fine enough. */
const FINER_TOLERANCE = 0.01

/** Float rounding can land 100% an ulp away from 1 (spec 0009 AC-8). */
const UNIT_SNAP = 1e-9

/** Device px per image px; 1 is 100% (spec 0001 AC-8), snapped within 1e-9. */
export function displayScale(vp: Viewport, view: View): number {
  const scale = viewScale(vp, view) * vp.dpr
  return Math.abs(scale - 1) <= UNIT_SNAP ? 1 : scale
}

/** At 100% and above, photo pixels are drawn as crisp squares (spec 0009 AC-8). */
export function isCrisp(scale: number): boolean {
  return scale >= 1
}

/** The mask scale to render: screen resolution below 100%, else full (AC-9). */
export function previewScale(vp: Viewport, view: View): number {
  return Math.min(1, displayScale(vp, view))
}

/** Only zooming in past the held render asks for a new one (AC-10). */
export function needsFinerMask(
  heldScale: number | null,
  wanted: number,
): boolean {
  return heldScale === null || wanted > heldScale * (1 + FINER_TOLERANCE)
}

/** The smallest photo copy drawn is 1/64 of the photo's width (spec 0010 AC-20). */
export const MAX_PHOTO_DIVISOR = 64

/**
 * Below 50% the photo is drawn from a copy 1/d of its size, the smallest
 * that is still at least as fine as the screen (`scale` device px per image
 * px), so a 12 MP photo isn't filtered down whole every frame (spec 0010
 * AC-20). Display only: renders and saves always use the full photo.
 */
export function photoDivisor(scale: number): number {
  if (Number.isNaN(scale) || scale > 0.5) return 1
  let d = 1
  while (d < MAX_PHOTO_DIVISOR && 1 / (2 * d) >= scale) d *= 2
  return d
}
