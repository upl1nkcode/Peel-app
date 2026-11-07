import { describe, expect, it } from 'vitest'
import type { Viewport } from '../coords/types'
import {
  CHECKER_DARK,
  CHECKER_LIGHT,
  CHECKER_PX,
  checkerColourAt,
  displayScale,
  isCrisp,
  LOUPE_DIAMETER_PX,
  LOUPE_MAGNIFY,
  LOUPE_MAX_CSS_PER_IMAGE_PX,
  LOUPE_OFFSET_PX,
  loupePlacement,
  loupeScale,
  needsFinerMask,
  previewScale,
  VIEW_BACKGROUNDS,
  VIEW_LABELS,
  VIEW_MODES,
  viewPixel,
  type Rgb,
} from '.'

const expectRgb = (got: Rgb, want: readonly number[]) => {
  got.forEach((v, i) => {
    expect(v).toBeCloseTo(want[i] ?? Number.NaN, 9)
  })
}

describe('view colours', () => {
  const p: Rgb = [200, 100, 50]

  it('should_compute_each_view_colour (AC-11)', () => {
    expect(VIEW_MODES).toEqual([
      'overlay',
      'checkerboard',
      'black',
      'white',
      'red',
    ])
    expect(VIEW_MODES.map((m) => VIEW_LABELS[m])).toEqual([
      'Overlay',
      'Checkerboard',
      'Black',
      'White',
      'Red',
    ])
    expectRgb(viewPixel('overlay', p, 1, CHECKER_LIGHT), p)
    expectRgb(viewPixel('overlay', p, 0, CHECKER_LIGHT), [100, 50, 25])
    expectRgb(viewPixel('overlay', p, 0.5, CHECKER_LIGHT), [150, 75, 37.5])
    for (const mode of ['black', 'white', 'red'] as const) {
      expectRgb(viewPixel(mode, p, 0, CHECKER_LIGHT), VIEW_BACKGROUNDS[mode])
      expectRgb(viewPixel(mode, p, 1, CHECKER_LIGHT), p)
    }
    expect(VIEW_BACKGROUNDS).toEqual({
      black: [0, 0, 0],
      white: [255, 255, 255],
      red: [255, 0, 0],
    })
    expectRgb(viewPixel('checkerboard', p, 0.25, CHECKER_DARK), [
      0.25 * 200 + 0.75 * 207,
      0.25 * 100 + 0.75 * 207,
      0.25 * 50 + 0.75 * 214,
    ])
  })

  it('should_lay_out_the_checkerboard_in_8_px_squares (AC-11)', () => {
    expect(CHECKER_PX).toBe(8)
    expect(CHECKER_LIGHT).toEqual([255, 255, 255])
    expect(CHECKER_DARK).toEqual([207, 207, 214])
    expect(checkerColourAt(0, 0)).toEqual(CHECKER_LIGHT)
    expect(checkerColourAt(7.9, 7.9)).toEqual(CHECKER_LIGHT)
    expect(checkerColourAt(8, 0)).toEqual(CHECKER_DARK)
    expect(checkerColourAt(0, 8)).toEqual(CHECKER_DARK)
    expect(checkerColourAt(8, 8)).toEqual(CHECKER_LIGHT)
  })
})

describe('loupe', () => {
  const canvas = { width: 400, height: 600 }

  it('should_place_the_loupe_above_the_finger (AC-14)', () => {
    expect(LOUPE_DIAMETER_PX).toBe(120)
    expect(LOUPE_OFFSET_PX).toBe(90)
    expect(loupePlacement({ x: 200, y: 300 }, canvas)).toEqual({
      center: { x: 200, y: 210 },
      below: false,
    })
    expect(loupePlacement({ x: 10, y: 300 }, canvas).center.x).toBe(60)
    expect(loupePlacement({ x: 395, y: 300 }, canvas).center.x).toBe(340)
    expect(loupePlacement({ x: 200, y: 140 }, canvas)).toEqual({
      center: { x: 200, y: 230 },
      below: true,
    })
    expect(
      loupePlacement({ x: 90, y: 300 }, { width: 100, height: 600 }).center.x,
    ).toBe(50)
  })

  it('should_magnify_the_loupe_4x_up_to_32_px (AC-13)', () => {
    expect(LOUPE_MAGNIFY).toBe(4)
    expect(LOUPE_MAX_CSS_PER_IMAGE_PX).toBe(32)
    expect(loupeScale(0.5)).toBe(2)
    expect(loupeScale(4)).toBe(16)
    expect(loupeScale(12)).toBe(32)
  })
})

describe('preview scale', () => {
  const vp: Viewport = {
    canvas: { width: 400, height: 300 },
    image: { width: 4000, height: 3000 },
    dpr: 2,
  }
  const center = { x: 2000, y: 1500 }

  it('should_render_at_screen_resolution_below_100_percent (AC-9)', () => {
    const fit = { zoom: 1, center }
    expect(displayScale(vp, fit)).toBeCloseTo(0.2, 12)
    expect(previewScale(vp, fit)).toBeCloseTo(0.2, 12)
    expect(isCrisp(displayScale(vp, fit))).toBe(false)
    const deep = { zoom: 16, center }
    expect(displayScale(vp, deep)).toBeCloseTo(3.2, 12)
    expect(previewScale(vp, deep)).toBe(1)
    expect(isCrisp(displayScale(vp, deep))).toBe(true)
    expect(isCrisp(1)).toBe(false)
  })

  it('should_ask_for_a_finer_mask_only_when_zooming_in (AC-10)', () => {
    expect(needsFinerMask(null, 0.2)).toBe(true)
    expect(needsFinerMask(0.2, 0.2)).toBe(false)
    expect(needsFinerMask(0.2, 0.201)).toBe(false)
    expect(needsFinerMask(1, 0.5)).toBe(false)
    expect(needsFinerMask(0.2, 0.25)).toBe(true)
  })
})
