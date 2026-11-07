import { describe, expect, it } from 'vitest'
import {
  createPressSequencer,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP_PX,
  type PressSequencer,
} from './sequence'

const start = (s: PressSequencer, x: number, y: number, t: number) =>
  s.input({ type: 'toolStart', point: { x, y } }, t)
const move = (s: PressSequencer, x: number, y: number, t: number) =>
  s.input({ type: 'toolMove', point: { x, y } }, t)
const end = (s: PressSequencer, x: number, y: number, t: number) =>
  s.input({ type: 'toolEnd', point: { x, y } }, t)
const cancel = (s: PressSequencer, x: number, y: number, t: number) =>
  s.input({ type: 'toolCancel', point: { x, y } }, t)

const tapAt = (x: number, y: number) => ({
  type: 'tap',
  canvasPt: { x, y },
})

describe('press sequencer', () => {
  it('should_wait_250_ms_before_a_tap (AC-4)', () => {
    expect(DOUBLE_TAP_MS).toBe(250)
    const s = createPressSequencer()
    expect(start(s, 10, 10, 0)).toEqual([])
    expect(end(s, 10, 10, 80)).toEqual([])
    expect(s.deadline).toBe(330)
    expect(s.poll(329)).toEqual([])
    expect(s.poll(330)).toEqual([tapAt(10, 10)])
    expect(s.poll(400)).toEqual([])
    expect(s.deadline).toBeNull()
  })

  it('should_turn_two_taps_into_a_double_tap (AC-3)', () => {
    expect(DOUBLE_TAP_SLOP_PX).toBe(24)
    const s = createPressSequencer()
    start(s, 10, 10, 0)
    end(s, 10, 10, 80)
    expect(start(s, 20, 25, 300)).toEqual([])
    expect(end(s, 20, 25, 360)).toEqual([
      { type: 'doubleTap', canvasPt: { x: 20, y: 25 } },
    ])
    expect(s.deadline).toBeNull()
    expect(s.poll(2000)).toEqual([])

    // Too late: the first tap has already fired, and the second waits on its own.
    const late = createPressSequencer()
    start(late, 10, 10, 0)
    end(late, 10, 10, 80)
    expect(late.poll(331)).toEqual([tapAt(10, 10)])
    expect(start(late, 12, 10, 331)).toEqual([])
    expect(end(late, 12, 10, 380)).toEqual([])
    expect(late.deadline).toBe(630)

    // Too far: 25 px away flushes the first tap at once.
    const far = createPressSequencer()
    start(far, 10, 10, 0)
    end(far, 10, 10, 80)
    expect(start(far, 35, 10, 200)).toEqual([tapAt(10, 10)])
  })

  it('should_hold_the_first_tap_while_the_second_is_down (AC-3)', () => {
    const s = createPressSequencer()
    start(s, 10, 10, 0)
    end(s, 10, 10, 80)
    start(s, 12, 12, 300)
    expect(s.deadline).toBeNull()
    expect(s.poll(400)).toEqual([])
    expect(end(s, 12, 12, 900)).toEqual([
      tapAt(10, 10),
      { type: 'longPress', canvasPt: { x: 12, y: 12 } },
    ])
    expect(s.poll(2000)).toEqual([])
  })

  it('should_aim_after_10_px (AC-13, AC-16)', () => {
    const s = createPressSequencer()
    start(s, 100, 100, 0)
    expect(move(s, 106, 100, 10)).toEqual([])
    expect(move(s, 111, 100, 20)).toEqual([
      { type: 'aimStart', canvasPt: { x: 111, y: 100 } },
    ])
    expect(move(s, 104, 100, 30)).toEqual([
      { type: 'aimMove', canvasPt: { x: 104, y: 100 } },
    ])
    expect(end(s, 103, 100, 900)).toEqual([
      { type: 'aimEnd', canvasPt: { x: 103, y: 100 } },
    ])
    expect(s.deadline).toBeNull()
    expect(s.poll(2000)).toEqual([])
  })

  it('should_flush_a_waiting_tap_before_an_aim_near_it (AC-3, AC-16)', () => {
    const s = createPressSequencer()
    start(s, 10, 10, 0)
    end(s, 10, 10, 80)
    start(s, 12, 10, 200)
    expect(move(s, 40, 10, 220)).toEqual([
      tapAt(10, 10),
      { type: 'aimStart', canvasPt: { x: 40, y: 10 } },
    ])
  })

  it('should_aim_when_a_press_lifts_far_without_moves (AC-16)', () => {
    const s = createPressSequencer()
    start(s, 0, 0, 0)
    expect(end(s, 30, 0, 50)).toEqual([
      { type: 'aimStart', canvasPt: { x: 30, y: 0 } },
      { type: 'aimEnd', canvasPt: { x: 30, y: 0 } },
    ])
  })

  it('should_emit_a_long_press_on_lift (AC-16)', () => {
    const s = createPressSequencer()
    start(s, 50, 50, 0)
    expect(s.poll(700)).toEqual([])
    expect(end(s, 55, 50, 600)).toEqual([
      { type: 'longPress', canvasPt: { x: 50, y: 50 } },
    ])
  })

  it('should_cancel_on_a_second_finger (AC-2, AC-15)', () => {
    const s = createPressSequencer()
    start(s, 100, 100, 0)
    move(s, 130, 100, 10)
    expect(cancel(s, 130, 100, 20)).toEqual([{ type: 'cancel' }])
    expect(end(s, 130, 100, 30)).toEqual([])
    expect(cancel(s, 130, 100, 40)).toEqual([])

    // A tap that was already waiting still fires.
    const waiting = createPressSequencer()
    start(waiting, 10, 10, 0)
    end(waiting, 10, 10, 80)
    start(waiting, 12, 10, 100)
    expect(cancel(waiting, 12, 10, 120)).toEqual([{ type: 'cancel' }])
    expect(waiting.deadline).toBe(330)
    expect(waiting.poll(330)).toEqual([tapAt(10, 10)])
  })

  it('should_ignore_view_actions (AC-1)', () => {
    const s = createPressSequencer()
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ] as const
    expect(s.input({ type: 'viewStart', points }, 0)).toEqual([])
    expect(s.input({ type: 'viewEnd', points }, 10)).toEqual([])
    expect(s.deadline).toBeNull()
  })

  it('should_drop_a_waiting_tap_on_reset (Review Focus 3)', () => {
    const s = createPressSequencer()
    start(s, 10, 10, 0)
    end(s, 10, 10, 80)
    s.reset()
    expect(s.deadline).toBeNull()
    expect(s.poll(1000)).toEqual([])
  })
})
