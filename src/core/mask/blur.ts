/** One normalised Gaussian kernel of radius ceil(3σ). */
function kernel(sigma: number): Float64Array {
  const r = Math.ceil(3 * sigma)
  const k = new Float64Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k[i + r] = v
    sum += v
  }
  for (let i = 0; i < k.length; i++) k[i] = (k[i] as number) / sum
  return k
}

/**
 * A separable Gaussian blur of each channel (spec 0015 AC-4): kernel radius
 * ceil(3σ), edge pixels repeated, one rounding (half up) at the end. Plain
 * arithmetic, so every platform gives the same bytes.
 */
export function gaussianBlur(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 1 | 4,
  sigma: number,
): Uint8Array {
  if (data.length !== width * height * channels) {
    throw new RangeError('data must have width × height × channels values')
  }
  if (!(sigma > 0)) return Uint8Array.from(data)
  const k = kernel(sigma)
  const r = (k.length - 1) / 2
  const across = new Float64Array(data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let v = 0
        for (let i = -r; i <= r; i++) {
          const xx = Math.min(width - 1, Math.max(0, x + i))
          v +=
            (k[i + r] as number) *
            (data[(y * width + xx) * channels + c] as number)
        }
        across[(y * width + x) * channels + c] = v
      }
    }
  }
  const out = new Uint8Array(data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let v = 0
        for (let i = -r; i <= r; i++) {
          const yy = Math.min(height - 1, Math.max(0, y + i))
          v +=
            (k[i + r] as number) *
            (across[(yy * width + x) * channels + c] as number)
        }
        out[(y * width + x) * channels + c] = Math.min(255, Math.floor(v + 0.5))
      }
    }
  }
  return out
}
