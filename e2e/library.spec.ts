import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './helpers/test'
import { importFile, seedBackup, seedMany, seedShapes } from './helpers/editor'

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

test('should_keep_tall_and_wide_stickers_inside_their_tiles (#151 AC-1, AC-2)', async ({
  page,
}) => {
  await page.goto('/')
  await importFile(
    page,
    await seedShapes([
      { width: 32, height: 128 },
      { width: 128, height: 32 },
      { width: 64, height: 64 },
    ]),
  )
  await expect(tiles(page)).toHaveCount(3)
  const sizes: { width: number; height: number }[] = []
  for (let k = 0; k < 3; k++) {
    const tile = tiles(page).nth(k)
    const img = tile.locator('img')
    await expect(img).toHaveJSProperty('complete', true)
    const t = await tile.boundingBox()
    const i = await img.boundingBox()
    if (!t || !i) throw new Error('no box')
    sizes.push({ width: t.width, height: t.height })
    const where = `tile ${String(k)}`
    // Inside the tile's 8 px padding (half a pixel for rounding).
    expect(i.x, where).toBeGreaterThanOrEqual(t.x + 7.5)
    expect(i.y, where).toBeGreaterThanOrEqual(t.y + 7.5)
    expect(i.x + i.width, where).toBeLessThanOrEqual(t.x + t.width - 7.5)
    expect(i.y + i.height, where).toBeLessThanOrEqual(t.y + t.height - 7.5)
    // Its shape is kept: the drawn picture's ratio matches the thumbnail's.
    const drawn = await img.evaluate((el: HTMLImageElement) => {
      const box = el.getBoundingClientRect()
      const scale = Math.min(
        box.width / el.naturalWidth,
        box.height / el.naturalHeight,
      )
      return {
        ratio: el.naturalWidth / el.naturalHeight,
        width: el.naturalWidth * scale,
        height: el.naturalHeight * scale,
      }
    })
    expect(drawn.width / drawn.height, where).toBeCloseTo(drawn.ratio, 1)
  }
  // Tiles stay square and alike (AC-2).
  for (const s of sizes) {
    expect(s.width).toBeCloseTo(s.height, 0)
    expect(s.width).toBeCloseTo(sizes[0]?.width ?? 0, 0)
  }
})
