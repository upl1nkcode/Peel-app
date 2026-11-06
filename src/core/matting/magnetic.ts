import { simplifyPath } from '../geometry/simplify'
import type { Point } from '../geometry/types'
import type { RgbaImage } from '../mask/types'
import { edgeMap, type EdgeMap, type Rect } from './edges'
import { liveWire, refineSubpixel } from './liveWire'

/** The line may snap to edges at most this far (screen points) from the finger (spec 0006 Decision 3). */
export const SNAP_REACH_PT = 12

/**
 * The search corridor is at least this wide (image px), so pixel centres
 * within it always connect (at 16× zoom, 12 pt is under 1 image px).
 */
const MIN_CORRIDOR_PX = 1.25
/** The corridor is drawn around the finger path simplified by this much, and shrunk by it. */
const CORRIDOR_SIMPLIFY_PX = 0.25

const hypot = (x: number, y: number) => Math.sqrt(x * x + y * y)

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

/**
 * Snaps a finger path (image px) onto the strongest image edges within
 * `reachPx` of it (spec 0006 AC-8 to AC-12). Anchors along the finger every
 * max(2 × reach, 8) px snap to the lowest-cost pixel within reach; live-wire
 * joins them inside the corridor around the finger between them, so the
 * result cannot cut across a U-turn. The joined path is then refined between
 * pixels.
 */
export function snapToEdges(
  image: RgbaImage,
  finger: readonly Point[],
  reachPx: number,
): Point[] {
  if (!(reachPx > 0) || !Number.isFinite(reachPx)) {
    throw new RangeError(
      `reach must be a positive number, got ${String(reachPx)}`,
    )
  }
  for (const p of finger) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new RangeError('finger points must be finite')
    }
  }
  if (finger.length === 0) return []
  const { width: W, height: H } = image
  // Points beyond the image are pulled onto its last pixels.
  const pts = finger.map((p) => ({
    x: Math.min(W - 1e-6, Math.max(0, p.x)),
    y: Math.min(H - 1e-6, Math.max(0, p.y)),
  }))
  const cum = [0]
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1] as Point
    const b = pts[k] as Point
    cum.push((cum[k - 1] as number) + hypot(b.x - a.x, b.y - a.y))
  }
  const total = cum[cum.length - 1] as number
  const corridor = Math.max(reachPx, MIN_CORRIDOR_PX)

  // Edges are needed only near the finger: the corridor plus the 2.5 px the
  // sub-pixel step samples beyond it (on the simplified finger, so grown by
  // the simplification too).
  const rect = grow(bounds(pts), corridor + 3, W, H)
  const near = new Uint8Array(rect.width * rect.height)
  const coarse = pts.length > 2 ? simplifyPath(pts, CORRIDOR_SIMPLIFY_PX) : pts
  markNear(near, rect, coarse, corridor + 2.5 + CORRIDOR_SIMPLIFY_PX)
  const map = edgeMap(image, rect, near)

  const step = Math.max(2 * reachPx, 8)
  const arcs = [0]
  if (total >= 1) {
    for (let s = step; s < total - step / 2; s += step) arcs.push(s)
    arcs.push(total)
  }

  const anchors = arcs.map((s) => snap(map, pointAt(pts, cum, s), reachPx))
  const path: Point[] = [anchors[0] as Point]
  for (let k = 1; k < arcs.length; k++) {
    const sub = subPolyline(pts, cum, arcs[k - 1] as number, arcs[k] as number)
    const segment = wireAlong(
      map,
      sub,
      corridor,
      anchors[k - 1] as Point,
      anchors[k] as Point,
    )
    path.push(...segment.slice(1))
  }
  return refineSubpixel(map, path)
}

/** The pixel centre of lowest cost within reach of q (ties: nearest q, then first); q's own pixel if none. */
function snap(map: EdgeMap, q: Point, reach: number): Point {
  const { x: rx, y: ry, width, height } = map.rect
  let best = -1
  let bestCost = Infinity
  let bestDist = Infinity
  const i0 = Math.max(0, Math.floor(q.x - reach - rx))
  const i1 = Math.min(width - 1, Math.floor(q.x + reach - rx))
  const j0 = Math.max(0, Math.floor(q.y - reach - ry))
  const j1 = Math.min(height - 1, Math.floor(q.y + reach - ry))
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = hypot(rx + i + 0.5 - q.x, ry + j + 0.5 - q.y)
      if (d > reach) continue
      const c = map.cost[j * width + i] as number
      if (c < bestCost || (c === bestCost && d < bestDist)) {
        best = j * width + i
        bestCost = c
        bestDist = d
      }
    }
  }
  if (best < 0) {
    return { x: Math.floor(q.x) + 0.5, y: Math.floor(q.y) + 0.5 }
  }
  const i = best % width
  return { x: rx + i + 0.5, y: ry + (best - i) / width + 0.5 }
}

/**
 * Live-wire from a to b over a sub-map around `sub`, allowed only where a
 * pixel centre is within `corridor` of the finger. The finger is simplified
 * by 0.25 px first and the corridor shrunk by as much, so no allowed pixel is
 * farther than `corridor` from the real finger path.
 */
function wireAlong(
  map: EdgeMap,
  sub: readonly Point[],
  corridor: number,
  a: Point,
  b: Point,
): Point[] {
  const coarse = sub.length > 2 ? simplifyPath(sub, CORRIDOR_SIMPLIFY_PX) : sub
  const r = corridor - CORRIDOR_SIMPLIFY_PX
  const rect = clip(
    grow(bounds([...sub, a, b]), corridor + 1, Infinity, Infinity),
    map.rect,
  )
  const part = subMap(map, rect)
  const allowed = new Uint8Array(rect.width * rect.height)
  markNear(allowed, rect, coarse, r)
  // The anchors are within reach of the finger's ends, so always allowed.
  for (const p of [a, b]) {
    allowed[
      (Math.floor(p.y) - rect.y) * rect.width + Math.floor(p.x) - rect.x
    ] = 1
  }
  return liveWire(part, a, b, allowed)
}

/** Marks (1) the pixels of `rect` whose centre is within r of the polyline. */
function markNear(
  mask: Uint8Array,
  rect: Rect,
  poly: readonly Point[],
  r: number,
): void {
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k] as Point
    const q = poly[Math.min(k + 1, poly.length - 1)] as Point
    const i0 = Math.max(0, Math.floor(Math.min(p.x, q.x) - r - rect.x))
    const i1 = Math.min(
      rect.width - 1,
      Math.floor(Math.max(p.x, q.x) + r - rect.x),
    )
    const j0 = Math.max(0, Math.floor(Math.min(p.y, q.y) - r - rect.y))
    const j1 = Math.min(
      rect.height - 1,
      Math.floor(Math.max(p.y, q.y) + r - rect.y),
    )
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const o = j * rect.width + i
        if (mask[o] === 1) continue
        const c = { x: rect.x + i + 0.5, y: rect.y + j + 0.5 }
        if (segDist(c, p, q) <= r) mask[o] = 1
      }
    }
  }
}

/** The finger point at arc length s, and the finger between arc lengths s0 and s1. */
function pointAt(
  pts: readonly Point[],
  cum: readonly number[],
  s: number,
): Point {
  let k = 0
  while (k < pts.length - 2 && (cum[k + 1] as number) < s) k++
  const a = pts[k] as Point
  const b = pts[Math.min(k + 1, pts.length - 1)] as Point
  const len =
    (cum[Math.min(k + 1, pts.length - 1)] as number) - (cum[k] as number)
  const t =
    len > 0 ? Math.min(1, Math.max(0, (s - (cum[k] as number)) / len)) : 0
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
}

function subPolyline(
  pts: readonly Point[],
  cum: readonly number[],
  s0: number,
  s1: number,
): Point[] {
  const out = [pointAt(pts, cum, s0)]
  for (let k = 0; k < pts.length; k++) {
    const c = cum[k] as number
    if (c > s0 && c < s1) out.push(pts[k] as Point)
  }
  out.push(pointAt(pts, cum, s1))
  return out
}

function bounds(pts: readonly Point[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

/** Whole-pixel rect covering the bounds grown by `by`, clipped to [0, W) × [0, H). */
function grow(
  b: { minX: number; minY: number; maxX: number; maxY: number },
  by: number,
  W: number,
  H: number,
): Rect {
  const x0 = Math.max(0, Math.floor(b.minX - by))
  const y0 = Math.max(0, Math.floor(b.minY - by))
  const x1 = Math.min(W, Math.ceil(b.maxX + by))
  const y1 = Math.min(H, Math.ceil(b.maxY + by))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

function clip(r: Rect, to: Rect): Rect {
  const x0 = Math.max(r.x, to.x)
  const y0 = Math.max(r.y, to.y)
  const x1 = Math.min(r.x + r.width, to.x + to.width)
  const y1 = Math.min(r.y + r.height, to.y + to.height)
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** The part of `map` inside `rect` (which lies inside map.rect), costs unchanged. */
function subMap(map: EdgeMap, rect: Rect): EdgeMap {
  const n = rect.width * rect.height
  const out: EdgeMap = {
    rect,
    strength: new Float32Array(n),
    cost: new Float32Array(n),
    normalX: new Float32Array(n),
    normalY: new Float32Array(n),
  }
  for (let j = 0; j < rect.height; j++) {
    const from =
      (rect.y - map.rect.y + j) * map.rect.width + rect.x - map.rect.x
    const to = from + rect.width
    out.strength.set(map.strength.subarray(from, to), j * rect.width)
    out.cost.set(map.cost.subarray(from, to), j * rect.width)
    out.normalX.set(map.normalX.subarray(from, to), j * rect.width)
    out.normalY.set(map.normalY.subarray(from, to), j * rect.width)
  }
  return out
}
