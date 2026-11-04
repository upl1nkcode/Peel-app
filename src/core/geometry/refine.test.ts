import { describe, expect, it } from 'vitest'

import { noisyCircle } from '../../test/random'
import {
  area,
  createLasso,
  DEFAULT_LASSO_REFINE,
  refineLasso,
  smoothRing,
  simplifyRing,
} from './index'
import type { Point } from './types'

const R = 100
const C = { x: 500, y: 400 }
const radialError = (p: Point) => Math.abs(Math.hypot(p.x - C.x, p.y - C.y) - R)

describe('refineLasso', () => {
  it('should_default_to_strength_1_and_epsilon_1 (AC-8)', () => {
    expect(DEFAULT_LASSO_REFINE).toEqual({ strength: 1, epsilon: 1 })
  })

  it('should_smooth_then_simplify (AC-8)', () => {
    const ring = noisyCircle(100, 50, 1, 2)
    expect(refineLasso(ring, { strength: 2, epsilon: 0.5 })).toEqual(
      simplifyRing(smoothRing(ring, 2), 0.5),
    )
  })

  // AC-8
  it('should_turn_a_noisy_circle_into_a_clean_ring_within_tolerance', () => {
    const samples = 240
    for (let seed = 1; seed <= 20; seed++) {
      const lasso = createLasso()
      lasso.addMany(noisyCircle(samples, R, 1, seed, C))
      const out = refineLasso(lasso.close(), DEFAULT_LASSO_REFINE)
      const worst = Math.max(...out.map(radialError))
      const areaError =
        Math.abs(area(out) - Math.PI * R * R) / (Math.PI * R * R)
      expect(
        worst,
        `seed ${String(seed)} max radial error`,
      ).toBeLessThanOrEqual(1.5)
      expect(areaError, `seed ${String(seed)} area error`).toBeLessThanOrEqual(
        0.01,
      )
      expect(out.length, `seed ${String(seed)} point count`).toBeLessThan(
        samples * 0.25,
      )
    }
  })
})
