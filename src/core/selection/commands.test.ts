import { describe, expect, it } from 'vitest'

import { deepClone } from '../../test/clone'
import type { Node } from '../geometry/types'
import { applyCommand } from './commands'
import { InvalidCommandError } from './errors'
import type { BrushStroke, Command, Selection } from './types'

const n = (x: number, y: number, kind: Node['kind'] = 'corner'): Node => ({
  x,
  y,
  kind,
})
const square = [n(0, 0), n(10, 0), n(10, 10), n(0, 10)]
const tri = [n(20, 20, 'smooth'), n(30, 20, 'smooth'), n(25, 30, 'smooth')]
const stroke: BrushStroke = {
  mode: 'erase',
  sizePx: 10,
  hardness: 0.8,
  points: [{ x: 1, y: 2 }],
}
const base = (): Selection => ({
  rings: [
    { op: 'add', nodes: square.map((p) => ({ ...p })) },
    { op: 'subtract', nodes: tri.map((p) => ({ ...p })) },
  ],
  strokes: [stroke],
  feather: 0,
})

const nodesOf = (s: Selection, ring: number) => s.rings[ring]?.nodes

/** Applies `command` and checks the input was not mutated (AC-3). */
function apply(sel: Selection, command: Command): Selection {
  const before = deepClone(sel)
  const out = applyCommand(sel, command)
  expect(sel).toEqual(before)
  return out
}

describe('edit commands', () => {
  // AC-4
  it('should_move_one_node_and_keep_its_kind', () => {
    const out = apply(base(), {
      type: 'moveNode',
      ring: 0,
      node: 1,
      to: { x: 12.25, y: -0.5 },
    })
    expect(nodesOf(out, 0)?.[1]).toEqual(n(12.25, -0.5))
    expect(nodesOf(out, 0)).toHaveLength(4)
  })

  // AC-5
  it('should_move_referenced_nodes_once_across_rings', () => {
    const out = apply(base(), {
      type: 'moveNodes',
      refs: [
        { ring: 0, node: 0 },
        { ring: 1, node: 2 },
        { ring: 0, node: 0 }, // duplicate: moves once
      ],
      delta: { x: 0.5, y: -1 },
    })
    expect(nodesOf(out, 0)?.[0]).toEqual(n(0.5, -1))
    expect(nodesOf(out, 0)?.[1]).toEqual(n(10, 0))
    expect(nodesOf(out, 1)?.[2]).toEqual(n(25.5, 29, 'smooth'))
  })

  // AC-6
  it('should_nudge_like_move_nodes', () => {
    const refs = [{ ring: 0, node: 2 }]
    const delta = { x: 1, y: 0 }
    expect(apply(base(), { type: 'nudge', refs, delta })).toEqual(
      apply(base(), { type: 'moveNodes', refs, delta }),
    )
  })

  // AC-7
  it('should_insert_after_a_node_with_wrap_and_default_smooth_kind', () => {
    const mid = apply(base(), {
      type: 'insertNode',
      ring: 0,
      afterNode: 0,
      point: { x: 5, y: 0.125 },
    })
    expect(nodesOf(mid, 0)).toEqual([
      n(0, 0),
      n(5, 0.125, 'smooth'),
      n(10, 0),
      n(10, 10),
      n(0, 10),
    ])
    const wrap = apply(base(), {
      type: 'insertNode',
      ring: 0,
      afterNode: 3,
      point: { x: 0, y: 5 },
      kind: 'corner',
    })
    expect(nodesOf(wrap, 0)?.at(-1)).toEqual(n(0, 5))
    expect(nodesOf(wrap, 0)).toHaveLength(5)
  })

  // AC-8
  it('should_delete_a_node_and_remove_rings_left_below_3', () => {
    const out = apply(base(), { type: 'deleteNode', ring: 0, node: 1 })
    expect(nodesOf(out, 0)).toEqual([n(0, 0), n(10, 10), n(0, 10)])
    const gone = apply(base(), { type: 'deleteNode', ring: 1, node: 0 })
    expect(gone.rings).toHaveLength(1)
    expect(gone.rings[0]?.op).toBe('add')
  })

  // AC-9
  it('should_toggle_corner_and_smooth', () => {
    const once = apply(base(), { type: 'toggleKind', ring: 0, node: 2 })
    expect(nodesOf(once, 0)?.[2]?.kind).toBe('smooth')
    const twice = apply(once, { type: 'toggleKind', ring: 0, node: 2 })
    expect(nodesOf(twice, 0)?.[2]?.kind).toBe('corner')
  })

  // AC-10
  it('should_append_add_and_subtract_rings_in_order', () => {
    const a = apply(base(), { type: 'subtractRing', nodes: square })
    const b = apply(a, { type: 'addRing', nodes: tri })
    expect(b.rings.map((r) => r.op)).toEqual([
      'add',
      'subtract',
      'subtract',
      'add',
    ])
    expect(b.rings[3]?.nodes).toEqual(tri)
  })

  // AC-11
  it('should_add_strokes_and_set_feather_and_soft_edge', () => {
    const restore: BrushStroke = {
      mode: 'restore',
      sizePx: 3.5,
      hardness: 0,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 4 },
      ],
    }
    const s1 = apply(base(), { type: 'addStroke', stroke: restore })
    expect(s1.strokes).toEqual([stroke, restore])
    const s2 = apply(s1, { type: 'setFeather', px: 2.5 })
    expect(s2.feather).toBe(2.5)
    const s3 = apply(s2, {
      type: 'setSoftEdge',
      softEdge: { source: 'guided', bandPx: 12 },
    })
    expect(s3.softEdge).toEqual({ source: 'guided', bandPx: 12 })
    const s4 = apply(s3, { type: 'setSoftEdge', softEdge: null })
    expect('softEdge' in s4).toBe(false)
  })

  // AC-3
  it.each<{ command: Command; untouched: number[] }>([
    {
      command: { type: 'moveNode', ring: 0, node: 0, to: { x: 1, y: 1 } },
      untouched: [1],
    },
    {
      command: {
        type: 'moveNodes',
        refs: [{ ring: 1, node: 0 }],
        delta: { x: 1, y: 0 },
      },
      untouched: [0],
    },
    {
      command: {
        type: 'nudge',
        refs: [{ ring: 0, node: 0 }],
        delta: { x: 0, y: 1 },
      },
      untouched: [1],
    },
    {
      command: {
        type: 'insertNode',
        ring: 1,
        afterNode: 0,
        point: { x: 1, y: 1 },
      },
      untouched: [0],
    },
    { command: { type: 'deleteNode', ring: 0, node: 0 }, untouched: [1] },
    { command: { type: 'toggleKind', ring: 1, node: 1 }, untouched: [0] },
    { command: { type: 'addRing', nodes: tri }, untouched: [0, 1] },
    { command: { type: 'subtractRing', nodes: tri }, untouched: [0, 1] },
    { command: { type: 'addStroke', stroke }, untouched: [0, 1] },
    { command: { type: 'setFeather', px: 1 }, untouched: [0, 1] },
    {
      command: {
        type: 'setSoftEdge',
        softEdge: { source: 'model', bandPx: 4 },
      },
      untouched: [0, 1],
    },
  ])(
    'should_not_mutate_input_and_share_untouched_rings ($command.type)',
    ({ command, untouched }) => {
      const sel = base()
      const out = apply(sel, command)
      expect(out).not.toBe(sel)
      for (const i of untouched) expect(out.rings[i]).toBe(sel.rings[i])
      if (command.type !== 'addStroke') expect(out.strokes).toBe(sel.strokes)
    },
  )

  // Review Focus 1
  it('should_copy_caller_data', () => {
    const nodes = [n(0, 0), n(5, 0), n(0, 5)]
    const to = { x: 3, y: 3 }
    const s1 = applyCommand(base(), { type: 'addRing', nodes })
    const s2 = applyCommand(s1, { type: 'moveNode', ring: 2, node: 0, to })
    const strokePts = [{ x: 9, y: 9 }]
    const s3 = applyCommand(s2, {
      type: 'addStroke',
      stroke: { ...stroke, points: strokePts },
    })
    const snapshot = deepClone(s3)
    nodes.push(n(99, 99))
    ;(nodes[1] as Node).x = 99
    to.x = 99
    ;(strokePts[0] as { x: number }).x = 99
    expect(s3).toEqual(snapshot)
  })

  // AC-12, Review Focus 2
  it.each<{ name: string; command: Command }>([
    {
      name: 'negative ring',
      command: { type: 'deleteNode', ring: -1, node: 0 },
    },
    {
      name: 'fractional ring',
      command: { type: 'toggleKind', ring: 0.5, node: 0 },
    },
    {
      name: 'NaN node',
      command: { type: 'deleteNode', ring: 0, node: Number.NaN },
    },
    {
      name: 'ring out of range',
      command: { type: 'moveNode', ring: 2, node: 0, to: { x: 0, y: 0 } },
    },
    {
      name: 'node out of range',
      command: { type: 'moveNode', ring: 0, node: 4, to: { x: 0, y: 0 } },
    },
    {
      name: 'fractional node',
      command: { type: 'moveNode', ring: 0, node: 1.5, to: { x: 0, y: 0 } },
    },
    {
      name: 'NaN target',
      command: {
        type: 'moveNode',
        ring: 0,
        node: 0,
        to: { x: Number.NaN, y: 0 },
      },
    },
    {
      name: 'infinite delta',
      command: {
        type: 'moveNodes',
        refs: [{ ring: 0, node: 0 }],
        delta: { x: Infinity, y: 0 },
      },
    },
    {
      name: 'bad ref',
      command: {
        type: 'nudge',
        refs: [{ ring: 0, node: 9 }],
        delta: { x: 1, y: 0 },
      },
    },
    {
      name: 'bad afterNode',
      command: {
        type: 'insertNode',
        ring: 0,
        afterNode: 4,
        point: { x: 1, y: 1 },
      },
    },
    {
      name: 'NaN insert point',
      command: {
        type: 'insertNode',
        ring: 0,
        afterNode: 0,
        point: { x: 1, y: Number.NaN },
      },
    },
    {
      name: 'NaN ring node',
      command: { type: 'addRing', nodes: [n(0, 0), n(1, 0), n(0, Number.NaN)] },
    },
  ])(
    'should_reject_bad_indices_and_non_finite_values ($name)',
    ({ command }) => {
      const sel = base()
      const before = deepClone(sel)
      expect(() => applyCommand(sel, command)).toThrow(InvalidCommandError)
      expect(sel).toEqual(before)
    },
  )

  // AC-13
  it('should_reject_degenerate_new_rings', () => {
    const cases: Node[][] = [
      [n(0, 0), n(5, 5)],
      [n(0, 0), n(5, 5), n(10, 10)],
      // a back-and-forth lasso
      [n(0, 0), n(50, 0), n(100, 0), n(50, 0)],
    ]
    for (const nodes of cases) {
      expect(() => applyCommand(base(), { type: 'addRing', nodes })).toThrow(
        InvalidCommandError,
      )
      expect(() =>
        applyCommand(base(), { type: 'subtractRing', nodes }),
      ).toThrow(InvalidCommandError)
    }
  })

  // AC-14
  it('should_reject_out_of_range_feather_band_and_strokes', () => {
    const bad: Command[] = [
      { type: 'setFeather', px: -0.1 },
      { type: 'setFeather', px: 3.1 },
      { type: 'setFeather', px: Number.NaN },
      { type: 'setSoftEdge', softEdge: { source: 'model', bandPx: 1.9 } },
      { type: 'setSoftEdge', softEdge: { source: 'guided', bandPx: 20.1 } },
      { type: 'addStroke', stroke: { ...stroke, sizePx: 0 } },
      { type: 'addStroke', stroke: { ...stroke, hardness: 1.1 } },
      { type: 'addStroke', stroke: { ...stroke, hardness: -0.1 } },
      { type: 'addStroke', stroke: { ...stroke, points: [] } },
      {
        type: 'addStroke',
        stroke: { ...stroke, points: [{ x: 0, y: Infinity }] },
      },
    ]
    for (const command of bad) {
      expect(() => applyCommand(base(), command)).toThrow(InvalidCommandError)
    }
    const good: Command[] = [
      { type: 'setFeather', px: 0.5 },
      { type: 'setFeather', px: 3 },
      { type: 'setSoftEdge', softEdge: { source: 'model', bandPx: 2 } },
      { type: 'setSoftEdge', softEdge: { source: 'model', bandPx: 20 } },
      { type: 'addStroke', stroke: { ...stroke, hardness: 1 } },
      { type: 'addStroke', stroke: { ...stroke, hardness: 0 } },
    ]
    for (const command of good) {
      expect(() => applyCommand(base(), command)).not.toThrow()
    }
  })

  // Review Focus 2, AC-18 support
  it('should_return_the_same_selection_for_no_op_commands', () => {
    const sel = base()
    const noops: Command[] = [
      { type: 'moveNodes', refs: [], delta: { x: 1, y: 1 } },
      { type: 'nudge', refs: [{ ring: 0, node: 0 }], delta: { x: 0, y: 0 } },
      { type: 'moveNode', ring: 0, node: 1, to: { x: 10, y: 0 } },
      { type: 'setFeather', px: 0 },
      { type: 'setSoftEdge', softEdge: null },
    ]
    for (const command of noops) expect(applyCommand(sel, command)).toBe(sel)
  })
})
