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

/** What the fake renderer's resimplify does; by default it is cancelled. */
const cancelled: Renderer['resimplify'] = () =>
  Promise.resolve({ type: 'cancelled' as const })
let resimplify: Renderer['resimplify'] = cancelled

/** Every selection the preview was asked to render, in order. */
let rendered: Selection[] = []
const lastRendered = () => rendered.at(-1)

const fakeRenderer = (): Renderer => ({
  setImage: () => undefined,
  setModelAlpha: () => undefined,
  renderFull: () => Promise.resolve({ type: 'cancelled' as const }),
  resimplify: (selection, tolerancePx) => resimplify(selection, tolerancePx),
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
  resimplify = cancelled
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

describe('EditorScreen dots tool (spec 0010)', () => {
  // The photo is 100×50 on a 200×100 canvas at screen (10, 20), so it fills
  // the canvas at 2 CSS px per image px. The rectangle is 60% of it:
  // image (20,10)–(80,40), screen (50,40)–(170,100).
  const corner = (x: number, y: number) => ({ x, y, kind: 'corner' as const })
  const RECTANGLE = [
    corner(20, 10),
    corner(80, 10),
    corner(80, 40),
    corner(20, 40),
  ]
  const nudge = (dir: string) => button(`Nudge ${dir}`)
  const slider = () => screen.getByRole('slider', { name: 'Dots' })
  const dotCount = (canvas: HTMLElement) =>
    canvas.getAttribute('data-dot-count')

  async function dotsTool() {
    const clock = { t: 0 }
    const { fast, precise } = fastOnly()
    const canvas = await pick(fast, precise, clock)
    fireEvent.click(button('Dots'))
    return { canvas, clock }
  }

  /** Taps the rectangle's first dot and waits for it to be selected. */
  async function selectFirstDot(canvas: HTMLElement, clock: { t: number }) {
    press(canvas, clock, { x: 50, y: 40 }, 50)
    await waitFor(() => {
      expect(canvas).toHaveAttribute('data-selected-count', '1')
    })
  }

  /**
   * Each resimplify result keeps the first 3 dots of every ring, moved right
   * by its call number. With `cancelOlder`, a new request settles any
   * unsettled older one as cancelled, as the real client does.
   */
  function deferredResimplify({ cancelOlder = false } = {}) {
    const calls: {
      selection: Selection
      tolerancePx: number
      resolve: () => void
    }[] = []
    const cancels: (() => void)[] = []
    resimplify = (selection, tolerancePx) =>
      new Promise((resolve) => {
        if (cancelOlder) for (const cancel of cancels.splice(0)) cancel()
        const n = calls.length + 1
        let settled = false
        cancels.push(() => {
          if (settled) return
          settled = true
          resolve({ type: 'cancelled' })
        })
        calls.push({
          selection,
          tolerancePx,
          resolve: () => {
            if (settled) return
            settled = true
            resolve({
              type: 'resimplified',
              jobId: n,
              selection: {
                ...selection,
                rings: selection.rings.map((r) => ({
                  ...r,
                  nodes: r.nodes.slice(0, 3).map((p) => ({ ...p, x: p.x + n })),
                })),
              },
            })
          },
        })
      })
    return calls
  }

  it('should_show_the_dots_tool (AC-18)', async () => {
    await dotsTool()
    expect(
      screen
        .getByRole('navigation', { name: 'Tools' })
        .querySelectorAll('button'),
    ).toHaveLength(3)
    expect(
      [...screen.getByRole('navigation', { name: 'Tools' }).children].map(
        (b) => b.textContent,
      ),
    ).toEqual(['Auto', 'Dots', 'View'])
    expect(button('Dots')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(button('Rectangle'))
    const sheet = screen.getByTestId('sheet')
    expect(sheet.querySelector('.editor-hint')?.textContent).toBe(
      'Drag a dot · Tap the line to add · Double-tap to delete · Hold for corner',
    )
    expect(screen.getByRole('switch', { name: 'Fine' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // Top to bottom: the Fine row, the slider, the nudge pad.
    expect(
      [...sheet.querySelectorAll('button, input')].map(
        (c) => c.getAttribute('aria-label') ?? c.textContent,
      ),
    ).toEqual([
      'Fine',
      'Rectangle',
      'Ellipse',
      'Dots',
      'Nudge left',
      'Nudge up',
      'Nudge down',
      'Nudge right',
    ])
    expect(sheet).toHaveTextContent('Fewer')
    expect(sheet).toHaveTextContent('More')
    expect(slider()).toHaveValue('0')
    fireEvent.click(screen.getByRole('switch', { name: 'Fine' }))
    expect(screen.getByRole('switch', { name: 'Fine' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('should_hint_when_there_are_no_rings (AC-2)', async () => {
    await dotsTool()
    expect(
      screen.getByText('Start with a shape, or use Auto'),
    ).toBeInTheDocument()
    for (const dir of ['left', 'up', 'down', 'right']) {
      expect(nudge(dir)).toBeDisabled()
    }
  })

  it('should_add_a_starting_shape (AC-17)', async () => {
    const { canvas } = await dotsTool()
    fireEvent.click(button('Rectangle'))
    await waitFor(() => {
      expect(lastRendered()?.rings).toEqual([{ op: 'add', nodes: RECTANGLE }])
    })
    expect(canvas).toHaveAttribute('data-selected-count', '0')
    fireEvent.click(button('Undo'))
    await waitFor(() => {
      expect(lastRendered()?.rings).toHaveLength(0)
    })
    expect(button('Undo')).toBeDisabled()
    fireEvent.click(button('Ellipse'))
    await waitFor(() => {
      expect(lastRendered()?.rings).toHaveLength(1)
    })
    const nodes = lastRendered()?.rings[0]?.nodes ?? []
    expect(nodes).toHaveLength(8)
    expect(nodes.every((n) => n.kind === 'smooth')).toBe(true)
    expect(nodes[0]).toEqual({ x: 80, y: 25, kind: 'smooth' })
  })

  it('should_nudge_selected_dots_by_one_pixel (AC-14)', async () => {
    const { canvas, clock } = await dotsTool()
    fireEvent.click(button('Rectangle'))
    expect(nudge('right')).toBeDisabled()
    await selectFirstDot(canvas, clock)
    fireEvent.click(nudge('right'))
    await waitFor(() => {
      expect(lastRendered()?.rings[0]?.nodes[0]).toEqual(corner(21, 10))
    })
    expect(nudge('down')).toBeEnabled()
    fireEvent.click(nudge('down'))
    await waitFor(() => {
      expect(lastRendered()?.rings[0]?.nodes[0]).toEqual(corner(21, 11))
    })
    fireEvent.click(nudge('left'))
    fireEvent.click(nudge('up'))
    await waitFor(() => {
      expect(lastRendered()?.rings[0]?.nodes[0]).toEqual(corner(20, 10))
    })
    expect(lastRendered()?.rings[0]?.nodes.slice(1)).toEqual(RECTANGLE.slice(1))
    fireEvent.click(button('Undo'))
    await waitFor(() => {
      expect(lastRendered()?.rings[0]?.nodes[0]).toEqual(corner(20, 11))
    })
  })

  it('should_clear_the_dot_selection_on_outside_changes (AC-13)', async () => {
    const { canvas, clock } = await dotsTool()
    fireEvent.click(button('Rectangle'))
    await selectFirstDot(canvas, clock)
    fireEvent.click(nudge('right'))
    expect(nudge('right')).toBeEnabled()
    // Undo: the rectangle is back, with nothing selected.
    fireEvent.click(button('Undo'))
    await waitFor(() => {
      expect(nudge('right')).toBeDisabled()
    })
    expect(dotCount(canvas)).toBe('4')

    // An Auto result.
    await selectFirstDot(canvas, clock)
    fireEvent.click(button('Auto'))
    press(canvas, clock, { x: 110, y: 70 }, 100)
    await waitFor(() => {
      expect(phase()).toBe('done')
    })
    fireEvent.click(button('Dots'))
    expect(nudge('right')).toBeDisabled()
    expect(canvas).toHaveAttribute('data-selected-count', '0')

    // A new photo.
    fireEvent.click(button('Rectangle'))
    press(canvas, clock, { x: 50, y: 40 }, 50)
    await waitFor(() => {
      expect(nudge('right')).toBeEnabled()
    })
    const next = await choose()
    expect(nudge('right')).toBeDisabled()
    expect(next).toHaveAttribute('data-selected-count', '0')
  })

  it('should_commit_density_once_on_release (AC-15, AC-16)', async () => {
    const calls = deferredResimplify()
    const { canvas } = await dotsTool()
    fireEvent.click(button('Rectangle'))
    const start = { op: 'add', nodes: RECTANGLE }

    // A release at the middle records nothing.
    fireEvent.pointerDown(slider())
    fireEvent.change(slider(), { target: { value: '0.3' } })
    expect(calls).toHaveLength(1)
    calls[0]?.resolve()
    await waitFor(() => {
      expect(dotCount(canvas)).toBe('3')
    })
    fireEvent.change(slider(), { target: { value: '0' } })
    fireEvent.pointerUp(slider())
    expect(slider()).toHaveValue('0')
    await waitFor(() => {
      expect(dotCount(canvas)).toBe('4')
    })

    // Two moves and a release: one step, from the rings at the start. One
    // computation runs at a time; the newest position is asked for next.
    fireEvent.pointerDown(slider())
    fireEvent.change(slider(), { target: { value: '-0.5' } })
    fireEvent.change(slider(), { target: { value: '-1' } })
    fireEvent.pointerUp(slider())
    expect(slider()).toHaveValue('0')
    expect(calls).toHaveLength(2)
    calls[1]?.resolve()
    await waitFor(() => {
      expect(calls).toHaveLength(3)
    })
    expect(calls.map((c) => c.tolerancePx)).toEqual([0.5 * 0.02 ** 0.3, 2, 8])
    for (const c of calls) expect(c.selection.rings).toEqual([start])
    calls[2]?.resolve()
    await waitFor(() => {
      expect(lastRendered()?.rings[0]?.nodes).toEqual(
        RECTANGLE.slice(0, 3).map((p) => ({ ...p, x: p.x + 3 })),
      )
    })
    expect(dotCount(canvas)).toBe('3')
    fireEvent.click(button('Undo'))
    await waitFor(() => {
      expect(dotCount(canvas)).toBe('4')
    })
    expect(button('Undo')).toBeEnabled()
    fireEvent.click(button('Undo'))
    await waitFor(() => {
      expect(dotCount(canvas)).toBe('0')
    })
    expect(button('Undo')).toBeDisabled()
  })

  it('should_commit_the_release_result_not_an_older_one (AC-16, Review Focus 3)', async () => {
    const calls = deferredResimplify()
    const { canvas } = await dotsTool()
    fireEvent.click(button('Rectangle'))
    fireEvent.pointerDown(slider())
    fireEvent.change(slider(), { target: { value: '0.5' } })
    fireEvent.change(slider(), { target: { value: '-0.5' } })
    fireEvent.pointerUp(slider())
    // The older position's result arrives after the release: not committed.
    calls[0]?.resolve()
    await waitFor(() => {
      expect(calls).toHaveLength(2)
    })
    expect(calls[1]?.tolerancePx).toBe(2)
    expect(dotCount(canvas)).toBe('4')
    expect(button('Undo')).toBeEnabled()
    calls[1]?.resolve()
    await waitFor(() => {
      expect(lastRendered()?.rings[0]?.nodes[0]?.x).toBe(22)
    })
    expect(dotCount(canvas)).toBe('3')
    fireEvent.click(button('Undo'))
    await waitFor(() => {
      expect(dotCount(canvas)).toBe('4')
    })
  })

  it('should_show_density_previews_while_sliding (AC-15, final review I-2)', async () => {
    // As the real client: a newer request cancels any older one.
    const calls = deferredResimplify({ cancelOlder: true })
    const { canvas } = await dotsTool()
    fireEvent.click(button('Rectangle'))
    fireEvent.pointerDown(slider())
    fireEvent.change(slider(), { target: { value: '0.5' } })
    fireEvent.change(slider(), { target: { value: '0.6' } })
    fireEvent.change(slider(), { target: { value: '0.7' } })
    // The first computation finishes while the finger is still sliding.
    calls[0]?.resolve()
    await waitFor(() => {
      expect(dotCount(canvas)).toBe('3')
    })
    // The newest position is computed next.
    await waitFor(() => {
      expect(calls.at(-1)?.tolerancePx).toBe(0.5 * 0.02 ** 0.7)
    })
  })

  it('should_drop_a_slide_interrupted_by_another_tool (final review I-3)', async () => {
    const calls = deferredResimplify()
    const { canvas } = await dotsTool()
    fireEvent.click(button('Rectangle'))
    fireEvent.pointerDown(slider())
    fireEvent.change(slider(), { target: { value: '-0.5' } })
    calls[0]?.resolve()
    await waitFor(() => {
      expect(dotCount(canvas)).toBe('3')
    })
    // A second finger switches tool: the slider never sees its finger lift.
    fireEvent.click(button('Auto'))
    await waitFor(() => {
      expect(dotCount(canvas)).toBe('4')
    })
    fireEvent.click(button('Dots'))
    fireEvent.click(button('Ellipse'))
    await waitFor(() => {
      expect(dotCount(canvas)).toBe('12')
    })
  })

  it('should_end_a_slide_released_off_the_slider (final review I-3)', async () => {
    const calls = deferredResimplify()
    const { canvas } = await dotsTool()
    fireEvent.click(button('Rectangle'))
    fireEvent.pointerDown(slider())
    fireEvent.change(slider(), { target: { value: '-0.5' } })
    fireEvent.pointerUp(document.body)
    expect(slider()).toHaveValue('0')
    calls[0]?.resolve()
    await waitFor(() => {
      expect(lastRendered()?.rings[0]?.nodes[0]?.x).toBe(21)
    })
    expect(dotCount(canvas)).toBe('3')
    fireEvent.click(button('Undo'))
    await waitFor(() => {
      expect(dotCount(canvas)).toBe('4')
    })
  })
})
