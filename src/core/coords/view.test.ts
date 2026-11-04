import { describe, expect, it } from 'vitest'

import type { Point } from '../geometry/types'
import { canvasToImage, viewScale } from './transform'
import type { View, Viewport } from './types'
import { applyTwoFingerGesture, clampView, toggleActualSize } from './view'

// fitScale = min(400/4000, 800/3000) = 0.1
const vp: Viewport = {
  canvas: { width: 400, height: 800 },
  image: { width: 4000, height: 3000 },
  dpr: 2,
}
const start: View = { zoom: 4, center: { x: 2000, y: 1500 } }

const mid = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
})

const expectClose = (a: Point, b: Point, tol = 0.01) => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(tol)
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol)
}

type Pair = readonly [Point, Point]

describe('pinch and pan', () => {
  // AC-5
  it.each<{ name: string; from: Pair; to: Pair }>([
    {
      name: 'pure zoom in',
      from: [
        { x: 150, y: 300 },
        { x: 250, y: 300 },
      ],
      to: [
        { x: 125, y: 300 },
        { x: 275, y: 300 },
      ],
    },
    {
      name: 'pure pan',
      from: [
        { x: 150, y: 300 },
        { x: 250, y: 300 },
      ],
      to: [
        { x: 180, y: 280 },
        { x: 280, y: 280 },
      ],
    },
    {
      name: 'zoom and pan',
      from: [
        { x: 100, y: 500 },
        { x: 200, y: 600 },
      ],
      to: [
        { x: 60, y: 420 },
        { x: 240, y: 560 },
      ],
    },
    {
      name: 'zoom out',
      from: [
        { x: 100, y: 400 },
        { x: 300, y: 400 },
      ],
      to: [
        { x: 125, y: 410 },
        { x: 275, y: 410 },
      ],
    },
    {
      name: 'rotated fingers',
      from: [
        { x: 150, y: 400 },
        { x: 250, y: 400 },
      ],
      to: [
        { x: 200, y: 350 },
        { x: 200, y: 450 },
      ],
    },
  ])(
    'should_keep_the_anchor_image_point_under_the_midpoint ($name)',
    ({ from, to }) => {
      const result = applyTwoFingerGesture(vp, start, from, to)
      expectClose(
        canvasToImage(vp, result, mid(...to)),
        canvasToImage(vp, start, mid(...from)),
      )
    },
  )

  // AC-6
  it('should_clamp_zoom_between_1_and_16', () => {
    const spread = applyTwoFingerGesture(
      vp,
      start,
      [
        { x: 150, y: 400 },
        { x: 250, y: 400 },
      ],
      [
        { x: -300, y: 400 },
        { x: 700, y: 400 },
      ],
    )
    expect(spread.zoom).toBe(16)
    // anchor still holds where the clamp allows (midpoint is the canvas centre)
    expectClose(
      canvasToImage(vp, spread, { x: 200, y: 400 }),
      canvasToImage(vp, start, { x: 200, y: 400 }),
    )

    const pinch = applyTwoFingerGesture(
      vp,
      { zoom: 1, center: { x: 2000, y: 1500 } },
      [
        { x: 150, y: 400 },
        { x: 250, y: 400 },
      ],
      [
        { x: 190, y: 400 },
        { x: 210, y: 400 },
      ],
    )
    expect(pinch.zoom).toBe(1)
  })

  // AC-7
  it('should_clamp_center_inside_the_image_and_fix_axes_that_fit', () => {
    expect(clampView(vp, { zoom: 4, center: { x: -5000, y: 99999 } })).toEqual({
      zoom: 4,
      center: { x: 0, y: 3000 },
    })
    // zoom 1.5: scaled image 600×450 → x is free, y fits in 800 and is fixed
    expect(clampView(vp, { zoom: 1.5, center: { x: 3900, y: 100 } })).toEqual({
      zoom: 1.5,
      center: { x: 3900, y: 1500 },
    })
    // zoom 1: everything fits
    expect(clampView(vp, { zoom: 1, center: { x: 10, y: 10 } })).toEqual({
      zoom: 1,
      center: { x: 2000, y: 1500 },
    })
    // zoom 4: both axes free within [0, size]
    expect(clampView(vp, { zoom: 4, center: { x: 123.5, y: 2999 } })).toEqual({
      zoom: 4,
      center: { x: 123.5, y: 2999 },
    })
    // zoom outside the range is clamped too
    expect(clampView(vp, { zoom: 40, center: { x: 1, y: 1 } }).zoom).toBe(16)
    expect(clampView(vp, { zoom: 0.5, center: { x: 1, y: 1 } }).zoom).toBe(1)
  })

  // AC-8
  it('should_toggle_actual_size_anchored_at_the_tap_and_back_to_fit', () => {
    const fit: View = { zoom: 1, center: { x: 2000, y: 1500 } }
    const tap = { x: 100, y: 300 }
    const actual = toggleActualSize(vp, fit, tap)
    expect(viewScale(vp, actual)).toBeCloseTo(1 / vp.dpr, 9)
    expectClose(canvasToImage(vp, actual, tap), canvasToImage(vp, fit, tap))

    const back = toggleActualSize(vp, actual, { x: 10, y: 10 })
    expect(back).toEqual(fit)
  })

  it('should_clamp_actual_size_into_the_zoom_range (AC-8)', () => {
    const small: Viewport = {
      canvas: { width: 400, height: 400 },
      image: { width: 100, height: 100 },
      dpr: 1,
    }
    // actual size would be zoom 0.25 → clamped to 1
    const s = toggleActualSize(
      small,
      { zoom: 1, center: { x: 50, y: 50 } },
      { x: 10, y: 10 },
    )
    expect(s.zoom).toBe(1)

    const huge: Viewport = {
      canvas: { width: 400, height: 400 },
      image: { width: 100000, height: 100000 },
      dpr: 1,
    }
    // actual size would be zoom 250 → clamped to 16
    const h = toggleActualSize(
      huge,
      { zoom: 1, center: { x: 50000, y: 50000 } },
      { x: 200, y: 200 },
    )
    expect(h.zoom).toBe(16)
  })

  // AC-20
  it('should_ignore_zoom_when_start_fingers_coincide', () => {
    const p = { x: 100, y: 300 }
    const to: Pair = [
      { x: 150, y: 320 },
      { x: 170, y: 340 },
    ]
    const result = applyTwoFingerGesture(vp, start, [p, p], to)
    expect(result.zoom).toBe(start.zoom)
    expect(Number.isFinite(result.center.x)).toBe(true)
    expect(Number.isFinite(result.center.y)).toBe(true)
    expectClose(
      canvasToImage(vp, result, mid(...to)),
      canvasToImage(vp, start, p),
    )
  })

  // AC-7, fractional canvas widths (float rounding on the limiting axis)
  it('should_keep_a_fitted_image_centred_for_fractional_canvas_sizes', () => {
    for (let w = 300; w <= 500; w += 0.25) {
      for (const imageWidth of [2268, 3024, 4032, 1179, 3000]) {
        const fvp: Viewport = {
          canvas: { width: w, height: 2000 },
          image: { width: imageWidth, height: 1000 },
          dpr: 2.625,
        }
        const v = clampView(fvp, { zoom: 1, center: { x: 0, y: 0 } })
        expect(v.center.x).toBe(imageWidth / 2)
        expect(v.center.y).toBe(500)
      }
    }
  })

  // AC-19
  it('should_throw_range_error_for_non_finite_views_and_fingers', () => {
    const p = { x: 1, y: 1 }
    const nan = { x: Number.NaN, y: 1 }
    expect(() =>
      clampView(vp, { zoom: Number.NaN, center: { x: 1, y: 1 } }),
    ).toThrow(RangeError)
    expect(() =>
      clampView(vp, { zoom: 2, center: { x: Number.NaN, y: 1 } }),
    ).toThrow(RangeError)
    expect(() => applyTwoFingerGesture(vp, start, [p, p], [p, nan])).toThrow(
      RangeError,
    )
    expect(() => applyTwoFingerGesture(vp, start, [nan, p], [p, p])).toThrow(
      RangeError,
    )
    expect(() => toggleActualSize(vp, start, nan)).toThrow(RangeError)
  })
})
