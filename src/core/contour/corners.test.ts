import { describe, expect, it } from 'vitest'
import type { Point } from '../geometry/types'
import {
  circle,
  hardMask,
  maskOf,
  rect,
  softMask,
} from '../../test/maskFixtures'
import {
  CORNER_ANGLE_DEG,
  CORNER_SUPPORT_PX,
  HARD_CORNER_ANGLE_DEG,
  HARD_CORNER_GAP_PX,
  HARD_CORNER_SUPPORT_PX,
  findCorners,
} from './corners'
import { traceContours } from './trace'
import type { Contour, CoverageMask } from './types'

function onlyContour(mask: CoverageMask): Contour {
  const contours = traceContours(mask)
  expect(contours).toHaveLength(1)
  return contours[0] as Contour
}

const corners = (c: Contour) => findCorners(c.points, c.hard)
const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y)

/** A regular polygon with `n` vertices. */
const regular = (c: Point, r: number, n: number, rot: number): Point[] =>
  Array.from({ length: n }, (_, k) => ({
    x: c.x + r * Math.cos(rot + (2 * Math.PI * k) / n),
    y: c.y + r * Math.sin(rot + (2 * Math.PI * k) / n),
  }))

describe('findCorners', () => {
  it('should_find_rectangle_corners_only (AC-10)', () => {
    expect(CORNER_ANGLE_DEG).toBe(45)
    expect(CORNER_SUPPORT_PX).toBe(2)
    expect(HARD_CORNER_ANGLE_DEG).toBe(50)
    expect(HARD_CORNER_SUPPORT_PX).toBe(4)
    expect(HARD_CORNER_GAP_PX).toBe(1)
    for (const [x0, y0, x1, y1] of [
      [3, 2, 9, 7],
      [5, 4, 9, 8],
      [2, 3, 40, 30],
    ] as const) {
      const c = onlyContour(
        maskOf(48, 36, (i, j) =>
          i >= x0 && i < x1 && j >= y0 && j < y1 ? 1 : 0,
        ),
      )
      const found = corners(c)
      expect(found).toHaveLength(4)
      for (const t of rect(x0, y0, x1, y1)) {
        const d = Math.min(...found.map((k) => dist(c.points[k] as Point, t)))
        expect(d).toBeLessThanOrEqual(0.5 + 1e-12)
      }
    }
  })

  it('should_find_corners_of_tilted_polygons_on_soft_and_hard_edges (AC-12)', () => {
    const size = { width: 128, height: 128 }
    for (let k = 0; k < 8; k++) {
      for (const n of [3, 4]) {
        const truth = regular({ x: 64.1 + k * 0.13, y: 63.7 }, 45, n, k * 0.37)
        const soft = softMask([{ op: 'add', points: truth }], size)
        for (const [kind, mask] of [
          ['soft', soft],
          ['hard', hardMask(soft)],
        ] as const) {
          const c = onlyContour(mask)
          const found = corners(c)
          const label = `${kind} n = ${String(n)} k = ${String(k)}`
          expect(found, label).toHaveLength(n)
          for (const t of truth) {
            const d = Math.min(
              ...found.map((i) => dist(c.points[i] as Point, t)),
            )
            expect(d, label).toBeLessThan(1.5)
          }
        }
      }
    }
  })

  it('should_find_no_corners_on_circles (AC-11)', () => {
    for (const r of [5, 10, 50, 200]) {
      const placements = r > 50 ? 2 : 6
      for (let k = 0; k < placements; k++) {
        const size = { width: 2 * r + 13, height: 2 * r + 13 }
        const c = { x: r + 6 + k * 0.19, y: r + 6.1 + k * 0.13 }
        const soft = softMask([{ op: 'add', points: circle(c, r) }], size)
        const label = `r = ${String(r)} k = ${String(k)}`
        expect(corners(onlyContour(soft)), `soft ${label}`).toEqual([])
        if (r >= 10) {
          expect(corners(onlyContour(hardMask(soft))), `hard ${label}`).toEqual(
            [],
          )
        }
      }
    }
  })

  it('should_handle_short_rings_and_seams (Review Focus 4)', () => {
    const diamond = onlyContour(
      maskOf(5, 5, (i, j) => (i === 2 && j === 2 ? 1 : 0)),
    )
    expect(corners(diamond)).toEqual([0, 1, 2, 3])
    expect(findCorners(diamond.points)).toEqual([0, 1, 2, 3])

    const c = onlyContour(
      maskOf(12, 10, (i, j) => (i >= 3 && i < 9 && j >= 2 && j < 7 ? 1 : 0)),
    )
    for (let shift = 0; shift < c.points.length; shift++) {
      const points = [...c.points.slice(shift), ...c.points.slice(0, shift)]
      const hard = [...c.hard.slice(shift), ...c.hard.slice(0, shift)]
      expect(findCorners(points, hard), `shift ${String(shift)}`).toHaveLength(
        4,
      )
    }

    expect(findCorners(circle({ x: 0, y: 0 }, 30))).toEqual([])
    expect(
      findCorners([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toEqual([])
  })
})
