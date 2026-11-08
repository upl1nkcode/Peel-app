import { expect, test } from '@playwright/test'
import {
  cutoutAlpha,
  cutoutAlphas,
  doubleTap,
  drag,
  expectAim,
  finger,
  hold,
  openDots,
  press,
  tap,
  zoomAt,
  type Pt,
} from './helpers/dots'
import {
  devicePixel,
  expectRgb,
  imageToDevice,
  nextFrame,
  photoPixel,
} from './helpers/editor'

// The PWA's service worker would fetch the models itself, past page.route,
// so seedAndOpen's block leaked on CI WebKit (PR #138). Block it here.
test.use({ serviceWorkers: 'block' })

/**
 * The Dots tool (spec 0010), in every project: touch on the Pixel 8, the
 * mouse elsewhere. The seed sticker is a 120×80 photo with a rectangle of
 * four corners, (10,10) (110,10) (110,70) (10,70); at fit the photo is
 * larger than 100%, so the mask is full size.
 */

const canvas = (page: import('@playwright/test').Page) =>
  page.getByTestId('canvas')

/** Box-selects the two right-hand corners, from empty space above-left of them. */
async function selectRightCorners(
  page: import('@playwright/test').Page,
  f: Awaited<ReturnType<typeof finger>>,
) {
  await drag(page, f, { x: 100, y: 1 }, { x: 118, y: 78 })
  await expect(canvas(page)).toHaveAttribute('data-selected-count', '2')
}

test('should_drag_the_right_dot_by_touch (AC-3, #66)', async ({
  page,
}, info) => {
  await openDots(page)
  await page.getByRole('button', { name: 'View' }).click()
  await page.getByRole('radio', { name: 'Checkerboard' }).click()
  await page.getByRole('button', { name: 'Dots' }).click()
  const f = await finger(page, info)
  expect(await cutoutAlpha(page, { x: 112, y: 72 })).toBe(0)

  // At fit.
  await press(page, f, { x: 110, y: 70 }, { x: 115, y: 75 })
  // Where it really is: the finger's rounding may leave it a little off.
  const dot = await expectAim(page, { x: 115, y: 75 })
  await f.up()
  await expect(canvas(page)).toHaveAttribute('data-dot-count', '4')
  await expect.poll(() => cutoutAlpha(page, { x: 112, y: 72 })).toBe(255)
  await nextFrame(page)
  expectRgb(
    await devicePixel(page, await imageToDevice(page, { x: 112.5, y: 72.5 })),
    await photoPixel(page, { x: 112, y: 72 }),
    2,
    'kept in the Checkerboard view',
  )

  // At 16×.
  await zoomAt(page, { x: 115, y: 75 }, 16)
  expect(await cutoutAlpha(page, { x: 115, y: 75 })).toBeLessThanOrEqual(2)
  await press(page, f, dot, { x: dot.x + 2, y: dot.y + 2 })
  await expectAim(page, { x: dot.x + 2, y: dot.y + 2 })
  await f.up()
  await expect(canvas(page)).toHaveAttribute('data-dot-count', '4')
  await expect.poll(() => cutoutAlpha(page, { x: 115, y: 75 })).toBe(255)
})

test('should_insert_and_delete_dots (AC-8, AC-9)', async ({ page }, info) => {
  await openDots(page)
  const f = await finger(page, info)
  const zoom = await canvas(page).getAttribute('data-zoom')
  // The bottom edge: on a short desktop canvas the status strip covers the top one.
  await tap(page, f, { x: 60, y: 70 })
  await expect(canvas(page)).toHaveAttribute('data-dot-count', '5')
  await expect(canvas(page)).toHaveAttribute('data-selected-count', '1')
  await doubleTap(page, f, { x: 60, y: 70 })
  await expect(canvas(page)).toHaveAttribute('data-dot-count', '4')
  await page.waitForTimeout(300)
  await expect(canvas(page)).toHaveAttribute('data-zoom', zoom ?? '')
})

test('should_toggle_a_corner_by_holding (AC-10)', async ({ page }, info) => {
  await openDots(page)
  const f = await finger(page, info)
  const near: Pt[] = []
  for (let y = 64; y <= 76; y++) {
    for (let x = 104; x <= 116; x++) near.push({ x, y })
  }
  const before = await cutoutAlphas(page, near)
  await hold(page, f, { x: 110, y: 70 })
  await expect
    .poll(async () => {
      const now = await cutoutAlphas(page, near)
      return now.filter((a, i) => a !== before[i]).length
    })
    .toBeGreaterThan(0)
  await hold(page, f, { x: 110, y: 70 })
  await expect.poll(() => cutoutAlphas(page, near)).toEqual(before)
  await expect(canvas(page)).toHaveAttribute('data-dot-count', '4')
})

test('should_box_select_and_move_together (AC-11, AC-12)', async ({
  page,
}, info) => {
  await openDots(page)
  const f = await finger(page, info)
  await selectRightCorners(page, f)
  const right = [
    { x: 112, y: 15 },
    { x: 112, y: 40 },
    { x: 112, y: 65 },
  ]
  expect(await cutoutAlphas(page, right)).toEqual([0, 0, 0])
  await drag(page, f, { x: 110, y: 70 }, { x: 114, y: 70 })
  await expect.poll(() => cutoutAlphas(page, right)).toEqual([255, 255, 255])
  await expect(canvas(page)).toHaveAttribute('data-selected-count', '2')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => cutoutAlphas(page, right)).toEqual([0, 0, 0])
})

test('should_nudge_by_one_pixel (AC-14)', async ({ page }, info) => {
  await openDots(page)
  const f = await finger(page, info)
  const nudge = page.getByRole('button', { name: 'Nudge right' })
  await expect(nudge).toBeDisabled()
  await selectRightCorners(page, f)
  await nudge.click()
  await nudge.click()
  await expect
    .poll(() =>
      cutoutAlphas(page, [
        { x: 111, y: 40 },
        { x: 112, y: 40 },
      ]),
    )
    .toEqual([255, 0])
})

test('should_change_dot_count_with_the_slider (AC-15, AC-16)', async ({
  page,
}) => {
  await openDots(page, { rings: [] })
  await page.getByRole('button', { name: 'Ellipse' }).click()
  await expect(canvas(page)).toHaveAttribute('data-dot-count', '8')
  const slider = page.getByRole('slider', { name: 'Dots' })
  const box = await slider.boundingBox()
  if (!box) throw new Error('no slider')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width / 2, y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + box.width / 2 + (box.width / 2) * (i / 10), y)
  }
  // While held, the preview has more dots.
  await expect
    .poll(async () => Number(await canvas(page).getAttribute('data-dot-count')))
    .toBeGreaterThan(8)
  await page.mouse.up()
  await expect(slider).toHaveValue('0')
  await expect
    .poll(async () => Number(await canvas(page).getAttribute('data-dot-count')))
    .toBeGreaterThan(8)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(canvas(page)).toHaveAttribute('data-dot-count', '8')
})

test('should_start_from_a_rectangle (AC-17)', async ({ page }) => {
  await openDots(page, { rings: [] })
  await expect(page.getByText('Start with a shape, or use Auto')).toBeVisible()
  await page.getByRole('button', { name: 'Rectangle' }).click()
  await expect(canvas(page)).toHaveAttribute('data-dot-count', '4')
  // 60% of the visible 120×80 photo, centred: (24,16)–(96,64).
  await expect
    .poll(() =>
      cutoutAlphas(page, [
        { x: 23, y: 40 },
        { x: 24, y: 40 },
        { x: 95, y: 40 },
        { x: 96, y: 40 },
        { x: 60, y: 15 },
        { x: 60, y: 16 },
        { x: 60, y: 63 },
        { x: 60, y: 64 },
      ]),
    )
    .toEqual([0, 255, 255, 0, 0, 255, 255, 0])
})

test('should_fit_the_dots_sheet (AC-18)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await openDots(page)
  const controls = page
    .getByTestId('sheet')
    .locator('button:visible, input:visible')
  expect(await controls.count()).toBe(8)
  for (let k = 0; k < 8; k++) {
    const c = controls.nth(k)
    const box = await c.boundingBox()
    const name =
      (await c.getAttribute('aria-label')) ?? (await c.textContent()) ?? ''
    expect(box?.width, `${name} width`).toBeGreaterThanOrEqual(44)
    expect(box?.height, `${name} height`).toBeGreaterThanOrEqual(44)
  }
  const height = (await canvas(page).boundingBox())?.height ?? 0
  expect(height).toBeGreaterThanOrEqual(300)
  const fits = await page.evaluate(() => ({
    scrollWidth: (document.scrollingElement ?? document.documentElement)
      .scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(fits.scrollWidth).toBeLessThanOrEqual(fits.innerWidth)
})
