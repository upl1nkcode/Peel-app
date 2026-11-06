import { describe, expect, it } from 'vitest'
import type { Point } from '../geometry/types'
import {
  circleScene,
  lineScene,
  type EdgeScene,
} from '../../test/sceneFixtures'
import { edgeMap, type EdgeMap } from './edges'
import { liveWire, refineSubpixel } from './liveWire'

/** Pixels whose centre is within `reach` of the segment a–b, over the whole image. */
function corridor(map: EdgeMap, a: Point, b: Point, reach: number) {
  const { width, height } = map.rect
  const allowed = new Uint8Array(width * height)
  const dx = b.x - a.x
  const dy = b.y - a.y
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - a.x
      const py = y + 0.5 - a.y
      const t = Math.max(
        0,
        Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)),
      )
      if (Math.hypot(px - t * dx, py - t * dy) <= reach)
        allowed[y * width + x] = 1
    }
  }
  return allowed
}

/** The two shared cases: endpoints on the true edge about 300 px apart. */
function cases(): [string, EdgeScene, Point, Point][] {
  const line = lineScene()
  const disc = circleScene()
  return [
    ['line', line, line.at(-150), line.at(150)],
    ['circle', disc, disc.at(-180), disc.at(150)],
  ]
}

function solve(scene: EdgeScene, from: Point, to: Point) {
  const { image } = scene
  const map = edgeMap(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  })
  const allowed = corridor(map, from, to, 120)
  return { map, allowed, path: liveWire(map, from, to, allowed) }
}

const centre = (p: Point) => ({
  x: Math.floor(p.x) + 0.5,
  y: Math.floor(p.y) + 0.5,
})

describe('liveWire', () => {
  it('should_follow_a_synthetic_edge_within_1_px (AC-4)', () => {
    for (const [name, scene, from, to] of cases()) {
      const { path } = solve(scene, from, to)
      expect(path.length, name).toBeGreaterThan(250)
      for (const p of path) expect(scene.dist(p), name).toBeLessThanOrEqual(1)
    }
  })

  it('should_refine_the_path_within_0_25_px (AC-5)', () => {
    for (const [name, scene, from, to] of cases()) {
      const { map, path } = solve(scene, from, to)
      const refined = refineSubpixel(map, path)
      expect(refined).toHaveLength(path.length)
      for (const p of refined)
        expect(scene.dist(p), name).toBeLessThanOrEqual(0.25)
    }
  })

  it('should_start_end_and_stay_inside (AC-6)', () => {
    const [[, scene, from, to]] = cases() as [[string, EdgeScene, Point, Point]]
    const { map, allowed, path } = solve(scene, from, to)
    expect(path[0]).toEqual(centre(from))
    expect(path[path.length - 1]).toEqual(centre(to))
    for (const p of path) {
      expect(allowed[Math.floor(p.y) * map.rect.width + Math.floor(p.x)]).toBe(
        1,
      )
    }
    // Consecutive points are 8-neighbours.
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1] as Point
      const b = path[k] as Point
      expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBe(1)
    }
    expect(liveWire(map, { x: 10.2, y: 20.7 }, { x: 10.9, y: 20.1 })).toEqual([
      { x: 10.5, y: 20.5 },
    ])
    // An allowed area in two pieces: the goal cannot be reached.
    const split = new Uint8Array(map.rect.width * map.rect.height)
    split[20 * map.rect.width + 20] = 1
    split[20 * map.rect.width + 40] = 1
    expect(() =>
      liveWire(map, { x: 20.5, y: 20.5 }, { x: 40.5, y: 20.5 }, split),
    ).toThrow(RangeError)
    expect(() => liveWire(map, { x: -1, y: 5 }, to)).toThrow(RangeError)
    expect(() => liveWire(map, from, { x: 5, y: 420 })).toThrow(RangeError)
    expect(() => liveWire(map, from, { x: 5.5, y: 5.5 }, allowed)).toThrow(
      RangeError,
    )
  })
})
