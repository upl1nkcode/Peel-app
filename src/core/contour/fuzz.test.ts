import { describe, expect, it } from 'vitest'
import { curveExcess } from '../../test/curveCheck'
import { maskOf } from '../../test/maskFixtures'
import { mulberry32 } from '../../test/random'
import {
  contourToNodes,
  fromAlphaMask,
  maskToRings,
  traceContours,
} from './index'
import type { CoverageMask } from './types'

/** Seeded noisy 8-bit soft masks: empty, full and in-between pixels mixed. */
function noisy(seed: number, size: number): CoverageMask {
  const rand = mulberry32(seed)
  const data = new Uint8Array(size * size)
  for (let k = 0; k < data.length; k++) {
    const r = rand()
    data[k] = r < 0.4 ? 0 : r < 0.6 ? 255 : Math.floor(rand() * 256)
  }
  return fromAlphaMask({ width: size, height: size, data })
}

describe('soft and noisy masks', () => {
  it('should_keep_soft_specks_as_rings_of_3_or_more_dots (AC-8, AC-13)', () => {
    const cases: [string, CoverageMask][] = [
      ['centre 0.8', maskOf(3, 3, (i, j) => (i === 1 && j === 1 ? 0.8 : 0))],
      ['1×1 of 0.9', maskOf(1, 1, () => 0.9)],
      [
        'pair 0.6 / 0.7',
        maskOf(4, 3, (i, j) => (j === 1 ? ([0, 0.6, 0.7, 0][i] ?? 0) : 0)),
      ],
    ]
    for (const [name, mask] of cases) {
      const rings = maskToRings(mask)
      expect(rings, name).toHaveLength(1)
      expect(rings[0]?.nodes.length, name).toBeGreaterThanOrEqual(3)
    }
  })

  it('should_follow_noisy_soft_contours_within_tolerance (AC-9, AC-13)', () => {
    let contours = 0
    for (let seed = 1; seed <= 48; seed++) {
      for (const c of traceContours(noisy(seed, seed % 4 === 0 ? 32 : 16))) {
        const nodes = contourToNodes(c)
        expect(nodes.length, `seed ${String(seed)}`).toBeGreaterThanOrEqual(3)
        expect(
          curveExcess(c, nodes),
          `seed ${String(seed)}`,
        ).toBeLessThanOrEqual(0)
        contours++
      }
    }
    expect(contours).toBeGreaterThan(300)
  }, 120_000)
})
