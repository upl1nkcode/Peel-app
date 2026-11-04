import { describe, expect, it } from 'vitest'
import type { Node } from '../geometry/types'
import type { BrushStroke, Ring, Selection } from '../selection/types'
import { mulberry32, noisyCircle } from '../../test/random'
import { renderMask } from './render'

/** AC-26: two add rings and one subtract ring (2,000 nodes), 20 strokes of 50 points, feather 1.5. */
function bigSelection(): Selection {
  const ring = (
    op: Ring['op'],
    n: number,
    r: number,
    seed: number,
    cx: number,
    cy: number,
  ): Ring => ({
    op,
    nodes: noisyCircle(n, r, r * 0.04, seed, { x: cx, y: cy }).map(
      (p): Node => ({ ...p, kind: 'smooth' }),
    ),
  })
  const rand = mulberry32(26)
  const strokes: BrushStroke[] = Array.from({ length: 20 }, (_, s) => {
    let x = 500 + rand() * 3000
    let y = 400 + rand() * 2200
    return {
      mode: s % 2 === 0 ? 'erase' : 'restore',
      sizePx: 20 + rand() * 60,
      hardness: rand(),
      points: Array.from({ length: 50 }, () => {
        x += (rand() - 0.5) * 30
        y += (rand() - 0.5) * 30
        return { x, y }
      }),
    }
  })
  return {
    rings: [
      ring('add', 900, 1300, 1, 2016, 1512),
      ring('add', 600, 700, 2, 3300, 2400),
      ring('subtract', 500, 400, 3, 2016, 1512),
    ],
    strokes,
    feather: 1.5,
  }
}

describe('renderMask speed', () => {
  it('should_render_12_mp_in_under_1_5_s (AC-26)', () => {
    const sel = bigSelection()
    const size = { width: 4032, height: 3024 }
    let best = Infinity
    for (let run = 0; run < 2; run++) {
      const t0 = Date.now()
      renderMask(sel, size)
      best = Math.min(best, Date.now() - t0)
    }
    expect(best, `12 MP render took ${String(best)} ms`).toBeLessThan(1500)
  }, 60_000)
})
