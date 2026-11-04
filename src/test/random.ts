/** Seeded PRNG for reproducible property tests (never use Math.random in tests). Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A circle of `n` samples with uniform radial noise in ±`noise`, seeded. */
export function noisyCircle(
  n: number,
  radius: number,
  noise: number,
  seed: number,
  center = { x: 0, y: 0 },
): { x: number; y: number }[] {
  const rand = mulberry32(seed)
  return Array.from({ length: n }, (_, i) => {
    const theta = (i / n) * 2 * Math.PI
    const r = radius + (rand() * 2 - 1) * noise
    return {
      x: center.x + r * Math.cos(theta),
      y: center.y + r * Math.sin(theta),
    }
  })
}
