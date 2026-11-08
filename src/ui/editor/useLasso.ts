import { useEffect, useRef, useState } from 'react'
import {
  joinSections,
  ringTolerance,
  sectionTolerance,
  snapReachPx,
  type LassoSection,
} from '../../core/editor'
import { isDegenerateRing } from '../../core/geometry/polygon'
import type { SmoothStrength } from '../../core/geometry/smooth'
import type { Point } from '../../core/geometry/types'
import type { Command, Selection } from '../../core/selection/types'
import type { DrawnSection, OpenLasso } from './lassoTool'
import type { Renderer, Snapper } from './session'

/** The status when a lasso can't become a ring (spec 0011 AC-10). */
export const LASSO_INVALID = 'Draw around the area to cut out'
/** The status when a snap fails (AC-13). */
export const SNAP_FAILED = "Couldn't snap to edges here, kept your line"

export type LassoMode = 'add' | 'subtract'

/** What the lasso needs of the editor session. */
export interface LassoSession {
  readonly renderer: Pick<Renderer, 'fitRing'> | null
  readonly photoId: string | null
  snap: (
    finger: Point[],
    reachPx: number,
  ) => Promise<Awaited<ReturnType<Snapper['snap']>> | null>
  snapshot: () => { selection: Selection } | null
  edit: (command: Command) => Selection
}

export interface LassoController {
  /** The open lasso, or null (the canvas's `lasso` input). */
  open: OpenLasso | null
  /** The ring is being made (the "Making dots…" hint, AC-24). */
  closing: boolean
  /** Add, unless Subtract is chosen and there is something to cut (AC-14). */
  mode: LassoMode
  setMode: (mode: LassoMode) => void
  snapOn: boolean
  setSnapOn: (on: boolean) => void
  smoothing: SmoothStrength
  setSmoothing: (s: SmoothStrength) => void
  notice: string | null
  addSection: (d: DrawnSection) => void
  undoSection: () => void
  finish: () => void
  discard: () => void
  /** Forgets the lasso: a new photo or sticker (Decision 8). */
  drop: () => void
  /** The canvas's `snap` input: the live trail (AC-11). */
  liveSnap: (finger: Point[], reachPx: number) => Promise<Point[] | null>
}

/**
 * The open lasso and its options (spec 0011 AC-8 to AC-16). Sections are not
 * undo steps; closing is one `addRing` or `subtractRing` on whatever the
 * selection is when the ring arrives (Review Focus 1). Results that arrive
 * after a drop, a discard or a new photo are ignored.
 */
export function useLasso(
  session: LassoSession,
  opts: { onFinished: () => void; hasRings: boolean },
): LassoController {
  const [sections, setSections] = useState<readonly LassoSection[]>([])
  /** The finger's line of a section being snapped, shown meanwhile. */
  const [pending, setPending] = useState<readonly Point[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [mode, setMode] = useState<LassoMode>('add')
  const [snapOn, setSnapOn] = useState(false)
  const [smoothing, setSmoothing] = useState<SmoothStrength>(1)

  // The async steps read and write these, not the render's copies.
  const live = useRef({ sections, busy: false })
  const generation = useRef(0)
  const latest = useRef({
    mode,
    smoothing,
    snapOn,
    onFinished: opts.onFinished,
  })
  useEffect(() => {
    latest.current = { mode, smoothing, snapOn, onFinished: opts.onFinished }
  })

  const put = (next: readonly LassoSection[]) => {
    live.current.sections = next
    setSections(next)
  }
  const work = (on: boolean, isClosing = false) => {
    live.current.busy = on
    setBusy(on)
    setClosing(on && isClosing)
  }
  const reset = () => {
    generation.current++
    put([])
    setPending(null)
    work(false)
  }
  /** Subtract only cuts from rings that exist (final review). */
  const ringsNow = () => (session.snapshot()?.selection.rings.length ?? 0) > 0

  /** Turns the sections into a ring (AC-15), or keeps them open (AC-10). */
  async function close(all: readonly LassoSection[]) {
    const gen = generation.current
    const photoId = session.photoId
    const renderer = session.renderer
    const path = joinSections(all, latest.current.smoothing)
    if (isDegenerateRing(path) || !renderer) {
      setNotice(LASSO_INVALID)
      work(false)
      return
    }
    work(true, true)
    const res = await renderer.fitRing(path, ringTolerance(all))
    if (gen !== generation.current || photoId !== session.photoId) return
    if (res.type === 'fitted') {
      try {
        session.edit({
          type:
            latest.current.mode === 'subtract' && ringsNow()
              ? 'subtractRing'
              : 'addRing',
          nodes: res.nodes,
        })
      } catch {
        setNotice(LASSO_INVALID)
        work(false)
        return
      }
      reset()
      latest.current.onFinished()
      return
    }
    if (res.type === 'error') setNotice(LASSO_INVALID)
    work(false)
  }

  /** The section's final line: snapped if asked and possible (AC-11, AC-13). */
  async function finalLine(
    d: DrawnSection,
    prevEnd: Point | null,
  ): Promise<LassoSection> {
    const raw: LassoSection = {
      points: d.points,
      snapped: false,
      tolerancePx: sectionTolerance(d.k, false),
    }
    if (!latest.current.snapOn) return raw
    let res: Awaited<ReturnType<LassoSession['snap']>>
    try {
      res = await session.snap(d.points, snapReachPx(d.k))
    } catch {
      res = null
    }
    if (res?.type !== 'snapped' || res.path.length < 2) {
      setNotice(SNAP_FAILED)
      return raw
    }
    // Each section starts at the previous one's end (AC-11 joins).
    const points = prevEnd ? [prevEnd, ...res.path.slice(1)] : res.path
    return { points, snapped: true, tolerancePx: sectionTolerance(d.k, true) }
  }

  async function addSection(d: DrawnSection) {
    if (live.current.busy) return
    setNotice(null)
    const gen = generation.current
    const prevEnd = live.current.sections.at(-1)?.points.at(-1) ?? null
    work(true)
    setPending(d.points)
    const section = await finalLine(d, prevEnd)
    if (gen !== generation.current) return
    const all = [...live.current.sections, section]
    put(all)
    setPending(null)
    if (d.closes) await close(all)
    else work(false)
  }

  const open: OpenLasso | null =
    sections.length > 0 || busy ? { sections, busy, pending } : null

  return {
    open,
    closing,
    mode: mode === 'subtract' && opts.hasRings ? 'subtract' : 'add',
    setMode,
    snapOn,
    setSnapOn,
    smoothing,
    setSmoothing,
    notice,
    addSection: (d) => {
      void addSection(d)
    },
    undoSection: () => {
      if (live.current.busy) return
      setNotice(null)
      put(live.current.sections.slice(0, -1))
    },
    finish: () => {
      const all = live.current.sections
      if (live.current.busy || all.length === 0) return
      setNotice(null)
      void close(all)
    },
    discard: () => {
      setNotice(null)
      reset()
    },
    drop: () => {
      setNotice(null)
      reset()
    },
    liveSnap: async (finger, reachPx) => {
      const res = await session.snap(finger, reachPx)
      return res?.type === 'snapped' ? res.path : null
    },
  }
}
