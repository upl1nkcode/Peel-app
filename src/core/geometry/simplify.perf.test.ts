import { describe, expect, it } from 'vitest'

import { noisyCircle } from '../../test/random'
import { simplifyPath, simplifyRing } from './simplify'
import type { Point } from './types'

// *.perf.test.ts run without coverage instrumentation (npm run test:perf); see package.json.

/** Best of `runs` wall-clock timings in ms (the first runs warm up the JIT). */
function bestOf(runs: number, fn: () => unknown): number {
  let best = Infinity
  for (let run = 0; run < runs; run++) {
    const t0 = Date.now()
    fn()
    best = Math.min(best, Date.now() - t0)
  }
  return best
}

describe('simplify performance', () => {
  // AC-23
  it('should_simplify_50000_points_quickly_without_stack_overflow', () => {
    // a realistic trace: 50,000 samples ~0.63 px apart (above the 0.5 px dedupe), ±1 px jitter
    const ring = noisyCircle(50_000, 5000, 1, 23)
    expect(bestOf(5, () => simplifyRing(ring, 1))).toBeLessThan(100)
    expect(simplifyRing(ring, 1).length).toBeGreaterThan(3)
  })

  // AC-23
  it('should_not_overflow_the_stack_on_an_adversarial_path', () => {
    // Each split peels off one point, so a recursive RDP would be 12,000 frames
    // deep. RDP's worst case is O(n²), so this one is not timed; finger traces
    // are covered by the timing test above.
    const deep: Point[] = Array.from({ length: 12_000 }, (_, i) => ({
      x: i,
      y: i % 2 === 0 ? 0 : 10 + i * 1e-3,
    }))
    expect(simplifyPath(deep, 0.5)).toHaveLength(12_000)
  })
})
