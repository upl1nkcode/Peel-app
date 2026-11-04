import type { Point, Size } from '../geometry/types'
import type { View, Viewport } from './types'

const isPositiveFinite = (n: number): boolean => Number.isFinite(n) && n > 0

const isPositiveSize = (s: Size): boolean =>
  isPositiveFinite(s.width) && isPositiveFinite(s.height)

/** Throws `RangeError` for sizes or dpr that would produce NaN/Infinity. */
export function assertViewport(vp: Viewport): void {
  if (!isPositiveSize(vp.canvas)) {
    throw new RangeError(
      `canvas size must be positive, got ${String(vp.canvas.width)}×${String(vp.canvas.height)}`,
    )
  }
  if (!isPositiveSize(vp.image)) {
    throw new RangeError(
      `image size must be positive, got ${String(vp.image.width)}×${String(vp.image.height)}`,
    )
  }
  if (!isPositiveFinite(vp.dpr)) {
    throw new RangeError(`dpr must be positive, got ${String(vp.dpr)}`)
  }
}

/** Throws `RangeError` for a non-finite point. */
export function assertPoint(p: Point, name = 'point'): void {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    throw new RangeError(`${name} must be finite`)
  }
}

/** Throws `RangeError` for a non-positive/non-finite zoom or a non-finite centre. */
export function assertView(view: View): void {
  if (!isPositiveFinite(view.zoom)) {
    throw new RangeError(`zoom must be positive, got ${String(view.zoom)}`)
  }
  if (!Number.isFinite(view.center.x) || !Number.isFinite(view.center.y)) {
    throw new RangeError('view center must be finite')
  }
}

/** CSS px per image px at zoom 1 (whole image fits the canvas). */
export function fitScale(vp: Viewport): number {
  assertViewport(vp)
  return Math.min(
    vp.canvas.width / vp.image.width,
    vp.canvas.height / vp.image.height,
  )
}

/** CSS px per image px for this view. */
export function viewScale(vp: Viewport, view: View): number {
  assertView(view)
  return fitScale(vp) * view.zoom
}

/** Fit view: zoom 1, image centred. */
export function initialView(vp: Viewport): View {
  assertViewport(vp)
  return {
    zoom: 1,
    center: { x: vp.image.width / 2, y: vp.image.height / 2 },
  }
}

export function canvasToImage(
  vp: Viewport,
  view: View,
  canvasPt: Point,
): Point {
  const scale = viewScale(vp, view)
  return {
    x: view.center.x + (canvasPt.x - vp.canvas.width / 2) / scale,
    y: view.center.y + (canvasPt.y - vp.canvas.height / 2) / scale,
  }
}

export function imageToCanvas(vp: Viewport, view: View, imagePt: Point): Point {
  const scale = viewScale(vp, view)
  return {
    x: (imagePt.x - view.center.x) * scale + vp.canvas.width / 2,
    y: (imagePt.y - view.center.y) * scale + vp.canvas.height / 2,
  }
}

/** `origin` is the canvas element's top-left in client coordinates. */
export function screenToCanvas(origin: Point, screenPt: Point): Point {
  return { x: screenPt.x - origin.x, y: screenPt.y - origin.y }
}

export function canvasToDevice(vp: Viewport, canvasPt: Point): Point {
  assertViewport(vp)
  return { x: canvasPt.x * vp.dpr, y: canvasPt.y * vp.dpr }
}
