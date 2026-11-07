import type { Point } from '../geometry/types'
import { classifyPress, PRESS_SLOP_PX } from './press'
import type { GestureAction } from './types'

/** A second tap must go down within this long of the first lifting (spec 0009 AC-3). */
export const DOUBLE_TAP_MS = 250
/** …and within this far (canvas px) of where the first went down. */
export const DOUBLE_TAP_SLOP_PX = 24

export type PressIntent =
  | {
      type:
        'tap' | 'longPress' | 'doubleTap' | 'aimStart' | 'aimMove' | 'aimEnd'
      canvasPt: Point
    }
  | { type: 'cancel' }

export interface PressSequencer {
  /** Feeds one gesture-machine action at time `t` (ms); view actions are ignored. */
  input(action: GestureAction, t: number): PressIntent[]
  /** When the waiting tap fires if nothing else happens; null when none is due. */
  readonly deadline: number | null
  /** Emits the waiting tap once `t` has reached the deadline. */
  poll(t: number): PressIntent[]
  /** Drops everything, including a waiting tap (a new photo). */
  reset(): void
}

interface Press {
  downPt: Point
  downT: number
  aiming: boolean
  /** Went down near a waiting tap, before its deadline: a possible double-tap. */
  second: boolean
}

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Turns one finger's tool actions into taps, double-taps, long-presses and
 * aims (spec 0009 AC-2 to AC-4, AC-13, AC-16). A tap waits 250 ms for a
 * second one; the caller polls `deadline` (core has no timers).
 */
export function createPressSequencer(): PressSequencer {
  let waiting: { canvasPt: Point; deadline: number } | null = null
  let press: Press | null = null

  const flushWaiting = (): PressIntent[] => {
    if (!waiting) return []
    const out: PressIntent[] = [{ type: 'tap', canvasPt: waiting.canvasPt }]
    waiting = null
    return out
  }

  const startAim = (p: Press, at: Point): PressIntent[] => {
    p.aiming = true
    const out = p.second ? flushWaiting() : []
    p.second = false
    return [...out, { type: 'aimStart', canvasPt: at }]
  }

  const down = (at: Point, t: number): PressIntent[] => {
    let out: PressIntent[] = []
    const second =
      waiting !== null &&
      t <= waiting.deadline &&
      dist(at, waiting.canvasPt) <= DOUBLE_TAP_SLOP_PX
    if (!second) out = flushWaiting()
    press = { downPt: at, downT: t, aiming: false, second }
    return out
  }

  const moveTo = (at: Point): PressIntent[] => {
    if (!press) return []
    if (press.aiming) return [{ type: 'aimMove', canvasPt: at }]
    if (dist(at, press.downPt) > PRESS_SLOP_PX) return startAim(press, at)
    return []
  }

  const lift = (at: Point, t: number): PressIntent[] => {
    const p = press
    if (!p) return []
    press = null
    if (p.aiming) return [{ type: 'aimEnd', canvasPt: at }]
    const kind = classifyPress(
      { screenPt: p.downPt, t: p.downT },
      { screenPt: at, t },
    )
    if (kind === null) {
      return [...startAim(p, at), { type: 'aimEnd', canvasPt: at }]
    }
    if (kind === 'tap') {
      if (p.second) {
        waiting = null
        return [{ type: 'doubleTap', canvasPt: p.downPt }]
      }
      waiting = { canvasPt: p.downPt, deadline: t + DOUBLE_TAP_MS }
      return []
    }
    const out = p.second ? flushWaiting() : []
    return [...out, { type: 'longPress', canvasPt: p.downPt }]
  }

  return {
    input(action, t) {
      switch (action.type) {
        case 'toolStart':
          return down(action.point, t)
        case 'toolMove':
          return moveTo(action.point)
        case 'toolEnd':
          return lift(action.point, t)
        case 'toolCancel':
          if (!press) return []
          press = null
          return [{ type: 'cancel' }]
        default:
          return []
      }
    },
    get deadline() {
      if (!waiting || press?.second) return null
      return waiting.deadline
    },
    poll(t) {
      if (!waiting || press?.second || t < waiting.deadline) return []
      return flushWaiting()
    },
    reset() {
      waiting = null
      press = null
    },
  }
}
