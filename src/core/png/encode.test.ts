import { describe, expect, it } from 'vitest'
import type { RgbaImage } from '../mask/types'
import { decodePng } from '../../test/png'
import { mulberry32 } from '../../test/random'
import { encodePng } from './encode'
import { adler32, crc32, storedDeflate } from './zlib'

const ascii = (s: string): Uint8Array =>
  Uint8Array.from(s, (c) => c.charCodeAt(0))

function randomImage(width: number, height: number, seed: number): RgbaImage {
  const rand = mulberry32(seed)
  const data = new Uint8Array(width * height * 4)
  for (let k = 0; k < width * height; k++) {
    const kind = rand()
    const alpha =
      kind < 0.2
        ? 0
        : kind < 0.4
          ? 255
          : kind < 0.5
            ? 1
            : Math.floor(rand() * 256)
    data[k * 4] = Math.floor(rand() * 256)
    data[k * 4 + 1] = Math.floor(rand() * 256)
    data[k * 4 + 2] = Math.floor(rand() * 256)
    data[k * 4 + 3] = alpha
  }
  return { width, height, data }
}

/** A smooth image, so the best filter type varies from row to row. */
function gradientImage(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4
      data[k] = (x * 3 + y) & 0xff
      data[k + 1] = (y * 5) & 0xff
      data[k + 2] = y % 3 === 0 ? 77 : (x * y) & 0xff
      data[k + 3] = (x + y * 2) & 0xff
    }
  }
  return { width, height, data }
}

describe('encodePng', () => {
  it('should_round_trip_rgba_exactly (AC-24)', async () => {
    const sizes: [number, number][] = [
      [1, 1],
      [3, 5],
      [17, 9],
      [200, 120],
    ]
    for (const [w, h] of sizes) {
      const img = randomImage(w, h, w * 1000 + h)
      expect(decodePng(await encodePng(img, storedDeflate))).toEqual(img)
    }
    const grad = gradientImage(64, 40)
    expect(decodePng(await encodePng(grad, storedDeflate))).toEqual(grad)
    const clear: RgbaImage = {
      width: 7,
      height: 3,
      data: new Uint8Array(7 * 3 * 4),
    }
    expect(decodePng(await encodePng(clear, storedDeflate))).toEqual(clear)
  })

  it('should_write_a_valid_png_layout (AC-24)', async () => {
    expect(crc32(ascii('IEND'))).toBe(0xae426082)
    const png = await encodePng(randomImage(5, 4, 1), storedDeflate)
    expect(Array.from(png.subarray(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ])
    expect(Array.from(png.subarray(8, 16))).toEqual([
      0, 0, 0, 13, 73, 72, 68, 82,
    ]) // IHDR
    expect(Array.from(png.subarray(16, 29))).toEqual([
      0, 0, 0, 5, 0, 0, 0, 4, 8, 6, 0, 0, 0,
    ])
    expect(Array.from(png.subarray(png.length - 12))).toEqual([
      0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82,
    ])
  })

  it('should_refuse_bad_images (AC-24)', async () => {
    const bad: RgbaImage = { width: 2, height: 2, data: new Uint8Array(15) }
    await expect(encodePng(bad, storedDeflate)).rejects.toThrow(RangeError)
    const empty: RgbaImage = { width: 0, height: 2, data: new Uint8Array(0) }
    await expect(encodePng(empty, storedDeflate)).rejects.toThrow(RangeError)
  })
})

describe('storedDeflate', () => {
  it('should_write_valid_zlib_in_blocks_of_at_most_65535_bytes (AC-24)', async () => {
    const data = new Uint8Array(140_000).map((_, i) => (i * 31) & 0xff)
    const z = await storedDeflate(data)
    expect(Array.from(z.subarray(0, 2))).toEqual([0x78, 0x01])
    // 3 blocks × 5 header bytes + data + 4 Adler bytes.
    expect(z.length).toBe(2 + 3 * 5 + 140_000 + 4)
    expect(adler32(new Uint8Array(0))).toBe(1)
    expect(adler32(ascii('Wikipedia'))).toBe(0x11e60398)
    const empty = await storedDeflate(new Uint8Array(0))
    expect(Array.from(empty)).toEqual([
      0x78, 0x01, 1, 0, 0, 0xff, 0xff, 0, 0, 0, 1,
    ])
  })
})
