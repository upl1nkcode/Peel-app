import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { readZip, utf8Decode } from '../src/core/zip'
import { cutoutAlpha, finger } from './helpers/dots'
import { pickGenerated, toLibrary } from './helpers/editor'
import { expectFile } from './helpers/finish'
import { around, trace } from './helpers/lasso'
import { expect, test, type Page } from './helpers/test'

/**
 * The whole path on the phones, nothing seeded (spec 0014 AC-11). It cuts out
 * with Lasso: the built app has no fake engine, and real models run on
 * desktop only.
 */

// The service worker would fetch the models past pickGenerated's block (PR #138).
test.use({ serviceWorkers: 'block' })

const tiles = (page: Page) => page.getByRole('button', { name: 'Open sticker' })
const canvas = (page: Page) => page.getByTestId('canvas')
const editorSave = (page: Page) =>
  page.getByTestId('editor').getByRole('button', { name: /^Save(d)?$/ })

test('should_walk_the_whole_journey (spec 0014 AC-11)', async ({
  page,
}, info) => {
  test.skip(!info.project.name.match(/iphone|pixel/), 'phones only (AC-11)')
  test.setTimeout(120_000)

  // 1. The Library, empty.
  await page.goto('/')
  await expect(page.getByText('No stickers yet')).toBeVisible()

  // 2. + → a photo → a Lasso ring around the middle → Done.
  await pickGenerated(page, 300, 200)
  await page.getByRole('button', { name: 'Lasso', exact: true }).click()
  await expect(canvas(page)).toHaveAttribute('data-tool', 'lasso')
  const f = await finger(page, info)
  await trace(page, f, around(60, 40, 240, 160))
  await expect(canvas(page)).toHaveAttribute('data-tool', 'dots')
  await expect.poll(() => cutoutAlpha(page, { x: 150, y: 100 })).toBe(255)
  expect(await cutoutAlpha(page, { x: 20, y: 20 })).toBe(0)
  await page.getByRole('button', { name: 'Done' }).click()

  // 3. Finish, WhatsApp-style → Save → "Saved".
  await page.getByRole('radio', { name: 'WhatsApp-style' }).check()
  await expectFile(page, /^WEBP · 512 × 512 px · \d+ KB$/)
  const finish = page.getByRole('region', { name: 'Finish sticker' })
  await finish.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(finish.getByRole('button', { name: 'Saved' })).toBeVisible()

  // 4. Back to the Library: one sticker.
  await page.getByRole('button', { name: 'Back' }).click()
  await toLibrary(page)
  await expect(tiles(page)).toHaveCount(1)

  // 5. Reopen it, one brush stroke, Save, Library.
  await tiles(page).first().click()
  await expect(editorSave(page)).toHaveText('Saved')
  await page.getByRole('button', { name: 'Brush' }).click()
  await expect(canvas(page)).toHaveAttribute('data-tool', 'brush')
  await trace(page, f, [
    { x: 20, y: 100 },
    { x: 60, y: 100 },
  ])
  await expect(editorSave(page)).toHaveText('Save')
  await editorSave(page).click()
  await expect(editorSave(page)).toHaveText('Saved')
  await toLibrary(page)
  await expect(tiles(page)).toHaveCount(1)

  // 6. Duplicate it, then export both.
  await page.getByRole('button', { name: 'Select' }).click()
  await tiles(page).first().click()
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(tiles(page)).toHaveCount(2)
  await page.getByRole('button', { name: 'Select' }).click()
  await tiles(page).nth(0).click()
  await tiles(page).nth(1).click()
  await expect(page.getByText('2 selected')).toBeVisible()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^peel-stickers-\d{4}-\d{2}-\d{2}\.zip$/,
  )
  const { files } = await readZip(
    new Uint8Array(readFileSync(await download.path())),
    (d) => Promise.resolve(new Uint8Array(inflateRawSync(d))),
  )
  const manifest = JSON.parse(
    utf8Decode(files.get('peel-backup.json') ?? new Uint8Array()),
  ) as { stickers: { id: string }[] }
  expect(manifest.stickers).toHaveLength(2)
  await page.getByRole('button', { name: 'Done' }).click()

  // 7. Delete one: one is left, also after a reload.
  await page.getByRole('button', { name: 'Select' }).click()
  await tiles(page).first().click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this sticker?' })
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(tiles(page)).toHaveCount(1)
  await page.reload()
  await expect(tiles(page)).toHaveCount(1)
})
