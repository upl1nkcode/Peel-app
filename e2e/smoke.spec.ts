import { expect, test } from '@playwright/test'

test('should_show_the_app_title_on_every_device', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Peel' })).toBeVisible()
})
