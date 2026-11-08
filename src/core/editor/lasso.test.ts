import { describe, expect, it } from 'vitest'
import { imageToCanvas, viewScale } from '../coords/transform'
import type { View, Viewport } from '../coords/types'
import { smoothPath } from '../geometry/smooth'
import type { Point } from '../geometry/types'
import {
  CLOSE_AWAY_PX,
  CLOSE_RADIUS_PX,
  closesOnLift,
  continueAt,
  joinSections,
  ringTolerance,
  sectionTolerance,
  snapReachPx,
  type LassoSection,
} from './lasso'

const vp: Viewport = {
  canvas: { width: 400, height: 300 },
  image: { width: 800, height: 600 },
  dpr: 1,
}
const zoom2: View = { zoom: 2, center: { x: 400, y: 300 } }

const raw = (points: Point[], tolerancePx = 1): LassoSection => ({
  points,
  snapped: false,
  tolerancePx,
})

describe('smoothPath', () => {
  it('should_keep_both_ends_when_smoothing_an_open_path (AC-15, AC-17)', () => {
    const zigzag = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      { x: 30, y: 10 },
      { x: 40, y: 0 },
    ]
    const out = smoothPath(zigzag, 2)
    expect(out[0]).toEqual({ x: 0, y: 0 })
    expect(out.at(-1)).toEqual({ x: 40, y: 0 })
    expect(out.length).toBeGreaterThan(zigzag.length)
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(40)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(10)
    }
    expect(smoothPath(zigzag, 0)).toEqual(zigzag)
  })
})

describe('lasso helpers', () => {
  it('should_give_one_screen_px_tolerance_within_limits (AC-15)', () => {
    expect(sectionTolerance(4, false)).toBe(0.25)
    expect(sectionTolerance(0.5, false)).toBe(2)
    expect(sectionTolerance(0.05, false)).toBe(8)
    expect(sectionTolerance(0.05, true)).toBe(0.5)
    expect(
      ringTolerance([
        raw([{ x: 0, y: 0 }], 2),
        raw([{ x: 0, y: 0 }], 0.5),
        raw([{ x: 0, y: 0 }], 8),
      ]),
    ).toBe(0.5)
  })

  it('should_convert_the_snap_reach_at_the_zoom (AC-11)', () => {
    expect(snapReachPx(3)).toBe(4)
  })

  it('should_close_only_after_going_away (AC-4)', () => {
    expect(CLOSE_RADIUS_PX).toBe(22)
    expect(CLOSE_AWAY_PX).toBe(44)
    const start = { x: 100, y: 100 }
    expect(closesOnLift([start, { x: 150, y: 100 }, { x: 121, y: 100 }])).toBe(
      true,
    )
    expect(closesOnLift([start, { x: 150, y: 100 }, { x: 123, y: 100 }])).toBe(
      false,
    )
    expect(closesOnLift([start, { x: 140, y: 100 }, { x: 105, y: 100 }])).toBe(
      false,
    )
  })

  it('should_join_sections_continuously (AC-15)', () => {
    const a = raw([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ])
    const b = raw([
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
    ])
    expect(joinSections([a, b], 0)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
    ])

    const snapped: LassoSection = {
      points: [
        { x: 20, y: 20 },
        { x: 30, y: 25 },
        { x: 40, y: 20 },
      ],
      snapped: true,
      tolerancePx: 0.5,
    }
    const joined = joinSections([a, snapped], 1)
    expect(joined.slice(-2)).toEqual([
      { x: 30, y: 25 },
      { x: 40, y: 20 },
    ])
    expect(joined[0]).toEqual({ x: 0, y: 0 })
    // The raw part is smoothed with its ends kept.
    expect(joined).toContainEqual({ x: 20, y: 0 })
    expect(joined.length).toBe(smoothPath(a.points, 1).length + 3)
  })

  it('should_continue_from_the_end_without_a_jump (AC-6)', () => {
    const end = { x: 412.3, y: 287.9 }
    const endCanvas = imageToCanvas(vp, zoom2, end)
    const down = { x: endCanvas.x + 5, y: endCanvas.y }
    const k = viewScale(vp, zoom2)
    expect(continueAt(end, down, down, vp, zoom2)).toEqual(end)
    const moved = continueAt(
      end,
      down,
      { x: down.x + 20, y: down.y + 10 },
      vp,
      zoom2,
    )
    expect(moved.x).toBeCloseTo(end.x + 20 / k, 9)
    expect(moved.y).toBeCloseTo(end.y + 10 / k, 9)
  })
})
