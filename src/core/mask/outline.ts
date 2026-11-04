import type { RgbaImage } from './types'

/** Stands in for "no subject pixel" in the distance transform (Infinity would give NaN). */
const FAR = 1e20

/**
 * Exact 1-D squared distance transform (Felzenszwalb–Huttenlocher), in place
 * on `f[start + i·stride]` for i < n.
 */
function edt1d(
  f: Float64Array,
  start: number,
  stride: number,
  n: number,
  buf: { g: Float64Array; v: Int32Array; z: Float64Array },
): void {
  const { g, v, z } = buf
  for (let i = 0; i < n; i++) g[i] = f[start + i * stride] as number
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  const meet = (q: number, p: number) =>
    ((g[q] as number) + q * q - ((g[p] as number) + p * p)) / (2 * q - 2 * p)
  for (let q = 1; q < n; q++) {
    let s = meet(q, v[k] as number)
    while (s <= (z[k] as number)) {
      k--
      s = meet(q, v[k] as number)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] as number) < q) k++
    const p = v[k] as number
    f[start + q * stride] = (q - p) * (q - p) + (g[p] as number)
  }
}

/**
 * Grows the image by ⌈widthPx⌉ + 1 px on each side and draws a solid outline
 * under the subject (pixels with alpha ≥ 50%). Outline alpha is
 * clamp(widthPx + 0.5 − d, 0, 1) for d the distance from the pixel centre to
 * the nearest subject pixel centre; the subject is composited over it, so
 * fully opaque subject pixels are unchanged.
 */
export function addOutline(
  image: RgbaImage,
  options: { widthPx: number; color: readonly [number, number, number] },
): RgbaImage {
  const { widthPx, color } = options
  if (!(widthPx > 0) || !Number.isFinite(widthPx)) {
    throw new RangeError(
      `outline width must be a positive number, got ${String(widthPx)}`,
    )
  }
  const pad = Math.ceil(widthPx) + 1
  const width = image.width + 2 * pad
  const height = image.height + 2 * pad
  const dist = new Float64Array(width * height).fill(FAR)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if ((image.data[(y * image.width + x) * 4 + 3] as number) >= 128) {
        dist[(y + pad) * width + x + pad] = 0
      }
    }
  }
  const n = Math.max(width, height)
  const buf = {
    g: new Float64Array(n),
    v: new Int32Array(n),
    z: new Float64Array(n + 1),
  }
  for (let y = 0; y < height; y++) edt1d(dist, y * width, 1, width, buf)
  for (let x = 0; x < width; x++) edt1d(dist, x, width, height, buf)

  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = y * width + x
      const oa = Math.min(
        1,
        Math.max(0, widthPx + 0.5 - Math.sqrt(dist[k] as number)),
      )
      const sx = x - pad
      const sy = y - pad
      const inside = sx >= 0 && sx < image.width && sy >= 0 && sy < image.height
      const s = inside ? (sy * image.width + sx) * 4 : -1
      const sa = inside ? (image.data[s + 3] as number) / 255 : 0
      const outA = sa + oa * (1 - sa)
      if (outA === 0) continue
      for (let c = 0; c < 3; c++) {
        const sc = inside ? (image.data[s + c] as number) : 0
        data[k * 4 + c] = Math.round(
          (sc * sa + (color[c] as number) * oa * (1 - sa)) / outA,
        )
      }
      data[k * 4 + 3] = Math.round(outA * 255)
    }
  }
  return { width, height, data }
}
