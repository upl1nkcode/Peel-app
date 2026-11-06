import { describe, expect, it } from 'vitest'
import { signedArea } from '../geometry/polygon'
import { renderMask } from '../mask/render'
import type { Ring } from '../selection/types'
import { mulberry32 } from '../../test/random'
import { contoursToRings, cornerNodes, nestingDepth } from './rings'
import { traceContours } from './trace'
import type { CoverageMask } from './types'

function maskOf(
  width: number,
  height: number,
  value: (i: number, j: number) => number,
): CoverageMask {
  const data = new Float32Array(width * height)
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) data[j * width + i] = value(i, j)
  }
  return { width, height, data }
}

const inRect =
  (x0: number, y0: number, x1: number, y1: number) => (i: number, j: number) =>
    i >= x0 && i < x1 && j >= y0 && j < y1

/** Every pixel whose rendered coverage is clearly decided agrees with the mask at 50% (rings built from the trace polygon itself). */
function expectSameRegions(rings: readonly Ring[], mask: CoverageMask): void {
  const size = { width: mask.width, height: mask.height }
  const out = renderMask({ rings, strokes: [], feather: 0 }, size).data
  for (let k = 0; k < out.length; k++) {
    const a = out[k] as number
    if (Math.abs(a - 127.5) <= 2) continue
    expect(a > 127.5, `pixel ${String(k)}`).toBe(
      (mask.data[k] as number) >= 0.5,
    )
  }
}

/** Pixels selected when inside an odd number of seeded random discs: nested shapes. */
function parityDiscs(seed: number): CoverageMask {
  const rand = mulberry32(seed)
  const discs = Array.from({ length: 6 }, () => ({
    x: 4 + rand() * 40,
    y: 4 + rand() * 40,
    r: 2 + rand() * 14,
  }))
  return maskOf(48, 48, (i, j) => {
    let n = 0
    for (const d of discs) {
      if (Math.hypot(i + 0.5 - d.x, j + 0.5 - d.y) <= d.r) n++
    }
    return n % 2
  })
}

describe('contoursToRings', () => {
  it('should_make_a_donut_from_add_and_subtract (AC-6)', () => {
    const donut = maskOf(30, 30, (i, j) => {
      const r = Math.hypot(i + 0.5 - 15, j + 0.5 - 15)
      return r <= 12 && r >= 5 ? 1 : 0
    })
    const rings = contoursToRings(traceContours(donut), cornerNodes)
    expect(rings.map((r) => r.op)).toEqual(['add', 'subtract'])
    expectSameRegions(rings, donut)
  })

  it('should_order_rings_by_depth (AC-7)', () => {
    const mask = maskOf(40, 32, (i, j) => {
      if (inRect(30, 2, 37, 9)(i, j)) return 1
      if (inRect(12, 10, 18, 16)(i, j)) return 1
      if (inRect(8, 6, 22, 20)(i, j)) return 0
      return inRect(2, 2, 28, 28)(i, j) ? 1 : 0
    })
    const contours = traceContours(mask)
    expect(nestingDepth(contours).sort()).toEqual([0, 0, 1, 2])
    const rings = contoursToRings(contours, cornerNodes)
    expect(rings.map((r) => r.op)).toEqual(['add', 'add', 'subtract', 'add'])
    expect(rings.every((r) => r.nodes.every((n) => n.kind === 'corner'))).toBe(
      true,
    )
    expectSameRegions(rings, mask)
  })

  it('should_keep_every_speck_and_pinhole (AC-8)', () => {
    const speck = maskOf(5, 5, (i, j) => (i === 2 && j === 2 ? 1 : 0))
    const speckRings = contoursToRings(traceContours(speck))
    expect(speckRings).toHaveLength(1)
    expect(speckRings[0]?.nodes).toHaveLength(4)

    const pinhole = maskOf(9, 9, (i, j) =>
      inRect(2, 2, 7, 7)(i, j) && !(i === 4 && j === 4) ? 1 : 0,
    )
    expect(contoursToRings(traceContours(pinhole)).map((r) => r.op)).toEqual([
      'add',
      'subtract',
    ])

    const mask = parityDiscs(7)
    expect(contoursToRings(traceContours(mask))).toEqual(
      contoursToRings(traceContours(mask)),
    )
  })

  it('should_match_orientation_to_depth (AC-6)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const mask = parityDiscs(seed)
      const contours = traceContours(mask)
      const depth = nestingDepth(contours)
      for (const [k, c] of contours.entries()) {
        const outer = signedArea(c.points) < 0
        expect(outer, `seed ${String(seed)} contour ${String(k)}`).toBe(
          (depth[k] as number) % 2 === 0,
        )
      }
      const rings = contoursToRings(contours, cornerNodes)
      const depths = [...depth].sort((a, b) => a - b)
      expect(rings.map((r) => r.op)).toEqual(
        depths.map((d) => (d % 2 === 0 ? 'add' : 'subtract')),
      )
      expectSameRegions(rings, mask)
    }
  })

  it('should_use_the_given_dot_builder (AC-8)', () => {
    const speck = maskOf(5, 5, (i, j) => (i === 2 && j === 2 ? 1 : 0))
    const rings = contoursToRings(traceContours(speck), (c) =>
      c.points.slice(0, 3).map((p) => ({ ...p, kind: 'smooth' })),
    )
    expect(rings[0]?.nodes.map((n) => n.kind)).toEqual([
      'smooth',
      'smooth',
      'smooth',
    ])
  })
})
