import { describe, expect, it } from 'vitest'
import type { Point } from '../geometry/types'
import { signedArea } from '../geometry/polygon'
import { traceContours } from './trace'
import { fromAlphaMask, type CoverageMask } from './types'

function maskOf(
  width: number,
  height: number,
  value: (i: number, j: number) => number,
): CoverageMask {
  const data = new Float32Array(width * height)
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) data[j * width + i] = value(i, j)
  }
  return { width, height, data }
}

const inRect =
  (x0: number, y0: number, x1: number, y1: number) => (i: number, j: number) =>
    i >= x0 && i < x1 && j >= y0 && j < y1 ? 1 : 0

const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y)

describe('traceContours', () => {
  it('should_trace_rectangle_edges_exactly (AC-1)', () => {
    const contours = traceContours(maskOf(12, 10, inRect(3, 2, 9, 7)))
    expect(contours).toHaveLength(1)
    const [c] = contours
    if (!c) throw new Error('no contour')
    const corners = [
      { x: 3, y: 2 },
      { x: 9, y: 2 },
      { x: 9, y: 7 },
      { x: 3, y: 7 },
    ]
    for (const p of c.points) {
      const onLine = p.x === 3 || p.x === 9 || p.y === 2 || p.y === 7
      expect(onLine).toBe(true)
      expect(p.x).toBeGreaterThanOrEqual(3)
      expect(p.x).toBeLessThanOrEqual(9)
      expect(p.y).toBeGreaterThanOrEqual(2)
      expect(p.y).toBeLessThanOrEqual(7)
    }
    // Every corner is cut by a chamfer whose ends are 0.5 px from the corner.
    for (const k of corners) {
      const d = Math.min(...c.points.map((p) => near(p, k)))
      expect(d).toBeCloseTo(0.5, 12)
    }
    expect(c.hard.every(Boolean)).toBe(true)
    expect(c.hard).toHaveLength(c.points.length)
  })

  it('should_trace_separate_blobs_and_join_diagonals (AC-2)', () => {
    const blobs = maskOf(20, 10, (i, j) =>
      Math.max(inRect(1, 1, 6, 6)(i, j), inRect(10, 3, 18, 9)(i, j)),
    )
    expect(traceContours(blobs)).toHaveLength(2)
    const diagonal = maskOf(6, 6, (i, j) =>
      (i === 2 && j === 2) || (i === 3 && j === 3) ? 1 : 0,
    )
    expect(traceContours(diagonal)).toHaveLength(1)
    const checker = maskOf(2, 2, (i, j) => ((i + j) % 2 === 0 ? 1 : 0))
    expect(traceContours(checker)).toHaveLength(1)
  })

  it('should_interpolate_soft_values (AC-3)', () => {
    // Row 1: … 0, 0.2, 0.8, 1, 1, 0.9, 0.3, 0 …
    const row = [0, 0.2, 0.8, 1, 1, 0.9, 0.3, 0]
    const mask = maskOf(8, 3, (i, j) => (j === 1 ? (row[i] as number) : 0))
    const [c] = traceContours(mask)
    if (!c) throw new Error('no contour')
    const onRow = c.points
      .map((p, k) => ({ p, hard: c.hard[k] }))
      .filter(({ p }) => p.y === 1.5)
    const xs = onRow.map(({ p }) => p.x).sort((a, b) => a - b)
    expect(xs).toHaveLength(2)
    // The interpolation runs on the stored (float32) values.
    const f = Math.fround
    const at = (x0: number, a: number, b: number) =>
      x0 + (0.5 - f(a)) / (f(b) - f(a))
    // Between centres 1.5 (0.2) and 2.5 (0.8): halfway, up to float32 storage.
    expect(Math.abs((xs[0] as number) - at(1.5, 0.2, 0.8))).toBeLessThan(1e-9)
    expect(Math.abs((xs[0] as number) - 2)).toBeLessThan(1e-7)
    // Between centres 5.5 (0.9) and 6.5 (0.3): (0.9 − 0.5) / 0.6 = 2/3 of the way.
    expect(Math.abs((xs[1] as number) - at(5.5, 0.9, 0.3))).toBeLessThan(1e-9)
    expect(onRow.every(({ hard }) => hard === false)).toBe(true)
  })

  it('should_close_contours_along_the_border (AC-4)', () => {
    const [full] = traceContours(maskOf(5, 4, () => 1))
    if (!full) throw new Error('no contour')
    for (const p of full.points) {
      expect(p.x === 0 || p.x === 5 || p.y === 0 || p.y === 4).toBe(true)
    }
    expect(Math.abs(signedArea(full.points))).toBeCloseTo(20 - 4 * 0.125, 12)

    const touching = traceContours(
      maskOf(9, 7, (i, j) =>
        i === 0 || j === 0 || i === 8 || j === 6 ? 1 : 0,
      ),
    )
    expect(touching).toHaveLength(2)

    const [single] = traceContours(maskOf(1, 1, () => 1))
    expect(single?.points).toHaveLength(4)
    const strip = traceContours(maskOf(1, 7, () => 1))
    expect(strip).toHaveLength(1)
    for (const p of strip[0]?.points ?? []) {
      expect(p.x === 0 || p.x === 1 || p.y === 0 || p.y === 7).toBe(true)
    }
  })

  it('should_accept_8_bit_masks_and_empty_ones (AC-5)', () => {
    const cov = fromAlphaMask({
      width: 3,
      height: 1,
      data: new Uint8Array([0, 51, 255]),
    })
    expect(cov.width).toBe(3)
    expect(cov.height).toBe(1)
    expect(Array.from(cov.data)).toEqual([0, 51 / 255, 1].map(Math.fround))
    expect(traceContours(maskOf(7, 5, () => 0))).toEqual([])
  })

  it('should_skip_contours_without_area (Review Focus 1)', () => {
    expect(
      traceContours(maskOf(5, 5, (i, j) => (i === 2 && j === 2 ? 0.5 : 0))),
    ).toEqual([])
    // A plateau at exactly 0.5 puts several crossings on one sample.
    const plateau = maskOf(9, 9, (i, j) => {
      if (i >= 3 && i < 6 && j >= 3 && j < 6) return 1
      if (i >= 2 && i < 7 && j >= 2 && j < 7) return 0.5
      return 0
    })
    for (const c of traceContours(plateau)) {
      const n = c.points.length
      for (let k = 0; k < n; k++) {
        const p = c.points[k] as Point
        const q = c.points[(k + 1) % n] as Point
        expect(p.x === q.x && p.y === q.y).toBe(false)
      }
    }
  })

  it('should_orient_outer_and_hole_contours_oppositely (AC-6)', () => {
    const donut = maskOf(30, 30, (i, j) => {
      const r = Math.hypot(i + 0.5 - 15, j + 0.5 - 15)
      return r <= 12 && r >= 5 ? 1 : 0
    })
    const contours = traceContours(donut)
    expect(contours).toHaveLength(2)
    const areas = contours
      .map((c) => signedArea(c.points))
      .sort((a, b) => a - b)
    expect(areas[0]).toBeLessThan(0)
    expect(areas[1]).toBeGreaterThan(0)
    // The outer contour encloses more area.
    expect(Math.abs(areas[0] as number)).toBeGreaterThan(areas[1] as number)
  })

  it('should_start_each_contour_at_its_smallest_point_in_scan_order (AC-8)', () => {
    const mask = maskOf(20, 10, (i, j) =>
      Math.max(inRect(10, 1, 15, 4)(i, j), inRect(2, 3, 6, 8)(i, j)),
    )
    const contours = traceContours(mask)
    const starts = contours.map((c) => c.points[0] as Point)
    for (const [k, c] of contours.entries()) {
      const s = starts[k] as Point
      for (const p of c.points) {
        expect(p.y > s.y || (p.y === s.y && p.x >= s.x)).toBe(true)
      }
    }
    expect((starts[0] as Point).y).toBeLessThan((starts[1] as Point).y)
    expect(traceContours(mask)).toEqual(contours)
  })
})
