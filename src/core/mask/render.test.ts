import { describe, expect, it } from 'vitest'
import type { Node, Point, Size } from '../geometry/types'
import type { BrushStroke, Ring, Selection } from '../selection/types'
import { feather } from './feather'
import { rasterizeRings } from './rasterize'
import { renderMask, type EdgeRefiner } from './render'
import { applyStrokes } from './strokes'
import { toAlphaMask } from './types'

const box = (
  op: Ring['op'],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Ring => ({
  op,
  nodes: (
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ] as const
  ).map(([x, y]): Node => ({ x, y, kind: 'corner' })),
})
const dot = (
  mode: BrushStroke['mode'],
  p: Point,
  sizePx: number,
  hardness = 1,
): BrushStroke => ({ mode, sizePx, hardness, points: [p] })
const selection = (s: Partial<Selection>): Selection => ({
  rings: [],
  strokes: [],
  feather: 0,
  ...s,
})
const at = (m: { width: number; data: Uint8Array }, i: number, j: number) =>
  m.data[j * m.width + i]

describe('renderMask', () => {
  it('should_restore_inside_a_subtract_hole (AC-18)', () => {
    const sel = selection({
      rings: [box('add', 2, 2, 18, 18), box('subtract', 6, 6, 14, 14)],
      strokes: [dot('restore', { x: 10.5, y: 10.5 }, 4)],
    })
    const m = renderMask(sel, { width: 20, height: 20 })
    expect(at(m, 10, 10)).toBe(255)
    expect(at(m, 7, 7)).toBe(0)
  })

  it('should_feather_a_hard_erase_edge (AC-18)', () => {
    const size = { width: 30, height: 30 }
    const sel = selection({
      rings: [box('add', -5, -5, 35, 35)],
      strokes: [dot('erase', { x: 15, y: 15 }, 10)],
      feather: 2,
    })
    const right = rasterizeRings(sel.rings, size)
    applyStrokes(right, size, sel.strokes)
    feather(right, size, 2)
    const wrong = rasterizeRings(sel.rings, size)
    feather(wrong, size, 2)
    applyStrokes(wrong, size, sel.strokes)
    const m = renderMask(sel, size)
    expect(m.data).toEqual(toAlphaMask(right, size).data)
    expect(m.data).not.toEqual(toAlphaMask(wrong, size).data)
  })

  it('should_give_the_refiner_rings_without_strokes (AC-18, AC-19)', () => {
    const size = { width: 16, height: 12 }
    const sel = selection({
      rings: [box('add', 2.5, 2, 12, 9.5)],
      strokes: [dot('erase', { x: 8, y: 6 }, 3)],
      softEdge: { source: 'guided', bandPx: 4 },
    })
    let seen: Float32Array | undefined
    const refine: EdgeRefiner = (mask, s, softEdge) => {
      seen = mask.slice()
      expect(s).toEqual(size)
      expect(softEdge).toEqual({ source: 'guided', bandPx: 4 })
      mask.fill(0.5)
    }
    const m = renderMask(sel, size, { refineEdge: refine })
    expect(seen).toEqual(rasterizeRings(sel.rings, size))
    expect(at(m, 7, 5)).toBe(0) // the erase stroke ran after the refiner
    expect(at(m, 0, 0)).toBe(128)
  })

  it('should_skip_refinement_without_soft_edge_or_refiner (AC-19)', () => {
    const size = { width: 10, height: 10 }
    const plain = selection({ rings: [box('add', 2, 2, 8, 8)] })
    let calls = 0
    const refine: EdgeRefiner = () => {
      calls++
    }
    renderMask(plain, size, { refineEdge: refine })
    expect(calls).toBe(0)
    const soft = { ...plain, softEdge: { source: 'model', bandPx: 6 } } as const
    expect(renderMask(soft, size)).toEqual(renderMask(plain, size))
  })

  it('should_return_the_image_size_rounded_once (AC-20)', () => {
    const size = { width: 23, height: 17 }
    const sel = selection({
      rings: [box('add', 1.3, 2.7, 19.1, 15.2), box('subtract', 8, 6, 12.5, 9)],
      strokes: [dot('restore', { x: 10, y: 7 }, 3, 0.2)],
      feather: 1.2,
    })
    const cov = rasterizeRings(sel.rings, size)
    applyStrokes(cov, size, sel.strokes)
    feather(cov, size, 1.2)
    const m = renderMask(sel, size)
    expect(m.width).toBe(23)
    expect(m.height).toBe(17)
    expect(m.data).toEqual(toAlphaMask(cov, size).data)
  })

  it('should_ignore_geometry_far_outside (AC-20)', () => {
    const sel = selection({
      rings: [box('add', 1e6, 1e6, 1e6 + 50, 1e6 + 50)],
      strokes: [dot('restore', { x: -1e6, y: 3 }, 20)],
      feather: 3,
    })
    expect(
      renderMask(sel, { width: 8, height: 8 }).data.every((v) => v === 0),
    ).toBe(true)
  })

  it('should_render_tiny_images (Review Focus 3)', () => {
    const sel = selection({ rings: [box('add', -1, -1, 2, 30)], feather: 3 })
    expect(renderMask(sel, { width: 1, height: 1 }).data).toEqual(
      new Uint8Array([255]),
    )
    const strip = renderMask(sel, { width: 1, height: 9 })
    expect(strip.data).toEqual(new Uint8Array(9).fill(255))
  })

  it('should_refuse_bad_image_sizes (AC-20)', () => {
    const sel = selection({})
    const bad: Size[] = [
      { width: 0, height: 4 },
      { width: 4, height: 2.5 },
      { width: Number.NaN, height: 4 },
      { width: -3, height: 4 },
    ]
    for (const s of bad) expect(() => renderMask(sel, s)).toThrow(RangeError)
  })

  it('should_render_a_scaled_preview (AC-21)', () => {
    const sel = selection({
      rings: [
        box('add', 40, 30, 361, 270),
        box('subtract', 150, 100, 250.5, 200),
      ],
      strokes: [
        {
          mode: 'erase',
          sizePx: 24,
          hardness: 0.5,
          points: [
            { x: 60, y: 60 },
            { x: 300, y: 240 },
          ],
        },
      ],
      feather: 1.5,
    })
    const preview = renderMask(
      sel,
      { width: 401, height: 301 },
      { scale: 0.25 },
    )
    expect(preview.width).toBe(101)
    expect(preview.height).toBe(76)
    const k = 0.25
    const scaled = selection({
      rings: sel.rings.map((r) => ({
        op: r.op,
        nodes: r.nodes.map((n) => ({ ...n, x: n.x * k, y: n.y * k })),
      })),
      strokes: sel.strokes.map((s) => ({
        ...s,
        sizePx: s.sizePx * k,
        points: s.points.map((p) => ({ x: p.x * k, y: p.y * k })),
      })),
      feather: sel.feather * k,
    })
    expect(preview).toEqual(renderMask(scaled, { width: 101, height: 76 }))
  })

  it('should_scale_the_soft_edge_band (AC-21)', () => {
    const sel = selection({
      rings: [box('add', 4, 4, 36, 36)],
      softEdge: { source: 'guided', bandPx: 8 },
    })
    let band = 0
    renderMask(
      sel,
      { width: 40, height: 40 },
      {
        scale: 0.5,
        refineEdge: (_m, _s, softEdge) => {
          band = softEdge.bandPx
        },
      },
    )
    expect(band).toBe(4)
  })

  it('should_refuse_bad_scales (AC-21)', () => {
    const sel = selection({})
    for (const scale of [0, -0.5, 1.01, Number.NaN]) {
      expect(() => renderMask(sel, { width: 4, height: 4 }, { scale })).toThrow(
        RangeError,
      )
    }
  })
})
