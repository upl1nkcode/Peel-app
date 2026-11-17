import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canCopyPng,
  canShareType,
  copyPng,
  downloadBlob,
  ONE_PIXEL,
  shareFile,
} from './exportActions'

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n))

afterEach(() => {
  vi.useRealTimers()
})

describe('export actions (spec 0012)', () => {
  it('should_probe_with_real_one_pixel_files (AC-14)', () => {
    expect(ascii(ONE_PIXEL['image/png'], 1, 3)).toBe('PNG')
    expect(ascii(ONE_PIXEL['image/webp'], 0, 4)).toBe('RIFF')
    expect(ascii(ONE_PIXEL['image/webp'], 8, 4)).toBe('WEBP')
  })

  it('should_show_share_only_when_files_can_be_shared (AC-14)', () => {
    expect(canShareType(undefined, 'image/png')).toBe(false)
    expect(canShareType({} as Navigator, 'image/png')).toBe(false)
    const probes: File[] = []
    const nav = {
      canShare: (data?: ShareData) => {
        const file = data?.files?.[0]
        if (file) probes.push(file)
        return file?.type === 'image/png'
      },
    }
    expect(canShareType(nav, 'image/png')).toBe(true)
    expect(canShareType(nav, 'image/webp')).toBe(false)
    expect(probes.map((f) => [f.type, f.size > 0])).toEqual([
      ['image/png', true],
      ['image/webp', true],
    ])
    const throwing = {
      canShare: () => {
        throw new TypeError('no')
      },
    }
    expect(canShareType(throwing, 'image/png')).toBe(false)
  })

  it('should_show_copy_for_png_where_supported (AC-15)', () => {
    const clipboard = { write: () => Promise.resolve() }
    expect(canCopyPng({ clipboard })).toBe(false)
    expect(canCopyPng({ ClipboardItem: {} })).toBe(false)
    expect(canCopyPng({ clipboard, ClipboardItem: {} })).toBe(true)
    expect(
      canCopyPng({ clipboard, ClipboardItem: { supports: () => false } }),
    ).toBe(false)
    expect(
      canCopyPng({
        clipboard,
        ClipboardItem: { supports: (t: string) => t === 'image/png' },
      }),
    ).toBe(true)
  })

  it('should_call_share_at_once_and_name_aborts (AC-14)', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    const shared: ShareData[] = []
    const nav = {
      share: (data?: ShareData) => {
        if (data) shared.push(data)
        return Promise.resolve()
      },
    }
    const done = shareFile(nav, file)
    // Called before any await: Safari needs the tap's activation.
    expect(shared).toEqual([{ files: [file] }])
    await expect(done).resolves.toBe('shared')
    const abort = {
      share: () => Promise.reject(new DOMException('closed', 'AbortError')),
    }
    await expect(shareFile(abort, file)).resolves.toBe('cancelled')
    const broken = {
      share: () => Promise.reject(new DOMException('no', 'NotAllowedError')),
    }
    await expect(shareFile(broken, file)).rejects.toThrow('no')
  })

  it('should_copy_as_png (AC-15)', async () => {
    const written: unknown[] = []
    class Item {
      items: Record<string, Blob>
      constructor(items: Record<string, Blob>) {
        this.items = items
      }
    }
    const blob = new Blob(['x'], { type: 'image/png' })
    await copyPng(
      {
        write: (data: ClipboardItems) => {
          written.push(...data)
          return Promise.resolve()
        },
      },
      blob,
      Item as unknown as typeof ClipboardItem,
    )
    expect(written).toEqual([new Item({ 'image/png': blob })])
  })

  it('should_download_with_the_name_and_revoke_later (AC-16)', () => {
    vi.useFakeTimers()
    const clicks: { href: string; download: string }[] = []
    const link = {
      href: '',
      download: '',
      click() {
        clicks.push({ href: this.href, download: this.download })
      },
    }
    const doc = { createElement: () => link } as unknown as Document
    const revoked: string[] = []
    Object.assign(URL, {
      createObjectURL: () => 'blob:x',
      revokeObjectURL: (u: string) => revoked.push(u),
    })
    downloadBlob(
      new Blob(['x']),
      'peel-sticker-2026-11-16-0905-whatsapp.webp',
      doc,
    )
    expect(clicks).toEqual([
      {
        href: 'blob:x',
        download: 'peel-sticker-2026-11-16-0905-whatsapp.webp',
      },
    ])
    vi.advanceTimersByTime(29_999)
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(1)
    expect(revoked).toEqual(['blob:x'])
  })
})
