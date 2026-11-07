import type { Point } from '../geometry/types'
import { assertPoint, assertView, canvasToImage, fitScale } from './transform'
import { MAX_ZOOM, MIN_ZOOM, type View, type Viewport } from './types'

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v))

const clampZoom = (zoom: number): number => clamp(zoom, MIN_ZOOM, MAX_ZOOM)

/** A zoom within 1% of actual size counts as "at actual size" in `toggleActualSize`. */
const ACTUAL_SIZE_TOLERANCE = 0.01

/**
 * Relative slack for "the scaled image fits the canvas": at fit,
 * `image × (canvas / image)` can land 1 ulp above `canvas`.
 */
const FIT_EPSILON = 1e-9

/**
 * Clamps zoom to [1, 16] and the centre to the image. On an axis where the
 * scaled image fits inside the canvas, the centre is fixed to the image middle.
 */
export function clampView(vp: Viewport, view: View): View {
  assertView(view)
  const zoom = clampZoom(view.zoom)
  const scale = fitScale(vp) * zoom
  const axis = (c: number, imageSize: number, canvasSize: number): number =>
    imageSize * scale <= canvasSize * (1 + FIT_EPSILON)
      ? imageSize / 2
      : clamp(c, 0, imageSize)
  return {
    zoom,
    center: {
      x: axis(view.center.x, vp.image.width, vp.canvas.width),
      y: axis(view.center.y, vp.image.height, vp.canvas.height),
    },
  }
}

/** View with `zoom` such that `imagePt` sits under `canvasPt`, then clamped. */
function anchoredView(
  vp: Viewport,
  zoom: number,
  imagePt: Point,
  canvasPt: Point,
): View {
  const scale = fitScale(vp) * zoom
  return clampView(vp, {
    zoom,
    center: {
      x: imagePt.x - (canvasPt.x - vp.canvas.width / 2) / scale,
      y: imagePt.y - (canvasPt.y - vp.canvas.height / 2) / scale,
    },
  })
}

/**
 * The view after the canvas size or pixel ratio changes (spec 0009 final
 * review I-1): the imagePt at the centre stays there and the display scale
 * (device px per image px) stays, so 100% stays 100%. A view at fit stays at fit.
 */
export function resizeView(
  before: Viewport,
  after: Viewport,
  view: View,
): View {
  assertView(view)
  if (view.zoom <= MIN_ZOOM) {
    return clampView(after, { zoom: MIN_ZOOM, center: view.center })
  }
  const zoom =
    (view.zoom * fitScale(before) * before.dpr) / (fitScale(after) * after.dpr)
  return clampView(after, { zoom, center: view.center })
}

const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
})

/**
 * Pinch/pan from the gesture's start: the imagePt under the start midpoint
 * ends up under the current midpoint, zoom scales with finger distance.
 */
export function applyTwoFingerGesture(
  vp: Viewport,
  startView: View,
  startPts: readonly [Point, Point],
  nowPts: readonly [Point, Point],
): View {
  for (const p of [...startPts, ...nowPts]) assertPoint(p, 'finger point')
  const startDist = Math.hypot(
    startPts[1].x - startPts[0].x,
    startPts[1].y - startPts[0].y,
  )
  const nowDist = Math.hypot(
    nowPts[1].x - nowPts[0].x,
    nowPts[1].y - nowPts[0].y,
  )
  const ratio = startDist === 0 ? 1 : nowDist / startDist
  const anchor = canvasToImage(vp, startView, midpoint(...startPts))
  return anchoredView(
    vp,
    clampZoom(startView.zoom * ratio),
    anchor,
    midpoint(...nowPts),
  )
}

/**
 * Toggles between fit (zoom 1) and actual size (1 image px = 1 device px),
 * anchored at the tapped canvasPt.
 */
export function toggleActualSize(
  vp: Viewport,
  view: View,
  canvasPt: Point,
): View {
  const actualZoom = clampZoom(1 / vp.dpr / fitScale(vp))
  const atActual =
    Math.abs(view.zoom - actualZoom) <= ACTUAL_SIZE_TOLERANCE * actualZoom
  if (atActual) return clampView(vp, { zoom: MIN_ZOOM, center: view.center })
  return anchoredView(
    vp,
    actualZoom,
    canvasToImage(vp, view, canvasPt),
    canvasPt,
  )
}

/** Wheel px that double (negative) or halve (positive) the zoom (spec 0009 AC-6). */
const WHEEL_PX_PER_DOUBLING = 200

/**
 * Wheel or trackpad-pinch zoom by `2^(−deltaYPx / 200)`, keeping the imagePt
 * under `canvasPt` still, then clamped.
 */
export function applyWheelZoom(
  vp: Viewport,
  view: View,
  canvasPt: Point,
  deltaYPx: number,
): View {
  if (!Number.isFinite(deltaYPx)) {
    throw new RangeError(`wheel delta must be finite, got ${String(deltaYPx)}`)
  }
  assertPoint(canvasPt, 'wheel point')
  const zoom = clampZoom(view.zoom * 2 ** (-deltaYPx / WHEEL_PX_PER_DOUBLING))
  return anchoredView(vp, zoom, canvasToImage(vp, view, canvasPt), canvasPt)
}
