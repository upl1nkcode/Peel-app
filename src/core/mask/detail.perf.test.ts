import { describe, expect, it } from 'vitest'
import type { Node, Point } from '../geometry/types'
import { mulberry32 } from '../../test/random'
import { rasterizeRings } from './rasterize'
import { applyStrokes } from './strokes'

/**
 * A comb: `teeth` vertical teeth whose tops sit at random heights, so the
 * edges become active in an order unrelated to x (the worst case for a
 * per-sub-row sort). Each row crosses 2 × teeth edges.
 */
function comb(
  width: number,
  height: number,
  teeth: number,
  seed: number,
): Node[] {
  const rand = mulberry32(seed)
  const pitch = width / teeth
  const pts: Point[] = [{ x: 0, y: height - 10 }]
  for (let k = 0; k < teeth; k++) {
    const top = 10 + rand() * 40
    pts.push({ x: k * pitch, y: top }, { x: k * pitch + pitch / 2, y: top })
    pts.push({ x: k * pitch + pitch / 2, y: height - 40 })
    pts.push({ x: (k + 1) * pitch, y: height - 40 })
  }
  pts.push({ x: width, y: height - 10 })
  return pts.map((p) => ({ ...p, kind: 'corner' }))
}

const best = (runs: number, f: () => void): number => {
  let t = Infinity
  for (let r = 0; r < runs; r++) {
    const t0 = Date.now()
    f()
    t = Math.min(t, Date.now() - t0)
  }
  return t
}

describe('mask rendering speed on detailed input', () => {
  it('should_rasterize_many_crossings_per_row_in_linear_time (AC-26)', () => {
    // Time grows with the crossings per row; it must grow linearly. A sort
    // that restarts every sub-row made 200 crossings ~12× slower than 50.
    const size = { width: 1000, height: 750 }
    const time = (teeth: number) =>
      best(2, () =>
        rasterizeRings([{ op: 'add', nodes: comb(1000, 750, teeth, 5) }], size),
      )
    const t50 = time(50)
    const t200 = time(200)
    expect(
      t200 / t50,
      `50 teeth ${String(t50)} ms, 200 teeth ${String(t200)} ms`,
    ).toBeLessThan(6)
    expect(t200, `200 teeth took ${String(t200)} ms`).toBeLessThan(3000)
  }, 120_000)

  it('should_apply_a_large_brush_stroke_quickly (AC-26)', () => {
    const size = { width: 4032, height: 3024 }
    const coverage = new Float32Array(size.width * size.height).fill(1)
    const points = Array.from({ length: 400 }, (_, i) => ({
      x: 400 + i * 8,
      y: 1500 + 600 * Math.sin(i / 40),
    }))
    const ms = best(2, () => {
      applyStrokes(coverage, size, [
        { mode: 'erase', sizePx: 400, hardness: 0.5, points },
      ])
    })
    expect(ms, `400 px stroke took ${String(ms)} ms`).toBeLessThan(500)
  }, 120_000)
})
