// @vitest-environment node
import { init } from '@jsquash/webp/encode'
import initSimdWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?init'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  encodeWithinBudget,
  TooLargeError,
  WHATSAPP_BUDGET_BYTES,
  WHATSAPP_QUALITIES,
} from '../../core/sticker'
import type { RgbaImage } from '../../core/mask/types'
import { mulberry32 } from '../../test/random'
import {
  EncoderUnavailableError,
  loadWebpEncoder,
  resetWebpEncoderForTests,
} from './webpEncoder'

/**
 * Node can't fetch the wasm by URL, so the tests hand emscripten the SIMD
 * build (Node has SIMD, and @jsquash picks that build) through Vite's `?init`.
 */
const nodeInit = () =>
  init({
    instantiateWasm: (
      imports: WebAssembly.Imports,
      done: (instance: WebAssembly.Instance) => void,
    ) => {
      void initSimdWasm(imports).then(done)
      return {}
    },
  } as Parameters<typeof init>[0])

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n))

/**
 * A 512 × 512 sticker with a 16 px transparent margin. `noise` 255 is pure
 * random pixels (incompressible); smaller values add that much grain to a
 * busy, photo-like texture.
 */
function busySticker(noise: number): RgbaImage {
  const rand = mulberry32(5)
  const data = new Uint8Array(512 * 512 * 4)
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  for (let y = 16; y < 496; y++) {
    for (let x = 16; x < 496; x++) {
      const k = (y * 512 + x) * 4
      const base = [
        128 + 90 * Math.sin(x / 7) * Math.cos(y / 11),
        128 + 90 * Math.sin((x + y) / 5),
        128 + 90 * Math.cos(x / 3 - y / 9),
      ]
      for (let c = 0; c < 3; c++) {
        const grain = (rand() - 0.5) * 2 * noise
        data[k + c] =
          noise >= 255
            ? Math.floor(rand() * 256)
            : clamp((base[c] as number) + grain)
      }
      data[k + 3] = 255
    }
  }
  return { width: 512, height: 512, data }
}

describe('loadWebpEncoder', () => {
  beforeEach(() => {
    resetWebpEncoderForTests()
  })

  it('should_encode_a_valid_webp_with_alpha (AC-4)', async () => {
    const encode = await loadWebpEncoder(nodeInit)
    const img: RgbaImage = {
      width: 8,
      height: 8,
      data: new Uint8Array(8 * 8 * 4),
    }
    for (let k = 0; k < 32; k++) img.data.set([200, 30, 30, 255], k * 4)
    const bytes = await encode(img, 90)
    expect(ascii(bytes, 0, 4)).toBe('RIFF')
    expect(ascii(bytes, 8, 4)).toBe('WEBP')
    const text = ascii(bytes, 0, bytes.length)
    expect(text.includes('ALPH') || text.includes('VP8L')).toBe(true)
  })

  it('should_fit_a_busy_512_sticker_in_100kb (AC-5)', async () => {
    const encode = await loadWebpEncoder(nodeInit)
    const img = busySticker(16)
    const bytes = await encodeWithinBudget(
      (q) => encode(img, q),
      WHATSAPP_BUDGET_BYTES,
      WHATSAPP_QUALITIES,
    )
    expect(bytes.length).toBeLessThanOrEqual(102_400)
    expect(ascii(bytes, 8, 4)).toBe('WEBP')
  })

  it('should_give_up_on_pure_noise (AC-5)', async () => {
    const encode = await loadWebpEncoder(nodeInit)
    const img = busySticker(255)
    await expect(
      encodeWithinBudget(
        (q) => encode(img, q),
        WHATSAPP_BUDGET_BYTES,
        WHATSAPP_QUALITIES,
      ),
    ).rejects.toBeInstanceOf(TooLargeError)
  })

  it('should_retry_after_a_failed_load (AC-6)', async () => {
    let calls = 0
    const flaky = () => {
      calls++
      return calls === 1 ? Promise.reject(new Error('offline')) : nodeInit()
    }
    await expect(loadWebpEncoder(flaky)).rejects.toBeInstanceOf(
      EncoderUnavailableError,
    )
    const encode = await loadWebpEncoder(flaky)
    expect(typeof encode).toBe('function')
    expect(calls).toBe(2)
  })

  it('should_load_once (AC-6)', async () => {
    let calls = 0
    const counted = () => {
      calls++
      return nodeInit()
    }
    const [a, b] = await Promise.all([
      loadWebpEncoder(counted),
      loadWebpEncoder(counted),
    ])
    expect(a).toBe(b)
    expect(calls).toBe(1)
  })
})
