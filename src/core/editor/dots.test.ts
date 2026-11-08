import { describe, expect, it } from 'vitest'
import { canvasToImage, imageToCanvas } from '../coords/transform'
import type { View, Viewport } from '../coords/types'
import { pointOnSegment, toBezierSegments } from '../geometry/bezier'
import type { Node, Point } from '../geometry/types'
import { emptySelection } from '../selection/model'
import type { Ring, Selection } from '../selection/types'
import {
  densityTolerance,
  hitDots,
  nodesInBox,
  refsAfterDelete,
  sameRings,
  startingShape,
  visiblePhotoRect,
} from './dots'

// 400×300 canvas, 800×600 image, dpr 1: fit is 0.5 CSS px per image px.
const vp: Viewport = {
  canvas: { width: 400, height: 300 },
  image: { width: 800, height: 600 },
  dpr: 1,
}
const fit: View = { zoom: 1, center: { x: 400, y: 300 } }

const corner = (x: number, y: number): Node => ({ x, y, kind: 'corner' })
const smooth = (x: number, y: number): Node => ({ x, y, kind: 'smooth' })
const ring = (nodes: Node[], op: Ring['op'] = 'add'): Ring => ({ op, nodes })
const withRings = (...rings: Ring[]): Selection => ({
  ...emptySelection(),
  rings,
})
const square = ring([
  corner(100, 100),
  corner(300, 100),
  corner(300, 300),
  corner(100, 300),
])
const toCanvas = (view: View, p: Point) => imageToCanvas(vp, view, p)
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

describe('hitDots', () => {
  it('should_hit_the_nearest_dot_before_an_edge (AC-8, AC-11)', () => {
    const sel = withRings(square)
    const dot0 = toCanvas(fit, { x: 100, y: 100 })
    expect(hitDots(sel, { x: dot0.x + 3, y: dot0.y + 4 }, vp, fit)).toEqual({
      kind: 'node',
      ref: { ring: 0, node: 0 },
    })

    const mid = toCanvas(fit, { x: 200, y: 100 })
    const edge = hitDots(sel, mid, vp, fit)
    expect(edge).toMatchObject({ kind: 'edge', ring: 0, afterNode: 0 })
    if (edge?.kind !== 'edge') throw new Error('not an edge')
    expect(dist(edge.imagePt, { x: 200, y: 100 })).toBeLessThanOrEqual(0.01)

    // 30 canvas px from every dot and edge.
    const centre = toCanvas(fit, { x: 200, y: 200 })
    expect(hitDots(sel, centre, vp, fit)).toBeNull()
  })

  it('should_pick_the_nearest_of_crowded_dots (Review Focus 5)', () => {
    // 50 dots 1 image px apart along a line, closed back along a parallel one.
    const top = Array.from({ length: 50 }, (_, i) => corner(200 + i, 200))
    const sel = withRings(ring([...top, corner(249, 260), corner(200, 260)]))
    const at = toCanvas(fit, { x: 217.2, y: 200.3 })
    expect(hitDots(sel, at, vp, fit)).toEqual({
      kind: 'node',
      ref: { ring: 0, node: 17 },
    })
  })

  it('should_insert_on_the_drawn_curve (AC-8)', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * 2 * Math.PI
      return smooth(400 + 200 * Math.cos(a), 300 + 150 * Math.sin(a))
    })
    const sel = withRings(ring(nodes))
    // A tap 4 canvas px outside the curve, between dots 0 and 1.
    const seg = toBezierSegments(nodes, true)[0]
    if (!seg) throw new Error('no segment')
    const onCurve = pointOnSegment(seg, 0.4)
    const c = toCanvas(fit, onCurve)
    const tap = { x: c.x + 4, y: c.y + 1 }
    const hit = hitDots(sel, tap, vp, fit)
    expect(hit).toMatchObject({ kind: 'edge', ring: 0, afterNode: 0 })
    if (hit?.kind !== 'edge') throw new Error('not an edge')
    // It is the curve point nearest the tap (dense sampling), within 0.01.
    const tapImage = canvasToImage(vp, fit, tap)
    let best = Infinity
    for (let i = 0; i <= 100_000; i++) {
      best = Math.min(best, dist(pointOnSegment(seg, i / 100_000), tapImage))
    }
    expect(dist(hit.imagePt, tapImage)).toBeLessThanOrEqual(best + 0.01)
    let onSeg = Infinity
    for (let i = 0; i <= 100_000; i++) {
      onSeg = Math.min(
        onSeg,
        dist(pointOnSegment(seg, i / 100_000), hit.imagePt),
      )
    }
    expect(onSeg).toBeLessThanOrEqual(0.01)
  })

  it('should_hit_at_16x (AC-3, #66)', () => {
    const sel = withRings(square)
    const zoomed: View = { zoom: 16, center: { x: 100, y: 100 } }
    const dot0 = toCanvas(zoomed, { x: 100, y: 100 })
    // Up and to the left of dot 0: outside the square, away from its edges.
    const off = (d: number) => ({
      x: dot0.x - d / Math.SQRT2,
      y: dot0.y - d / Math.SQRT2,
    })
    expect(hitDots(sel, off(20), vp, zoomed)).toEqual({
      kind: 'node',
      ref: { ring: 0, node: 0 },
    })
    expect(hitDots(sel, off(23), vp, zoomed)).toBeNull()
  })

  it('should_do_nothing_without_rings (AC-2)', () => {
    expect(hitDots(emptySelection(), { x: 200, y: 150 }, vp, fit)).toBeNull()
  })
})

describe('nodesInBox', () => {
  it('should_select_dots_in_a_box (AC-11)', () => {
    const second = ring(
      [corner(320, 100), corner(380, 100), corner(380, 160)],
      'subtract',
    )
    const sel = withRings(square, second)
    // From image (290, 90) to (330, 100): the box's bottom edge is y = 100.
    const a = toCanvas(fit, { x: 290, y: 90 })
    const b = toCanvas(fit, { x: 330, y: 100 })
    const refs = [
      { ring: 0, node: 1 },
      { ring: 1, node: 0 },
    ]
    expect(nodesInBox(sel, a, b, vp, fit)).toEqual(refs)
    expect(nodesInBox(sel, b, a, vp, fit)).toEqual(refs)
  })
})

describe('densityTolerance', () => {
  it('should_map_the_slider_to_a_tolerance (AC-15, AC-16)', () => {
    expect(densityTolerance(-1)).toBeCloseTo(8, 12)
    expect(densityTolerance(-0.5)).toBeCloseTo(2, 12)
    expect(densityTolerance(0)).toBeNull()
    expect(densityTolerance(1)).toBeCloseTo(0.01, 12)
    expect(densityTolerance(0.5)).toBeCloseTo(0.5 * Math.sqrt(0.02), 12)
  })
})

describe('starting shapes', () => {
  const visible = { x: 100, y: 50, width: 400, height: 300 }

  it('should_place_shapes_on_the_visible_photo (AC-17)', () => {
    expect(startingShape('rectangle', visible)).toEqual([
      corner(180, 110),
      corner(420, 110),
      corner(420, 290),
      corner(180, 290),
    ])
    const ellipse = startingShape('ellipse', visible)
    expect(ellipse).toHaveLength(8)
    for (const n of ellipse) {
      expect(n.kind).toBe('smooth')
      expect(((n.x - 300) / 120) ** 2 + ((n.y - 200) / 90) ** 2).toBeCloseTo(
        1,
        9,
      )
    }
  })

  it('should_give_the_visible_photo_rect (AC-17)', () => {
    expect(visiblePhotoRect(vp, fit)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    })
    // Zoom 4 (2 CSS px per image px) at (100, 500): the window is 200×150
    // image px, x 0–200 and y 425–575, clipped on the left at 0.
    expect(
      visiblePhotoRect(vp, { zoom: 4, center: { x: 50, y: 500 } }),
    ).toEqual({ x: 0, y: 425, width: 150, height: 150 })
  })
})

describe('refsAfterDelete', () => {
  it('should_keep_refs_on_the_same_dots_after_a_delete (AC-13, Review Focus 2)', () => {
    const five = ring([
      corner(0, 0),
      corner(10, 0),
      corner(20, 0),
      corner(20, 10),
      corner(0, 10),
    ])
    const three = ring([corner(0, 0), corner(5, 0), corner(5, 5)])
    let sel = withRings(five)
    expect(
      refsAfterDelete(
        sel,
        [
          { ring: 0, node: 1 },
          { ring: 0, node: 3 },
        ],
        { ring: 0, node: 1 },
      ),
    ).toEqual([{ ring: 0, node: 2 }])

    sel = withRings(three, five)
    expect(
      refsAfterDelete(
        sel,
        [
          { ring: 0, node: 2 },
          { ring: 1, node: 4 },
        ],
        { ring: 0, node: 0 },
      ),
    ).toEqual([{ ring: 0, node: 4 }])
  })
})

describe('sameRings', () => {
  it('should_compare_rings (AC-16)', () => {
    const a = withRings(square)
    const copy = structuredClone(a)
    expect(sameRings(a, copy)).toBe(true)
    const moved = structuredClone(a)
    ;(moved.rings[0]?.nodes[2] as Node).x = 300.0001
    expect(sameRings(a, moved)).toBe(false)
    const kinded = structuredClone(a)
    ;(kinded.rings[0]?.nodes[2] as Node).kind = 'smooth'
    expect(sameRings(a, kinded)).toBe(false)
    expect(sameRings(a, withRings(square, square))).toBe(false)
  })
})
