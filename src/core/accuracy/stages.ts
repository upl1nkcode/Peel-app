import { fromAlphaMask, maskToRings } from '../contour'
import {
  joinSections,
  ringTolerance,
  sectionTolerance,
  snapReachPx,
  type LassoSection,
} from '../editor/lasso'
import type { Point, Size } from '../geometry/types'
import { renderMask } from '../mask/render'
import { resizeRgba } from '../mask/resize'
import type { AlphaMask, RgbaImage } from '../mask/types'
import { snapToEdges } from '../matting/magnetic'
import { smartEdgeRefiner } from '../matting/smartEdge'
import { applyCommand } from '../selection/commands'
import { fitRing } from '../selection/density'
import { emptySelection } from '../selection/model'
import type { Selection } from '../selection/types'
import { lassoAround, lassoHoles } from './lassoAround'
import type { Mask } from './score'

/** The phone screen a lasso is traced on, in points (spec 0014 Decision 12). */
const SCREEN_PT = { width: 390, height: 700 }
/** The subject fills this much of it. */
const FILL = 0.9
/** A finger's trace wanders this far, in points. */
const WOBBLE_PT = 3
/** The lasso's Smoothing setting, the app's default (spec 0011 AC-15). */
const SMOOTHING = 1

const zeros = (size: Size): AlphaMask => ({
  width: size.width,
  height: size.height,
  data: new Uint8Array(size.width * size.height),
})

/** `base` scaled so its long side is `longSide`, rounded; never enlarged. */
export function sizeFor(base: Size, longSide: number): Size {
  const s = Math.min(1, longSide / Math.max(base.width, base.height))
  return {
    width: Math.max(1, Math.round(base.width * s)),
    height: Math.max(1, Math.round(base.height * s)),
  }
}

/** A second add tap for timing (spec 0015 AC-5): a fully opaque truth pixel at least this share of the subject's diagonal from the first. */
const SECOND_TAP_AWAY = 0.1

/**
 * The fully opaque truth pixel nearest the centre of the truth's bounding
 * box (alpha ≥ 128) that lies at least 10% of that box's diagonal from
 * `first`; ties go to the first in scan order. Returns a pixel centre.
 */
export function secondTap(truth: Mask, first: Point): Point {
  const { width: W, height: H, data } = truth
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if ((data[y * W + x] as number) < 128) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  if (x1 < 0) throw new RangeError('the truth is empty')
  const away = SECOND_TAP_AWAY * Math.hypot(x1 - x0 + 1, y1 - y0 + 1)
  const cx = (x0 + x1 + 1) / 2
  const cy = (y0 + y1 + 1) / 2
  let best: Point | null = null
  let bestD = Infinity
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[y * W + x] !== 255) continue
      const p = { x: x + 0.5, y: y + 0.5 }
      if (Math.hypot(p.x - first.x, p.y - first.y) < away) continue
      const d = Math.hypot(p.x - cx, p.y - cy)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
  }
  if (!best)
    throw new RangeError('no opaque pixel far enough from the first tap')
  return best
}

/** Area-averages a mask with the photo's own filter (`resizeRgba`'s alpha). */
export function resizeMask(mask: Mask, width: number, height: number): Mask {
  const rgba = new Uint8Array(mask.width * mask.height * 4)
  for (let i = 0; i < mask.data.length; i++)
    rgba[i * 4 + 3] = mask.data[i] as number
  const small = resizeRgba(
    { width: mask.width, height: mask.height, data: rgba },
    width,
    height,
  )
  const data = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++)
    data[i] = small.data[i * 4 + 3] as number
  return { width, height, data }
}

/** The zoom (CSS px per image px) a lasso is traced at (Decision 12). */
export function traceZoom(truth: Mask): number {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let y = 0; y < truth.height; y++) {
    for (let x = 0; x < truth.width; x++) {
      if ((truth.data[y * truth.width + x] as number) < 128) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  if (x1 < x0) return 1
  return (
    FILL *
    Math.min(SCREEN_PT.width / (x1 - x0 + 1), SCREEN_PT.height / (y1 - y0 + 1))
  )
}

/** What Auto saves: the auto selection rendered with the smart edge on the model alpha. */
export function finishedAlpha(
  image: RgbaImage,
  auto: { alpha: AlphaMask; selection: Selection | null },
): AlphaMask {
  if (!auto.selection) return zeros(image)
  return renderMask(auto.selection, image, {
    refineEdge: smartEdgeRefiner(image, auto.alpha),
  })
}

/** A finger-like lasso around the truth, made into a selection the way the app's lasso does. */
export function lassoAlpha(
  image: RgbaImage,
  truth: Mask,
  opts: { seed: number; snap: boolean },
): AlphaMask {
  const k = traceZoom(truth)
  const finger = lassoAround(truth, opts.seed, WOBBLE_PT / k)
  if (finger.length < 4) return zeros(image)
  /** One closed trace made into dots, as the app's lasso does on lifting. */
  const ring = (points: Point[]) => {
    const section: LassoSection = opts.snap
      ? {
          points: snapToEdges(image, points, snapReachPx(k)),
          snapped: true,
          tolerancePx: sectionTolerance(k, true),
        }
      : { points, snapped: false, tolerancePx: sectionTolerance(k, false) }
    return fitRing(joinSections([section], SMOOTHING), ringTolerance([section]))
  }
  let selection = applyCommand(emptySelection(), {
    type: 'addRing',
    nodes: ring(finger),
  })
  // Each hole lassoed again in Subtract mode, at the same zoom (final review).
  for (const hole of lassoHoles(truth, opts.seed, WOBBLE_PT / k)) {
    if (hole.length < 4) continue
    selection = applyCommand(selection, {
      type: 'subtractRing',
      nodes: ring(hole),
    })
  }
  return renderMask(selection, image)
}

/** Selection to dots and back (spec 0005): the 50% line retraced, the same soft edge re-applied. */
export function dotsRoundTrip(
  alpha: AlphaMask,
  image: RgbaImage,
  softEdge: Selection['softEdge'],
  modelAlpha?: AlphaMask,
): AlphaMask {
  const rings = maskToRings(fromAlphaMask(alpha))
  if (rings.length === 0) return zeros(image)
  const selection: Selection = {
    rings,
    ...(softEdge && { softEdge }),
    strokes: [],
    feather: 0,
  }
  return renderMask(selection, image, {
    refineEdge: smartEdgeRefiner(image, modelAlpha),
  })
}
