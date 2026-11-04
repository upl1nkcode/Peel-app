import { describe, expect, it } from 'vitest'
import { addOutline } from './outline'
import type { RgbaImage } from './types'

function squareImage(): RgbaImage {
  const data = new Uint8Array(10 * 10 * 4)
  for (let k = 0; k < 100; k++) data.set([30 + k, 60, 90, 255], k * 4)
  return { width: 10, height: 10, data }
}

describe('addOutline', () => {
  it('should_draw_the_outline_only_outside (AC-17)', () => {
    const src = squareImage()
    const out = addOutline(src, { widthPx: 3, color: [250, 20, 10] })
    const pad = 4
    expect(out.width).toBe(18)
    expect(out.height).toBe(18)
    for (let j = 0; j < 18; j++) {
      for (let i = 0; i < 18; i++) {
        const px = Array.from(
          out.data.subarray((j * 18 + i) * 4, (j * 18 + i) * 4 + 4),
        )
        const si = i - pad
        const sj = j - pad
        if (si >= 0 && si < 10 && sj >= 0 && sj < 10) {
          // Subject pixels are unchanged.
          const k = (sj * 10 + si) * 4
          expect(px).toEqual(Array.from(src.data.subarray(k, k + 4)))
          continue
        }
        const dx = Math.max(0, -si, si - 9)
        const dy = Math.max(0, -sj, sj - 9)
        const d = Math.hypot(dx, dy)
        const alpha = Math.min(1, Math.max(0, 3.5 - d))
        expect(px[3]).toBe(Math.round(alpha * 255))
        if (d <= 2.5) expect(px[3]).toBe(255)
        if (d >= 3.5) expect(px[3]).toBe(0)
        if ((px[3] as number) > 0) expect(px.slice(0, 3)).toEqual([250, 20, 10])
      }
    }
  })

  it('should_measure_from_pixels_at_least_half_opaque (AC-17)', () => {
    const data = new Uint8Array(3 * 1 * 4)
    data.set([0, 0, 0, 127], 0) // below 50%: not subject
    data.set([0, 0, 0, 128], 4) // subject
    const out = addOutline(
      { width: 3, height: 1, data },
      { widthPx: 1, color: [9, 9, 9] },
    )
    expect(out.width).toBe(3 + 2 * 2)
    // Pixel (2 + 0, 2) is at distance 1 from the subject: alpha ramps to 0.5,
    // then the 127-alpha source pixel is drawn over it.
    const k = (2 * out.width + 2) * 4
    const over = 127 / 255 + 0.5 * (1 - 127 / 255)
    expect(out.data[k + 3]).toBe(Math.round(over * 255))
  })

  it('should_refuse_bad_widths (AC-17)', () => {
    for (const w of [0, -1, Number.NaN, Infinity]) {
      expect(() =>
        addOutline(squareImage(), { widthPx: w, color: [0, 0, 0] }),
      ).toThrow(RangeError)
    }
  })
})
