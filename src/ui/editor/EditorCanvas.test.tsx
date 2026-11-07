import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlphaMask } from '../../core/mask'
import { emptySelection } from '../../core/selection/model'
import type { Selection } from '../../core/selection/types'
import { EditorCanvas, type EditorCanvasProps } from './EditorCanvas'

/** The canvas's CSS size; tests change it to resize. */
const rect = { width: 400, height: 300 }

let resizeObservers: (() => void)[] = []

beforeEach(() => {
  rect.width = 400
  rect.height = 300
  resizeObservers = []
  // jsdom has no 2D canvas and no layout.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(
    HTMLCanvasElement.prototype,
    'getBoundingClientRect',
  ).mockImplementation(
    () =>
      ({
        left: 0,
        top: 0,
        x: 0,
        y: 0,
        width: rect.width,
        height: rect.height,
        right: rect.width,
        bottom: rect.height,
      }) as DOMRect,
  )
  vi.stubGlobal('devicePixelRatio', 2)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: () => void
      constructor(cb: () => void) {
        this.cb = cb
      }
      observe() {
        resizeObservers.push(this.cb)
      }
      disconnect() {
        resizeObservers = resizeObservers.filter((c) => c !== this.cb)
      }
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

interface Call {
  selection: Selection
  scale: number
  resolve(mask: AlphaMask | null): void
}

function recorder() {
  const calls: Call[] = []
  const renderMask: EditorCanvasProps['renderMask'] = (selection, scale) =>
    new Promise((resolve) => {
      calls.push({ selection, scale, resolve })
    })
  return { calls, renderMask }
}

const photo = (width = 4000, height = 3000, id = 'p1') => ({
  id,
  width,
  height,
  source: document.createElement('canvas'),
})

const selection = (): Selection => ({
  rings: [],
  strokes: [],
  feather: 0,
})

const mask = (scale: number): AlphaMask => ({
  width: Math.round(4000 * scale),
  height: Math.round(3000 * scale),
  data: new Uint8Array(1),
})

function setup(over: Partial<EditorCanvasProps> = {}) {
  const r = recorder()
  const intents: Parameters<EditorCanvasProps['onIntent']>[0][] = []
  const props: EditorCanvasProps = {
    photo: photo(),
    selection: emptySelection(),
    renderMask: r.renderMask,
    viewMode: 'overlay',
    comparing: false,
    tool: 'auto',
    onIntent: (i) => intents.push(i),
    now: () => Date.now(),
    ...over,
  }
  const view = render(<EditorCanvas {...props} />)
  const canvas = screen.getByTestId('canvas')
  return {
    ...r,
    view,
    intents,
    canvas,
    props,
    rerender: (next: Partial<EditorCanvasProps>) => {
      Object.assign(props, next)
      view.rerender(<EditorCanvas {...props} />)
    },
  }
}

describe('EditorCanvas', () => {
  it('should_start_fitted_and_render_at_screen_resolution (AC-7, AC-9)', () => {
    const { canvas, calls } = setup()
    expect(canvas.getAttribute('data-zoom')).toBe('1.0000')
    expect(canvas.getAttribute('data-display-scale')).toBe('0.2000')
    expect(canvas.getAttribute('data-image-size')).toBe('4000x3000')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.scale).toBeCloseTo(0.2, 9)
  })

  it('should_render_again_when_the_selection_changes (AC-10)', () => {
    const { calls, rerender } = setup()
    const next = selection()
    rerender({ selection: next })
    expect(calls).toHaveLength(2)
    expect(calls[1]?.selection).toBe(next)
    expect(calls[1]?.scale).toBeCloseTo(0.2, 9)
    // The same props again ask for nothing.
    rerender({})
    expect(calls).toHaveLength(2)
  })

  it('should_ignore_a_render_for_an_old_selection (AC-10)', async () => {
    const { calls, canvas, rerender } = setup()
    rerender({ selection: selection() })
    await act(async () => {
      calls[0]?.resolve(mask(0.2))
      await Promise.resolve()
    })
    expect(canvas.getAttribute('data-mask-scale')).toBe('')
    await act(async () => {
      calls[1]?.resolve(mask(0.2))
      await Promise.resolve()
    })
    expect(canvas.getAttribute('data-mask-scale')).toBe('0.2000')
  })

  it('should_start_fitted_for_a_new_photo (AC-7)', () => {
    const { canvas, calls, rerender } = setup()
    rerender({ photo: photo(2000, 1500, 'p2') })
    expect(canvas.getAttribute('data-zoom')).toBe('1.0000')
    expect(canvas.getAttribute('data-image-size')).toBe('2000x1500')
    expect(calls.at(-1)?.scale).toBeCloseTo(0.4, 9)
  })

  it('should_request_nothing_for_a_0_size_canvas (Review Focus 2)', () => {
    rect.width = 0
    rect.height = 0
    const { canvas, calls } = setup()
    expect(calls).toHaveLength(0)
    expect(canvas.getAttribute('data-zoom')).toBe('')
    rect.width = 400
    rect.height = 300
    act(() => {
      for (const cb of resizeObservers) cb()
    })
    expect(canvas.getAttribute('data-zoom')).toBe('1.0000')
    expect(calls).toHaveLength(1)
  })
})

const at = (x: number, y: number, pointerId = 1) => ({
  clientX: x,
  clientY: y,
  pointerId,
})

/** Runs pending timers and lets promise callbacks settle. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const centerOf = (canvas: HTMLElement) =>
  (canvas.getAttribute('data-center') ?? '').split(',').map(Number)

describe('EditorCanvas gestures', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const tap = (canvas: HTMLElement, x: number, y: number) => {
    fireEvent.pointerDown(canvas, at(x, y))
    fireEvent.pointerUp(canvas, at(x, y))
  }

  it('should_pinch_and_keep_the_midpoint_still (AC-1, AC-10)', async () => {
    const { canvas, calls, intents } = setup()
    fireEvent.pointerDown(canvas, at(100, 150, 1))
    fireEvent.pointerDown(canvas, at(200, 150, 2))
    fireEvent.pointerMove(canvas, at(50, 150, 1))
    fireEvent.pointerMove(canvas, at(250, 150, 2))
    expect(canvas.getAttribute('data-zoom')).toBe('2.0000')
    // Image (1500, 1500) was under the midpoint (150, 150) and still is.
    expect(canvas.getAttribute('data-center')).toBe('1750.0000,1500.0000')
    expect(calls).toHaveLength(1)
    fireEvent.pointerUp(canvas, at(50, 150, 1))
    fireEvent.pointerUp(canvas, at(250, 150, 2))
    expect(calls).toHaveLength(2)
    expect(calls[1]?.scale).toBeCloseTo(0.4, 9)
    await advance(1000)
    expect(intents).toEqual([])
  })

  it('should_cancel_a_press_when_a_second_finger_lands (AC-2)', async () => {
    const { canvas, intents } = setup()
    fireEvent.pointerDown(canvas, at(100, 100, 1))
    fireEvent.pointerMove(canvas, at(120, 100, 1))
    fireEvent.pointerDown(canvas, at(200, 100, 2))
    fireEvent.pointerUp(canvas, at(120, 100, 1))
    fireEvent.pointerUp(canvas, at(200, 100, 2))
    await advance(1000)
    expect(intents).toEqual([])
  })

  it('should_add_250_ms_after_a_tap (AC-4, AC-16)', async () => {
    const { canvas, intents } = setup()
    tap(canvas, 200, 150)
    await advance(249)
    expect(intents).toEqual([])
    await advance(1)
    expect(intents).toHaveLength(1)
    expect(intents[0]?.type).toBe('add')
    expect(intents[0]?.imagePt.x).toBeCloseTo(2000, 2)
    expect(intents[0]?.imagePt.y).toBeCloseTo(1500, 2)
  })

  it('should_add_where_the_tap_was_even_if_the_view_moves (AC-4)', async () => {
    const { canvas, intents } = setup()
    tap(canvas, 100, 150)
    fireEvent.wheel(canvas, { deltaY: -200, clientX: 300, clientY: 150 })
    await advance(250)
    expect(intents[0]?.imagePt.x).toBeCloseTo(1000, 2)
    expect(intents[0]?.imagePt.y).toBeCloseTo(1500, 2)
  })

  it('should_zoom_on_double_tap_and_add_nothing (AC-3)', async () => {
    const { canvas, intents } = setup()
    tap(canvas, 200, 150)
    await advance(100)
    tap(canvas, 200, 150)
    expect(canvas.getAttribute('data-zoom')).toBe('5.0000')
    expect(canvas.getAttribute('data-display-scale')).toBe('1.0000')
    await advance(1000)
    expect(intents).toEqual([])
    tap(canvas, 200, 150)
    await advance(100)
    tap(canvas, 200, 150)
    expect(canvas.getAttribute('data-zoom')).toBe('1.0000')
    await advance(1000)
    expect(intents).toEqual([])
  })

  it('should_remove_on_long_press_at_lift (AC-16)', async () => {
    const { canvas, intents } = setup()
    fireEvent.pointerDown(canvas, at(200, 150))
    await advance(600)
    expect(intents).toEqual([])
    fireEvent.pointerUp(canvas, at(200, 150))
    expect(intents).toEqual([{ type: 'remove', imagePt: { x: 2000, y: 1500 } }])
  })

  it('should_add_where_an_aim_lifts (AC-16)', () => {
    const { canvas, intents } = setup()
    fireEvent.pointerDown(canvas, at(100, 100))
    fireEvent.pointerMove(canvas, at(150, 100))
    fireEvent.pointerUp(canvas, at(150, 100))
    expect(intents).toHaveLength(1)
    expect(intents[0]?.type).toBe('add')
    expect(intents[0]?.imagePt.x).toBeCloseTo(1500, 2)
    expect(intents[0]?.imagePt.y).toBeCloseTo(1000, 2)
  })

  it('should_do_nothing_for_a_point_outside_the_photo (AC-16)', async () => {
    // 400×400: the 4000×3000 photo is letterboxed from y = 50 to 350.
    rect.height = 400
    const { canvas, intents } = setup()
    fireEvent.pointerDown(canvas, at(150, 100))
    fireEvent.pointerMove(canvas, at(150, 20))
    fireEvent.pointerUp(canvas, at(150, 20))
    tap(canvas, 200, 30)
    await advance(1000)
    expect(intents).toEqual([])
  })

  it('should_pan_with_one_finger_in_the_view_tool (AC-5)', async () => {
    const { canvas, intents } = setup({ tool: 'view' })
    fireEvent.wheel(canvas, { deltaY: -400, clientX: 200, clientY: 150 })
    expect(canvas.getAttribute('data-zoom')).toBe('4.0000')
    const [x0, y0] = centerOf(canvas)
    fireEvent.pointerDown(canvas, at(200, 150))
    fireEvent.pointerMove(canvas, at(180, 150))
    fireEvent.pointerMove(canvas, at(160, 150))
    fireEvent.pointerUp(canvas, at(160, 150))
    const [x1, y1] = centerOf(canvas)
    // 40 CSS px at 0.4 CSS px per image px.
    expect(x1).toBeCloseTo((x0 ?? 0) + 100, 2)
    expect(y1).toBeCloseTo(y0 ?? 0, 2)
    tap(canvas, 200, 150)
    await advance(1000)
    expect(intents).toEqual([])
  })

  it('should_zoom_with_the_wheel (AC-6, AC-10)', async () => {
    const first = setup()
    fireEvent.wheel(first.canvas, {
      deltaY: -200,
      clientX: 200,
      clientY: 150,
    })
    expect(first.canvas.getAttribute('data-zoom')).toBe('2.0000')
    expect(first.calls).toHaveLength(1)
    await advance(149)
    expect(first.calls).toHaveLength(1)
    await advance(1)
    expect(first.calls).toHaveLength(2)
    expect(first.calls[1]?.scale).toBeCloseTo(0.4, 9)
    first.view.unmount()

    const lines = setup()
    fireEvent.wheel(lines.canvas, {
      deltaY: -12.5,
      deltaMode: 1,
      clientX: 200,
      clientY: 150,
    })
    expect(lines.canvas.getAttribute('data-zoom')).toBe('2.0000')
  })

  it('should_keep_the_centre_when_the_canvas_resizes (Review Focus 2)', async () => {
    const { canvas, calls } = setup()
    fireEvent.wheel(canvas, { deltaY: -400, clientX: 300, clientY: 200 })
    await advance(200)
    const before = centerOf(canvas)
    const scaleBefore = canvas.getAttribute('data-display-scale')
    rect.width = 300
    rect.height = 400
    act(() => {
      for (const cb of resizeObservers) cb()
    })
    const after = centerOf(canvas)
    expect(after[0]).toBeCloseTo(before[0] ?? Number.NaN, 2)
    expect(after[1]).toBeCloseTo(before[1] ?? Number.NaN, 2)
    // The display scale stays, not the zoom relative to fit (final review I-1).
    expect(canvas.getAttribute('data-display-scale')).toBe(scaleBefore)
    const n = calls.length
    rect.width = 0
    rect.height = 0
    act(() => {
      for (const cb of resizeObservers) cb()
    })
    expect(canvas.getAttribute('data-zoom')).not.toContain('NaN')
    expect(calls).toHaveLength(n)
  })

  it('should_double_tap_a_small_photo_safely (Review Focus 4)', async () => {
    const { canvas, calls } = setup({ photo: photo(120, 80, 'small') })
    expect(calls[0]?.scale).toBe(1)
    tap(canvas, 200, 150)
    await advance(100)
    tap(canvas, 200, 150)
    expect(canvas.getAttribute('data-zoom')).toBe('1.0000')
    expect(canvas.getAttribute('data-center')).toBe('60.0000,40.0000')
  })

  it('should_drop_a_waiting_tap_for_a_new_photo (Review Focus 3)', async () => {
    const { canvas, intents, rerender } = setup()
    tap(canvas, 200, 150)
    rerender({ photo: photo(2000, 1500, 'p2') })
    await advance(1000)
    expect(intents).toEqual([])
  })
})

describe('loupe', () => {
  const loupe = () => screen.queryByTestId('loupe')
  const centre = () => {
    const el = loupe()
    if (!el) return null
    return {
      x: parseFloat(el.style.left) + 60,
      y: parseFloat(el.style.top) + 60,
    }
  }

  it('should_show_the_loupe_while_aiming_and_hide_it_on_lift (AC-13, AC-15)', () => {
    const { canvas } = setup()
    fireEvent.pointerDown(canvas, at(200, 200))
    fireEvent.pointerMove(canvas, at(206, 200))
    expect(loupe()).toBeNull()
    fireEvent.pointerMove(canvas, at(211, 200))
    expect(centre()).toEqual({ x: 211, y: 110 })
    expect(loupe()?.getAttribute('data-below')).toBe('false')
    fireEvent.pointerMove(canvas, at(230, 210))
    expect(centre()).toEqual({ x: 230, y: 120 })
    fireEvent.pointerUp(canvas, at(230, 210))
    expect(loupe()).toBeNull()

    fireEvent.pointerDown(canvas, at(200, 200))
    fireEvent.pointerMove(canvas, at(230, 200))
    expect(loupe()).not.toBeNull()
    fireEvent.pointerCancel(canvas, at(230, 200))
    expect(loupe()).toBeNull()

    fireEvent.pointerDown(canvas, at(200, 200, 3))
    fireEvent.pointerMove(canvas, at(230, 200, 3))
    expect(loupe()).not.toBeNull()
    fireEvent.pointerDown(canvas, at(100, 100, 4))
    expect(loupe()).toBeNull()
  })

  it('should_not_show_the_loupe_while_panning (AC-13)', () => {
    const { canvas } = setup({ tool: 'view' })
    fireEvent.pointerDown(canvas, at(200, 200))
    fireEvent.pointerMove(canvas, at(160, 200))
    expect(loupe()).toBeNull()
    fireEvent.pointerUp(canvas, at(160, 200))
  })

  it('should_flip_the_loupe_below_near_the_top (AC-14)', () => {
    const { canvas } = setup()
    fireEvent.pointerDown(canvas, at(200, 100))
    fireEvent.pointerMove(canvas, at(215, 100))
    expect(centre()).toEqual({ x: 215, y: 190 })
    expect(loupe()?.getAttribute('data-below')).toBe('true')
  })
})
