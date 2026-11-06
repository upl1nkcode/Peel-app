import { describe, expect, it } from 'vitest'
import { maskToRings } from '../contour'
import { circle, maskOf, softMask } from '../../test/maskFixtures'
import { AUTO_BAND_PX, autoSelection } from './index'

describe('autoSelection', () => {
  it('should_build_the_auto_selection_from_a_mask (AC-13)', () => {
    const mask = softMask(
      [{ op: 'add', points: circle({ x: 40.3, y: 30.7 }, 18) }],
      { width: 80, height: 60 },
    )
    const sel = autoSelection(mask)
    expect(AUTO_BAND_PX).toBe(8)
    expect(sel).not.toBeNull()
    expect(sel?.rings).toEqual(maskToRings(mask))
    expect(sel?.softEdge).toEqual({ source: 'model', bandPx: 8 })
    expect(sel?.strokes).toEqual([])
    expect(sel?.feather).toBe(0)
    expect(autoSelection(maskOf(20, 10, () => 0))).toBeNull()
  })
})
