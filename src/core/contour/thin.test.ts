import { describe, expect, it } from 'vitest'
import type { Point } from '../geometry/types'
import { renderMask } from '../mask/render'
import { curveExcess } from '../../test/curveCheck'
import {
  circle,
  hardMask,
  maskOf,
  rect,
  softMask,
} from '../../test/maskFixtures'
import {
  MIN_TOLERANCE_PX,
  THIN_PART_FRACTION,
  contourToNodes,
  localWidths,
  maskToRings,
  traceContours,
} from './index'
import type { CoverageMask } from './types'

/** Round trip: whether each pixel renders at alpha ≥ 128. */
function roundTrip(mask: CoverageMask): boolean[] {
  const out = renderMask(
    { rings: maskToRings(mask), strokes: [], feather: 0 },
    { width: mask.width, height: mask.height },
  ).data
  return Array.from(out, (a) => a >= 128)
}

/** Share of the mask's selected pixels still selected after the round trip. */
function keptShare(mask: CoverageMask): number {
  const after = roundTrip(mask)
  let total = 0
  let kept = 0
  for (let k = 0; k < after.length; k++) {
    if ((mask.data[k] as number) < 0.5) continue
    total++
    if (after[k]) kept++
  }
  return kept / total
}

/** A straight strand of width w from a to b, as a polygon. */
function strand(a: Point, b: Point, w: number): Point[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const nx = (-(b.y - a.y) / len) * (w / 2)
  const ny = ((b.x - a.x) / len) * (w / 2)
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ]
}

const hardLine = () =>
  maskOf(50, 10, (i, j) => (j === 5 && i >= 5 && i < 45 ? 1 : 0))
/** Two hard blocks with a 1-px gap at column 15. */
const hardGap = () =>
  maskOf(30, 12, (i, j) =>
    j >= 2 && j < 10 && i >= 2 && i < 28 && i !== 15 ? 1 : 0,
  )

describe('thin parts (Decision 2)', () => {
  it('should_measure_local_width_across_thin_parts (AC-17)', () => {
    expect(THIN_PART_FRACTION).toBe(0.25)
    expect(MIN_TOLERANCE_PX).toBe(0.1)
    const [line] = traceContours(hardLine())
    if (!line) throw new Error('no contour')
    const [w] = localWidths([line])
    if (!w) throw new Error('no widths')
    line.points.forEach((p, k) => {
      if (p.x > 10 && p.x < 40) expect(w[k]).toBeCloseTo(1, 9)
    })

    const big = traceContours(
      softMask([{ op: 'add', points: circle({ x: 40.3, y: 40.1 }, 30) }], {
        width: 80,
        height: 80,
      }),
    )
    for (const v of localWidths(big)[0] ?? []) expect(v).toBeGreaterThan(4)

    const gap = traceContours(hardGap())
    expect(gap).toHaveLength(2)
    const gw = localWidths(gap)
    const across = gap.flatMap((g, ci) =>
      g.points.flatMap((p, k) =>
        p.y > 4 && p.y < 8 && Math.abs(p.x - 15.5) < 1
          ? [gw[ci]?.[k] as number]
          : [],
      ),
    )
    expect(across.length).toBeGreaterThan(0)
    for (const v of across) expect(v).toBeCloseTo(1, 9)
  })

  it('should_keep_1_px_lines (AC-17)', () => {
    const hardDiagonal = maskOf(50, 50, (i, j) =>
      i === j && i >= 5 && i < 45 ? 1 : 0,
    )
    const soft = softMask(
      [
        {
          op: 'add',
          points: strand({ x: 5.2, y: 10.4 }, { x: 45.3, y: 30.1 }, 1.05),
        },
      ],
      { width: 50, height: 40 },
    )
    for (const [name, mask] of [
      ['hard line', hardLine()],
      ['hard diagonal', hardDiagonal],
      ['soft slanted strand', soft],
      ['hard slanted strand', hardMask(soft)],
    ] as const) {
      expect(keptShare(mask), name).toBeGreaterThanOrEqual(0.95)
    }
  }, 60_000)

  it('should_keep_1_px_gaps_open (AC-17)', () => {
    const after = roundTrip(hardGap())
    let closed = 0
    for (let j = 2; j < 10; j++) if (after[j * 30 + 15]) closed++
    expect(closed / 8).toBeLessThanOrEqual(0.05)

    const soft = softMask(
      [
        { op: 'add', points: rect(2.3, 2.2, 15.1, 20.6) },
        { op: 'add', points: rect(16.15, 2.2, 28.7, 20.6) },
      ],
      { width: 32, height: 24 },
    )
    const softAfter = roundTrip(soft)
    let gapTotal = 0
    let gapClosed = 0
    for (let j = 4; j <= 18; j++) {
      const k = j * 32 + 15
      if ((soft.data[k] as number) >= 0.5) continue
      gapTotal++
      if (softAfter[k]) gapClosed++
    }
    expect(gapTotal).toBeGreaterThan(0)
    expect(gapClosed / gapTotal).toBeLessThanOrEqual(0.05)
  }, 60_000)

  it('should_keep_a_1_px_wall (AC-17)', () => {
    const c = { x: 30.3, y: 30.2 }
    const wall = maskOf(60, 60, (i, j) => {
      const r = Math.hypot(i + 0.5 - c.x, j + 0.5 - c.y)
      return r >= 20 && r < 21 ? 1 : 0
    })
    expect(keptShare(wall)).toBeGreaterThanOrEqual(0.95)
  }, 60_000)

  it('should_follow_thin_parts_within_a_quarter_of_their_width (AC-9)', () => {
    const contours = traceContours(hardLine())
    const widths = localWidths(contours)
    contours.forEach((c, k) => {
      const w = widths[k] as number[]
      expect(curveExcess(c, contourToNodes(c, w), w)).toBeLessThanOrEqual(0)
    })
  }, 60_000)
})
