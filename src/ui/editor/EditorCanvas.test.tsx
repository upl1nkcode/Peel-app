import { act, render, screen } from '@testing-library/react'
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
    ...over,
  }
  const view = render(<EditorCanvas {...props} />)
  const canvas = screen.getByTestId('canvas')
  return {
    ...r,
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
