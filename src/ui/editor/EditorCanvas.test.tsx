import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlphaMask } from '../../core/mask'
import { emptySelection } from '../../core/selection/model'
import type { Point } from '../../core/geometry/types'
import type { Command, NodeRef, Selection } from '../../core/selection/types'
import { snapReachPx, type LassoSection } from '../../core/editor'
import type { DrawnSection } from './canvasController'
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

describe('dots tool (spec 0010)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // At fit (0.1 CSS px per image px) the square's dots are at canvas
  // (100,100), (300,100), (300,200) and (100,200).
  const corner = (x: number, y: number) => ({ x, y, kind: 'corner' as const })
  const square = (): Selection => ({
    rings: [
      {
        op: 'add',
        nodes: [
          corner(1000, 1000),
          corner(3000, 1000),
          corner(3000, 2000),
          corner(1000, 2000),
        ],
      },
    ],
    strokes: [],
    feather: 0,
  })

  function dots(over: Partial<EditorCanvasProps> = {}) {
    const edits: { command: Command; selectAfter: readonly NodeRef[] }[] = []
    const selects: (readonly NodeRef[])[] = []
    const s = setup({
      tool: 'dots',
      selection: square(),
      selectedDots: [],
      fine: true,
      onEdit: (command, selectAfter) => edits.push({ command, selectAfter }),
      onSelectDots: (refs) => selects.push(refs),
      ...over,
    })
    return { ...s, edits, selects }
  }
  const drag = (canvas: HTMLElement, from: Point, ...to: Point[]) => {
    fireEvent.pointerDown(canvas, at(from.x, from.y))
    for (const p of to) fireEvent.pointerMove(canvas, at(p.x, p.y))
  }
  const lift = (canvas: HTMLElement, p: Point) => {
    fireEvent.pointerUp(canvas, at(p.x, p.y))
  }
  const loupe = () => screen.queryByTestId('loupe')

  it('should_drag_a_dot_into_one_move (AC-3, AC-4)', async () => {
    const { canvas, edits, selects } = dots()
    await advance(20)
    drag(canvas, { x: 100, y: 100 }, { x: 115, y: 100 }, { x: 130, y: 104 })
    lift(canvas, { x: 130, y: 104 })
    expect(selects).toEqual([[{ ring: 0, node: 0 }]])
    expect(edits).toEqual([
      {
        command: {
          type: 'moveNode',
          ring: 0,
          node: 0,
          to: { x: 1300, y: 1040 },
        },
        selectAfter: [{ ring: 0, node: 0 }],
      },
    ])
  })

  it('should_put_the_dot_back_on_cancel (AC-4)', async () => {
    const { canvas, edits } = dots()
    await advance(20)
    drag(canvas, { x: 100, y: 100 }, { x: 130, y: 100 })
    expect(loupe()).not.toBeNull()
    fireEvent.pointerDown(canvas, at(250, 250, 2))
    lift(canvas, { x: 130, y: 100 })
    fireEvent.pointerUp(canvas, at(250, 250, 2))
    expect(edits).toEqual([])
    expect(loupe()).toBeNull()
  })

  it('should_show_fine_mode_on_the_loupe (AC-5, AC-6)', async () => {
    const { canvas } = dots()
    await advance(20)
    drag(canvas, { x: 100, y: 100 }, { x: 130, y: 100 })
    expect(loupe()?.getAttribute('data-fine')).toBe('false')
    await advance(300)
    fireEvent.pointerMove(canvas, at(130.5, 100))
    expect(loupe()?.getAttribute('data-fine')).toBe('true')
    // The crosshair is on the dot, not the finger (which is over 1305): the
    // hold engaged fine mode at 1300, so the 0.5 px since counts a quarter.
    expect(loupe()?.getAttribute('data-aim')).toBe('1301.2500,1000.0000')
  })

  it('should_show_fine_mode_while_the_finger_holds_still (AC-6, final review I-1)', async () => {
    const { canvas } = dots()
    await advance(20)
    drag(canvas, { x: 100, y: 100 }, { x: 130, y: 100 })
    const aim = loupe()?.getAttribute('data-aim')
    expect(loupe()?.getAttribute('data-fine')).toBe('false')
    // No moves at all: a still finger sends none.
    await advance(310)
    expect(loupe()?.getAttribute('data-fine')).toBe('true')
    expect(loupe()?.getAttribute('data-aim')).toBe(aim)
    // Then 8 CSS px (80 image px at fit) move the dot a quarter: 20.
    fireEvent.pointerMove(canvas, at(138, 100))
    expect(loupe()?.getAttribute('data-aim')).toBe('1320.0000,1000.0000')
  })

  it('should_insert_on_an_edge_tap (AC-8)', async () => {
    const { canvas, edits } = dots()
    await advance(20)
    fireEvent.pointerDown(canvas, at(200, 101))
    lift(canvas, { x: 200, y: 101 })
    expect(edits).toEqual([])
    await advance(250)
    expect(edits).toHaveLength(1)
    const command = edits[0]?.command
    expect(command).toMatchObject({ type: 'insertNode', ring: 0, afterNode: 0 })
    if (command?.type !== 'insertNode') throw new Error('not an insert')
    expect(command.point.x).toBeCloseTo(2000, 2)
    expect(command.point.y).toBeCloseTo(1000, 2)
    expect(edits[0]?.selectAfter).toEqual([{ ring: 0, node: 1 }])
  })

  it('should_delete_on_a_double_tap_on_a_dot (AC-9)', async () => {
    const { canvas, edits } = dots({ selectedDots: [{ ring: 0, node: 3 }] })
    await advance(20)
    fireEvent.pointerDown(canvas, at(300, 100))
    lift(canvas, { x: 300, y: 100 })
    await advance(100)
    fireEvent.pointerDown(canvas, at(302, 101))
    lift(canvas, { x: 302, y: 101 })
    await advance(300)
    expect(edits).toEqual([
      {
        command: { type: 'deleteNode', ring: 0, node: 1 },
        selectAfter: [{ ring: 0, node: 2 }],
      },
    ])
    expect(canvas.getAttribute('data-zoom')).toBe('1.0000')

    // A double-tap on empty space zooms and edits nothing.
    fireEvent.pointerDown(canvas, at(200, 150))
    lift(canvas, { x: 200, y: 150 })
    await advance(100)
    fireEvent.pointerDown(canvas, at(200, 150))
    lift(canvas, { x: 200, y: 150 })
    await advance(300)
    expect(edits).toHaveLength(1)
    expect(canvas.getAttribute('data-zoom')).not.toBe('1.0000')
  })

  it('should_toggle_kind_on_a_long_press (AC-10)', async () => {
    const { canvas, edits } = dots()
    await advance(20)
    fireEvent.pointerDown(canvas, at(300, 200))
    await advance(600)
    lift(canvas, { x: 300, y: 200 })
    expect(edits).toEqual([
      {
        command: { type: 'toggleKind', ring: 0, node: 2 },
        selectAfter: [],
      },
    ])
  })

  it('should_select_by_tap_and_box (AC-11)', async () => {
    const { canvas, selects, edits } = dots()
    await advance(20)
    fireEvent.pointerDown(canvas, at(101, 199))
    lift(canvas, { x: 101, y: 199 })
    await advance(300)
    fireEvent.pointerDown(canvas, at(200, 150))
    lift(canvas, { x: 200, y: 150 })
    await advance(300)
    drag(canvas, { x: 240, y: 60 }, { x: 280, y: 120 }, { x: 330, y: 230 })
    lift(canvas, { x: 330, y: 230 })
    expect(selects).toEqual([
      [{ ring: 0, node: 3 }],
      [],
      [
        { ring: 0, node: 1 },
        { ring: 0, node: 2 },
      ],
    ])
    expect(edits).toEqual([])
  })

  it('should_move_selected_dots_together (AC-12)', async () => {
    const both = [
      { ring: 0, node: 1 },
      { ring: 0, node: 2 },
    ]
    const { canvas, edits, selects } = dots({ selectedDots: both })
    await advance(20)
    drag(canvas, { x: 300, y: 100 }, { x: 315, y: 100 }, { x: 320, y: 100 })
    lift(canvas, { x: 320, y: 100 })
    expect(selects).toEqual([])
    expect(edits).toEqual([
      {
        command: { type: 'moveNodes', refs: both, delta: { x: 200, y: 0 } },
        selectAfter: both,
      },
    ])
  })

  it('should_drop_a_drag_when_the_selection_changes (Review Focus 1)', async () => {
    const { canvas, edits, rerender } = dots()
    await advance(20)
    drag(canvas, { x: 100, y: 100 }, { x: 130, y: 100 })
    rerender({ selection: square() })
    expect(loupe()).toBeNull()
    fireEvent.pointerMove(canvas, at(140, 100))
    lift(canvas, { x: 140, y: 100 })
    expect(edits).toEqual([])
  })

  it('should_do_nothing_without_rings (AC-2)', async () => {
    const { canvas, edits, selects } = dots({ selection: emptySelection() })
    await advance(20)
    fireEvent.pointerDown(canvas, at(200, 150))
    lift(canvas, { x: 200, y: 150 })
    await advance(300)
    drag(canvas, { x: 100, y: 100 }, { x: 150, y: 150 })
    lift(canvas, { x: 150, y: 150 })
    expect(edits).toEqual([])
    expect(selects).toEqual([])
  })

  it('should_expose_dot_hooks (AC-1)', () => {
    const { canvas, rerender } = dots({
      selectedDots: [
        { ring: 0, node: 0 },
        { ring: 0, node: 2 },
      ],
    })
    expect(canvas.getAttribute('data-tool')).toBe('dots')
    expect(canvas.getAttribute('data-dot-count')).toBe('4')
    expect(canvas.getAttribute('data-selected-count')).toBe('2')
    rerender({ tool: 'view', selectedDots: [] })
    expect(canvas.getAttribute('data-tool')).toBe('view')
    expect(canvas.getAttribute('data-selected-count')).toBe('0')
  })

  it('should_render_one_preview_at_a_time (AC-21)', async () => {
    const { canvas, calls } = dots()
    await advance(20)
    const first = calls.length
    for (const c of calls) c.resolve(mask(c.scale))
    await advance(20)
    drag(canvas, { x: 100, y: 100 }, { x: 130, y: 100 })
    expect(calls).toHaveLength(first + 1)
    fireEvent.pointerMove(canvas, at(140, 100))
    fireEvent.pointerMove(canvas, at(150, 100))
    expect(calls).toHaveLength(first + 1)
    const pending = calls[first]
    pending?.resolve(mask(pending.scale))
    await advance(20)
    expect(calls).toHaveLength(first + 2)
    expect(calls[first + 1]?.selection.rings[0]?.nodes[0]?.x).toBe(1500)
  })
})

describe('lasso tool (spec 0011)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // At fit (0.1 CSS px per image px) canvas (x, y) is image (10x, 10y).
  function lasso(over: Partial<EditorCanvasProps> = {}) {
    const sections: DrawnSection[] = []
    const s = setup({
      tool: 'lasso',
      onLassoSection: (d) => sections.push(d),
      ...over,
    })
    return { ...s, sections }
  }
  const drag = (canvas: HTMLElement, from: Point, ...to: Point[]) => {
    fireEvent.pointerDown(canvas, at(from.x, from.y))
    for (const p of to) fireEvent.pointerMove(canvas, at(p.x, p.y))
  }
  const lift = (canvas: HTMLElement, p: Point) => {
    fireEvent.pointerUp(canvas, at(p.x, p.y))
  }
  const paused = (): { sections: LassoSection[]; busy: boolean } => ({
    sections: [
      {
        points: [
          { x: 1000, y: 1000 },
          { x: 1600, y: 1000 },
          { x: 1600, y: 1600 },
        ],
        snapped: false,
        tolerancePx: 8,
      },
    ],
    busy: false,
  })

  it('should_start_a_lasso_where_the_finger_went_down (AC-1)', async () => {
    const { canvas, sections } = lasso()
    await advance(20)
    expect(canvas.getAttribute('data-lasso')).toBe('none')
    drag(
      canvas,
      { x: 100, y: 100 },
      { x: 103, y: 100 },
      { x: 106, y: 100 },
      { x: 115, y: 100 },
      { x: 130, y: 100 },
    )
    expect(canvas.getAttribute('data-lasso')).toBe('drawing')
    expect(sections).toEqual([])
    fireEvent.pointerMove(canvas, at(160, 100))
    lift(canvas, { x: 160, y: 100 })
    expect(sections).toHaveLength(1)
    const d = sections[0] as DrawnSection
    expect(d.points[0]).toEqual({ x: 1000, y: 1000 })
    // The samples before the 10 px slop are kept.
    expect(d.points).toContainEqual({ x: 1030, y: 1000 })
    expect(d.points).toContainEqual({ x: 1060, y: 1000 })
    expect(d.points.at(-1)).toEqual({ x: 1600, y: 1000 })
    expect(d.closes).toBe(false)
    expect(d.k).toBeCloseTo(0.1, 12)
  })

  it('should_record_coalesced_samples (AC-1)', async () => {
    const { canvas, sections } = lasso()
    await advance(20)
    drag(canvas, { x: 100, y: 100 }, { x: 115, y: 100 })
    const ev = createEvent.pointerMove(canvas, at(130, 100))
    Object.defineProperty(ev, 'getCoalescedEvents', {
      value: () => [at(120, 100), at(125, 100), at(130, 100)],
    })
    fireEvent(canvas, ev)
    lift(canvas, { x: 130, y: 100 })
    const pts = (sections[0] as DrawnSection).points
    expect(pts).toContainEqual({ x: 1200, y: 1000 })
    expect(pts).toContainEqual({ x: 1250, y: 1000 })
    expect(pts).toContainEqual({ x: 1300, y: 1000 })
  })

  it('should_show_the_loupe_on_the_finger (AC-3)', async () => {
    const { canvas } = lasso()
    await advance(20)
    drag(canvas, { x: 100, y: 100 }, { x: 130, y: 100 }, { x: 160, y: 110 })
    expect(screen.getByTestId('loupe').getAttribute('data-aim')).toBe(
      '1600.0000,1100.0000',
    )
    lift(canvas, { x: 160, y: 110 })
    expect(screen.queryByTestId('loupe')).toBeNull()
  })

  it('should_close_when_lifting_near_the_start (AC-4)', async () => {
    const { canvas, sections } = lasso()
    await advance(20)
    drag(
      canvas,
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
      { x: 105, y: 105 },
    )
    lift(canvas, { x: 105, y: 105 })
    expect(sections.map((d) => d.closes)).toEqual([true])

    drag(
      canvas,
      { x: 100, y: 100 },
      { x: 115, y: 100 },
      { x: 130, y: 100 },
      { x: 110, y: 100 },
    )
    lift(canvas, { x: 110, y: 100 })
    expect(sections.map((d) => d.closes)).toEqual([true, false])
  })

  it('should_continue_only_from_the_end_handle (AC-5, AC-6)', async () => {
    const { canvas, sections } = lasso({ lasso: paused() })
    await advance(20)
    expect(canvas.getAttribute('data-lasso')).toBe('paused')
    expect(canvas.getAttribute('data-lasso-points')).toBe('3')
    // The end is at canvas (160, 160); this press is 11 px from it.
    drag(canvas, { x: 170, y: 165 }, { x: 180, y: 170 }, { x: 190, y: 180 })
    lift(canvas, { x: 190, y: 180 })
    expect(sections).toHaveLength(1)
    const d = sections[0] as DrawnSection
    expect(d.points[0]).toEqual({ x: 1600, y: 1600 })
    expect(d.points.at(-1)?.x).toBeCloseTo(1800, 9)
    expect(d.points.at(-1)?.y).toBeCloseTo(1750, 9)

    drag(canvas, { x: 220, y: 160 }, { x: 240, y: 160 }, { x: 260, y: 160 })
    lift(canvas, { x: 260, y: 160 })
    fireEvent.pointerDown(canvas, at(160, 160))
    fireEvent.pointerUp(canvas, at(160, 160))
    await advance(300)
    expect(sections).toHaveLength(1)
  })

  it('should_keep_the_section_when_a_second_finger_lands (AC-7)', async () => {
    const { canvas, sections } = lasso()
    await advance(20)
    drag(canvas, { x: 100, y: 100 }, { x: 130, y: 100 }, { x: 160, y: 100 })
    fireEvent.pointerDown(canvas, at(250, 250, 2))
    expect(sections).toHaveLength(1)
    expect((sections[0] as DrawnSection).closes).toBe(false)
    expect((sections[0] as DrawnSection).points.at(-1)).toEqual({
      x: 1600,
      y: 1000,
    })
    fireEvent.pointerMove(canvas, at(330, 300, 2))
    expect(Number(canvas.getAttribute('data-zoom'))).toBeGreaterThan(1)
    lift(canvas, { x: 160, y: 100 })
    fireEvent.pointerUp(canvas, at(330, 300, 2))
    expect(sections).toHaveLength(1)
  })

  it('should_ignore_the_handle_while_busy (Review Focus 5)', async () => {
    const { canvas, sections } = lasso({ lasso: { ...paused(), busy: true } })
    await advance(20)
    expect(canvas.getAttribute('data-lasso')).toBe('busy')
    drag(canvas, { x: 160, y: 160 }, { x: 180, y: 170 }, { x: 190, y: 180 })
    lift(canvas, { x: 190, y: 180 })
    expect(sections).toEqual([])
  })

  it('should_snap_the_trail_while_drawing (AC-11)', async () => {
    const calls: {
      finger: Point[]
      reachPx: number
      resolve(path: Point[] | null): void
    }[] = []
    const { canvas } = lasso({
      snapOn: true,
      snap: (finger, reachPx) =>
        new Promise((resolve) => {
          calls.push({ finger, reachPx, resolve })
        }),
    })
    await advance(20)
    drag(
      canvas,
      { x: 100, y: 100 },
      { x: 115, y: 100 },
      { x: 130, y: 100 },
      { x: 145, y: 100 },
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.reachPx).toBeCloseTo(snapReachPx(0.1), 9)
    calls[0]?.resolve([
      { x: 1000, y: 1000 },
      { x: 1150, y: 1000 },
    ])
    await advance(0)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.finger.at(-1)).toEqual({ x: 1450, y: 1000 })
    lift(canvas, { x: 145, y: 100 })
  })
})
