import { expect, type Page } from '@playwright/test'
import { seedAndOpen, type SeedOptions } from './editor'

/** Opens the seed sticker, taps "Done", and waits for the first file (spec 0012). */
export async function openFinish(page: Page, opts?: Partial<SeedOptions>) {
  await seedAndOpen(page, opts)
  await page.getByRole('button', { name: 'Done' }).click()
  const region = page.getByRole('region', { name: 'Finish sticker' })
  await expect(region).toBeVisible()
  await expectFile(page, /^PNG · \d+ × \d+ px · \d+ KB$/)
  return region
}

/** Waits until the file line shows a made file matching `line`. */
export async function expectFile(page: Page, line: RegExp) {
  await expect(page.getByTestId('finish-file')).toHaveText(line, {
    timeout: 20_000,
  })
}

/** Decodes an image file in the page: its size and the alpha at some pixels. */
export async function decodeInPage(
  page: Page,
  bytes: Buffer,
  type: string,
  at: { x: number; y: number }[],
) {
  return page.evaluate(
    async ({ b64, type, at }) => {
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([data], { type }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.drawImage(bitmap, 0, 0)
      const alpha = at.map((p) => ctx.getImageData(p.x, p.y, 1, 1).data[3])
      return { width: bitmap.width, height: bitmap.height, alpha }
    },
    { b64: bytes.toString('base64'), type, at },
  )
}
