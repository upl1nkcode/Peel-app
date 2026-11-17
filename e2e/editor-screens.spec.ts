import { expect, test } from './helpers/test'
import { VIEW_MODES } from '../src/core/editor'
import { en } from '../src/ui/i18n/en'
import {
  generatedJpeg,
  imageToClient,
  importFile,
  nextFrame,
  seedAndOpen,
  seedMany,
} from './helpers/editor'

// The PWA's service worker would fetch the models itself, past page.route,
// so seedAndOpen's block leaked on CI WebKit (PR #138). Block it here.
test.use({ serviceWorkers: 'block' })

/**
 * Screenshot baselines (spec 0009 AC-12, AC-25; spec 0010 AC-19; spec 0011
 * AC-25). Fonts and rasterising
 * differ between systems, so baselines are made and checked on CI Linux,
 * in the Pixel 8 project only.
 */
test.skip(process.platform !== 'linux', 'baselines are made on CI Linux')
test.skip(
  ({ isMobile, browserName }) => !isMobile || browserName !== 'chromium',
  'baselines are for the Pixel 8 project',
)

const SHOT = {
  maxDiffPixelRatio: 0.001,
  stylePath: 'e2e/helpers/screens.css',
  animations: 'disabled',
} as const

test('should_match_each_view_at_fit_and_100_percent (AC-12)', async ({
  page,
}) => {
  // Larger than the screen, so fit is below 100% (zoom never goes below
  // fit); the selection's right edge sits near the centre, in both shots.
  await page.goto('/')
  const imageSize = { width: 1600, height: 1200 }
  await seedAndOpen(page, {
    photo: await generatedJpeg(page, imageSize.width, imageSize.height),
    imageSize,
    rect: { x0: 300, y0: 250, x1: 820, y1: 950 },
  })
  const canvas = page.getByTestId('canvas')
  await page.getByRole('button', { name: 'View' }).click()
  for (const zoom of ['fit', '100'] as const) {
    if (zoom === '100') {
      await canvas.dblclick()
      await expect(canvas).toHaveAttribute('data-display-scale', '1.0000')
      await expect(canvas).toHaveAttribute('data-mask-scale', '1.0000')
    }
    for (const mode of VIEW_MODES) {
      await page.getByRole('radio', { name: en[`view.${mode}`] }).click()
      await expect(canvas).toHaveAttribute('data-view', mode)
      await nextFrame(page)
      await expect(canvas).toHaveScreenshot(`view-${mode}-${zoom}.png`, SHOT)
    }
  }
})

test('should_match_the_editor_layout (AC-25)', async ({ page }) => {
  for (const size of [
    { width: 375, height: 812 },
    { width: 430, height: 932 },
  ]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize(size)
      await page.emulateMedia({ colorScheme })
      await seedAndOpen(page)
      const fits = await page.evaluate(() => ({
        scrollWidth: (document.scrollingElement ?? document.documentElement)
          .scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(fits.scrollWidth).toBeLessThanOrEqual(fits.innerWidth)
      await expect(page).toHaveScreenshot(
        `layout-${String(size.width)}-${colorScheme}.png`,
        SHOT,
      )
    }
  }
})

test('should_match_the_dots_tool (spec 0010 AC-19)', async ({ page }) => {
  for (const size of [
    { width: 375, height: 812 },
    { width: 430, height: 932 },
  ]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize(size)
      await page.emulateMedia({ colorScheme })
      await seedAndOpen(page)
      const canvas = page.getByTestId('canvas')
      await page.getByRole('button', { name: 'Dots' }).click()
      // One dot selected, so both dot looks and the enabled nudge pad show.
      const dot = await imageToClient(page, { x: 110, y: 70 })
      await page.mouse.click(dot.x, dot.y)
      await expect(canvas).toHaveAttribute('data-selected-count', '1')
      await nextFrame(page)
      const fits = await page.evaluate(() => ({
        scrollWidth: (document.scrollingElement ?? document.documentElement)
          .scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(fits.scrollWidth).toBeLessThanOrEqual(fits.innerWidth)
      await expect(page).toHaveScreenshot(
        `dots-${String(size.width)}-${colorScheme}.png`,
        SHOT,
      )
    }
  }
})

/** Every size and scheme: the page doesn't overflow and matches `name`. */
async function eachScreen(
  page: import('@playwright/test').Page,
  name: string,
  setUp: () => Promise<void>,
) {
  for (const size of [
    { width: 375, height: 812 },
    { width: 430, height: 932 },
  ]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize(size)
      await page.emulateMedia({ colorScheme })
      await seedAndOpen(page)
      await setUp()
      await nextFrame(page)
      const fits = await page.evaluate(() => ({
        scrollWidth: (document.scrollingElement ?? document.documentElement)
          .scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(fits.scrollWidth).toBeLessThanOrEqual(fits.innerWidth)
      await expect(page).toHaveScreenshot(
        `${name}-${String(size.width)}-${colorScheme}.png`,
        SHOT,
      )
    }
  }
}

test('should_match_the_lasso_tool (spec 0011 AC-25)', async ({ page }) => {
  await eachScreen(page, 'lasso', async () => {
    await page.getByRole('button', { name: 'Lasso', exact: true }).click()
    // An open lasso over the selection, paused with its end handle.
    const path = [
      { x: 30, y: 30 },
      { x: 50, y: 20 },
      { x: 75, y: 25 },
      { x: 95, y: 45 },
      { x: 80, y: 62 },
    ]
    const pts = []
    for (const p of path) pts.push(await imageToClient(page, p))
    const first = pts[0]
    await page.mouse.move(first.x, first.y)
    await page.mouse.down()
    for (const c of pts.slice(1)) {
      await page.mouse.move(c.x, c.y, { steps: 6 })
    }
    await page.mouse.up()
    await expect(page.getByTestId('canvas')).toHaveAttribute(
      'data-lasso',
      'paused',
    )
  })
})

test('should_match_the_brush_tool (spec 0011 AC-25)', async ({ page }) => {
  await eachScreen(page, 'brush', async () => {
    await page.getByRole('button', { name: 'Brush' }).click()
    await expect(page.getByRole('slider', { name: 'Hardness' })).toBeVisible()
  })
})

test('should_match_the_finish_screen (spec 0012 AC-21)', async ({ page }) => {
  const file = page.getByTestId('finish-file')
  for (const outline of ['off', 'on'] as const) {
    await eachScreen(page, `finish-${outline}`, async () => {
      await page.getByRole('button', { name: 'Done' }).click()
      await expect(file).toHaveText(/^PNG · \d+ × \d+ px/, { timeout: 20_000 })
      if (outline === 'on') {
        const before = await file.textContent()
        await page.getByRole('switch', { name: 'Outline' }).check()
        // White, 3%: the file grows by the outline.
        await expect(file).not.toHaveText(before ?? '', { timeout: 20_000 })
        await expect(file).toHaveText(/^PNG · \d+ × \d+ px/)
      }
      await expect(page.getByAltText('Sticker preview')).toBeVisible()
    })
  }
})

test('should_match_the_library (spec 0013 AC-29)', async ({ page }) => {
  const shoot = async (name: string, setUp: () => Promise<void>) => {
    for (const size of [
      { width: 375, height: 812 },
      { width: 430, height: 932 },
    ]) {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.setViewportSize(size)
        await page.emulateMedia({ colorScheme })
        await page.goto('/')
        await setUp()
        await nextFrame(page)
        await expect(page).toHaveScreenshot(
          `library-${name}-${String(size.width)}-${colorScheme}.png`,
          SHOT,
        )
      }
    }
  }
  const tiles = page.getByRole('button', { name: 'Open sticker' })
  // Each test has its own browser context: nothing is saved until `nine`.
  await shoot('empty', async () => {
    await expect(page.getByText('No stickers yet')).toBeVisible()
  })
  const nine = async () => {
    if ((await tiles.count()) !== 9) {
      await importFile(page, await seedMany(9))
    }
    await expect(tiles).toHaveCount(9)
  }
  await shoot('grid', nine)
  await shoot('selecting', async () => {
    await nine()
    await page.getByRole('button', { name: 'Select' }).click()
    await tiles.nth(0).click()
    await tiles.nth(2).click()
    await expect(page.getByText('2 selected')).toBeVisible()
  })
  await shoot('menu', async () => {
    await nine()
    await page.getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('menu')).toBeVisible()
  })
})
