import { test as base } from '@playwright/test'

export { expect, type Page } from '@playwright/test'

/**
 * Playwright's `test` with a `prefetch` option (spec 0013 Decision 13). By
 * default the page says Save-Data is on, so the first-visit model download
 * (51 MB) stays out of every test that isn't about it.
 */
export const test = base.extend<{ prefetch: boolean }>({
  prefetch: [false, { option: true }],
  page: async ({ page, prefetch }, provide) => {
    if (!prefetch) {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'connection', {
          configurable: true,
          value: { saveData: true },
        })
      })
    }
    await provide(page)
  },
})
