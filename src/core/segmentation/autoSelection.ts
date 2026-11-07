import { maskToRings, type CoverageMask } from '../contour'
import type { Selection } from '../selection/types'

/** The smart-edge band given to auto results, the width spec 0006's accuracy was measured at (spec 0007 decision 7). */
export const AUTO_BAND_PX = 8

/**
 * The selection an auto mask becomes (spec 0007 AC-13): rings traced from its
 * 50% line (spec 0005), the model's soft edge, no strokes, no feather.
 * `null` when nothing reaches 50%.
 */
export function autoSelection(mask: CoverageMask): Selection | null {
  const rings = maskToRings(mask)
  if (rings.length === 0) return null
  return {
    rings,
    softEdge: { source: 'model', bandPx: AUTO_BAND_PX },
    strokes: [],
    feather: 0,
  }
}
