import { describe, expect, it } from 'vitest'

import {
  InvalidCommandError,
  InvalidSelectionError,
  UnsupportedSelectionVersionError,
} from './errors'
import { emptySelection } from './model'
import type { Selection } from './types'

describe('selection model', () => {
  // AC-1
  it('should_start_empty', () => {
    const a = emptySelection()
    expect(a).toEqual({ rings: [], strokes: [], feather: 0 })
    expect('softEdge' in a).toBe(false)
    expect(emptySelection()).not.toBe(a)
  })

  // AC-2
  it('should_hold_rings_soft_edge_strokes_and_feather', () => {
    const sel: Selection = {
      rings: [
        {
          op: 'add',
          nodes: [
            { x: -0.375, y: 4032.0625, kind: 'corner' },
            { x: 100.1, y: 0.2, kind: 'smooth' },
            { x: 50, y: 80.000001, kind: 'smooth' },
          ],
        },
        {
          op: 'subtract',
          nodes: [
            { x: 10, y: 10, kind: 'corner' },
            { x: 20, y: 10, kind: 'corner' },
            { x: 15, y: 20, kind: 'corner' },
          ],
        },
      ],
      softEdge: { source: 'model', bandPx: 6 },
      strokes: [
        { mode: 'erase', sizePx: 10, hardness: 0.8, points: [{ x: 1, y: 2 }] },
      ],
      feather: 1.5,
    }
    expect(sel.rings.map((r) => r.op)).toEqual(['add', 'subtract'])
    // stored exactly, even outside the image and with sub-pixel precision
    expect(sel.rings[0]?.nodes[0]).toEqual({
      x: -0.375,
      y: 4032.0625,
      kind: 'corner',
    })
    expect(sel.rings[0]?.nodes[2]?.y).toBe(80.000001)
    expect(sel.softEdge).toEqual({ source: 'model', bandPx: 6 })
    expect(sel.strokes[0]?.mode).toBe('erase')
    expect(sel.feather).toBe(1.5)
  })

  // AC-27 support
  it('should_carry_the_found_version', () => {
    const e = new UnsupportedSelectionVersionError(7)
    expect(e.version).toBe(7)
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('UnsupportedSelectionVersionError')
    expect(new InvalidCommandError('x')).toBeInstanceOf(Error)
    expect(new InvalidSelectionError('x').name).toBe('InvalidSelectionError')
  })
})
