import type { Point, Size } from '../core/geometry/types'
import type { AlphaMask, RgbaImage } from '../core/mask/types'
import type { Ring, Selection, SoftEdge } from '../core/selection/types'
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

/** Spec 0006 AC-16 colour pairs (object / background). */
export const SMART_EDGE_SCENES = {
  contrast: { fg: [0.8, 0.3, 0.2], bg: [0.2, 0.5, 0.8], noise: 0.02 },
  isoluminant: { fg: [0.7, 0.4, 0.4], bg: [0.3, 0.6, 0.4], noise: 0.02 },
  textured: {
    fg: [0.6, 0.4, 0.3],
    bg: [0.2, 0.5, 0.8],
    noise: 0.04,
    texture: 0.15,
  },
} as const satisfies Record<
  string,
  { fg: RGB; bg: RGB; noise: number; texture?: number }
>

export type SmartEdgeSceneKind = keyof typeof SMART_EDGE_SCENES

export interface SmartEdgeScene {
  size: Size
  image: RgbaImage
  /** The painted (true) coverage. */
  truth: Float32Array
  /** One ring per drawn shape, as corner dots, with the given soft edge. */
  selection: Selection
}

const DISC_SIZE = { width: 96, height: 96 }
const DISC_C = { x: 48.3, y: 47.8 }
const DISC_R = 25

const ringOf = (op: Ring['op'], points: readonly Point[]): Ring => ({
  op,
  nodes: points.map(({ x, y }) => ({ x, y, kind: 'corner' as const })),
})

const selectionOf = (rings: Ring[], softEdge: SoftEdge): Selection => ({
  rings,
  strokes: [],
  feather: 0,
  softEdge,
})

/** A disc of radius 25 in 96 × 96, painted in `kind`'s colours; the ring is drawn `delta` px larger. */
export function discScene(
  kind: SmartEdgeSceneKind,
  delta: number,
  softEdge: SoftEdge = { source: 'guided', bandPx: 8 },
): SmartEdgeScene {
  const s = SMART_EDGE_SCENES[kind] as {
    fg: RGB
    bg: RGB
    noise: number
    texture?: number
  }
  const truth = softMask(
    [{ op: 'add', points: circle(DISC_C, DISC_R) }],
    DISC_SIZE,
  ).data
  const image = paintScene(truth, DISC_SIZE, s.fg, s.bg, {
    noise: s.noise,
    seed: 7,
    ...(s.texture === undefined ? {} : { texture: s.texture }),
  })
  return {
    size: DISC_SIZE,
    image,
    truth,
    selection: selectionOf(
      [ringOf('add', circle(DISC_C, DISC_R + delta))],
      softEdge,
    ),
  }
}

/** The disc plus 24 hair strands 0.8 px wide reaching from radius 24 to 32; dark hair on a light background. */
export function hairScene(
  delta: number,
  softEdge: SoftEdge = { source: 'guided', bandPx: 8 },
): SmartEdgeScene & { strands: Float32Array } {
  const disc = softMask(
    [{ op: 'add', points: circle(DISC_C, DISC_R) }],
    DISC_SIZE,
  ).data
  const strands = new Float32Array(DISC_SIZE.width * DISC_SIZE.height)
  for (let s = 0; s < 24; s++) {
    const a = (s / 24) * 2 * Math.PI + 0.1
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const pts: Point[] = [
      { x: DISC_C.x + ux * 24 - uy * 0.4, y: DISC_C.y + uy * 24 + ux * 0.4 },
      { x: DISC_C.x + ux * 32 - uy * 0.4, y: DISC_C.y + uy * 32 + ux * 0.4 },
      { x: DISC_C.x + ux * 32 + uy * 0.4, y: DISC_C.y + uy * 32 - ux * 0.4 },
      { x: DISC_C.x + ux * 24 + uy * 0.4, y: DISC_C.y + uy * 24 - ux * 0.4 },
    ]
    const m = softMask([{ op: 'add', points: pts }], DISC_SIZE).data
    for (let k = 0; k < m.length; k++)
      strands[k] = Math.min(1, (strands[k] as number) + (m[k] as number))
  }
  const truth = disc.map((v, k) => Math.min(1, v + (strands[k] as number)))
  const image = paintScene(
    truth,
    DISC_SIZE,
    [0.3, 0.2, 0.1],
    [0.85, 0.85, 0.9],
    {
      noise: 0.02,
      seed: 7,
    },
  )
  return {
    size: DISC_SIZE,
    image,
    truth,
    strands,
    selection: selectionOf(
      [ringOf('add', circle(DISC_C, DISC_R + delta))],
      softEdge,
    ),
  }
}

/** A donut (outer radius 30, hole radius 12) at the centre of 96 × 96; rings drawn `delta` larger / `delta` smaller. */
export function donutScene(
  kind: SmartEdgeSceneKind,
  delta: number,
  bandPx = 8,
): SmartEdgeScene {
  const s = SMART_EDGE_SCENES[kind] as {
    fg: RGB
    bg: RGB
    noise: number
    texture?: number
  }
  const truth = softMask(
    [
      { op: 'add', points: circle(DISC_C, 30) },
      { op: 'subtract', points: circle(DISC_C, 12) },
    ],
    DISC_SIZE,
  ).data
  const image = paintScene(truth, DISC_SIZE, s.fg, s.bg, {
    noise: s.noise,
    seed: 7,
  })
  return {
    size: DISC_SIZE,
    image,
    truth,
    selection: selectionOf(
      [
        ringOf('add', circle(DISC_C, 30 + delta)),
        ringOf('subtract', circle(DISC_C, 12 - delta)),
      ],
      { source: 'guided', bandPx },
    ),
  }
}

/** The AI model's view: `truth` area-averaged down by `factor`, then bilinearly upscaled (blurry). */
export function blurredModel(
  truth: Float32Array,
  size: Size,
  factor = 4,
): AlphaMask {
  const w = Math.ceil(size.width / factor)
  const h = Math.ceil(size.height / factor)
  const small = new Float64Array(w * h)
  const count = new Float64Array(w * h)
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const k = Math.floor(y / factor) * w + Math.floor(x / factor)
      small[k] = (small[k] as number) + (truth[y * size.width + x] as number)
      count[k] = (count[k] as number) + 1
    }
  }
  for (let k = 0; k < small.length; k++)
    small[k] = (small[k] as number) / (count[k] as number)
  const data = new Uint8Array(size.width * size.height)
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / factor - 0.5))
      const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / factor - 0.5))
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(w - 1, x0 + 1)
      const y1 = Math.min(h - 1, y0 + 1)
      const tx = sx - x0
      const ty = sy - y0
      const v =
        (1 - ty) *
          ((1 - tx) * (small[y0 * w + x0] as number) +
            tx * (small[y0 * w + x1] as number)) +
        ty *
          ((1 - tx) * (small[y1 * w + x0] as number) +
            tx * (small[y1 * w + x1] as number))
      data[y * size.width + x] = Math.round(v * 255)
    }
  }
  return { width: size.width, height: size.height, data }
}
