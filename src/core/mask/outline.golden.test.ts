import { describe, expect, it } from 'vitest'
import { addOutline } from './outline'
import type { RgbaImage } from './types'

/** An image whose alpha is `inside(x, y)` (0..1), colour from the position. */
function shape(
  width: number,
  height: number,
  inside: (x: number, y: number) => number,
): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4
      data[k] = (x * 7) % 256
      data[k + 1] = (y * 11) % 256
      data[k + 2] = 90
      data[k + 3] = Math.round(Math.min(1, Math.max(0, inside(x, y))) * 255)
    }
  }
  return { width, height, data }
}

/** FNV-1a over the bytes, in two lanes with different offsets: 64 bits, no platform APIs. */
function fnv(bytes: Uint8Array, size: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bd1e995
  const step = (v: number) => {
    a = Math.imul(a ^ v, 0x01000193) >>> 0
    b = Math.imul(b ^ v, 0x01000193) >>> 0
    b = (b ^ (b >>> 15)) >>> 0
  }
  for (const v of bytes) step(v)
  for (let i = 0; i < size.length; i++) step(size.charCodeAt(i))
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

const FIXTURES: Record<string, RgbaImage> = {
  disc: shape(41, 37, (x, y) => 12.5 - Math.hypot(x - 20.3, y - 18.1)),
  donut: shape(47, 47, (x, y) => {
    const r = Math.hypot(x - 23, y - 23)
    return Math.min(18.5 - r, r - 8.5)
  }),
  line: shape(60, 9, (x, y) => (y >= 3 && y < 5 && x > 4 && x < 55 ? 1 : 0)),
}

/** FNV-1a (two 32-bit lanes) of every output, taken with the Float64 distance field (Review Focus 2). */
const GOLDEN: Record<string, string> = {
  'disc@1.5': '7f2aebce0840accc',
  'disc@4': 'a4fb45c256d723cb',
  'disc@9': '3a5ba5990c71ea36',
  'donut@1.5': '47ac9f65ca2ddda1',
  'donut@4': '8579e9b9db330bef',
  'donut@9': '1e074c2c872fbddf',
  'line@1.5': 'b46b94bdb91535a3',
  'line@4': '6f9777ace3c2c664',
  'line@9': '474611522f632f97',
}

describe('addOutline golden output', () => {
  it('should_keep_the_outline_identical_with_a_float32_field (Review Focus 2)', () => {
    const got: Record<string, string> = {}
    for (const [name, image] of Object.entries(FIXTURES)) {
      for (const widthPx of [1.5, 4, 9]) {
        const out = addOutline(image, { widthPx, color: [255, 255, 255] })
        got[`${name}@${String(widthPx)}`] = fnv(
          out.data,
          `${String(out.width)}x${String(out.height)}`,
        )
      }
    }
    expect(got).toEqual(GOLDEN)
  })
})
