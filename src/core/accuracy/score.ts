import type { AlphaMask } from '../mask/types'
import { distanceToSet } from './distance'

/** An 8-bit alpha mask; inside means alpha ≥ 128 (spec 0014 AC-4). */
export type Mask = AlphaMask

/** How one cutout compares with its truth (spec 0014 AC-4). */
export interface Scores {
  /** |inside both| ÷ |inside either|; 1 when both are empty. */
  iou: number
  /** Mean boundary-to-boundary distance (px), both ways pooled. */
  edgeMean: number
  /** 99th percentile (nearest rank) of the same distances. */
  edgeP99: number
  /** Share of the cutout lying on the distractor; 0 without one. */
  extra: number
  /** Mean |got − truth| ÷ 255 over the soft band; `null` under 500 band pixels. */
  softError: number | null
}

/** softError needs a band at least this big to mean anything. */
export const SOFT_BAND_MIN_PX = 500
/** The soft band reaches this far (px) from a soft truth pixel. */
const SOFT_BAND_REACH_PX = 3
const INSIDE = 128

function sameSize(a: Mask, b: Mask, what: string): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new RangeError(
      `${what} is ${String(b.width)}×${String(b.height)}, the cutout ${String(a.width)}×${String(a.height)}`,
    )
  }
  if (b.data.length !== b.width * b.height) {
    throw new RangeError(`${what} must have width × height values`)
  }
}

/** Inside pixels with a 4-neighbour outside, or on the image border. */
function boundary(m: Mask): Uint8Array {
  const { width: W, height: H, data } = m
  const out = new Uint8Array(W * H)
  const inside = (x: number, y: number) => (data[y * W + x] as number) >= INSIDE
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue
      if (
        x === 0 ||
        y === 0 ||
        x === W - 1 ||
        y === H - 1 ||
        !inside(x - 1, y) ||
        !inside(x + 1, y) ||
        !inside(x, y - 1) ||
        !inside(x, y + 1)
      ) {
        out[y * W + x] = 1
      }
    }
  }
  return out
}

function edgeErrors(got: Mask, truth: Mask): { mean: number; p99: number } {
  const { width: W, height: H } = got
  const bg = boundary(got)
  const bt = boundary(truth)
  const toTruth = distanceToSet(W, H, bt)
  const toGot = distanceToSet(W, H, bg)
  const pooled: number[] = []
  for (let i = 0; i < W * H; i++) {
    if (bg[i]) pooled.push(toTruth[i] as number)
    if (bt[i]) pooled.push(toGot[i] as number)
  }
  if (pooled.length === 0) return { mean: 0, p99: 0 }
  let sum = 0
  for (const d of pooled) sum += d
  pooled.sort((a, b) => a - b)
  const rank = Math.ceil(0.99 * pooled.length)
  return { mean: sum / pooled.length, p99: pooled[rank - 1] as number }
}

function softError(got: Mask, truth: Mask): number | null {
  const { width: W, height: H } = truth
  const soft = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const a = truth.data[i] as number
    if (a > 0 && a < 255) soft[i] = 1
  }
  const near = distanceToSet(W, H, soft)
  let n = 0
  let sum = 0
  for (let i = 0; i < W * H; i++) {
    if ((near[i] as number) > SOFT_BAND_REACH_PX) continue
    n++
    sum += Math.abs((got.data[i] as number) - (truth.data[i] as number))
  }
  return n < SOFT_BAND_MIN_PX ? null : sum / 255 / n
}

/** Scores a cutout against its truth and, optionally, a distractor (spec 0014 AC-4). */
export function scoreCutout(got: Mask, truth: Mask, extra?: Mask): Scores {
  sameSize(got, got, 'the cutout')
  sameSize(got, truth, 'the truth')
  if (extra) sameSize(got, extra, 'the distractor')
  let both = 0
  let either = 0
  let mine = 0
  let onExtra = 0
  for (let i = 0; i < got.data.length; i++) {
    const g = (got.data[i] as number) >= INSIDE
    const t = (truth.data[i] as number) >= INSIDE
    if (g && t) both++
    if (g || t) either++
    if (g) {
      mine++
      if (extra && (extra.data[i] as number) >= INSIDE) onExtra++
    }
  }
  const edge = edgeErrors(got, truth)
  return {
    iou: either === 0 ? 1 : both / either,
    edgeMean: edge.mean,
    edgeP99: edge.p99,
    extra: mine === 0 ? 0 : onExtra / mine,
    softError: softError(got, truth),
  }
}
