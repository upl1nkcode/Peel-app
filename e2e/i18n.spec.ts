import { expect, test, type Page } from './helpers/test'
import { en } from '../src/ui/i18n/en'
import { ro } from '../src/ui/i18n/ro'
import { importFile, MODEL_URL, seedBackup } from './helpers/editor'

// The service worker would fetch the models past page.route (see editor-screens).
test.use({ serviceWorkers: 'block', locale: 'ro-RO' })

/**
 * English values that must not show in Romanian (spec 0013 AC-27): at least
 * four letters, different from their Romanian, without placeholders. Plural
 * forms are split; `**bold**` marks are dropped.
 */
const ENGLISH = Object.entries(en)
  .filter(([key, value]) => ro[key as keyof typeof ro] !== value)
  .flatMap(([, value]) => value.split('|'))
  .map((v) => v.replaceAll('**', ''))
  .filter((v) => !v.includes('{') && (v.match(/\p{L}/gu) ?? []).length >= 4)

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function expectNoEnglish(page: Page, where: string) {
  const text = await page.evaluate(() => document.body.innerText)
  const found = ENGLISH.filter((v) =>
    new RegExp(`(?<!\\p{L})${escape(v)}(?!\\p{L})`, 'u').test(text),
  )
  expect(found, where).toEqual([])
}

test('should_show_no_english_in_romanian (AC-27)', async ({ page }) => {
  await page.route(MODEL_URL, (route) => route.abort())
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ro')
  await importFile(page, await seedBackup())
  const tile = page.getByRole('button', { name: ro['library.open'] })
  await expect(tile).toHaveCount(1)
  await expectNoEnglish(page, 'Library')

  await page.getByRole('button', { name: ro['library.select'] }).click()
  await tile.click()
  await expectNoEnglish(page, 'selection mode')
  await page
    .getByRole('button', { name: ro['library.delete'], exact: true })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectNoEnglish(page, 'delete dialog')
  await page.getByRole('button', { name: ro['common.cancel'] }).click()
  await page.getByRole('button', { name: ro['library.done'] }).click()

  await page.getByRole('button', { name: ro['menu.more'] }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expectNoEnglish(page, 'menu')
  const install = page.getByRole('menuitem', { name: ro['menu.install'] })
  if ((await install.count()) > 0) {
    await install.click()
    const guide = page.getByRole('dialog')
    if ((await guide.count()) > 0) {
      await expectNoEnglish(page, 'install guide')
      await guide.getByRole('button', { name: ro['common.close'] }).click()
    }
  } else {
    await page.keyboard.press('Escape')
  }

  await tile.click()
  await expect(page.getByTestId('canvas')).toHaveAttribute(
    'data-image-size',
    '120x80',
  )
  for (const tool of [
    ro['tool.auto'],
    ro['tool.lasso'],
    ro['tool.dots'],
    ro['tool.brush'],
    ro['tool.view'],
  ]) {
    await page
      .getByTestId('editor')
      .getByRole('button', { name: tool, exact: true })
      .click()
    await expectNoEnglish(page, `editor: ${tool}`)
  }
  await page.getByRole('button', { name: ro['editor.done'] }).click()
  await expect(
    page.getByRole('region', { name: ro['finish.region'] }),
  ).toBeVisible()
  await expectNoEnglish(page, 'Finish')
})
