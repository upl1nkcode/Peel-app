import { describe, expect, it } from 'vitest'
import { canvasToImage, imageToCanvas } from '../coords/transform'
import type { View, Viewport } from '../coords/types'
import { pointOnSegment, toBezierSegments } from '../geometry/bezier'
import type { Node, Point } from '../geometry/types'
import { emptySelection } from '../selection/model'
import type { Ring, Selection } from '../selection/types'
import {
  densityTolerance,
  dragTo,
  hitDots,
  nodesInBox,
  refsAfterDelete,
  sameRings,
  startDrag,
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
    const copy = JSON.parse(JSON.stringify(a)) as Selection
    expect(sameRings(a, copy)).toBe(true)
    const moved = JSON.parse(JSON.stringify(a)) as Selection
    ;(moved.rings[0]?.nodes[2] as Node).x = 300.0001
    expect(sameRings(a, moved)).toBe(false)
    const kinded = JSON.parse(JSON.stringify(a)) as Selection
    ;(kinded.rings[0]?.nodes[2] as Node).kind = 'smooth'
    expect(sameRings(a, kinded)).toBe(false)
    expect(sameRings(a, withRings(square, square))).toBe(false)
  })
})

describe('dot drags', () => {
  const dots = [
    { x: 100, y: 100 },
    { x: 140, y: 90 },
  ]
  const f0 = { x: 200, y: 150 }

  it('should_follow_the_finger_from_where_it_went_down (AC-3)', () => {
    const drag = startDrag(dots, f0, 0, vp, fit, true)
    // 10 px of the 14 are inside the press slop: they still count.
    const { positions, fine } = dragTo(drag, { x: 210, y: 154 }, 16)
    expect(fine).toBe(false)
    expect(positions).toEqual([
      { x: 120, y: 108 },
      { x: 160, y: 98 },
    ])
  })

  it('should_follow_at_16x (AC-3, #66)', () => {
    const zoomed: View = { zoom: 16, center: { x: 100, y: 100 } }
    const drag = startDrag(dots, f0, 0, vp, zoomed, true)
    expect(dragTo(drag, { x: 216, y: 150 }, 16).positions[0]).toEqual({
      x: 102,
      y: 100,
    })
  })

  /** Feeds finger points at times; returns each step's result. */
  const run = (fineEnabled: boolean, steps: [number, number, number][]) => {
    let drag = startDrag(dots, f0, 0, vp, fit, fineEnabled)
    return steps.map(([x, y, t]) => {
      const r = dragTo(drag, { x, y }, t)
      drag = r.drag
      return r
    })
  }

  it('should_go_quarter_speed_after_holding_still (AC-6)', () => {
    const r = run(true, [
      [230, 150, 50],
      [231, 150, 100],
      [230.5, 151, 200],
      [231, 151, 350],
      [239, 151, 400],
    ])
    expect(r.map((s) => s.fine)).toEqual([false, false, false, true, true])
    // It engages where the dot was shown, at the finger's last point
    // (230.5, 151) → (161, 102); the 0.5 px since then counts a quarter…
    expect(r[3]?.positions[0]).toEqual({ x: 161.25, y: 102 })
    // …then 8 canvas px (16 image px) move it a quarter: 4 image px.
    expect(r[4]?.positions[0]).toEqual({ x: 165.25, y: 102 })

    // A move of more than 2 px restarts the wait.
    const late = run(true, [
      [230, 150, 50],
      [231, 150, 100],
      [234, 150, 200],
      [234.5, 150, 400],
      [234, 150.5, 500],
    ])
    expect(late.map((s) => s.fine)).toEqual([false, false, false, false, true])
  })

  it('should_engage_after_a_still_hold_with_no_events (AC-6, final review I-1)', () => {
    // A still finger sends no moves; the next one is 3 px away.
    const r = run(true, [
      [230, 150, 50],
      [233, 150, 550],
      [241, 150, 566],
    ])
    expect(r.map((s) => s.fine)).toEqual([false, true, true])
    // Engaged at (230, 150), where the dot was (160, 100); then a quarter.
    expect(r[1]?.positions[0]).toEqual({ x: 161.5, y: 100 })
    expect(r[2]?.positions[0]).toEqual({ x: 165.5, y: 100 })
  })

  it('should_engage_in_place_when_asked_again_after_the_hold (AC-6, final review I-1)', () => {
    // The canvas asks again with the same finger point once 300 ms pass.
    const r = run(true, [
      [230, 150, 50],
      [230, 150, 350],
    ])
    expect(r.map((s) => s.fine)).toEqual([false, true])
    expect(r[1]?.positions).toEqual(r[0]?.positions)
  })

  it('should_stay_one_to_one_with_fine_off (AC-6)', () => {
    const r = run(false, [
      [230, 150, 50],
      [231, 150, 100],
      [230.5, 151, 200],
      [231, 151, 350],
      [239, 151, 400],
    ])
    expect(r.every((s) => !s.fine)).toBe(true)
    expect(r[4]?.positions[0]).toEqual({ x: 178, y: 102 })
  })

  it('should_keep_off_photo_positions_unrounded (AC-7, Review Focus 4)', () => {
    const near = [{ x: 5.25, y: 3.5 }]
    const drag = startDrag(near, f0, 0, vp, fit, true)
    const to = { x: 186.7, y: 141.1 }
    const [p] = dragTo(drag, to, 16).positions
    expect(p).toEqual({
      x: 5.25 + (to.x - f0.x) / 0.5,
      y: 3.5 + (to.y - f0.y) / 0.5,
    })
    expect(p?.x).toBeLessThan(0)
    expect(Number.isInteger(p?.x)).toBe(false)
  })
})
