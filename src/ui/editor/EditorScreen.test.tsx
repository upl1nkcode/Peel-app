import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RgbaImage } from '../../core/mask'
import type { Tap } from '../../core/segmentation'
import type { Selection } from '../../core/selection/types'
import {
  createFakeEngine,
  EngineUnavailable,
  type SegmentationEngine,
} from '../../services/segmentation'
import { PhotoUnreadableError } from '../../services/photo'
import { EditorScreen, type Renderer } from './EditorScreen'

const PHOTO: RgbaImage = {
  width: 100,
  height: 50,
  data: new Uint8Array(100 * 50 * 4).fill(200),
}

const loaded = (file: Blob) => ({
  image: PHOTO,
  bytes: new Uint8Array([1, 2, 3]),
  type: file.type,
})

function recording(engine: SegmentationEngine) {
  const calls: Tap[][] = []
  return {
    calls,
    engine: {
      ...engine,
      segment(imageId, taps) {
        calls.push([...taps])
        return engine.segment(imageId, taps)
      },
    } satisfies SegmentationEngine,
  }
}

/** Every selection the preview was asked to render, in order. */
let rendered: Selection[] = []
const lastRendered = () => rendered.at(-1)

const fakeRenderer = (): Renderer => ({
  setImage: () => undefined,
  setModelAlpha: () => undefined,
  renderFull: () => Promise.resolve({ type: 'cancelled' as const }),
  render: (_id, selection, scale) => {
    rendered.push(selection)
    return Promise.resolve({
      type: 'rendered' as const,
      jobId: 1,
      mask: {
        width: Math.round(100 * scale),
        height: Math.round(50 * scale),
        data: new Uint8Array(Math.round(100 * scale) * Math.round(50 * scale)),
      },
    })
  },
})

function mount(
  fast: SegmentationEngine,
  precise: SegmentationEngine,
  clock: { t: number },
  supported?: () => boolean,
) {
  render(
    <EditorScreen
      engines={{ fast, precise }}
      {...(supported && { supported })}
      missingBytes={() => Promise.resolve(0)}
      createRenderer={fakeRenderer}
      loadPhoto={(file) => Promise.resolve(loaded(file))}
      now={() => clock.t}
    />,
  )
}

/** Picks a photo and waits for it; the canvas is 200×100 CSS px at (10, 20). */
async function choose() {
  const before = screen.queryByTestId('photo')
  fireEvent.change(screen.getByLabelText('Pick a photo'), {
    target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] },
  })
  await waitFor(() => {
    const now = screen.queryByTestId('photo')
    expect(now).not.toBeNull()
    expect(now).not.toBe(before)
  })
  const canvas = screen.getByTestId('canvas')
  canvas.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 20,
      width: 200,
      height: 100,
      right: 210,
      bottom: 120,
    }) as DOMRect
  return canvas
}

async function pick(
  fast: SegmentationEngine,
  precise: SegmentationEngine,
  clock: { t: number },
  supported?: () => boolean,
) {
  mount(fast, precise, clock, supported)
  return choose()
}

const press = (
  canvas: HTMLElement,
  clock: { t: number },
  at: { x: number; y: number },
  heldMs: number,
) => {
  fireEvent.pointerDown(canvas, { clientX: at.x, clientY: at.y, pointerId: 1 })
  clock.t += heldMs
  fireEvent.pointerUp(canvas, { clientX: at.x, clientY: at.y, pointerId: 1 })
}

// jsdom has no 2D canvas; the screen skips drawing without one.
beforeEach(() => {
  rendered = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

const button = (name: string) => screen.getByRole('button', { name })
/** Only the fast engine works, so each tap gives exactly one result. */
const fastOnly = () => ({
  fast: createFakeEngine({ name: 'fast' }),
  precise: createFakeEngine({ name: 'precise', failLoad: 'unsupported' }),
})
const phase = () => screen.getByTestId('editor').getAttribute('data-phase')

describe('EditorScreen', () => {
  it('should_cut_out_on_tap_and_remove_on_long_press (AC-24)', async () => {
    const clock = { t: 1000 }
    const fast = recording(createFakeEngine({ name: 'fast' }))
    const precise = recording(
      createFakeEngine({ name: 'precise', delayMs: 50 }),
    )
    const canvas = await pick(fast.engine, precise.engine, clock)
    // Screen (110, 70) is canvas (100, 50) of 200×100 → image (50, 25).
    press(canvas, clock, { x: 110, y: 70 }, 100)
    expect(await screen.findByText('Sharpening…')).toBeInTheDocument()
    expect(fast.calls[0]).toEqual([{ imagePt: { x: 50, y: 25 }, mode: 'add' }])
    press(canvas, clock, { x: 30, y: 40 }, 600)
    await screen.findByText('Sharpening…')
    expect(fast.calls[1]?.[1]).toEqual({
      imagePt: { x: 10, y: 10 },
      mode: 'remove',
    })
    // A press that moves aims, and adds where it lifts (spec 0009 AC-16):
    // screen (80, 50) is canvas (70, 30) → image (35, 15).
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 80, clientY: 50, pointerId: 1 })
    await waitFor(() => {
      expect(fast.calls).toHaveLength(3)
    })
    expect(fast.calls[2]?.[2]).toEqual({
      imagePt: { x: 35, y: 15 },
      mode: 'add',
    })
    expect(
      (await screen.findByTestId('editor')).getAttribute('data-phase'),
    ).toMatch(/sharpening|done/)
  })

  it('should_tap_where_the_finger_went_down (AC-24)', async () => {
    const clock = { t: 0 }
    const fast = recording(createFakeEngine({ name: 'fast' }))
    const canvas = await pick(
      fast.engine,
      createFakeEngine({ name: 'precise', delayMs: 50 }),
      clock,
    )
    // Down on the right edge (screen 210 → image 100, clamped inside), up 6 px past it.
    fireEvent.pointerDown(canvas, { clientX: 210, clientY: 70, pointerId: 1 })
    clock.t += 100
    fireEvent.pointerUp(canvas, { clientX: 216, clientY: 70, pointerId: 1 })
    await screen.findByText('Sharpening…')
    expect(fast.calls[0]).toEqual([
      { imagePt: { x: 99.5, y: 25 }, mode: 'add' },
    ])
  })

  it('should_drop_a_waiting_tap_when_a_new_photo_is_picked (spec 0009 Review Focus 3)', async () => {
    const clock = { t: 0 }
    const fast = recording(createFakeEngine({ name: 'fast' }))
    const canvas = await pick(
      fast.engine,
      createFakeEngine({ name: 'precise' }),
      clock,
    )
    press(canvas, clock, { x: 110, y: 70 }, 50)
    const before = screen.getByTestId('photo')
    fireEvent.change(screen.getByLabelText('Pick a photo'), {
      target: { files: [new File(['y'], 'next.png', { type: 'image/png' })] },
    })
    await waitFor(() => {
      expect(screen.getByTestId('photo')).not.toBe(before)
    })
    await new Promise((done) => setTimeout(done, 400))
    expect(fast.calls).toEqual([])
  })

  it('should_offer_lasso_when_auto_is_unavailable (AC-20)', async () => {
    const clock = { t: 0 }
    await pick(
      createFakeEngine({ name: 'fast', failLoad: 'unsupported' }),
      createFakeEngine({ name: 'precise', failLoad: 'unsupported' }),
      clock,
    )
    expect(
      await screen.findByText("Auto cutout doesn't work in this browser."),
    ).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Use Lasso' })
    fireEvent.click(button)
    expect(screen.getByTestId('editor').getAttribute('data-fallback')).toBe(
      'lasso',
    )
  })

  it('should_retry_when_the_connection_returns (AC-20)', async () => {
    const offlineOnce = (name: 'fast' | 'precise'): SegmentationEngine => {
      const base = createFakeEngine({ name })
      let loads = 0
      return {
        ...base,
        load: (p) =>
          ++loads === 1
            ? Promise.reject(new EngineUnavailable('offline'))
            : base.load(p),
      }
    }
    await pick(offlineOnce('fast'), offlineOnce('precise'), { t: 0 })
    const offline = "You're offline. The cutout model needs one download first."
    expect(await screen.findByText(offline)).toBeInTheDocument()
    fireEvent(window, new Event('online'))
    await waitFor(() => {
      expect(screen.queryByText(offline)).toBeNull()
    })
    expect(screen.queryByRole('button', { name: 'Use Lasso' })).toBeNull()
  })

  it('should_not_start_downloads_in_a_browser_that_cannot_run_auto (AC-20)', async () => {
    let loads = 0
    const counted = (name: 'fast' | 'precise'): SegmentationEngine => {
      const base = createFakeEngine({ name })
      return { ...base, load: (p) => (loads++, base.load(p)) }
    }
    await pick(counted('fast'), counted('precise'), { t: 0 }, () => false)
    expect(
      await screen.findByText("Auto cutout doesn't work in this browser."),
    ).toBeInTheDocument()
    expect(loads).toBe(0)
  })

  it('should_keep_the_photo_when_a_file_cannot_be_opened (spec 0008 AC-3)', async () => {
    let fail = false
    render(
      <EditorScreen
        engines={{
          fast: createFakeEngine({ name: 'fast' }),
          precise: createFakeEngine({ name: 'precise' }),
        }}
        missingBytes={() => Promise.resolve(0)}
        createRenderer={fakeRenderer}
        loadPhoto={(file) =>
          fail
            ? Promise.reject(new PhotoUnreadableError())
            : Promise.resolve(loaded(file))
        }
      />,
    )
    const input = screen.getByLabelText('Pick a photo')
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByTestId('photo')
    const stage = screen.getByTestId('canvas')
    expect(stage.getAttribute('data-image-size')).toBe('100x50')

    fail = true
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This photo can't be opened. Try a JPEG or PNG.",
    )
    expect(stage.getAttribute('data-image-size')).toBe('100x50')
    expect(screen.getByTestId('photo')).toBeInTheDocument()

    fail = false
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  it('should_enable_undo_and_redo_only_when_possible (spec 0009 AC-19)', async () => {
    const clock = { t: 0 }
    const { fast, precise } = fastOnly()
    mount(fast, precise, clock)
    expect(button('Undo')).toBeDisabled()
    expect(button('Redo')).toBeDisabled()
    const canvas = await choose()
    expect(button('Undo')).toBeDisabled()
    press(canvas, clock, { x: 110, y: 70 }, 100)
    await waitFor(() => {
      expect(button('Undo')).toBeEnabled()
    })
    expect(button('Redo')).toBeDisabled()
    fireEvent.click(button('Undo'))
    await waitFor(() => {
      expect(lastRendered()?.rings).toHaveLength(0)
    })
    expect(button('Undo')).toBeDisabled()
    expect(button('Redo')).toBeEnabled()
    fireEvent.click(button('Redo'))
    await waitFor(() => {
      expect(lastRendered()?.rings.length).toBeGreaterThan(0)
    })
    expect(button('Redo')).toBeDisabled()
  })

  it('should_not_undo_into_the_previous_photo (spec 0009 AC-19)', async () => {
    const clock = { t: 0 }
    const { fast, precise } = fastOnly()
    const canvas = await pick(fast, precise, clock)
    press(canvas, clock, { x: 110, y: 70 }, 100)
    await waitFor(() => {
      expect(button('Undo')).toBeEnabled()
    })
    await choose()
    await waitFor(() => {
      expect(button('Undo')).toBeDisabled()
    })
    expect(button('Redo')).toBeDisabled()
  })

  it('should_offer_reset_to_auto_only_after_a_result (spec 0009 AC-20)', async () => {
    const clock = { t: 0 }
    const { fast, precise } = fastOnly()
    const canvas = await pick(fast, precise, clock)
    const reset = () => screen.queryByRole('button', { name: 'Reset to auto' })
    expect(reset()).toBeNull()
    press(canvas, clock, { x: 110, y: 70 }, 100)
    await waitFor(() => {
      expect(reset()).toBeDisabled()
    })
    await waitFor(() => {
      expect(phase()).toBe('done')
    })
    const result = lastRendered()
    fireEvent.click(button('Undo'))
    await waitFor(() => {
      expect(reset()).toBeEnabled()
    })
    fireEvent.click(button('Reset to auto'))
    await waitFor(() => {
      expect(reset()).toBeDisabled()
    })
    expect(lastRendered()).toEqual(result)
    expect(button('Undo')).toBeEnabled()
  })

  it('should_show_the_original_while_compare_is_held (spec 0009 AC-18)', async () => {
    const clock = { t: 0 }
    const { fast, precise } = fastOnly()
    const canvas = await pick(fast, precise, clock)
    const compare = button('Compare')
    expect(canvas).toHaveAttribute('data-comparing', 'false')
    fireEvent.pointerDown(compare, { pointerId: 5 })
    expect(canvas).toHaveAttribute('data-comparing', 'true')
    fireEvent.pointerUp(compare, { pointerId: 5 })
    expect(canvas).toHaveAttribute('data-comparing', 'false')
    fireEvent.pointerDown(compare, { pointerId: 5 })
    fireEvent.pointerLeave(compare, { pointerId: 5 })
    expect(canvas).toHaveAttribute('data-comparing', 'false')
    fireEvent.pointerDown(compare, { pointerId: 5 })
    fireEvent.pointerCancel(compare, { pointerId: 5 })
    expect(canvas).toHaveAttribute('data-comparing', 'false')
    fireEvent.keyDown(compare, { key: ' ' })
    expect(canvas).toHaveAttribute('data-comparing', 'true')
    fireEvent.keyDown(compare, { key: ' ', repeat: true })
    expect(canvas).toHaveAttribute('data-comparing', 'true')
    fireEvent.keyUp(compare, { key: ' ' })
    expect(canvas).toHaveAttribute('data-comparing', 'false')
    fireEvent.keyDown(compare, { key: 'Enter' })
    expect(canvas).toHaveAttribute('data-comparing', 'true')
    fireEvent.keyUp(compare, { key: 'Enter' })
    expect(canvas).toHaveAttribute('data-comparing', 'false')
  })

  it('should_name_every_control_and_mark_the_active_tool (spec 0009 AC-22)', async () => {
    const { fast, precise } = fastOnly()
    await pick(fast, precise, { t: 0 })
    for (const b of screen.getAllByRole('button')) {
      expect((b.getAttribute('aria-label') ?? b.textContent).trim()).not.toBe(
        '',
      )
    }
    expect(button('Auto')).toHaveAttribute('aria-pressed', 'true')
    expect(button('View')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button('View'))
    expect(button('View')).toHaveAttribute('aria-pressed', 'true')
    const views = screen.getByRole('radiogroup', { name: 'View' })
    expect(views).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Overlay' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('should_open_the_tool_sheet_and_toggle_it (spec 0009 AC-23)', async () => {
    const { fast, precise } = fastOnly()
    await pick(fast, precise, { t: 0 })
    const hint = 'Tap to add · Hold to remove · Slide to aim'
    expect(screen.getByText(hint)).toBeInTheDocument()
    fireEvent.click(button('View'))
    expect(screen.queryByText(hint)).toBeNull()
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Overlay',
      'Checkerboard',
      'Black',
      'White',
      'Red',
    ])
    fireEvent.click(button('View'))
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    fireEvent.click(button('View'))
    fireEvent.click(screen.getByRole('radio', { name: 'Red' }))
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-view', 'red')
    fireEvent.click(button('Auto'))
    expect(screen.getByText(hint)).toBeInTheDocument()
    await choose()
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-view', 'red')
    fireEvent.click(button('View'))
    expect(screen.getByRole('radio', { name: 'Red' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('should_disable_tools_until_a_photo_is_picked (spec 0009 AC-24)', async () => {
    const { fast, precise } = fastOnly()
    mount(fast, precise, { t: 0 })
    expect(button('Pick a photo')).toBeEnabled()
    for (const name of ['Auto', 'View', 'Undo', 'Redo', 'Compare']) {
      expect(button(name)).toBeDisabled()
    }
    await choose()
    expect(screen.queryByRole('button', { name: 'Pick a photo' })).toBeNull()
    for (const name of ['Auto', 'View', 'Compare']) {
      expect(button(name)).toBeEnabled()
    }
  })
})
