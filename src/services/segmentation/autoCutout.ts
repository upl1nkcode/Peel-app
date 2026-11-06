import type { History } from '../../core/history/history'
import type { AlphaMask, RgbaImage } from '../../core/mask'
import type { Tap } from '../../core/segmentation'
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
}

export interface AutoCutoutDeps {
  fast: SegmentationEngine
  precise: SegmentationEngine
  history: History
  missingBytes(files: readonly ModelFile[]): Promise<number>
  onChange(state: AutoState): void
}

type EngineState = 'loading' | 'ready' | UnavailableReason

/**
 * Fast then precise (spec 0007 AC-10 to AC-16, AC-20). Each tap runs the
 * fast engine and then the precise one on all taps so far; each result
 * replaces the selection through a `restore` step, unless the user changed
 * the selection since this controller last set it (then the result only
 * becomes the reset-to-auto target). Results for older taps or an older
 * photo are dropped.
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
  }
  const status: Record<'fast' | 'precise', EngineState> = {
    fast: 'loading',
    precise: 'loading',
  }
  let imageId: string | null = null
  let taps: Tap[] = []
  /** Bumped on every tap and photo; results from an older generation are dropped. */
  let generation = 0
  /** The selection this controller last put in the history (or the one at the tap). */
  let expected: Selection | null = null
  let target: AutoResult | null = null
  /** Whether the precise result for the current taps is still owed. */
  let preciseOwed = false
  let fastOwed = false

  /** The notice that stays when nothing else is said: the precise engine could not load. */
  const quiet = (): AutoState['notice'] =>
    status.fast === 'ready' &&
    status.precise !== 'ready' &&
    status.precise !== 'loading'
      ? 'preciseUnavailable'
      : null

  const set = (patch: Partial<AutoState>) => {
    state = { ...state, ...patch }
    deps.onChange(state)
  }

  const apply = (result: AutoResult, from: 'fast' | 'precise') => {
    if (!result.selection) {
      if (from === 'precise' || status.precise !== 'ready') {
        set({ notice: 'nothingFound' })
      }
      return
    }
    target = result
    if (history.current !== expected) {
      if (from === 'precise') set({ notice: 'sharperReady' })
      return
    }
    history.execute({ type: 'restore', selection: result.selection })
    expected = history.current
    set({ modelAlpha: result.alpha, notice: quiet() })
  }

  const run = (engine: 'fast' | 'precise') => {
    if (imageId === null || taps.length === 0) return
    const gen = generation
    const id = imageId
    const snapshot = [...taps]
    if (engine === 'fast') fastOwed = false
    else preciseOwed = false
    deps[engine].segment(id, snapshot).then(
      (result) => {
        if (gen !== generation || id !== imageId) return
        apply(result, engine)
        settle(engine)
      },
      (e: unknown) => {
        if (e instanceof SegmentCancelled) return
        if (gen !== generation || id !== imageId) return
        settle(engine)
      },
    )
  }

  /** The phase after a result (or failure) from `engine`. */
  const settle = (engine: 'fast' | 'precise') => {
    if (engine === 'fast' && status.precise === 'loading') {
      set({ phase: 'sharpening' })
    } else if (engine === 'fast' && status.precise === 'ready') {
      set({ phase: 'sharpening' })
    } else {
      set({ phase: 'done' })
    }
  }

  const ready = (engine: 'fast' | 'precise') => {
    status[engine] = 'ready'
    if (engine === 'fast' && fastOwed) run('fast')
    if (engine === 'precise' && preciseOwed) {
      if (state.phase === 'done') set({ phase: 'sharpening' })
      run('precise')
    }
  }

  const failed = (engine: 'fast' | 'precise', e: unknown) => {
    status[engine] = e instanceof EngineUnavailable ? e.reason : 'unsupported'
    if (engine === 'fast') {
      fastOwed = false
      return
    }
    preciseOwed = false
    if (status.fast === 'ready') {
      set({
        notice: 'preciseUnavailable',
        ...(state.phase === 'sharpening' ? { phase: 'done' as const } : {}),
      })
    }
  }

  return {
    get state() {
      return state
    },

    /** Downloads and loads the fast engine, then the precise one. */
    async start(): Promise<void> {
      const files = new Map<string, ModelFile>()
      for (const f of [...fast.files, ...precise.files]) files.set(f.path, f)
      const total = await deps.missingBytes([...files.values()])
      let base = 0
      let loaded = 0
      const progress = (l: number) => {
        loaded = Math.min(total, Math.max(loaded, base + l))
        if (total > 0)
          set({ download: { loadedBytes: loaded, totalBytes: total } })
      }
      if (total > 0) set({ download: { loadedBytes: 0, totalBytes: total } })
      for (const engine of ['fast', 'precise'] as const) {
        try {
          await deps[engine].load(progress)
          ready(engine)
        } catch (e) {
          failed(engine, e)
        }
        base = loaded
      }
      const fastStatus = status.fast
      const preciseStatus = status.precise
      if (fastStatus !== 'ready' && preciseStatus !== 'ready') {
        set({
          download: null,
          phase: 'idle',
          unavailable: fastStatus === 'loading' ? 'unsupported' : fastStatus,
        })
        return
      }
      set({ download: null })
    },

    async setImage(id: string, image: RgbaImage): Promise<void> {
      imageId = id
      taps = []
      generation++
      target = null
      expected = null
      fastOwed = false
      preciseOwed = false
      set({ phase: 'idle', notice: quiet(), modelAlpha: null })
      await Promise.all([fast.setImage(id, image), precise.setImage(id, image)])
    },

    tap(t: Tap): void {
      if (imageId === null || state.unavailable) return
      taps = [...taps, t]
      generation++
      expected = history.current
      fastOwed = status.fast === 'loading' || status.fast === 'ready'
      preciseOwed = status.precise === 'loading' || status.precise === 'ready'
      set({ phase: 'cutting', notice: quiet() })
      if (status.fast === 'ready') run('fast')
      if (status.precise === 'ready') run('precise')
    },

    resetToAuto(): void {
      if (!target?.selection) return
      history.execute({ type: 'restore', selection: target.selection })
      expected = history.current
      set({ modelAlpha: target.alpha, notice: quiet() })
    },

    useLasso(): void {
      set({ fallbackTool: 'lasso' })
    },
  }
}
