import { fitScale, viewScale } from '../../core/coords/transform'
import type { View, Viewport } from '../../core/coords/types'
import {
  CHECKER_DARK,
  CHECKER_LIGHT,
  CHECKER_PX,
  displayScale,
  isCrisp,
  LOUPE_DIAMETER_PX,
  loupeScale,
  VIEW_BACKGROUNDS,
  type Rgb,
  type ViewMode,
} from '../../core/editor'
import type { Point } from '../../core/geometry/types'
import type { AlphaMask } from '../../core/mask'

/** What one frame shows (spec 0009 AC-8, AC-11, AC-18). */
export interface Frame {
  vp: Viewport
  view: View
  /** The photo at full size. */
  photo: CanvasImageSource
  /** The photo's RGB with the mask as alpha, at the mask's size; null before the first render. */
  cutout: HTMLCanvasElement | null
  mode: ViewMode
  /** Hold-to-compare: the original photo only. */
  comparing: boolean
}

const css = (c: Rgb) => `rgb(${String(c[0])} ${String(c[1])} ${String(c[2])})`

/** Overlay shows removed pixels at half brightness: `0.5p + 0.5ap`. */
const OVERLAY_HALF = 0.5

/**
 * Draws the photo at the mask's size with the mask as its alpha, into
 * `target` (the preview; never saved).
 */
export function buildCutout(
  target: HTMLCanvasElement,
  source: CanvasImageSource,
  mask: AlphaMask,
): void {
  target.width = mask.width
  target.height = mask.height
  const ctx = target.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, mask.width, mask.height)
  const pixels = ctx.getImageData(0, 0, mask.width, mask.height)
  for (let i = 0; i < mask.data.length; i++) {
    pixels.data[i * 4 + 3] = mask.data[i] ?? 0
  }
  ctx.putImageData(pixels, 0, 0)
}

const patterns = new WeakMap<
  CanvasRenderingContext2D,
  { dpr: number; pattern: CanvasPattern | null }
>()

/**
 * The checkerboard as a device-pixel pattern: 8 CSS px squares, light at the
 * canvas's top-left, the same at every zoom (AC-11).
 */
export function checkerPattern(
  ctx: CanvasRenderingContext2D,
  dpr: number,
): CanvasPattern | null {
  const cached = patterns.get(ctx)
  if (cached?.dpr === dpr) return cached.pattern
  const square = Math.max(1, Math.round(CHECKER_PX * dpr))
  const tile = document.createElement('canvas')
  tile.width = square * 2
  tile.height = square * 2
  const t = tile.getContext('2d')
  let pattern: CanvasPattern | null = null
  if (t) {
    t.fillStyle = css(CHECKER_LIGHT)
    t.fillRect(0, 0, square * 2, square * 2)
    t.fillStyle = css(CHECKER_DARK)
    t.fillRect(square, 0, square, square)
    t.fillRect(0, square, square, square)
    pattern = ctx.createPattern(tile, 'repeat')
  }
  patterns.set(ctx, { dpr, pattern })
  return pattern
}

/** Sizes `ctx.canvas` to the viewport × dpr and draws one frame. */
export function drawFrame(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { vp, view } = f
  const canvas = ctx.canvas
  const w = Math.max(1, Math.round(vp.canvas.width * vp.dpr))
  const h = Math.max(1, Math.round(vp.canvas.height * vp.dpr))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  if (f.mode === 'overlay' || f.comparing) {
    ctx.fillStyle = '#000000'
  } else if (f.mode === 'checkerboard') {
    ctx.fillStyle = checkerPattern(ctx, vp.dpr) ?? css(CHECKER_LIGHT)
  } else {
    ctx.fillStyle = css(VIEW_BACKGROUNDS[f.mode])
  }
  ctx.fillRect(0, 0, w, h)

  // Image px → device px.
  const k = displayScale(vp, view)
  ctx.setTransform(
    k,
    0,
    0,
    k,
    (vp.canvas.width * vp.dpr) / 2 - view.center.x * k,
    (vp.canvas.height * vp.dpr) / 2 - view.center.y * k,
  )
  ctx.imageSmoothingEnabled = !isCrisp(k)
  ctx.imageSmoothingQuality = 'high'
  const { width: iw, height: ih } = vp.image

  if (f.comparing) {
    ctx.drawImage(f.photo, 0, 0, iw, ih)
    return
  }
  if (f.mode === 'overlay') {
    ctx.globalAlpha = OVERLAY_HALF
    ctx.drawImage(f.photo, 0, 0, iw, ih)
    if (f.cutout) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.drawImage(f.cutout, 0, 0, iw, ih)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    return
  }
  if (f.cutout) ctx.drawImage(f.cutout, 0, 0, iw, ih)
}

/**
 * The loupe (spec 0009 AC-13): the current view around `aim` (an image
 * point), magnified 4× up to 32 CSS px per image px, with a crosshair at the
 * centre: a 1 px white line between 1 px dark lines, visible on any colour.
 */
export function drawLoupe(
  ctx: CanvasRenderingContext2D,
  f: Frame & { aim: Point },
): void {
  const d = LOUPE_DIAMETER_PX
  const vp: Viewport = {
    canvas: { width: d, height: d },
    image: f.vp.image,
    dpr: f.vp.dpr,
  }
  const scale = loupeScale(viewScale(f.vp, f.view))
  drawFrame(ctx, {
    ...f,
    vp,
    view: { zoom: scale / fitScale(vp), center: f.aim },
  })
  const size = ctx.canvas.width
  const line = Math.max(1, Math.round(f.vp.dpr))
  const c = Math.floor(size / 2) - Math.floor(line / 2)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000000'
  ctx.fillRect(c - line, 0, line * 3, size)
  ctx.fillRect(0, c - line, size, line * 3)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(c, 0, line, size)
  ctx.fillRect(0, c, size, line)
}
