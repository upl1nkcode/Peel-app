import { describe, expect, it } from 'vitest'
import type { CoverageMask } from '../contour'
import { combineTapMasks } from './index'

const row = (values: number[]): CoverageMask => ({
  width: values.length,
  height: 1,
  data: Float32Array.from(values),
})
const size = { width: 3, height: 1 }

describe('combineTapMasks', () => {
  it('should_combine_add_and_remove_taps (AC-3)', () => {
    const out = combineTapMasks(
      [row([0.2, 0.9, 0.5]), row([0.6, 0.1, 0.5])],
      [row([0, 0.5, 1])],
      size,
    )
    expect(Array.from(out.data).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([
      0.6, 0.45, 0,
    ])
    expect(
      Array.from(combineTapMasks([], [row([0, 0.5, 1])], size).data),
    ).toEqual([0, 0, 0])
    expect(
      Array.from(combineTapMasks([row([0.2, 0.9, 0.5])], [], size).data).map(
        (v) => Math.round(v * 1e6) / 1e6,
      ),
    ).toEqual([0.2, 0.9, 0.5])
  })

  it('should_refuse_masks_of_another_size', () => {
    expect(() => combineTapMasks([row([1, 1])], [], size)).toThrow(RangeError)
  })
})
