import { describe, expect, it } from 'vitest'
import type { Node, Point, Size } from '../geometry/types'
import type { Ring } from '../selection/types'
import { pixelArea } from '../../test/area'
import { mulberry32 } from '../../test/random'
import { rasterizeRings, SUBROWS } from './rasterize'
import { toAlphaMask } from './types'

const corners = (pts: readonly Point[]): Node[] =>
  pts.map(({ x, y }) => ({ x, y, kind: 'corner' }))
const add = (pts: readonly Point[]): Ring => ({
  op: 'add',
  nodes: corners(pts),
})
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]

function render(rings: readonly Ring[], size: Size): Uint8Array {
  return toAlphaMask(rasterizeRings(rings, size), size).data
}

/** Whether any polygon vertex lies in the closed pixel square (i, j). */
const hasVertex = (poly: readonly Point[], i: number, j: number): boolean =>
  poly.some((p) => p.x >= i && p.x <= i + 1 && p.y >= j && p.y <= j + 1)

/** Asserts AC-2's bounds for `data` against the exact area of `polys` (disjoint, summed). */
function expectExactArea(
  data: Uint8Array,
  size: Size,
  polys: readonly (readonly Point[])[],
): void {
  expectArea(
    data,
    size,
    (i, j) => polys.reduce((s, p) => s + pixelArea(p, i, j), 0),
    polys,
  )
}

/** AC-2's bounds against an exact per-pixel area; pixels holding a vertex of `polys` get 1.5. */
function expectArea(
  data: Uint8Array,
  size: Size,
  exact: (i: number, j: number) => number,
  polys: readonly (readonly Point[])[],
): void {
  for (let j = 0; j < size.height; j++) {
    for (let i = 0; i < size.width; i++) {
      const area = exact(i, j)
      const v = data[j * size.width + i] as number
      const err = Math.abs(v - 255 * area)
      const bound = polys.some((p) => hasVertex(p, i, j)) ? 1.5 : 1
      if (err > bound) {
        throw new Error(
          `pixel (${String(i)}, ${String(j)}): value ${String(v)}, exact ${String(255 * area)}`,
        )
      }
      if (area > 0.5 / 255 && area < 1 - 0.5 / 255) {
        expect(v).toBeGreaterThan(0)
        expect(v).toBeLessThan(255)
      }
    }
  }
}

/** Seeded simple polygons: star-shaped (convex when the radius is constant) and rotated rectangles. */
function randomPolygon(seed: number): Point[] {
  const rand = mulberry32(seed)
  const cx = 10 + rand() * 12
  const cy = 10 + rand() * 12
  if (seed % 4 === 0) {
    const w = 3 + rand() * 9
    const h = 3 + rand() * 9
    const a = rand() * Math.PI
    const c = Math.cos(a)
    const s = Math.sin(a)
    return rect(-w / 2, -h / 2, w / 2, h / 2).map((p) => ({
      x: cx + p.x * c - p.y * s,
      y: cy + p.x * s + p.y * c,
    }))
  }
  const n = 3 + Math.floor(rand() * 10)
  const convex = seed % 4 === 1
  const angles = Array.from({ length: n }, () => rand() * 2 * Math.PI).sort(
    (a, b) => a - b,
  )
  const r0 = 3 + rand() * 6
  return angles.map((a) => {
    const r = convex ? r0 : 2 + rand() * 7
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  })
}

describe('rasterizeRings', () => {
  it('should_fill_an_integer_rectangle_exactly (AC-1)', () => {
    const size = { width: 10, height: 12 }
    const data = render([add(rect(2, 3, 7, 9))], size)
    for (let j = 0; j < 12; j++) {
      for (let i = 0; i < 10; i++) {
        const inside = i >= 2 && i < 7 && j >= 3 && j < 9
        expect(data[j * 10 + i]).toBe(inside ? 255 : 0)
      }
    }
    expect(new Set(data)).toEqual(new Set([0, 255]))
  })

  it('should_match_exact_pixel_area (AC-2)', () => {
    expect(SUBROWS).toBe(256)
    const size = { width: 32, height: 32 }
    for (let seed = 1; seed <= 40; seed++) {
      const poly = randomPolygon(seed)
      expectExactArea(render([add(poly)], size), size, [poly])
    }
  })

  it('should_fill_both_lobes_of_a_figure_8 (AC-3)', () => {
    const size = { width: 16, height: 16 }
    const bowtie = [
      { x: 2, y: 2.3 },
      { x: 12.4, y: 12 },
      { x: 12.4, y: 2.3 },
      { x: 2, y: 12 },
    ]
    // The edges cross where y = 2.3 + (x − 2)·9.7/10.4 meets y = 12 − (x − 2)·9.7/10.4.
    const cx = 2 + (9.7 / 2) * (10.4 / 9.7)
    const mid = { x: cx, y: (2.3 + 12) / 2 }
    const lobes = [
      [{ x: 2, y: 2.3 }, mid, { x: 2, y: 12 }],
      [mid, { x: 12.4, y: 12 }, { x: 12.4, y: 2.3 }],
    ]
    expectExactArea(render([add(bowtie)], size), size, lobes)
  })

  it('should_fill_a_doubled_loop_once (AC-3)', () => {
    const size = { width: 12, height: 12 }
    const square = rect(2.5, 1.25, 9.75, 10.5)
    expect(render([add([...square, ...square])], size)).toEqual(
      render([add(square)], size),
    )
  })

  it('should_clip_rings_outside_the_image (AC-5)', () => {
    const size = { width: 20, height: 16 }
    const half = [
      { x: -10.3, y: 4.2 },
      { x: 12.7, y: -6.1 },
      { x: 30.2, y: 9.9 },
      { x: 8.4, y: 25.6 },
    ]
    expectExactArea(render([add(half)], size), size, [half])
    expect(render([add(rect(25, 2, 40, 10))], size).every((v) => v === 0)).toBe(
      true,
    )
    expect(
      render([add(rect(-1e6, -1e6, 1e6, 1e6))], size).every((v) => v === 255),
    ).toBe(true)
  })

  it('should_count_a_crossing_at_a_vertex_once (Review Focus 1)', () => {
    const size = { width: 22, height: 22 }
    const diamond = [
      { x: 10, y: 2.5 },
      { x: 17.5, y: 10 },
      { x: 10, y: 17.5 },
      { x: 2.5, y: 10 },
    ]
    expectExactArea(render([add(diamond)], size), size, [diamond])
    const onSubrow = (j: number, s: number) => j + (s + 0.5) / SUBROWS
    const triangle = [
      { x: 12, y: onSubrow(3, 0) },
      { x: 19, y: onSubrow(17, 100) },
      { x: 4.5, y: onSubrow(10, 255) },
    ]
    expectExactArea(render([add(triangle)], size), size, [triangle])
  })

  it('should_render_degenerate_rings_as_empty (Review Focus 2)', () => {
    const size = { width: 12, height: 12 }
    const collinear = [
      { x: 1, y: 1 },
      { x: 5.5, y: 5.5 },
      { x: 10, y: 10 },
    ]
    const repeated = [
      { x: 3, y: 3 },
      { x: 3, y: 3 },
      { x: 8, y: 6 },
      { x: 8, y: 6 },
    ]
    expect(render([add(collinear)], size).every((v) => v === 0)).toBe(true)
    expect(render([add(repeated)], size).every((v) => v === 0)).toBe(true)
  })

  it('should_render_curved_rings_inside_the_image_only (AC-5)', () => {
    const size = { width: 1, height: 1 }
    const ring: Ring = {
      op: 'add',
      nodes: [
        { x: -5, y: -5, kind: 'smooth' },
        { x: 6, y: -5, kind: 'smooth' },
        { x: 6, y: 6, kind: 'smooth' },
        { x: -5, y: 6, kind: 'smooth' },
      ],
    }
    expect(render([ring], size)).toEqual(new Uint8Array([255]))
  })
})

const subtract = (pts: readonly Point[]): Ring => ({
  op: 'subtract',
  nodes: corners(pts),
})
const polygonCircle = (cx: number, cy: number, r: number, n: number): Point[] =>
  Array.from({ length: n }, (_, k) => ({
    x: cx + r * Math.cos((k / n) * 2 * Math.PI),
    y: cy + r * Math.sin((k / n) * 2 * Math.PI),
  }))
const inRect = (r: readonly Point[], x: number, y: number): boolean => {
  const [a, , c] = r as [Point, Point, Point, Point]
  return x >= a.x && x < c.x && y >= a.y && y < c.y
}

describe('rasterizeRings compositing', () => {
  it('should_make_a_donut (AC-6)', () => {
    const size = { width: 32, height: 32 }
    const outer = polygonCircle(16.2, 15.7, 12, 48)
    const hole = polygonCircle(16.2, 15.7, 6, 32)
    const data = render([add(outer), subtract(hole)], size)
    expectArea(
      data,
      size,
      (i, j) => pixelArea(outer, i, j) - pixelArea(hole, i, j),
      [outer, hole],
    )
    for (let j = 0; j < 32; j++) {
      for (let i = 0; i < 32; i++) {
        const v = data[j * 32 + i]
        if (pixelArea(hole, i, j) === 1) expect(v).toBe(0)
        else if (pixelArea(outer, i, j) === 1 && pixelArea(hole, i, j) === 0) {
          expect(v).toBe(255)
        }
      }
    }
  })

  it('should_apply_rings_in_order (AC-7)', () => {
    const size = { width: 20, height: 20 }
    const a = rect(2, 2, 12, 12)
    const b = rect(8, 8, 18, 18)
    const c = rect(10, 4, 16, 10)
    const expectSet = (
      data: Uint8Array,
      inside: (x: number, y: number) => boolean,
    ) => {
      for (let j = 0; j < 20; j++) {
        for (let i = 0; i < 20; i++) {
          expect(data[j * 20 + i]).toBe(inside(i + 0.5, j + 0.5) ? 255 : 0)
        }
      }
    }
    expectSet(
      render([add(a), subtract(b), add(c)], size),
      (x, y) => (inRect(a, x, y) && !inRect(b, x, y)) || inRect(c, x, y),
    )
    expectSet(
      render([add(a), add(c), subtract(b)], size),
      (x, y) => (inRect(a, x, y) || inRect(c, x, y)) && !inRect(b, x, y),
    )
    expect(render([subtract(b), add(a)], size)).toEqual(render([add(a)], size))
  })

  it('should_leave_no_seam_between_touching_rings (AC-8)', () => {
    const size = { width: 12, height: 12 }
    const o = 0.37
    const left = rect(o, o, 5 + o, 10 + o)
    const right = rect(5 + o, o, 10 + o, 10 + o)
    const both = render([add(left), add(right)], size)
    for (let j = 1; j < 10; j++) expect(both[j * 12 + 5]).toBe(255)
    expect(both).toEqual(render([add(rect(o, o, 10 + o, 10 + o))], size))
    const cut = render([add(rect(o, o, 10 + o, 10 + o)), subtract(right)], size)
    expectExactArea(cut, size, [left])
  })
})
