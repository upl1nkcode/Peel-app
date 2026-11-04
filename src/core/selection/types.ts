import type { Node, Point } from '../geometry/types'

/**
 * One closed outline of dots. Rings are composed in order: `add` is a union
 * with everything before it, `subtract` a difference. Direction (cw/ccw) does
 * not matter. Coordinates are image px floats, stored exactly as given.
 */
export interface Ring {
  op: 'add' | 'subtract'
  nodes: readonly Node[]
}

/** Erase/restore brush stroke on the raster mask; sizes in image px. */
export interface BrushStroke {
  mode: 'erase' | 'restore'
  /** Brush diameter in image px (> 0). */
  sizePx: number
  /** 0 = fully soft, 1 = hard edge. */
  hardness: number
  points: readonly Point[]
}

/** Edge refinement in a band along the outline (2–20 px). */
export interface SoftEdge {
  source: 'model' | 'guided'
  bandPx: number
}

/** The one shared, immutable selection every crop mode edits. */
export interface Selection {
  rings: readonly Ring[]
  softEdge?: SoftEdge
  strokes: readonly BrushStroke[]
  /** Global edge softness, 0–3 px. */
  feather: number
}

export interface NodeRef {
  ring: number
  node: number
}

/** Plain-data edit commands, applied by `applyCommand`. Indices refer to rings and nodes. */
export type Command =
  | { type: 'moveNode'; ring: number; node: number; to: Point }
  | { type: 'moveNodes' | 'nudge'; refs: readonly NodeRef[]; delta: Point }
  | {
      type: 'insertNode'
      ring: number
      afterNode: number
      point: Point
      kind?: Node['kind']
    }
  | { type: 'deleteNode' | 'toggleKind'; ring: number; node: number }
  | { type: 'addRing' | 'subtractRing'; nodes: readonly Node[] }
  | { type: 'setDensity'; ring: number; tolerancePx: number }
  | { type: 'addStroke'; stroke: BrushStroke }
  | { type: 'setFeather'; px: number }
  | { type: 'setSoftEdge'; softEdge: SoftEdge | null }
