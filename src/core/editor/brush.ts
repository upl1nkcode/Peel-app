import { loupeScale } from './loupe'

/** The brush's size range, in whole image px (spec 0011 AC-19). */
export const BRUSH_MIN_PX = 1
export const BRUSH_MAX_PX = 1000
/** The size the first time Brush opens on a photo, in CSS px (Decision 9). */
export const BRUSH_DEFAULT_CSS_PX = 40

const clampSize = (px: number) =>
  Math.min(BRUSH_MAX_PX, Math.max(BRUSH_MIN_PX, Math.round(px)))

/** The Size slider at s in [0, 1] → whole px in [1, 1000], logarithmic (AC-19). */
export function brushSizeAt(s: number): number {
  const t = Math.min(1, Math.max(0, s))
  return clampSize(BRUSH_MIN_PX * (BRUSH_MAX_PX / BRUSH_MIN_PX) ** t)
}

/** The slider position for a size (inverse of `brushSizeAt`). */
export function brushSliderAt(px: number): number {
  const size = clampSize(px)
  return Math.log(size / BRUSH_MIN_PX) / Math.log(BRUSH_MAX_PX / BRUSH_MIN_PX)
}

/** 40 CSS px at zoom `k` (CSS px per image px), in whole image px within range (AC-19). */
export function defaultBrushSize(k: number): number {
  return clampSize(BRUSH_DEFAULT_CSS_PX / k)
}

/**
 * The brush in the loupe (AC-20), in loupe CSS px: the outer radius at its
 * true size, and the radius where full strength ends (r × hardness, spec 0004
 * AC-9), or null at hardness 1. Hardness is in [0, 1].
 */
export function loupeBrushRadii(
  sizePx: number,
  hardness: number,
  k: number,
): { outer: number; inner: number | null } {
  const outer = (sizePx / 2) * loupeScale(k)
  return { outer, inner: hardness >= 1 ? null : outer * hardness }
}
