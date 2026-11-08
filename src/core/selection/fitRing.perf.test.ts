import { describe, expect, it } from 'vitest'

import { mulberry32 } from '../../test/random'
import type { Point } from '../geometry/types'
import { fitRing } from './density'

describe('fitRing speed', () => {
  it('should_fit_a_10000_px_path_in_under_1_s (AC-27)', () => {
    // A lasso traced at fit on a 12 MP photo: a wobbly closed loop about
    // 10,000 px long, one point every 4 px, at the widest tolerance.
    const rand = mulberry32(27)
    const r = 10_000 / (2 * Math.PI)
    const count = 2500
    const path: Point[] = Array.from({ length: count }, (_, i) => {
      const a = (i / count) * 2 * Math.PI
      const rr = r * (1 + 0.15 * Math.sin(5 * a)) + (rand() * 2 - 1) * 3
      return { x: 2016 + rr * Math.cos(a), y: 1512 + rr * Math.sin(a) }
    })
    let best = Infinity
    let dots = 0
    for (let run = 0; run < 3; run++) {
      const t0 = Date.now()
      dots = fitRing(path, 8).length
      best = Math.min(best, Date.now() - t0)
    }
    expect(dots).toBeGreaterThan(3)
    expect(best).toBeLessThan(1000)
  })
})
