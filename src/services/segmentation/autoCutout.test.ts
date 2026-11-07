// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHistory } from '../../core/history/history'
import type { RgbaImage } from '../../core/mask'
import type { Tap } from '../../core/segmentation'
import { emptySelection } from '../../core/selection/model'
import { createAutoCutout, type AutoState } from './autoCutout'
import { createFakeEngine } from './fakeEngine'
import { statusLines, USE_LASSO_LABEL } from './status'
import { EngineUnavailable, type SegmentationEngine } from './types'

const photo = (): RgbaImage => ({
  width: 200,
  height: 100,
  data: new Uint8Array(200 * 100 * 4),
})
const add = (x: number, y: number): Tap => ({ imagePt: { x, y }, mode: 'add' })

/** Wraps an engine so each segment call's taps are recorded. */
function recording(engine: SegmentationEngine) {
  const calls: number[] = []
  return {
    calls,
    engine: {
      ...engine,
      segment(imageId, taps) {
        calls.push(taps.length)
        return engine.segment(imageId, taps)
      },
    } satisfies SegmentationEngine,
  }
}

function setup(
  opts: {
    fast?: SegmentationEngine
    precise?: SegmentationEngine
    missingBytes?: number | (() => Promise<number>)
    supported?: () => boolean
  } = {},
) {
  const fast = opts.fast ?? createFakeEngine({ name: 'fast', delayMs: 10 })
  const precise =
    opts.precise ?? createFakeEngine({ name: 'precise', delayMs: 100 })
  const history = createHistory(emptySelection())
  const states: AutoState[] = []
  const auto = createAutoCutout({
    fast,
    precise,
    history,
    missingBytes:
      typeof opts.missingBytes === 'function'
        ? opts.missingBytes
        : () => Promise.resolve((opts.missingBytes as number | undefined) ?? 0),
    ...(opts.supported && { supported: opts.supported }),
    onChange: (s) => states.push(s),
  })
  const last = () => states.at(-1) as AutoState
  return { auto, history, states, last, fast, precise }
}

/** An engine whose first `failures` loads fail with `reason`; counts its loads. */
function flaky(
  name: 'fast' | 'precise',
  reason: 'offline' | 'download',
  failures = 1,
) {
  const base = createFakeEngine({ name, delayMs: name === 'fast' ? 10 : 100 })
  const counter = { loads: 0 }
  const engine: SegmentationEngine = {
    ...base,
    load: (p) =>
      ++counter.loads <= failures
        ? Promise.reject(new EngineUnavailable(reason))
        : base.load(p),
  }
  return { engine, counter }
}

/** Runs one segment directly, to compare the controller's result with. */
async function direct(name: 'fast' | 'precise', taps: Tap[]) {
  const engine = createFakeEngine({ name })
  await engine.load(() => undefined)
  await engine.setImage('p', photo())
  return engine.segment('p', taps)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('auto cutout controller', () => {
  it('should_show_the_fast_result_then_the_precise_one (AC-10)', async () => {
    const { auto, history, last } = setup({
      precise: createFakeEngine({ name: 'precise', delayMs: 100 }),
    })
    await auto.start()
    await auto.setImage('p', photo())
    auto.tap(add(60, 50))
    expect(statusLines(last())).toEqual(['Cutting out…'])
    await vi.advanceTimersByTimeAsync(10)
    const fast = await direct('fast', [add(60, 50)])
    expect(history.current).toEqual(fast.selection)
    expect(statusLines(last())).toEqual(['Sharpening…'])
    await vi.advanceTimersByTimeAsync(100)
    const precise = await direct('precise', [add(60, 50)])
    expect(history.current).toEqual(precise.selection)
    expect(last().phase).toBe('done')
    expect(last().modelAlpha).toEqual(precise.alpha)
    expect(statusLines(last())).toEqual([])
  })

  it('should_never_apply_a_stale_precise_result (AC-11)', async () => {
    // The precise engine adds a marker disc, so its results differ from the fast ones.
    const mark = add(185, 85)
    const base = createFakeEngine({ name: 'precise', delayMs: 100 })
    const p = recording({
      ...base,
      segment: (id, taps) => base.segment(id, [...taps, mark]),
    })
    const { auto, history } = setup({ precise: p.engine })
    await auto.start()
    await auto.setImage('p', photo())
    auto.tap(add(60, 50))
    await vi.advanceTimersByTimeAsync(50)
    auto.tap(add(140, 50))
    // From tap B on, the precise result for [A] (due at 100 ms) must never show.
    const seen: unknown[] = []
    const unsubscribe = setInterval(() => seen.push(history.current), 1)
    await vi.advanceTimersByTimeAsync(300)
    clearInterval(unsubscribe)
    const staleA = (await direct('precise', [add(60, 50), mark])).selection
    expect(seen).not.toContainEqual(staleA)
    expect(history.current).toEqual(
      (await direct('precise', [add(60, 50), add(140, 50), mark])).selection,
    )
    expect(p.calls).toEqual([1, 2])
  })

  it('should_keep_user_edits_when_the_precise_result_arrives (AC-12, AC-14)', async () => {
    const { auto, history, last } = setup()
    await auto.start()
    await auto.setImage('p', photo())
    auto.tap(add(60, 50))
    await vi.advanceTimersByTimeAsync(10)
    const ring = history.current.rings[0]?.nodes[0]
    history.execute({
      type: 'moveNode',
      ring: 0,
      node: 0,
      to: { x: (ring?.x ?? 0) + 3, y: ring?.y ?? 0 },
    })
    const edited = history.current
    await vi.advanceTimersByTimeAsync(100)
    expect(history.current).toBe(edited)
    expect(statusLines(last())).toEqual(['Sharper cutout ready'])
    auto.resetToAuto()
    const precise = await direct('precise', [add(60, 50)])
    expect(history.current).toEqual(precise.selection)
    expect(last().modelAlpha).toEqual(precise.alpha)
    expect(history.undo()).toBe(edited)
  })

  it('should_report_nothing_found (AC-13)', async () => {
    const { auto, history, last } = setup()
    await auto.start()
    await auto.setImage('p', photo())
    const before = history.current
    auto.tap({ imagePt: { x: 60, y: 50 }, mode: 'remove' })
    await vi.advanceTimersByTimeAsync(200)
    expect(history.current).toBe(before)
    expect(statusLines(last())).toEqual([
      'Nothing found there. Tap on the subject.',
    ])
  })

  it('should_fall_back_when_engines_are_unavailable (AC-15, AC-20)', async () => {
    const noPrecise = setup({
      precise: createFakeEngine({ name: 'precise', failLoad: 'unsupported' }),
    })
    await noPrecise.auto.start()
    await noPrecise.auto.setImage('p', photo())
    noPrecise.auto.tap(add(60, 50))
    await vi.advanceTimersByTimeAsync(10)
    expect(noPrecise.history.current).toEqual(
      (await direct('fast', [add(60, 50)])).selection,
    )
    expect(noPrecise.last().phase).toBe('done')
    expect(statusLines(noPrecise.last())).toEqual([
      'Sharper cutout not available on this device',
    ])

    const p = recording(createFakeEngine({ name: 'precise', delayMs: 100 }))
    const noFast = setup({
      fast: createFakeEngine({ name: 'fast', failLoad: 'unsupported' }),
      precise: p.engine,
    })
    await noFast.auto.start()
    await noFast.auto.setImage('p', photo())
    noFast.auto.tap(add(60, 50))
    expect(statusLines(noFast.last())).toEqual(['Cutting out…'])
    await vi.advanceTimersByTimeAsync(100)
    expect(noFast.history.current).toEqual(
      (await direct('precise', [add(60, 50)])).selection,
    )

    const none = setup({
      fast: createFakeEngine({ name: 'fast', failLoad: 'offline' }),
      precise: createFakeEngine({ name: 'precise', failLoad: 'offline' }),
    })
    await none.auto.start()
    expect(none.last().unavailable).toBe('offline')
    expect(statusLines(none.last())).toEqual([
      "You're offline. The cutout model needs one download first.",
    ])
    expect(USE_LASSO_LABEL).toBe('Use Lasso')
    none.auto.useLasso()
    expect(none.last().fallbackTool).toBe('lasso')
  })

  it('should_name_every_unavailable_reason (AC-20)', () => {
    const base: AutoState = {
      download: null,
      phase: 'idle',
      notice: null,
      unavailable: null,
      fallbackTool: null,
      modelAlpha: null,
    }
    expect(statusLines({ ...base, unavailable: 'download' })).toEqual([
      "The cutout model didn't download. Check the connection and try again.",
    ])
    expect(statusLines({ ...base, unavailable: 'storage' })).toEqual([
      'Not enough storage for the cutout model.',
    ])
    expect(statusLines({ ...base, unavailable: 'unsupported' })).toEqual([
      "Auto cutout doesn't work in this browser.",
    ])
  })

  it('should_total_the_download_before_the_first_byte (AC-16)', async () => {
    const { auto, states } = setup({
      fast: createFakeEngine({ name: 'fast', totalBytes: 20_800_000 }),
      precise: createFakeEngine({ name: 'precise', totalBytes: 30_500_000 }),
      missingBytes: 51_300_000,
    })
    await auto.start()
    const downloads = states.flatMap((s) => (s.download ? [s.download] : []))
    expect(downloads[0]).toEqual({ loadedBytes: 0, totalBytes: 51_300_000 })
    expect(
      statusLines({
        ...(states[0] as AutoState),
        download: downloads[0] ?? null,
      }),
    ).toEqual(['Downloading cutout model: 0.0 of 51.3 MB'])
    for (let k = 1; k < downloads.length; k++) {
      expect(downloads[k]?.loadedBytes).toBeGreaterThanOrEqual(
        downloads[k - 1]?.loadedBytes ?? 0,
      )
      expect(downloads[k]?.totalBytes).toBe(51_300_000)
    }
    expect(downloads.at(-1)?.loadedBytes).toBe(51_300_000)
    expect(states.at(-1)?.download).toBeNull()
  })

  it('should_queue_a_tap_made_during_download', async () => {
    let release: () => void = () => undefined
    const slow = createFakeEngine({ name: 'fast', delayMs: 10 })
    const gated: SegmentationEngine = {
      ...slow,
      load: (p) =>
        new Promise<void>((resolve) => {
          release = () => {
            void slow.load(p).then(resolve)
          }
        }),
    }
    const { auto, history } = setup({ fast: gated })
    const started = auto.start()
    await auto.setImage('p', photo())
    auto.tap(add(60, 50))
    auto.tap(add(140, 50))
    await vi.advanceTimersByTimeAsync(50)
    expect(history.current).toEqual(emptySelection())
    release()
    await started
    await vi.advanceTimersByTimeAsync(10)
    expect(history.current).toEqual(
      (await direct('fast', [add(60, 50), add(140, 50)])).selection,
    )
  })

  it('should_drop_results_for_an_old_photo', async () => {
    const { auto, history } = setup()
    await auto.start()
    await auto.setImage('p', photo())
    auto.tap(add(60, 50))
    await auto.setImage('q', photo())
    await vi.advanceTimersByTimeAsync(200)
    expect(history.current).toEqual(emptySelection())
    auto.resetToAuto()
    expect(history.current).toEqual(emptySelection())
  })

  // Final review fixes (spec 0007)

  it('should_clear_the_cutout_for_a_new_photo', async () => {
    const { auto, history, last } = setup()
    await auto.start()
    await auto.setImage('p', photo())
    auto.tap(add(60, 50))
    await vi.advanceTimersByTimeAsync(200)
    expect(history.current.rings.length).toBeGreaterThan(0)
    await auto.setImage('q', photo())
    expect(history.current).toEqual(emptySelection())
    expect(last().modelAlpha).toBeNull()
  })

  it('should_ignore_a_tap_outside_the_photo', async () => {
    const f = recording(createFakeEngine({ name: 'fast', delayMs: 10 }))
    const { auto, history } = setup({ fast: f.engine })
    await auto.start()
    await auto.setImage('p', photo())
    auto.tap(add(200, 50))
    auto.tap(add(-1, 5))
    auto.tap(add(Number.NaN, 5))
    await vi.advanceTimersByTimeAsync(200)
    expect(f.calls).toEqual([])
    auto.tap(add(60, 50))
    await vi.advanceTimersByTimeAsync(200)
    expect(history.current).toEqual(
      (await direct('precise', [add(60, 50)])).selection,
    )
  })

  it('should_retry_a_failed_download_on_the_next_tap (AC-20)', async () => {
    const fast = flaky('fast', 'offline')
    const precise = flaky('precise', 'offline')
    const { auto, history, last } = setup({
      fast: fast.engine,
      precise: precise.engine,
    })
    await auto.start()
    expect(last().unavailable).toBe('offline')
    await auto.setImage('p', photo())
    auto.tap(add(60, 50))
    expect(last().unavailable).toBeNull()
    await vi.advanceTimersByTimeAsync(200)
    expect(fast.counter.loads).toBe(2)
    expect(history.current).toEqual(
      (await direct('precise', [add(60, 50)])).selection,
    )
  })

  it('should_retry_the_precise_download_alone', async () => {
    // Fails at start, on the photo's retry and on the tap's retry.
    const precise = flaky('precise', 'download', 3)
    const f = recording(createFakeEngine({ name: 'fast', delayMs: 10 }))
    const { auto, history, last } = setup({
      fast: f.engine,
      precise: precise.engine,
    })
    await auto.start()
    await auto.setImage('p', photo())
    auto.tap(add(60, 50))
    await vi.advanceTimersByTimeAsync(200)
    expect(statusLines(last())).toEqual([
      'Sharper cutout not available on this device',
    ])
    auto.retry()
    await vi.advanceTimersByTimeAsync(200)
    expect(precise.counter.loads).toBe(4)
    expect(history.current).toEqual(
      (await direct('precise', [add(60, 50)])).selection,
    )
    expect(statusLines(last())).toEqual([])
  })

  it('should_not_download_when_the_browser_cannot_run_auto (AC-20)', async () => {
    const fast = flaky('fast', 'offline', 0)
    const precise = flaky('precise', 'offline', 0)
    let asked = 0
    const { auto, last } = setup({
      fast: fast.engine,
      precise: precise.engine,
      supported: () => false,
      missingBytes: () => {
        asked++
        return Promise.resolve(51_300_000)
      },
    })
    await auto.start()
    expect(fast.counter.loads + precise.counter.loads + asked).toBe(0)
    expect(last().unavailable).toBe('unsupported')
  })

  it('should_report_unavailable_when_storage_throws (AC-20)', async () => {
    const { auto, last } = setup({
      missingBytes: () =>
        Promise.reject(new DOMException('no', 'SecurityError')),
    })
    await expect(auto.start()).resolves.toBeUndefined()
    expect(last().unavailable).toBe('unsupported')
    expect(statusLines(last())).toEqual([
      "Auto cutout doesn't work in this browser.",
    ])
  })

  it('should_clear_the_selection_when_the_only_subject_is_removed (AC-13)', async () => {
    const { auto, history, last } = setup()
    await auto.start()
    await auto.setImage('p', photo())
    auto.tap(add(60, 50))
    await vi.advanceTimersByTimeAsync(200)
    expect(history.current.rings.length).toBeGreaterThan(0)
    auto.tap({ imagePt: { x: 60, y: 50 }, mode: 'remove' })
    await vi.advanceTimersByTimeAsync(200)
    expect(history.current).toEqual(emptySelection())
    expect(last().modelAlpha).toBeNull()
    expect(statusLines(last())).toEqual([])
  })
})
