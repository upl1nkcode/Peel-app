import type { Point, Size } from '../geometry/types'

/** What is on screen: canvas size in CSS px, image size in image px, device pixel ratio. */
export interface Viewport {
  canvas: Size
  image: Size
  dpr: number
}

/**
 * `zoom` is relative to fit (1 = whole image visible, letterboxed).
 * `center` is the imagePt shown at the canvas centre.
 */
export interface View {
  zoom: number
  center: Point
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 16
