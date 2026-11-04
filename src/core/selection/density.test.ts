import { describe, expect, it } from 'vitest'

import { mulberry32 } from '../../test/random'
import { sampleSegment, toBezierSegments } from '../geometry/bezier'
import type { Node, Point } from '../geometry/types'
import { applyCommand } from './commands'
import { resimplifyRing } from './density'
import { InvalidCommandError } from './errors'
import { emptySelection } from './model'

const n = (x: number, y: number, kind: Node['kind'] = 'smooth'): Node => ({
  x,
  y,
  kind,
})

/** Closed curve through the nodes, sampled every `step` px. */
function sampleCurve(nodes: readonly Node[], step: number): Point[] {
  const out: Point[] = []
  for (const seg of toBezierSegments(nodes, true)) {
    out.push(...sampleSegment(seg, step).slice(0, -1))
  }
  return out
}

function segDistSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const u =
    len2 === 0
      ? 0
      : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return (a.x + u * dx - p.x) ** 2 + (a.y + u * dy - p.y) ** 2
}

/**
 * 0 if every point of `from` is within `tol` of the closed polyline `to`;
 * otherwise a value above `tol`: the worst distance seen, or Infinity when
 * a point has no segment even within one cell.
 * Cells are at least `tol` wide, so a 3×3 search sees every segment within
 * `tol` of a point.
 */
function oneSidedExcess(
  from: readonly Point[],
  to: readonly Point[],
  tol: number,
): number {
  const cell = Math.max(tol, 0.25)
  const tolSq = tol * tol
  const buckets = new Map<number, number[]>()
  const key = (cx: number, cy: number) => (cx + 2 ** 20) * 2 ** 21 + cy
  to.forEach((a, i) => {
    const b = to[(i + 1) % to.length] as Point
    const x1 = Math.floor(Math.max(a.x, b.x) / cell)
    const y1 = Math.floor(Math.max(a.y, b.y) / cell)
    for (let cx = Math.floor(Math.min(a.x, b.x) / cell); cx <= x1; cx++) {
      for (let cy = Math.floor(Math.min(a.y, b.y) / cell); cy <= y1; cy++) {
        const list = buckets.get(key(cx, cy))
        if (list === undefined) buckets.set(key(cx, cy), [i])
        else list.push(i)
      }
    }
  })
  let worst = 0
  for (const p of from) {
    const cx = Math.floor(p.x / cell)
    const cy = Math.floor(p.y / cell)
    let best = Infinity
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of buckets.get(key(cx + dx, cy + dy)) ?? []) {
          const d = segDistSq(
            p,
            to[i] as Point,
            to[(i + 1) % to.length] as Point,
          )
          if (d < best) best = d
          if (best <= tolSq) break search
        }
      }
    }
    if (best > tolSq) worst = Math.max(worst, Math.sqrt(best))
  }
  return worst
}

/**
 * AC-21 on the drawn curves, both sampled at 0.05 px: 0 when each curve is
 * within `tol` of the other, otherwise the worst distance seen beyond it.
 */
function hausdorffBothWays(
  oldNodes: readonly Node[],
  newNodes: readonly Node[],
  tol: number,
): number {
  const a = sampleCurve(oldNodes, 0.05)
  const b = sampleCurve(newNodes, 0.05)
  return Math.max(oneSidedExcess(a, b, tol), oneSidedExcess(b, a, tol))
}

const circle = (count: number, r: number): Node[] =>
  Array.from({ length: count }, (_, i) =>
    n(
      r * Math.cos((i / count) * 2 * Math.PI),
      r * Math.sin((i / count) * 2 * Math.PI),
    ),
  )

function randomRing(rand: () => number): Node[] {
  const count = 8 + Math.floor(rand() * 33)
  const radius = 20 + rand() * 380
  return Array.from({ length: count }, (_, i) => {
    const theta = ((i + rand() * 0.5) / count) * 2 * Math.PI
    const r = radius * (0.7 + rand() * 0.6)
    return n(
      r * Math.cos(theta),
      r * Math.sin(theta),
      rand() < 0.3 ? 'corner' : 'smooth',
    )
  })
}

const squareCorners = (): Node[] => [
  n(0, 0, 'corner'),
  n(10, 0, 'corner'),
  n(10, 10, 'corner'),
  n(0, 10, 'corner'),
]

describe('dot density', () => {
  it('should_measure_deviation_beyond_the_tolerance (test helper)', () => {
    // concentric circles 3 px apart
    const inner = circle(64, 200)
    const outer = circle(64, 203)
    expect(hausdorffBothWays(inner, outer, 3.1)).toBe(0)
    expect(hausdorffBothWays(inner, outer, 2)).toBeGreaterThan(2)
    // within one cell the worst distance itself is reported
    const near = hausdorffBothWays(inner, circle(64, 200.2), 0.1)
    expect(near).toBeGreaterThan(0.15)
    expect(near).toBeLessThan(0.25)
  })

  // AC-21
  it('should_keep_the_curve_within_tolerance_both_ways', () => {
    const ring = circle(64, 200)
    for (const tol of [0.1, 0.5, 2]) {
      const out = resimplifyRing(ring, tol)
      expect(hausdorffBothWays(ring, out, tol)).toBe(0)
    }
  })

  // AC-22
  it('should_give_fewer_and_more_dots', () => {
    const ring = circle(64, 200)
    expect(resimplifyRing(ring, 2).length).toBeLessThan(64)
    expect(resimplifyRing(ring, 0.01).length).toBeGreaterThan(64)
  })

  // AC-22 for hand-placed (Dots mode) rings, not just even circles
  it('should_give_fewer_dots_on_hand_placed_rings', () => {
    const rand = mulberry32(77)
    for (let trial = 0; trial < 12; trial++) {
      const count = 8 + Math.floor(rand() * 24)
      const ring = Array.from({ length: count }, (_, i) => {
        const theta = ((i + rand() * 0.8) / count) * 2 * Math.PI
        const r = 300 * (0.6 + rand() * 0.8)
        return n(r * Math.cos(theta), r * Math.sin(theta))
      })
      // Very wavy few-dot rings need more dots than placed, even at 8 px,
      // to keep RDP's spacing (spec AC-22 model); the slider still thins.
      const loose = resimplifyRing(ring, 8)
      const tight = resimplifyRing(ring, 2)
      expect(loose.length, `trial ${String(trial)}`).toBeLessThan(tight.length)
      expect(hausdorffBothWays(ring, loose, 8)).toBe(0)
    }
    // Gently wobbling rings with unevenly spaced dots. Re-picking dots by
    // RDP gives at least as many as placed here; removing placed dots gives
    // far fewer.
    const gentle = (count: number, wobble: number): Node[] =>
      Array.from({ length: count }, (_, i) => {
        const theta = ((i + 0.3 * Math.sin(i * 2.3)) / count) * 2 * Math.PI
        const r = 300 * (1 + wobble * Math.sin(3 * theta))
        return n(r * Math.cos(theta), r * Math.sin(theta))
      })
    for (const [ring, tol] of [
      [gentle(16, 0.05), 8],
      [gentle(36, 0.1), 2],
    ] as const) {
      const out = resimplifyRing(ring, tol)
      expect(
        out.length,
        `${String(ring.length)} dots, tol ${String(tol)}`,
      ).toBeLessThan(ring.length * 0.8)
      expect(hausdorffBothWays(ring, out, tol)).toBe(0)
    }
  }, 30_000)

  // AC-23
  it('should_keep_every_corner', () => {
    // rounded rectangle: 4 corners, 5 smooth bulging nodes on each side
    const corners = [
      n(0, 0, 'corner'),
      n(200, 0, 'corner'),
      n(200, 120, 'corner'),
      n(0, 120, 'corner'),
    ]
    const ring: Node[] = []
    corners.forEach((c, i) => {
      ring.push(c)
      const d = corners[(i + 1) % 4] as Node
      const len = Math.hypot(d.x - c.x, d.y - c.y)
      for (let k = 1; k <= 5; k++) {
        const t = k / 6
        const bulge = Math.sin(t * Math.PI) * 8
        ring.push(
          n(
            c.x + (d.x - c.x) * t - ((d.y - c.y) / len) * bulge,
            c.y + (d.y - c.y) * t + ((d.x - c.x) / len) * bulge,
          ),
        )
      }
    })
    for (const tol of [0.25, 1, 4, 8]) {
      const out = resimplifyRing(ring, tol)
      for (const c of corners) expect(out).toContainEqual(c)
      expect(out.filter((p) => p.kind === 'corner')).toHaveLength(4)
      expect(hausdorffBothWays(ring, out, tol)).toBe(0)
    }
  })

  // AC-24
  it('should_reject_bad_tolerance_and_skip_no_op_density', () => {
    const sel = applyCommand(emptySelection(), {
      type: 'addRing',
      nodes: circle(16, 50),
    })
    for (const tolerancePx of [0.009, 8.01, Number.NaN, Infinity, -1]) {
      expect(() =>
        applyCommand(sel, { type: 'setDensity', ring: 0, tolerancePx }),
      ).toThrow(InvalidCommandError)
    }
    expect(() =>
      applyCommand(sel, { type: 'setDensity', ring: 1, tolerancePx: 1 }),
    ).toThrow(InvalidCommandError)

    const square = applyCommand(emptySelection(), {
      type: 'addRing',
      nodes: squareCorners(),
    })
    expect(
      applyCommand(square, { type: 'setDensity', ring: 0, tolerancePx: 1 }),
    ).toBe(square)

    const denser = applyCommand(sel, {
      type: 'setDensity',
      ring: 0,
      tolerancePx: 0.01,
    })
    expect(denser.rings[0]?.nodes.length).toBeGreaterThan(16)
    expect(denser.rings[0]?.op).toBe('add')
  })

  // AC-25
  it('should_hold_the_tolerance_for_random_rings', () => {
    const rand = mulberry32(2003)
    for (let trial = 0; trial < 50; trial++) {
      const ring = randomRing(rand)
      const tol = 0.25 + rand() * 3.75
      const out = resimplifyRing(ring, tol)
      expect(out.length).toBeGreaterThanOrEqual(3)
      expect(
        hausdorffBothWays(ring, out, tol),
        `trial ${String(trial)} tol ${String(tol)}`,
      ).toBe(0)
      for (const c of ring.filter((p) => p.kind === 'corner')) {
        expect(out).toContainEqual(c)
      }
    }
  }, 30_000) // 50 rings × two 0.05 px curve samplings: slower under coverage

  // Review Focus 4
  it('should_handle_all_corner_and_tiny_rings_and_tolerance_bounds', () => {
    expect(resimplifyRing(squareCorners(), 1)).toEqual(squareCorners())
    const tri = [n(0, 0), n(30, 0), n(15, 25)]
    for (const tol of [0.01, 8]) {
      const out = resimplifyRing(tri, tol)
      expect(out.length).toBeGreaterThanOrEqual(3)
      expect(hausdorffBothWays(tri, out, tol)).toBe(0)
    }
    const oneCorner = [n(0, 0, 'corner'), n(30, 0), n(15, 25)]
    const out = resimplifyRing(oneCorner, 8)
    expect(out.length).toBeGreaterThanOrEqual(3)
    expect(out).toContainEqual(n(0, 0, 'corner'))
    expect(hausdorffBothWays(oneCorner, out, 8)).toBe(0)

    // fits inside the tolerance of its corner: RDP keeps 1 dot, topped up to 3
    const tiny = [n(0, 0, 'corner'), n(3, 0), n(1.5, 2.5)]
    const topped = resimplifyRing(tiny, 8)
    expect(topped).toHaveLength(3)
    expect(topped[0]).toEqual(n(0, 0, 'corner'))
    expect(topped.filter((p) => p.kind === 'corner')).toHaveLength(1)
    expect(hausdorffBothWays(tiny, topped, 8)).toBe(0)

    // a small ring thins too (checked against the whole curve)
    const small = circle(7, 20)
    const thinned = resimplifyRing(small, 8)
    expect(thinned.length).toBeLessThan(7)
    expect(thinned.length).toBeGreaterThanOrEqual(3)
    expect(hausdorffBothWays(small, thinned, 8)).toBe(0)

    // fewer than 3 nodes is not a ring: returned as a copy
    const two = [n(0, 0), n(5, 5)]
    const same = resimplifyRing(two, 1)
    expect(same).toEqual(two)
    expect(same).not.toBe(two)
  })
})
