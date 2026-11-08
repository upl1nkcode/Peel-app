import { expect, test, type Page } from '@playwright/test'
import { cutoutAlpha, cutoutAlphas, drag, finger, zoomAt } from './helpers/dots'
import { canvasInfo, imageToClient } from './helpers/editor'
import { around, openLasso, trace } from './helpers/lasso'

// The PWA's service worker would fetch the models itself, past page.route,
// so seedAndOpen's block leaked on CI WebKit (PR #138). Block it here.
test.use({ serviceWorkers: 'block' })

/**
 * The Lasso tool (spec 0011), in every project: touch on the Pixel 8, the
 * mouse elsewhere. The seed photo is 120×80 with colour quadrants split at
 * x = 60 and y = 40; at fit it is larger than 100%, so the mask is full size.
 */

const canvas = (page: Page) => page.getByTestId('canvas')
const points = async (page: Page) =>
  Number(await canvas(page).getAttribute('data-lasso-points'))

/** Waits until the new ring's mask is shown: `inside` turns opaque. */
async function settled(page: Page, inside: { x: number; y: number }) {
  await expect.poll(() => cutoutAlpha(page, inside)).toBe(255)
}

async function dotsOpened(page: Page) {
  await expect(canvas(page)).toHaveAttribute('data-tool', 'dots')
  await expect
    .poll(async () => Number(await canvas(page).getAttribute('data-dot-count')))
    .toBeGreaterThan(3)
}

test('should_close_a_traced_lasso_into_dots (AC-1, AC-4, AC-16)', async ({
  page,
}, info) => {
  await openLasso(page, { rings: [] })
  const f = await finger(page, info)
  await trace(page, f, around(30, 20, 90, 60))
  await dotsOpened(page)
  await expect(canvas(page)).toHaveAttribute('data-selected-count', '0')
  await settled(page, { x: 60, y: 40 })
  expect(await cutoutAlpha(page, { x: 10, y: 10 })).toBe(0)
})

test('should_pause_zoom_and_continue (AC-5, AC-6, AC-9)', async ({
  page,
}, info) => {
  await openLasso(page, { rings: [] })
  const f = await finger(page, info)
  await trace(page, f, [
    { x: 30, y: 20 },
    { x: 90, y: 20 },
    { x: 90, y: 60 },
  ])
  await expect(canvas(page)).toHaveAttribute('data-lasso', 'paused')
  const before = await points(page)

  // Zoom about the end, then pan it towards the middle with the View tool;
  // the lasso waits.
  const end = { x: 90, y: 60 }
  await zoomAt(page, end, 1.5)
  await page.getByRole('button', { name: 'View' }).click()
  await drag(page, f, { x: 64, y: 42 }, { x: 60, y: 40 })
  await page.getByRole('button', { name: 'Lasso', exact: true }).click()
  await expect(canvas(page)).toHaveAttribute('data-lasso', 'paused')

  // Go on from the end handle at the new zoom, then Finish.
  await trace(page, f, [end, { x: 75, y: 60 }], { lift: false })
  await expect(canvas(page)).toHaveAttribute('data-lasso', 'drawing')
  expect(await points(page)).toBeGreaterThan(before)
  await f.up()
  await expect(canvas(page)).toHaveAttribute('data-lasso', 'paused')
  await page.getByRole('button', { name: 'Finish' }).click()
  await dotsOpened(page)
  // Inside (30,20) (90,20) (90,60) (75,60), and outside its closing line.
  await settled(page, { x: 80, y: 40 })
  expect(await cutoutAlpha(page, { x: 40, y: 50 })).toBe(0)
})

/** A rectangle whose left side wobbles about x = 60 by up to half the reach. */
async function wobblyRect(page: Page): Promise<{ x: number; y: number }[]> {
  const { dpr, displayScale } = await canvasInfo(page)
  const reach = 12 / (displayScale / dpr)
  const left = Array.from({ length: 26 }, (_, i) => {
    const y = 15 + i * 2
    return { x: 60 + 0.5 * reach * Math.sin((y * 2 * Math.PI) / 16), y }
  })
  return [...left, { x: 105, y: 65 }, { x: 105, y: 15 }, { x: 60, y: 15 }]
}

/** Rows 25–55 where the cutout isn't 0 just left of x = 60 and 255 just right. */
async function wrongRows(page: Page): Promise<number[]> {
  const rows = Array.from({ length: 31 }, (_, i) => 25 + i)
  const alphas = await cutoutAlphas(page, [
    ...rows.map((y) => ({ x: 58, y })),
    ...rows.map((y) => ({ x: 61, y })),
  ])
  return rows.filter(
    (_, i) => alphas[i] !== 0 || alphas[i + rows.length] !== 255,
  )
}

test('should_snap_to_the_colour_edge (AC-12)', async ({ page }, info) => {
  await openLasso(page, { rings: [] })
  const f = await finger(page, info)
  await page.getByRole('switch', { name: 'Snap to edges' }).click()
  await trace(page, f, await wobblyRect(page), { stepPx: 2 })
  await dotsOpened(page)
  await settled(page, { x: 85, y: 40 })
  expect(await wrongRows(page)).toEqual([])

  // The same trace without snapping keeps the wobble.
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('button', { name: 'Lasso', exact: true }).click()
  await page.getByRole('switch', { name: 'Snap to edges' }).click()
  await expect(
    page.getByRole('switch', { name: 'Snap to edges' }),
  ).toHaveAttribute('aria-checked', 'false')
  await expect.poll(() => cutoutAlpha(page, { x: 85, y: 40 })).toBe(0)
  await trace(page, f, await wobblyRect(page), { stepPx: 2 })
  await dotsOpened(page)
  await settled(page, { x: 85, y: 40 })
  expect((await wrongRows(page)).length).toBeGreaterThan(0)
})

test('should_subtract_a_hole (AC-14)', async ({ page }, info) => {
  await openLasso(page)
  const f = await finger(page, info)
  await page.getByRole('radio', { name: 'Subtract' }).click()
  await trace(page, f, around(40, 30, 80, 50))
  await expect(canvas(page)).toHaveAttribute('data-tool', 'dots')
  await expect.poll(() => cutoutAlpha(page, { x: 60, y: 40 })).toBe(0)
  expect(await cutoutAlpha(page, { x: 20, y: 20 })).toBe(255)
})

test('should_trace_off_the_photo (Review Focus 3)', async ({ page }, info) => {
  await openLasso(page, { rings: [] })
  const f = await finger(page, info)
  // Past whichever edge the canvas has room beyond.
  const box = (await canvasInfo(page)).box
  const right = await imageToClient(page, { x: 128, y: 40 })
  const roomRight = right.x < box.x + box.width - 2
  const trail = roomRight ? around(80, 20, 128, 60) : around(30, 50, 90, 88)
  const inside = roomRight ? { x: 115, y: 40 } : { x: 60, y: 75 }
  await trace(page, f, trail)
  await dotsOpened(page)
  await settled(page, inside)
})
