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
