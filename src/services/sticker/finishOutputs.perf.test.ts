import { describe, expect, it } from 'vitest'
import type { RgbaImage } from '../../core/mask/types'
import { encodePng } from '../../core/png/encode'
import { browserDeflate } from '../deflate'
import {
  DEFAULT_FINISH,
  finishImage,
  type FinishSettings,
} from '../../core/sticker'

/**
 * AC-7: a 12 MP photo's cutout of about half of it: the left half of a
 * 4000 × 3000 photo with a wavy, anti-aliased right edge, already trimmed.
 */
function halfPhotoCutout(): RgbaImage {
  const width = 2100
  const height = 3000
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const edge = 2000 + 60 * Math.sin(y / 90) + 20 * Math.sin(y / 13)
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4
      data[k] = (x * 3 + y) & 255
      data[k + 1] = (x ^ y) & 255
      data[k + 2] = (y * 5) & 255
      data[k + 3] = Math.round(Math.min(1, Math.max(0, edge - x)) * 255)
    }
  }
  return { width, height, data }
}

async function timed(cutout: RgbaImage, settings: FinishSettings) {
  const start = Date.now()
  const out = finishImage(cutout, settings)
  const png = await encodePng(out, browserDeflate)
  return { ms: Date.now() - start, out, png }
}

describe('finish outputs (perf)', () => {
  it('should_make_outputs_within_budget (AC-7)', async () => {
    const cutout = halfPhotoCutout()
    const sticker = await timed(cutout, DEFAULT_FINISH)
    const original = await timed(cutout, {
      ...DEFAULT_FINISH,
      output: 'original',
      outline: { on: true, widthPct: 3, color: 'white' },
    })
    expect(Math.max(sticker.out.width, sticker.out.height)).toBeLessThanOrEqual(
      1024,
    )
    expect(sticker.png.length).toBeGreaterThan(0)
    expect(sticker.ms, 'Sticker ms').toBeLessThan(1500)
    expect(original.ms, 'Original with outline ms').toBeLessThan(6000)
  }, 30_000)
})
