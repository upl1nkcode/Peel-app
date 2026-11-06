import { describe, expect, it } from 'vitest'

import type { Node } from '../geometry/types'
import { applyCommand } from '../selection/commands'
import { InvalidCommandError } from '../selection/errors'
import { emptySelection } from '../selection/model'
import type { Command, Selection } from '../selection/types'
import { createHistory, DEFAULT_HISTORY_MAX_POINTS } from './history'

const n = (x: number, y: number, kind: Node['kind'] = 'smooth'): Node => ({
  x,
  y,
  kind,
})
const circle = (count: number, r = 100): Node[] =>
  Array.from({ length: count }, (_, i) =>
    n(
      r * Math.cos((i / count) * 2 * Math.PI),
      r * Math.sin((i / count) * 2 * Math.PI),
    ),
  )
const square = [
  n(0, 0, 'corner'),
  n(10, 0, 'corner'),
  n(10, 10, 'corner'),
  n(0, 10, 'corner'),
]

const start = (): Selection =>
  applyCommand(
    applyCommand(emptySelection(), { type: 'addRing', nodes: square }),
    { type: 'subtractRing', nodes: circle(8, 3) },
  )

describe('history', () => {
  it('should_default_to_a_250000_point_cap (AC-19)', () => {
    expect(DEFAULT_HISTORY_MAX_POINTS).toBe(250_000)
  })

  // AC-15
  it.each<Command>([
    { type: 'moveNode', ring: 0, node: 0, to: { x: 1, y: 1 } },
    {
      type: 'moveNodes',
      refs: [
        { ring: 0, node: 1 },
        { ring: 1, node: 0 },
      ],
      delta: { x: 1, y: 2 },
    },
    { type: 'nudge', refs: [{ ring: 0, node: 2 }], delta: { x: -1, y: 0 } },
    { type: 'insertNode', ring: 0, afterNode: 3, point: { x: 0, y: 5 } },
    { type: 'deleteNode', ring: 1, node: 0 },
    { type: 'toggleKind', ring: 0, node: 0 },
    { type: 'addRing', nodes: circle(5, 50) },
    { type: 'subtractRing', nodes: circle(6, 2) },
    {
      type: 'addStroke',
      stroke: {
        mode: 'restore',
        sizePx: 4,
        hardness: 0.5,
        points: [{ x: 1, y: 1 }],
      },
    },
    { type: 'setFeather', px: 1.25 },
    { type: 'setSoftEdge', softEdge: { source: 'model', bandPx: 8 } },
    { type: 'setDensity', ring: 1, tolerancePx: 0.05 },
  ])(
    'should_round_trip_every_command_type_through_undo_and_redo ($type)',
    (command) => {
      const initial = start()
      const history = createHistory(initial)
      const applied = history.execute(command)
      expect(applied).not.toBe(initial) // every row is a real change
      expect(applied).toEqual(applyCommand(initial, command))
      expect(history.undo()).toEqual(initial)
      expect(history.current).toEqual(initial)
      expect(history.redo()).toEqual(applied)
    },
  )

  // AC-16
  it('should_undo_and_redo_a_sequence', () => {
    const history = createHistory(start())
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    const states = [history.current]
    for (let i = 0; i < 5; i++) {
      states.push(
        history.execute({
          type: 'moveNode',
          ring: 0,
          node: i % 4,
          to: { x: i + 0.5, y: -i },
        }),
      )
    }
    for (let i = 4; i >= 0; i--) expect(history.undo()).toEqual(states[i])
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
    expect(history.undo()).toEqual(states[0]) // at the start: unchanged
    for (let i = 1; i <= 5; i++) expect(history.redo()).toEqual(states[i])
    expect(history.canRedo).toBe(false)
    expect(history.canUndo).toBe(true)
    expect(history.redo()).toEqual(states[5]) // at the end: unchanged
  })

  // AC-17
  it('should_discard_the_redo_branch_on_a_new_command', () => {
    const history = createHistory(start())
    history.execute({ type: 'setFeather', px: 1 })
    history.execute({ type: 'setFeather', px: 2 })
    history.undo()
    expect(history.canRedo).toBe(true)
    const branched = history.execute({ type: 'setFeather', px: 3 })
    expect(history.canRedo).toBe(false)
    expect(history.redo()).toBe(branched)
    expect(history.undo().feather).toBe(1)
  })

  // AC-18
  it('should_ignore_throwing_and_no_op_commands', () => {
    const history = createHistory(start())
    history.execute({ type: 'setFeather', px: 1 })
    history.execute({ type: 'setFeather', px: 2 })
    history.undo()
    const before = history.current
    expect(() =>
      history.execute({ type: 'deleteNode', ring: 9, node: 0 }),
    ).toThrow(InvalidCommandError)
    expect(history.current).toBe(before)
    expect(history.canRedo).toBe(true) // the failed command did not discard redo

    const noop = history.execute({ type: 'setFeather', px: 1 })
    expect(noop).toBe(before)
    expect(history.canRedo).toBe(true)
    expect(history.undo().feather).toBe(0) // no extra step was recorded
  })

  // AC-19
  it('should_drop_the_oldest_steps_beyond_the_point_cap', () => {
    // each older state holds its own 30-node copy of the moved ring
    const ring30 = applyCommand(emptySelection(), {
      type: 'addRing',
      nodes: circle(30),
    })
    const history = createHistory(ring30, { maxPoints: 100 })
    const states = [history.current]
    for (let i = 0; i < 10; i++) {
      states.push(
        history.execute({
          type: 'moveNode',
          ring: 0,
          node: 0,
          to: { x: i, y: 0 },
        }),
      )
    }
    let undos = 0
    while (history.canUndo) {
      undos++
      expect(history.undo()).toBe(states[10 - undos])
    }
    expect(undos).toBe(3)

    // shared steps cost nothing: 10 added rings keep all 10 undo steps
    const adds = createHistory(emptySelection(), { maxPoints: 100 })
    for (let i = 0; i < 10; i++)
      adds.execute({ type: 'addRing', nodes: circle(30, 10 + i) })
    let addUndos = 0
    while (adds.canUndo) {
      adds.undo()
      addUndos++
    }
    expect(addUndos).toBe(10)
  })

  // Review Focus 3
  it('should_keep_a_single_step_larger_than_the_cap', () => {
    const history = createHistory(emptySelection(), { maxPoints: 1000 })
    const added = history.execute({
      type: 'addRing',
      nodes: circle(5000, 2000),
    })
    history.execute({ type: 'moveNode', ring: 0, node: 0, to: { x: 0, y: 0 } })
    expect(history.canUndo).toBe(true)
    expect(history.undo()).toBe(added)
  })

  // AC-20
  it('should_undo_and_redo_without_replaying', () => {
    const history = createHistory(start())
    const states = [history.current]
    for (let i = 0; i < 1000; i++) {
      states.push(
        history.execute({
          type: 'moveNode',
          ring: 0,
          node: i % 4,
          to: { x: i + 0.5, y: i / 2 },
        }),
      )
    }
    for (let i = 999; i >= 0; i--) expect(history.undo()).toBe(states[i])
    for (let i = 1; i <= 1000; i++) expect(history.redo()).toBe(states[i])
  })
})

describe('restore', () => {
  it('should_restore_a_selection_as_one_undoable_step (AC-14)', () => {
    const auto: Selection = {
      rings: [{ op: 'add', nodes: square }],
      softEdge: { source: 'model', bandPx: 8 },
      strokes: [],
      feather: 0,
    }
    const history = createHistory(emptySelection())
    history.execute({ type: 'addRing', nodes: circle(12) })
    const edited = history.current
    history.execute({ type: 'restore', selection: auto })
    expect(history.current).toEqual(auto)
    expect(history.undo()).toBe(edited)
    expect(history.redo()).toEqual(auto)
    const bad: Command = {
      type: 'restore',
      selection: { ...auto, rings: [{ op: 'add', nodes: square.slice(0, 2) }] },
    }
    const before = history.current
    expect(() => history.execute(bad)).toThrow(InvalidCommandError)
    expect(history.current).toBe(before)
    expect(history.canRedo).toBe(false)
  })
})
