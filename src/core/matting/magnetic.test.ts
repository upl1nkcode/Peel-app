import { describe, expect, it } from 'vitest'
import type { Point } from '../geometry/types'
import type { RgbaImage } from '../mask/types'
import { softMask } from '../../test/maskFixtures'
import { mulberry32 } from '../../test/random'
import {
  circleScene,
  lineScene,
  type EdgeScene,
} from '../../test/sceneFixtures'
import { SNAP_REACH_PT, snapToEdges } from './magnetic'

const REACH = 12

/** Distance from p to the polyline. */
function toPolyline(p: Point, poly: readonly Point[]): number {
  let best = Infinity
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k] as Point
    const b = poly[Math.min(k + 1, poly.length - 1)] as Point
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t =
      len2 > 0
        ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
        : 0
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy))
  }
  return best
}

/** The true edge from t0 to t1, pushed sideways by a smooth seeded wobble of at most `amp`. */
function wobblyFinger(
  scene: EdgeScene,
  t0: number,
  t1: number,
  amp: number,
  seed: number,
): Point[] {
  const rand = mulberry32(seed)
  const phase = [rand(), rand(), rand()].map((v) => v * 2 * Math.PI) as [
    number,
    number,
    number,
  ]
  const out: Point[] = []
  for (let t = t0; t <= t1; t++) {
    const a = scene.at(t - 0.5)
    const b = scene.at(t + 0.5)
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
    const w =
      amp *
      (0.5 * Math.sin(t / 23 + phase[0]) +
        0.3 * Math.sin(t / 11 + phase[1]) +
        0.2 * Math.sin(t / 37 + phase[2]))
    const p = scene.at(t)
    out.push({ x: p.x + w * n.x, y: p.y + w * n.y })
  }
  return out
}

function scenes(): [string, EdgeScene][] {
  return [
    ['line', lineScene()],
    ['circle', circleScene()],
  ]
}

/** A grey image from a 0..1 value per pixel, with seeded noise. */
function greyImage(
  width: number,
  height: number,
  value: (k: number) => number,
  noise = 0.02,
): RgbaImage {
  const rand = mulberry32(9)
  const data = new Uint8Array(width * height * 4)
  for (let k = 0; k < width * height; k++) {
    const v = value(k) + noise * (rand() + rand() + rand() - 1.5)
    const b = Math.min(255, Math.max(0, Math.round(v * 255)))
    data[k * 4] = b
    data[k * 4 + 1] = b
    data[k * 4 + 2] = b
    data[k * 4 + 3] = 255
  }
  return { width, height, data }
}

describe('snapToEdges', () => {
  it('should_snap_onto_the_edge (AC-8)', () => {
    expect(SNAP_REACH_PT).toBe(12)
    for (const [name, scene] of scenes()) {
      for (const seed of [1, 2, 3]) {
        const finger = wobblyFinger(scene, -150, 150, 0.75 * REACH, seed)
        const path = snapToEdges(scene.image, finger, REACH)
        expect(path.length, name).toBeGreaterThan(250)
        for (const p of path) {
          expect(
            scene.dist(p),
            `${name} seed ${String(seed)}`,
          ).toBeLessThanOrEqual(0.25)
        }
      }
    }
  })

  it('should_stay_within_reach_of_the_finger (AC-9)', () => {
    for (const [name, scene] of scenes()) {
      const finger = wobblyFinger(scene, -150, 150, 0.75 * REACH, 4)
      const path = snapToEdges(scene.image, finger, REACH)
      for (const p of path) {
        expect(toPolyline(p, finger), name).toBeLessThanOrEqual(REACH + 1)
      }
      const first = path[0] as Point
      const last = path[path.length - 1] as Point
      const f0 = finger[0] as Point
      const f1 = finger[finger.length - 1] as Point
      expect(Math.hypot(first.x - f0.x, first.y - f0.y)).toBeLessThanOrEqual(
        REACH + 1,
      )
      expect(Math.hypot(last.x - f1.x, last.y - f1.y)).toBeLessThanOrEqual(
        REACH + 1,
      )
    }
  })

  it('should_prefer_the_stronger_edge (AC-10)', () => {
    // Two parallel 17° edges 8 px apart: contrast 0.4 across the first, 0.2 across the second.
    const size = { width: 300, height: 300 }
    const a = (17 * Math.PI) / 180
    const u = { x: Math.cos(a), y: Math.sin(a) }
    const n = { x: -u.y, y: u.x }
    const c = { x: 150.3, y: 149.8 }
    const halfPlane = (offset: number) => {
      const o = { x: c.x + offset * n.x, y: c.y + offset * n.y }
      return softMask(
        [
          {
            op: 'add',
            points: [
              { x: o.x - 1000 * u.x, y: o.y - 1000 * u.y },
              { x: o.x + 1000 * u.x, y: o.y + 1000 * u.y },
              { x: o.x + 1000 * (u.x + n.x), y: o.y + 1000 * (u.y + n.y) },
              { x: o.x + 1000 * (n.x - u.x), y: o.y + 1000 * (n.y - u.y) },
            ],
          },
        ],
        size,
      ).data
    }
    const strong = halfPlane(-4)
    const weak = halfPlane(4)
    const image = greyImage(
      size.width,
      size.height,
      (k) => 0.3 + 0.4 * (strong[k] as number) + 0.2 * (weak[k] as number),
    )
    const finger: Point[] = []
    for (let t = -100; t <= 100; t++)
      finger.push({ x: c.x + t * u.x, y: c.y + t * u.y })
    const path = snapToEdges(image, finger, REACH)
    for (const p of path) {
      const off = (p.x - c.x) * n.x + (p.y - c.y) * n.y
      expect(Math.abs(off + 4)).toBeLessThanOrEqual(0.25)
    }
  })

  it('should_not_cut_across_a_u_turn (AC-11)', () => {
    // A bar 16 px wide with a round top: its outline is a hairpin whose arms are 16 px apart.
    const size = { width: 260, height: 340 }
    const bar: Point[] = [{ x: 200, y: 300 }]
    for (let k = 0; k <= 32; k++) {
      const t = Math.PI + (k / 32) * Math.PI
      bar.push({ x: 208 + 8 * Math.cos(t), y: 100 + 8 * Math.sin(t) })
    }
    bar.push({ x: 216, y: 300 })
    const cov = softMask([{ op: 'add', points: bar }], size).data
    const image = greyImage(
      size.width,
      size.height,
      (k) => 0.2 + 0.6 * (cov[k] as number),
    )
    const finger: Point[] = []
    for (let y = 300; y > 100; y--) finger.push({ x: 200, y })
    for (let k = 0; k <= 32; k++) {
      const t = Math.PI + (k / 32) * Math.PI
      finger.push({ x: 208 + 8 * Math.cos(t), y: 100 + 8 * Math.sin(t) })
    }
    for (let y = 101; y <= 300; y++) finger.push({ x: 216, y })
    const path = snapToEdges(image, finger, REACH)
    for (const f of finger) {
      expect(toPolyline(f, path)).toBeLessThanOrEqual(REACH)
    }
  })

  it('should_follow_the_finger_on_flat_areas (AC-12)', () => {
    const image = greyImage(200, 200, () => 0.5, 0)
    const rand = mulberry32(12)
    const finger: Point[] = []
    for (let k = 0; k < 120; k++) {
      finger.push({
        x: 40 + k + rand() * 3,
        y: 100 + 20 * Math.sin(k / 15) + rand() * 3,
      })
    }
    const path = snapToEdges(image, finger, REACH)
    expect(path.length).toBeGreaterThan(0)
    for (const p of path) {
      expect(Number.isNaN(p.x) || Number.isNaN(p.y)).toBe(false)
      expect(toPolyline(p, finger)).toBeLessThanOrEqual(REACH + 1)
    }
  })

  it('should_handle_degenerate_paths (Review Focus 2)', () => {
    const scene = lineScene()
    const p = scene.at(0)
    expect(snapToEdges(scene.image, [], REACH)).toEqual([])
    expect(snapToEdges(scene.image, [p], REACH)).toHaveLength(1)
    expect(snapToEdges(scene.image, [p, p, p], REACH)).toHaveLength(1)
    expect(
      snapToEdges(scene.image, [p, { x: p.x + 0.3, y: p.y }], REACH),
    ).toHaveLength(1)
    expect(() =>
      snapToEdges(scene.image, [{ x: Number.NaN, y: 3 }], REACH),
    ).toThrow(RangeError)
    expect(() => snapToEdges(scene.image, [p], 0)).toThrow(RangeError)
    expect(() => snapToEdges(scene.image, [p], -1)).toThrow(RangeError)
  })

  it('should_clip_at_the_image_border (Review Focus 1)', () => {
    // A horizontal edge at y = 3 (rows 0–2 dark), finger along y = 1.
    const image = greyImage(100, 40, (k) =>
      Math.floor(k / 100) < 3 ? 0.2 : 0.8,
    )
    const finger: Point[] = []
    for (let x = 10; x <= 90; x++) finger.push({ x, y: 1 })
    const path = snapToEdges(image, finger, REACH)
    expect(path.length).toBeGreaterThan(70)
    for (const q of path) expect(Math.abs(q.y - 3)).toBeLessThanOrEqual(0.25)
  })

  it('should_keep_small_reaches_connected (Task 3 ruling)', () => {
    // At 16× zoom, 12 pt is under 1 image px: the path must still be connected.
    const scene = lineScene()
    const finger = wobblyFinger(scene, -40, 40, 0.3, 5)
    const path = snapToEdges(scene.image, finger, 0.6)
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1] as Point
      const b = path[k] as Point
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(3)
    }
    for (const q of path) expect(toPolyline(q, finger)).toBeLessThanOrEqual(2)
  })
})
