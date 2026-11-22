import { describe, expect, it } from 'vitest'
import { fromAlphaMask } from '../contour'
import type { RgbaImage } from '../mask/types'
import { autoSelection } from '../segmentation/autoSelection'
import { scoreCutout, type Mask } from './score'
import {
  dotsRoundTrip,
  finishedAlpha,
  lassoAlpha,
  resizeMask,
  secondTap,
  sizeFor,
  traceZoom,
} from './stages'

/** A soft-rimmed disc of radius `r` (px) at the centre of a w × h image. */
function disc(w: number, h: number, r: number): Mask {
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2)
      data[y * w + x] = Math.round(255 * Math.min(1, Math.max(0, r - d + 0.5)))
    }
  }
  return { width: w, height: h, data }
}

/** A dark subject on white, drawn from its truth (so photo and truth line up exactly). */
function photoOf(truth: Mask): RgbaImage {
  const data = new Uint8Array(truth.width * truth.height * 4)
  for (let i = 0; i < truth.data.length; i++) {
    const a = (truth.data[i] as number) / 255
    const v = Math.round(255 * (1 - a) + 30 * a)
    data.set([v, v, v, 255], i * 4)
  }
  return { width: truth.width, height: truth.height, data }
}

const resizePhoto = (img: RgbaImage, w: number, h: number): RgbaImage => {
  const m = resizeMask(
    {
      width: img.width,
      height: img.height,
      data: img.data.filter((_, i) => i % 4 === 0),
    },
    w,
    h,
  )
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i] as number
    data.set([v, v, v, 255], i * 4)
  }
  return { width: w, height: h, data }
}

describe('accuracy stages (spec 0014)', () => {
  it('should_size_the_ladder_without_enlarging (AC-6)', () => {
    expect(sizeFor({ width: 1600, height: 1000 }, 600)).toEqual({
      width: 600,
      height: 375,
    })
    expect(sizeFor({ width: 1000, height: 1600 }, 400)).toEqual({
      width: 250,
      height: 400,
    })
    expect(sizeFor({ width: 800, height: 500 }, 1000)).toEqual({
      width: 800,
      height: 500,
    })
  })

  it('should_score_the_truth_as_perfect_at_every_size (AC-6, Review Focus 1)', () => {
    const truth = disc(1600, 1000, 300)
    const photo = photoOf(truth)
    for (const n of [1000, 600, 400]) {
      const { width, height } = sizeFor(truth, n)
      const t = resizeMask(truth, width, height)
      const self = scoreCutout(t, t)
      expect(self.iou).toBe(1)
      expect(self.edgeMean).toBe(0)
      if (n !== 400) continue
      const image = resizePhoto(photo, width, height)
      const done = finishedAlpha(image, {
        alpha: t,
        selection: autoSelection(fromAlphaMask(t)),
      })
      expect(scoreCutout(done, t).iou).toBeGreaterThanOrEqual(0.999)
    }
  })

  it('should_score_an_empty_auto_result_as_a_miss (AC-4, Review Focus 2)', () => {
    const truth = disc(80, 60, 20)
    const empty = { width: 80, height: 60, data: new Uint8Array(80 * 60) }
    const done = finishedAlpha(photoOf(truth), {
      alpha: empty,
      selection: null,
    })
    expect(done.data.every((a) => a === 0)).toBe(true)
    const s = scoreCutout(done, truth)
    expect(s.iou).toBe(0)
    expect(s.edgeMean).toBe(Infinity)
  })

  it('should_follow_a_clean_edge_with_the_lasso (AC-5)', () => {
    const truth = disc(200, 200, 60)
    const image = photoOf(truth)
    const loose = lassoAlpha(image, truth, { seed: 1, snap: false })
    expect(scoreCutout(loose, truth).iou).toBeGreaterThanOrEqual(0.97)
    const snapped = lassoAlpha(image, truth, { seed: 1, snap: true })
    expect(scoreCutout(snapped, truth).edgeMean).toBeLessThanOrEqual(1)
  })

  it('should_subtract_holes_with_the_lasso (AC-5, final review)', () => {
    // A disc of radius 70 with a hole of radius 30 (18% of its area) and a
    // pinhole of radius 3 (under 1%, which no finger would trace).
    const w = 220
    const h = 220
    const data = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x + 0.5 - 110, y + 0.5 - 110)
        const pin = Math.hypot(x + 0.5 - 110, y + 0.5 - 165)
        const inside = d <= 70 && d >= 30 && pin >= 3
        data[y * w + x] = inside ? 255 : 0
      }
    }
    const truth: Mask = { width: w, height: h, data }
    const got = lassoAlpha(photoOf(truth), truth, { seed: 1, snap: false })
    expect(got.data[110 * w + 110], 'the hole is empty').toBe(0)
    expect(got.data[165 * w + 110], 'the pinhole is not traced').toBe(255)
    expect(scoreCutout(got, truth).iou).toBeGreaterThanOrEqual(0.95)
  })

  it('should_keep_a_result_through_the_dots_round_trip (AC-7)', () => {
    const truth = disc(240, 180, 60)
    const image = photoOf(truth)
    const auto = {
      alpha: truth,
      selection: autoSelection(fromAlphaMask(truth)),
    }
    const done = finishedAlpha(image, auto)
    const back = dotsRoundTrip(done, image, auto.selection?.softEdge, truth)
    const a = scoreCutout(done, truth)
    const b = scoreCutout(back, truth)
    expect(Math.abs(a.iou - b.iou)).toBeLessThanOrEqual(0.002)
    expect(Math.abs(a.edgeMean - b.edgeMean)).toBeLessThanOrEqual(0.1)

    const lasso = lassoAlpha(image, truth, { seed: 2, snap: false })
    const lassoBack = dotsRoundTrip(lasso, image, undefined)
    const c = scoreCutout(lasso, truth)
    const d = scoreCutout(lassoBack, truth)
    expect(Math.abs(c.iou - d.iou)).toBeLessThanOrEqual(0.002)
    expect(Math.abs(c.edgeMean - d.edgeMean)).toBeLessThanOrEqual(0.1)
  })

  it('should_pick_the_decision_12_zoom (AC-5)', () => {
    const data = new Uint8Array(1000 * 1000)
    for (let y = 100; y < 500; y++) {
      for (let x = 300; x < 500; x++) data[y * 1000 + x] = 255
    }
    expect(traceZoom({ width: 1000, height: 1000, data })).toBeCloseTo(
      0.9 * Math.min(390 / 200, 700 / 400),
      12,
    )
  })
})

describe('secondTap (spec 0015 AC-5)', () => {
  it('should_pick_a_second_tap_inside_the_subject (spec 0015 AC-5)', () => {
    const W = 60
    const H = 30
    const data = new Uint8Array(W * H)
    // A 40 × 20 bar, x 10–49, y 5–24, with a soft rim column on the right.
    for (let y = 5; y < 25; y++) {
      for (let x = 10; x < 50; x++) data[y * W + x] = x === 49 ? 128 : 255
    }
    const truth = { width: W, height: H, data }
    const first = { x: 10.5, y: 14.5 }
    const p = secondTap(truth, first)
    expect(data[Math.floor(p.y) * W + Math.floor(p.x)]).toBe(255)
    expect(Math.hypot(p.x - first.x, p.y - first.y)).toBeGreaterThanOrEqual(
      0.1 * Math.hypot(40, 20),
    )
    expect(secondTap(truth, first)).toEqual(p)
  })

  it('should_move_away_from_a_first_tap_at_the_centre (spec 0015 AC-5)', () => {
    const W = 50
    const data = new Uint8Array(W * W).fill(255)
    const truth = { width: W, height: W, data }
    const first = { x: 25, y: 25 }
    const p = secondTap(truth, first)
    expect(Math.hypot(p.x - first.x, p.y - first.y)).toBeGreaterThanOrEqual(
      0.1 * Math.hypot(50, 50),
    )
  })
})
