import { adler32, crc32 } from '../core/png/zlib'
import type { RgbaImage } from '../core/mask/types'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

const u32 = (b: Uint8Array, at: number): number =>
  (((b[at] as number) << 24) |
    ((b[at + 1] as number) << 16) |
    ((b[at + 2] as number) << 8) |
    (b[at + 3] as number)) >>>
  0

/** Inflates a zlib stream made only of stored blocks, checking the header and Adler-32. */
function inflateStored(z: Uint8Array): Uint8Array {
  const cmf = z[0] as number
  const flg = z[1] as number
  if ((cmf & 0x0f) !== 8 || (cmf * 256 + flg) % 31 !== 0) {
    throw new Error('bad zlib header')
  }
  const parts: Uint8Array[] = []
  let at = 2
  for (;;) {
    const head = z[at++] as number
    if (((head >> 1) & 3) !== 0)
      throw new Error('only stored blocks are supported')
    const len = (z[at] as number) | ((z[at + 1] as number) << 8)
    const nlen = (z[at + 2] as number) | ((z[at + 3] as number) << 8)
    if ((len ^ 0xffff) !== nlen) throw new Error('bad stored block length')
    parts.push(z.subarray(at + 4, at + 4 + len))
    at += 4 + len
    if (head & 1) break
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  if (u32(z, at) !== adler32(out)) throw new Error('bad Adler-32')
  return out
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * Decodes an 8-bit RGBA, non-interlaced PNG whose IDAT is stored-block zlib.
 * Checks the signature, every chunk CRC and the IHDR fields; undoes all five
 * filter types. For tests only.
 */
export function decodePng(bytes: Uint8Array): RgbaImage {
  SIGNATURE.forEach((v, i) => {
    if (bytes[i] !== v) throw new Error('bad PNG signature')
  })
  let at = 8
  let width = 0
  let height = 0
  const idat: Uint8Array[] = []
  let ended = false
  while (!ended) {
    const len = u32(bytes, at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + len)
    if (
      u32(bytes, at + 8 + len) !== crc32(bytes.subarray(at + 4, at + 8 + len))
    ) {
      throw new Error(`bad CRC in ${type}`)
    }
    if (type === 'IHDR') {
      width = u32(body, 0)
      height = u32(body, 4)
      const [depth, colour, comp, filter, interlace] = body.subarray(8, 13)
      if (
        depth !== 8 ||
        colour !== 6 ||
        comp !== 0 ||
        filter !== 0 ||
        interlace !== 0
      ) {
        throw new Error('unsupported IHDR')
      }
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') ended = true
    at += 12 + len
  }
  const z = new Uint8Array(idat.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of idat) {
    z.set(p, o)
    o += p.length
  }
  const raw = inflateStored(z)
  const stride = width * 4
  const data = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] as number
      const a = x >= 4 ? (data[y * stride + x - 4] as number) : 0
      const b = y > 0 ? (data[(y - 1) * stride + x] as number) : 0
      const c = x >= 4 && y > 0 ? (data[(y - 1) * stride + x - 4] as number) : 0
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]
      if (pred === undefined) throw new Error('bad filter type')
      data[y * stride + x] = (v + pred) & 0xff
    }
  }
  return { width, height, data }
}
