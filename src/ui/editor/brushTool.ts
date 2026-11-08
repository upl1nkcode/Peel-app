import { canvasToImage, viewScale } from '../../core/coords/transform'
import { loupeBrushRadii } from '../../core/editor'
import type { Point } from '../../core/geometry/types'
import { applyCommand } from '../../core/selection/commands'
import type {
  BrushStroke,
  Command,
  NodeRef,
  Selection,
} from '../../core/selection/types'
import type { ToolContext } from './lassoTool'

/** The brush as the screen sets it (spec 0011 AC-18, AC-19); hardness in [0, 1]. */
export interface BrushSettings {
  mode: 'erase' | 'restore'
  sizePx: number
  hardness: number
}

/** What the brush tool reads of the canvas's inputs. */
export interface BrushInputs {
  tool: string
  brush?: BrushSettings | undefined
  selection: Selection
  onEdit?(command: Command, selectAfter: readonly NodeRef[]): void
}

export interface BrushContext extends ToolContext<BrushInputs> {
  /** Shows `sel` instead of the input selection while painting (AC-21); null ends it. */
  setPreview(sel: Selection | null): void
}

/** What `drawStrokeBand` draws (AC-21). */
export interface BrushBand {
  points: readonly Point[]
  sizePx: number
  mode: BrushStroke['mode']
}

/**
 * The Brush tool on the canvas (spec 0011 AC-18 to AC-21): a one-finger drag
 * paints one stroke from where it went down, with the settings it started
 * with; a second finger drops it; a tap paints a dab. The cutout previews the
 * stroke so far.
 */
export function createBrushTool(ctx: BrushContext) {
  let press: { raw: Point[] } | null = null
  let stroke: BrushStroke | null = null

  const imagePt = (canvasPt: Point): Point | null => {
    const vp = ctx.viewport()
    const view = ctx.view()
    return vp && view ? canvasToImage(vp, view, canvasPt) : null
  }

  function add(pts: Point[], ip: Point) {
    const last = pts.at(-1)
    if (!last || last.x !== ip.x || last.y !== ip.y) pts.push(ip)
  }

  function show(canvasPt: Point) {
    const p = ctx.inputs()
    if (!stroke || !p) return
    ctx.setPreview(applyCommand(p.selection, { type: 'addStroke', stroke }))
    ctx.setLoupe(canvasPt, stroke.points.at(-1) ?? null)
  }

  function record(canvasPt: Point) {
    const ip = imagePt(canvasPt)
    if (!stroke || !ip) return
    const points = stroke.points.slice()
    add(points, ip)
    stroke = { ...stroke, points }
    show(canvasPt)
  }

  function stop() {
    stroke = null
    press = null
    ctx.setPreview(null)
    ctx.setLoupe(null, null)
  }

  return {
    down(canvasPt: Point) {
      press = { raw: [canvasPt] }
    },

    /** A move before the press became a drag (the first 10 px, AC-18). */
    moveRaw(canvasPt: Point) {
      if (press && !stroke) press.raw.push(canvasPt)
    },

    begin(canvasPt: Point) {
      const b = ctx.inputs()?.brush
      if (!press || !b) return
      const points: Point[] = []
      for (const pt of press.raw) {
        const ip = imagePt(pt)
        if (ip) add(points, ip)
      }
      stroke = { mode: b.mode, sizePx: b.sizePx, hardness: b.hardness, points }
      record(canvasPt)
    },

    move(canvasPt: Point) {
      if (stroke) record(canvasPt)
    },

    end(canvasPt: Point) {
      record(canvasPt)
      const s = stroke
      stop()
      if (s && s.points.length > 0) {
        ctx.inputs()?.onEdit?.({ type: 'addStroke', stroke: s }, [])
      }
    },

    /** A second finger: nothing is recorded (AC-18). */
    cancel() {
      if (stroke || press) stop()
    },

    /** A tap paints one dab where the finger went down (AC-18). */
    dab(canvasPt: Point) {
      const p = ctx.inputs()
      const b = p?.brush
      const ip = imagePt(canvasPt)
      if (!p || !b || !ip) return
      p.onEdit?.(
        {
          type: 'addStroke',
          stroke: {
            mode: b.mode,
            sizePx: b.sizePx,
            hardness: b.hardness,
            points: [ip],
          },
        },
        [],
      )
    },

    reset() {
      stroke = null
      press = null
    },

    band(): BrushBand | null {
      return stroke
        ? { points: stroke.points, sizePx: stroke.sizePx, mode: stroke.mode }
        : null
    },

    /** The loupe's circles while painting (AC-20). */
    loupeRadii(): { outer: number; inner: number | null } | null {
      const vp = ctx.viewport()
      const view = ctx.view()
      if (!stroke || !vp || !view) return null
      return loupeBrushRadii(
        stroke.sizePx,
        stroke.hardness,
        viewScale(vp, view),
      )
    },
  }
}
