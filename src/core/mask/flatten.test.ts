import { describe, expect, it } from 'vitest'
import { sampleSegment, toBezierSegments } from '../geometry/bezier'
import type { Node, Point } from '../geometry/types'
import { mulberry32, noisyCircle } from '../../test/random'
import { FLATTEN_TOLERANCE, flattenRing } from './flatten'

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

function distToClosed(p: Point, poly: readonly Point[]): number {
  let best = Infinity
  for (let k = 0; k < poly.length; k++) {
    const d = segDist(p, poly[k] as Point, poly[(k + 1) % poly.length] as Point)
    if (d < best) best = d
  }
  return best
}

function minDistToPoints(p: Point, pts: readonly Point[]): number {
  let best = Infinity
  for (const q of pts) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y))
  return best
}

describe('flattenRing', () => {
  it('should_flatten_curves_within_0_05_px (AC-4)', () => {
    expect(FLATTEN_TOLERANCE).toBe(0.05)
    for (let seed = 1; seed <= 10; seed++) {
      const rand = mulberry32(seed)
      const n = 4 + Math.floor(rand() * 6)
      const nodes: Node[] = noisyCircle(n, 15 + rand() * 25, 6, seed, {
        x: 50,
        y: 50,
      }).map((p, i) => ({ ...p, kind: i % 3 === 0 ? 'corner' : 'smooth' }))
      const poly = flattenRing(nodes)
      const curve = toBezierSegments(nodes, true).flatMap((s) =>
        sampleSegment(s, 0.01),
      )
      // Every curve sample is within the tolerance of the polyline.
      for (const p of curve) {
        expect(distToClosed(p, poly)).toBeLessThanOrEqual(
          FLATTEN_TOLERANCE + 1e-9,
        )
      }
      // Every polyline vertex lies on the curve (up to the 0.01 px sample spacing).
      for (const v of poly) {
        expect(minDistToPoints(v, curve)).toBeLessThanOrEqual(0.01)
      }
    }
  }, 30_000)

  it('should_flatten_corner_only_rings_to_their_nodes (AC-4)', () => {
    const nodes: Node[] = [
      { x: 1.5, y: 2, kind: 'corner' },
      { x: 9, y: 2.25, kind: 'corner' },
      { x: 7, y: 8, kind: 'corner' },
      { x: 2, y: 6, kind: 'corner' },
    ]
    expect(flattenRing(nodes)).toEqual(nodes.map(({ x, y }) => ({ x, y })))
  })

  it('should_scale_coordinates (AC-21)', () => {
    const nodes: Node[] = [
      { x: 2, y: 2, kind: 'corner' },
      { x: 10, y: 2, kind: 'corner' },
      { x: 10, y: 6, kind: 'corner' },
    ]
    expect(flattenRing(nodes, 0.5)).toEqual([
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 3 },
    ])
  })
})
