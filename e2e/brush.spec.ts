import { expect, test, type Page } from '@playwright/test'
import { brushSliderAt } from '../src/core/editor'
import { cutoutAlpha, drag, finger } from './helpers/dots'
import { openBrush, openLasso, setSlider } from './helpers/lasso'

// The PWA's service worker would fetch the models itself, past page.route,
// so seedAndOpen's block leaked on CI WebKit (PR #138). Block it here.
test.use({ serviceWorkers: 'block' })

/**
 * The Brush tool and the sheets' layout (spec 0011), in every project. The
 * seed sticker is the 120×80 photo with the rectangle (10,10)–(110,70).
 */

test('should_erase_and_restore_with_the_brush (AC-18, AC-21)', async ({
  page,
}, info) => {
  await openBrush(page)
  const f = await finger(page, info)
  await setSlider(page, 'Size', brushSliderAt(10))
  await expect(page.getByText('Size 10 px')).toBeVisible()
  const centre = { x: 60, y: 40 }
  expect(await cutoutAlpha(page, centre)).toBe(255)

  await drag(page, f, { x: 45, y: 40 }, { x: 75, y: 40 })
  await expect.poll(() => cutoutAlpha(page, centre)).toBe(0)

  await page.getByRole('radio', { name: 'Restore' }).click()
  await drag(page, f, { x: 45, y: 40 }, { x: 75, y: 40 })
  await expect.poll(() => cutoutAlpha(page, centre)).toBe(255)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => cutoutAlpha(page, centre)).toBe(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => cutoutAlpha(page, centre)).toBe(255)
})

async function expectReachable(page: Page) {
  const controls = page.locator(
    '[data-testid=sheet] button, [data-testid=sheet] input, nav[aria-label=Tools] button',
  )
  const n = await controls.count()
  expect(n).toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    const c = controls.nth(i)
    const box = await c.boundingBox()
    const name =
      (await c.getAttribute('aria-label')) ?? (await c.textContent()) ?? ''
    expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44)
  }
  const canvasBox = await page.getByTestId('canvas').boundingBox()
  expect(canvasBox?.height ?? 0).toBeGreaterThanOrEqual(300)
}

test('should_fit_the_sheets (AC-23, AC-24)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await openLasso(page)
  await expectReachable(page)
  await page.getByRole('button', { name: 'Brush' }).click()
  await expect(page.getByRole('slider', { name: 'Hardness' })).toBeVisible()
  await expectReachable(page)
})
