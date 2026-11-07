import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RgbaImage } from '../../core/mask'
import type { Tap } from '../../core/segmentation'
import {
  createFakeEngine,
  EngineUnavailable,
  type SegmentationEngine,
} from '../../services/segmentation'
import { PhotoUnreadableError } from '../../services/photo'
import { AutoScreen, type Renderer } from './AutoScreen'

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

const fakeRenderer = (): Renderer => ({
  setImage: () => undefined,
  setModelAlpha: () => undefined,
  renderFull: () => Promise.resolve({ type: 'cancelled' as const }),
  render: (_id, _selection, scale) =>
    Promise.resolve({
      type: 'rendered' as const,
      jobId: 1,
      mask: {
        width: Math.round(100 * scale),
        height: Math.round(50 * scale),
        data: new Uint8Array(Math.round(100 * scale) * Math.round(50 * scale)),
      },
    }),
})

async function pick(
  fast: SegmentationEngine,
  precise: SegmentationEngine,
  clock: { t: number },
  supported?: () => boolean,
) {
  render(
    <AutoScreen
      engines={{ fast, precise }}
      {...(supported && { supported })}
      missingBytes={() => Promise.resolve(0)}
      createRenderer={fakeRenderer}
      loadPhoto={(file) => Promise.resolve(loaded(file))}
      now={() => clock.t}
    />,
  )
  const input = screen.getByLabelText('Pick a photo')
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] },
  })
  const canvas = await screen.findByTestId('cutout')
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

describe('AutoScreen', () => {
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
    // A press that moves is neither.
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 80, clientY: 50, pointerId: 1 })
    expect(fast.calls).toHaveLength(2)
    expect(
      (await screen.findByTestId('auto-screen')).getAttribute('data-phase'),
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
    expect(
      screen.getByTestId('auto-screen').getAttribute('data-fallback'),
    ).toBe('lasso')
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
      <AutoScreen
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
    await screen.findByTestId('cutout')
    const stage = document.querySelector('.auto-stage')
    expect(stage?.getAttribute('data-image-size')).toBe('100x50')

    fail = true
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This photo can't be opened. Try a JPEG or PNG.",
    )
    expect(stage?.getAttribute('data-image-size')).toBe('100x50')
    expect(screen.getByTestId('cutout')).toBeInTheDocument()

    fail = false
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })
})
