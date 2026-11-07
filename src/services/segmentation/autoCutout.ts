import type { History } from '../../core/history/history'
import type { AlphaMask, RgbaImage } from '../../core/mask'
import type { Tap } from '../../core/segmentation'
import { emptySelection } from '../../core/selection/model'
import type { Selection } from '../../core/selection/types'
import {
  EngineUnavailable,
  SegmentCancelled,
  type AutoResult,
  type ModelFile,
  type SegmentationEngine,
  type UnavailableReason,
} from './types'

export interface AutoState {
  download: { loadedBytes: number; totalBytes: number } | null
  phase: 'idle' | 'cutting' | 'sharpening' | 'done'
  notice: 'nothingFound' | 'sharperReady' | 'preciseUnavailable' | null
  /** Set when neither engine can run (spec 0007 AC-20). */
  unavailable: UnavailableReason | null
  fallbackTool: 'lasso' | null
  /** The alpha of the auto result the selection came from; the render worker's model alpha. */
  modelAlpha: AlphaMask | null
  /** Auto has a result for this photo that "Reset to auto" can bring back (spec 0009 AC-20). */
  hasAutoResult: boolean
  /** The history snapshot holding the latest result, or null when it isn't applied. */
  autoResultSelection: Selection | null
}

export interface AutoCutoutDeps {
  fast: SegmentationEngine
  precise: SegmentationEngine
  history: History
  missingBytes(files: readonly ModelFile[]): Promise<number>
  onChange(state: AutoState): void
  /**
   * Whether this browser can run the engines at all (checked before any
   * download, so an unsupported browser downloads nothing). Default: yes.
   */
  supported?: () => boolean
}

type Engine = 'fast' | 'precise'
/** `idle`: not loaded yet, or failed for a reason worth retrying. */
type EngineState = 'idle' | 'loading' | 'ready' | UnavailableReason

/** Reasons that can go away (the connection, the storage); retried on the next tap, photo or `retry()`. */
const RETRIABLE: ReadonlySet<EngineState> = new Set([
  'offline',
  'download',
  'storage',
])

const ENGINES: readonly Engine[] = ['fast', 'precise']

/**
 * Fast then precise (spec 0007 AC-10 to AC-16, AC-20). Each tap runs the
 * fast engine and then the precise one on all taps so far; each result
 * replaces the selection through a `restore` step, unless the user changed
 * the selection since this controller last set it (then the result only
 * becomes the reset-to-auto target). Results for older taps or an older
 * photo are dropped. Engines that failed to download are loaded again on
 * the next tap, photo or `retry()`.
 */
export function createAutoCutout(deps: AutoCutoutDeps) {
  const { fast, precise, history } = deps
  let state: AutoState = {
    download: null,
    phase: 'idle',
    notice: null,
    unavailable: null,
    fallbackTool: null,
    modelAlpha: null,
    hasAutoResult: false,
    autoResultSelection: null,
  }
  const status: Record<Engine, EngineState> = { fast: 'idle', precise: 'idle' }
  let loading: Promise<void> | null = null
  let image: { id: string; width: number; height: number } | null = null
  let taps: Tap[] = []
  /** Bumped on every tap and photo; results from an older generation are dropped. */
  let generation = 0
  /** The selection this controller last put in the history (or the one at the tap). */
  let expected: Selection | null = null
  let target: AutoResult | null = null
  /** Whether a result for the current taps is still owed by each engine. */
  const owed: Record<Engine, boolean> = { fast: false, precise: false }

  /** The notice that stays when nothing else is said: the precise engine could not load. */
  const quiet = (): AutoState['notice'] =>
    status.fast === 'ready' &&
    status.precise !== 'ready' &&
    status.precise !== 'loading' &&
    status.precise !== 'idle'
      ? 'preciseUnavailable'
      : null

  const set = (patch: Partial<AutoState>) => {
    state = { ...state, ...patch }
    deps.onChange(state)
  }

  /** Puts `selection` in the history, unless the user changed it since; returns whether it did. */
  const show = (selection: Selection): boolean => {
    if (history.current !== expected) return false
    if (history.current !== selection) {
      history.execute({ type: 'restore', selection })
    }
    expected = history.current
    return true
  }

  const apply = (result: AutoResult, from: Engine, used: readonly Tap[]) => {
    if (!result.selection) {
      const removedAll =
        used.some((t) => t.mode === 'add') &&
        used.some((t) => t.mode === 'remove')
      if (removedAll) {
        // The user removed everything they had added (AC-13): an empty cutout.
        target = null
        const shown = show(emptySelection())
        set({
          hasAutoResult: false,
          autoResultSelection: null,
          ...(shown && { modelAlpha: null, notice: quiet() }),
        })
        return
      }
      if (from === 'precise' || status.precise !== 'ready') {
        set({ notice: 'nothingFound' })
      }
      return
    }
    target = result
    if (!show(result.selection)) {
      set({
        hasAutoResult: true,
        autoResultSelection: null,
        ...(from === 'precise' && { notice: 'sharperReady' as const }),
      })
      return
    }
    set({
      modelAlpha: result.alpha,
      notice: quiet(),
      hasAutoResult: true,
      autoResultSelection: history.current,
    })
  }

  const run = (engine: Engine) => {
    if (image === null || taps.length === 0) return
    const gen = generation
    const id = image.id
    const snapshot = [...taps]
    owed[engine] = false
    const current = () => gen === generation && id === image?.id
    deps[engine].segment(id, snapshot).then(
      (result) => {
        if (!current()) return
        apply(result, engine, snapshot)
        settle(engine)
      },
      (e: unknown) => {
        if (e instanceof SegmentCancelled || !current()) return
        settle(engine)
      },
    )
  }

  /** The phase after a result (or failure) from `engine`. */
  const settle = (engine: Engine) => {
    const preciseComing =
      status.precise === 'loading' || status.precise === 'ready'
    set({ phase: engine === 'fast' && preciseComing ? 'sharpening' : 'done' })
  }

  const ready = (engine: Engine) => {
    status[engine] = 'ready'
    if (!owed[engine]) return
    if (engine === 'precise' && state.phase === 'done') {
      set({ phase: 'sharpening' })
    }
    run(engine)
  }

  const failed = (engine: Engine, reason: UnavailableReason) => {
    status[engine] = reason
    owed[engine] = false
    if (engine === 'precise' && status.fast === 'ready') {
      set({
        notice: 'preciseUnavailable',
        ...(state.phase === 'sharpening' ? { phase: 'done' as const } : {}),
      })
    }
    if (engine === 'fast' && state.phase === 'cutting') {
      if (status.precise !== 'ready' && status.precise !== 'loading') {
        set({ phase: 'idle' })
      }
    }
  }

  /** Loads (or reloads) every engine that is not ready and not unsupported: fast first. */
  const ensure = (): Promise<void> => {
    if (loading) return loading
    const todo = ENGINES.filter(
      (e) => status[e] === 'idle' || RETRIABLE.has(status[e]),
    )
    if (todo.length === 0) return Promise.resolve()
    for (const e of todo) {
      status[e] = 'loading'
      // An engine that loads late still sharpens the taps already made.
      if (taps.length > 0) owed[e] = true
    }
    if (state.unavailable) set({ unavailable: null, notice: quiet() })
    loading = load(todo).finally(() => {
      loading = null
    })
    return loading
  }

  const load = async (todo: Engine[]) => {
    if (deps.supported && !deps.supported()) {
      for (const e of todo) failed(e, 'unsupported')
      finish()
      return
    }
    let total: number
    try {
      const files = new Map<string, ModelFile>()
      for (const e of todo) for (const f of deps[e].files) files.set(f.path, f)
      total = await deps.missingBytes([...files.values()])
    } catch {
      // Cache Storage itself is unusable (private mode, a locked-down browser).
      for (const e of todo) failed(e, 'unsupported')
      finish()
      return
    }
    let base = 0
    let loaded = 0
    const progress = (l: number) => {
      loaded = Math.min(total, Math.max(loaded, base + l))
      if (total > 0)
        set({ download: { loadedBytes: loaded, totalBytes: total } })
    }
    if (total > 0) set({ download: { loadedBytes: 0, totalBytes: total } })
    for (const engine of todo) {
      try {
        await deps[engine].load(progress)
        ready(engine)
      } catch (e) {
        failed(
          engine,
          e instanceof EngineUnavailable ? e.reason : 'unsupported',
        )
      }
      base = loaded
    }
    finish()
  }

  const finish = () => {
    if (status.fast === 'ready' || status.precise === 'ready') {
      set({ download: null, notice: state.notice ?? quiet() })
      return
    }
    const reason = (['fast', 'precise'] as const)
      .map((e) => status[e])
      .find((s): s is UnavailableReason => s !== 'idle' && s !== 'loading')
    set({
      download: null,
      phase: 'idle',
      unavailable: reason ?? 'unsupported',
    })
  }

  return {
    get state() {
      return state
    },

    /** Downloads and loads the fast engine, then the precise one. Never rejects. */
    start(): Promise<void> {
      return ensure()
    },

    /** Loads again any engine whose download failed (call when the connection comes back). */
    retry(): void {
      void ensure()
    },

    async setImage(id: string, img: RgbaImage): Promise<void> {
      image = { id, width: img.width, height: img.height }
      taps = []
      generation++
      target = null
      owed.fast = false
      owed.precise = false
      // The previous photo's cutout does not belong to this one.
      expected = history.current
      show(emptySelection())
      set({
        phase: 'idle',
        notice: quiet(),
        modelAlpha: null,
        hasAutoResult: false,
        autoResultSelection: null,
      })
      void ensure()
      await Promise.all([fast.setImage(id, img), precise.setImage(id, img)])
    },

    tap(t: Tap): void {
      if (image === null) return
      const { x, y } = t.imagePt
      if (!(x >= 0 && x < image.width && y >= 0 && y < image.height)) return
      taps = [...taps, t]
      generation++
      expected = history.current
      void ensure()
      if (state.unavailable) return
      for (const e of ENGINES) {
        owed[e] = status[e] === 'loading' || status[e] === 'ready'
      }
      set({ phase: 'cutting', notice: quiet() })
      for (const e of ENGINES) if (status[e] === 'ready') run(e)
    },

    resetToAuto(): void {
      if (!target?.selection) return
      history.execute({ type: 'restore', selection: target.selection })
      expected = history.current
      set({
        modelAlpha: target.alpha,
        notice: quiet(),
        autoResultSelection: history.current,
      })
    },

    useLasso(): void {
      set({ fallbackTool: 'lasso' })
    },
  }
}
