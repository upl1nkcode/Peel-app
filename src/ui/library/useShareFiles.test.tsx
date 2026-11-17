import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_FINISH, type FinishSettings } from '../../core/sticker'
import type { StickerRecord } from '../../core/backup'
import type { StickerStore } from '../../services/storage'
import type { FromRenderWorker } from '../../workers/protocol'
import {
  useShareFiles,
  type ShareDeps,
  type ShareRenderer,
} from './useShareFiles'

const AT_0905 = new Date(2026, 10, 17, 9, 5)

const record = (id: string, finish?: FinishSettings): StickerRecord =>
  ({
    id,
    sticker: Uint8Array.from([id.charCodeAt(0)]),
    ...(finish && { finish }),
  }) as unknown as StickerRecord

const WHATSAPP: FinishSettings = { ...DEFAULT_FINISH, output: 'whatsapp' }

/** A renderer whose jobs resolve when the test says. */
function fakeRenderer() {
  const jobs: {
    png: Uint8Array
    settings: FinishSettings
    resolve: (r: FromRenderWorker) => void
  }[] = []
  const terminate = vi.fn()
  const renderer: ShareRenderer = {
    finishSaved: (png, settings) =>
      new Promise((resolve) => {
        jobs.push({ png, settings, resolve })
      }),
    terminate,
  }
  const finishNext = async () => {
    const job = jobs.shift()
    if (!job) throw new Error('no job waiting')
    const mime = job.settings.output === 'whatsapp' ? 'image/webp' : 'image/png'
    await act(async () => {
      job.resolve({
        type: 'finished',
        jobId: 1,
        bytes: job.png,
        mime,
        width: 1,
        height: 1,
      })
      await Promise.resolve()
    })
  }
  const failNext = async () => {
    const job = jobs.shift()
    if (!job) throw new Error('no job waiting')
    await act(async () => {
      job.resolve({ type: 'finishFailed', jobId: 1, reason: 'tooLarge' })
      await Promise.resolve()
    })
  }
  return { renderer, jobs, terminate, finishNext, failNext }
}

function setup(
  records: Record<string, StickerRecord>,
  nav: Pick<Navigator, 'share' | 'canShare'>,
) {
  const fake = fakeRenderer()
  const createRenderer = vi.fn(() => fake.renderer)
  const store = {
    get: (id: string) => Promise.resolve(records[id]),
  } as unknown as StickerStore
  const deps: ShareDeps = {
    store,
    createRenderer,
    now: () => AT_0905,
    nav,
  }
  const hook = renderHook(
    ({ ticked }: { ticked: readonly string[] }) => useShareFiles(ticked, deps),
    { initialProps: { ticked: [] as readonly string[] } },
  )
  const tick = async (ticked: readonly string[]) => {
    await act(async () => {
      hook.rerender({ ticked })
      await Promise.resolve()
      await Promise.resolve()
    })
  }
  return { ...fake, hook, tick, createRenderer }
}

const sharing = () => {
  const share = vi.fn<(data: ShareData) => Promise<void>>(() =>
    Promise.resolve(),
  )
  const canShare = vi.fn<(data?: ShareData) => boolean>(() => true)
  return { share, canShare }
}

const namesOf = (data: ShareData | undefined) =>
  (data?.files ?? []).map((f) => [f.name, f.type])

describe('useShareFiles (spec 0013)', () => {
  it('should_prepare_files_in_tick_order_and_share_at_once (AC-8)', async () => {
    const nav = sharing()
    const env = setup({ a: record('a'), b: record('b', WHATSAPP) }, nav)
    expect(env.createRenderer).not.toHaveBeenCalled()
    await env.tick(['a', 'b'])
    expect(env.createRenderer).toHaveBeenCalledTimes(1)
    expect(env.hook.result.current.preparing).toBe(true)
    expect(env.jobs).toHaveLength(1)
    expect(env.jobs[0]?.png).toEqual(Uint8Array.from([97]))
    await env.finishNext()
    expect(env.hook.result.current.preparing).toBe(true)
    expect(env.jobs[0]?.settings).toEqual(WHATSAPP)
    await env.finishNext()
    expect(env.hook.result.current.preparing).toBe(false)
    expect(env.hook.result.current.shown).toBe(true)

    act(() => {
      env.hook.result.current.onShare()
    })
    expect(nav.share).toHaveBeenCalledTimes(1)
    expect(namesOf(nav.share.mock.calls[0]?.[0])).toEqual([
      ['peel-sticker-2026-11-17-0905.png', 'image/png'],
      ['peel-sticker-2026-11-17-0905-whatsapp.webp', 'image/webp'],
    ])

    await env.tick([])
    expect(env.terminate).toHaveBeenCalledTimes(1)
  })

  it('should_suffix_colliding_names (Review Focus 5)', async () => {
    const nav = sharing()
    const env = setup({ a: record('a'), b: record('b') }, nav)
    await env.tick(['a', 'b'])
    await env.finishNext()
    await env.finishNext()
    act(() => {
      env.hook.result.current.onShare()
    })
    expect(namesOf(nav.share.mock.calls[0]?.[0])).toEqual([
      ['peel-sticker-2026-11-17-0905.png', 'image/png'],
      ['peel-sticker-2026-11-17-0905-2.png', 'image/png'],
    ])
  })

  it('should_untick_a_sticker_gone_from_the_store (Review Focus 5)', async () => {
    const nav = sharing()
    const env = setup({ a: record('a') }, nav)
    await env.tick(['a', 'b'])
    await env.finishNext()
    await act(async () => {
      await Promise.resolve()
    })
    expect(env.jobs).toHaveLength(0)
    expect(env.hook.result.current.preparing).toBe(false)
    act(() => {
      env.hook.result.current.onShare()
    })
    expect(namesOf(nav.share.mock.calls[0]?.[0])).toEqual([
      ['peel-sticker-2026-11-17-0905.png', 'image/png'],
    ])
  })

  it('should_drop_a_file_when_its_tick_goes (AC-8)', async () => {
    const nav = sharing()
    const env = setup({ a: record('a'), b: record('b'), c: record('c') }, nav)
    await env.tick(['a', 'b'])
    await env.finishNext()
    await env.tick(['b', 'c'])
    await env.finishNext()
    await env.finishNext()
    act(() => {
      env.hook.result.current.onShare()
    })
    expect(nav.share.mock.calls[0]?.[0]?.files).toHaveLength(2)
    expect(env.createRenderer).toHaveBeenCalledTimes(1)
  })

  it('should_hide_share_without_file_sharing (AC-8)', async () => {
    const nav = sharing()
    nav.canShare.mockImplementation(
      (data) => !data?.files?.some((f) => f.type === 'image/webp'),
    )
    const env = setup({ a: record('a'), b: record('b', WHATSAPP) }, nav)
    await env.tick(['a'])
    await env.finishNext()
    expect(env.hook.result.current.shown).toBe(true)
    await env.tick(['a', 'b'])
    await env.finishNext()
    expect(env.hook.result.current.shown).toBe(false)
  })

  it('should_prepare_nothing_where_files_cannot_be_shared (AC-8)', async () => {
    // navigator.share exists (as on desktop Linux Chrome) but takes no files.
    const nav = sharing()
    nav.canShare.mockReturnValue(false)
    const env = setup({ a: record('a') }, nav)
    await env.tick(['a'])
    expect(env.createRenderer).not.toHaveBeenCalled()
    expect(env.hook.result.current.shown).toBe(false)
    expect(env.hook.result.current.preparing).toBe(false)
  })

  it('should_treat_a_closed_sheet_as_no_error (AC-8)', async () => {
    const nav = sharing()
    const env = setup({ a: record('a') }, nav)
    await env.tick(['a'])
    await env.finishNext()
    nav.share.mockRejectedValueOnce(
      Object.assign(new Error('closed'), { name: 'AbortError' }),
    )
    await act(async () => {
      env.hook.result.current.onShare()
      await Promise.resolve()
    })
    expect(env.hook.result.current.message).toBeNull()
    nav.share.mockRejectedValueOnce(
      Object.assign(new Error('no'), { name: 'NotAllowedError' }),
    )
    await act(async () => {
      env.hook.result.current.onShare()
      await Promise.resolve()
    })
    expect(env.hook.result.current.message).toBe(
      "Couldn't share. Try Export instead.",
    )
  })

  it('should_say_when_a_file_cannot_be_made (AC-8)', async () => {
    const nav = sharing()
    const env = setup({ a: record('a') }, nav)
    await env.tick(['a'])
    await env.failNext()
    expect(env.hook.result.current.preparing).toBe(false)
    act(() => {
      env.hook.result.current.onShare()
    })
    expect(nav.share).not.toHaveBeenCalled()
    expect(env.hook.result.current.message).toBe(
      "Couldn't share. Try Export instead.",
    )
  })
})
