import type { Node, Point, Size } from '../geometry/types'
import { FEATHER_RANGE, MIN_RING_NODES, SOFT_EDGE_BAND_RANGE } from './commands'
import {
  InvalidSelectionError,
  UnsupportedSelectionVersionError,
} from './errors'
import type { BrushStroke, Ring, Selection, SoftEdge } from './types'

export const SELECTION_FORMAT_VERSION = 1

const fail = (path: string, reason: string): never => {
  throw new InvalidSelectionError(`${path}: ${reason}`)
}

const isPositiveInt = (v: number): boolean => Number.isInteger(v) && v > 0

/**
 * Selection JSON, version 1 (spec 0003 "Data"). JSON numbers round-trip
 * bit-exact, except that -0 is written as 0: the sign of zero carries no
 * geometry, so it is normalised rather than preserved.
 */
export function serializeSelection(
  selection: Selection,
  imageSize: Size,
): string {
  if (!isPositiveInt(imageSize.width) || !isPositiveInt(imageSize.height)) {
    fail('imageSize', 'width and height must be positive integers')
  }
  const sel: Record<string, unknown> = {
    rings: selection.rings,
    strokes: selection.strokes,
    feather: selection.feather,
  }
  if (selection.softEdge !== undefined) sel.softEdge = selection.softEdge
  return JSON.stringify({
    version: SELECTION_FORMAT_VERSION,
    imageSize: { width: imageSize.width, height: imageSize.height },
    selection: sel,
  })
}

type Obj = Record<string, unknown>

function readObject(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    fail(path, 'must be an object')
  }
  return v as Obj
}

function readArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'must be an array')
  return v as unknown[]
}

function readNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail(path, 'must be a finite number')
  }
  return v as number
}

function readRange(
  v: unknown,
  [lo, hi]: readonly [number, number],
  path: string,
): number {
  const x = readNumber(v, path)
  if (x < lo || x > hi) fail(path, `must be in [${String(lo)}, ${String(hi)}]`)
  return x
}

function readEnum<T extends string>(
  v: unknown,
  values: readonly T[],
  path: string,
): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
    fail(path, `must be one of ${values.join(', ')}`)
  }
  return v as T
}

function readPoint(v: unknown, path: string): Point {
  const o = readObject(v, path)
  return { x: readNumber(o.x, `${path}.x`), y: readNumber(o.y, `${path}.y`) }
}

function readRing(v: unknown, path: string): Ring {
  const o = readObject(v, path)
  const op = readEnum(o.op, ['add', 'subtract'] as const, `${path}.op`)
  const nodes: Node[] = readArray(o.nodes, `${path}.nodes`).map((n, i) => {
    const at = `${path}.nodes[${String(i)}]`
    const p = readPoint(n, at)
    const kind = readEnum(
      (n as Obj).kind,
      ['corner', 'smooth'] as const,
      `${at}.kind`,
    )
    return { x: p.x, y: p.y, kind }
  })
  // Collinear rings are accepted: moving or deleting dots can make one, and
  // every selection the commands can reach must reopen (AC-26).
  if (nodes.length < MIN_RING_NODES) {
    fail(`${path}.nodes`, 'a ring needs at least 3 dots')
  }
  return { op, nodes }
}

function readStroke(v: unknown, path: string): BrushStroke {
  const o = readObject(v, path)
  const mode = readEnum(o.mode, ['erase', 'restore'] as const, `${path}.mode`)
  const sizePx = readNumber(o.sizePx, `${path}.sizePx`)
  if (sizePx <= 0) fail(`${path}.sizePx`, 'must be positive')
  const hardness = readRange(o.hardness, [0, 1], `${path}.hardness`)
  const points = readArray(o.points, `${path}.points`).map((p, i) =>
    readPoint(p, `${path}.points[${String(i)}]`),
  )
  if (points.length === 0) fail(`${path}.points`, 'must not be empty')
  return { mode, sizePx, hardness, points }
}

function readSoftEdge(v: unknown, path: string): SoftEdge {
  const o = readObject(v, path)
  return {
    source: readEnum(o.source, ['model', 'guided'] as const, `${path}.source`),
    bandPx: readRange(o.bandPx, SOFT_EDGE_BAND_RANGE, `${path}.bandPx`),
  }
}

function readSize(v: unknown, path: string): Size {
  const o = readObject(v, path)
  const side = (key: 'width' | 'height'): number => {
    const x = readNumber(o[key], `${path}.${key}`)
    if (!isPositiveInt(x)) fail(`${path}.${key}`, 'must be a positive integer')
    return x
  }
  return { width: side('width'), height: side('height') }
}

/**
 * Parses selection JSON. The version is checked first. Throws
 * `UnsupportedSelectionVersionError` for any version other than 1 and
 * `InvalidSelectionError` (naming the field path) for anything malformed;
 * never returns a partial selection. Unknown extra fields are ignored.
 */
export function parseSelection(json: string): {
  selection: Selection
  imageSize: Size
} {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    fail('$', 'not valid JSON')
  }
  const doc = readObject(raw, '$')
  if (doc.version !== SELECTION_FORMAT_VERSION) {
    throw new UnsupportedSelectionVersionError(doc.version)
  }
  const imageSize = readSize(doc.imageSize, 'imageSize')
  const s = readObject(doc.selection, 'selection')
  const selection: Selection = {
    rings: readArray(s.rings, 'selection.rings').map((r, i) =>
      readRing(r, `selection.rings[${String(i)}]`),
    ),
    strokes: readArray(s.strokes, 'selection.strokes').map((t, i) =>
      readStroke(t, `selection.strokes[${String(i)}]`),
    ),
    feather: readRange(s.feather, FEATHER_RANGE, 'selection.feather'),
  }
  if ('softEdge' in s) {
    return {
      selection: {
        ...selection,
        softEdge: readSoftEdge(s.softEdge, 'selection.softEdge'),
      },
      imageSize,
    }
  }
  return { selection, imageSize }
}
