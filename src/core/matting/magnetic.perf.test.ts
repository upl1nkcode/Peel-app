import { describe, expect, it } from 'vitest'
import type { Point } from '../geometry/types'
import type { RgbaImage } from '../mask/types'
import { circleScene } from '../../test/sceneFixtures'
import { snapToEdges } from './magnetic'

function bestOf(runs: number, f: () => void): number {
  let best = Infinity
  for (let r = 0; r < runs; r++) {
    const t0 = Date.now()
    f()
    best = Math.min(best, Date.now() - t0)
  }
  return best
}

describe('snapToEdges speed', () => {
  it('should_snap_1000_px_in_under_30_ms (AC-13)', () => {
    const scene = circleScene()
    const finger: Point[] = []
    for (let t = 0; t <= 1000; t++) finger.push(scene.at(t))
    const ms = bestOf(5, () => snapToEdges(scene.image, finger, 12))
    expect(ms, `${String(ms)} ms`).toBeLessThan(30)
  })

  it('should_search_only_near_the_finger (Review Focus 4)', () => {
    // 4032 × 3024, a vertical edge at x = 2000; a 300 px finger 40 px off it, reach 120.
    const width = 4032
    const height = 3024
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const k = (y * width + x) * 4
        const v = x < 2000 ? 60 : 200
        data[k] = v
        data[k + 1] = v
        data[k + 2] = v
        data[k + 3] = 255
      }
    }
    const image: RgbaImage = { width, height, data }
    const finger: Point[] = []
    for (let y = 1300; y <= 1600; y++) finger.push({ x: 2040, y })
    const ms = bestOf(3, () => snapToEdges(image, finger, 120))
    expect(ms, `${String(ms)} ms`).toBeLessThan(60)
  })
})
