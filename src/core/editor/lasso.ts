import { canvasToImage, imageToCanvas } from '../coords/transform'
import type { View, Viewport } from '../coords/types'
import { smoothPath, type SmoothStrength } from '../geometry/smooth'
import type { Point } from '../geometry/types'
import { SNAP_REACH_PT } from '../matting/magnetic'

/** A lift this close (CSS px) to the start closes the lasso (spec 0011 AC-4)… */
export const CLOSE_RADIUS_PX = 22
/** …once the lasso has been at least this far from it. */
export const CLOSE_AWAY_PX = 44

/** Tolerances of unsnapped sections stay within these (image px, AC-15). */
const MIN_TOLERANCE_PX = 0.25
const MAX_TOLERANCE_PX = 8
/** Snapped sections already sit on the edge (spec 0005's contour tolerance). */
const SNAPPED_TOLERANCE_PX = 0.5

/** One drag of a lasso, from finger down to finger up (spec 0011 Decision 3). */
export interface LassoSection {
  /** Image px; snapped onto the edge when `snapped`. */
  points: Point[]
  snapped: boolean
  /** How closely the dots must follow this section (AC-15). */
  tolerancePx: number
}

/** 1 screen px at the zoom `k` (CSS px per image px) a section was traced at (Decision 4). */
export function sectionTolerance(k: number, snapped: boolean): number {
  if (snapped) return SNAPPED_TOLERANCE_PX
  return Math.min(MAX_TOLERANCE_PX, Math.max(MIN_TOLERANCE_PX, 1 / k))
}

/** The ring follows its finest section (Decision 4). */
export function ringTolerance(sections: readonly LassoSection[]): number {
  return Math.min(...sections.map((s) => s.tolerancePx))
}

/** The 12 pt snap reach in image px at zoom `k` (AC-11, spec 0006 Decision 3). */
export function snapReachPx(k: number): number {
  return SNAP_REACH_PT / k
}

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

/**
 * Whether lifting at the path's last point closes it (AC-4): within 22 px of
 * its first point, after having been at least 44 px from it.
 */
export function closesOnLift(pathCanvasPts: readonly Point[]): boolean {
  const start = pathCanvasPts[0]
  const end = pathCanvasPts.at(-1)
  if (!start || !end || dist(start, end) > CLOSE_RADIUS_PX) return false
  return pathCanvasPts.some((p) => dist(start, p) >= CLOSE_AWAY_PX)
}

/**
 * The sections as one open path (AC-15 step 1): unsnapped sections smoothed
 * with their ends kept, snapped ones as they are. A section's first point is
 * dropped when it equals the previous section's last.
 */
export function joinSections(
  sections: readonly LassoSection[],
  smoothing: SmoothStrength,
): Point[] {
  const out: Point[] = []
  for (const s of sections) {
    const pts = s.snapped
      ? s.points.map((p) => ({ x: p.x, y: p.y }))
      : smoothPath(s.points, smoothing)
    const last = out.at(-1)
    const first = pts[0]
    const from =
      last && first && last.x === first.x && last.y === first.y ? 1 : 0
    for (let i = from; i < pts.length; i++) out.push(pts[i] as Point)
  }
  return out
}

/**
 * Where a continued lasso is (AC-6): its end plus the finger's movement since
 * it went down, so the path never jumps. A finger that hasn't moved gives the
 * end exactly.
 */
export function continueAt(
  endImagePt: Point,
  downCanvasPt: Point,
  fingerCanvasPt: Point,
  vp: Viewport,
  view: View,
): Point {
  const dx = fingerCanvasPt.x - downCanvasPt.x
  const dy = fingerCanvasPt.y - downCanvasPt.y
  if (dx === 0 && dy === 0) return { x: endImagePt.x, y: endImagePt.y }
  const end = imageToCanvas(vp, view, endImagePt)
  return canvasToImage(vp, view, { x: end.x + dx, y: end.y + dy })
}
