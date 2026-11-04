import type { Size } from '../geometry/types'
import type { Selection, SoftEdge } from '../selection/types'
import { feather } from './feather'
import { rasterizeRings } from './rasterize'
import { applyStrokes } from './strokes'
import { toAlphaMask, type AlphaMask } from './types'

/**
 * Pipeline step 2, supplied by the caller (guided filter in Phase 5, model
 * alpha in Phase 6). Receives the 0..1 coverage after the rings, before any
 * brush stroke, and refines it in place.
 */
export type EdgeRefiner = (
  mask: Float32Array,
  size: Size,
  softEdge: SoftEdge,
) => void

const isSize = (n: number): boolean => Number.isInteger(n) && n >= 1

/**
 * Renders the selection to an 8-bit alpha mask: (1) rings, (2) soft edge via
 * `refineEdge` when the selection has one, (3) brush strokes in order,
 * (4) feather, then one rounding. `scale` in (0, 1] renders a preview at
 * ⌈size · scale⌉ with geometry, brush sizes, soft-edge band and feather scaled.
 */
export function renderMask(
  selection: Selection,
  imageSize: Size,
  options: { scale?: number; refineEdge?: EdgeRefiner } = {},
): AlphaMask {
  if (!isSize(imageSize.width) || !isSize(imageSize.height)) {
    throw new RangeError(
      `image size must be positive integers, got ${String(imageSize.width)}×${String(imageSize.height)}`,
    )
  }
  const scale = options.scale ?? 1
  if (!(scale > 0 && scale <= 1)) {
    throw new RangeError(`scale must be in (0, 1], got ${String(scale)}`)
  }
  const size = {
    width: Math.ceil(imageSize.width * scale),
    height: Math.ceil(imageSize.height * scale),
  }
  const coverage = rasterizeRings(selection.rings, size, scale)
  if (selection.softEdge && options.refineEdge) {
    options.refineEdge(coverage, size, {
      ...selection.softEdge,
      bandPx: selection.softEdge.bandPx * scale,
    })
  }
  applyStrokes(coverage, size, selection.strokes, scale)
  feather(coverage, size, selection.feather * scale)
  return toAlphaMask(coverage, size)
}
