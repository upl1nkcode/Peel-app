import { describe, expect, it } from 'vitest'
import { fromAlphaMask, maskToRings } from '../contour'
import { sampleSegment, toBezierSegments } from '../geometry/bezier'
import type { Point } from '../geometry/types'
import { lassoAround } from './lassoAround'
import type { Mask } from './score'

/** An opaque ellipse with a soft 1 px rim, centred in a 160 × 120 image. */
function ellipse(): Mask {
  const width = 160
  const height = 120
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.hypot((x + 0.5 - 80) / 50, (y + 0.5 - 60) / 35)
      data[y * width + x] = Math.round(
        255 * Math.min(1, Math.max(0, (1 - r) * 40 + 0.5)),
      )
    }
  }
  return { width, height, data }
}

/** The truth's 50% outline, sampled every 0.25 px. */
function outline(truth: Mask): Point[] {
  const [ring] = maskToRings(fromAlphaMask(truth))
  if (!ring) throw new Error('no outline')
  return toBezierSegments(ring.nodes, true).flatMap((s) =>
    sampleSegment(s, 0.25),
  )
}

const nearest = (p: Point, line: readonly Point[]) =>
  Math.min(...line.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))

describe('lassoAround (spec 0014)', () => {
  it('should_stay_within_the_wobble_of_the_outline (AC-5)', () => {
    const truth = ellipse()
    const line = outline(truth)
    const path = lassoAround(truth, 7, 3)
    expect(path.length).toBeGreaterThan(100)
    let far = 0
    for (const p of path) far = Math.max(far, nearest(p, line))
    expect(far).toBeLessThanOrEqual(3 + 0.75)
    // The wobble is really there, not a copy of the outline.
    expect(far).toBeGreaterThan(1.5)
  })

  it('should_repeat_for_a_seed_and_differ_between_seeds (AC-5)', () => {
    const truth = ellipse()
    expect(lassoAround(truth, 1, 3)).toEqual(lassoAround(truth, 1, 3))
    expect(lassoAround(truth, 1, 3)).not.toEqual(lassoAround(truth, 2, 3))
  })

  it('should_close_the_path (AC-5)', () => {
    const path = lassoAround(ellipse(), 3, 3)
    expect(path.at(-1)).toEqual(path[0])
  })
})
