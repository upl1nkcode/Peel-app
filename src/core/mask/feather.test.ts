import { describe, expect, it } from 'vitest'
import { feather, featherKernel } from './feather'

const W = 40
const H = 40

function square(): Float32Array {
  const m = new Float32Array(W * H)
  for (let j = 10; j < 30; j++) for (let i = 10; i < 30; i++) m[j * W + i] = 1
  return m
}

/** Linear interpolation between pixel centres: x where the falling profile crosses `level`. */
function crossing(row: Float32Array, level: number): number {
  for (let i = 0; i + 1 < row.length; i++) {
    const a = row[i] as number
    const b = row[i + 1] as number
    if (a >= level && b < level) return i + 0.5 + (a - level) / (a - b)
  }
  throw new Error('no crossing')
}

describe('feather', () => {
  it('should_soften_only_edges (AC-12)', () => {
    const m = square()
    feather(m, { width: W, height: H }, 2)
    const radius = Math.ceil(3 * (2 / 2.5))
    expect(radius).toBe(3)
    expect(featherKernel(2).length).toBe(2 * radius + 1)
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        // Chebyshev distance to the nearest pixel on the other side of the edge.
        const inside = i >= 10 && i < 30 && j >= 10 && j < 30
        const toEdge = inside
          ? Math.min(i - 10, 29 - i, j - 10, 29 - j) + 1
          : Math.max(10 - i, i - 29, 10 - j, j - 29, 0)
        if (toEdge > radius) expect(m[j * W + i]).toBe(inside ? 1 : 0)
      }
    }
    const zero = square()
    feather(zero, { width: W, height: H }, 0)
    expect(zero).toEqual(square())
  })

  it('should_make_the_transition_about_feather_px_wide (AC-12)', () => {
    for (const f of [1, 1.5, 2, 3]) {
      const m = new Float32Array(W * 3)
      for (let j = 0; j < 3; j++) for (let i = 0; i < 20; i++) m[j * W + i] = 1
      feather(m, { width: W, height: 3 }, f)
      const row = m.subarray(W, 2 * W)
      const width = crossing(row, 0.1) - crossing(row, 0.9)
      expect(Math.abs(width - f)).toBeLessThanOrEqual(0.25)
    }
  })

  it('should_use_a_normalised_kernel_with_variance_sigma_squared (AC-12)', () => {
    for (const f of [0.5, 1, 2, 3]) {
      const k = featherKernel(f)
      const r = (k.length - 1) / 2
      const sum = k.reduce((s, v) => s + v, 0)
      const variance = k.reduce((s, v, i) => s + v * (i - r) ** 2, 0)
      expect(sum).toBeCloseTo(1, 12)
      // Exactly σ² before truncation at ⌈3σ⌉, which trims a little.
      expect(Math.abs(Math.sqrt(variance) - f / 2.5)).toBeLessThanOrEqual(0.01)
    }
  })

  it('should_keep_border_subjects_opaque (AC-13)', () => {
    const m = new Float32Array(W * H)
    for (let j = 0; j < H; j++) for (let i = 0; i < 20; i++) m[j * W + i] = 1
    feather(m, { width: W, height: H }, 3)
    for (let j = 0; j < H; j++) expect(m[j * W]).toBe(1)
    const flat = new Float32Array(12 * 7).fill(0.625)
    feather(flat, { width: 12, height: 7 }, 3)
    expect(flat).toEqual(new Float32Array(12 * 7).fill(0.625))
  })

  it('should_feather_tiny_images (Review Focus 3)', () => {
    const one = new Float32Array([0.5])
    feather(one, { width: 1, height: 1 }, 3)
    expect(one[0]).toBe(0.5)
    const strip = new Float32Array([1, 0, 0])
    feather(strip, { width: 3, height: 1 }, 1)
    expect(strip.reduce((s, v) => s + v, 0)).toBeGreaterThan(0.99)
    expect(strip[1]).toBeGreaterThan(0)
  })
})
