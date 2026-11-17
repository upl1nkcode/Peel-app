import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlphaMask } from './core/mask'
import { parseSelection, serializeSelection } from './core/selection/serialize'
import { backupEntries } from './core/backup'
import { writeZip } from './core/zip'
import { exportAll } from './services/backup'
import {
  createFakeEngine,
  type SegmentationEngine,
} from './services/segmentation'
import {
  openStickerStore,
  StorageFullError,
  StorageOutdatedError,
  type StickerStore,
} from './services/storage'
import {
  cutAndSave,
  image,
  loaded,
  openMenu,
  pickPhoto,
  renderShell,
  saveButton,
  stageSize,
  tap,
  thumbnails,
  tick,
  toLibrary,
  type RenderLog,
  type ShellSetup,
} from './test/shell'

/** The app, once its sticker store has opened. */
async function setup(opts: ShellSetup = {}) {
  const env = renderShell(opts)
  await act(async () => {
    await env.store.catch(() => undefined)
  })
  return env
}

// jsdom has no 2D canvas; the screen skips drawing without one.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  window.history.replaceState(null, '')
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('saving and keeping stickers through the Library (spec 0008, spec 0013)', () => {
  it('should_save_reopen_and_update (AC-5, AC-9, AC-20)', async () => {
    const { store } = await setup()
    const canvas = await pickPhoto()
    await cutAndSave(canvas)
    await toLibrary()
    await waitFor(() => {
      expect(thumbnails()).toHaveLength(1)
    })
    const s = await store
    const [first] = await s.list()
    const saved = await s.get(first?.id ?? '')
    expect(saved?.photo).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      type: 'image/jpeg',
    })
    expect(saved?.imageSize).toEqual({ width: 100, height: 50 })
    const savedSelection = parseSelection(saved?.selection ?? '').selection
    expect(savedSelection.rings.length).toBeGreaterThan(0)

    // Another photo, then re-open the saved sticker.
    await pickPhoto()
    await waitFor(() => {
      expect(saveButton()).toBeDisabled()
    })
    expect(screen.queryByRole('button', { name: 'Reset to auto' })).toBeNull()
    await toLibrary()
    fireEvent.click(thumbnails()[0] as HTMLElement)
    await waitFor(() => {
      expect(saveButton()).toHaveTextContent('Saved')
    })
    expect(stageSize()).toBe('100x50')
    // No Auto result for the re-opened photo yet (spec 0009 AC-20).
    expect(screen.queryByRole('button', { name: 'Reset to auto' })).toBeNull()

    fireEvent.click(saveButton())
    await waitFor(async () => {
      expect((await s.get(first?.id ?? ''))?.updatedAt).toBeGreaterThan(
        saved?.updatedAt ?? Infinity,
      )
    })
    const after = await s.list()
    expect(after).toHaveLength(1)
    const again = await s.get(first?.id ?? '')
    expect(again?.id).toBe(saved?.id)
    expect(again?.createdAt).toBe(saved?.createdAt)
    expect(again?.updatedAt).toBeGreaterThan(saved?.updatedAt ?? Infinity)
    expect(parseSelection(again?.selection ?? '').selection).toEqual(
      savedSelection,
    )
    expect(again?.sticker).toEqual(saved?.sticker)
  })

  it('should_save_what_was_on_screen_at_the_tap (Review Focus 1)', async () => {
    let releasePrecise: () => void = () => undefined
    const base = createFakeEngine({ name: 'precise' })
    const precise: SegmentationEngine = {
      ...base,
      async segment(id, taps) {
        const result = await base.segment(id, taps)
        await new Promise<void>((resolve) => {
          releasePrecise = resolve
        })
        if (!result.selection) return result
        return { ...result, selection: { ...result.selection, feather: 2 } }
      },
    }
    let releaseRender: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      releaseRender = resolve
    })
    const log: RenderLog = { renderFull: [], render: [], gate }
    const { store } = await setup({ precise, log })
    const canvas = await pickPhoto()
    tap(canvas, 50, 25)
    await waitFor(() => {
      expect(saveButton()).toBeEnabled()
    })
    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(log.renderFull).toHaveLength(1)
    })
    const atTap = log.renderFull[0]
    // The sharper result lands while the save is still rendering.
    act(() => {
      releasePrecise()
    })
    await waitFor(() => {
      expect(log.render?.some((sel) => sel.feather === 2)).toBe(true)
    })
    releaseRender()
    // The selection changed since.
    await within(screen.getByTestId('editor')).findByRole('button', {
      name: 'Save',
    })
    await waitFor(async () => {
      expect(await (await store).list()).toHaveLength(1)
    })
    const s = await store
    const [only] = await s.list()
    const saved = await s.get(only?.id ?? '')
    expect(parseSelection(saved?.selection ?? '').selection).toEqual(atTap)
    expect(atTap?.feather).toBe(0)
  })

  it('should_render_an_undone_result_with_its_own_model_alpha (spec 0009 Review Focus 1)', async () => {
    // The precise result's alpha is marked, so A and B can be told apart.
    const base = createFakeEngine({ name: 'precise' })
    const precise: SegmentationEngine = {
      ...base,
      async segment(id, taps) {
        const result = await base.segment(id, taps)
        const data = result.alpha.data.slice()
        data[0] = 77
        return { ...result, alpha: { ...result.alpha, data } }
      },
    }
    const log: RenderLog = { renderFull: [], alphas: [], fullAlphas: [] }
    await setup({ precise, log })
    const canvas = await pickPhoto()
    tap(canvas, 50, 25)
    await waitFor(() => {
      expect(log.alphas?.at(-1)?.data[0]).toBe(77)
    })
    const marked = (a: AlphaMask | undefined) => a?.data[0] === 77
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(marked(log.alphas?.at(-1))).toBe(false)
    })
    expect(log.alphas?.at(-1)).toBeDefined()
    fireEvent.click(saveButton())
    await within(screen.getByTestId('editor')).findByRole('button', {
      name: 'Saved',
    })
    expect(log.fullAlphas).toHaveLength(1)
    expect(log.fullAlphas?.[0]).toBeDefined()
    expect(marked(log.fullAlphas?.[0])).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    await waitFor(() => {
      expect(marked(log.alphas?.at(-1))).toBe(true)
    })
  })

  it('should_cancel_a_delete (AC-20)', async () => {
    await setup()
    await cutAndSave(await pickPhoto())
    await toLibrary()
    tick(await screen.findByRole('button', { name: 'Open sticker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(
      screen.getByRole('dialog', { name: 'Delete this sticker?' }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(thumbnails()).toHaveLength(1)
  })

  it('should_warn_when_the_photo_opens_at_another_size (AC-9)', async () => {
    let size = { width: 100, height: 50 }
    const { store } = await setup({
      loadPhoto: (f) =>
        Promise.resolve({
          ...loaded(f),
          image: image(size.width, size.height),
        }),
    })
    await cutAndSave(await pickPhoto())
    expect(await (await store).list()).toHaveLength(1)

    size = { width: 99, height: 50 }
    await toLibrary()
    fireEvent.click(
      (
        await screen.findAllByRole('button', { name: 'Open sticker' })
      )[0] as HTMLElement,
    )
    expect(
      await screen.findByText(
        'This photo opened at a different size here; the outline may be off.',
      ),
    ).toBeInTheDocument()
    expect(stageSize()).toBe('99x50')
    await waitFor(() => {
      expect(saveButton()).toBeEnabled()
    })
  })

  it('should_disable_save_without_a_cutout (AC-20)', async () => {
    await setup()
    await pickPhoto()
    expect(saveButton()).toBeDisabled()
  })

  it('should_say_nothing_to_save_for_an_empty_render (AC-20)', async () => {
    const { store } = await setup({ log: { renderFull: [], empty: true } })
    const canvas = await pickPhoto()
    tap(canvas, 50, 25)
    await waitFor(() => {
      expect(saveButton()).toBeEnabled()
    })
    fireEvent.click(saveButton())
    expect(
      await screen.findByText('Nothing to save: the cutout is empty.'),
    ).toBeInTheDocument()
    expect(await (await store).list()).toEqual([])
  })

  it('should_show_storage_full (AC-12)', async () => {
    const real = await openStickerStore(new IDBFactory())
    const full: StickerStore = {
      ...real,
      save: () => Promise.reject(new StorageFullError()),
    }
    await setup({ store: Promise.resolve(full) })
    const canvas = await pickPhoto()
    tap(canvas, 50, 25)
    await waitFor(() => {
      expect(saveButton()).toBeEnabled()
    })
    fireEvent.click(saveButton())
    expect(
      await screen.findByText(
        'Not enough space to save this sticker. Delete some stickers or free up space on your phone.',
      ),
    ).toBeInTheDocument()
    expect(saveButton()).toHaveTextContent('Save')
    expect(await real.list()).toEqual([])
  })

  it('should_show_outdated_when_the_database_is_newer (AC-11)', async () => {
    await setup({ store: Promise.reject(new StorageOutdatedError()) })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Peel was updated in another tab. Reload to use your stickers.',
    )
    await pickPhoto()
    expect(saveButton()).toBeDisabled()
  })

  it('should_show_outdated_when_another_tab_upgrades (AC-11)', async () => {
    const real = await openStickerStore(new IDBFactory())
    let fire: () => void = () => undefined
    await setup({
      store: Promise.resolve({
        ...real,
        onOutdated: (cb) => {
          fire = cb
        },
      }),
    })
    act(() => {
      fire()
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Peel was updated in another tab. Reload to use your stickers.',
    )
    expect(
      within(openMenu()).getByRole('menuitem', { name: 'Export all' }),
    ).toBeDisabled()
  })

  it('should_ask_for_persistence_after_the_first_save (AC-13)', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    let granted = false
    const persisted = vi.fn(() => Promise.resolve(granted))
    await setup({ storage: { persist, persisted } })
    const canvas = await pickPhoto()
    expect(persist).not.toHaveBeenCalled()
    granted = true
    await cutAndSave(canvas)
    await waitFor(() => {
      expect(persist).toHaveBeenCalledTimes(1)
    })
    tap(canvas, 20, 20)
    await waitFor(() => {
      expect(saveButton()).toHaveTextContent(/^Save$/)
    })
    fireEvent.click(saveButton())
    await within(screen.getByTestId('editor')).findByRole('button', {
      name: 'Saved',
    })
    expect(persist).toHaveBeenCalledTimes(1)
    await toLibrary()
    await waitFor(() => {
      expect(openMenu()).toHaveTextContent('Stickers are kept on this device.')
    })
  })

  it('should_ask_for_persistence_after_an_import_that_adds_stickers (AC-13)', async () => {
    const imageSize = { width: 3, height: 2 }
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const entries = backupEntries(
      [
        {
          id: 'restored-1',
          createdAt: 1,
          updatedAt: 2,
          imageSize,
          photo: { bytes: new Uint8Array([1]), type: 'image/jpeg' },
          selection: serializeSelection(
            { rings: [], strokes: [], feather: 0 },
            imageSize,
          ),
          sticker: png,
          thumbnail: png,
        },
      ],
      new Date(2026, 10, 7),
    )
    const backupFile = new File(
      writeZip(entries, new Date(2026, 10, 7)) as BlobPart[],
      'peel-stickers-2026-11-07.zip',
    )
    const persist = vi.fn(() => Promise.resolve(true))
    await setup({
      storage: { persist, persisted: () => Promise.resolve(false) },
    })
    fireEvent.change(screen.getByLabelText('Import'), {
      target: { files: [backupFile] },
    })
    await screen.findByText('Imported 1 sticker. 0 were already here.')
    await waitFor(() => {
      expect(persist).toHaveBeenCalledTimes(1)
    })
  })

  it('should_show_the_storage_status (AC-14)', async () => {
    await setup({ storage: undefined })
    await waitFor(() => {
      expect(openMenu()).toHaveTextContent(
        "Your browser may clear stickers if Peel isn't used for a while. Add Peel to your Home Screen, or export a backup.",
      )
    })
  })

  it('should_disable_export_without_stickers (AC-15)', async () => {
    await setup()
    expect(
      within(openMenu()).getByRole('menuitem', { name: 'Export all' }),
    ).toBeDisabled()
  })

  it('should_download_the_backup (AC-15)', async () => {
    const created: Blob[] = []
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b)
      return 'blob:peel'
    })
    URL.revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toMatch(/^peel-stickers-\d{4}-\d{2}-\d{2}\.zip$/)
        expect(this.href).toBe('blob:peel')
      })
    await setup()
    await cutAndSave(await pickPhoto())
    await toLibrary()
    await waitFor(() => {
      expect(thumbnails()).toHaveLength(1)
    })
    fireEvent.click(
      within(openMenu()).getByRole('menuitem', { name: 'Export all' }),
    )
    await waitFor(() => {
      expect(click).toHaveBeenCalledTimes(1)
    })
    expect(created[0]?.type).toBe('application/zip')
  })

  it('should_show_the_import_result (AC-17, AC-18)', async () => {
    const source = await openStickerStore(new IDBFactory())
    const { store } = await setup()
    await cutAndSave(await pickPhoto())
    await toLibrary()
    const s = await store
    const [mine] = await s.list()
    const record = await s.get(mine?.id ?? '')
    if (!record) throw new Error('not saved')
    await source.save(record)
    await source.save({ ...record, id: 'imported-1' })
    const exported = await exportAll(source, new Date(2026, 10, 7))
    const file = new File(
      [exported?.blob as Blob],
      'peel-stickers-2026-11-07.zip',
      {
        type: 'application/zip',
      },
    )

    fireEvent.change(screen.getByLabelText('Import'), {
      target: { files: [file] },
    })
    expect(
      await screen.findByText('Imported 1 sticker. 1 were already here.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(thumbnails()).toHaveLength(2)
    })

    const notBackup = new File(
      writeZip(
        [{ name: 'a.txt', data: new Uint8Array([1]) }],
        new Date(),
      ) as BlobPart[],
      'other.zip',
    )
    fireEvent.change(screen.getByLabelText('Import'), {
      target: { files: [notBackup] },
    })
    expect(
      await screen.findByText("This file isn't a Peel backup."),
    ).toBeInTheDocument()
  })

  it('should_show_too_many_for_a_backup (AC-19)', async () => {
    // 16,400 stickers of 4 files each are 65,601 ZIP entries: over plain ZIP's 65,535.
    const real = await openStickerStore(new IDBFactory())
    const many = Array.from({ length: 16_400 }, (_, k) => ({
      id: `s${String(k)}`,
      createdAt: 1,
      updatedAt: 1,
      imageSize: { width: 1, height: 1 },
      thumbnail: new Uint8Array(0),
    }))
    let lists = 0
    const huge: StickerStore = {
      ...real,
      // The panel lists one (rendering 16,400 thumbnails is slow); the export sees all.
      list: () => Promise.resolve(++lists === 1 ? many.slice(0, 1) : many),
      get: (id) =>
        Promise.resolve({
          id,
          createdAt: 1,
          updatedAt: 1,
          imageSize: { width: 1, height: 1 },
          photo: { bytes: new Uint8Array(0), type: '' },
          selection: '{}',
          sticker: new Uint8Array(0),
          thumbnail: new Uint8Array(0),
        }),
    }
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    await setup({ store: Promise.resolve(huge) })
    await waitFor(() => {
      expect(thumbnails()).toHaveLength(1)
    })
    fireEvent.click(
      within(openMenu()).getByRole('menuitem', { name: 'Export all' }),
    )
    expect(
      await screen.findByText(
        'Too many stickers for one backup file. Delete some, then export again.',
        {},
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument()
    expect(click).not.toHaveBeenCalled()
  }, 20_000)

  it('should_lay_out_top_to_bottom (spec 0009 AC-21)', async () => {
    await setup()
    await pickPhoto()
    const order = [
      screen.getByRole('button', { name: 'Library' }),
      saveButton(),
      screen.getByRole('button', { name: 'Done' }),
      screen.getByTestId('canvas'),
      screen.getByRole('button', { name: 'Undo' }),
      screen.getByRole('button', { name: 'Compare' }),
      screen.getByTestId('sheet'),
      screen.getByRole('button', { name: 'Auto' }),
      screen.getByRole('button', { name: 'View' }),
    ]
    for (let i = 1; i < order.length; i++) {
      const before = order[i - 1] as HTMLElement
      expect(
        before.compareDocumentPosition(order[i] as HTMLElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  it('should_show_auto_status_whatever_sheet_is_open (spec 0009 AC-17)', async () => {
    await setup({
      precise: createFakeEngine({ name: 'precise', failLoad: 'unsupported' }),
      fast: createFakeEngine({ name: 'fast', failLoad: 'unsupported' }),
    })
    await pickPhoto()
    const text = "Auto cutout doesn't work in this browser."
    for (const open of ['View', 'Dots']) {
      fireEvent.click(screen.getByRole('button', { name: open }))
      const line = await screen.findByText(text)
      expect(line.closest('[role=status]')).not.toBeNull()
      expect(line.closest('.editor-main')).not.toBeNull()
    }
  })
})
