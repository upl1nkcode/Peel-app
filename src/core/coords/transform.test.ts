import { describe, expect, it } from 'vitest'

import type { Point } from '../geometry/types'
import {
  canvasToDevice,
  canvasToImage,
  fitScale,
  imageToCanvas,
  initialView,
  screenToCanvas,
  viewScale,
} from './transform'
import type { View, Viewport } from './types'

const grid3 = (w: number, h: number): Point[] => {
  const pts: Point[] = []
  for (const fx of [0.1, 0.5, 0.9]) {
    for (const fy of [0.1, 0.5, 0.9]) pts.push({ x: w * fx, y: h * fy })
  }
  return pts
}

describe('coordinate transforms', () => {
  // AC-1
  it('should_round_trip_within_0_01_px_for_all_dpr_zoom_and_pan', () => {
    for (const dpr of [1, 2, 2.625, 3]) {
      const vp: Viewport = {
        canvas: { width: 393.3, height: 707.7 },
        image: { width: 4032, height: 3024 },
        dpr,
      }
      for (const zoom of [1, 1.5, 4, 16]) {
        for (const center of grid3(vp.image.width, vp.image.height)) {
          const view: View = { zoom, center }
          for (const canvasPt of grid3(vp.canvas.width, vp.canvas.height)) {
            const back = imageToCanvas(
              vp,
              view,
              canvasToImage(vp, view, canvasPt),
            )
            expect(Math.abs(back.x - canvasPt.x)).toBeLessThan(0.01)
            expect(Math.abs(back.y - canvasPt.y)).toBeLessThan(0.01)
          }
        }
      }
    }
  })

  // AC-2
  it.each([
    {
      name: 'portrait in square',
      vp: {
        canvas: { width: 400, height: 400 },
        image: { width: 300, height: 600 },
        dpr: 2,
      },
    },
    {
      name: 'landscape in tall',
      vp: {
        canvas: { width: 400, height: 800 },
        image: { width: 600, height: 300 },
        dpr: 3,
      },
    },
  ])('should_center_a_letterboxed_image_at_zoom_1 ($name)', ({ vp }) => {
    const view = initialView(vp)
    const tl = imageToCanvas(vp, view, { x: 0, y: 0 })
    const br = imageToCanvas(vp, view, {
      x: vp.image.width,
      y: vp.image.height,
    })
    const left = tl.x
    const right = vp.canvas.width - br.x
    const top = tl.y
    const bottom = vp.canvas.height - br.y
    const imageAspect = vp.image.width / vp.image.height
    const canvasAspect = vp.canvas.width / vp.canvas.height
    if (imageAspect < canvasAspect) {
      // limited by height
      expect(top).toBeCloseTo(0, 9)
      expect(bottom).toBeCloseTo(0, 9)
      expect(left).toBeGreaterThan(0)
      expect(left).toBeCloseTo(right, 9)
    } else {
      expect(left).toBeCloseTo(0, 9)
      expect(right).toBeCloseTo(0, 9)
      expect(top).toBeGreaterThan(0)
      expect(top).toBeCloseTo(bottom, 9)
    }
  })

  // AC-3: canvas 400×400, image 800×400 → fitScale 0.5, centre (400, 200)
  const vp3: Viewport = {
    canvas: { width: 400, height: 400 },
    image: { width: 800, height: 400 },
    dpr: 1,
  }
  const fit3: View = { zoom: 1, center: { x: 400, y: 200 } }
  const zoomed3: View = { zoom: 4, center: { x: 100, y: 100 } }
  it.each([
    { view: fit3, canvasPt: { x: 200, y: 200 }, imagePt: { x: 400, y: 200 } },
    { view: fit3, canvasPt: { x: 0, y: 100 }, imagePt: { x: 0, y: 0 } },
    { view: fit3, canvasPt: { x: 400, y: 300 }, imagePt: { x: 800, y: 400 } },
    { view: fit3, canvasPt: { x: 0, y: 0 }, imagePt: { x: 0, y: -200 } },
    { view: fit3, canvasPt: { x: 400, y: 400 }, imagePt: { x: 800, y: 600 } },
    {
      view: zoomed3,
      canvasPt: { x: 200, y: 200 },
      imagePt: { x: 100, y: 100 },
    },
    { view: zoomed3, canvasPt: { x: 0, y: 0 }, imagePt: { x: 0, y: 0 } },
    { view: zoomed3, canvasPt: { x: 10, y: 390 }, imagePt: { x: 5, y: 195 } },
  ])(
    'should_match_hand_computed_points $canvasPt.x,$canvasPt.y',
    ({ view, canvasPt, imagePt }) => {
      const got = canvasToImage(vp3, view, canvasPt)
      expect(got.x).toBeCloseTo(imagePt.x, 9)
      expect(got.y).toBeCloseTo(imagePt.y, 9)
    },
  )

  it('should_not_clamp_off_image_points (AC-3)', () => {
    const got = canvasToImage(vp3, fit3, { x: 0, y: 0 })
    expect(got.y).toBeLessThan(0)
    expect(fitScale(vp3)).toBe(0.5)
    expect(viewScale(vp3, zoomed3)).toBe(2)
  })

  // AC-4
  it('should_subtract_origin_and_scale_by_dpr', () => {
    expect(screenToCanvas({ x: 12, y: 30.5 }, { x: 112, y: 80.5 })).toEqual({
      x: 100,
      y: 50,
    })
    const vp: Viewport = { ...vp3, dpr: 2.625 }
    expect(canvasToDevice(vp, { x: 100, y: 50 })).toEqual({
      x: 262.5,
      y: 131.25,
    })
  })

  // AC-19
  it.each([
    {
      name: 'zero canvas width',
      vp: { ...vp3, canvas: { width: 0, height: 400 } },
      view: fit3,
    },
    {
      name: 'negative image height',
      vp: { ...vp3, image: { width: 800, height: -1 } },
      view: fit3,
    },
    { name: 'zero dpr', vp: { ...vp3, dpr: 0 }, view: fit3 },
    { name: 'NaN dpr', vp: { ...vp3, dpr: Number.NaN }, view: fit3 },
    {
      name: 'NaN zoom',
      vp: vp3,
      view: { zoom: Number.NaN, center: { x: 1, y: 1 } },
    },
    {
      name: 'infinite centre',
      vp: vp3,
      view: { zoom: 1, center: { x: Infinity, y: 1 } },
    },
  ])(
    'should_throw_range_error_for_degenerate_viewports ($name)',
    ({ vp, view }) => {
      expect(() => viewScale(vp, view)).toThrow(RangeError)
      expect(() => canvasToImage(vp, view, { x: 1, y: 1 })).toThrow(RangeError)
      expect(() => imageToCanvas(vp, view, { x: 1, y: 1 })).toThrow(RangeError)
    },
  )

  it('should_throw_range_error_for_degenerate_viewports in fitScale and canvasToDevice (AC-19)', () => {
    const bad: Viewport = { ...vp3, dpr: -1 }
    expect(() => fitScale(bad)).toThrow(RangeError)
    expect(() => canvasToDevice(bad, { x: 1, y: 1 })).toThrow(RangeError)
    expect(() => initialView(bad)).toThrow(RangeError)
  })
})
