import {
  canvasToImage,
  imageToCanvas,
  viewScale,
} from '../../core/coords/transform'
import type { View, Viewport } from '../../core/coords/types'
import {
  CLOSE_RADIUS_PX,
  closesOnLift,
  continueAt,
  snapReachPx,
  type LassoSection,
} from '../../core/editor'
import { createLasso, type Lasso } from '../../core/geometry/lasso'
import type { Point } from '../../core/geometry/types'

/** A finished drag of the lasso, before snapping (spec 0011 AC-1, AC-4). */
export interface DrawnSection {
  /** The finger's path in image px, deduped at 0.5 px (spec 0002 AC-1). */
  points: Point[]
  /** CSS px per image px when the drag started (AC-11, AC-15). */
  k: number
  /** The finger lifted near the start (AC-4). */
  closes: boolean
}

/** The open lasso, as the screen holds it. */
export interface OpenLasso {
  sections: readonly LassoSection[]
  /** A section is being snapped or the ring fitted: the handle waits (Review Focus 5). */
  busy: boolean
  /** The finger's line of the section being snapped, drawn until it arrives. */
  pending?: readonly Point[] | null
}

export type LassoState = 'none' | 'drawing' | 'paused' | 'busy'

/** What the lasso tool reads of the canvas's inputs. */
export interface LassoInputs {
  tool: string
  lasso?: OpenLasso | null
  snap?(finger: Point[], reachPx: number): Promise<Point[] | null>
  snapOn?: boolean
  onLassoSection?(section: DrawnSection): void
}

/** What a tool needs from the canvas controller (spec 0011 Task 4). */
export interface ToolContext<I> {
  inputs(): I | null
  viewport(): Viewport | null
  view(): View | null
  schedule(): void
  emit(): void
  /** Shows the loupe at `at` aiming at `aim` (image px); null hides it. */
  setLoupe(at: Point | null, aim: Point | null): void
}

/** What `drawLasso` draws (AC-2, AC-5, AC-11). */
export interface LassoLayer {
  /** The path so far, in image px: the sections, then the drag. */
  path: readonly Point[]
  /** The finger's raw trail while snapping (thin), in image px. */
  trail: readonly Point[] | null
  /** The end handle shows (paused). */
  paused: boolean
  accent: string
}

interface Drag {
  lasso: Lasso
  k: number
  /** Where the press went down, and the end it continues from (if any). */
  down: Point
  from: Point | null
  /** The newest snapped trail (AC-11). */
  snapped: Point[] | null
  snapBusy: boolean
  snapWanted: boolean
}

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

/**
 * The Lasso tool on the canvas (spec 0011 AC-1 to AC-7, AC-11): records a
 * one-finger drag from where it went down, continues a paused lasso from its
 * end handle, closes near the start, and keeps a section a second finger
 * interrupts. Snapping the finished section is the screen's job.
 */
export function createLassoTool(ctx: ToolContext<LassoInputs>) {
  /** Raw canvas points of the current press, before it became a drag. */
  let press: { down: Point; raw: Point[] } | null = null
  let drag: Drag | null = null

  const open = (): OpenLasso | null => {
    const l = ctx.inputs()?.lasso
    return l && (l.sections.length > 0 || (l.pending?.length ?? 0) > 0)
      ? l
      : null
  }
  const endOf = (l: OpenLasso): Point | null =>
    l.sections.at(-1)?.points.at(-1) ?? null

  function imagePt(canvasPt: Point): Point | null {
    const vp = ctx.viewport()
    const view = ctx.view()
    if (!vp || !view || !drag) return null
    return drag.from
      ? continueAt(drag.from, drag.down, canvasPt, vp, view)
      : canvasToImage(vp, view, canvasPt)
  }

  function record(canvasPt: Point) {
    const ip = imagePt(canvasPt)
    if (!drag || !ip) return
    drag.lasso.add(ip)
    ctx.setLoupe(canvasPt, ip)
    requestSnap()
    ctx.schedule()
    ctx.emit()
  }

  function requestSnap() {
    const d = drag
    const p = ctx.inputs()
    if (!d || !p?.snapOn || !p.snap) return
    if (d.snapBusy) {
      d.snapWanted = true
      return
    }
    d.snapBusy = true
    d.snapWanted = false
    void p.snap(d.lasso.points().slice(), snapReachPx(d.k)).then(
      (path) => {
        d.snapBusy = false
        if (drag !== d) return
        if (path) d.snapped = path
        ctx.schedule()
        if (d.snapWanted) requestSnap()
      },
      () => {
        d.snapBusy = false
      },
    )
  }

  /** Ends the drag; emits it when it has a point beyond its start. */
  function finish(closes: boolean | null) {
    const d = drag
    drag = null
    press = null
    ctx.setLoupe(null, null)
    if (!d) return
    const points = d.lasso.points().slice()
    const p = ctx.inputs()
    if (points.length >= 2 && p?.onLassoSection) {
      p.onLassoSection({ points, k: d.k, closes: closes ?? false })
    }
    ctx.schedule()
    ctx.emit()
  }

  /** The whole lasso, sections then drag, in canvas px at the current view. */
  function allCanvasPts(): Point[] {
    const vp = ctx.viewport()
    const view = ctx.view()
    if (!vp || !view) return []
    const pts: Point[] = []
    for (const s of open()?.sections ?? []) pts.push(...s.points)
    if (drag) pts.push(...drag.lasso.points())
    return pts.map((ip) => imageToCanvas(vp, view, ip))
  }

  return {
    down(canvasPt: Point) {
      press = { down: canvasPt, raw: [canvasPt] }
    },

    /** A move before the press became a drag (the first 10 px, AC-1). */
    moveRaw(canvasPt: Point) {
      if (press && !drag) press.raw.push(canvasPt)
    },

    /** The press became a drag (AC-1, AC-6). */
    begin(canvasPt: Point) {
      const vp = ctx.viewport()
      const view = ctx.view()
      if (!press || !vp || !view) return
      const l = ctx.inputs()?.lasso ?? null
      if (l?.busy) {
        press = null
        return
      }
      const lasso = open()
      let from: Point | null = null
      if (lasso) {
        const end = endOf(lasso)
        if (!end) return
        if (dist(press.down, imageToCanvas(vp, view, end)) > CLOSE_RADIUS_PX) {
          press = null
          return
        }
        from = end
      }
      drag = {
        lasso: createLasso(),
        k: viewScale(vp, view),
        down: press.down,
        from,
        snapped: null,
        snapBusy: false,
        snapWanted: false,
      }
      const raw = press.raw
      for (const pt of raw) {
        const ip = imagePt(pt)
        if (ip) drag.lasso.add(ip)
      }
      record(canvasPt)
    },

    move(canvasPt: Point) {
      if (drag) record(canvasPt)
    },

    end(canvasPt: Point) {
      if (!drag) {
        press = null
        return
      }
      record(canvasPt)
      finish(closesOnLift(allCanvasPts()))
    },

    /** A second finger landed: the section so far is kept (AC-7). */
    cancel() {
      if (drag) finish(false)
      press = null
    },

    /** Drops the drag without emitting it (a new photo). */
    reset() {
      drag = null
      press = null
    },

    state(): LassoState {
      if (drag) return 'drawing'
      const l = ctx.inputs()?.lasso
      if (l?.busy) return 'busy'
      return open() ? 'paused' : 'none'
    },

    points(): number {
      const l = open()
      let n = drag ? drag.lasso.points().length : 0
      for (const s of l?.sections ?? []) n += s.points.length
      return n + (l?.pending?.length ?? 0)
    },

    layer(accent: string): LassoLayer | null {
      const p = ctx.inputs()
      if (p?.tool !== 'lasso') return null
      const l = open()
      const path: Point[] = []
      for (const s of l?.sections ?? []) path.push(...s.points)
      path.push(...(l?.pending ?? []))
      let trail: Point[] | null = null
      if (drag) {
        const pts = drag.lasso.points()
        if (p.snapOn) {
          trail = pts.slice()
          path.push(...(drag.snapped ?? []))
        } else path.push(...pts)
      }
      if (path.length === 0 && !trail) return null
      // No end handle while it can't be dragged (Review Focus 5).
      return { path, trail, paused: !drag && l !== null && !l.busy, accent }
    },
  }
}

export type LassoTool = ReturnType<typeof createLassoTool>
