import { expect, test } from '@playwright/test'
import { viewPixel } from '../src/core/editor'
import {
  canvasInfo,
  devicePixel,
  expectRgb,
  imageToDevice,
  photoPixel,
  seedAndOpen,
} from './helpers/editor'

/**
 * The editor canvas (spec 0009), in every project. The seed sticker is a
 * 120×80 photo with a rectangle selection from (10, 10) to (110, 70); no
 * models are needed.
 */

test('should_draw_crisp_pixels_above_100_percent (AC-8)', async ({ page }) => {
  await seedAndOpen(page)
  const { displayScale } = await canvasInfo(page)
  expect(displayScale).toBeGreaterThan(1)

  // Two device pixels inside image pixel (60, 40) have the same colour.
  const a = await imageToDevice(page, { x: 60.25, y: 40.25 })
  const b = await imageToDevice(page, { x: 60.75, y: 40.75 })
  expect(Math.floor(b.x)).toBeGreaterThan(Math.floor(a.x))
  expect(await devicePixel(page, a)).toEqual(await devicePixel(page, b))

  // Across the selection's left edge (x = 10) the colour switches from
  // removed to kept within one device pixel.
  const edge = (await imageToDevice(page, { x: 10, y: 40.5 })).x
  const y = (await imageToDevice(page, { x: 10, y: 40.5 })).y
  const left = await devicePixel(page, { x: Math.floor(edge - 0.51), y })
  const right = await devicePixel(page, {
    x: Math.ceil(edge + 0.01 - 0.5),
    y,
  })
  expectRgb(
    left,
    viewPixel('overlay', await photoPixel(page, { x: 9, y: 40 }), 0, [0, 0, 0]),
    2,
    'removed',
  )
  expectRgb(
    right,
    viewPixel(
      'overlay',
      await photoPixel(page, { x: 10, y: 40 }),
      1,
      [0, 0, 0],
    ),
    2,
    'kept',
  )
})

test('should_show_the_full_resolution_mask_at_100_percent (AC-9)', async ({
  page,
}) => {
  await seedAndOpen(page)
  const canvas = page.getByTestId('canvas')
  await expect(canvas).toHaveAttribute('data-mask-scale', '1.0000')
  await expect(page.getByTestId('cutout')).toHaveJSProperty('width', 120)
  await expect(page.getByTestId('cutout')).toHaveJSProperty('height', 80)
})
