import { describe, expect, it } from 'vitest'
import { sampleSegment, toBezierSegments } from '../geometry/bezier'
import type { Node, Point } from '../geometry/types'
import { curveExcess } from '../../test/curveCheck'
import {
  blob,
  circle,
  halfDisc,
  hardMask,
  maskOf,
  rect,
  roundedRect,
  softMask,
} from '../../test/maskFixtures'
import {
  DOT_TOLERANCE_PX,
  HARD_EDGE_TOLERANCE_PX,
  contourToNodes,
} from './dots'
import { contoursToRings } from './rings'
import { traceContours } from './trace'
import type { Contour, CoverageMask } from './types'

function onlyContour(mask: CoverageMask): Contour {
  const contours = traceContours(mask)
  expect(contours).toHaveLength(1)
  return contours[0] as Contour
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y)
const nearestDot = (nodes: readonly Node[], p: Point) =>
  Math.min(...nodes.map((n) => dist(n, p)))

/** Blob masks: soft (anti-aliased), hard (thresholded), or hard on the left half only. */
function blobMask(seed: number, kind: 'soft' | 'hard' | 'mixed'): CoverageMask {
  const size = { width: 128, height: 128 }
  const soft = softMask(
    [{ op: 'add', points: blob(seed, { x: 64.3, y: 63.8 }, 44) }],
    size,
  )
  if (kind === 'soft') return soft
  const hard = hardMask(soft)
  if (kind === 'hard') return hard
  const data = soft.data.map((v, k) =>
    k % size.width < size.width / 2 ? (hard.data[k] as number) : v,
  )
  return { ...soft, data }
}

describe('contourToNodes', () => {
  it('should_follow_the_contour_within_tolerance (AC-9)', () => {
    expect(DOT_TOLERANCE_PX).toBe(0.5)
    expect(HARD_EDGE_TOLERANCE_PX).toBe(1)
    for (let seed = 1; seed <= 40; seed++) {
      const kind = seed % 2 === 0 ? 'soft' : 'hard'
      const contour = onlyContour(blobMask(seed, kind))
      const excess = curveExcess(contour, contourToNodes(contour))
      expect(excess, `seed ${String(seed)} (${kind})`).toBeLessThanOrEqual(0)
    }
    for (let seed = 1; seed <= 6; seed++) {
      const contour = onlyContour(blobMask(seed, 'mixed'))
      expect(contour.hard.some(Boolean)).toBe(true)
      expect(contour.hard.every(Boolean)).toBe(false)
      const excess = curveExcess(contour, contourToNodes(contour))
      expect(excess, `mixed seed ${String(seed)}`).toBeLessThanOrEqual(0)
    }
  }, 60_000)

  it('should_give_4_corner_dots_on_rectangles (AC-10)', () => {
    for (const [x0, y0, x1, y1] of [
      [3, 2, 9, 7],
      [5, 4, 9, 8],
      [2, 3, 40, 30],
    ] as const) {
      const contour = onlyContour(
        maskOf(48, 36, (i, j) =>
          i >= x0 && i < x1 && j >= y0 && j < y1 ? 1 : 0,
        ),
      )
      const nodes = contourToNodes(contour)
      expect(nodes).toHaveLength(4)
      expect(nodes.every((n) => n.kind === 'corner')).toBe(true)
      for (const t of rect(x0, y0, x1, y1)) {
        expect(nearestDot(nodes, t)).toBeLessThanOrEqual(0.5 + 1e-12)
      }
      expect(curveExcess(contour, nodes)).toBeLessThanOrEqual(0)
    }
  })

  it('should_give_few_smooth_dots_on_circles (AC-11)', () => {
    for (const r of [10, 50, 100, 200]) {
      const size = { width: 2 * r + 12, height: 2 * r + 12 }
      const c = { x: r + 6.3, y: r + 6.1 }
      const soft = softMask([{ op: 'add', points: circle(c, r) }], size)
      for (const [kind, mask] of [
        ['soft', soft],
        ['hard', hardMask(soft)],
      ] as const) {
        const label = `${kind} r = ${String(r)}`
        const contour = onlyContour(mask)
        const nodes = contourToNodes(contour)
        expect(
          nodes.every((n) => n.kind === 'smooth'),
          label,
        ).toBe(true)
        expect(nodes.length, label).toBeLessThanOrEqual(
          Math.ceil(4 * Math.sqrt(r)) + 4,
        )
        expect(curveExcess(contour, nodes), label).toBeLessThanOrEqual(0)
        if (kind === 'hard') {
          let off = 0
          for (const seg of toBezierSegments(nodes, true)) {
            for (const p of sampleSegment(seg, 0.1)) {
              off = Math.max(off, Math.abs(dist(p, c) - r))
            }
          }
          expect(off, label).toBeLessThanOrEqual(0.75)
        }
      }
    }
  }, 60_000)

  it('should_mix_corners_and_curves (AC-12)', () => {
    const size = { width: 96, height: 96 }
    const c = { x: 30.2, y: 48.3 }
    const d = halfDisc(c, 36)
    const oneSharp = roundedRect(10.3, 12.6, 84.2, 80.1, 15, [0, 2])
    const cases: [string, Point[], Point[]][] = [
      ['D', d, [d[0] as Point, d[d.length - 1] as Point]],
      [
        'rounded, 2 sharp',
        oneSharp,
        [
          { x: 10.3, y: 12.6 },
          { x: 84.2, y: 80.1 },
        ],
      ],
      ['rounded', roundedRect(10.3, 12.6, 84.2, 80.1, 15), []],
    ]
    for (const [name, points, sharp] of cases) {
      const soft = softMask([{ op: 'add', points }], size)
      for (const [kind, mask] of [
        ['soft', soft],
        ['hard', hardMask(soft)],
      ] as const) {
        const label = `${name} (${kind})`
        const contour = onlyContour(mask)
        const nodes = contourToNodes(contour)
        const corners = nodes.filter((n) => n.kind === 'corner')
        expect(corners, label).toHaveLength(sharp.length)
        // Hard corners are quantised to the pixel grid: within the hard tolerance.
        const near = kind === 'hard' ? HARD_EDGE_TOLERANCE_PX : DOT_TOLERANCE_PX
        for (const t of sharp) {
          expect(nearestDot(corners, t), label).toBeLessThanOrEqual(near)
        }
        expect(curveExcess(contour, nodes), label).toBeLessThanOrEqual(0)
      }
    }
  }, 60_000)

  it('should_give_every_ring_3_or_more_dots (AC-13)', () => {
    const speck = maskOf(5, 5, (i, j) => (i === 2 && j === 2 ? 1 : 0))
    const nodes = contourToNodes(onlyContour(speck))
    expect(nodes).toHaveLength(4)
    for (let seed = 1; seed <= 10; seed++) {
      const rings = contoursToRings(traceContours(blobMask(seed, 'hard')))
      for (const r of rings) expect(r.nodes.length).toBeGreaterThanOrEqual(3)
    }
    const domino = maskOf(6, 5, (i, j) =>
      j === 2 && (i === 2 || i === 3) ? 1 : 0,
    )
    const dominoContour = onlyContour(domino)
    const dominoNodes = contourToNodes(dominoContour)
    expect(dominoNodes.length).toBeGreaterThanOrEqual(3)
    expect(curveExcess(dominoContour, dominoNodes)).toBeLessThanOrEqual(0)
  })

  it('should_build_rings_with_dots_by_default (AC-13)', () => {
    const circleMask = softMask(
      [{ op: 'add', points: circle({ x: 40.2, y: 40.7 }, 30) }],
      { width: 80, height: 80 },
    )
    const [ring] = contoursToRings(traceContours(circleMask))
    expect(ring?.nodes.every((n) => n.kind === 'smooth')).toBe(true)
    expect(ring?.nodes.length).toBeLessThan(40)
  })
})
