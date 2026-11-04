import { describe, expect, it } from 'vitest'

import type { View, Viewport } from '../coords/types'
import { nearestEdge, nearestNode } from './hitTest'
import type { Point } from './types'

// fitScale 1; at zoom 1 with this centre, canvasPt === imagePt
const vp: Viewport = {
  canvas: { width: 400, height: 400 },
  image: { width: 400, height: 400 },
  dpr: 3,
}
const zoom1: View = { zoom: 1, center: { x: 200, y: 200 } }
const zoom16: View = { zoom: 16, center: { x: 200, y: 200 } }
const touch = { x: 200, y: 200 }

describe('nearestNode', () => {
  // AC-15
  it.each([
    { view: zoom1, scale: 1 },
    { view: zoom16, scale: 16 },
  ])(
    'should_find_the_nearest_node_within_22_px_at_zoom_1_and_16 (×$scale)',
    ({ view, scale }) => {
      const at = (screenDist: number): Point => ({
        x: 200 + screenDist / scale,
        y: 200,
      })
      expect(nearestNode([at(21.9)], touch, vp, view)?.index).toBe(0)
      expect(nearestNode([at(22)], touch, vp, view)?.distancePx).toBeCloseTo(
        22,
        9,
      )
      expect(nearestNode([at(22.1)], touch, vp, view)).toBeNull()
      // nearest of several wins
      expect(nearestNode([at(15), at(-5), at(10)], touch, vp, view)).toEqual({
        index: 1,
        distancePx: expect.closeTo(5, 9) as number,
      })
    },
  )

  it('should_measure_screen_distance_not_image_distance (AC-15)', () => {
    // 2 image px away is 32 screen px at zoom 16: a miss
    expect(nearestNode([{ x: 202, y: 200 }], touch, vp, zoom16)).toBeNull()
    expect(nearestNode([{ x: 202, y: 200 }], touch, vp, zoom1)).not.toBeNull()
    expect(
      nearestNode([{ x: 202, y: 200 }], touch, vp, zoom16, 40)?.distancePx,
    ).toBeCloseTo(32, 9)
  })

  // AC-16
  it('should_break_ties_by_lowest_index_for_nodes_and_edges', () => {
    const left = { x: 190, y: 200 }
    const right = { x: 210, y: 200 }
    expect(nearestNode([left, right], touch, vp, zoom1)?.index).toBe(0)
    expect(nearestNode([right, left], touch, vp, zoom1)?.index).toBe(0)
    const above: Point[] = [
      { x: 0, y: 190 },
      { x: 400, y: 190 },
    ]
    const below: Point[] = [
      { x: 0, y: 210 },
      { x: 400, y: 210 },
    ]
    expect(nearestEdge([above, below], touch, vp, zoom1)?.edgeIndex).toBe(0)
    expect(nearestEdge([below, above], touch, vp, zoom1)?.edgeIndex).toBe(0)
  })
})

describe('nearestEdge', () => {
  // AC-17
  it('should_return_edge_index_arc_length_t_and_closest_point', () => {
    const straight: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    expect(nearestEdge([straight], { x: 25, y: 10 }, vp, zoom1)).toEqual({
      edgeIndex: 0,
      t: 0.25,
      imagePt: { x: 25, y: 0 },
      distancePx: 10,
    })

    const bent: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]
    const hit = nearestEdge([straight, bent], { x: 110, y: 50 }, vp, zoom1)
    expect(hit?.edgeIndex).toBe(1)
    expect(hit?.t).toBeCloseTo(0.75, 9)
    expect(hit?.imagePt.x).toBeCloseTo(100, 9)
    expect(hit?.imagePt.y).toBeCloseTo(50, 9)
    expect(hit?.distancePx).toBeCloseTo(10, 9)

    expect(nearestEdge([straight], { x: 50, y: 30 }, vp, zoom1)).toBeNull()
  })

  it('should_measure_edge_distance_on_screen_and_map_back_to_image (AC-17)', () => {
    // zoom 16: image segment y=200, x 190..210 → touch 16 screen px below
    const edge: Point[] = [
      { x: 190, y: 200 },
      { x: 210, y: 200 },
    ]
    const hit = nearestEdge([edge], { x: 216, y: 216 }, vp, zoom16)
    expect(hit?.distancePx).toBeCloseTo(16, 9)
    expect(hit?.imagePt.x).toBeCloseTo(201, 9)
    expect(hit?.imagePt.y).toBeCloseTo(200, 9)
    expect(hit?.t).toBeCloseTo(0.55, 9)
  })

  // AC-18
  it('should_test_nodes_and_edges_independently', () => {
    const nodes: Point[] = [{ x: 100, y: 0 }]
    const edge: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const p = { x: 95, y: 5 }
    expect(nearestNode(nodes, p, vp, zoom1)?.index).toBe(0)
    const e = nearestEdge([edge], p, vp, zoom1)
    expect(e?.edgeIndex).toBe(0)
    expect(e?.t).toBeCloseTo(0.95, 9)
  })

  // AC-22
  it('should_return_null_for_empty_input_and_handle_zero_length_edges', () => {
    expect(nearestNode([], touch, vp, zoom1)).toBeNull()
    expect(nearestEdge([], touch, vp, zoom1)).toBeNull()
    expect(nearestEdge([[]], touch, vp, zoom1)).toBeNull()

    const dot: Point[] = [
      { x: 50, y: 50 },
      { x: 50, y: 50 },
    ]
    expect(nearestEdge([dot], { x: 55, y: 50 }, vp, zoom1)).toEqual({
      edgeIndex: 0,
      t: 0,
      imagePt: { x: 50, y: 50 },
      distancePx: 5,
    })
    expect(
      nearestEdge([[{ x: 50, y: 50 }]], { x: 50, y: 53 }, vp, zoom1),
    ).toEqual({
      edgeIndex: 0,
      t: 0,
      imagePt: { x: 50, y: 50 },
      distancePx: 3,
    })

    const repeated: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const hit = nearestEdge([repeated], { x: 50, y: 4 }, vp, zoom1)
    expect(hit?.t).toBeCloseTo(0.5, 9)
    expect(Number.isNaN(hit?.t)).toBe(false)
  })
})
