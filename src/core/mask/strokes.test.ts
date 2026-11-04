import { describe, expect, it } from 'vitest'
import type { Point, Size } from '../geometry/types'
import type { BrushStroke } from '../selection/types'
import { mulberry32 } from '../../test/random'
import { applyStrokes, strokeStrength } from './strokes'

const filled = (size: Size, v: number) =>
  new Float32Array(size.width * size.height).fill(v)

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

describe('strokeStrength', () => {
  it('should_follow_the_brush_profile (AC-9)', () => {
    const r = 5
    for (const h of [0, 0.25, 0.5, 1]) {
      let prev = Infinity
      for (let k = 0; k <= 800; k++) {
        const d = k / 100
        const a = strokeStrength(d, r, h)
        if (d <= r * h - 0.5) expect(a).toBe(1)
        if (d >= r + 0.5) expect(a).toBe(0)
        expect(a).toBeLessThanOrEqual(prev)
        prev = a
      }
    }
    for (let k = 0; k <= 800; k++) {
      const d = k / 100
      const a = strokeStrength(d, r, 1)
      const soft = a > 0 && a < 1
      expect(soft).toBe(d > r - 0.5 && d < r + 0.5)
    }
  })
})

describe('applyStrokes', () => {
  it('should_size_the_brush_in_image_pixels (AC-9)', () => {
    const size = { width: 41, height: 41 }
    const m = filled(size, 1)
    const stroke: BrushStroke = {
      mode: 'erase',
      sizePx: 10,
      hardness: 1,
      points: [{ x: 20.5, y: 20.5 }],
    }
    applyStrokes(m, size, [stroke])
    for (let j = 0; j < 41; j++) {
      for (let i = 0; i < 41; i++) {
        const d = Math.hypot(i - 20, j - 20)
        const v = m[j * 41 + i] as number
        if (d <= 4.5) expect(v).toBe(0)
        if (d >= 5.5) expect(v).toBe(1)
      }
    }
  })

  it('should_erase_and_restore_in_order (AC-10)', () => {
    const size = { width: 24, height: 20 }
    const erase: BrushStroke = {
      mode: 'erase',
      sizePx: 8,
      hardness: 0.3,
      points: [{ x: 10.5, y: 10.5 }],
    }
    const restore: BrushStroke = {
      mode: 'restore',
      sizePx: 6,
      hardness: 0.6,
      points: [
        { x: 6, y: 10 },
        { x: 16, y: 12 },
      ],
    }
    const a1 = (i: number, j: number) =>
      strokeStrength(Math.hypot(i + 0.5 - 10.5, j + 0.5 - 10.5), 4, 0.3)
    const a2 = (i: number, j: number) =>
      strokeStrength(
        segDist({ x: i + 0.5, y: j + 0.5 }, { x: 6, y: 10 }, { x: 16, y: 12 }),
        3,
        0.6,
      )
    const eraseFirst = filled(size, 0.8)
    applyStrokes(eraseFirst, size, [erase, restore])
    const restoreFirst = filled(size, 0.8)
    applyStrokes(restoreFirst, size, [restore, erase])
    const fromEmpty = filled(size, 0)
    applyStrokes(fromEmpty, size, [restore])
    for (let j = 0; j < 20; j++) {
      for (let i = 0; i < 24; i++) {
        const k = j * 24 + i
        const m1 = 0.8 * (1 - a1(i, j))
        expect(eraseFirst[k]).toBeCloseTo(m1 + a2(i, j) * (1 - m1), 6)
        const r1 = 0.8 + a2(i, j) * (1 - 0.8)
        expect(restoreFirst[k]).toBeCloseTo(r1 * (1 - a1(i, j)), 6)
        expect(fromEmpty[k]).toBeCloseTo(a2(i, j), 6)
      }
    }
  })

  it('should_not_double_count_a_self_overlapping_stroke (AC-10)', () => {
    const size = { width: 30, height: 20 }
    const a = { x: 5.2, y: 6.1 }
    const b = { x: 24.7, y: 13.3 }
    const stroke = (points: Point[]): BrushStroke => ({
      mode: 'erase',
      sizePx: 7,
      hardness: 0.4,
      points,
    })
    const once = filled(size, 1)
    applyStrokes(once, size, [stroke([a, b])])
    const back = filled(size, 1)
    applyStrokes(back, size, [stroke([a, b, a])])
    expect(back).toEqual(once)
  })

  it('should_clip_strokes_to_the_image (AC-11)', () => {
    const size = { width: 10, height: 8 }
    const across = filled(size, 1)
    applyStrokes(across, size, [
      {
        mode: 'erase',
        sizePx: 3,
        hardness: 1,
        points: [
          { x: -20, y: 4 },
          { x: 30, y: 4 },
        ],
      },
    ])
    expect(across.length).toBe(80)
    expect(across[4 * 10 + 5]).toBe(0)
    expect(across[0]).toBe(1)
    const outside = filled(size, 0.5)
    applyStrokes(outside, size, [
      { mode: 'erase', sizePx: 4, hardness: 1, points: [{ x: 50, y: -40 }] },
    ])
    expect(outside).toEqual(filled(size, 0.5))
  })

  it('should_handle_tiny_and_huge_brushes (Review Focus 3)', () => {
    const size = { width: 5, height: 5 }
    const tiny = filled(size, 1)
    applyStrokes(tiny, size, [
      { mode: 'erase', sizePx: 0.1, hardness: 1, points: [{ x: 2.5, y: 2.5 }] },
    ])
    expect(tiny[12]).toBeCloseTo(1 - strokeStrength(0, 0.05, 1), 6)
    expect(tiny[12]).toBeLessThan(1)
    expect(tiny[11]).toBe(1)
    const huge = filled(size, 1)
    applyStrokes(huge, size, [
      { mode: 'erase', sizePx: 100, hardness: 1, points: [{ x: 2, y: 2 }] },
    ])
    expect(huge).toEqual(filled(size, 0))
  })

  it('should_scale_sizes_and_points (AC-21)', () => {
    const size = { width: 20, height: 20 }
    const scaled = filled(size, 1)
    applyStrokes(
      scaled,
      size,
      [
        {
          mode: 'erase',
          sizePx: 12,
          hardness: 0.5,
          points: [{ x: 20, y: 22 }],
        },
      ],
      0.5,
    )
    const direct = filled(size, 1)
    applyStrokes(direct, size, [
      { mode: 'erase', sizePx: 6, hardness: 0.5, points: [{ x: 10, y: 11 }] },
    ])
    expect(scaled).toEqual(direct)
  })
})

describe('applyStrokes against brute force', () => {
  it('should_match_the_brute_force_distance_on_any_polyline (AC-9, AC-10)', () => {
    const size = { width: 48, height: 40 }
    for (let seed = 1; seed <= 60; seed++) {
      const rand = mulberry32(seed)
      const n = 1 + Math.floor(rand() * 7)
      const points: Point[] = []
      for (let k = 0; k < n; k++) {
        // Repeats, reversals and sharp turns on purpose.
        const prev = points[k - 1]
        if (prev && rand() < 0.15) points.push({ ...prev })
        else if (k >= 2 && rand() < 0.15)
          points.push({ ...(points[k - 2] as Point) })
        else points.push({ x: -6 + rand() * 60, y: -6 + rand() * 52 })
      }
      const stroke: BrushStroke = {
        mode: 'erase',
        sizePx: 0.5 + rand() * 24,
        hardness: rand() < 0.2 ? 1 : rand(),
        points,
      }
      const got = filled(size, 1)
      applyStrokes(got, size, [stroke])
      const r = stroke.sizePx / 2
      for (let j = 0; j < size.height; j++) {
        for (let i = 0; i < size.width; i++) {
          const p = { x: i + 0.5, y: j + 0.5 }
          let d = Infinity
          for (let k = 0; k < Math.max(1, n - 1); k++) {
            d = Math.min(
              d,
              segDist(
                p,
                points[k] as Point,
                points[Math.min(k + 1, n - 1)] as Point,
              ),
            )
          }
          const want = 1 - strokeStrength(d, r, stroke.hardness)
          const v = got[j * size.width + i] as number
          if (Math.abs(v - want) > 1e-6) {
            throw new Error(
              `seed ${String(seed)} pixel (${String(i)}, ${String(j)}): ${String(v)} vs ${String(want)}`,
            )
          }
        }
      }
    }
  })
})
