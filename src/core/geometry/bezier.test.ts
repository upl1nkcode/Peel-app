import { describe, expect, it } from 'vitest'

import { mulberry32 } from '../../test/random'
import { pointOnSegment, toBezierSegments } from './bezier'
import type { BezierSegment, Node, Point } from './types'

const node = (x: number, y: number, kind: Node['kind'] = 'smooth'): Node => ({
  x,
  y,
  kind,
})

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const crossV = (u: Point, v: Point): number => u.x * v.y - u.y * v.x
const dotV = (u: Point, v: Point): number => u.x * v.x + u.y * v.y
const xy = (p: Point): Point => ({ x: p.x, y: p.y })

function randomNodes(seed: number, n: number): Node[] {
  const rand = mulberry32(seed)
  return Array.from({ length: n }, () =>
    node(rand() * 1000, rand() * 1000, rand() < 0.3 ? 'corner' : 'smooth'),
  )
}

const allFinite = (segs: readonly BezierSegment[]): boolean =>
  segs.every((s) =>
    [s.p0, s.c1, s.c2, s.p3].every(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    ),
  )

/** Incoming handle (c2 of the segment ending at node i) and outgoing handle (c1 of segment i). */
function handlesAt(segs: readonly BezierSegment[], i: number, closed: boolean) {
  const n = segs.length
  const incoming = closed ? segs[(i - 1 + n) % n] : segs[i - 1]
  const outgoing = segs[i]
  if (incoming === undefined || outgoing === undefined)
    throw new Error('no handles')
  return { in: incoming.c2, out: outgoing.c1, at: outgoing.p0 }
}

describe('toBezierSegments', () => {
  // AC-13
  it('should_pass_through_every_node', () => {
    for (const closed of [true, false]) {
      for (let seed = 1; seed <= 20; seed++) {
        const nodes = randomNodes(seed, 3 + (seed % 9))
        const segs = toBezierSegments(nodes, closed)
        expect(segs).toHaveLength(closed ? nodes.length : nodes.length - 1)
        segs.forEach((s, i) => {
          const a = nodes[i] as Node
          const b = nodes[(i + 1) % nodes.length] as Node
          expect(s.p0).toEqual(xy(a))
          expect(s.p3).toEqual(xy(b))
          expect(pointOnSegment(s, 0)).toEqual(xy(a))
          expect(pointOnSegment(s, 1)).toEqual(xy(b))
        })
      }
    }
  })

  it('should_evaluate_a_cubic_bezier (AC-13)', () => {
    const seg: BezierSegment = {
      p0: { x: 0, y: 0 },
      c1: { x: 0, y: 3 },
      c2: { x: 3, y: 3 },
      p3: { x: 3, y: 0 },
    }
    expect(pointOnSegment(seg, 0.5)).toEqual({ x: 1.5, y: 2.25 })
  })

  it('should_match_the_centripetal_catmull_rom_curve (AC-13, alpha 0.5)', () => {
    // Reference: Barry–Goldman pyramidal evaluation with knots |Δ|^0.5.
    const lerp = (
      a: Point,
      b: Point,
      ta: number,
      tb: number,
      t: number,
    ): Point => ({
      x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta),
      y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta),
    })
    const pts = [node(0, 0), node(40, 90), node(150, 70), node(160, -50)]
    const [p0, p1, p2, p3] = pts as [Node, Node, Node, Node]
    const k = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y) ** 0.5
    const t0 = 0
    const t1 = t0 + k(p0, p1)
    const t2 = t1 + k(p1, p2)
    const t3 = t2 + k(p2, p3)
    const seg = toBezierSegments(pts, false)[1] as BezierSegment
    for (let i = 0; i <= 10; i++) {
      const t = t1 + ((t2 - t1) * i) / 10
      const a1 = lerp(p0, p1, t0, t1, t)
      const a2 = lerp(p1, p2, t1, t2, t)
      const a3 = lerp(p2, p3, t2, t3, t)
      const b1 = lerp(a1, a2, t0, t2, t)
      const b2 = lerp(a2, a3, t1, t3, t)
      const expected = lerp(b1, b2, t1, t2, t)
      const got = pointOnSegment(seg, i / 10)
      expect(got.x).toBeCloseTo(expected.x, 9)
      expect(got.y).toBeCloseTo(expected.y, 9)
    }
  })

  // AC-14
  it('should_make_corner_handles_point_along_the_chords_and_square_edges_straight', () => {
    const square = [
      node(0, 0, 'corner'),
      node(10, 0, 'corner'),
      node(10, 10, 'corner'),
      node(0, 10, 'corner'),
    ]
    for (const s of toBezierSegments(square, true)) {
      const chord = sub(s.p3, s.p0)
      expect(crossV(sub(s.c1, s.p0), chord)).toBeCloseTo(0, 9)
      expect(crossV(sub(s.c2, s.p0), chord)).toBeCloseTo(0, 9)
      expect(dotV(sub(s.c1, s.p0), chord)).toBeGreaterThan(0)
      expect(dotV(sub(s.c2, s.p3), chord)).toBeLessThan(0)
    }
    // a corner between smooth neighbours points its handles at those neighbours
    const mixed = [
      node(0, 0),
      node(50, 80, 'corner'),
      node(100, 0),
      node(50, -40),
    ]
    const segs = toBezierSegments(mixed, true)
    const h = handlesAt(segs, 1, true)
    expect(crossV(sub(h.out, h.at), sub(mixed[2] as Node, h.at))).toBeCloseTo(
      0,
      6,
    )
    expect(crossV(sub(h.in, h.at), sub(mixed[0] as Node, h.at))).toBeCloseTo(
      0,
      6,
    )
    expect(dotV(sub(h.out, h.at), sub(mixed[2] as Node, h.at))).toBeGreaterThan(
      0,
    )
    expect(dotV(sub(h.in, h.at), sub(mixed[0] as Node, h.at))).toBeGreaterThan(
      0,
    )
  })

  // AC-15
  it('should_make_smooth_handles_collinear_with_the_node', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const nodes = randomNodes(seed, 8).map((n) => ({
        ...n,
        kind: 'smooth' as const,
      }))
      const segs = toBezierSegments(nodes, false)
      for (let i = 1; i < nodes.length - 1; i++) {
        const h = handlesAt(segs, i, false)
        const u = sub(h.in, h.at)
        const v = sub(h.out, h.at)
        expect(
          crossV(u, v) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)),
        ).toBeCloseTo(0, 9)
        expect(dotV(u, v)).toBeLessThan(0) // on opposite sides of the node
      }
    }
  })

  // AC-16
  it('should_be_continuous_at_the_seam_of_a_closed_ring', () => {
    const nodes = randomNodes(7, 6).map((n) => ({
      ...n,
      kind: 'smooth' as const,
    }))
    const segs = toBezierSegments(nodes, true)
    expect(segs.at(-1)?.p3).toEqual(xy(nodes[0] as Node))
    const h = handlesAt(segs, 0, true)
    const u = sub(h.in, h.at)
    const v = sub(h.out, h.at)
    expect(
      crossV(u, v) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)),
    ).toBeCloseTo(0, 9)
    expect(dotV(u, v)).toBeLessThan(0)

    // open path: end handles point toward their single neighbour
    const open = toBezierSegments(nodes, false)
    const first = open[0] as BezierSegment
    const last = open.at(-1) as BezierSegment
    const n1 = nodes[1] as Node
    const nPrev = nodes.at(-2) as Node
    expect(crossV(sub(first.c1, first.p0), sub(n1, first.p0))).toBeCloseTo(0, 6)
    expect(dotV(sub(first.c1, first.p0), sub(n1, first.p0))).toBeGreaterThan(0)
    expect(crossV(sub(last.c2, last.p3), sub(nPrev, last.p3))).toBeCloseTo(0, 6)
    expect(dotV(sub(last.c2, last.p3), sub(nPrev, last.p3))).toBeGreaterThan(0)
  })

  // AC-17, AC-28
  it('should_return_finite_numbers_for_coincident_nodes_two_nodes_and_three_nodes', () => {
    const cases: Node[][] = [
      [node(5, 5), node(5, 5), node(20, 5), node(20, 30)],
      [node(5, 5), node(5, 5), node(5, 5)],
      [node(1, 1, 'corner'), node(1, 1, 'corner'), node(9, 9, 'corner')],
      [node(0, 0), node(10, 0)],
      [node(0, 0), node(10, 0), node(5, 8)],
    ]
    for (const nodes of cases) {
      for (const closed of [true, false]) {
        const segs = toBezierSegments(nodes, closed)
        expect(segs).toHaveLength(closed ? nodes.length : nodes.length - 1)
        expect(allFinite(segs)).toBe(true)
      }
    }
    expect(toBezierSegments([], true)).toEqual([])
    expect(toBezierSegments([node(1, 2)], true)).toEqual([])
    expect(toBezierSegments([node(1, 2)], false)).toEqual([])

    // 2 closed nodes: two straight segments
    for (const kind of ['smooth', 'corner'] as const) {
      const segs = toBezierSegments([node(0, 0, kind), node(10, 0, kind)], true)
      expect(segs).toHaveLength(2)
      for (const s of segs) {
        expect(s.c1.y).toBeCloseTo(0, 12)
        expect(s.c2.y).toBeCloseTo(0, 12)
      }
    }

    // coincident nodes: degenerate handles collapse to the node
    const segs = toBezierSegments([node(5, 5), node(5, 5), node(5, 5)], true)
    for (const s of segs) expect(s.c1).toEqual({ x: 5, y: 5 })
  })

  // AC-18
  it('should_not_overshoot_for_collinear_smooth_nodes', () => {
    const nodes = [
      node(0, 0),
      node(1, 2),
      node(30, 60),
      node(31, 62),
      node(100, 200),
    ]
    for (const closed of [false, true]) {
      for (const s of toBezierSegments(nodes, closed)) {
        for (let k = 0; k <= 20; k++) {
          const p = pointOnSegment(s, k / 20)
          expect(Math.abs(p.y - 2 * p.x)).toBeLessThan(1e-9)
          expect(p.x).toBeGreaterThanOrEqual(-1e-9)
          expect(p.x).toBeLessThanOrEqual(100 + 1e-9)
        }
      }
    }
  })
})
