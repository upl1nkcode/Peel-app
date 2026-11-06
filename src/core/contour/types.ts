import type { Point } from '../geometry/types'
import type { AlphaMask } from '../mask/types'

/** The traced level: a pixel is selected when its value is ≥ 0.5. */
export const CONTOUR_LEVEL = 0.5

/** Selected fraction per pixel in [0, 1], row-major, `width × height`. */
export interface CoverageMask {
  width: number
  height: number
  data: Float32Array
}

/**
 * A closed traced line (first point not repeated). `hard[k]` marks points
 * that lie between pixel values of exactly 0 and exactly 1.
 */
export interface Contour {
  points: Point[]
  hard: boolean[]
}

export function fromAlphaMask(mask: AlphaMask): CoverageMask {
  const data = new Float32Array(mask.data.length)
  for (let k = 0; k < data.length; k++) data[k] = (mask.data[k] as number) / 255
  return { width: mask.width, height: mask.height, data }
}
