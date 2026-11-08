import { expect, type Page } from '@playwright/test'
import type { Finger, Pt } from './dots'
import { imageToClient, seedAndOpen, type SeedOptions } from './editor'

/** Opens the seed sticker in the Lasso tool (spec 0011). */
export async function openLasso(page: Page, opts?: Partial<SeedOptions>) {
  await seedAndOpen(page, opts)
  await page.getByRole('button', { name: 'Lasso', exact: true }).click()
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-tool', 'lasso')
}

/** Opens the seed sticker in the Brush tool (spec 0011). */
export async function openBrush(page: Page, opts?: Partial<SeedOptions>) {
  await seedAndOpen(page, opts)
  await page.getByRole('button', { name: 'Brush' }).click()
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-tool', 'brush')
}

/**
 * Traces through image points with one finger, a move every `stepPx` CSS px
 * (the view mustn't change meanwhile), then lifts unless `lift` is false.
 */
export async function trace(
  page: Page,
  f: Finger,
  pts: readonly Pt[],
  { lift = true, stepPx = 4 } = {},
) {
  const client: Pt[] = []
  for (const p of pts) client.push(await imageToClient(page, p))
  if (client.length === 0) return
  const first = client[0]
  await f.down(first)
  let prev = first
  for (const c of client.slice(1)) {
    const n = Math.max(
      1,
      Math.ceil(Math.hypot(c.x - prev.x, c.y - prev.y) / stepPx),
    )
    for (let i = 1; i <= n; i++) {
      await f.move({
        x: prev.x + ((c.x - prev.x) * i) / n,
        y: prev.y + ((c.y - prev.y) * i) / n,
      })
    }
    prev = c
  }
  if (lift) await f.up()
}

/** Sets a range input the way a finger would, so React sees the change. */
export async function setSlider(page: Page, name: string, value: number) {
  await page.getByRole('slider', { name }).evaluate((el, v) => {
    // The prototype's setter, so React's value tracker sees a change.
    Reflect.set(HTMLInputElement.prototype, 'value', String(v), el)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

/** The rectangle's corners as a closed trace, back to its start. */
export const around = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
  { x: x0, y: y0 },
]
