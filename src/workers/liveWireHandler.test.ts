import { describe, expect, it } from 'vitest'
import { snapToEdges } from '../core/matting'
import type { Point } from '../core/geometry/types'
import { lineScene } from '../test/sceneFixtures'
import { createLiveWireHandler } from './liveWireHandler'

describe('live-wire worker handler', () => {
  it('should_match_direct_calls (AC-23)', () => {
    const scene = lineScene()
    const finger: Point[] = []
    for (let t = -60; t <= 60; t++) {
      const p = scene.at(t)
      finger.push({ x: p.x + 3 * Math.sin(t / 9), y: p.y - 2 })
    }
    const handle = createLiveWireHandler()
    expect(
      handle({ type: 'setImage', imageId: 'a', image: scene.image }),
    ).toBeUndefined()
    const reply = handle({
      type: 'snap',
      jobId: 7,
      imageId: 'a',
      finger,
      reachPx: 12,
    })
    expect(reply).toEqual({
      message: {
        type: 'snapped',
        jobId: 7,
        path: snapToEdges(scene.image, finger, 12),
      },
      transfer: [],
    })
  })

  it('should_reuse_images_by_id (AC-24)', () => {
    const scene = lineScene()
    const finger = [scene.at(0), scene.at(20)]
    const handle = createLiveWireHandler()
    handle({ type: 'setImage', imageId: 'a', image: scene.image })
    const snap = (jobId: number, imageId: string) =>
      handle({ type: 'snap', jobId, imageId, finger, reachPx: 12 })
    expect(snap(1, 'a')?.message.type).toBe('snapped')
    expect(snap(2, 'a')?.message.type).toBe('snapped')
    expect(() => snap(3, 'b')).toThrow(/unknown image/)
    handle({ type: 'setImage', imageId: 'b', image: scene.image })
    expect(snap(4, 'b')?.message.type).toBe('snapped')
    expect(() => snap(5, 'a')).toThrow(/unknown image/)
    expect(() => handle({ type: 'render' } as never)).toThrow(/unknown message/)
  })
})
