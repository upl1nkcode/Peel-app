import type { Size } from '../geometry/types'

/** Modified Bessel function of the first kind I_n(t), by its power series (t ≤ 1.44 here). */
function besselI(n: number, t: number): number {
  const half = t / 2
  let term = 1
  for (let k = 1; k <= n; k++) term *= half / k // (t/2)^n / n!
  let sum = term
  for (let m = 1; m < 60 && term > sum * 1e-17; m++) {
    term *= (half * half) / (m * (m + n))
    sum += term
  }
  return sum
}

/**
 * Normalised 1-D kernel for feather `px`: σ = px / 2.5, radius ⌈3σ⌉. Uses the
 * discrete Gaussian T(n, t) = e^(−t)·I_n(t) with t = σ², whose variance is
 * exactly σ²; a sampled Gaussian is too narrow at these small σ and would
 * make the edge transition visibly narrower than `px`.
 */
export function featherKernel(px: number): Float64Array {
  const sigma = px / 2.5
  const t = sigma * sigma
  const r = Math.ceil(3 * sigma)
  const k = new Float64Array(2 * r + 1)
  let sum = 0
  for (let n = 0; n <= r; n++) {
    const v = Math.exp(-t) * besselI(n, t)
    k[r + n] = v
    k[r - n] = v
    sum += n === 0 ? v : 2 * v
  }
  for (let i = 0; i < k.length; i++) k[i] = (k[i] as number) / sum
  return k
}

/**
 * Blurs `coverage` in place with the feather kernel (separable, rows then
 * columns), extending the mask outward at the image border (clamp). `px` 0
 * leaves it unchanged.
 */
export function feather(coverage: Float32Array, size: Size, px: number): void {
  if (!(px > 0)) return
  const k = featherKernel(px)
  const r = (k.length - 1) / 2
  const { width: w, height: h } = size
  const taps = k.length

  // Rows: clamp-extended copy of each row, convolved into `rows`.
  const rows = new Float32Array(w * h)
  const line = new Float64Array(w + 2 * r)
  for (let j = 0; j < h; j++) {
    const base = j * w
    for (let i = -r; i < w + r; i++) {
      line[i + r] = coverage[base + (i < 0 ? 0 : i >= w ? w - 1 : i)] as number
    }
    for (let i = 0; i < w; i++) {
      let acc = 0
      for (let q = 0; q < taps; q++) {
        acc += (k[q] as number) * (line[i + q] as number)
      }
      rows[base + i] = acc
    }
  }

  // Columns, a whole row at a time (contiguous reads): output row j is the
  // weighted sum of rows j − r … j + r, clamped at the top and bottom.
  const acc = new Float64Array(w)
  for (let j = 0; j < h; j++) {
    acc.fill(0)
    for (let q = 0; q < taps; q++) {
      const src = Math.min(h - 1, Math.max(0, j + q - r)) * w
      const kq = k[q] as number
      for (let i = 0; i < w; i++) {
        acc[i] = (acc[i] as number) + kq * (rows[src + i] as number)
      }
    }
    coverage.set(acc, j * w)
  }
}
