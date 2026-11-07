import { traceContours } from '../contour/trace'
import type { Point, Size } from '../geometry/types'
import type { EdgeRefiner } from '../mask/render'
import type { AlphaMask, RgbaImage } from '../mask/types'
import type { SoftEdge } from '../selection/types'

/**
 * Object and background colours this far apart (Euclidean RGB, channels
 * 0..1) are fully trusted; closer colours blend toward the fallback in
 * proportion, and equal colours keep it (spec 0006 Decision 2).
 */
export const COLOUR_TRUST_DISTANCE = 0.15

/** Band widths at full resolution (spec 0003). */
const BAND_MIN_PX = 2
const BAND_MAX_PX = 20
/** Window sums are built per tile of this many pixels square. */
const TILE = 64

function segDist(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const ex = px - a.x - t * dx
  const ey = py - a.y - t * dy
  return Math.sqrt(ex * ex + ey * ey)
}

/**
 * True for a traced segment that lies against the zero padding of one image
 * side: such crossings are within half a pixel outside the first pixel centre
 * (x ≤ 0.5, …), and mark where the selection runs off the image, not an edge.
 */
function onBorder(a: Point, b: Point, width: number, height: number): boolean {
  return (
    (a.x <= 0.5 && b.x <= 0.5) ||
    (a.y <= 0.5 && b.y <= 0.5) ||
    (a.x >= width - 0.5 && b.x >= width - 0.5) ||
    (a.y >= height - 0.5 && b.y >= height - 0.5)
  )
}

/**
 * The smart-edge band (spec 0006): 1 where a pixel centre is within
 * `bandPx / 2` of the 50% line of `coverage` (traced as in spec 0005). The
 * image border is not part of that line.
 */
export function bandMask(
  coverage: Float32Array,
  size: Size,
  bandPx: number,
): Uint8Array {
  const { width, height } = size
  const band = new Uint8Array(width * height)
  const half = bandPx / 2
  for (const contour of traceContours({ width, height, data: coverage })) {
    const pts = contour.points
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k] as Point
      const b = pts[(k + 1) % pts.length] as Point
      if (onBorder(a, b, width, height)) continue
      const i0 = Math.max(0, Math.ceil(Math.min(a.x, b.x) - half - 0.5))
      const i1 = Math.min(
        width - 1,
        Math.floor(Math.max(a.x, b.x) + half - 0.5),
      )
      const j0 = Math.max(0, Math.ceil(Math.min(a.y, b.y) - half - 0.5))
      const j1 = Math.min(
        height - 1,
        Math.floor(Math.max(a.y, b.y) + half - 0.5),
      )
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const o = j * width + i
          if (band[o] === 1) continue
          if (segDist(i + 0.5, j + 0.5, a, b) <= half) band[o] = 1
        }
      }
    }
  }
  return band
}

interface Resampled {
  image: RgbaImage
  model: Uint8Array | undefined
}

/**
 * Smart edge as a `renderMask` refiner (spec 0006 Decisions 1–2, AC-14 to
 * AC-21). In the band, each pixel's alpha is where its colour lies between
 * the mean object colour and the mean background colour of the known
 * (out-of-band) pixels within ⌈band⌉ + 2 px (so every band pixel reaches past
 * the band on both sides), trusted by how far apart those colours are; the
 * rest stays the fallback (the rings' coverage, or the model alpha for
 * `model`). A preview at `scale` area-averages the image (and model alpha)
 * over each preview pixel's image footprint [o/s, (o+1)/s), as the rings are
 * rasterised, so colours and outline line up.
 */
export function smartEdgeRefiner(
  image: RgbaImage,
  modelAlpha?: AlphaMask,
): EdgeRefiner {
  if (
    modelAlpha &&
    (modelAlpha.width !== image.width || modelAlpha.height !== image.height)
  ) {
    throw new RangeError('the model alpha must be the size of the image')
  }
  const { width: W, height: H } = image
  // Only the newest preview scale is kept: zooming asks for a new scale at
  // each step, and a 12 MP photo's copies are tens of MB each.
  let cached: { key: string; value: Resampled } | null = null
  const resampled = (size: Size, scale: number): Resampled => {
    if (scale === 1) return { image, model: modelAlpha?.data }
    const key = `${String(size.width)}x${String(size.height)}@${String(scale)}`
    if (cached?.key === key) return cached.value
    cached = null
    const { width: w, height: h } = size
    const value: Resampled = {
      image: {
        width: w,
        height: h,
        data: resample(image.data, W, H, 4, w, h, scale),
      },
      model: modelAlpha && resample(modelAlpha.data, W, H, 1, w, h, scale),
    }
    cached = { key, value }
    return value
  }

  return (
    mask: Float32Array,
    size: Size,
    softEdge: SoftEdge,
    scale: number,
  ) => {
    if (!(scale > 0 && scale <= 1)) {
      throw new RangeError(`scale must be in (0, 1], got ${String(scale)}`)
    }
    if (size.width > W || size.height > H) {
      throw new RangeError('the mask is larger than the image')
    }
    const fullBand = softEdge.bandPx / scale
    if (!(fullBand >= BAND_MIN_PX - 1e-9 && fullBand <= BAND_MAX_PX + 1e-9)) {
      throw new RangeError(
        `softEdge.bandPx must be in [2, 20] at full resolution, got ${String(fullBand)}`,
      )
    }
    if (softEdge.source === 'model' && !modelAlpha) {
      throw new RangeError('a model soft edge needs the model alpha')
    }
    const { image: img, model } = resampled(size, scale)
    const band = bandMask(mask, size, softEdge.bandPx)
    const radius = Math.ceil(softEdge.bandPx) + 2
    estimate(
      mask,
      band,
      img,
      radius,
      softEdge.source === 'model' ? model : undefined,
    )
  }
}

/**
 * Per output index o: the source indices overlapping [o/s, (o+1)/s) ∩ [0, N)
 * and their weights (overlap / footprint), flattened with offsets.
 */
function footprints(n: number, N: number, scale: number) {
  const start = new Int32Array(n + 1)
  const index: number[] = []
  const weight: number[] = []
  for (let o = 0; o < n; o++) {
    start[o] = index.length
    const a = o / scale
    const b = Math.min((o + 1) / scale, N)
    for (let i = Math.floor(a); i < b && i < N; i++) {
      const overlap = Math.min(b, i + 1) - Math.max(a, i)
      if (overlap > 0) {
        index.push(i)
        weight.push(overlap / (b - a))
      }
    }
  }
  start[n] = index.length
  return {
    start,
    index: Int32Array.from(index),
    weight: Float64Array.from(weight),
  }
}

/** `channels` interleaved byte channels, area-averaged over each output pixel's footprint (separable). */
function resample(
  src: Uint8Array,
  W: number,
  H: number,
  channels: number,
  w: number,
  h: number,
  scale: number,
): Uint8Array {
  const fx = footprints(w, W, scale)
  const fy = footprints(h, H, scale)
  const line = w * channels
  // One source row at a time, resampled across as each output row needs it
  // (a row under two output rows is done twice), so memory is two lines,
  // not a full-height copy (spec 0009 final review I-3). Same sums, same order.
  const row = new Float64Array(line)
  const across = (y: number): void => {
    row.fill(0)
    for (let o = 0; o < w; o++) {
      const out = o * channels
      for (
        let t = fx.start[o] as number;
        t < (fx.start[o + 1] as number);
        t++
      ) {
        const at = (y * W + (fx.index[t] as number)) * channels
        const wt = fx.weight[t] as number
        for (let c = 0; c < channels; c++) {
          row[out + c] = (row[out + c] as number) + wt * (src[at + c] as number)
        }
      }
    }
  }
  const dst = new Uint8Array(h * line)
  const acc = new Float64Array(line)
  for (let o = 0; o < h; o++) {
    acc.fill(0)
    for (let t = fy.start[o] as number; t < (fy.start[o + 1] as number); t++) {
      const wt = fy.weight[t] as number
      across(fy.index[t] as number)
      for (let k = 0; k < line; k++) {
        acc[k] = (acc[k] as number) + wt * (row[k] as number)
      }
    }
    for (let k = 0; k < line; k++)
      dst[o * line + k] = Math.round(acc[k] as number)
  }
  return dst
}

/**
 * Rewrites the band pixels of `mask` in place. Window sums of the known
 * object / background pixels' colours come from integral images built per
 * tile (padded by the window radius), so the cost grows with the band, not
 * the image.
 */
function estimate(
  mask: Float32Array,
  band: Uint8Array,
  img: RgbaImage,
  radius: number,
  model: Uint8Array | undefined,
): void {
  const { width: W, height: H, data } = img
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  for (let k = 0; k < band.length; k++) {
    if (band[k] !== 1) continue
    const x = k % W
    const y = (k - x) / W
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX < 0) return

  const stride = TILE + 2 * radius + 1
  // Integral images, interleaved per corner: count and R, G, B byte sums for
  // object (0–3) and background (4–7). Whole bytes, so Int32 sums are exact.
  const S = new Int32Array(stride * stride * 8)
  const trust = COLOUR_TRUST_DISTANCE

  for (let ty = minY; ty <= maxY; ty += TILE) {
    for (let tx = minX; tx <= maxX; tx += TILE) {
      const tx1 = Math.min(tx + TILE, maxX + 1)
      const ty1 = Math.min(ty + TILE, maxY + 1)
      if (!hasBand(band, W, tx, ty, tx1, ty1)) continue
      const px0 = Math.max(0, tx - radius)
      const py0 = Math.max(0, ty - radius)
      const px1 = Math.min(W, tx1 + radius)
      const py1 = Math.min(H, ty1 + radius)
      const pw = px1 - px0
      const ph = py1 - py0
      const s = (pw + 1) * 8
      S.fill(0, 0, s)
      for (let j = 0; j < ph; j++) {
        let fn = 0
        let fr = 0
        let fg = 0
        let fb = 0
        let bn = 0
        let br = 0
        let bg = 0
        let bb = 0
        let o = (j + 1) * s
        S.fill(0, o, o + 8)
        let k = (py0 + j) * W + px0
        for (let i = 0; i < pw; i++, k++) {
          if (band[k] !== 1) {
            const q = k * 4
            if ((mask[k] as number) >= 0.5) {
              fn++
              fr += data[q] as number
              fg += data[q + 1] as number
              fb += data[q + 2] as number
            } else {
              bn++
              br += data[q] as number
              bg += data[q + 1] as number
              bb += data[q + 2] as number
            }
          }
          o += 8
          const u = o - s
          S[o] = (S[u] as number) + fn
          S[o + 1] = (S[u + 1] as number) + fr
          S[o + 2] = (S[u + 2] as number) + fg
          S[o + 3] = (S[u + 3] as number) + fb
          S[o + 4] = (S[u + 4] as number) + bn
          S[o + 5] = (S[u + 5] as number) + br
          S[o + 6] = (S[u + 6] as number) + bg
          S[o + 7] = (S[u + 7] as number) + bb
        }
      }
      const sum = new Float64Array(8)
      for (let y = ty; y < ty1; y++) {
        for (let x = tx; x < tx1; x++) {
          const k = y * W + x
          if (band[k] !== 1) continue
          const x0 = (Math.max(0, x - radius) - px0) * 8
          const y0 = (Math.max(0, y - radius) - py0) * s
          const x1 = (Math.min(W, x + radius + 1) - px0) * 8
          const y1 = (Math.min(H, y + radius + 1) - py0) * s
          for (let c = 0; c < 8; c++) {
            sum[c] =
              (S[y1 + x1 + c] as number) -
              (S[y0 + x1 + c] as number) -
              (S[y1 + x0 + c] as number) +
              (S[y0 + x0 + c] as number)
          }
          const nf = sum[0] as number
          const nb = sum[4] as number
          const fallback =
            model === undefined
              ? (mask[k] as number)
              : (model[k] as number) / 255
          if (nf === 0 || nb === 0) {
            mask[k] = fallback
            continue
          }
          let dot = 0
          let len2 = 0
          for (let c = 0; c < 3; c++) {
            const f = (sum[1 + c] as number) / nf / 255
            const b = (sum[5 + c] as number) / nb / 255
            const d = f - b
            dot += ((data[k * 4 + c] as number) / 255 - b) * d
            len2 += d * d
          }
          if (len2 === 0) {
            mask[k] = fallback
            continue
          }
          const est = Math.min(1, Math.max(0, dot / len2))
          const w = Math.min(1, Math.sqrt(len2) / trust)
          mask[k] = w * est + (1 - w) * fallback
        }
      }
    }
  }
}

function hasBand(
  band: Uint8Array,
  W: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (band[y * W + x] === 1) return true
  }
  return false
}
