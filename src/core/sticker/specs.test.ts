import { describe, expect, it } from 'vitest'
import type { RgbaImage } from '../mask/types'
import { mulberry32 } from '../../test/random'
import {
  DEFAULT_FINISH,
  finishFileName,
  finishImage,
  OUTPUT_MIME,
  readFinish,
  sameFinish,
  type FinishSettings,
} from './specs'

function solid(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let k = 0; k < width * height; k++) data.set(rgba, k * 4)
  return { width, height, data }
}

const px = (img: RgbaImage, x: number, y: number) =>
  Array.from(
    img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
  )

/** Bounds (max exclusive) of the pixels with alpha > 0. */
function alphaBox(img: RgbaImage) {
  let minX = img.width
  let minY = img.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 }
}

const settings = (patch: Partial<FinishSettings> = {}): FinishSettings => ({
  ...DEFAULT_FINISH,
  ...patch,
})
const outline = (widthPct: number, color: 'white' | 'black' = 'white') => ({
  on: true,
  widthPct,
  color,
})

describe('finishImage', () => {
  it('should_build_the_output_in_order (AC-1)', () => {
    const out = finishImage(
      solid(100, 50, [200, 10, 20, 255]),
      settings({ outline: outline(4), paddingPct: 10 }),
    )
    // The outline reaches 4 px out (alpha > 0 up to d = 4): 108 × 58 after
    // the trim, then 10 px of padding on every side.
    expect([out.width, out.height]).toEqual([128, 78])
    expect(px(out, 0, 39)).toEqual([0, 0, 0, 0])
    expect(px(out, 9, 39)).toEqual([0, 0, 0, 0])
    // The outline's outer pixel is half covered, the next one solid.
    expect(px(out, 10, 39)).toEqual([255, 255, 255, 128])
    expect(px(out, 11, 39)).toEqual([255, 255, 255, 255])
    expect(px(out, 13, 39)).toEqual([255, 255, 255, 255])
    // The subject starts after the outline, unchanged.
    expect(px(out, 14, 39)).toEqual([200, 10, 20, 255])
    expect(px(out, 64, 39)).toEqual([200, 10, 20, 255])
  })

  it('should_fit_the_sticker_in_1024 (AC-2)', () => {
    const big = finishImage(
      solid(4000, 1000, [1, 2, 3, 255]),
      settings({ outline: outline(3), paddingPct: 5 }),
    )
    // Outline and padding are whole pixels, so the long side lands just under.
    expect(big.width).toBeLessThanOrEqual(1024)
    expect(big.width).toBeGreaterThanOrEqual(1020)
    // The scaled cutout (the dark pixels) keeps the aspect ratio within 1 px.
    let w = 0
    let h = 0
    for (let x = 0; x < big.width; x++)
      if (px(big, x, big.height >> 1)[0] === 1) w++
    for (let y = 0; y < big.height; y++)
      if (px(big, big.width >> 1, y)[0] === 1) h++
    expect(Math.abs(w / 4 - h)).toBeLessThanOrEqual(1)
    const small = finishImage(solid(300, 200, [1, 2, 3, 255]), settings())
    expect([small.width, small.height]).toEqual([300, 200])
  })

  it('should_keep_the_full_size_for_original (AC-3)', () => {
    const rand = mulberry32(3)
    // Over the 1024 px Sticker cap, small enough for the coverage run.
    const src = solid(1500, 1000, [0, 0, 0, 255])
    for (let k = 0; k < src.data.length; k++) {
      if (k % 4 !== 3) src.data[k] = Math.floor(rand() * 256)
    }
    const out = finishImage(src, settings({ output: 'original' }))
    expect([out.width, out.height]).toEqual([1500, 1000])
    let firstDiff = -1
    for (let k = 0; k < src.data.length && firstDiff < 0; k++) {
      if (out.data[k] !== src.data[k]) firstDiff = k
    }
    expect(firstDiff).toBe(-1)
  })

  it('should_scale_original_by_one_with_outline_and_padding (AC-3)', () => {
    const out = finishImage(
      solid(2000, 1000, [9, 9, 9, 255]),
      settings({ output: 'original', outline: outline(1), paddingPct: 2 }),
    )
    // 1% of 2000 = 20 px of outline, 2% = 40 px of padding, at s = 1.
    expect([out.width, out.height]).toEqual([2000 + 40 + 80, 1000 + 40 + 80])
  })

  it('should_pad_whatsapp_to_512 (AC-4)', () => {
    const out = finishImage(
      solid(900, 300, [5, 6, 7, 255]),
      settings({ output: 'whatsapp', outline: outline(3), paddingPct: 4 }),
    )
    expect([out.width, out.height]).toEqual([512, 512])
    const box = alphaBox(out)
    expect(box.minX).toBeGreaterThanOrEqual(16)
    expect(box.minY).toBeGreaterThanOrEqual(16)
    expect(box.maxX).toBeLessThanOrEqual(496)
    expect(box.maxY).toBeLessThanOrEqual(496)
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 0])
  })

  it('should_put_the_odd_pixel_right_or_bottom (AC-4)', () => {
    // 400 × 159 is never enlarged, so 353 px are left over vertically.
    const out = finishImage(
      solid(400, 159, [5, 6, 7, 255]),
      settings({ output: 'whatsapp' }),
    )
    const box = alphaBox(out)
    expect(box.minX).toBe(56)
    expect(512 - box.maxX).toBe(56)
    expect(box.minY).toBe(176)
    expect(512 - box.maxY).toBe(177)
  })

  it('should_throw_on_an_empty_cutout (Review Focus 3)', () => {
    expect(() => finishImage(solid(4, 4, [0, 0, 0, 0]), settings())).toThrow(
      'no selected pixel',
    )
  })
})

describe('Finish settings', () => {
  it('should_read_bad_finish_values_as_defaults (Data)', () => {
    expect(
      readFinish({
        output: 'gif',
        outline: { on: 'yes', widthPct: 99 },
        paddingPct: -3,
      }),
    ).toEqual(DEFAULT_FINISH)
    expect(readFinish(undefined)).toEqual(DEFAULT_FINISH)
    expect(readFinish('x')).toEqual(DEFAULT_FINISH)
    expect(DEFAULT_FINISH).toEqual({
      output: 'sticker',
      outline: { on: false, widthPct: 3, color: 'white' },
      paddingPct: 0,
    })
  })

  it('should_keep_good_values_snapped_to_their_step (Data)', () => {
    expect(
      readFinish({
        output: 'whatsapp',
        outline: { on: true, widthPct: 2.7, color: 'black' },
        paddingPct: 12.4,
      }),
    ).toEqual({
      output: 'whatsapp',
      outline: { on: true, widthPct: 2.5, color: 'black' },
      paddingPct: 12,
    })
  })

  it('should_compare_settings_by_value (AC-11)', () => {
    const a = settings({ outline: outline(3) })
    expect(sameFinish(a, settings({ outline: outline(3) }))).toBe(true)
    expect(sameFinish(a, settings({ outline: outline(3.5) }))).toBe(false)
    expect(sameFinish(a, settings({ outline: outline(3, 'black') }))).toBe(
      false,
    )
    expect(sameFinish(a, { ...a, paddingPct: 1 })).toBe(false)
    expect(sameFinish(a, { ...a, output: 'original' })).toBe(false)
  })

  it('should_name_files_in_local_time (AC-16)', () => {
    const now = new Date(2026, 10, 16, 9, 5)
    expect(finishFileName(now, 'sticker')).toBe(
      'peel-sticker-2026-11-16-0905.png',
    )
    expect(finishFileName(now, 'original')).toBe(
      'peel-sticker-2026-11-16-0905-original.png',
    )
    expect(finishFileName(now, 'whatsapp')).toBe(
      'peel-sticker-2026-11-16-0905-whatsapp.webp',
    )
    expect(OUTPUT_MIME).toEqual({
      sticker: 'image/png',
      original: 'image/png',
      whatsapp: 'image/webp',
    })
  })
})
