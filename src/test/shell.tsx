import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { createRef } from 'react'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { expect } from 'vitest'
import { renderMask, type AlphaMask, type RgbaImage } from '../core/mask'
import { storedDeflate } from '../core/png'
import type { Selection } from '../core/selection/types'
import { testInflate, testInflateRaw } from '../core/testing/codecs'
import type { LoadedPhoto } from '../services/photo'
import {
  createFakeEngine,
  type SegmentationEngine,
} from '../services/segmentation'
import { openStickerStore, type StickerStore } from '../services/storage'
import { Shell, type ShellProps } from '../Shell'
import {
  EditorScreen,
  type EditorHandle,
  type EditorScreenProps,
  type Renderer,
} from '../ui/editor/EditorScreen'
import { useLibrary, type StickerDeps } from '../ui/library/useLibrary'

export const image = (width: number, height: number, v = 200): RgbaImage => ({
  width,
  height,
  data: new Uint8Array(width * height * 4).fill(v),
})

export const loaded = (file: Blob): LoadedPhoto => ({
  image: image(100, 50),
  bytes: new Uint8Array([1, 2, 3]),
  type: file.type,
})

/** A renderer that renders on the main thread; `gate` can hold back renderFull. */
export interface RenderLog {
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

export function fakeRenderer(log: RenderLog): Renderer {
  const sizes = new Map<string, { width: number; height: number }>()
  return {
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
    fitRing: () => Promise.resolve({ type: 'cancelled' as const }),
    finish: () => Promise.resolve({ type: 'cancelled' as const }),
    finishPreview: () => Promise.resolve({ type: 'cancelled' as const }),
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
}

export const codecs = {
  deflate: storedDeflate,
  inflate: testInflate,
  inflateRaw: testInflateRaw,
}

export interface ShellSetup {
  store?: Promise<StickerStore>
  storage?: Partial<Pick<StorageManager, 'persist' | 'persisted'>> | undefined
  loadPhoto?: (file: Blob) => Promise<LoadedPhoto>
  precise?: SegmentationEngine
  fast?: SegmentationEngine
  log?: RenderLog
  clock?: () => number
  /** The editor's renderer; the default renders on the main thread. */
  renderer?: () => Renderer
  more?: Partial<ShellProps>
}

/** The whole app with fakes: the Library first, the editor behind it. */
export function renderShell(opts: ShellSetup = {}) {
  const store = opts.store ?? openStickerStore(new IDBFactory())
  const log = opts.log ?? { renderFull: [] }
  const t = { now: 1000 }
  const view = render(
    <Shell
      editor={{
        engines: {
          fast: opts.fast ?? createFakeEngine({ name: 'fast' }),
          precise: opts.precise ?? createFakeEngine({ name: 'precise' }),
        },
        missingBytes: () => Promise.resolve(0),
        createRenderer: opts.renderer ?? (() => fakeRenderer(log)),
        loadPhoto: opts.loadPhoto ?? ((f) => Promise.resolve(loaded(f))),
        now: () => t.now,
      }}
      stickers={{
        store,
        storage: opts.storage,
        codecs,
        clock: opts.clock ?? (() => Date.now()),
      }}
      env={{
        ua: 'jsdom',
        maxTouchPoints: 0,
        languages: ['en'],
        storage: undefined,
      }}
      {...opts.more}
    />,
  )
  return { store, log, t, view }
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

export const photoFile = () =>
  new File(['x'], 'photo.jpg', { type: 'image/jpeg' })

/** Picks a photo with the Library's +; the editor shows it at scale 1. */
export async function pickPhoto(file: File = photoFile()) {
  const before = screen.queryByTestId('photo')
  fireEvent.change(screen.getByLabelText('Pick a photo'), {
    target: { files: [file] },
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
export function tap(canvas: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(canvas, { clientX: x, clientY: y, pointerId: 1 })
  fireEvent.pointerUp(canvas, { clientX: x, clientY: y, pointerId: 1 })
}

/** The editor top bar's Save. */
export const saveButton = () =>
  within(screen.getByTestId('editor')).getByRole('button', {
    name: /^Save(d)?$/,
  })
export const thumbnails = () =>
  screen.queryAllByRole('button', { name: 'Open sticker' })

export async function cutAndSave(canvas: HTMLElement) {
  tap(canvas, 50, 25)
  await waitFor(() => {
    expect(saveButton()).toBeEnabled()
  })
  fireEvent.click(saveButton())
  await within(screen.getByTestId('editor')).findByRole('button', {
    name: 'Saved',
  })
}

/** The editor's "Library" button; with nothing unsaved, the Library shows. */
export async function toLibrary() {
  fireEvent.click(screen.getByRole('button', { name: 'Library' }))
  await screen.findByRole('button', { name: 'New sticker' })
}

/** Opens the ⋯ menu and returns it. */
export function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'More' }))
  return screen.getByRole('menu')
}

/** Ticks tiles through "Select", in the given order. */
export function tick(...tiles: HTMLElement[]) {
  fireEvent.click(screen.getByRole('button', { name: 'Select' }))
  for (const tile of tiles) fireEvent.click(tile)
}

export const stageSize = () =>
  screen.getByTestId('canvas').getAttribute('data-image-size')

/** The editor alone, with a Library behind it and its handle (spec 0013). */
export function renderEditor(
  opts: ShellSetup & { editor?: Partial<EditorScreenProps> } = {},
) {
  const store = opts.store ?? openStickerStore(new IDBFactory())
  const log = opts.log ?? { renderFull: [] }
  const t = { now: 1000 }
  const handle = createRef<EditorHandle>()
  const deps: StickerDeps = {
    store,
    storage: opts.storage,
    codecs,
    clock: opts.clock ?? (() => Date.now()),
  }
  function Harness() {
    const library = useLibrary(deps)
    return (
      <EditorScreen
        engines={{
          fast: opts.fast ?? createFakeEngine({ name: 'fast' }),
          precise: opts.precise ?? createFakeEngine({ name: 'precise' }),
        }}
        missingBytes={() => Promise.resolve(0)}
        createRenderer={() => fakeRenderer(log)}
        loadPhoto={opts.loadPhoto ?? ((f) => Promise.resolve(loaded(f)))}
        now={() => t.now}
        library={library}
        handle={handle}
        {...opts.editor}
      />
    )
  }
  const view = render(<Harness />)
  const editor = () => {
    if (!handle.current) throw new Error('editor not mounted')
    return handle.current
  }
  /** Opens `file` through the handle; resolves to its error, or the canvas at scale 1. */
  const open = async (file: File = photoFile()) => {
    const before = screen.queryByTestId('photo')
    let error: unknown = null
    await act(async () => {
      error = await editor().openFile(file)
    })
    if (error) return error as string
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
  return { store, log, t, view, editor, open }
}
