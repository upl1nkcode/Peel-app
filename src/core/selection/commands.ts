import { isDegenerateRing } from '../geometry/polygon'
import type { Node, Point } from '../geometry/types'
import { resimplifyRing } from './density'
import { InvalidCommandError } from './errors'
import type {
  BrushStroke,
  Command,
  NodeRef,
  Ring,
  Selection,
  SoftEdge,
} from './types'

/** Limits shared by commands and the JSON parser (spec 0003). */
export const FEATHER_RANGE = [0, 3] as const
export const SOFT_EDGE_BAND_RANGE = [2, 20] as const
export const DENSITY_TOLERANCE_RANGE = [0.01, 8] as const
export const MIN_RING_NODES = 3

const NODE_KINDS: readonly string[] = ['corner', 'smooth']
const RING_OPS: readonly string[] = ['add', 'subtract']
const STROKE_MODES: readonly string[] = ['erase', 'restore']
const SOFT_EDGE_SOURCES: readonly string[] = ['model', 'guided']

const fail = (message: string): never => {
  throw new InvalidCommandError(message)
}

const inRange = (v: number, [lo, hi]: readonly [number, number]): boolean =>
  Number.isFinite(v) && v >= lo && v <= hi

/** A finite copy of a point; throws on NaN/Infinity. */
function copyPoint(p: Point, what: string): Point {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    fail(`${what} must be finite`)
  }
  return { x: p.x, y: p.y }
}

function copyNode(p: Node, what: string): Node {
  if (!NODE_KINDS.includes(p.kind)) fail(`${what}.kind is not corner/smooth`)
  return { ...copyPoint(p, what), kind: p.kind }
}

function checkIndex(i: number, length: number, what: string): number {
  if (!Number.isInteger(i) || i < 0 || i >= length) {
    fail(`${what} ${String(i)} is out of range (0..${String(length - 1)})`)
  }
  return i
}

function ringAt(sel: Selection, i: number): Ring {
  return sel.rings[checkIndex(i, sel.rings.length, 'ring')] as Ring
}

function checkRingNodes(nodes: readonly Node[]): Node[] {
  const copy = nodes.map((p, i) => copyNode(p, `nodes[${String(i)}]`))
  if (copy.length < MIN_RING_NODES || isDegenerateRing(copy)) {
    fail('a ring needs at least 3 dots that are not all on one line')
  }
  return copy
}

/** Validated copy of a brush stroke. */
export function checkStroke(stroke: BrushStroke): BrushStroke {
  if (!STROKE_MODES.includes(stroke.mode))
    fail('stroke.mode is not erase/restore')
  if (!Number.isFinite(stroke.sizePx) || stroke.sizePx <= 0) {
    fail('stroke.sizePx must be positive')
  }
  if (!inRange(stroke.hardness, [0, 1]))
    fail('stroke.hardness must be in [0, 1]')
  if (stroke.points.length === 0) fail('stroke.points must not be empty')
  return {
    mode: stroke.mode,
    sizePx: stroke.sizePx,
    hardness: stroke.hardness,
    points: stroke.points.map((p, i) =>
      copyPoint(p, `stroke.points[${String(i)}]`),
    ),
  }
}

function checkSoftEdge(softEdge: SoftEdge): SoftEdge {
  if (!SOFT_EDGE_SOURCES.includes(softEdge.source)) {
    fail('softEdge.source is not model/guided')
  }
  if (!inRange(softEdge.bandPx, SOFT_EDGE_BAND_RANGE)) {
    fail('softEdge.bandPx must be in [2, 20]')
  }
  return { source: softEdge.source, bandPx: softEdge.bandPx }
}

export function isRingOp(v: unknown): v is Ring['op'] {
  return typeof v === 'string' && RING_OPS.includes(v)
}

const withRing = (sel: Selection, i: number, ring: Ring | null): Selection => ({
  ...sel,
  rings:
    ring === null
      ? sel.rings.filter((_, j) => j !== i)
      : sel.rings.map((r, j) => (j === i ? ring : r)),
})

const withNodes = (
  sel: Selection,
  i: number,
  nodes: readonly Node[],
): Selection => withRing(sel, i, { op: ringAt(sel, i).op, nodes })

function moveNodes(
  sel: Selection,
  refs: readonly NodeRef[],
  delta: Point,
): Selection {
  const d = copyPoint(delta, 'delta')
  const byRing = new Map<number, Set<number>>()
  for (const ref of refs) {
    const ring = ringAt(sel, ref.ring)
    checkIndex(ref.node, ring.nodes.length, 'node')
    const set = byRing.get(ref.ring) ?? new Set<number>()
    set.add(ref.node)
    byRing.set(ref.ring, set)
  }
  if (byRing.size === 0 || (d.x === 0 && d.y === 0)) return sel
  let out = sel
  for (const [i, nodeSet] of byRing) {
    const nodes = ringAt(out, i).nodes.map((p, j) =>
      nodeSet.has(j) ? { x: p.x + d.x, y: p.y + d.y, kind: p.kind } : p,
    )
    out = withNodes(out, i, nodes)
  }
  return out
}

/**
 * Applies one edit command and returns a new selection; the input is never
 * mutated and untouched rings/strokes are shared. A command that changes
 * nothing returns the input itself. Throws `InvalidCommandError` (and changes
 * nothing) for out-of-range indices, non-finite numbers or invalid data.
 */
export function applyCommand(sel: Selection, command: Command): Selection {
  switch (command.type) {
    case 'moveNode': {
      const ring = ringAt(sel, command.ring)
      const i = checkIndex(command.node, ring.nodes.length, 'node')
      const to = copyPoint(command.to, 'to')
      const old = ring.nodes[i] as Node
      if (old.x === to.x && old.y === to.y) return sel
      return withNodes(
        sel,
        command.ring,
        ring.nodes.map((p, j) => (j === i ? { ...to, kind: p.kind } : p)),
      )
    }
    case 'moveNodes':
    case 'nudge':
      return moveNodes(sel, command.refs, command.delta)
    case 'insertNode': {
      const ring = ringAt(sel, command.ring)
      const after = checkIndex(
        command.afterNode,
        ring.nodes.length,
        'afterNode',
      )
      const node = copyNode(
        { ...command.point, kind: command.kind ?? 'smooth' },
        'point',
      )
      const nodes = [...ring.nodes]
      nodes.splice(after + 1, 0, node)
      return withNodes(sel, command.ring, nodes)
    }
    case 'deleteNode': {
      const ring = ringAt(sel, command.ring)
      const i = checkIndex(command.node, ring.nodes.length, 'node')
      const nodes = ring.nodes.filter((_, j) => j !== i)
      return nodes.length < MIN_RING_NODES
        ? withRing(sel, command.ring, null)
        : withNodes(sel, command.ring, nodes)
    }
    case 'toggleKind': {
      const ring = ringAt(sel, command.ring)
      const i = checkIndex(command.node, ring.nodes.length, 'node')
      return withNodes(
        sel,
        command.ring,
        ring.nodes.map((p, j) =>
          j === i
            ? {
                x: p.x,
                y: p.y,
                kind: p.kind === 'corner' ? 'smooth' : 'corner',
              }
            : p,
        ),
      )
    }
    case 'addRing':
    case 'subtractRing': {
      const ring: Ring = {
        op: command.type === 'addRing' ? 'add' : 'subtract',
        nodes: checkRingNodes(command.nodes),
      }
      return { ...sel, rings: [...sel.rings, ring] }
    }
    case 'setDensity': {
      const ring = ringAt(sel, command.ring)
      if (!inRange(command.tolerancePx, DENSITY_TOLERANCE_RANGE)) {
        fail('density tolerance must be in [0.01, 8] px')
      }
      const nodes = resimplifyRing(ring.nodes, command.tolerancePx)
      const same =
        nodes.length === ring.nodes.length &&
        nodes.every((p, i) => {
          const q = ring.nodes[i] as Node
          return p.x === q.x && p.y === q.y && p.kind === q.kind
        })
      return same ? sel : withNodes(sel, command.ring, nodes)
    }
    case 'addStroke':
      return { ...sel, strokes: [...sel.strokes, checkStroke(command.stroke)] }
    case 'setFeather': {
      if (!inRange(command.px, FEATHER_RANGE)) fail('feather must be in [0, 3]')
      return command.px === sel.feather ? sel : { ...sel, feather: command.px }
    }
    case 'setSoftEdge': {
      if (command.softEdge === null) {
        if (sel.softEdge === undefined) return sel
        const rest = { ...sel }
        delete rest.softEdge
        return rest
      }
      return { ...sel, softEdge: checkSoftEdge(command.softEdge) }
    }
  }
}
