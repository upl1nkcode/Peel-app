import { describe, expect, it } from 'vitest'
import { checkTaps, tapsToStrokes, type Tap } from './index'

const size = { width: 100, height: 50 }
const tap = (x: number, y: number, mode: Tap['mode'] = 'add'): Tap => ({
  imagePt: { x, y },
  mode,
})

describe('tapsToStrokes', () => {
  it('should_turn_taps_into_normalised_strokes (AC-9)', () => {
    expect(
      tapsToStrokes([tap(0, 0), tap(50, 25, 'remove'), tap(99.5, 49.5)], size),
    ).toEqual([
      { mode: 'positive', x: 0, y: 0 },
      { mode: 'negative', x: 0.5, y: 0.5 },
      { mode: 'positive', x: 0.995, y: 0.99 },
    ])
  })

  it('should_refuse_taps_outside_the_image (AC-2)', () => {
    for (const bad of [
      tap(100, 10),
      tap(10, -0.1),
      tap(NaN, 1),
      tap(1, Infinity),
      tap(10, 50),
    ]) {
      expect(() => {
        checkTaps([bad], size)
      }).toThrow(RangeError)
      expect(() => tapsToStrokes([bad], size)).toThrow(RangeError)
    }
    expect(() => {
      checkTaps([tap(100 - 1e-9, 0)], size)
    }).not.toThrow()
  })
})
