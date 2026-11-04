import type { RgbaImage } from '../mask/types'
import { crc32, type Deflate } from './zlib'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const BPP = 4

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * Filters every row with the PNG filter (0–4) whose output has the smallest
 * sum of |signed bytes|, the usual heuristic for good compression.
 */
function filterRows(image: RgbaImage): Uint8Array {
  const stride = image.width * BPP
  const src = image.data
  const out = new Uint8Array(image.height * (stride + 1))
  const candidate = Array.from({ length: 5 }, () => new Uint8Array(stride))
  for (let y = 0; y < image.height; y++) {
    const row = y * stride
    const prev = row - stride
    let best = 0
    let bestCost = Infinity
    for (let f = 0; f < 5; f++) {
      const line = candidate[f] as Uint8Array
      let cost = 0
      for (let x = 0; x < stride; x++) {
        const v = src[row + x] as number
        const a = x >= BPP ? (src[row + x - BPP] as number) : 0
        const b = y > 0 ? (src[prev + x] as number) : 0
        const c = x >= BPP && y > 0 ? (src[prev + x - BPP] as number) : 0
        const pred =
          f === 0
            ? 0
            : f === 1
              ? a
              : f === 2
                ? b
                : f === 3
                  ? (a + b) >> 1
                  : paeth(a, b, c)
        const out8 = (v - pred) & 0xff
        line[x] = out8
        cost += out8 < 128 ? out8 : 256 - out8
      }
      if (cost < bestCost) {
        bestCost = cost
        best = f
      }
    }
    out[y * (stride + 1)] = best
    out.set(candidate[best] as Uint8Array, y * (stride + 1) + 1)
  }
  return out
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

/**
 * Encodes straight (not premultiplied) RGBA as an 8-bit RGBA PNG (colour
 * type 6, non-interlaced), byte for byte: no colour or alpha change.
 */
export async function encodePng(
  image: RgbaImage,
  deflate: Deflate,
): Promise<Uint8Array> {
  const { width, height, data } = image
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new RangeError(
      `image size must be positive integers, got ${String(width)}×${String(height)}`,
    )
  }
  if (data.length !== width * height * BPP) {
    throw new RangeError(
      `expected ${String(width * height * BPP)} RGBA bytes, got ${String(data.length)}`,
    )
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8) // depth 8, RGBA, deflate, adaptive filters, no interlace
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', await deflate(filterRows(image))),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
