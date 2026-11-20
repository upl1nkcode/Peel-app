import { describe, expect, it } from 'vitest'
import { distanceToSet } from './distance'

/** A small deterministic generator, so the random sets repeat. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('distanceToSet (spec 0014)', () => {
  it('should_match_brute_force_distances (AC-4)', () => {
    const W = 17
    const H = 11
    for (let seed = 1; seed <= 20; seed++) {
      const rand = mulberry32(seed)
      const set = new Uint8Array(W * H).map(() => (rand() < 0.08 ? 1 : 0))
      set[Math.floor(rand() * W * H)] = 1
      const got = distanceToSet(W, H, set)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let best = Infinity
          for (let j = 0; j < H; j++) {
            for (let i = 0; i < W; i++) {
              if (set[j * W + i])
                best = Math.min(best, Math.hypot(i - x, j - y))
            }
          }
          expect(got[y * W + x]).toBeCloseTo(best, 9)
        }
      }
    }
  })

  it('should_be_infinite_without_set_pixels (AC-4)', () => {
    const got = distanceToSet(4, 3, new Uint8Array(12))
    expect([...got].every((d) => d === Infinity)).toBe(true)
  })
})
