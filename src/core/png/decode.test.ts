import { describe, expect, it } from 'vitest'
import type { RgbaImage } from '../mask/types'
import { inflateStored } from '../../test/png'
import { mulberry32 } from '../../test/random'
import { decodePng, UnsupportedPngError } from './decode'
import { encodePng } from './encode'
import { crc32, storedDeflate } from './zlib'

const inflate = (z: Uint8Array) => Promise.resolve(inflateStored(z))

function randomImage(width: number, height: number, seed: number): RgbaImage {
  const rand = mulberry32(seed)
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rand() * 256)
  // Fully and barely transparent pixels must come back as they are.
  data[3] = 0
  data[7] = 1
  return { width, height, data }
}

function gradient(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data.set([i % 256, (i * 3) % 256, 255 - (i % 256), (i * 7) % 256], i * 4)
  }
  return { width, height, data }
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  out.set(ascii(type), 4)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

function ihdr(width: number, height: number, colorType = 6, interlace = 0) {
  const b = new Uint8Array(13)
  const v = new DataView(b.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  b.set([8, colorType, 0, 0, interlace], 8)
  return chunk('IHDR', b)
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Filters each row of `img` with the given filter type (the encoder side of PNG filtering). */
function filtered(img: RgbaImage, filters: readonly number[]): Uint8Array {
  const stride = img.width * 4
  const out = new Uint8Array(img.height * (stride + 1))
  for (let y = 0; y < img.height; y++) {
    const f = filters[y] ?? 0
    out[y * (stride + 1)] = f
    for (let x = 0; x < stride; x++) {
      const cur = img.data[y * stride + x] ?? 0
      const a = x >= 4 ? (img.data[y * stride + x - 4] ?? 0) : 0
      const b = y > 0 ? (img.data[(y - 1) * stride + x] ?? 0) : 0
      const c = x >= 4 && y > 0 ? (img.data[(y - 1) * stride + x - 4] ?? 0) : 0
      const pred =
        f === 0
          ? 0
          : f === 1
            ? a
            : f === 2
              ? b
              : f === 3
                ? Math.floor((a + b) / 2)
                : paeth(a, b, c)
      out[y * (stride + 1) + 1 + x] = (cur - pred) & 0xff
    }
  }
  return out
}

async function handMade(
  img: RgbaImage,
  filters: readonly number[],
  idatParts = 1,
): Promise<Uint8Array> {
  const z = await storedDeflate(filtered(img, filters))
  const step = Math.ceil(z.length / idatParts)
  const idats: Uint8Array[] = []
  for (let at = 0; at < z.length; at += step) {
    idats.push(chunk('IDAT', z.subarray(at, at + step)))
  }
  return concat([
    SIGNATURE,
    ihdr(img.width, img.height),
    ...idats,
    chunk('IEND', new Uint8Array(0)),
  ])
}

describe('decodePng (spec 0013)', () => {
  it('should_decode_what_encode_png_writes_byte_for_byte (AC-8)', async () => {
    for (const img of [
      randomImage(1, 1, 1),
      randomImage(37, 23, 2),
      gradient(300, 2),
    ]) {
      const back = await decodePng(await encodePng(img, storedDeflate), inflate)
      expect([back.width, back.height]).toEqual([img.width, img.height])
      expect(back.data).toEqual(img.data)
    }
  })

  it('should_undo_every_filter (AC-8)', async () => {
    const img = randomImage(7, 5, 3)
    const back = await decodePng(await handMade(img, [0, 1, 2, 3, 4]), inflate)
    expect(back.data).toEqual(img.data)
    // Paeth and Average on the first row read zeros above.
    const top = await decodePng(await handMade(img, [4, 3, 4, 3, 4]), inflate)
    expect(top.data).toEqual(img.data)
  })

  it('should_join_split_idat_chunks (AC-8)', async () => {
    const img = gradient(40, 9)
    const back = await decodePng(
      await handMade(img, [1, 2, 3, 4, 0, 1, 2, 3, 4], 3),
      inflate,
    )
    expect(back.data).toEqual(img.data)
  })

  it('should_reject_other_pngs (AC-8)', async () => {
    const img = gradient(2, 2)
    const good = await handMade(img, [0, 0])
    const rgb = concat([SIGNATURE, ihdr(2, 2, 2), ...[good.subarray(8 + 25)]])
    await expect(decodePng(rgb, inflate)).rejects.toThrow(UnsupportedPngError)
    const interlaced = concat([
      SIGNATURE,
      ihdr(2, 2, 6, 1),
      good.subarray(8 + 25),
    ])
    await expect(decodePng(interlaced, inflate)).rejects.toThrow(
      UnsupportedPngError,
    )
    const notPng = good.slice()
    notPng[1] = 0
    await expect(decodePng(notPng, inflate)).rejects.toThrow(
      UnsupportedPngError,
    )
    await expect(decodePng(new Uint8Array(4), inflate)).rejects.toThrow(
      UnsupportedPngError,
    )
  })
})
