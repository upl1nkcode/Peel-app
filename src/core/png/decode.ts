import type { RgbaImage } from '../mask/types'
import type { Inflate } from '../zip'

/** A PNG this decoder doesn't read: only 8-bit RGBA, non-interlaced (what `encodePng` writes). */
export class UnsupportedPngError extends Error {
  constructor(why: string) {
    super(`unsupported PNG: ${why}`)
    this.name = 'UnsupportedPngError'
  }
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const BPP = 4

const u32 = (b: Uint8Array, at: number): number =>
  (((b[at] ?? 0) << 24) |
    ((b[at + 1] ?? 0) << 16) |
    ((b[at + 2] ?? 0) << 8) |
    (b[at + 3] ?? 0)) >>>
  0

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * Decodes an 8-bit RGBA, non-interlaced PNG byte for byte: no colour
 * management or premultiplying, unlike a browser's decoder (spec 0013 AC-8).
 * Every saved sticker is one, written by `encodePng`. CRCs aren't checked:
 * the bytes come from Peel's own store.
 */
export async function decodePng(
  bytes: Uint8Array,
  inflate: Inflate,
): Promise<RgbaImage> {
  if (bytes.length < 8 + 25 || SIGNATURE.some((v, i) => bytes[i] !== v)) {
    throw new UnsupportedPngError('no PNG signature')
  }
  let width = 0
  let height = 0
  const idat: Uint8Array[] = []
  let at = 8
  while (at + 8 <= bytes.length) {
    const len = u32(bytes, at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = u32(body, 0)
      height = u32(body, 4)
      const [depth, colorType, , , interlace] = body.subarray(8, 13)
      if (depth !== 8 || colorType !== 6) {
        throw new UnsupportedPngError('not 8-bit RGBA')
      }
      if (interlace !== 0) throw new UnsupportedPngError('interlaced')
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    at += 12 + len
  }
  if (width < 1 || height < 1 || idat.length === 0) {
    throw new UnsupportedPngError('no image data')
  }
  const z = new Uint8Array(idat.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of idat) {
    z.set(c, o)
    o += c.length
  }
  const raw = await inflate(z)
  const stride = width * BPP
  if (raw.length < height * (stride + 1)) {
    throw new UnsupportedPngError('short image data')
  }
  const data = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const row = y * stride
    const up = row - stride
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x] ?? 0
      const a = x >= BPP ? (data[row + x - BPP] ?? 0) : 0
      const b = y > 0 ? (data[up + x] ?? 0) : 0
      const c = x >= BPP && y > 0 ? (data[up + x - BPP] ?? 0) : 0
      let pred: number
      switch (filter) {
        case 0:
          pred = 0
          break
        case 1:
          pred = a
          break
        case 2:
          pred = b
          break
        case 3:
          pred = (a + b) >> 1
          break
        case 4:
          pred = paeth(a, b, c)
          break
        default:
          throw new UnsupportedPngError(`filter ${String(filter)}`)
      }
      data[row + x] = (v + pred) & 0xff
    }
  }
  return { width, height, data }
}
