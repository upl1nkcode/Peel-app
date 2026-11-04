import { describe, expect, it } from 'vitest'
import type { Selection } from '../selection/types'
import { applyMask, cutout } from './cutout'
import { renderMask, type EdgeRefiner } from './render'
import type { AlphaMask, RgbaImage } from './types'

const image: RgbaImage = {
  width: 3,
  height: 1,
  data: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0]),
}

describe('applyMask', () => {
  it('should_keep_rgb_and_set_alpha_from_the_mask (AC-22)', () => {
    const mask: AlphaMask = {
      width: 3,
      height: 1,
      data: new Uint8Array([200, 255, 77]),
    }
    const out = applyMask(image, mask)
    expect(Array.from(out.data)).toEqual([
      10,
      20,
      30,
      200,
      40,
      50,
      60,
      128, // round(128 · 255 / 255)
      70,
      80,
      90,
      0,
    ])
    const half: AlphaMask = {
      width: 3,
      height: 1,
      data: new Uint8Array([128, 128, 128]),
    }
    expect(applyMask(image, half).data[7]).toBe(Math.round((128 * 128) / 255))
    expect(image.data[3]).toBe(255) // input untouched
  })

  it('should_refuse_a_mask_of_another_size (AC-22)', () => {
    const preview: AlphaMask = { width: 2, height: 1, data: new Uint8Array(2) }
    expect(() => applyMask(image, preview)).toThrow(RangeError)
  })
})

describe('cutout', () => {
  it('should_cut_out_at_full_resolution (AC-23)', () => {
    const big: RgbaImage = {
      width: 20,
      height: 10,
      data: new Uint8Array(20 * 10 * 4).map((_, k) => (k * 7) & 0xff),
    }
    const selection: Selection = {
      rings: [
        {
          op: 'add',
          nodes: [
            { x: 2.5, y: 1, kind: 'smooth' },
            { x: 17, y: 2, kind: 'smooth' },
            { x: 15, y: 9, kind: 'corner' },
            { x: 3, y: 8.5, kind: 'smooth' },
          ],
        },
      ],
      strokes: [],
      feather: 0.8,
      softEdge: { source: 'guided', bandPx: 3 },
    }
    const refine: EdgeRefiner = (m) => {
      m[0] = 1
    }
    expect(cutout(big, selection)).toEqual(
      applyMask(big, renderMask(selection, { width: 20, height: 10 })),
    )
    expect(cutout(big, selection, { refineEdge: refine })).toEqual(
      applyMask(
        big,
        renderMask(
          selection,
          { width: 20, height: 10 },
          { refineEdge: refine },
        ),
      ),
    )
  })
})
