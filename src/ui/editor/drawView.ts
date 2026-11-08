import { fitScale, imageToCanvas, viewScale } from '../../core/coords/transform'
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
import { toBezierSegments } from '../../core/geometry/bezier'
import type { Point } from '../../core/geometry/types'
import type { AlphaMask } from '../../core/mask'
import type { NodeRef, Selection } from '../../core/selection/types'

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
  f: Frame & { aim: Point; dots?: DotsLayer },
): void {
  const d = LOUPE_DIAMETER_PX
  const vp: Viewport = {
    canvas: { width: d, height: d },
    image: f.vp.image,
    dpr: f.vp.dpr,
  }
  const scale = loupeScale(viewScale(f.vp, f.view))
  const view = { zoom: scale / fitScale(vp), center: f.aim }
  drawFrame(ctx, { ...f, vp, view })
  if (f.dots) drawDots(ctx, { vp, view }, f.dots)
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

/** The Dots tool's layer (spec 0010 AC-1, AC-11). */
export interface DotsLayer {
  selection: Selection
  selected: readonly NodeRef[]
  /** A box being drawn, in canvas CSS px. */
  box: { a: Point; b: Point } | null
  /** The accent colour, for selected dots and the box. */
  accent: string
}

/** Dots drawn this many CSS px across; selected ones larger (AC-1). */
export const DOT_PX = 8
export const DOT_SELECTED_PX = 12
const DOT_OUTLINE_PX = 1.5
const LINE_DARK = '#111114'

const curvePaths = new WeakMap<Selection, Path2D>()

/** One path of every ring's curves, in image px, cached per selection. */
function curvePath(sel: Selection): Path2D {
  const cached = curvePaths.get(sel)
  if (cached) return cached
  const path = new Path2D()
  for (const ring of sel.rings) {
    const segs = toBezierSegments(ring.nodes, true)
    const start = segs[0]
    if (!start) continue
    path.moveTo(start.p0.x, start.p0.y)
    for (const s of segs) {
      path.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p3.x, s.p3.y)
    }
    path.closePath()
  }
  curvePaths.set(sel, path)
  return path
}

/**
 * The outline as a 1 px white line with a 1 px dark outline, then every dot
 * on top: smooth dots as circles, corners as squares, white with a dark
 * outline, selected ones larger in the accent colour (spec 0010 AC-1). Sizes
 * are CSS px at any zoom. Then the box being drawn, if any (AC-11).
 */
export function drawDots(
  ctx: CanvasRenderingContext2D,
  f: { vp: Viewport; view: View },
  layer: DotsLayer,
): void {
  const { vp, view } = f
  const dpr = vp.dpr
  const k = displayScale(vp, view)
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.setTransform(
    k,
    0,
    0,
    k,
    (vp.canvas.width * dpr) / 2 - view.center.x * k,
    (vp.canvas.height * dpr) / 2 - view.center.y * k,
  )
  const path = curvePath(layer.selection)
  ctx.lineJoin = 'round'
  ctx.strokeStyle = LINE_DARK
  ctx.lineWidth = (3 * dpr) / k
  ctx.stroke(path)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = dpr / k
  ctx.stroke(path)

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const selected = new Set(
    layer.selected.map((r) => `${String(r.ring)}:${String(r.node)}`),
  )
  const w = vp.canvas.width * dpr
  const h = vp.canvas.height * dpr
  const margin = DOT_SELECTED_PX * dpr
  ctx.lineWidth = DOT_OUTLINE_PX * dpr
  ctx.strokeStyle = LINE_DARK
  layer.selection.rings.forEach((ring, r) => {
    ring.nodes.forEach((n, i) => {
      const c = imageToCanvas(vp, view, n)
      const x = c.x * dpr
      const y = c.y * dpr
      if (x < -margin || y < -margin || x > w + margin || y > h + margin) return
      const on = selected.has(`${String(r)}:${String(i)}`)
      const half = ((on ? DOT_SELECTED_PX : DOT_PX) * dpr) / 2
      ctx.fillStyle = on ? layer.accent : '#ffffff'
      ctx.beginPath()
      if (n.kind === 'corner') ctx.rect(x - half, y - half, half * 2, half * 2)
      else ctx.arc(x, y, half, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
    })
  })

  if (layer.box) {
    const { a, b } = layer.box
    const x = Math.min(a.x, b.x) * dpr
    const y = Math.min(a.y, b.y) * dpr
    const bw = Math.abs(a.x - b.x) * dpr
    const bh = Math.abs(a.y - b.y) * dpr
    ctx.globalAlpha = 0.15
    ctx.fillStyle = layer.accent
    ctx.fillRect(x, y, bw, bh)
    ctx.globalAlpha = 1
    ctx.strokeStyle = layer.accent
    ctx.lineWidth = dpr
    ctx.strokeRect(x, y, bw, bh)
  }
  ctx.restore()
}
