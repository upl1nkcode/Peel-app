import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/**
 * Photo loading (spec 0008 AC-1 to AC-3) in every project. Fixtures:
 * e2e/fixtures/orientation (README.md). The page goes offline after loading
 * so picking a photo doesn't download the cutout models.
 */

const DIR = resolve('e2e/fixtures/orientation')
const UNREADABLE = "This photo can't be opened. Try a JPEG or PNG."

const QUADRANTS = {
  'top-left': { box: [10, 10, 50, 30], rgb: [230, 30, 30] },
  'top-right': { box: [70, 10, 110, 30], rgb: [30, 200, 30] },
  'bottom-left': { box: [10, 50, 50, 70], rgb: [30, 30, 230] },
  'bottom-right': { box: [70, 50, 110, 70], rgb: [230, 220, 30] },
} as const

async function start(page: Page) {
  await page.goto('/')
  await page.context().setOffline(true)
}

const stage = (page: Page) => page.locator('.auto-stage')

/** Mean RGB of a box [x0, y0, x1, y1) of the photo canvas, drawn at scale 1. */
function meanColour(page: Page, box: readonly number[]) {
  return page.getByTestId('photo').evaluate((el, [x0, y0, x1, y1]) => {
    const canvas = el as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2D context')
    const w = x1 - x0
    const h = y1 - y0
    const { data } = ctx.getImageData(x0, y0, w, h)
    const sum = [0, 0, 0]
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (data[i + c] ?? 0)
    }
    return sum.map((s) => s / (w * h))
  }, box)
}

test('should_load_every_orientation_upright (AC-1)', async ({ page }) => {
  await start(page)
  for (let n = 1; n <= 8; n++) {
    await page
      .getByLabel('Pick a photo')
      .setInputFiles(resolve(DIR, `orientation-${String(n)}.jpg`))
    await expect(stage(page)).toHaveAttribute('data-image-size', '120x80')
    await expect(page.getByTestId('photo')).toHaveJSProperty('width', 120)
    for (const [name, q] of Object.entries(QUADRANTS)) {
      const got = await meanColour(page, q.box)
      for (let c = 0; c < 3; c++) {
        expect(
          Math.abs((got[c] ?? 0) - (q.rgb[c] ?? 0)),
          `orientation ${String(n)}, ${name}, channel ${String(c)}: ${got.join(', ')}`,
        ).toBeLessThanOrEqual(12)
      }
    }
  }
})

test('should_cap_large_photos (AC-2)', async ({ page }) => {
  await start(page)
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 5000
    canvas.height = 3000
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2D context')
    ctx.fillStyle = '#3080c0'
    ctx.fillRect(0, 0, 5000, 3000)
    return canvas.toDataURL('image/jpeg', 0.8)
  })
  const buffer = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64')
  await page
    .getByLabel('Pick a photo')
    .setInputFiles({ name: 'big.jpg', mimeType: 'image/jpeg', buffer })
  await expect(stage(page)).toHaveAttribute('data-image-size', '4579x2747')
})

test('should_explain_unreadable_files (AC-3)', async ({ page }) => {
  await start(page)
  const pick = page.getByLabel('Pick a photo')
  await pick.setInputFiles(resolve(DIR, 'orientation-1.jpg'))
  await expect(stage(page)).toHaveAttribute('data-image-size', '120x80')

  const junk = Buffer.from(
    Array.from({ length: 100 }, (_, i) => (i * 73 + 11) % 256),
  )
  const bad = [
    { name: 'broken.jpg', mimeType: 'image/jpeg', buffer: junk },
    {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a photo'),
    },
  ]
  for (const file of bad) {
    await pick.setInputFiles(file)
    await expect(page.getByText(UNREADABLE)).toBeVisible()
    await expect(stage(page)).toHaveAttribute('data-image-size', '120x80')
    await expect(page.getByTestId('photo')).toBeVisible()
  }

  // A good photo clears the message.
  await pick.setInputFiles(resolve(DIR, 'orientation-6.jpg'))
  await expect(page.getByText(UNREADABLE)).toBeHidden()
})
