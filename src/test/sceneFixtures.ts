import type { Point, Size } from '../core/geometry/types'
import type { RgbaImage } from '../core/mask/types'
import { circle, softMask } from './maskFixtures'
import { mulberry32 } from './random'

/** A colour with channels in 0..1. */
export type RGB = [number, number, number]

const to8 = (v: number) => Math.min(255, Math.max(0, Math.round(v * 255)))

/**
 * An opaque photo-like image: each channel is coverage·fg + (1 − coverage)·bg,
 * plus a texture on the object (texture·sin(0.9x)·cos(0.7y)) and seeded noise
 * (noise·(u1 + u2 + u3 − 1.5)), rounded to 8 bits.
 */
export function paintScene(
  coverage: Float32Array,
  size: Size,
  fg: RGB,
  bg: RGB,
  opts: { noise: number; seed: number; texture?: number },
): RgbaImage {
  const rand = mulberry32(opts.seed)
  const data = new Uint8Array(size.width * size.height * 4)
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const k = y * size.width + x
      const c = coverage[k] as number
      const tex = (opts.texture ?? 0) * Math.sin(0.9 * x) * Math.cos(0.7 * y)
      for (let ch = 0; ch < 3; ch++) {
        const noise = opts.noise * (rand() + rand() + rand() - 1.5)
        data[k * 4 + ch] = to8(
          c * ((fg[ch] as number) + tex) + (1 - c) * (bg[ch] as number) + noise,
        )
      }
      data[k * 4 + 3] = 255
    }
  }
  return { width: size.width, height: size.height, data }
}

/** Columns left of `column` are `left`, the rest `right`: a vertical step between column − 1 and column. */
export function stepImage(
  width: number,
  height: number,
  column: number,
  left: RGB,
  right: RGB,
): RgbaImage {
  const coverage = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < column; x++) coverage[y * width + x] = 1
  }
  return paintScene(coverage, { width, height }, left, right, {
    noise: 0,
    seed: 1,
  })
}

/** A scene with a known edge: the image and the distance from a point to the true edge. */
export interface EdgeScene {
  image: RgbaImage
  /** Distance (image px) from p to the true edge. */
  dist: (p: Point) => number
  /** A point on the true edge at parameter t (arc length from the scene's centre, px). */
  at: (t: number) => Point
}

const SCENE_SIZE = { width: 420, height: 420 }
const FG: RGB = [0.8, 0.3, 0.2]
const BG: RGB = [0.2, 0.5, 0.8]

/** The half-plane below a 17° line through (210.2, 210.6), anti-aliased, 2% noise. */
export function lineScene(seed = 3, angleDeg = 17): EdgeScene {
  const a = (angleDeg * Math.PI) / 180
  const c = { x: 210.2, y: 210.6 }
  const u = { x: Math.cos(a), y: Math.sin(a) }
  const n = { x: -u.y, y: u.x }
  const far = 1000
  const poly: Point[] = [
    { x: c.x - far * u.x, y: c.y - far * u.y },
    { x: c.x + far * u.x, y: c.y + far * u.y },
    { x: c.x + far * (u.x + n.x), y: c.y + far * (u.y + n.y) },
    { x: c.x + far * (n.x - u.x), y: c.y + far * (n.y - u.y) },
  ]
  const cov = softMask([{ op: 'add', points: poly }], SCENE_SIZE).data
  return {
    image: paintScene(cov, SCENE_SIZE, FG, BG, { noise: 0.02, seed }),
    dist: (p) => Math.abs((p.x - c.x) * n.x + (p.y - c.y) * n.y),
    at: (t) => ({ x: c.x + t * u.x, y: c.y + t * u.y }),
  }
}

/** A disc of radius 150 at (210.3, 209.7), anti-aliased, 2% noise. */
export function circleScene(seed = 3): EdgeScene {
  const c = { x: 210.3, y: 209.7 }
  const r = 150
  const cov = softMask([{ op: 'add', points: circle(c, r) }], SCENE_SIZE).data
  return {
    image: paintScene(cov, SCENE_SIZE, FG, BG, { noise: 0.02, seed }),
    dist: (p) => Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r),
    at: (t) => ({
      x: c.x + r * Math.cos(t / r),
      y: c.y + r * Math.sin(t / r),
    }),
  }
}
