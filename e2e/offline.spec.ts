import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from './helpers/test'
import { imageToClient, importFile, seedBackup } from './helpers/editor'
import { decodeInPage, expectFile } from './helpers/finish'

/**
 * Offline after the first visit (spec 0013 AC-18 to AC-21): the app, the
 * engine, both models and the WebP encoder come from the service worker's
 * and the model store's caches, with the network off.
 */

const DIR = resolve('e2e/fixtures/auto')
const FIXTURES = JSON.parse(
  readFileSync(resolve(DIR, 'fixtures.json'), 'utf8'),
) as Record<
  'object',
  { image: string; subjects: Record<'A', { tap: { x: number; y: number } }> }
>

/** The accuracy benchmark's hole photo (spec 0014 AC-12). */
const BENCH = resolve('bench/fixtures')
const HOLE = (
  JSON.parse(readFileSync(resolve(BENCH, 'fixtures.json'), 'utf8')) as Record<
    'hole',
    {
      image: string
      tap: { x: number; y: number }
      holeProbe: { x: number; y: number; width: number; height: number }
    }
  >
).hole

/** The largest cutout alpha inside the hole (2 px in from its box), scaled to the canvas. */
function holeAlpha(page: Page, photoWidth: number) {
  return page.getByTestId('cutout').evaluate(
    (el, { box, photoWidth }) => {
      const c = el as HTMLCanvasElement
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('no 2D context')
      const k = c.width / photoWidth
      const x0 = Math.ceil((box.x + 2) * k)
      const y0 = Math.ceil((box.y + 2) * k)
      const x1 = Math.floor((box.x + box.width - 2) * k)
      const y1 = Math.floor((box.y + box.height - 2) * k)
      const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
      let max = 0
      for (let i = 3; i < data.length; i += 4) max = Math.max(max, data[i] ?? 0)
      return max
    },
    { box: HOLE.holeProbe, photoWidth },
  )
}

const phase = (page: Page) =>
  page.getByTestId('editor').getAttribute('data-phase')

async function download(page: Page) {
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  const file = await downloading
  return {
    name: file.suggestedFilename(),
    bytes: readFileSync(await file.path()),
  }
}

test.describe('offline after the first visit', () => {
  test.describe.configure({ timeout: 300_000 })
  test.use({
    prefetch: true,
    serviceWorkers: 'allow',
    viewport: { width: 1280, height: 1000 },
  })
  test.skip(
    ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
    "Real-model runs are desktop-only (CPU time), and Playwright's WebKit doesn't serve an offline reload from the service worker",
  )

  test('should_work_in_airplane_mode_after_the_first_visit (AC-21)', async ({
    page,
    context,
  }) => {
    // 1. The first visit, online: everything downloads.
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await importFile(page, await seedBackup())
    await expect(
      page.getByRole('button', { name: 'Open sticker' }),
    ).toHaveCount(1)
    await page.getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('menu')).toContainText(
      'Ready to use offline.',
      { timeout: 120_000 },
    )
    await page.keyboard.press('Escape')

    // 2. Airplane mode, then a reload: the Library still shows.
    await context.setOffline(true)
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Open sticker' }),
    ).toHaveCount(1)

    // 3. A new photo, and Auto at its centre.
    await page
      .getByLabel('Pick a photo')
      .setInputFiles(resolve(DIR, FIXTURES.object.image))
    await expect(page.getByTestId('canvas')).toHaveAttribute(
      'data-image-size',
      /\d+x\d+/,
    )
    const at = await imageToClient(page, FIXTURES.object.subjects.A.tap)
    await page.mouse.click(at.x, at.y)
    await expect.poll(() => phase(page), { timeout: 200_000 }).toBe('done')
    await expect(page.getByText(/needs the internet/)).toHaveCount(0)

    // 4. Every output, made offline.
    await page.getByRole('button', { name: 'Done' }).click()
    await expectFile(page, /^PNG · \d+ × \d+ px · \d+ KB$/)
    const sticker = await download(page)
    expect(sticker.name).toMatch(/\.png$/)
    expect(sticker.bytes.subarray(1, 4).toString('latin1')).toBe('PNG')

    await page.getByRole('radio', { name: 'Original' }).check()
    await expectFile(page, /^PNG · \d+ × \d+ px · \d+ KB$/)
    const original = await download(page)
    expect(original.name).toMatch(/-original\.png$/)

    await page.getByRole('radio', { name: 'WhatsApp-style' }).check()
    await expectFile(page, /^WEBP · 512 × 512 px · \d+ KB$/)
    const webp = await download(page)
    expect(webp.name).toMatch(/-whatsapp\.webp$/)
    const img = await decodeInPage(page, webp.bytes, 'image/webp', [
      { x: 0, y: 0 },
    ])
    expect([img.width, img.height]).toEqual([512, 512])
    expect(img.alpha[0]).toBe(0)

    // 5. Saved offline: two stickers on the Library.
    await page.getByRole('button', { name: 'Back' }).click()
    await page
      .getByTestId('editor')
      .getByRole('button', { name: 'Save', exact: true })
      .click()
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
    await page.getByRole('button', { name: 'Library' }).click()
    await expect(
      page.getByRole('button', { name: 'Open sticker' }),
    ).toHaveCount(2)

    // 6. Still offline, Auto on the hole photo: the hole stays empty (spec 0014 AC-12).
    await page
      .getByLabel('Pick a photo')
      .setInputFiles(resolve(BENCH, HOLE.image))
    await expect(page.getByTestId('canvas')).toHaveAttribute(
      'data-image-size',
      '1600x1000',
    )
    const hole = await imageToClient(page, HOLE.tap)
    await page.mouse.click(hole.x, hole.y)
    await expect.poll(() => phase(page), { timeout: 200_000 }).toBe('done')
    await page
      .getByTestId('editor')
      .getByRole('button', { name: 'Save', exact: true })
      .click()
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
    // Known miss #158 (spec 0014 Decision 8): Auto fills the hole today, so
    // this asserts that and goes red when a fix lands. The fix makes it the
    // real AC-12 check: expect(...).toBeLessThan(26).
    expect(
      await holeAlpha(page, 1600),
      'alpha inside the hole: if this fails, #158 may be fixed',
    ).toBeGreaterThanOrEqual(26)
  })
})
