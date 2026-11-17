import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './helpers/test'
import { importFile, seedBackup, seedMany } from './helpers/editor'

/**
 * The Library (spec 0013): touch and hold to select, then Duplicate, Export
 * or Delete. Each test seeds a sticker by importing a backup built here.
 */

const tiles = (page: Page) => page.getByRole('button', { name: 'Open sticker' })

/** Touch and hold a tile for 600 ms (Playwright's touchscreen can only tap). */
async function hold(page: Page, index: number) {
  const box = await tiles(page).nth(index).boundingBox()
  if (!box) throw new Error('no tile')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(600)
  await page.mouse.up()
}

test('should_select_and_delete_with_a_long_press (AC-7, AC-11)', async ({
  page,
}) => {
  await page.goto('/')
  await importFile(page, await seedBackup())
  await expect(tiles(page)).toHaveCount(1)

  await hold(page, 0)
  await expect(page.getByText('1 selected')).toBeVisible()
  await expect(tiles(page).first()).toHaveAttribute('aria-pressed', 'true')
  // The finger lifting didn't open the editor.
  await expect(page.getByTestId('editor')).toBeHidden()

  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this sticker?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('No stickers yet')).toBeVisible()
  await page.reload()
  await expect(page.getByText('No stickers yet')).toBeVisible()
})

test('should_duplicate_and_export (AC-9, AC-10)', async ({ page }) => {
  await page.goto('/')
  const seed = await seedBackup()
  await importFile(page, seed)
  await expect(tiles(page)).toHaveCount(1)

  await page.getByRole('button', { name: 'Select' }).click()
  await tiles(page).first().click()
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(tiles(page)).toHaveCount(2)
  await expect(page.getByText(/selected/)).toBeHidden()

  // Export only the copy (the newest, first).
  await page.getByRole('button', { name: 'Select' }).click()
  await tiles(page).first().click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^peel-stickers-\d{4}-\d{2}-\d{2}\.zip$/,
  )
  const exported = readFileSync(await download.path())

  // It re-imports: the copy is already here, so nothing new is added.
  await page.getByRole('button', { name: 'Done' }).click()
  await importFile(page, exported)
  await expect(
    page.getByText('Imported 0 stickers. 1 were already here.'),
  ).toBeVisible()
  await expect(tiles(page)).toHaveCount(2)
})

test('should_fit_the_library (AC-28)', async ({ page }) => {
  /** No sideways scroll, and every visible button at least 44 × 44. */
  const expectFits = async (where: string) => {
    const fit = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
    })
    expect(fit.scrollWidth, where).toBeLessThanOrEqual(fit.clientWidth)
    const buttons = page.locator('button:visible')
    const n = await buttons.count()
    for (let k = 0; k < n; k++) {
      const box = await buttons.nth(k).boundingBox()
      const name =
        (await buttons.nth(k).getAttribute('aria-label')) ??
        (await buttons.nth(k).textContent())
      expect(box?.width, `${where}: ${String(name)}`).toBeGreaterThanOrEqual(44)
      expect(box?.height, `${where}: ${String(name)}`).toBeGreaterThanOrEqual(
        44,
      )
    }
  }
  for (const size of [
    { width: 375, height: 812 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(size)
    await page.goto('/')
    await importFile(page, await seedMany(9))
    await expect(tiles(page)).toHaveCount(9)
    await expectFits(`${String(size.width)}: Library`)
    await page.getByRole('button', { name: 'Select' }).click()
    await tiles(page).nth(0).click()
    await tiles(page).nth(1).click()
    await expectFits(`${String(size.width)}: selecting`)
    await page.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await expectFits(`${String(size.width)}: menu`)
  }
})
