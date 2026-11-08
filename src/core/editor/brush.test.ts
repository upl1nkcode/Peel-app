import { describe, expect, it } from 'vitest'
import {
  BRUSH_DEFAULT_CSS_PX,
  BRUSH_MAX_PX,
  BRUSH_MIN_PX,
  brushSizeAt,
  brushSliderAt,
  defaultBrushSize,
  loupeBrushRadii,
} from './brush'
import { loupeScale } from './loupe'

describe('brush helpers', () => {
  it('should_map_the_size_slider_logarithmically (AC-19)', () => {
    expect(BRUSH_MIN_PX).toBe(1)
    expect(BRUSH_MAX_PX).toBe(1000)
    expect(brushSizeAt(0)).toBe(1)
    expect(brushSizeAt(1)).toBe(1000)
    expect(brushSizeAt(0.5)).toBe(32)
    for (const n of [1, 7, 40, 999])
      expect(brushSizeAt(brushSliderAt(n))).toBe(n)
  })

  it('should_default_to_40_screen_px (AC-19, Review Focus 4)', () => {
    expect(BRUSH_DEFAULT_CSS_PX).toBe(40)
    expect(defaultBrushSize(0.1)).toBe(400)
    expect(defaultBrushSize(64)).toBe(1)
    expect(defaultBrushSize(0.01)).toBe(1000)
  })

  it('should_size_the_loupe_circles (AC-20)', () => {
    const hard = loupeBrushRadii(20, 1, 1)
    expect(hard.outer).toBe(10 * loupeScale(1))
    expect(hard.inner).toBeNull()
    const soft = loupeBrushRadii(20, 0.5, 1)
    expect(soft.inner).toBe(soft.outer / 2)
  })
})
