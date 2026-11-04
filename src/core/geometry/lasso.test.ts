import { describe, expect, it } from 'vitest'

import { createLasso, InvalidLassoError, LASSO_MIN_DISTANCE } from './lasso'

describe('lasso recording', () => {
  // AC-1
  it('should_drop_points_closer_than_0_5_px_to_the_last_kept_point', () => {
    expect(LASSO_MIN_DISTANCE).toBe(0.5)
    const lasso = createLasso()
    lasso.add({ x: 0, y: 0 })
    lasso.add({ x: 0.49, y: 0 }) // dropped
    lasso.add({ x: 0.5, y: 0 }) // exactly 0.5 from the last kept: kept
    lasso.add({ x: 0.8, y: 0.3 }) // 0.42 from (0.5, 0): dropped
    expect(lasso.points()).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
    ])

    // a batch (coalesced samples of one frame) dedupes against the running last kept point
    lasso.addMany([
      { x: 0.6, y: 0 },
      { x: 0.9, y: 0 },
      { x: 1.0, y: 0 },
      { x: 3, y: 4 },
    ])
    expect(lasso.points()).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1.0, y: 0 },
      { x: 3, y: 4 },
    ])
  })

  it('should_return_a_copy_from_points (AC-1)', () => {
    const lasso = createLasso()
    lasso.add({ x: 0, y: 0 })
    const snapshot = lasso.points() as { x: number; y: number }[]
    snapshot.push({ x: 99, y: 99 })
    expect(lasso.points()).toHaveLength(1)
  })

  // AC-2
  it('should_return_a_ring_without_repeating_the_first_point', () => {
    const square = createLasso()
    square.addMany([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 }, // back exactly at the start
    ])
    expect(square.close()).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])

    const nearly = createLasso()
    nearly.addMany([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0.3, y: 0.3 }, // within 0.5 of the first
    ])
    expect(nearly.close()).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ])
  })

  // AC-3, AC-27
  it('should_throw_invalid_lasso_error_for_fewer_than_3_kept_points', () => {
    const empty = createLasso()
    expect(() => empty.close()).toThrow(InvalidLassoError)

    const two = createLasso()
    two.addMany([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ])
    expect(() => two.close()).toThrow(InvalidLassoError)

    // AC-27: 3 raw points within 0.4 px of each other dedupe to 1
    const tiny = createLasso()
    tiny.addMany([
      { x: 0, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0 },
    ])
    expect(() => tiny.close()).toThrow(InvalidLassoError)

    // a triangle whose last point collapses onto the first leaves 2
    const collapsing = createLasso()
    collapsing.addMany([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0.1, y: 0.1 },
    ])
    expect(() => collapsing.close()).toThrow(InvalidLassoError)
    expect(new InvalidLassoError('x')).toBeInstanceOf(Error)
  })

  // AC-4
  it('should_extend_the_same_path_after_a_pause_and_reject_adds_after_close', () => {
    const lasso = createLasso()
    lasso.addMany([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ])
    // user zoomed/panned, then continued
    lasso.add({ x: 10, y: 10 })
    lasso.addMany([{ x: 0, y: 10 }])
    expect(lasso.points()).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])
    lasso.close()
    expect(() => {
      lasso.add({ x: 5, y: 5 })
    }).toThrow(InvalidLassoError)
    expect(() => {
      lasso.addMany([{ x: 5, y: 5 }])
    }).toThrow(InvalidLassoError)
    expect(() => lasso.close()).toThrow(InvalidLassoError)
  })
})
