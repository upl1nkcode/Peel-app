import type { Point, Size } from '../geometry/types'

/** The loupe's size and position, in CSS px (spec 0009 AC-13, AC-14). */
export const LOUPE_DIAMETER_PX = 120
export const LOUPE_OFFSET_PX = 90
export const LOUPE_MAGNIFY = 4
export const LOUPE_MAX_CSS_PER_IMAGE_PX = 32

/**
 * The loupe's centre: 90 px above the finger, kept inside the canvas
 * horizontally, or 90 px below when it would cross the top edge.
 */
export function loupePlacement(
  fingerCanvasPt: Point,
  canvasSize: Size,
): { center: Point; below: boolean } {
  const r = LOUPE_DIAMETER_PX / 2
  const x =
    canvasSize.width < LOUPE_DIAMETER_PX
      ? canvasSize.width / 2
      : Math.min(canvasSize.width - r, Math.max(r, fingerCanvasPt.x))
  const aboveY = fingerCanvasPt.y - LOUPE_OFFSET_PX
  const below = aboveY - r < 0
  return {
    center: { x, y: below ? fingerCanvasPt.y + LOUPE_OFFSET_PX : aboveY },
    below,
  }
}

/** CSS px per image px inside the loupe: 4× the canvas, at most 32. */
export function loupeScale(cssPerImagePx: number): number {
  return Math.min(LOUPE_MAGNIFY * cssPerImagePx, LOUPE_MAX_CSS_PER_IMAGE_PX)
}
