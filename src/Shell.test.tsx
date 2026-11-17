import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoUnreadableError } from './services/photo'
import {
  openStickerStore,
  StorageFullError,
  type StickerStore,
} from './services/storage'
import {
  cutAndSave,
  loaded,
  pickPhoto,
  renderEditor,
  renderShell,
  saveButton,
  tap,
  thumbnails,
  toLibrary,
} from './test/shell'

const editor = () => screen.getByTestId('editor')
const onLibrary = () =>
  screen.queryByRole('button', { name: 'New sticker' }) !== null
const dialog = () => screen.queryByRole('dialog')
const back = (state: unknown) => {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', { state }))
  })
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  window.history.replaceState(null, '')
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Library is home (spec 0013)', () => {
  it('should_open_on_the_library (AC-1)', async () => {
    renderShell()
    expect(await screen.findByText('No stickers yet')).toBeVisible()
    expect(editor()).toHaveAttribute('hidden')
    expect(editor()).toHaveAttribute('inert')
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull()
  })

  it('should_open_the_editor_from_plus_and_stay_on_a_bad_photo (AC-3)', async () => {
    let fail = true
    renderShell({
      loadPhoto: (f) =>
        fail
          ? Promise.reject(new PhotoUnreadableError())
          : Promise.resolve(loaded(f)),
    })
    fireEvent.change(screen.getByLabelText('Pick a photo'), {
      target: { files: [new File(['x'], 'a.heic', { type: 'image/heic' })] },
    })
    expect(
      await screen.findByText("This photo can't be opened. Try a JPEG or PNG."),
    ).toBeVisible()
    expect(onLibrary()).toBe(true)
    expect(editor()).toHaveAttribute('hidden')

    fail = false
    await pickPhoto()
    expect(editor()).not.toHaveAttribute('hidden')
    expect(onLibrary()).toBe(false)
    expect(window.history.state).toEqual({ peel: 'editor' })
  })

  it('should_reopen_as_saved (AC-4)', async () => {
    renderShell()
    await cutAndSave(await pickPhoto())
    await toLibrary()
    fireEvent.click(
      (
        await screen.findAllByRole('button', { name: 'Open sticker' })
      )[0] as HTMLElement,
    )
    await waitFor(() => {
      expect(editor()).not.toHaveAttribute('hidden')
    })
    await waitFor(() => {
      expect(saveButton()).toHaveTextContent('Saved')
    })
  })

  it('should_save_from_the_editor_top_bar (AC-6)', async () => {
    renderShell()
    const canvas = await pickPhoto()
    expect(screen.queryByRole('button', { name: 'Photo' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stickers' })).toBeNull()
    expect(saveButton()).toHaveTextContent(/^Save$/)
    await cutAndSave(canvas)
    tap(canvas, 20, 20)
    await waitFor(() => {
      expect(saveButton()).toHaveTextContent(/^Save$/)
    })
  })

  it('should_ask_before_leaving_unsaved_work (AC-5)', async () => {
    const { store } = renderShell()
    const s = await store
    // A photo with no ring: nothing to lose.
    await pickPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(dialog()).toBeNull()
    expect(onLibrary()).toBe(true)

    // A new cutout: "Save this sticker?"
    const canvas = await pickPhoto()
    tap(canvas, 50, 25)
    await waitFor(() => {
      expect(saveButton()).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(
      screen.getByRole('dialog', { name: 'Save this sticker?' }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(dialog()).toBeNull()
    expect(onLibrary()).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    fireEvent.click(screen.getByRole('button', { name: "Don't save" }))
    expect(onLibrary()).toBe(true)
    expect(await s.list()).toEqual([])

    // Save from the dialog: stored, then the Library.
    const again = await pickPhoto()
    tap(again, 50, 25)
    await waitFor(() => {
      expect(saveButton()).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }),
    )
    await waitFor(() => {
      expect(onLibrary()).toBe(true)
    })
    expect(await s.list()).toHaveLength(1)
    expect(thumbnails()).toHaveLength(1)

    // Changes to a saved sticker: "Save changes to this sticker?"
    fireEvent.click(thumbnails()[0] as HTMLElement)
    await waitFor(() => {
      expect(saveButton()).toHaveTextContent('Saved')
    })
    tap(screen.getByTestId('canvas'), 20, 20)
    await waitFor(() => {
      expect(saveButton()).toHaveTextContent(/^Save$/)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(
      screen.getByRole('dialog', { name: 'Save changes to this sticker?' }),
    ).toBeVisible()
  })

  it('should_stay_when_the_dialog_save_fails (AC-5)', async () => {
    const real = await openStickerStore(new IDBFactory())
    const full: StickerStore = {
      ...real,
      save: () => Promise.reject(new StorageFullError()),
    }
    renderShell({ store: Promise.resolve(full) })
    const canvas = await pickPhoto()
    tap(canvas, 50, 25)
    await waitFor(() => {
      expect(saveButton()).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }),
    )
    expect(
      await screen.findByText(/Not enough space to save this sticker/),
    ).toBeVisible()
    expect(dialog()).toBeNull()
    expect(onLibrary()).toBe(false)
  })

  it('should_save_as_new_after_the_open_sticker_is_deleted (Review Focus 2)', async () => {
    const { store, editor, open } = renderEditor()
    const s = await store
    const canvas = await open()
    if (typeof canvas === 'string') throw new Error(canvas)
    await cutAndSave(canvas)
    const [first] = await s.list()
    if (!first) throw new Error('not saved')
    expect(editor().unsaved()).toBe('none')
    await s.delete(first.id)
    act(() => {
      editor().deleted([first.id])
    })
    expect(saveButton()).toHaveTextContent(/^Save$/)
    expect(editor().unsaved()).toBe('new')
    let ok = false
    await act(async () => {
      ok = await editor().save()
    })
    expect(ok).toBe(true)
    const [second] = await s.list()
    expect(second?.id).toBeDefined()
    expect(second?.id).not.toBe(first.id)
  })

  it('should_go_back_with_the_back_gesture (Decision 14, Review Focus 4)', async () => {
    renderShell()
    const canvas = await pickPhoto()
    tap(canvas, 50, 25)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled()
    })

    // On the Finish screen → the editor.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(
      screen.getByRole('region', { name: 'Finish sticker' }),
    ).toBeInTheDocument()
    expect(window.history.state).toEqual({ peel: 'finish' })
    back({ peel: 'editor' })
    expect(screen.queryByRole('region', { name: 'Finish sticker' })).toBeNull()
    expect(onLibrary()).toBe(false)

    // Unsaved work: the dialog, and the editor's entry comes back.
    const pushes = vi.spyOn(window.history, 'pushState')
    back(null)
    expect(
      screen.getByRole('dialog', { name: 'Save this sticker?' }),
    ).toBeVisible()
    expect(pushes).toHaveBeenLastCalledWith({ peel: 'editor' }, '')
    // Back again with the dialog open is Cancel.
    back(null)
    expect(dialog()).toBeNull()
    expect(onLibrary()).toBe(false)
    expect(pushes).toHaveBeenCalledTimes(2)

    // Nothing unsaved → the Library.
    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(saveButton()).toHaveTextContent('Saved')
    })
    back(null)
    expect(dialog()).toBeNull()
    expect(onLibrary()).toBe(true)
  })
})
