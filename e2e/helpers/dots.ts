import { expect, type Page, type TestInfo } from '@playwright/test'
import {
  canvasInfo,
  imageToClient,
  nextFrame,
  seedAndOpen,
  type SeedOptions,
} from './editor'

export interface Pt {
  x: number
  y: number
}

/** Opens the seed sticker in the Dots tool (spec 0010). */
export async function openDots(page: Page, opts?: Partial<SeedOptions>) {
  await seedAndOpen(page, opts)
  await page.getByRole('button', { name: 'Dots' }).click()
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-tool', 'dots')
}

export interface Finger {
  down(pt: Pt): Promise<void>
  move(pt: Pt): Promise<void>
  up(): Promise<void>
}

/** One finger on the page: CDP touch on the Pixel 8, the mouse elsewhere. */
export async function finger(page: Page, info: TestInfo): Promise<Finger> {
  if (info.project.name === 'pixel-8') {
    const cdp = await page.context().newCDPSession(page)
    const send = async (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      pt?: Pt,
    ) => {
      await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pt ? [{ x: pt.x, y: pt.y, id: 0 }] : [],
      })
    }
    return {
      down: (pt) => send('touchStart', pt),
      move: (pt) => send('touchMove', pt),
      up: () => send('touchEnd'),
    }
  }
  return {
    down: async (pt) => {
      await page.mouse.move(pt.x, pt.y)
      await page.mouse.down()
    },
    move: (pt) => page.mouse.move(pt.x, pt.y),
    up: () => page.mouse.up(),
  }
}

/** Presses at image point `from` and moves to `to` in `steps`, still held. */
export async function press(
  page: Page,
  f: Finger,
  from: Pt,
  to: Pt,
  steps = 8,
) {
  const a = await imageToClient(page, from)
  const b = await imageToClient(page, to)
  await f.down(a)
  for (let i = 1; i <= steps; i++) {
    await f.move({
      x: a.x + ((b.x - a.x) * i) / steps,
      y: a.y + ((b.y - a.y) * i) / steps,
    })
  }
}

/** A drag from image point `from` to `to`, then lifted. */
export async function drag(page: Page, f: Finger, from: Pt, to: Pt) {
  await press(page, f, from, to)
  await f.up()
}

/** A tap at an image point, then the 250 ms wait for a second tap. */
export async function tap(page: Page, f: Finger, at: Pt) {
  const c = await imageToClient(page, at)
  await f.down(c)
  await f.up()
  await page.waitForTimeout(300)
}

export async function doubleTap(page: Page, f: Finger, at: Pt) {
  const c = await imageToClient(page, at)
  await f.down(c)
  await f.up()
  await f.down(c)
  await f.up()
}

export async function hold(page: Page, f: Finger, at: Pt, ms = 600) {
  const c = await imageToClient(page, at)
  await f.down(c)
  await page.waitForTimeout(ms)
  await f.up()
}

/** Wheel-zooms about image point `at` until `data-zoom` reaches `zoom`. */
export async function zoomAt(page: Page, at: Pt, zoom: number) {
  const canvas = page.getByTestId('canvas')
  for (let i = 0; i < 80; i++) {
    if (Number(await canvas.getAttribute('data-zoom')) >= zoom - 1e-6) return
    const c = await imageToClient(page, at)
    // A synthetic wheel works in every project, mobile WebKit included.
    await canvas.evaluate((el, pt) => {
      el.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          clientX: pt.x,
          clientY: pt.y,
          bubbles: true,
          cancelable: true,
        }),
      )
    }, c)
    await nextFrame(page)
  }
  throw new Error(`did not reach zoom ${String(zoom)}`)
}

/**
 * The loupe's aim (the dragged dot) is `want`, within one CSS px of finger
 * rounding; returns where it is.
 */
export async function expectAim(page: Page, want: Pt): Promise<Pt> {
  const { dpr, displayScale } = await canvasInfo(page)
  const tol = 1 / (displayScale / dpr)
  const loupe = page.getByTestId('loupe')
  await expect(loupe).toBeVisible()
  const [x, y] = ((await loupe.getAttribute('data-aim')) ?? '')
    .split(',')
    .map(Number)
  expect(Math.abs(x - want.x), `aim x ${String(x)}`).toBeLessThan(tol)
  expect(Math.abs(y - want.y), `aim y ${String(y)}`).toBeLessThan(tol)
  return { x, y }
}

/** The cutout's alpha at each image pixel; the mask must be full size. */
export async function cutoutAlphas(page: Page, pxs: Pt[]): Promise<number[]> {
  await expect(page.getByTestId('canvas')).toHaveAttribute(
    'data-mask-scale',
    '1.0000',
  )
  return page.getByTestId('cutout').evaluate((el, pts) => {
    const ctx = (el as HTMLCanvasElement).getContext('2d')
    if (!ctx) throw new Error('no 2D context')
    return pts.map((p) => ctx.getImageData(p.x, p.y, 1, 1).data[3])
  }, pxs)
}

export async function cutoutAlpha(page: Page, px: Pt): Promise<number> {
  const [a] = await cutoutAlphas(page, [px])
  return a
}
