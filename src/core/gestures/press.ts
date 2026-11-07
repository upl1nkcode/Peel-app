import type { Point } from '../geometry/types'

/** A press held this long or longer is a long-press (spec 0007 AC-25). */
export const LONG_PRESS_MS = 500
/** A press that moves farther than this (screen px) is neither a tap nor a long-press. */
export const PRESS_SLOP_PX = 10

export interface PressSample {
  screenPt: Point
  t: number
}

/** Tap (< 500 ms), long-press (≥ 500 ms), or neither when it moved more than 10 screen px. */
export function classifyPress(
  down: PressSample,
  up: PressSample,
): 'tap' | 'longPress' | null {
  const moved = Math.hypot(
    up.screenPt.x - down.screenPt.x,
    up.screenPt.y - down.screenPt.y,
  )
  if (!(moved <= PRESS_SLOP_PX)) return null
  return up.t - down.t >= LONG_PRESS_MS ? 'longPress' : 'tap'
}
