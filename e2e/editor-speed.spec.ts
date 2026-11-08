import { expect, test, type Page } from '@playwright/test'
import { VIEW_LABELS, VIEW_MODES } from '../src/core/editor'
import {
  devicePixel,
  expectRgb,
  generatedJpeg,
  imageToClient,
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

/** The median of the last 30 frame times while `act` runs, in ms. */
async function medianFrame(page: Page, act: () => Promise<void>) {
  await page.evaluate(() => {
    performance.clearMeasures('peel-frame')
  })
  await act()
  await nextFrame(page)
  const durations = await page.evaluate(() =>
    performance.getEntriesByName('peel-frame').map((e) => e.duration),
  )
  expect(durations.length).toBeGreaterThanOrEqual(30)
  const last = durations.slice(-30).sort((a, b) => a - b)
  return ((last[14] ?? 0) + (last[15] ?? 0)) / 2
}

test('should_draw_a_dots_frame_under_8_ms (spec 0010 AC-20)', async ({
  page,
}) => {
  await page.goto('/')
  const photo = await generatedJpeg(page, SIZE.width, SIZE.height)
  const mid = { x: SIZE.width / 2, y: SIZE.height / 2 }
  const nodes = Array.from({ length: 2000 }, (_, i) => {
    const a = (i / 2000) * 2 * Math.PI
    return {
      x: mid.x + 1400 * Math.cos(a),
      y: mid.y + 1000 * Math.sin(a),
      kind: 'smooth' as const,
    }
  })
  await seedAndOpen(page, {
    photo,
    imageSize: SIZE,
    rings: [{ op: 'add', nodes }],
  })
  const canvas = page.getByTestId('canvas')
  await page.getByRole('button', { name: 'Dots' }).click()
  await expect(canvas).toHaveAttribute('data-dot-count', '2000')

  // Zoomed in a little, so the view can pan and most dots stay on screen.
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no canvas')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  for (let i = 0; i < 40; i++) {
    if (Number(await canvas.getAttribute('data-zoom')) >= 2) break
    await page.mouse.wheel(0, -100)
    await nextFrame(page)
  }
  expect(Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThanOrEqual(
    2,
  )

  // Two fingers pan; in the Dots tool one finger is for the dots.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  })
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    dx: number,
    dy: number,
  ) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd'
          ? []
          : [
              { x: cx - 40 + dx, y: cy + dy, id: 0 },
              { x: cx + 40 + dx, y: cy + dy, id: 1 },
            ],
    })
  const before = await canvas.getAttribute('data-center')
  const panning = await medianFrame(page, async () => {
    await touch('touchStart', 0, 0)
    for (let i = 1; i <= 30; i++) {
      await touch('touchMove', -i * 6, -i * 2)
      await nextFrame(page)
    }
    await touch('touchEnd', 0, 0)
  })
  expect(await canvas.getAttribute('data-center')).not.toBe(before)
  console.log(`dots, panning: median frame ${panning.toFixed(2)} ms`)
  expect(panning, 'panning median frame (ms)').toBeLessThan(8)

  // Drag the rightmost dot.
  const dot = await imageToClient(page, nodes[0] ?? mid)
  const dragging = await medianFrame(page, async () => {
    await page.mouse.move(dot.x, dot.y)
    await page.mouse.down()
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(dot.x - i * 4, dot.y + i * 2)
      await nextFrame(page)
    }
    await expect(page.getByTestId('loupe')).toBeVisible()
    await page.mouse.up()
  })
  console.log(`dots, dragging: median frame ${dragging.toFixed(2)} ms`)
  expect(dragging, 'dragging median frame (ms)').toBeLessThan(8)
})

test('should_draw_lasso_and_brush_frames_under_8_ms (spec 0011 AC-26)', async ({
  page,
}) => {
  await page.goto('/')
  const photo = await generatedJpeg(page, SIZE.width, SIZE.height)
  const mid = { x: SIZE.width / 2, y: SIZE.height / 2 }
  const nodes = Array.from({ length: 2000 }, (_, i) => {
    const a = (i / 2000) * 2 * Math.PI
    return {
      x: mid.x + 1400 * Math.cos(a),
      y: mid.y + 1000 * Math.sin(a),
      kind: 'smooth' as const,
    }
  })
  await seedAndOpen(page, {
    photo,
    imageSize: SIZE,
    rings: [{ op: 'add', nodes }],
  })
  const canvas = page.getByTestId('canvas')
  await page.getByRole('button', { name: 'Lasso', exact: true }).click()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no canvas')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const maxR = Math.min(box.width, box.height) / 2 - 10

  // A spiral out from the centre, one CSS px a step: an open lasso of about
  // 5,000 points, which ends far from its start so it doesn't close.
  const spiral: { x: number; y: number }[] = []
  let a = 0
  let r = 20
  const turns = 5_000 / (Math.PI * (20 + maxR))
  const grow = (maxR - 20) / (turns * 2 * Math.PI)
  while (spiral.length < 5_030) {
    spiral.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    const da = 1 / Math.max(r, 1)
    a += da
    r = Math.min(maxR, r + grow * da)
  }
  const first = spiral[0] ?? { x: cx, y: cy }
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const p of spiral.slice(1, 5_000)) await page.mouse.move(p.x, p.y)
  expect(
    Number(await canvas.getAttribute('data-lasso-points')),
  ).toBeGreaterThan(4_000)
  const tracing = await medianFrame(page, async () => {
    for (const p of spiral.slice(5_000)) {
      await page.mouse.move(p.x, p.y)
      await nextFrame(page)
    }
  })
  await page.mouse.up()
  console.log(`lasso, tracing: median frame ${tracing.toFixed(2)} ms`)
  expect(tracing, 'tracing median frame (ms)').toBeLessThan(8)

  await page.getByRole('button', { name: 'Brush' }).click()
  const brushing = await medianFrame(page, async () => {
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(cx - i * 4, cy + i * 2)
      await nextFrame(page)
    }
    await expect(page.getByTestId('loupe')).toBeVisible()
    await page.mouse.up()
  })
  console.log(`brush: median frame ${brushing.toFixed(2)} ms`)
  expect(brushing, 'brushing median frame (ms)').toBeLessThan(8)
})
