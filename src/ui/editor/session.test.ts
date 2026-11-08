import { describe, expect, it } from 'vitest'
import type { StickerRecord } from '../../core/backup/types'
import type { AlphaMask, RgbaImage } from '../../core/mask'
import type { Command, Selection } from '../../core/selection/types'
import { createFakeEngine } from '../../services/segmentation'
import { createSession, type Renderer } from './session'

const PHOTO: RgbaImage = {
  width: 100,
  height: 50,
  data: new Uint8Array(100 * 50 * 4).fill(200),
}
const loaded = () => ({
  image: PHOTO,
  bytes: new Uint8Array([1, 2, 3]),
  type: 'image/png',
})
const renderer: Renderer = {
  setImage: () => undefined,
  setModelAlpha: () => undefined,
  render: () => Promise.resolve({ type: 'cancelled' as const }),
  renderFull: () => Promise.resolve({ type: 'cancelled' as const }),
  resimplify: () => Promise.resolve({ type: 'cancelled' as const }),
}

function session() {
  return createSession({
    engines: {
      fast: createFakeEngine({ name: 'fast' }),
      precise: createFakeEngine({ name: 'precise' }),
    },
    missingBytes: () => Promise.resolve(0),
    createRenderer: () => renderer,
    loadPhoto: () => Promise.resolve(loaded()),
    onState: () => undefined,
    onSelection: () => undefined,
  })
}

const corner = (x: number, y: number) => ({ x, y, kind: 'corner' as const })
const square: Selection = {
  rings: [
    {
      op: 'add',
      nodes: [corner(10, 10), corner(90, 10), corner(90, 40), corner(10, 40)],
    },
  ],
  strokes: [],
  feather: 0,
  softEdge: { source: 'model', bandPx: 8 },
}
const record = {
  id: 's1',
  createdAt: 1,
  updatedAt: 1,
} as StickerRecord
const alpha: AlphaMask = {
  width: 100,
  height: 50,
  data: new Uint8Array(100 * 50).fill(255),
}

describe('session edits (spec 0010)', () => {
  it('should_make_each_edit_one_undo_step (AC-4, AC-8 to AC-10, AC-14)', async () => {
    const s = session()
    await s.reopen(record, loaded(), null, square)
    const commands: Command[] = [
      { type: 'moveNode', ring: 0, node: 0, to: { x: 12.5, y: 11 } },
      { type: 'insertNode', ring: 0, afterNode: 0, point: { x: 50, y: 10 } },
      { type: 'deleteNode', ring: 0, node: 1 },
      { type: 'toggleKind', ring: 0, node: 2 },
      { type: 'nudge', refs: [{ ring: 0, node: 3 }], delta: { x: 1, y: 0 } },
    ]
    for (const command of commands) {
      const before = s.snapshot()?.selection
      const after = s.edit(command)
      expect(after).not.toBe(before)
      expect(s.snapshot()?.selection).toBe(after)
      expect(s.canUndo).toBe(true)
      s.undo()
      expect(s.snapshot()?.selection).toBe(before)
      s.redo()
      expect(s.snapshot()?.selection).toBe(after)
    }
  })

  it('should_keep_the_model_alpha_after_a_dot_edit (decision 1)', async () => {
    const s = session()
    await s.reopen(record, loaded(), alpha, square)
    expect(s.snapshot()?.modelAlpha).toBe(alpha)
    s.edit({ type: 'moveNode', ring: 0, node: 2, to: { x: 95, y: 45 } })
    expect(s.snapshot()?.modelAlpha).toBe(alpha)
  })

  it('should_leave_everything_unchanged_on_a_bad_command', async () => {
    const s = session()
    await s.reopen(record, loaded(), null, square)
    const before = s.snapshot()?.selection
    expect(() => s.edit({ type: 'deleteNode', ring: 3, node: 0 })).toThrow()
    expect(s.snapshot()?.selection).toBe(before)
  })
})
