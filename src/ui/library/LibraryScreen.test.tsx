import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StickerSummary } from '../../services/storage'
import { LibraryScreen, type LibraryProps } from './LibraryScreen'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const summary = (id: string, updatedAt: number): StickerSummary => ({
  id,
  createdAt: updatedAt,
  updatedAt,
  imageSize: { width: 10, height: 10 },
  thumbnail: PNG,
})

const THREE = [summary('a', 3), summary('b', 2), summary('c', 1)]

function setup(over: Partial<LibraryProps> = {}) {
  const props: LibraryProps = {
    stickers: THREE,
    blocked: null,
    message: null,
    busy: false,
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onDuplicate: vi.fn(() => Promise.resolve()),
    onExport: vi.fn(() => Promise.resolve()),
    onDelete: vi.fn(() => Promise.resolve()),
    onTicked: vi.fn(),
    share: { shown: false, preparing: false, message: null, onShare: vi.fn() },
    menu: null,
    top: null,
    ...over,
  }
  render(<LibraryScreen {...props} />)
  return props
}

const tiles = () => screen.getAllByRole('button', { name: 'Open sticker' })
const press = (el: HTMLElement, x = 50, y = 50) => {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1 })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Library (spec 0013)', () => {
  it('should_show_the_grid_newest_first (AC-1)', () => {
    setup()
    expect(tiles()).toHaveLength(3)
    for (const t of tiles()) expect(t.querySelector('img')).not.toBeNull()
    expect(tiles()[0]?.dataset.id).toBe('a')
    expect(tiles()[2]?.dataset.id).toBe('c')
    expect(screen.getByRole('heading', { name: 'Peel' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'New sticker' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Select' })).toBeEnabled()
  })

  it('should_show_the_empty_state (AC-2)', () => {
    setup({ stickers: [] })
    expect(screen.getByText('No stickers yet')).toBeVisible()
    expect(screen.getByText('Tap + to make your first one.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New sticker' })).toBeVisible()
  })

  it('should_pick_a_photo_from_plus (AC-3)', () => {
    const props = setup()
    const input = screen.getByLabelText('Pick a photo')
    const click = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: 'New sticker' }))
    expect(click).toHaveBeenCalledTimes(1)
    const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(props.onNew).toHaveBeenCalledWith(file)
  })

  it('should_open_on_tap (AC-4)', () => {
    const props = setup()
    const [, second] = tiles()
    if (!second) throw new Error('no tile')
    fireEvent.click(second)
    expect(props.onOpen).toHaveBeenCalledWith('b')
  })

  it('should_start_selecting_on_a_long_press (AC-7, Review Focus 1)', () => {
    vi.useFakeTimers()
    const props = setup()
    const tile = tiles()[1]
    if (!tile) throw new Error('no tile')
    press(tile)
    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(tile).not.toHaveAttribute('aria-pressed')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1 selected')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Done' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'New sticker' })).toBeNull()
    for (const name of ['Duplicate', 'Export', 'Delete']) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
    // Lifting the finger clicks; that click keeps the tick and opens nothing.
    fireEvent.pointerUp(tile, { pointerId: 1 })
    fireEvent.click(tile)
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(props.onTicked).toHaveBeenLastCalledWith(['b'])
    // A later tap toggles.
    fireEvent.click(tile)
    expect(tile).toHaveAttribute('aria-pressed', 'false')
  })

  it('should_not_start_selecting_when_the_finger_moves (AC-7)', () => {
    vi.useFakeTimers()
    const props = setup()
    const tile = tiles()[0]
    if (!tile) throw new Error('no tile')
    press(tile, 50, 50)
    fireEvent.pointerMove(tile, { clientX: 61, clientY: 50, pointerId: 1 })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(tile).not.toHaveAttribute('aria-pressed')
    fireEvent.click(tile)
    expect(props.onOpen).toHaveBeenCalledWith('a')
  })

  it('should_start_selecting_from_select (AC-7)', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(screen.getByText('0 selected')).toBeVisible()
    for (const name of ['Duplicate', 'Export', 'Delete']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    const [a, b] = tiles()
    if (!a || !b) throw new Error('no tiles')
    fireEvent.click(b)
    fireEvent.click(a)
    expect(screen.getByText('2 selected')).toBeVisible()
    expect(props.onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText(/selected/)).toBeNull()
    expect(a).not.toHaveAttribute('aria-pressed')
    expect(props.onTicked).toHaveBeenLastCalledWith([])
  })

  it('should_confirm_before_deleting (AC-11)', async () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    const [a, b] = tiles()
    if (!a || !b) throw new Error('no tiles')
    fireEvent.click(b)
    fireEvent.click(a)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete 2 stickers?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText("This can't be undone.")).toBeVisible()
    expect(document.activeElement?.textContent).toBe('Delete')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(props.onDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const confirm = screen
      .getAllByRole('button', { name: 'Delete' })
      .find((el) => screen.getByRole('dialog').contains(el))
    if (!confirm) throw new Error('no confirm button')
    await act(async () => {
      fireEvent.click(confirm)
      await Promise.resolve()
    })
    expect(props.onDelete).toHaveBeenCalledWith(['a', 'b'])
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('should_name_a_single_delete (AC-11)', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    const [a] = tiles()
    if (!a) throw new Error('no tile')
    fireEvent.click(a)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(
      screen.getByRole('dialog', { name: 'Delete this sticker?' }),
    ).toBeVisible()
  })

  it('should_duplicate_and_export_the_ticked (AC-9, AC-10)', async () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    const [a, , c] = tiles()
    if (!a || !c) throw new Error('no tiles')
    fireEvent.click(c)
    fireEvent.click(a)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export' }))
      await Promise.resolve()
    })
    expect(props.onExport).toHaveBeenCalledWith(['a', 'c'])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
      await Promise.resolve()
    })
    expect(props.onDuplicate).toHaveBeenCalledWith(['a', 'c'])
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('should_block_the_grid_when_storage_fails (AC-12)', () => {
    const props = setup({ blocked: "Stickers can't be saved in this browser." })
    expect(
      screen.getByText("Stickers can't be saved in this browser."),
    ).toBeVisible()
    expect(screen.queryAllByRole('button', { name: 'Open sticker' })).toEqual(
      [],
    )
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled()
    const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('Pick a photo'), {
      target: { files: [file] },
    })
    expect(props.onNew).toHaveBeenCalledWith(file)
  })

  it('should_suppress_the_ios_callout (Review Focus 1)', () => {
    setup()
    const tile = tiles()[0]
    if (!tile) throw new Error('no tile')
    expect(fireEvent.contextMenu(tile)).toBe(false)
  })

  it('should_show_share_when_offered (AC-8)', () => {
    const onShare = vi.fn()
    setup({
      share: { shown: true, preparing: true, message: null, onShare },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    const [a] = tiles()
    if (!a) throw new Error('no tile')
    fireEvent.click(a)
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled()
    expect(screen.getByText('Preparing…')).toBeVisible()
  })
})
