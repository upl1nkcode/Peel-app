import { describe, expect, it } from 'vitest'
import type { Point } from '../geometry/types'
import { mulberry32 } from '../../test/random'
import { arc, softMask } from '../../test/maskFixtures'
import { maskToRings, traceContours, type CoverageMask } from './index'

const SIZE = { width: 4032, height: 3024 }

const ellipse = (c: Point, rx: number, ry: number): Point[] =>
  arc({ x: 0, y: 0 }, 1, 0, 2 * Math.PI, false).map((p) => ({
    x: c.x + rx * p.x,
    y: c.y + ry * p.y,
  }))

/** A person-like subject: body and head with two arm gaps, soft edges, ~12,000 px of outline. */
function person(): CoverageMask {
  return softMask(
    [
      { op: 'add', points: ellipse({ x: 2016.3, y: 1900.2 }, 900, 1150) },
      { op: 'add', points: ellipse({ x: 2016.7, y: 600.4 }, 360, 420) },
      { op: 'subtract', points: ellipse({ x: 1500.2, y: 2000.6 }, 160, 600) },
      { op: 'subtract', points: ellipse({ x: 2530.8, y: 2000.1 }, 160, 600) },
    ],
    SIZE,
  )
}

function bestOf(runs: number, f: () => void): number {
  let best = Infinity
  for (let r = 0; r < runs; r++) {
    const t0 = Date.now()
    f()
    best = Math.min(best, Date.now() - t0)
  }
  return best
}

const perimeter = (mask: CoverageMask): number =>
  traceContours(mask).reduce((sum, c) => {
    let len = 0
    for (let k = 0; k < c.points.length; k++) {
      const a = c.points[k] as Point
      const b = c.points[(k + 1) % c.points.length] as Point
      len += Math.hypot(b.x - a.x, b.y - a.y)
    }
    return sum + len
  }, 0)

describe('maskToRings speed', () => {
  it('should_convert_a_12_mp_mask_in_under_500_ms (AC-16)', () => {
    const mask = person()
    const outline = perimeter(mask)
    expect(outline).toBeGreaterThan(10_000)
    expect(outline).toBeLessThan(14_000)
    expect(maskToRings(mask)).toHaveLength(3)
    const ms = bestOf(2, () => maskToRings(mask))
    expect(
      ms,
      `${String(ms)} ms for ${String(Math.round(outline))} px of outline`,
    ).toBeLessThan(500)
  }, 60_000)

  it('should_keep_thousands_of_specks_quickly (Review Focus 3)', () => {
    const mask = person()
    const rand = mulberry32(2000)
    let specks = 0
    let pinholes = 0
    while (specks + pinholes < 2000) {
      const i = 2 + Math.floor(rand() * (SIZE.width - 4))
      const j = 2 + Math.floor(rand() * (SIZE.height - 4))
      // Only isolated pixels well inside or well outside the subject.
      let same = true
      const v = mask.data[j * SIZE.width + i] as number
      if (v !== 0 && v !== 1) continue
      for (let dj = -2; dj <= 2 && same; dj++) {
        for (let di = -2; di <= 2; di++) {
          if ((mask.data[(j + dj) * SIZE.width + i + di] as number) !== v)
            same = false
        }
      }
      if (!same) continue
      mask.data[j * SIZE.width + i] = 1 - v
      if (v === 0) specks++
      else pinholes++
    }
    const rings = maskToRings(mask)
    expect(rings).toHaveLength(3 + specks + pinholes)
    const ms = bestOf(1, () => maskToRings(mask))
    expect(
      ms,
      `${String(ms)} ms with ${String(specks)} specks and ${String(pinholes)} pinholes`,
    ).toBeLessThan(1500)
  }, 120_000)
})
