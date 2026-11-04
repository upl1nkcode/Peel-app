import { describe, expect, it } from 'vitest'

import type { Node } from '../geometry/types'
import { resimplifyRing } from './density'

// *.perf.test.ts run without coverage instrumentation (npm run test:perf).

describe('dot density performance', () => {
  // Review Focus 4: the slider must feel live
  it('should_resimplify_a_300_node_ring_in_under_100_ms', () => {
    const r = 3000 / (2 * Math.PI)
    const ring: Node[] = Array.from({ length: 300 }, (_, i) => {
      const t = (i / 300) * 2 * Math.PI
      const wobble = 1 + 0.05 * Math.sin(7 * t)
      return {
        x: r * wobble * Math.cos(t),
        y: r * wobble * Math.sin(t),
        kind: i % 37 === 0 ? 'corner' : 'smooth',
      }
    })
    let best = Infinity
    for (let run = 0; run < 5; run++) {
      const t0 = Date.now()
      resimplifyRing(ring, 1)
      best = Math.min(best, Date.now() - t0)
    }
    expect(best).toBeLessThan(100)
  })
})
