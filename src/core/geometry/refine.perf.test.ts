import { describe, expect, it } from 'vitest'

import { noisyCircle } from '../../test/random'
import { DEFAULT_LASSO_REFINE, refineLasso } from './refine'

// *.perf.test.ts run without coverage instrumentation (npm run test:perf); see package.json.

describe('refineLasso performance', () => {
  // AC-23
  it('should_smooth_and_simplify_50000_raw_samples_in_under_100_ms', () => {
    // a long trace: 50,000 samples ~0.63 px apart with ±1 px jitter
    const raw = noisyCircle(50_000, 5000, 1, 31)
    let best = Infinity
    for (let run = 0; run < 5; run++) {
      const t0 = Date.now()
      refineLasso(raw, DEFAULT_LASSO_REFINE)
      best = Math.min(best, Date.now() - t0)
    }
    expect(best).toBeLessThan(100)
  })
})
