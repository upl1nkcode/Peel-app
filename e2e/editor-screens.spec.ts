import { expect, test } from '@playwright/test'
import { VIEW_LABELS, VIEW_MODES } from '../src/core/editor'
import {
  generatedJpeg,
  imageToClient,
  nextFrame,
  seedAndOpen,
} from './helpers/editor'

// The PWA's service worker would fetch the models itself, past page.route,
// so seedAndOpen's block leaked on CI WebKit (PR #138). Block it here.
test.use({ serviceWorkers: 'block' })

/**
 * Screenshot baselines (spec 0009 AC-12, AC-25; spec 0010 AC-19). Fonts and rasterising
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
      await page.getByRole('radio', { name: VIEW_LABELS[mode] }).click()
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
