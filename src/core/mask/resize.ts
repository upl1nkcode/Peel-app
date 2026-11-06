import type { RgbaImage } from './types'

/** For each output index, the source indices and their area weights (summing to 1). */
function areaWeights(
  src: number,
  dst: number,
): { index: number[]; weight: number[] }[] {
  const s = src / dst
  return Array.from({ length: dst }, (_, o) => {
    const lo = o * s
    const hi = (o + 1) * s
    const index: number[] = []
    const weight: number[] = []
    for (let i = Math.floor(lo); i < Math.min(src, Math.ceil(hi)); i++) {
      const overlap = Math.min(hi, i + 1) - Math.max(lo, i)
      if (overlap <= 0) continue
      index.push(i)
      weight.push(overlap / s)
    }
    return { index, weight }
  })
}

/** Area weights in flat arrays: output o uses entries start[o] .. start[o + 1] − 1. */
function flatWeights(table: { index: number[]; weight: number[] }[]): {
  start: Int32Array
  index: Int32Array
  weight: Float64Array
} {
  const start = new Int32Array(table.length + 1)
  for (let o = 0; o < table.length; o++) {
    start[o + 1] = (start[o] as number) + (table[o]?.index.length ?? 0)
  }
  const n = start[table.length] as number
  const index = new Int32Array(n)
  const weight = new Float64Array(n)
  table.forEach((t, o) => {
    index.set(t.index, start[o])
    weight.set(t.weight, start[o])
  })
  return { start, index, weight }
}

const isSize = (n: number): boolean => Number.isInteger(n) && n >= 1

/**
 * Downscales by exact area averaging on premultiplied colour, so transparent
 * pixels never tint their neighbours. Fully transparent results are
 * (0, 0, 0, 0). The same size returns a copy; scaling up throws `RangeError`.
 */
export function resizeRgba(
  image: RgbaImage,
  width: number,
  height: number,
): RgbaImage {
  if (!isSize(width) || !isSize(height)) {
    throw new RangeError(
      `size must be positive integers, got ${String(width)}×${String(height)}`,
    )
  }
  if (width > image.width || height > image.height) {
    throw new RangeError('resizeRgba only scales down')
  }
  if (width === image.width && height === image.height) {
    return { width, height, data: image.data.slice() }
  }
  const sw = image.width
  const sh = image.height
  const src = image.data
  const wx = flatWeights(areaWeights(sw, width))
  const wy = areaWeights(sh, height)
  // One source row resampled horizontally, premultiplied (r·a/255, g·a/255, b·a/255, a).
  // Rows are computed as they are needed, so memory stays O(width) instead
  // of a premultiplied copy of the whole photo; the arithmetic and its order
  // are those of a full premultiplied pass, so results are identical.
  const row = new Float64Array(width * 4)
  const resampleRow = (sy: number) => {
    row.fill(0)
    const base = sy * sw
    for (let x = 0; x < width; x++) {
      const to = x * 4
      let r = 0
      let g = 0
      let b = 0
      let al = 0
      for (
        let q = wx.start[x] as number;
        q < (wx.start[x + 1] as number);
        q++
      ) {
        const from = (base + (wx.index[q] as number)) * 4
        const wq = wx.weight[q] as number
        const a = src[from + 3] as number
        r = r + wq * (((src[from] as number) * a) / 255)
        g = g + wq * (((src[from + 1] as number) * a) / 255)
        b = b + wq * (((src[from + 2] as number) * a) / 255)
        al = al + wq * a
      }
      row[to] = r
      row[to + 1] = g
      row[to + 2] = b
      row[to + 3] = al
    }
  }

  const data = new Uint8Array(width * height * 4)
  const acc = new Float64Array(width * 4)
  for (let y = 0; y < height; y++) {
    const { index, weight } = wy[y] as { index: number[]; weight: number[] }
    acc.fill(0)
    for (let q = 0; q < index.length; q++) {
      resampleRow(index[q] as number)
      const wq = weight[q] as number
      for (let k = 0; k < acc.length; k++) {
        acc[k] = (acc[k] as number) + wq * (row[k] as number)
      }
    }
    for (let x = 0; x < width; x++) {
      const from = x * 4
      const a = acc[from + 3] as number
      const alpha = Math.round(a)
      if (alpha === 0) continue
      const to = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        data[to + c] = Math.min(
          255,
          Math.round(((acc[from + c] as number) * 255) / a),
        )
      }
      data[to + 3] = alpha
    }
  }
  return { width, height, data }
}
