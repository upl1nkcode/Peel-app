import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderMask, type RgbaImage } from '../../core/mask'
import { storedDeflate } from '../../core/png'
import type { Selection } from '../../core/selection/types'
import type { FinishSettings } from '../../core/sticker'
import { testInflate, testInflateRaw } from '../../core/testing/codecs'
import { createFakeEngine } from '../../services/segmentation'
import { openStickerStore, type StickerStore } from '../../services/storage'
import type { LoadedPhoto } from '../../services/photo'
import type { FromRenderWorker } from '../../workers/protocol'
import type { Cancelled } from '../../services/workerClient'
import { EditorScreen, type Renderer } from '../editor/EditorScreen'

const image = (width: number, height: number): RgbaImage => ({
  width,
  height,
  data: new Uint8Array(width * height * 4).fill(200),
})

interface FinishCall {
  kind: 'finish' | 'finishPreview'
  selection: Selection
  settings: FinishSettings
  resolve: (res: FromRenderWorker | Cancelled) => void
}

let calls: FinishCall[] = []
const finishCalls = () => calls.filter((c) => c.kind === 'finish')
const lastFinish = () => finishCalls().at(-1) as FinishCall

function fakeRenderer(): Renderer {
  const sizes = new Map<string, { width: number; height: number }>()
  const job =
    (kind: FinishCall['kind']) =>
    (_id: string, selection: Selection, settings: FinishSettings) =>
      new Promise<FromRenderWorker | Cancelled>((resolve) => {
        calls.push({ kind, selection, settings, resolve })
      })
  return {
    setImage: (id, img) => {
      sizes.set(id, { width: img.width, height: img.height })
    },
    setModelAlpha: () => undefined,
    render: (id, selection, scale) =>
      Promise.resolve({
        type: 'rendered' as const,
        jobId: 1,
        mask: renderMask(selection, sizes.get(id) ?? { width: 1, height: 1 }, {
          scale,
        }),
      }),
    renderFull: (id, selection) =>
      Promise.resolve({
        type: 'rendered' as const,
        jobId: 2,
        mask: renderMask(selection, sizes.get(id) ?? { width: 1, height: 1 }),
      }),
    resimplify: () => Promise.resolve({ type: 'cancelled' as const }),
    fitRing: () => Promise.resolve({ type: 'cancelled' as const }),
    finish: job('finish'),
    finishPreview: job('finishPreview'),
  }
}

/** Replies to a finish job with a 2 KB file of the given size. */
async function made(call: FinishCall, width: number, height: number) {
  await act(async () => {
    call.resolve({
      type: 'finished',
      jobId: 1,
      bytes: new Uint8Array(2048),
      mime: call.settings.output === 'whatsapp' ? 'image/webp' : 'image/png',
      width,
      height,
    })
    await Promise.resolve()
  })
}

async function failedWith(
  call: FinishCall,
  reason: 'empty' | 'tooLarge' | 'encoderUnavailable',
) {
  await act(async () => {
    call.resolve({ type: 'finishFailed', jobId: 1, reason })
    await Promise.resolve()
  })
}

function setup(store?: Promise<StickerStore>) {
  return render(
    <EditorScreen
      engines={{
        fast: createFakeEngine({ name: 'fast' }),
        precise: createFakeEngine({ name: 'precise' }),
      }}
      missingBytes={() => Promise.resolve(0)}
      createRenderer={fakeRenderer}
      loadPhoto={(f: Blob): Promise<LoadedPhoto> =>
        Promise.resolve({
          image: image(100, 50),
          bytes: new Uint8Array([1, 2, 3]),
          type: f.type,
        })
      }
      stickers={{
        store: store ?? openStickerStore(new IDBFactory()),
        storage: undefined,
        codecs: {
          deflate: storedDeflate,
          inflate: testInflate,
          inflateRaw: testInflateRaw,
        },
        clock: () => Date.now(),
      }}
    />,
  )
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const done = () => button('Done')

/** Picks a photo and taps it, so the selection has a ring. */
async function cutPhoto() {
  const before = screen.queryByTestId('photo')
  fireEvent.change(screen.getByLabelText('Pick a photo'), {
    target: { files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })] },
  })
  await waitFor(() => {
    const now = screen.queryByTestId('photo')
    expect(now).not.toBeNull()
    expect(now).not.toBe(before)
  })
  const canvas = screen.getByTestId('canvas')
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      right: 100,
      bottom: 50,
    }) as DOMRect
  fireEvent.pointerDown(canvas, { clientX: 50, clientY: 25, pointerId: 1 })
  fireEvent.pointerUp(canvas, { clientX: 50, clientY: 25, pointerId: 1 })
  await waitFor(() => {
    expect(done()).toBeEnabled()
  })
}

async function openFinish() {
  const before = finishCalls().length
  fireEvent.click(done())
  const region = await screen.findByRole('region', { name: 'Finish sticker' })
  await waitFor(() => {
    expect(finishCalls().length).toBeGreaterThan(before)
  })
  return region
}

const fileLine = () => screen.getByTestId('finish-file')
const slider = (name: string) => screen.getByRole('slider', { name })
const setSlider = (name: string, value: number) => {
  fireEvent.change(slider(name), { target: { value: String(value) } })
}
const release = (name: string) => {
  fireEvent.pointerUp(slider(name))
}

beforeEach(() => {
  calls = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  let n = 0
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:test/${String(++n)}`),
    revokeObjectURL: vi.fn(),
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Finish screen (spec 0012)', () => {
  it('should_open_from_done_only_with_a_ring (AC-8)', async () => {
    setup()
    expect(done()).toBeDisabled()
    await cutPhoto()
    const region = await openFinish()
    const inRegion = within(region)
    expect(inRegion.getByRole('button', { name: 'Back' })).toBeEnabled()
    expect(inRegion.getByRole('button', { name: /^Save(d)?$/ })).toBeVisible()
    const output = inRegion.getByRole('radiogroup', { name: 'Output' })
    expect(
      within(output)
        .getAllByRole('radio')
        .map(
          (r) =>
            r.getAttribute('aria-label') ?? r.closest('label')?.textContent,
        ),
    ).toEqual(['Sticker', 'Original', 'WhatsApp-style'])
    expect(within(output).getByRole('radio', { name: 'Sticker' })).toBeChecked()
    expect(inRegion.getByRole('switch', { name: 'Outline' })).not.toBeChecked()
    expect(inRegion.getByRole('slider', { name: 'Width' })).toBeDisabled()
    const colour = inRegion.getByRole('radiogroup', { name: 'Outline colour' })
    expect(within(colour).getByRole('radio', { name: 'White' })).toBeDisabled()
    expect(within(colour).getByRole('radio', { name: 'Black' })).toBeDisabled()
    expect(
      inRegion.getByRole('slider', { name: 'Edge softness' }),
    ).toBeEnabled()
    expect(inRegion.getByRole('slider', { name: 'Padding' })).toBeEnabled()
    // The editor stays underneath, out of reach.
    expect(screen.getByTestId('editor')).toHaveAttribute('inert')
    expect(lastFinish().settings).toEqual({
      output: 'sticker',
      outline: { on: false, widthPct: 3, color: 'white' },
      paddingPct: 0,
    })
  })

  it('should_show_the_newest_output (AC-9)', async () => {
    setup()
    await cutPhoto()
    await openFinish()
    await made(lastFinish(), 90, 40)
    expect(fileLine()).toHaveTextContent('PNG · 90 × 40 px · 2 KB')
    setSlider('Padding', 5)
    await waitFor(() => {
      expect(lastFinish().settings.paddingPct).toBe(5)
    })
    const older = lastFinish()
    setSlider('Padding', 10)
    await waitFor(() => {
      expect(lastFinish().settings.paddingPct).toBe(10)
    })
    await made(lastFinish(), 128, 78)
    await made(older, 999, 999)
    expect(fileLine()).toHaveTextContent('PNG · 128 × 78 px · 2 KB')
  })

  it('should_throttle_while_dragging (AC-9)', async () => {
    setup()
    await cutPhoto()
    await openFinish()
    await made(lastFinish(), 90, 40)
    vi.useFakeTimers()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    const before = finishCalls().length
    for (let k = 1; k <= 10; k++) {
      act(() => {
        setSlider('Padding', k)
        vi.advanceTimersByTime(10)
      })
    }
    // The first change goes at once; the rest wait for the 150 ms window.
    expect(finishCalls().length - before).toBe(1)
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(finishCalls().length - before).toBe(2)
    expect(lastFinish().settings.paddingPct).toBe(10)
  })

  it('should_preview_original_with_the_sticker_output (AC-9)', async () => {
    setup()
    await cutPhoto()
    await openFinish()
    fireEvent.click(screen.getByRole('radio', { name: 'Original' }))
    await waitFor(() => {
      expect(lastFinish().settings.output).toBe('original')
    })
    const preview = calls.filter((c) => c.kind === 'finishPreview').at(-1)
    expect(preview?.settings.output).toBe('sticker')
    await made(lastFinish(), 3000, 2000)
    expect(fileLine()).toHaveTextContent('PNG · 3000 × 2000 px · 2 KB')
  })

  it('should_show_slider_values (AC-10)', async () => {
    setup()
    await cutPhoto()
    await openFinish()
    expect(screen.getByText('Width 3%')).toBeInTheDocument()
    expect(screen.getByText('Softness 0 px')).toBeInTheDocument()
    expect(screen.getByText('Padding 0%')).toBeInTheDocument()
    expect(slider('Width')).toHaveAttribute('min', '1')
    expect(slider('Width')).toHaveAttribute('max', '6')
    expect(slider('Width')).toHaveAttribute('step', '0.5')
    expect(slider('Edge softness')).toHaveAttribute('max', '3')
    expect(slider('Edge softness')).toHaveAttribute('step', '0.25')
    expect(slider('Padding')).toHaveAttribute('max', '20')
    setSlider('Edge softness', 1.5)
    expect(screen.getByText('Softness 1.5 px')).toBeInTheDocument()
    release('Edge softness')
    await waitFor(() => {
      expect(lastFinish().selection.feather).toBe(1.5)
    })
    // One undo step in the editor brings the old softness back.
    fireEvent.click(button('Back'))
    fireEvent.click(button('Undo'))
    await openFinish()
    expect(screen.getByText('Softness 0 px')).toBeInTheDocument()
    expect(lastFinish().selection.feather).toBe(0)
  })

  it('should_keep_settings_for_a_new_photo (AC-12)', async () => {
    const first = setup()
    await cutPhoto()
    await openFinish()
    fireEvent.click(screen.getByRole('switch', { name: 'Outline' }))
    expect(slider('Width')).toBeEnabled()
    fireEvent.click(button('Back'))
    await cutPhoto()
    await openFinish()
    expect(screen.getByRole('switch', { name: 'Outline' })).toBeChecked()
    // A reload starts from the defaults.
    first.unmount()
    setup()
    await cutPhoto()
    await openFinish()
    expect(screen.getByRole('switch', { name: 'Outline' })).not.toBeChecked()
  })

  it('should_show_preparing_and_errors (AC-17, AC-5, AC-6, Review Focus 3)', async () => {
    setup()
    await cutPhoto()
    await openFinish()
    expect(fileLine()).toHaveTextContent('Preparing…')
    await failedWith(lastFinish(), 'empty')
    expect(fileLine()).toHaveTextContent('Nothing is selected yet.')
    setSlider('Padding', 1)
    await waitFor(() => {
      expect(lastFinish().settings.paddingPct).toBe(1)
    })
    expect(fileLine()).toHaveTextContent('Preparing…')
    await failedWith(lastFinish(), 'tooLarge')
    expect(fileLine()).toHaveTextContent(
      'This sticker is too detailed for WhatsApp-style (over 100 KB). Try the Sticker output.',
    )
    setSlider('Padding', 2)
    await waitFor(() => {
      expect(lastFinish().settings.paddingPct).toBe(2)
    })
    await failedWith(lastFinish(), 'encoderUnavailable')
    expect(fileLine()).toHaveTextContent(
      "Couldn't load the WebP encoder. Connect to the internet and try again.",
    )
  })

  it('should_ignore_a_late_result_after_back (Review Focus 5)', async () => {
    setup()
    await cutPhoto()
    await openFinish()
    const late = lastFinish()
    fireEvent.click(button('Back'))
    expect(screen.queryByRole('region', { name: 'Finish sticker' })).toBeNull()
    await cutPhoto()
    await openFinish()
    await made(late, 777, 777)
    expect(fileLine()).toHaveTextContent('Preparing…')
    await made(lastFinish(), 100, 50)
    expect(fileLine()).toHaveTextContent('PNG · 100 × 50 px · 2 KB')
  })

  it('should_save_the_finish_and_mark_changes_unsaved (AC-11)', async () => {
    const store = openStickerStore(new IDBFactory())
    setup(store)
    await cutPhoto()
    await openFinish()
    setSlider('Padding', 10)
    const save = () =>
      within(screen.getByRole('region', { name: 'Finish sticker' })).getByRole(
        'button',
        { name: /^Save(d)?$/ },
      )
    fireEvent.click(save())
    await waitFor(() => {
      expect(save()).toHaveTextContent('Saved')
    })
    const s = await store
    const [first] = await s.list()
    expect((await s.get(first?.id ?? ''))?.finish?.paddingPct).toBe(10)
    setSlider('Padding', 11)
    expect(save()).toHaveTextContent('Save')
    expect(save()).not.toHaveTextContent('Saved')
    // Reopen the sticker: its own settings come back.
    fireEvent.click(button('Back'))
    fireEvent.click(button('Stickers'))
    fireEvent.click(await screen.findByRole('button', { name: 'Open sticker' }))
    await waitFor(() => {
      expect(done()).toBeEnabled()
    })
    await openFinish()
    expect(await screen.findByText('Padding 10%')).toBeInTheDocument()
  })
})
