import { applyCommand } from '../selection/commands'
import type { Command, Selection } from '../selection/types'

/** About 12 MB of nodes/stroke points held only for undo (spec 0003 AC-19). */
export const DEFAULT_HISTORY_MAX_POINTS = 250_000

export interface History {
  readonly current: Selection
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** Applies the command and records a step; throws (recording nothing) if it is invalid. */
  execute(command: Command): Selection
  undo(): Selection
  redo(): Selection
  /** Starts over at `initial` with nothing to undo or redo (a new photo). */
  reset(initial: Selection): void
}

/**
 * Points in `older`'s rings and strokes that `newer` no longer shares: the
 * memory history keeps only so it can undo. Shared objects are free.
 */
function retainedPoints(older: Selection, newer: Selection): number {
  const live = new Set<object>([...newer.rings, ...newer.strokes])
  let points = 0
  for (const ring of older.rings)
    if (!live.has(ring)) points += ring.nodes.length
  for (const stroke of older.strokes) {
    if (!live.has(stroke)) points += stroke.points.length
  }
  return points
}

/**
 * Undo/redo over immutable selection snapshots. Undo and redo move an index
 * (O(1), exact, no replay). When the points held for undo exceed `maxPoints`,
 * the oldest steps are dropped; the newest undo step is always kept.
 */
export function createHistory(
  initial: Selection,
  options: { maxPoints?: number } = {},
): History {
  const maxPoints = options.maxPoints ?? DEFAULT_HISTORY_MAX_POINTS
  const states: Selection[] = [initial]
  /** back[k] = retainedPoints(states[k], states[k + 1]) */
  const back: number[] = []
  let index = 0

  const at = (i: number): Selection => states[i] as Selection

  return {
    get current() {
      return at(index)
    },
    get canUndo() {
      return index > 0
    },
    get canRedo() {
      return index < states.length - 1
    },
    execute(command) {
      const prev = at(index)
      const next = applyCommand(prev, command)
      if (next === prev) return prev
      states.length = index + 1
      back.length = index
      states.push(next)
      back.push(retainedPoints(prev, next))
      let total = back.reduce((a, b) => a + b, 0)
      while (total > maxPoints && states.length > 2) {
        states.shift()
        total -= back.shift() as number
      }
      index = states.length - 1
      return next
    },
    undo() {
      if (index > 0) index--
      return at(index)
    },
    redo() {
      if (index < states.length - 1) index++
      return at(index)
    },
    reset(initial) {
      states.length = 0
      states.push(initial)
      back.length = 0
      index = 0
    },
  }
}
