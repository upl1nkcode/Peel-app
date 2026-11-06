import { describe, expect, it } from 'vitest'
import { lineScene } from '../../test/sceneFixtures'
import { edgeMap } from './edges'
import { liveWire } from './liveWire'

describe('liveWire speed', () => {
  it('should_find_a_300_px_path_in_under_30_ms (AC-7)', () => {
    const scene = lineScene()
    const { image } = scene
    const map = edgeMap(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    })
    const from = scene.at(-150)
    const to = scene.at(150)
    const allowed = new Uint8Array(image.width * image.height)
    const dx = to.x - from.x
    const dy = to.y - from.y
    let count = 0
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const px = x + 0.5 - from.x
        const py = y + 0.5 - from.y
        const t = Math.max(
          0,
          Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)),
        )
        if (Math.hypot(px - t * dx, py - t * dy) <= 120) {
          allowed[y * image.width + x] = 1
          count++
        }
      }
    }
    expect(count).toBeGreaterThan(90_000)
    let best = Infinity
    for (let r = 0; r < 5; r++) {
      const t0 = Date.now()
      liveWire(map, from, to, allowed)
      best = Math.min(best, Date.now() - t0)
    }
    expect(best, `${String(best)} ms`).toBeLessThan(30)
  })
})
