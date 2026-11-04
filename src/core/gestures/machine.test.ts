import { describe, expect, it } from 'vitest'

import { createGestureMachine } from './machine'
import type { GestureAction, PointerEventIn } from './types'

type Kind = PointerEventIn['type']

const ev = (type: Kind, pointerId: number, x = 0, y = 0): PointerEventIn => ({
  type,
  pointerId,
  point: { x, y },
})

const feed = (
  m: ReturnType<typeof createGestureMachine>,
  events: readonly PointerEventIn[],
): GestureAction[] => events.flatMap((e) => m.dispatch(e))

const types = (actions: readonly GestureAction[]): string[] =>
  actions.map((a) => a.type)

const isTool = (t: string) => t.startsWith('tool')

const permutations = <T>(xs: readonly T[]): T[][] =>
  xs.length <= 1
    ? [[...xs]]
    : xs.flatMap((x, i) =>
        permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [
          x,
          ...rest,
        ]),
      )

/** Every assignment of 'up' | 'cancel' to n lifts. */
const liftKinds = (n: number): Kind[][] =>
  n === 0
    ? [[]]
    : liftKinds(n - 1).flatMap((rest) => [
        ['up', ...rest],
        ['cancel', ...rest],
      ])

/** A fresh one-finger stroke must work: proves the machine is idle with nothing tracked. */
const expectIdle = (m: ReturnType<typeof createGestureMachine>) => {
  expect(
    types(feed(m, [ev('down', 99), ev('move', 99, 1, 1), ev('up', 99, 1, 1)])),
  ).toEqual(['toolStart', 'toolMove', 'toolEnd'])
}

describe('gesture machine', () => {
  // AC-9
  it('should_emit_tool_start_move_end_for_one_pointer', () => {
    const m = createGestureMachine()
    const actions = feed(m, [
      ev('down', 1, 10, 10),
      ev('move', 1, 11, 10),
      ev('move', 1, 12, 10),
      ev('up', 1, 12, 10),
    ])
    expect(types(actions)).toEqual([
      'toolStart',
      'toolMove',
      'toolMove',
      'toolEnd',
    ])
    expect(actions[0]).toEqual({ type: 'toolStart', point: { x: 10, y: 10 } })
    expect(actions[2]).toEqual({ type: 'toolMove', point: { x: 12, y: 10 } })
  })

  // AC-10
  it('should_cancel_the_tool_once_then_start_the_view_when_a_second_pointer_lands', () => {
    const m = createGestureMachine()
    feed(m, [ev('down', 1, 10, 10), ev('move', 1, 20, 10)])
    const actions = m.dispatch(ev('down', 2, 50, 50))
    expect(actions).toEqual([
      { type: 'toolCancel', point: { x: 20, y: 10 } },
      {
        type: 'viewStart',
        points: [
          { x: 20, y: 10 },
          { x: 50, y: 50 },
        ],
      },
    ])
  })

  // AC-11
  it('should_emit_only_view_updates_while_two_pointers_move', () => {
    const m = createGestureMachine()
    feed(m, [ev('down', 1), ev('down', 2, 10, 10)])
    const actions = feed(m, [
      ev('move', 1, 1, 1),
      ev('move', 2, 12, 12),
      ev('move', 1, 2, 2),
    ])
    expect(types(actions)).toEqual(['viewUpdate', 'viewUpdate', 'viewUpdate'])
    expect(actions[2]).toEqual({
      type: 'viewUpdate',
      points: [
        { x: 2, y: 2 },
        { x: 12, y: 12 },
      ],
    })
  })

  // AC-12
  it('should_not_resume_a_stroke_after_one_of_two_pointers_lifts', () => {
    const m = createGestureMachine()
    feed(m, [ev('down', 1), ev('down', 2, 10, 10)])
    expect(types(m.dispatch(ev('up', 2, 10, 10)))).toEqual(['viewEnd'])
    const after = feed(m, [
      ev('move', 1, 5, 5),
      ev('move', 1, 6, 6),
      ev('down', 3, 7, 7),
      ev('move', 3, 8, 8),
      ev('up', 3, 8, 8),
      ev('up', 1, 6, 6),
    ])
    expect(after).toEqual([])
    expectIdle(m)
  })

  // AC-13
  it('should_never_emit_tool_actions_after_cancel_for_every_lift_order', () => {
    for (const n of [2, 3]) {
      const ids = [1, 2, 3].slice(0, n)
      for (const order of permutations(ids)) {
        for (const kinds of liftKinds(n)) {
          for (const movesBetween of [true, false]) {
            const m = createGestureMachine()
            const events: PointerEventIn[] = [
              ev('down', 1),
              ev('move', 1, 1, 1),
              ...ids.slice(1).map((id) => ev('down', id, id * 10, id * 10)),
              ...ids.map((id) => ev('move', id, id * 11, id * 11)),
            ]
            order.forEach((id, i) => {
              events.push(ev(kinds[i] ?? 'up', id))
              // movesBetween=false models a simultaneous lift
              if (movesBetween) {
                for (const other of order.slice(i + 1)) {
                  events.push(ev('move', other, 3, 3))
                }
              }
            })
            const t = types(feed(m, events))
            const cancelAt = t.indexOf('toolCancel')
            expect(cancelAt).toBeGreaterThanOrEqual(0)
            expect(t.filter((x) => x === 'toolCancel')).toHaveLength(1)
            expect(t.slice(cancelAt + 1).some(isTool)).toBe(false)
            expect(t.filter((x) => x === 'viewEnd')).toHaveLength(1)
            expectIdle(m)
          }
        }
      }
    }
  })

  // AC-13
  it('should_ignore_a_third_pointer_while_two_are_active', () => {
    const m = createGestureMachine()
    feed(m, [ev('down', 1), ev('down', 2, 10, 10)])
    expect(m.dispatch(ev('down', 3, 50, 50))).toEqual([])
    expect(m.dispatch(ev('move', 3, 60, 60))).toEqual([])
    expect(m.dispatch(ev('up', 3, 60, 60))).toEqual([])
    // the view gesture is unaffected
    expect(types(m.dispatch(ev('move', 2, 11, 11)))).toEqual(['viewUpdate'])
  })

  // AC-14
  it('should_ignore_unknown_pointer_ids', () => {
    const m = createGestureMachine()
    expect(feed(m, [ev('move', 7), ev('up', 7), ev('cancel', 7)])).toEqual([])
    feed(m, [ev('down', 1)])
    expect(feed(m, [ev('move', 8), ev('up', 8)])).toEqual([])
    expect(types(m.dispatch(ev('up', 1)))).toEqual(['toolEnd'])
  })

  // AC-21
  it('should_handle_cancel_for_one_of_two_pointers_and_duplicate_down', () => {
    const m = createGestureMachine()
    // duplicate down while drawing: ignored, stroke continues
    feed(m, [ev('down', 1)])
    expect(m.dispatch(ev('down', 1, 5, 5))).toEqual([])
    expect(types(m.dispatch(ev('move', 1, 6, 6)))).toEqual(['toolMove'])

    // second finger, then cancel of one of the two
    feed(m, [ev('down', 2, 20, 20)])
    expect(m.dispatch(ev('down', 2, 21, 21))).toEqual([])
    const t = types(
      feed(m, [ev('cancel', 1), ev('move', 2, 30, 30), ev('up', 2)]),
    )
    expect(t).toEqual(['viewEnd'])
    expectIdle(m)
  })

  it('should_cancel_a_stroke_whose_pointer_is_cancelled (AC-21)', () => {
    const m = createGestureMachine()
    const t = types(
      feed(m, [ev('down', 1), ev('move', 1, 2, 2), ev('cancel', 1)]),
    )
    expect(t).toEqual(['toolStart', 'toolMove', 'toolCancel'])
    expectIdle(m)
  })

  it('should_forget_everything_on_reset', () => {
    const m = createGestureMachine()
    feed(m, [ev('down', 1), ev('down', 2)])
    m.reset()
    expect(m.dispatch(ev('move', 1))).toEqual([])
    expectIdle(m)
  })
})
