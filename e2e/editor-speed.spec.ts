import { expect, test, type Page } from '@playwright/test'
import { VIEW_LABELS, VIEW_MODES } from '../src/core/editor'
import {
  devicePixel,
  expectRgb,
  generatedJpeg,
  imageToDevice,
  nextFrame,
  photoPixel,
  seedAndOpen,
} from './helpers/editor'

// The PWA's service worker would fetch the models itself, past page.route,
// so seedAndOpen's block leaked on CI WebKit (PR #138). Block it here.
test.use({ serviceWorkers: 'block' })

/**
 * A 12 MP photo (spec 0009 AC-26, Review Focus 5), desktop Chromium only.
 * The sticker's selection is a rectangle well inside the photo, so the
 * cutout is drawn in every frame.
 */
const SIZE = { width: 4032, height: 3024 }
const RECT = { x0: 500, y0: 500, x1: 3532, y1: 2524 }

test.skip(
  ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
  'the frame budget is measured in desktop Chromium',
)
test.setTimeout(180_000)

async function openLarge(page: Page) {
  await page.goto('/')
  const photo = await generatedJpeg(page, SIZE.width, SIZE.height)
  await seedAndOpen(page, { photo, imageSize: SIZE, rect: RECT })
}

/** Wheel-zooms at the canvas centre until the display is at 100% or more. */
async function zoomTo100(page: Page) {
  const canvas = page.getByTestId('canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no canvas')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 40; i++) {
    const scale = Number(await canvas.getAttribute('data-display-scale'))
    if (scale >= 1) return
    await page.mouse.wheel(0, -100)
    await nextFrame(page)
  }
  throw new Error('did not reach 100%')
}

test('should_draw_a_frame_under_8_ms (AC-26)', async ({ page }) => {
  await openLarge(page)
  await zoomTo100(page)
  const canvas = page.getByTestId('canvas')
  await page.getByRole('button', { name: 'View' }).click()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no canvas')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  for (const mode of VIEW_MODES) {
    await page.getByRole('radio', { name: VIEW_LABELS[mode] }).click()
    await expect(canvas).toHaveAttribute('data-view', mode)
    await page.evaluate(() => {
      performance.clearMeasures('peel-frame')
    })
    // Pan 30 steps, one frame each.
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(start.x - i * 8, start.y - i * 4)
      await nextFrame(page)
    }
    await page.mouse.up()
    await nextFrame(page)
    const durations = await page.evaluate(() =>
      performance.getEntriesByName('peel-frame').map((e) => e.duration),
    )
    expect(durations.length, mode).toBeGreaterThanOrEqual(30)
    const last = durations.slice(-30).sort((a, b) => a - b)
    const median = ((last[14] ?? 0) + (last[15] ?? 0)) / 2
    console.log(`${mode}: median frame ${median.toFixed(2)} ms`)
    expect(median, `${mode} median frame (ms)`).toBeLessThan(8)
  }
})

test('should_draw_a_12_mp_photo_at_100_percent (Review Focus 5)', async ({
  page,
}) => {
  await openLarge(page)
  await zoomTo100(page)
  const canvas = page.getByTestId('canvas')
  await page.getByRole('button', { name: 'View' }).click()
  await page.getByRole('radio', { name: 'Checkerboard' }).click()
  await expect(canvas).toHaveAttribute('data-view', 'checkerboard')
  await expect(canvas).toHaveAttribute('data-mask-scale', '1.0000', {
    timeout: 60_000,
  })
  await nextFrame(page)

  // The photo's centre is inside the selection: the cutout shows the photo.
  const [cx, cy] = ((await canvas.getAttribute('data-center')) ?? '')
    .split(',')
    .map(Number)
  const px = { x: Math.floor(cx), y: Math.floor(cy) }
  expect(
    px.x > RECT.x0 && px.x < RECT.x1 && px.y > RECT.y0 && px.y < RECT.y1,
  ).toBe(true)
  const dev = await imageToDevice(page, { x: px.x + 0.5, y: px.y + 0.5 })
  expectRgb(
    await devicePixel(page, dev),
    await photoPixel(page, px),
    2,
    'cutout at the centre',
  )
})
