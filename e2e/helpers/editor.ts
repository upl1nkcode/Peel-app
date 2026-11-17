import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { backupEntries, type StickerRecord } from '../../src/core/backup'
import type { Rgb } from '../../src/core/editor'
import { encodePng, storedDeflate } from '../../src/core/png'
import { serializeSelection } from '../../src/core/selection/serialize'
import type { Ring } from '../../src/core/selection/types'
import { writeZip } from '../../src/core/zip'

/** The seed sticker's photo: 120×80, four coloured quadrants. */
export const SEED_PHOTO = readFileSync(
  resolve('e2e/fixtures/orientation/orientation-1.jpg'),
)
/** The seed selection: a rectangle from (10, 10) to (110, 70). */
export const SEED_RECT = { x0: 10, y0: 10, x1: 110, y1: 70 }

export interface SeedOptions {
  photo: Uint8Array
  imageSize: { width: number; height: number }
  rect: { x0: number; y0: number; x1: number; y1: number }
  /** The selection's rings, in place of the rectangle (spec 0010). */
  rings?: Ring[]
}

const SEED: SeedOptions = {
  photo: new Uint8Array(SEED_PHOTO),
  imageSize: { width: 120, height: 80 },
  rect: SEED_RECT,
}

export async function seedRecord(
  options: Partial<SeedOptions> = {},
): Promise<StickerRecord> {
  const opts = { ...SEED, ...options }
  const { imageSize } = opts
  const { x0, y0, x1, y1 } = opts.rect
  const rect = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ].map((p) => ({ ...p, kind: 'corner' as const }))
  const rings: Ring[] = opts.rings ?? [{ op: 'add', nodes: rect }]
  const png = (v: number) =>
    encodePng(
      { width: 4, height: 4, data: new Uint8Array(64).fill(v) },
      storedDeflate,
    )
  return {
    id: '0b9c6c39-4f1a-4c51-9d7c-2f2a8b8f0e11',
    createdAt: Date.UTC(2026, 10, 1),
    updatedAt: Date.UTC(2026, 10, 2),
    imageSize,
    photo: { bytes: opts.photo, type: 'image/jpeg' },
    selection: serializeSelection(
      { rings, strokes: [], feather: 0 },
      imageSize,
    ),
    sticker: await png(200),
    thumbnail: await png(120),
  }
}

export async function seedBackup(opts?: Partial<SeedOptions>): Promise<Buffer> {
  const entries = backupEntries([await seedRecord(opts)], new Date(2026, 10, 2))
  return Buffer.concat(writeZip(entries, new Date(2026, 10, 2)))
}

/** The editor's "Library" button, then the Library (spec 0013). */
export async function toLibrary(page: Page) {
  await page.getByRole('button', { name: 'Library' }).click()
  await expect(page.getByRole('button', { name: 'New sticker' })).toBeVisible()
}

/** Exports every sticker through the Library's ⋯ menu; resolves to the download. */
export async function exportAllFromMenu(page: Page) {
  await page.getByRole('button', { name: 'More' }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Export all' }).click()
  return downloading
}

/** Imports a backup through the ⋯ menu's file input (spec 0013 AC-13). */
export async function importFile(page: Page, buffer: Buffer) {
  // Import is enabled once the sticker store is open.
  await expect(page.getByLabel('Import')).toBeEnabled()
  await page.getByLabel('Import').setInputFiles({
    name: 'peel-stickers-2026-11-02.zip',
    mimeType: 'application/zip',
    buffer,
  })
}

/** Waits until the canvas has drawn whatever it holds now. */
export function nextFrame(page: Page) {
  return page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done()
          })
        })
      }),
  )
}

/**
 * Model files: blocked in editor tests, so nothing large downloads. The spec
 * files also block service workers, which would fetch past page.route.
 */
export const MODEL_URL = /\/(engine|models)\//

/**
 * Opens the seed sticker (120×80 photo, rectangle selection) with model
 * downloads blocked, and waits for its mask. (Offline would also stop the
 * render worker's script from loading.)
 */
export async function seedAndOpen(page: Page, opts?: Partial<SeedOptions>) {
  await page.route(MODEL_URL, (route) => route.abort())
  await page.goto('/')
  await importFile(page, await seedBackup(opts))
  // The Library's tile opens it (spec 0013 AC-4).
  await page.getByRole('button', { name: 'Open sticker' }).first().click()
  const canvas = page.getByTestId('canvas')
  const size = opts?.imageSize ?? { width: 120, height: 80 }
  await expect(canvas).toHaveAttribute(
    'data-image-size',
    `${String(size.width)}x${String(size.height)}`,
  )
  await expect(canvas).not.toHaveAttribute('data-mask-scale', '')
  await nextFrame(page)
}

export interface CanvasInfo {
  box: { x: number; y: number; width: number; height: number }
  dpr: number
  /** Device px per image px. */
  displayScale: number
  center: { x: number; y: number }
}

export async function canvasInfo(page: Page): Promise<CanvasInfo> {
  const canvas = page.getByTestId('canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no canvas')
  const attrs = await canvas.evaluate((el) => ({
    scale: el.getAttribute('data-display-scale') ?? '',
    center: el.getAttribute('data-center') ?? '',
    dpr: window.devicePixelRatio || 1,
  }))
  const [cx, cy] = attrs.center.split(',').map(Number)
  return {
    box,
    dpr: attrs.dpr,
    displayScale: Number(attrs.scale),
    center: { x: cx, y: cy },
  }
}

/** The client (page CSS px) point over an image point, in the current view. */
export async function imageToClient(
  page: Page,
  imagePt: { x: number; y: number },
) {
  const { box, dpr, displayScale, center } = await canvasInfo(page)
  const cssPerImagePx = displayScale / dpr
  return {
    x: box.x + box.width / 2 + (imagePt.x - center.x) * cssPerImagePx,
    y: box.y + box.height / 2 + (imagePt.y - center.y) * cssPerImagePx,
  }
}

/** The device-pixel x/y on the visible canvas over an image point. */
export async function imageToDevice(
  page: Page,
  imagePt: { x: number; y: number },
) {
  const { box, dpr, displayScale, center } = await canvasInfo(page)
  return {
    x: (box.width * dpr) / 2 + (imagePt.x - center.x) * displayScale,
    y: (box.height * dpr) / 2 + (imagePt.y - center.y) * displayScale,
  }
}

/** RGBA of the visible canvas's device pixel containing `devicePt`. */
export function devicePixel(
  page: Page,
  devicePt: { x: number; y: number },
): Promise<number[]> {
  return page.getByTestId('canvas').evaluate((el, pt) => {
    const ctx = (el as HTMLCanvasElement).getContext('2d')
    if (!ctx) throw new Error('no 2D context')
    return [...ctx.getImageData(Math.floor(pt.x), Math.floor(pt.y), 1, 1).data]
  }, devicePt)
}

/** RGBA of the visible canvas under a CSS point of the canvas. */
export async function canvasPixel(page: Page, cssPt: { x: number; y: number }) {
  const { dpr } = await canvasInfo(page)
  return devicePixel(page, { x: cssPt.x * dpr, y: cssPt.y * dpr })
}

/** RGB of the full-size photo at an image pixel. */
export function photoPixel(
  page: Page,
  imagePx: { x: number; y: number },
): Promise<Rgb> {
  return page.getByTestId('photo').evaluate((el, pt) => {
    const ctx = (el as HTMLCanvasElement).getContext('2d')
    if (!ctx) throw new Error('no 2D context')
    const d = ctx.getImageData(pt.x, pt.y, 1, 1).data
    return [d[0], d[1], d[2]] as const
  }, imagePx)
}

/** Each channel within `tol` of `want`. */
export function expectRgb(
  got: readonly number[],
  want: Rgb,
  tol = 2,
  what = '',
) {
  for (let c = 0; c < 3; c++) {
    expect(
      Math.abs((got[c] ?? Number.NaN) - want[c]),
      `${what} channel ${String(c)}: got ${got.join(',')}, want ${want.map((v) => v.toFixed(1)).join(',')}`,
    ).toBeLessThanOrEqual(tol)
  }
}

/**
 * Picks a `width`×`height` PNG generated in the page (a gradient, so every
 * pixel differs), with model downloads blocked, and waits for its mask.
 */
export async function pickGenerated(page: Page, width: number, height: number) {
  await page.route(MODEL_URL, (route) => route.abort())
  await page.goto('/')
  const base64 = await page.evaluate(
    async ({ width, height }) => {
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('no 2D context')
      const g = ctx.createLinearGradient(0, 0, width, height)
      g.addColorStop(0, '#2a6')
      g.addColorStop(1, '#e83')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, width, height)
      const blob = await new Promise<Blob>((done, fail) => {
        c.toBlob((b) => {
          if (b) done(b)
          else fail(new Error('toBlob failed'))
        }, 'image/png')
      })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (const b of bytes) s += String.fromCharCode(b)
      return btoa(s)
    },
    { width, height },
  )
  await page.getByLabel('Pick a photo').setInputFiles({
    name: 'generated.png',
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64'),
  })
  const canvas = page.getByTestId('canvas')
  await expect(canvas).toHaveAttribute(
    'data-image-size',
    `${String(width)}x${String(height)}`,
  )
  await expect(canvas).not.toHaveAttribute('data-mask-scale', '')
}

/**
 * A `width`×`height` JPEG made in the page: a gradient with a fine grid, so
 * neighbouring pixels differ and drawing can't take a flat-colour shortcut.
 */
export async function generatedJpeg(
  page: Page,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const base64 = await page.evaluate(
    async ({ width, height }) => {
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('no 2D context')
      const g = ctx.createLinearGradient(0, 0, width, height)
      g.addColorStop(0, '#2a6')
      g.addColorStop(1, '#e83')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = 'rgb(0 0 0 / 0.25)'
      for (let x = 0; x < width; x += 16) ctx.fillRect(x, 0, 2, height)
      for (let y = 0; y < height; y += 16) ctx.fillRect(0, y, width, 2)
      const blob = await new Promise<Blob>((done, fail) => {
        c.toBlob(
          (b) => {
            if (b) done(b)
            else fail(new Error('toBlob failed'))
          },
          'image/jpeg',
          0.9,
        )
      })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (const b of bytes) s += String.fromCharCode(b)
      return btoa(s)
    },
    { width, height },
  )
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

/**
 * A backup of `n` seed stickers with their own ids and thumbnail shades,
 * newest first in the Library (spec 0013 AC-29).
 */
export async function seedMany(n: number): Promise<Buffer> {
  const base = await seedRecord()
  const records: StickerRecord[] = []
  for (let k = 0; k < n; k++) {
    const shade = 60 + Math.round((k * 160) / Math.max(1, n - 1))
    records.push({
      ...base,
      id: `0b9c6c39-4f1a-4c51-9d7c-${String(k).padStart(12, '0')}`,
      updatedAt: base.updatedAt + k,
      thumbnail: await encodePng(
        {
          width: 4,
          height: 4,
          data: new Uint8Array(64).map((_, i) =>
            i % 4 === 3 ? 255 : i % 4 === 0 ? shade : 255 - shade,
          ),
        },
        storedDeflate,
      ),
    })
  }
  const entries = backupEntries(records, new Date(2026, 10, 2))
  return Buffer.concat(writeZip(entries, new Date(2026, 10, 2)))
}
