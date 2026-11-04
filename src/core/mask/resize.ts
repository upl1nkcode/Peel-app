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
  const pre = new Float64Array(sw * sh * 4)
  for (let k = 0; k < sw * sh; k++) {
    const a = src[k * 4 + 3] as number
    pre[k * 4] = ((src[k * 4] as number) * a) / 255
    pre[k * 4 + 1] = ((src[k * 4 + 1] as number) * a) / 255
    pre[k * 4 + 2] = ((src[k * 4 + 2] as number) * a) / 255
    pre[k * 4 + 3] = a
  }

  const wx = areaWeights(sw, width)
  const tmp = new Float64Array(sh * width * 4)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < width; x++) {
      const { index, weight } = wx[x] as { index: number[]; weight: number[] }
      for (let q = 0; q < index.length; q++) {
        const from = (y * sw + (index[q] as number)) * 4
        const to = (y * width + x) * 4
        const wq = weight[q] as number
        for (let c = 0; c < 4; c++)
          tmp[to + c] = (tmp[to + c] as number) + wq * (pre[from + c] as number)
      }
    }
  }

  const wy = areaWeights(sh, height)
  const data = new Uint8Array(width * height * 4)
  const px = new Float64Array(4)
  for (let y = 0; y < height; y++) {
    const { index, weight } = wy[y] as { index: number[]; weight: number[] }
    for (let x = 0; x < width; x++) {
      px.fill(0)
      for (let q = 0; q < index.length; q++) {
        const from = ((index[q] as number) * width + x) * 4
        for (let c = 0; c < 4; c++)
          px[c] =
            (px[c] as number) +
            (weight[q] as number) * (tmp[from + c] as number)
      }
      const a = px[3] as number
      const alpha = Math.round(a)
      if (alpha === 0) continue
      const to = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        data[to + c] = Math.min(255, Math.round(((px[c] as number) * 255) / a))
      }
      data[to + 3] = alpha
    }
  }
  return { width, height, data }
}
