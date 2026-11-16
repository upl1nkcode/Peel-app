import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { canvasInfo, imageToClient, nextFrame } from './helpers/editor'
import { zoomAt } from './helpers/dots'
import { decodeInPage, expectFile, openFinish } from './helpers/finish'

// The service worker would fetch past page.route (see editor-screens).
test.use({ serviceWorkers: 'block' })

const NAME = /^peel-sticker-\d{4}-\d{2}-\d{2}-\d{4}/

async function download(page: Page) {
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  const file = await downloading
  const path = await file.path()
  return { name: file.suggestedFilename(), bytes: readFileSync(path) }
}

test('should_download_a_sticker_png (spec 0012 AC-2, AC-16)', async ({
  page,
}) => {
  await openFinish(page)
  // The seed cutout is the 100 × 60 rectangle, never enlarged.
  await expectFile(page, /^PNG · 100 × 60 px · \d+ KB$/)
  const file = await download(page)
  expect(file.name).toMatch(new RegExp(`${NAME.source}\\.png$`))
  const img = await decodeInPage(page, file.bytes, 'image/png', [
    { x: 50, y: 30 },
  ])
  expect(Math.max(img.width, img.height)).toBeLessThanOrEqual(1024)
  expect([img.width, img.height]).toEqual([100, 60])
  expect(img.alpha).toEqual([255])
})

test('should_download_a_whatsapp_webp (spec 0012 AC-4, AC-5)', async ({
  page,
}) => {
  await openFinish(page)
  await page.getByRole('radio', { name: 'WhatsApp-style' }).check()
  await expectFile(page, /^WEBP · 512 × 512 px · \d+ KB$/)
  const file = await download(page)
  expect(file.name).toMatch(new RegExp(`${NAME.source}-whatsapp\\.webp$`))
  expect(file.bytes.length).toBeLessThanOrEqual(102_400)
  expect(file.bytes.subarray(8, 12).toString('latin1')).toBe('WEBP')
  const img = await decodeInPage(page, file.bytes, 'image/webp', [
    { x: 0, y: 0 },
    { x: 256, y: 256 },
  ])
  expect([img.width, img.height]).toEqual([512, 512])
  expect(img.alpha[0]).toBe(0)
  expect(img.alpha[1]).toBe(255)
})

test('should_share_the_file_where_supported (spec 0012 AC-14)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const shared: { type: string; name: string }[] = []
    Object.assign(window, { __shared: shared })
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => true,
    })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: ShareData) => {
        for (const f of data.files ?? []) {
          shared.push({ type: f.type, name: f.name })
        }
        return Promise.resolve()
      },
    })
  })
  await openFinish(page)
  await page.getByRole('button', { name: 'Share' }).click()
  const shared = await page.evaluate(
    () => (window as unknown as { __shared: unknown[] }).__shared,
  )
  expect(shared).toEqual([
    { type: 'image/png', name: expect.stringMatching(NAME) as unknown },
  ])
})

test('should_show_share_only_where_the_browser_shares_files (spec 0012 AC-13, AC-14)', async ({
  page,
}) => {
  await openFinish(page)
  const sharesPng = await page.evaluate(() => {
    if (typeof navigator.canShare !== 'function') return false
    try {
      return navigator.canShare({
        files: [new File([new Uint8Array(8)], 'p.png', { type: 'image/png' })],
      })
    } catch {
      return false
    }
  })
  await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(
    sharesPng ? 1 : 0,
  )
  await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled()
})

test('should_show_the_guide_on_iphone_only (spec 0012 AC-18)', async ({
  page,
}, info) => {
  await openFinish(page)
  const guide = page.getByRole('button', {
    name: 'How to add to iPhone Stickers',
  })
  if (info.project.name === 'iphone-15') {
    await expect(guide).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('listitem')).toHaveCount(5)
  } else {
    await expect(guide).toHaveCount(0)
  }
})

test('should_fit_the_finish_screen (spec 0012 AC-20)', async ({ page }) => {
  for (const size of [
    { width: 375, height: 812 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(size)
    await openFinish(page)
    const fit = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement
      const preview = document.querySelector('[data-testid="finish-preview"]')
      return {
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        preview: preview?.getBoundingClientRect().height ?? 0,
        height: window.innerHeight,
      }
    })
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth)
    expect(fit.preview).toBeGreaterThanOrEqual(0.4 * fit.height - 1)
  }
})

test('should_go_back_with_everything_as_it_was (spec 0012 AC-8)', async ({
  page,
}) => {
  await openFinish(page)
  await page.getByRole('button', { name: 'Back' }).click()
  const start = (await canvasInfo(page)).displayScale
  await zoomAt(page, { x: 60, y: 40 }, 2)
  await nextFrame(page)
  const zoomed = await canvasInfo(page)
  expect(zoomed.displayScale).toBeGreaterThan(start)
  const anchor = await imageToClient(page, { x: 60, y: 40 })
  await page.getByRole('button', { name: 'Done' }).click()
  await expectFile(page, /px/)
  await page.getByRole('button', { name: 'Back' }).click()
  await nextFrame(page)
  expect((await canvasInfo(page)).displayScale).toBe(zoomed.displayScale)
  expect(await imageToClient(page, { x: 60, y: 40 })).toEqual(anchor)
})
