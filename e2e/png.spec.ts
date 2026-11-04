import { expect, test, type Page } from '@playwright/test'
import { encodePng } from '../src/core/png/encode'
import type { RgbaImage } from '../src/core/mask/types'

/** 64×48 test image: an opaque block, an alpha gradient and fully transparent pixels. */
function testImage(): RgbaImage {
  const width = 64
  const height = 48
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4
      data[k] = (x * 4) & 0xff
      data[k + 1] = (y * 5) & 0xff
      data[k + 2] = (x * y) & 0xff
      data[k + 3] =
        x < 16 ? 255 : x < 48 ? Math.round(((x - 16) / 31) * 255) : 0
    }
  }
  return { width, height, data }
}

/** Deflate with the page's own CompressionStream, as the app does. */
const pageDeflate =
  (page: Page) =>
  async (bytes: Uint8Array): Promise<Uint8Array> =>
    new Uint8Array(
      await page.evaluate(async (input) => {
        const cs = new CompressionStream('deflate')
        const writer = cs.writable.getWriter()
        const done = writer
          .write(new Uint8Array(input))
          .then(() => writer.close())
        const out = new Uint8Array(
          await new Response(cs.readable).arrayBuffer(),
        )
        await done
        return Array.from(out)
      }, Array.from(bytes)),
    )

test('should_decode_with_transparency_in_the_browser (AC-25)', async ({
  page,
}) => {
  await page.goto('/')
  const img = testImage()
  const png = await encodePng(img, pageDeflate(page))
  const decoded = await page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
    const bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(bitmap, 0, 0)
    const { data, width, height } = ctx.getImageData(
      0,
      0,
      bitmap.width,
      bitmap.height,
    )
    return { width, height, data: Array.from(data) }
  }, Array.from(png))

  expect(decoded.width).toBe(img.width)
  expect(decoded.height).toBe(img.height)
  for (let k = 0; k < img.width * img.height; k++) {
    const alpha = img.data[k * 4 + 3]
    // Alpha survives exactly everywhere.
    expect(decoded.data[k * 4 + 3]).toBe(alpha)
    if (alpha === 255) {
      // Opaque pixels keep their exact colour.
      expect(decoded.data.slice(k * 4, k * 4 + 3)).toEqual(
        Array.from(img.data.subarray(k * 4, k * 4 + 3)),
      )
    }
  }
})
