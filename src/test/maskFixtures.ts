import type { Point, Size } from '../core/geometry/types'
import { rasterizeRings } from '../core/mask/rasterize'
import type { Ring } from '../core/selection/types'
import type { CoverageMask } from '../core/contour/types'
import { mulberry32 } from './random'

/** Soft (anti-aliased) coverage of polygon rings composed in order, from spec 0004. */
export function softMask(
  rings: readonly { op: Ring['op']; points: readonly Point[] }[],
  size: Size,
): CoverageMask {
  const data = rasterizeRings(
    rings.map((r) => ({
      op: r.op,
      nodes: r.points.map(({ x, y }) => ({ x, y, kind: 'corner' as const })),
    })),
    size,
  )
  return { width: size.width, height: size.height, data }
}

/** The same mask thresholded at 50%: every value exactly 0 or 1. */
export function hardMask(mask: CoverageMask): CoverageMask {
  return { ...mask, data: mask.data.map((v) => (v >= 0.5 ? 1 : 0)) }
}

export function maskOf(
  width: number,
  height: number,
  value: (i: number, j: number) => number,
): CoverageMask {
  const data = new Float32Array(width * height)
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) data[j * width + i] = value(i, j)
  }
  return { width, height, data }
}

/** Points along an arc of a circle, `from` to `to` (radians), about one per 0.25 px. */
export function arc(
  c: Point,
  r: number,
  from: number,
  to: number,
  includeEnd = true,
): Point[] {
  const n = Math.max(8, Math.ceil((Math.abs(to - from) * r) / 0.25))
  const last = includeEnd ? n : n - 1
  return Array.from({ length: last + 1 }, (_, k) => {
    const a = from + ((to - from) * k) / n
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }
  })
}

export const circle = (c: Point, r: number): Point[] =>
  arc(c, r, 0, 2 * Math.PI, false)

export const rect = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]

/** A rectangle whose corners are rounded with radius `r`, except those listed in `sharp` (0 = top left, clockwise). */
export function roundedRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  sharp: readonly number[] = [],
): Point[] {
  const h = Math.PI / 2
  const corners: [Point, Point, number][] = [
    [{ x: x0, y: y0 }, { x: x0 + r, y: y0 + r }, 2 * h],
    [{ x: x1, y: y0 }, { x: x1 - r, y: y0 + r }, 3 * h],
    [{ x: x1, y: y1 }, { x: x1 - r, y: y1 - r }, 0],
    [{ x: x0, y: y1 }, { x: x0 + r, y: y1 - r }, h],
  ]
  return corners.flatMap(([corner, centre, start], k) =>
    sharp.includes(k) ? [corner] : arc(centre, r, start, start + h),
  )
}

/** A half disc: the arc on the right of the vertical diameter. Sharp corners at the diameter's ends. */
export const halfDisc = (c: Point, r: number): Point[] =>
  arc(c, r, -Math.PI / 2, Math.PI / 2)

/** A smooth seeded blob: radius modulated by a few low harmonics. */
export function blob(seed: number, c: Point, r: number): Point[] {
  const rand = mulberry32(seed)
  const harmonics = [2, 3, 4, 5].map((k) => ({
    k,
    a: (rand() * 0.12) / (k / 2),
    phase: rand() * 2 * Math.PI,
  }))
  const n = Math.ceil((2 * Math.PI * r) / 0.25)
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI
    let rr = r
    for (const h of harmonics) rr += r * h.a * Math.cos(h.k * t + h.phase)
    return { x: c.x + rr * Math.cos(t), y: c.y + rr * Math.sin(t) }
  })
}

/** A five-pointed star, outer radius `r`, inner radius 0.45·r. */
export function star(c: Point, r: number): Point[] {
  return Array.from({ length: 10 }, (_, k) => {
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    const rr = k % 2 === 0 ? r : 0.45 * r
    return { x: c.x + rr * Math.cos(a), y: c.y + rr * Math.sin(a) }
  })
}
