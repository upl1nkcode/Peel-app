import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { readZip, utf8Decode } from '../src/core/zip'
import { imageToClient } from './helpers/editor'

/**
 * Auto cutout with the real MediaPipe models (spec 0007 AC-18, AC-20 to
 * AC-23). Fixtures: e2e/fixtures/auto (README.md has sources and licences).
 */

const DIR = resolve('e2e/fixtures/auto')

interface Pt {
  x: number
  y: number
}
interface Fixture {
  image: string
  subjects: Partial<Record<string, { alpha: string; tap: Pt }>>
  headBox?: { x: number; y: number; width: number; height: number }
}
const FIXTURES = JSON.parse(
  readFileSync(resolve(DIR, 'fixtures.json'), 'utf8'),
) as Record<'object' | 'two-objects' | 'person', Fixture>

const MODEL_URL = /\/(engine|models)\//

const subject = (name: keyof typeof FIXTURES, key: string) => {
  const s = FIXTURES[name].subjects[key]
  if (!s) throw new Error(`no subject ${key} in ${name}`)
  return s
}

const phase = (page: Page) =>
  page.getByTestId('editor').getAttribute('data-phase')

/** Loads the ground-truth alphas into the page (as 0–255 per pixel). */
async function loadTruth(page: Page, files: string[]) {
  const pngs = files.map((f) => ({
    name: f,
    url: `data:image/png;base64,${readFileSync(resolve(DIR, f)).toString('base64')}`,
  }))
  await page.evaluate(async (list) => {
    const store = ((
      window as unknown as { __truth?: Partial<Record<string, Uint8Array>> }
    ).__truth ??= {})
    for (const { name, url } of list) {
      const img = new Image()
      img.src = url
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('no 2D canvas')
      ctx.drawImage(img, 0, 0)
      const rgba = ctx.getImageData(0, 0, c.width, c.height).data
      const alpha = new Uint8Array(c.width * c.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4] ?? 0
      store[name] = alpha
    }
  }, pngs)
}

/** IoU of the canvas alpha ≥ 128 with the union of the truths ≥ 128; -1 if the canvas is not 960×600. */
function iou(page: Page, files: string[]): Promise<number> {
  return page.evaluate((names) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-testid=cutout]',
    )
    if (canvas?.width !== 960 || canvas.height !== 600) return -1
    const ctx = canvas.getContext('2d')
    if (!ctx) return -1
    const got = ctx.getImageData(0, 0, 960, 600).data
    const store = (
      window as unknown as { __truth: Partial<Record<string, Uint8Array>> }
    ).__truth
    let inter = 0
    let union = 0
    for (let i = 0; i < 960 * 600; i++) {
      const truth = names.some((n) => (store[n]?.[i] ?? 0) >= 128)
      const mine = (got[i * 4 + 3] ?? 0) >= 128
      if (truth && mine) inter++
      if (truth || mine) union++
    }
    return union === 0 ? 0 : inter / union
  }, files)
}

/** Share of rendered pixels within 2 px of the truth's 50% line, inside `box`, with alpha in [26, 229] (AC-23). */
function softShare(
  page: Page,
  file: string,
  box: NonNullable<Fixture['headBox']>,
): Promise<number> {
  return page.evaluate(
    ({ file, box }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[data-testid=cutout]',
      )
      const ctx = canvas?.getContext('2d')
      if (!ctx) return -1
      const got = ctx.getImageData(0, 0, 960, 600).data
      const truth = (
        window as unknown as { __truth: Partial<Record<string, Uint8Array>> }
      ).__truth[file]
      if (!truth) return -1
      const inside = (x: number, y: number) => (truth[y * 960 + x] ?? 0) >= 128
      let band = 0
      let soft = 0
      for (let y = box.y; y < box.y + box.height; y++) {
        for (let x = box.x; x < box.x + box.width; x++) {
          const here = inside(x, y)
          // An opposite pixel's centre within 2.5 px puts the 50% line within 2 px.
          let near = false
          for (let dy = -2; dy <= 2 && !near; dy++) {
            for (let dx = -2; dx <= 2 && !near; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= 960 || ny >= 600) continue
              if (dx * dx + dy * dy > 6.25) continue
              if (inside(nx, ny) !== here) near = true
            }
          }
          if (!near) continue
          band++
          const a = got[(y * 960 + x) * 4 + 3] ?? 0
          if (a >= 26 && a <= 229) soft++
        }
      }
      return band === 0 ? 0 : soft / band
    },
    { file, box },
  )
}

async function open(page: Page, name: keyof typeof FIXTURES) {
  await page.goto('/')
  await page
    .getByLabel('Pick a photo')
    .setInputFiles(resolve(DIR, FIXTURES[name].image))
  await expect(page.getByTestId('canvas')).toHaveAttribute(
    'data-image-size',
    /\d+x\d+/,
  )
}

/** A tap (or a 600 ms long-press) at an image point, in the current view. */
async function press(page: Page, at: Pt, holdMs = 0) {
  const pt = await imageToClient(page, at)
  await page.mouse.move(pt.x, pt.y)
  await page.mouse.down()
  if (holdMs) await page.waitForTimeout(holdMs)
  await page.mouse.up()
}

/** Presses, then waits for both engines to finish. */
async function pressAndSettle(page: Page, at: Pt, holdMs = 0) {
  await press(page, at, holdMs)
  await expect.poll(() => phase(page)).not.toBe('done')
  await expect.poll(() => phase(page), { timeout: 200_000 }).toBe('done')
}

test.describe('auto cutout with the real models', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 })
  test.use({ viewport: { width: 1280, height: 1000 } })
  test.skip(
    ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
    'Real-model runs are desktop-only (CPU time)',
  )

  test('should_select_the_tapped_object (AC-21)', async ({ page }) => {
    await open(page, 'object')
    const cup = subject('object', 'A')
    await loadTruth(page, [cup.alpha])
    await press(page, cup.tap)
    // The fast result, shown while the precise one runs.
    await expect
      .poll(
        async () => {
          const p = await phase(page)
          if (p === 'done') return 'missed the fast result'
          if (p !== 'sharpening') return 'waiting'
          return (await iou(page, [cup.alpha])) >= 0.75 ? 'ok' : 'waiting'
        },
        { timeout: 120_000 },
      )
      .toBe('ok')
    await expect.poll(() => phase(page), { timeout: 200_000 }).toBe('done')
    await expect.poll(() => iou(page, [cup.alpha])).toBeGreaterThanOrEqual(0.9)
  })

  test('should_add_and_remove_objects (AC-22)', async ({ page }) => {
    await open(page, 'two-objects')
    const a = subject('two-objects', 'A')
    const b = subject('two-objects', 'B')
    await loadTruth(page, [a.alpha, b.alpha])
    await pressAndSettle(page, a.tap)
    await pressAndSettle(page, b.tap)
    await expect
      .poll(() => iou(page, [a.alpha, b.alpha]))
      .toBeGreaterThanOrEqual(0.85)
    await pressAndSettle(page, b.tap, 600)
    await expect.poll(() => iou(page, [a.alpha])).toBeGreaterThanOrEqual(0.9)
  })

  test('should_keep_soft_hair_on_a_person (AC-23)', async ({ page }) => {
    await open(page, 'person')
    const person = subject('person', 'A')
    const head = FIXTURES.person.headBox
    if (!head) throw new Error('no head box')
    await loadTruth(page, [person.alpha])
    await pressAndSettle(page, person.tap)
    await expect
      .poll(() => iou(page, [person.alpha]))
      .toBeGreaterThanOrEqual(0.9)
    expect(await softShare(page, person.alpha, head)).toBeGreaterThanOrEqual(
      0.25,
    )
  })

  test('should_work_offline_after_the_first_download (AC-18)', async ({
    page,
    context,
  }) => {
    await open(page, 'object')
    const cup = subject('object', 'A')
    await pressAndSettle(page, cup.tap)
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))

    await context.setOffline(true)
    const fetched: string[] = []
    context.on('request', (r) => {
      if (MODEL_URL.test(r.url())) fetched.push(r.url())
    })
    await page.reload()
    await page
      .getByLabel('Pick a photo')
      .setInputFiles(resolve(DIR, FIXTURES.object.image))
    await expect(page.getByTestId('canvas')).toHaveAttribute(
      'data-image-size',
      /\d+x\d+/,
    )
    await loadTruth(page, [cup.alpha])
    await press(page, cup.tap)
    await expect
      .poll(() => iou(page, [cup.alpha]), { timeout: 120_000 })
      .toBeGreaterThanOrEqual(0.75)
    expect(fetched).toEqual([])
  })

  test('should_reopen_and_save_the_same_png (spec 0008 AC-9)', async ({
    page,
  }) => {
    /** Saves the cutout on screen, then exports; returns the backup's files. */
    const saveAndExport = async () => {
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({
        timeout: 60_000,
      })
      const downloading = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Export all' }).click()
      const zip = readFileSync(await (await downloading).path())
      const { files } = await readZip(new Uint8Array(zip), (d) =>
        Promise.resolve(new Uint8Array(inflateRawSync(d))),
      )
      return files
    }
    const sticker = (files: Map<string, Uint8Array>) => {
      const manifest = JSON.parse(
        utf8Decode(files.get('peel-backup.json') ?? new Uint8Array()),
      ) as { stickers: { id: string; createdAt: number; updatedAt: number }[] }
      expect(manifest.stickers).toHaveLength(1)
      const meta = manifest.stickers[0]
      const file = (name: string) => files.get(`stickers/${meta.id}/${name}`)
      return { meta, file }
    }

    await open(page, 'object')
    await pressAndSettle(page, subject('object', 'A').tap)
    const first = sticker(await saveAndExport())
    expect(first.file('model-alpha.bin')).toBeDefined()

    await page.reload()
    await page.getByRole('button', { name: 'Open sticker' }).click()
    await expect(
      page.getByRole('button', { name: 'Save', exact: true }),
    ).toBeEnabled({ timeout: 60_000 })
    const second = sticker(await saveAndExport())

    expect(second.meta.id).toBe(first.meta.id)
    expect(second.meta.createdAt).toBe(first.meta.createdAt)
    expect(second.meta.updatedAt).toBeGreaterThan(first.meta.updatedAt)
    for (const name of [
      'sticker.png',
      'selection.json',
      'model-alpha.bin',
      'photo.jpg',
    ]) {
      expect(second.file(name), name).toEqual(first.file(name))
    }
  })
})

test('should_explain_offline_first_use (AC-20)', async ({ page, context }) => {
  await page.goto('/')
  // Playwright's WebKit on Windows has no OffscreenCanvas: it is told Auto
  // doesn't work there (see the next test) before it would go online.
  const capable = await page.evaluate(
    () => typeof OffscreenCanvas === 'function',
  )
  await context.setOffline(true)
  await page
    .getByLabel('Pick a photo')
    .setInputFiles(resolve(DIR, FIXTURES.object.image))
  await expect(page.getByTestId('canvas')).toHaveAttribute(
    'data-image-size',
    /\d+x\d+/,
  )
  await press(page, subject('object', 'A').tap)
  await expect(
    page.getByText(
      capable
        ? "You're offline. The cutout model needs one download first."
        : "Auto cutout doesn't work in this browser.",
    ),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use Lasso' })).toBeVisible()
})

test('should_not_download_in_a_browser_that_cannot_run_auto (AC-20)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
  })
  const fetched: string[] = []
  page.on('request', (r) => {
    if (MODEL_URL.test(r.url())) fetched.push(r.url())
  })
  await page.goto('/')
  await page
    .getByLabel('Pick a photo')
    .setInputFiles(resolve(DIR, FIXTURES.object.image))
  await expect(
    page.getByText("Auto cutout doesn't work in this browser."),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use Lasso' })).toBeVisible()
  expect(fetched).toEqual([])
})
