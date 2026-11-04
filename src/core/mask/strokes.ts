import type { Point, Size } from '../geometry/types'
import type { BrushStroke } from '../selection/types'

/**
 * Brush strength at distance `d` from the stroke's polyline:
 * `1 − smoothstep(r·hardness − 0.5, r + 0.5, d)`. Full strength for
 * d ≤ r·hardness − 0.5, none for d ≥ r + 0.5.
 */
export function strokeStrength(
  d: number,
  radius: number,
  hardness: number,
): number {
  const e0 = radius * hardness - 0.5
  const e1 = radius + 0.5
  if (d <= e0) return 1
  if (d >= e1) return 0
  const t = (d - e0) / (e1 - e0)
  return 1 - t * t * (3 - 2 * t)
}

function distToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - a.x - t * dx, py - a.y - t * dy)
}

/** Pixel index range whose centres (i + 0.5) lie within [lo, hi], clipped to [0, n). */
function centreRange(lo: number, hi: number, n: number): [number, number] {
  return [
    Math.max(0, Math.ceil(lo - 0.5)),
    Math.min(n - 1, Math.floor(hi - 0.5)),
  ]
}

/**
 * Applies the strokes to `coverage` in place, in order, with sizes and points
 * multiplied by `scale`. Each stroke's strength is the maximum over its
 * segments (so overlapping parts count once), then erase: m·(1 − a);
 * restore: m + a·(1 − m). Only pixels inside the image are touched.
 */
export function applyStrokes(
  coverage: Float32Array,
  size: Size,
  strokes: readonly BrushStroke[],
  scale = 1,
): void {
  const { width: w, height: h } = size
  for (const stroke of strokes) {
    const r = (stroke.sizePx * scale) / 2
    const reach = r + 0.5
    const pts = stroke.points.map((p) => ({ x: p.x * scale, y: p.y * scale }))
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const [i0, i1] = centreRange(
      Math.min(...xs) - reach,
      Math.max(...xs) + reach,
      w,
    )
    const [j0, j1] = centreRange(
      Math.min(...ys) - reach,
      Math.max(...ys) + reach,
      h,
    )
    if (i1 < i0 || j1 < j0) continue
    const bw = i1 - i0 + 1
    const box = new Float32Array(bw * (j1 - j0 + 1))

    const last = Math.max(1, pts.length - 1)
    for (let k = 0; k < last; k++) {
      const a = pts[k] as Point
      const b = pts[Math.min(k + 1, pts.length - 1)] as Point
      const [si0, si1] = centreRange(
        Math.min(a.x, b.x) - reach,
        Math.max(a.x, b.x) + reach,
        w,
      )
      const [sj0, sj1] = centreRange(
        Math.min(a.y, b.y) - reach,
        Math.max(a.y, b.y) + reach,
        h,
      )
      for (let j = sj0; j <= sj1; j++) {
        const row = (j - j0) * bw - i0
        for (let i = si0; i <= si1; i++) {
          const s = strokeStrength(
            distToSegment(i + 0.5, j + 0.5, a, b),
            r,
            stroke.hardness,
          )
          if (s > (box[row + i] as number)) box[row + i] = s
        }
      }
    }

    const erase = stroke.mode === 'erase'
    for (let j = j0; j <= j1; j++) {
      const row = (j - j0) * bw - i0
      for (let i = i0; i <= i1; i++) {
        const a = box[row + i] as number
        if (a === 0) continue
        const k = j * w + i
        const m = coverage[k] as number
        coverage[k] = erase ? m * (1 - a) : m + a * (1 - m)
      }
    }
  }
}
