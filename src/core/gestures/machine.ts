import type { Point } from '../geometry/types'
import type { GestureAction, GestureMachine, PointerEventIn } from './types'

/**
 * idle     — no pointers down
 * tool     — one pointer drawing
 * view     — two pointers pinching/panning
 * ignoring — a view gesture ended or a stroke was cancelled; wait until all pointers are up
 */
type State =
  | { kind: 'idle' }
  | { kind: 'tool'; id: number }
  | { kind: 'view'; ids: readonly [number, number] }
  | { kind: 'ignoring' }

/**
 * Turns touch pointer events into tool or view actions. One finger draws;
 * a second finger cancels the stroke and starts pinch/pan. After a view
 * gesture no stroke starts until every finger has lifted.
 */
export function createGestureMachine(): GestureMachine {
  const pointers = new Map<number, Point>()
  let state: State = { kind: 'idle' }

  const pointOf = (id: number): Point => pointers.get(id) ?? { x: 0, y: 0 }

  const viewPoints = (ids: readonly [number, number]): [Point, Point] => [
    pointOf(ids[0]),
    pointOf(ids[1]),
  ]

  const down = (id: number, point: Point): GestureAction[] => {
    if (pointers.has(id)) return []
    pointers.set(id, point)
    switch (state.kind) {
      case 'idle':
        state = { kind: 'tool', id }
        return [{ type: 'toolStart', point }]
      case 'tool': {
        const ids = [state.id, id] as const
        const toolPt = pointOf(state.id)
        state = { kind: 'view', ids }
        return [
          { type: 'toolCancel', point: toolPt },
          { type: 'viewStart', points: viewPoints(ids) },
        ]
      }
      case 'view':
      case 'ignoring':
        return []
    }
  }

  const move = (id: number, point: Point): GestureAction[] => {
    if (!pointers.has(id)) return []
    pointers.set(id, point)
    if (state.kind === 'tool' && state.id === id) {
      return [{ type: 'toolMove', point }]
    }
    if (state.kind === 'view' && state.ids.includes(id)) {
      return [{ type: 'viewUpdate', points: viewPoints(state.ids) }]
    }
    return []
  }

  const lift = (
    id: number,
    point: Point,
    cancelled: boolean,
  ): GestureAction[] => {
    if (!pointers.has(id)) return []
    pointers.set(id, point)
    let actions: GestureAction[] = []
    if (state.kind === 'tool' && state.id === id) {
      actions = [{ type: cancelled ? 'toolCancel' : 'toolEnd', point }]
      state = { kind: 'ignoring' }
    } else if (state.kind === 'view' && state.ids.includes(id)) {
      actions = [{ type: 'viewEnd', points: viewPoints(state.ids) }]
      state = { kind: 'ignoring' }
    }
    pointers.delete(id)
    if (pointers.size === 0) state = { kind: 'idle' }
    return actions
  }

  return {
    dispatch(event: PointerEventIn): GestureAction[] {
      switch (event.type) {
        case 'down':
          return down(event.pointerId, event.point)
        case 'move':
          return move(event.pointerId, event.point)
        case 'up':
          return lift(event.pointerId, event.point, false)
        case 'cancel':
          return lift(event.pointerId, event.point, true)
      }
    },
    reset(): void {
      pointers.clear()
      state = { kind: 'idle' }
    },
  }
}
