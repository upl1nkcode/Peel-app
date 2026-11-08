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
import { renderMask, type AlphaMask, type RgbaImage } from '../../core/mask'
import { storedDeflate } from '../../core/png'
import {
  parseSelection,
  serializeSelection,
} from '../../core/selection/serialize'
import type { Selection } from '../../core/selection/types'
import { testInflate, testInflateRaw } from '../../core/testing/codecs'
import { backupEntries } from '../../core/backup'
import { writeZip } from '../../core/zip'
import { exportAll } from '../../services/backup'
import {
  createFakeEngine,
  type SegmentationEngine,
} from '../../services/segmentation'
import {
  openStickerStore,
  StorageFullError,
  StorageOutdatedError,
  type StickerStore,
} from '../../services/storage'
import type { LoadedPhoto } from '../../services/photo'
import { EditorScreen, type Renderer } from './EditorScreen'

const image = (width: number, height: number, v = 200): RgbaImage => ({
  width,
  height,
  data: new Uint8Array(width * height * 4).fill(v),
})

const loaded = (file: Blob): LoadedPhoto => ({
  image: image(100, 50),
  bytes: new Uint8Array([1, 2, 3]),
  type: file.type,
})

/** A renderer that renders on the main thread; `gate` can hold back renderFull. */
interface RenderLog {
  renderFull: Selection[]
  /** Selections drawn by the preview. */
  render?: Selection[]
  gate?: Promise<void>
  /** Make the full render cover nothing. */
  empty?: boolean
  /** Model alphas sent to the renderer, in order. */
  alphas?: AlphaMask[]
  /** The model alpha each full render was given. */
  fullAlphas?: (AlphaMask | undefined)[]
}

function fakeRenderer(log: RenderLog) {
  const sizes = new Map<string, { width: number; height: number }>()
  const renderer: Renderer = {
    setImage: (id, img) => {
      sizes.set(id, { width: img.width, height: img.height })
    },
    setModelAlpha: (_id, alpha) => {
      log.alphas?.push(alpha)
    },
    render: (id, selection, scale) => {
      log.render?.push(selection)
      return Promise.resolve({
        type: 'rendered' as const,
        jobId: 1,
        mask: renderMask(selection, sizes.get(id) ?? { width: 1, height: 1 }, {
          scale,
        }),
      })
    },
    resimplify: () => Promise.resolve({ type: 'cancelled' as const }),
    renderFull: async (id, selection, alpha) => {
      log.renderFull.push(selection)
      log.fullAlphas?.push(alpha)
      await log.gate
      const size = sizes.get(id) ?? { width: 1, height: 1 }
      return {
        type: 'rendered' as const,
        jobId: 2,
        mask: log.empty
          ? { ...size, data: new Uint8Array(size.width * size.height) }
          : renderMask(selection, size),
      }
    },
  }
  return renderer
}

const codecs = {
  deflate: storedDeflate,
  inflate: testInflate,
  inflateRaw: testInflateRaw,
}

interface Setup {
  store?: Promise<StickerStore>
  storage?: Partial<Pick<StorageManager, 'persist' | 'persisted'>> | undefined
  loadPhoto?: (file: Blob) => Promise<LoadedPhoto>
  precise?: SegmentationEngine
  fast?: SegmentationEngine
  log?: RenderLog
  clock?: () => number
  /** Open the Stickers sheet after mounting (default: yes). */
  openPanel?: boolean
}

function setup(opts: Setup = {}) {
  const store = opts.store ?? openStickerStore(new IDBFactory())
  const log = opts.log ?? { renderFull: [] }
  const t = { now: 1000 }
  render(
    <EditorScreen
      engines={{
        fast: opts.fast ?? createFakeEngine({ name: 'fast' }),
        precise: opts.precise ?? createFakeEngine({ name: 'precise' }),
      }}
      missingBytes={() => Promise.resolve(0)}
      createRenderer={() => fakeRenderer(log)}
      loadPhoto={opts.loadPhoto ?? ((f) => Promise.resolve(loaded(f)))}
      now={() => t.now}
      stickers={{
        store,
        storage: opts.storage,
        codecs,
        clock: opts.clock ?? (() => Date.now()),
      }}
    />,
  )
  // The panel lives in the Stickers sheet (spec 0009 AC-21).
  if (opts.openPanel ?? true) {
    fireEvent.click(screen.getByRole('button', { name: 'Stickers' }))
  }
  return { store, log, t }
}

/** Waits for a newly picked photo to show (its full-size canvas is replaced). */
async function shown(before: HTMLElement | null) {
  await waitFor(() => {
    const now = screen.queryByTestId('photo')
    expect(now).not.toBeNull()
    expect(now).not.toBe(before)
  })
  return screen.getByTestId('canvas')
}

async function pickPhoto() {
  const before = screen.queryByTestId('photo')
  fireEvent.change(screen.getByLabelText('Pick a photo'), {
    target: { files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })] },
  })
  const canvas = await shown(before)
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      right: 100,
      bottom: 50,
    }) as DOMRect
  return canvas
}

/** A tap at image (x, y): the canvas is shown at scale 1. */
function tap(canvas: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(canvas, { clientX: x, clientY: y, pointerId: 1 })
  fireEvent.pointerUp(canvas, { clientX: x, clientY: y, pointerId: 1 })
}

const saveButton = () => screen.getByRole('button', { name: /^Save(d)?$/ })
const thumbnails = () =>
  screen.queryAllByRole('button', { name: 'Open sticker' })

async function cutAndSave(canvas: HTMLElement) {
  tap(canvas, 50, 25)
  await waitFor(() => {
    expect(saveButton()).toBeEnabled()
  })
  fireEvent.click(saveButton())
  await screen.findByRole('button', { name: 'Saved' })
}

const stageSize = () =>
  screen.getByTestId('canvas').getAttribute('data-image-size')

// jsdom has no 2D canvas; the screen skips drawing without one.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('sticker panel on the tap-to-cut screen (spec 0008)', () => {
  it('should_save_reopen_and_update (AC-5, AC-9, AC-20)', async () => {
    const { store } = setup()
    const canvas = await pickPhoto()
    await cutAndSave(canvas)
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
    fireEvent.click(thumbnails()[0] as HTMLElement)
    await waitFor(() => {
      expect(saveButton()).toBeEnabled()
    })
    expect(stageSize()).toBe('100x50')
    // No Auto result for the re-opened photo yet (spec 0009 AC-20).
    expect(screen.queryByRole('button', { name: 'Reset to auto' })).toBeNull()

    fireEvent.click(saveButton())
    await screen.findByRole('button', { name: 'Saved' })
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
    const { store } = setup({ precise, log })
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
    await screen.findByRole('button', { name: 'Save' }) // the selection changed since
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
    setup({ precise, log })
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
    await screen.findByRole('button', { name: 'Saved' })
    expect(log.fullAlphas).toHaveLength(1)
    expect(log.fullAlphas?.[0]).toBeDefined()
    expect(marked(log.fullAlphas?.[0])).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    await waitFor(() => {
      expect(marked(log.alphas?.at(-1))).toBe(true)
    })
  })

  it('should_save_as_new_after_deleting_the_open_sticker (Review Focus 2)', async () => {
    const { store } = setup()
    const canvas = await pickPhoto()
    await cutAndSave(canvas)
    const s = await store
    const [first] = await s.list()

    const item = (
      await screen.findByRole('button', { name: 'Open sticker' })
    ).closest('li') as HTMLElement
    fireEvent.click(within(item).getByRole('button', { name: 'Delete' }))
    expect(within(item).getByText('Delete this sticker?')).toBeInTheDocument()
    fireEvent.click(within(item).getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(thumbnails()).toHaveLength(0)
    })
    expect(await s.list()).toHaveLength(0)

    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(thumbnails()).toHaveLength(1)
    })
    const [second] = await s.list()
    expect(second?.id).not.toBe(first?.id)
  })

  it('should_cancel_a_delete (AC-20)', async () => {
    setup()
    await cutAndSave(await pickPhoto())
    const item = (
      await screen.findByRole('button', { name: 'Open sticker' })
    ).closest('li') as HTMLElement
    fireEvent.click(within(item).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(item).getByRole('button', { name: 'Cancel' }))
    expect(within(item).queryByText('Delete this sticker?')).toBeNull()
    expect(thumbnails()).toHaveLength(1)
  })

  it('should_warn_when_the_photo_opens_at_another_size (AC-9)', async () => {
    let size = { width: 100, height: 50 }
    const { store } = setup({
      loadPhoto: (f) =>
        Promise.resolve({
          ...loaded(f),
          image: image(size.width, size.height),
        }),
    })
    await cutAndSave(await pickPhoto())
    expect(await (await store).list()).toHaveLength(1)

    size = { width: 99, height: 50 }
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
    setup()
    expect(saveButton()).toBeDisabled()
    await pickPhoto()
    expect(saveButton()).toBeDisabled()
  })

  it('should_say_nothing_to_save_for_an_empty_render (AC-20)', async () => {
    const { store } = setup({ log: { renderFull: [], empty: true } })
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
    setup({ store: Promise.resolve(full) })
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
    setup({ store: Promise.reject(new StorageOutdatedError()) })
    expect(
      await screen.findByText(
        'Peel was updated in another tab. Reload to use your stickers.',
      ),
    ).toBeInTheDocument()
    await pickPhoto()
    expect(saveButton()).toBeDisabled()
  })

  it('should_show_outdated_when_another_tab_upgrades (AC-11)', async () => {
    const real = await openStickerStore(new IDBFactory())
    let fire: () => void = () => undefined
    setup({
      store: Promise.resolve({
        ...real,
        onOutdated: (cb) => {
          fire = cb
        },
      }),
    })
    await screen.findByText(/Your browser may clear stickers/)
    act(() => {
      fire()
    })
    expect(
      await screen.findByText(
        'Peel was updated in another tab. Reload to use your stickers.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled()
  })

  it('should_ask_for_persistence_after_the_first_save (AC-13)', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    let granted = false
    const persisted = vi.fn(() => Promise.resolve(granted))
    setup({ storage: { persist, persisted } })
    const canvas = await pickPhoto()
    expect(persist).not.toHaveBeenCalled()
    granted = true
    await cutAndSave(canvas)
    await waitFor(() => {
      expect(persist).toHaveBeenCalledTimes(1)
    })
    expect(
      await screen.findByText('Stickers are kept on this device.'),
    ).toBeInTheDocument()
    tap(canvas, 20, 20)
    await waitFor(() => {
      expect(saveButton()).toHaveTextContent(/^Save$/)
    })
    fireEvent.click(saveButton())
    await screen.findByRole('button', { name: 'Saved' })
    expect(persist).toHaveBeenCalledTimes(1)
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
    setup({ storage: { persist, persisted: () => Promise.resolve(false) } })
    const importInput = screen.getByLabelText('Import')
    await waitFor(() => {
      expect(importInput).toBeEnabled()
    })
    fireEvent.change(importInput, { target: { files: [backupFile] } })
    await screen.findByText('Imported 1 sticker. 0 were already here.')
    await waitFor(() => {
      expect(persist).toHaveBeenCalledTimes(1)
    })
  })

  it('should_show_the_storage_status (AC-14)', async () => {
    setup({ storage: undefined })
    expect(
      await screen.findByText(
        "Your browser may clear stickers if Peel isn't used for a while. Add Peel to your Home Screen, or export a backup.",
      ),
    ).toBeInTheDocument()
  })

  it('should_disable_export_without_stickers (AC-15)', async () => {
    setup()
    await screen.findByText(/Your browser may clear stickers/)
    expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled()
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
    setup()
    await cutAndSave(await pickPhoto())
    const exportButton = screen.getByRole('button', { name: 'Export all' })
    await waitFor(() => {
      expect(exportButton).toBeEnabled()
    })
    fireEvent.click(exportButton)
    await waitFor(() => {
      expect(click).toHaveBeenCalledTimes(1)
    })
    expect(created[0]?.type).toBe('application/zip')
  })

  it('should_show_the_import_result (AC-17, AC-18)', async () => {
    const source = await openStickerStore(new IDBFactory())
    const { store } = setup()
    await cutAndSave(await pickPhoto())
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
    setup({ store: Promise.resolve(huge) })
    const exportButton = await screen.findByRole('button', {
      name: 'Export all',
    })
    await waitFor(() => {
      expect(exportButton).toBeEnabled()
    })
    fireEvent.click(exportButton)
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
    setup()
    await pickPhoto()
    const order = [
      screen.getByRole('heading', { name: 'Peel' }),
      screen.getByRole('button', { name: 'Photo' }),
      screen.getByRole('button', { name: 'Stickers' }),
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

  it('should_open_the_sticker_panel_in_a_sheet (spec 0009 AC-21)', () => {
    setup({ openPanel: false })
    const stickers = screen.getByRole('button', { name: 'Stickers' })
    expect(stickers).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: 'Saved stickers' })).toBeNull()
    fireEvent.click(stickers)
    expect(stickers).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('region', { name: 'Saved stickers' }),
    ).toBeInTheDocument()
    fireEvent.click(stickers)
    expect(screen.queryByRole('region', { name: 'Saved stickers' })).toBeNull()
  })

  it('should_show_auto_status_whatever_sheet_is_open (spec 0009 AC-17)', async () => {
    setup({
      precise: createFakeEngine({ name: 'precise', failLoad: 'unsupported' }),
      fast: createFakeEngine({ name: 'fast', failLoad: 'unsupported' }),
    })
    await pickPhoto()
    const text = "Auto cutout doesn't work in this browser."
    for (const open of ['View', 'Stickers']) {
      fireEvent.click(screen.getByRole('button', { name: open }))
      const line = await screen.findByText(text)
      expect(line.closest('[role=status]')).not.toBeNull()
      expect(line.closest('.editor-main')).not.toBeNull()
    }
  })
})
