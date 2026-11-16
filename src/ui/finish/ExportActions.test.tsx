import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Selection } from '../../core/selection/types'
import { DEFAULT_FINISH, type FinishSettings } from '../../core/sticker'
import { ExportActions, type ExportEnv } from './ExportActions'
import type { FinishedFile } from './useFinishOutput'

const selection: Selection = { rings: [], strokes: [], feather: 0 }

function fileFor(settings: FinishSettings): FinishedFile {
  const type = settings.output === 'whatsapp' ? 'image/webp' : 'image/png'
  return {
    blob: new Blob(['x'], { type }),
    name:
      settings.output === 'whatsapp'
        ? 'peel-sticker-2026-11-16-0905-whatsapp.webp'
        : 'peel-sticker-2026-11-16-0905.png',
    width: 10,
    height: 10,
    settings,
    selection,
  }
}

interface Spies {
  shared: ShareData[]
  written: unknown[]
  links: { href: string; download: string }[]
}

function env(
  opts: {
    canShare?: (type: string) => boolean
    share?: () => Promise<void>
    write?: () => Promise<void>
    supports?: (type: string) => boolean
    clipboard?: boolean
  } = {},
): { env: ExportEnv; spies: Spies } {
  const spies: Spies = { shared: [], written: [], links: [] }
  class Item {
    static supports = opts.supports
    items: Record<string, Blob>
    constructor(items: Record<string, Blob>) {
      this.items = items
    }
  }
  const link = {
    href: '',
    download: '',
    click() {
      spies.links.push({ href: this.href, download: this.download })
    },
  }
  return {
    spies,
    env: {
      nav: {
        ...(opts.canShare && {
          canShare: (data?: ShareData) =>
            opts.canShare?.(data?.files?.[0]?.type ?? '') ?? false,
        }),
        share: (data?: ShareData) => {
          if (data) spies.shared.push(data)
          return opts.share?.() ?? Promise.resolve()
        },
      } as Pick<Navigator, 'canShare' | 'share'>,
      ...(opts.clipboard !== false && {
        clipboard: {
          write: (items: ClipboardItems) => {
            spies.written.push(...items)
            return opts.write?.() ?? Promise.resolve()
          },
        },
        ClipboardItem: Item as unknown as typeof ClipboardItem,
      }),
      doc: { createElement: () => link } as unknown as Document,
    },
  }
}

function show(
  e: ExportEnv,
  props: {
    file?: FinishedFile | null
    settings?: FinishSettings
    preparing?: boolean
  } = {},
) {
  const settings = props.settings ?? DEFAULT_FINISH
  return render(
    <ExportActions
      file={props.file === undefined ? fileFor(settings) : props.file}
      preparing={props.preparing ?? false}
      settings={settings}
      selection={selection}
      env={e}
    />,
  )
}

const names = () => screen.getAllByRole('button').map((b) => b.textContent)

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:x'),
    revokeObjectURL: vi.fn(),
  })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('export actions (spec 0012)', () => {
  it('should_disable_actions_while_preparing (AC-13, AC-17)', () => {
    const { env: e } = env({ canShare: () => true })
    const view = show(e, { preparing: true })
    expect(names()).toEqual(['Share', 'Copy', 'Download'])
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
    view.rerender(
      <ExportActions
        file={null}
        preparing={false}
        settings={DEFAULT_FINISH}
        selection={selection}
        env={e}
      />,
    )
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
  })

  it('should_show_share_only_when_files_can_be_shared (AC-14)', () => {
    const pngOnly = env({ canShare: (t) => t === 'image/png' })
    let view = show(pngOnly.env)
    expect(names()).toContain('Share')
    view.unmount()
    view = show(pngOnly.env, {
      settings: { ...DEFAULT_FINISH, output: 'whatsapp' },
    })
    expect(names()).toEqual(['Download'])
    view.unmount()
    show(env().env)
    expect(names()).not.toContain('Share')
  })

  it('should_show_copy_for_png_where_supported (AC-15)', () => {
    let view = show(env({ clipboard: false }).env)
    expect(names()).toEqual(['Download'])
    view.unmount()
    view = show(env({ supports: () => false }).env)
    expect(names()).toEqual(['Download'])
    view.unmount()
    view = show(env({ supports: (t) => t === 'image/png' }).env)
    expect(names()).toEqual(['Copy', 'Download'])
    view.unmount()
    show(env({ supports: (t) => t === 'image/png' }).env, {
      settings: { ...DEFAULT_FINISH, output: 'whatsapp' },
    })
    // Copy is for PNG outputs only (Decision 6).
    expect(names()).toEqual(['Download'])
  })

  it('should_share_at_once_with_the_ready_file (AC-14, Review Focus 1)', () => {
    const { env: e, spies } = env({ canShare: () => true })
    const view = show(e)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    // Recorded inside the click, before any await resolves.
    expect(spies.shared).toHaveLength(1)
    const files = spies.shared[0]?.files ?? []
    expect(files).toHaveLength(1)
    expect(files[0]?.name).toBe('peel-sticker-2026-11-16-0905.png')
    expect(files[0]?.type).toBe('image/png')
    // A changed setting makes the ready file stale: Share waits for the new one.
    const changed = { ...DEFAULT_FINISH, paddingPct: 5 }
    view.rerender(
      <ExportActions
        file={fileFor(DEFAULT_FINISH)}
        preparing={false}
        settings={changed}
        selection={selection}
        env={e}
      />,
    )
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled()
  })

  it('should_stay_quiet_when_the_share_sheet_closes (AC-14)', async () => {
    const closed = env({
      canShare: () => true,
      share: () => Promise.reject(new DOMException('closed', 'AbortError')),
    })
    const view = show(closed.env)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }))
      await Promise.resolve()
    })
    expect(screen.queryByRole('status')).toBeEmptyDOMElement()
    view.unmount()
    const broken = env({
      canShare: () => true,
      share: () => Promise.reject(new DOMException('no', 'NotAllowedError')),
    })
    show(broken.env)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }))
      await Promise.resolve()
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      "Couldn't share. Try Download instead.",
    )
  })

  it('should_copy_and_say_copied (AC-15)', async () => {
    vi.useFakeTimers()
    const { env: e, spies } = env()
    const view = show(e)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      await Promise.resolve()
    })
    expect(spies.written).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    view.unmount()
    show(env({ write: () => Promise.reject(new Error('denied')) }).env)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      await Promise.resolve()
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      "Couldn't copy. Try Share or Download instead.",
    )
  })

  it('should_download_with_the_spec_name (AC-16)', () => {
    const { env: e, spies } = env()
    show(e, { settings: { ...DEFAULT_FINISH, output: 'whatsapp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(spies.links).toEqual([
      {
        href: 'blob:x',
        download: 'peel-sticker-2026-11-16-0905-whatsapp.webp',
      },
    ])
  })
})
