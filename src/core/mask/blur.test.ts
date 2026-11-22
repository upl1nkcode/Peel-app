import { describe, expect, it } from 'vitest'
import { gaussianBlur } from './blur'

describe('gaussianBlur (spec 0015 AC-4)', () => {
  it('should_blur_like_a_gaussian (spec 0015 AC-4)', () => {
    const W = 21
    const src = new Uint8Array(W * W)
    src[10 * W + 10] = 255
    const out = gaussianBlur(src, W, W, 1, 1.5)
    let sum = 0
    let max = 0
    for (const v of out) {
      sum += v
      max = Math.max(max, v)
    }
    // Each pixel is the exact Gaussian weight × 255, rounded on its own (the
    // faint tails round to 0, so the sum falls a little short of 255).
    const g = (d: number) => Math.exp(-(d * d) / (2 * 1.5 * 1.5))
    let norm = 0
    for (let i = -5; i <= 5; i++) norm += g(i)
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const exact = (255 * g(x - 10) * g(y - 10)) / (norm * norm)
        expect(
          Math.abs((out[y * W + x] as number) - exact),
        ).toBeLessThanOrEqual(0.5 + 1e-9)
      }
    }
    expect(sum).toBeGreaterThan(240)
    expect(out[10 * W + 10]).toBe(max)
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const v = out[y * W + x]
        expect(out[y * W + (W - 1 - x)]).toBe(v)
        expect(out[x * W + y]).toBe(v)
      }
    }
    expect(out[10 * W + 15]).toBeLessThan(out[10 * W + 11] as number)
  })

  it('should_leave_a_flat_image_unchanged (spec 0015 AC-4)', () => {
    const src = new Uint8Array(8 * 6 * 4).fill(137)
    expect(gaussianBlur(src, 8, 6, 4, 1.5)).toEqual(src)
  })

  it('should_blur_each_channel_on_its_own (spec 0015 AC-4)', () => {
    const W = 9
    const src = new Uint8Array(W * W * 4)
    for (let i = 0; i < W * W; i++) src[i * 4 + 3] = 255
    src[(4 * W + 4) * 4] = 255
    const out = gaussianBlur(src, W, W, 4, 1)
    for (let i = 0; i < W * W; i++) expect(out[i * 4 + 3]).toBe(255)
    expect(out[(4 * W + 4) * 4]).toBeGreaterThan(0)
    expect(out[(4 * W + 4) * 4 + 1]).toBe(0)
  })
})
