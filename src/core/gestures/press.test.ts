import { describe, expect, it } from 'vitest'
import { classifyPress, LONG_PRESS_MS, PRESS_SLOP_PX } from './press'

const at = (x: number, y: number, t: number) => ({ screenPt: { x, y }, t })

describe('classifyPress', () => {
  it('should_classify_taps_and_long_presses (AC-25)', () => {
    expect(LONG_PRESS_MS).toBe(500)
    expect(PRESS_SLOP_PX).toBe(10)
    expect(classifyPress(at(5, 5, 1000), at(15, 5, 1499))).toBe('tap')
    expect(classifyPress(at(5, 5, 1000), at(5, 5, 1500))).toBe('longPress')
    expect(classifyPress(at(0, 0, 0), at(10.01, 0, 100))).toBeNull()
    expect(classifyPress(at(0, 0, 0), at(0, 11, 900))).toBeNull()
  })
})
