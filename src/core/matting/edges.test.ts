import { describe, expect, it } from 'vitest'
import { stepImage, type RGB } from '../../test/sceneFixtures'
import { mulberry32 } from '../../test/random'
import type { RgbaImage } from '../mask/types'
import { edgeMap } from './edges'

const whole = (img: RgbaImage) => ({
  x: 0,
  y: 0,
  width: img.width,
  height: img.height,
})

const luma = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

describe('edgeMap', () => {
  it('should_put_the_lowest_cost_on_a_step_edge (AC-1)', () => {
    const img = stepImage(20, 12, 10, [0.8, 0.3, 0.2], [0.2, 0.5, 0.8])
    const map = edgeMap(img, whole(img))
    expect(map.cost).toHaveLength(20 * 12)
    for (let y = 0; y < 12; y++) {
      const row = Array.from(map.cost.subarray(y * 20, y * 20 + 20))
      const sorted = [...row]
        .map((c, x) => ({ c, x }))
        .sort((a, b) => a.c - b.c)
      expect(
        sorted
          .slice(0, 2)
          .map((s) => s.x)
          .sort((a, b) => a - b),
      ).toEqual([9, 10])
      expect(row[9]).toBe(row[10])
      expect(row[9]).toBeLessThan(row[8] as number)
      for (let x = 9; x > 0; x--) {
        expect(row[x - 1]).toBeGreaterThanOrEqual(row[x] as number)
      }
      for (let x = 10; x < 19; x++) {
        expect(row[x + 1]).toBeGreaterThanOrEqual(row[x] as number)
      }
    }
  })

  it('should_find_same_brightness_colour_edges (AC-2)', () => {
    const red: RGB = [0.7, 0.4, 0.4]
    const green: RGB = [0.3, 0.6, 0.4]
    expect(Math.abs(luma(red) - luma(green))).toBeLessThan(0.01)
    const img = stepImage(20, 12, 10, red, green)
    const map = edgeMap(img, whole(img))
    for (let y = 0; y < 12; y++) {
      expect(map.cost[y * 20 + 9]).toBeLessThanOrEqual(0.1)
      expect(map.cost[y * 20 + 10]).toBeLessThanOrEqual(0.1)
    }
  })

  it('should_give_cost_1_on_flat_images (AC-3)', () => {
    const flat = stepImage(16, 9, 0, [0.4, 0.4, 0.4], [0.4, 0.4, 0.4])
    const map = edgeMap(flat, whole(flat))
    for (const c of map.cost) expect(c).toBe(1)
    for (const v of [...map.strength, ...map.normalX, ...map.normalY]) {
      expect(Number.isNaN(v)).toBe(false)
    }

    // A sub-rect equals the whole-image map at the same pixels, borders included.
    const rand = mulberry32(5)
    const data = new Uint8Array(30 * 20 * 4).map((_, k) =>
      k % 4 === 3 ? 255 : Math.floor(rand() * 256),
    )
    const img: RgbaImage = { width: 30, height: 20, data }
    const full = edgeMap(img, whole(img))
    const rect = { x: 0, y: 3, width: 12, height: 17 }
    const part = edgeMap(img, rect)
    expect(part.rect).toEqual(rect)
    expect(part.strength).toHaveLength(12 * 17)
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const k = (rect.y + y) * 30 + rect.x + x
        expect(part.strength[y * 12 + x]).toBe(full.strength[k])
        expect(part.normalX[y * 12 + x]).toBe(full.normalX[k])
      }
    }
  })

  it('should_compute_only_the_searched_pixels (AC-3, Decision 6)', () => {
    const img = stepImage(20, 12, 10, [0.8, 0.3, 0.2], [0.2, 0.5, 0.8])
    const rect = whole(img)
    const full = edgeMap(img, rect)
    // Search only columns 9..19 of rows 0..5: the step is inside.
    const only = new Uint8Array(20 * 12)
    for (let y = 0; y < 6; y++)
      for (let x = 9; x < 20; x++) only[y * 20 + x] = 1
    const part = edgeMap(img, rect, only)
    for (let k = 0; k < 20 * 12; k++) {
      if (only[k] === 1) {
        expect(part.strength[k]).toBe(full.strength[k])
        expect(part.cost[k]).toBe(full.cost[k])
      } else {
        expect(part.strength[k]).toBe(0)
        expect(part.cost[k]).toBe(1)
      }
    }
  })
})
