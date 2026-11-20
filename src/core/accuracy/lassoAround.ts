import { fromAlphaMask, maskToRings } from '../contour'
import { sampleSegment, toBezierSegments } from '../geometry/bezier'
import { area } from '../geometry/polygon'
import type { Point } from '../geometry/types'
import type { Mask } from './score'

/** Seeded, so a lasso repeats run after run. */
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Holes smaller than this share of the subject's area are not traced: a finger wouldn't. */
export const MIN_HOLE_SHARE = 0.01

interface RingPath {
  op: 'add' | 'subtract'
  /** The ring's curve, sampled at most 1 px apart, without the closing repeat. */
  pts: Point[]
  area: number
}

function ringPaths(truth: Mask): RingPath[] {
  return maskToRings(fromAlphaMask(truth)).map((ring) => {
    const pts: Point[] = []
    for (const seg of toBezierSegments(ring.nodes, true)) {
      const s = sampleSegment(seg, 1)
      pts.push(...(pts.length === 0 ? s : s.slice(1)))
    }
    pts.pop()
    return { op: ring.op, pts, area: Math.abs(area(pts)) }
  })
}

const largestAdd = (rings: readonly RingPath[]) =>
  rings
    .filter((r) => r.op === 'add')
    .reduce<RingPath | null>(
      (best, r) => (best && best.area >= r.area ? best : r),
      null,
    )

/**
 * A finger-like lasso around the truth (spec 0014 AC-5): its 50% outline,
 * each point pushed along the outline's normal by a smooth wobble of at most
 * `wobblePx`, made of two sines (3 and 7 waves per lap) with seeded phases.
 * Closed: the last point repeats the first. Empty when the truth is empty.
 */
export function lassoAround(
  truth: Mask,
  seed: number,
  wobblePx: number,
): Point[] {
  return wobbled(largestAdd(ringPaths(truth))?.pts ?? [], seed, wobblePx)
}

/**
 * Finger-like traces around the truth's holes, the way a user lassoes them
 * in Subtract mode: one per hole of at least MIN_HOLE_SHARE of the subject's
 * area, each wobbling like `lassoAround` (seeds `seed + 1`, `seed + 2`, …).
 */
export function lassoHoles(
  truth: Mask,
  seed: number,
  wobblePx: number,
): Point[][] {
  const rings = ringPaths(truth)
  const subject = largestAdd(rings)?.area ?? 0
  return rings
    .filter((r) => r.op === 'subtract' && r.area >= MIN_HOLE_SHARE * subject)
    .map((r, i) => wobbled(r.pts, seed + 1 + i, wobblePx))
    .filter((path) => path.length > 0)
}

/** `line` pushed along its normal by the two-sine wobble; closed, or empty under 3 points. */
function wobbled(
  line: readonly Point[],
  seed: number,
  wobblePx: number,
): Point[] {
  const n = line.length
  if (n < 3) return []
  const rand = mulberry32(seed)
  const phase1 = rand() * 2 * Math.PI
  const phase2 = rand() * 2 * Math.PI
  // Arc fraction at each point, so the waves spread evenly by length.
  const cum = [0]
  for (let i = 1; i <= n; i++) {
    const a = line[i - 1] as Point
    const b = line[i % n] as Point
    cum.push((cum[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const total = cum[n] as number
  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = line[(i - 1 + n) % n] as Point
    const next = line[(i + 1) % n] as Point
    const p = line[i] as Point
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    const t = (cum[i] as number) / total
    const w =
      wobblePx *
      (0.6 * Math.sin(2 * Math.PI * 3 * t + phase1) +
        0.4 * Math.sin(2 * Math.PI * 7 * t + phase2))
    out.push({ x: p.x + (w * ty) / len, y: p.y - (w * tx) / len })
  }
  out.push({ ...(out[0] as Point) })
  return out
}
