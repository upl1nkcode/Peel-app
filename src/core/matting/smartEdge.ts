import { traceContours } from '../contour/trace'
import type { Point, Size } from '../geometry/types'
import type { EdgeRefiner } from '../mask/render'
import { resizeRgba } from '../mask/resize'
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
 * The smart-edge band (spec 0006): 1 where a pixel centre is within
 * `bandPx / 2` of the 50% line of `coverage` (traced as in spec 0005).
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
 * (out-of-band) pixels within ⌈band⌉ + 2 px (so every band pixel reaches past the band on both sides), trusted by how far apart
 * those colours are; the rest stays the fallback (the rings' coverage, or
 * the model alpha for `model`). Previews use the image (and model alpha)
 * area-averaged to the preview size.
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
  const cache = new Map<string, Resampled>()
  const resampled = (size: Size): Resampled => {
    if (size.width === image.width && size.height === image.height) {
      return { image, model: modelAlpha?.data }
    }
    const key = `${String(size.width)}x${String(size.height)}`
    let hit = cache.get(key)
    if (!hit) {
      hit = {
        image: resizeRgba(image, size.width, size.height),
        model: modelAlpha && resizeAlpha(modelAlpha, size),
      }
      cache.set(key, hit)
    }
    return hit
  }

  return (mask: Float32Array, size: Size, softEdge: SoftEdge) => {
    if (size.width > image.width || size.height > image.height) {
      throw new RangeError('the mask is larger than the image')
    }
    // A preview is ⌈image · scale⌉, so its size bounds the scale only to
    // [(n − 1) / N, n / N] per side; at full size it is exactly 1.
    const full = size.width === image.width && size.height === image.height
    const scaleHi = full
      ? 1
      : Math.min(size.width / image.width, size.height / image.height)
    const scaleLo = full
      ? 1
      : Math.max(
          (size.width - 1) / image.width,
          (size.height - 1) / image.height,
        )
    const bandLo = softEdge.bandPx / scaleHi
    const bandHi = scaleLo > 0 ? softEdge.bandPx / scaleLo : Infinity
    if (
      !Number.isFinite(softEdge.bandPx) ||
      bandHi < BAND_MIN_PX - 1e-9 ||
      bandLo > BAND_MAX_PX + 1e-9
    ) {
      throw new RangeError(
        `softEdge.bandPx must be in [2, 20] at full resolution, got ${String(bandLo)}`,
      )
    }
    if (softEdge.source === 'model' && !modelAlpha) {
      throw new RangeError('a model soft edge needs the model alpha')
    }
    const { image: img, model } = resampled(size)
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

/** The model alpha area-averaged to `size`, via the image resizer (alpha in the red channel). */
function resizeAlpha(alpha: AlphaMask, size: Size): Uint8Array {
  const rgba = new Uint8Array(alpha.width * alpha.height * 4)
  for (let k = 0; k < alpha.data.length; k++) {
    rgba[k * 4] = alpha.data[k] as number
    rgba[k * 4 + 3] = 255
  }
  const small = resizeRgba(
    { width: alpha.width, height: alpha.height, data: rgba },
    size.width,
    size.height,
  )
  const out = new Uint8Array(size.width * size.height)
  for (let k = 0; k < out.length; k++) out[k] = small.data[k * 4] as number
  return out
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
