import { expect, test } from '@playwright/test'

interface Manifest {
  name: string
  short_name: string
  display: string
  theme_color: string
  background_color: string
  start_url: string
  icons: { src: string; sizes: string; type: string; purpose?: string }[]
}

test('should_link_a_valid_web_app_manifest', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()

  const response = await request.get(new URL(href ?? '', page.url()).href)
  expect(response.ok()).toBe(true)
  const manifest = (await response.json()) as Manifest

  expect(manifest.name).toBe('Peel')
  expect(manifest.short_name).toBe('Peel')
  expect(manifest.display).toBe('standalone')
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
  expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i)
  expect(manifest.start_url).toBe('/')

  const sizes = manifest.icons.map((icon) => icon.sizes)
  expect(sizes).toContain('192x192')
  expect(sizes).toContain('512x512')
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  for (const icon of manifest.icons) {
    const iconResponse = await request.get(new URL(icon.src, page.url()).href)
    expect(iconResponse.ok(), icon.src).toBe(true)
  }
})

test('should_register_an_active_service_worker', async ({ page }) => {
  await page.goto('/')
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready
        return registration.active?.state
      }),
    )
    .toBe('activated')
})

test('should_be_installable_in_chrome', async ({ page, browserName }) => {
  test.skip(
    browserName !== 'chromium',
    'Installability check uses the Chrome DevTools Protocol',
  )
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  const client = await page.context().newCDPSession(page)
  const { installabilityErrors } = (await client.send(
    'Page.getInstallabilityErrors',
  )) as { installabilityErrors: { errorId: string }[] }
  expect(installabilityErrors).toEqual([])
})
