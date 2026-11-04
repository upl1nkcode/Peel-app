import type { Point } from '../geometry/types'

/** A touch pointer event, already in canvas space (the DOM adapter lives in ui/). */
export interface PointerEventIn {
  type: 'down' | 'move' | 'up' | 'cancel'
  pointerId: number
  point: Point
}

export type GestureAction =
  | { type: 'toolStart' | 'toolMove' | 'toolEnd' | 'toolCancel'; point: Point }
  | {
      type: 'viewStart' | 'viewUpdate' | 'viewEnd'
      points: readonly [Point, Point]
    }

export interface GestureMachine {
  dispatch(event: PointerEventIn): GestureAction[]
  reset(): void
}
