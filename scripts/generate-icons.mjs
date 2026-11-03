// Renders the placeholder app icons (public/*.png) from inline SVG using Playwright's Chromium.
// Run: node scripts/generate-icons.mjs   (polished artwork comes with issue #100)
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const VIOLET = '#6d28d9'

// A white sticker with a peeled corner. `inset` shrinks the artwork for the maskable safe zone.
const sticker = (inset) => `
  <g transform="translate(${inset} ${inset}) scale(${(512 - 2 * inset) / 512})">
    <path d="M136 120h240a24 24 0 0 1 24 24v168l-88 88H136a24 24 0 0 1-24-24V144a24 24 0 0 1 24-24z" fill="#fff"/>
    <path d="M312 400v-64a24 24 0 0 1 24-24h64z" fill="#ddd6fe"/>
  </g>`

const svg = (background, inset) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${background}${sticker(inset)}</svg>`

const rounded = `<rect width="512" height="512" rx="112" fill="${VIOLET}"/>`
const square = `<rect width="512" height="512" fill="${VIOLET}"/>`

const icons = [
  { file: 'pwa-192x192.png', size: 192, svg: svg(rounded, 0) },
  { file: 'pwa-512x512.png', size: 512, svg: svg(rounded, 0) },
  { file: 'maskable-512x512.png', size: 512, svg: svg(square, 56) },
  { file: 'apple-touch-icon-180x180.png', size: 180, svg: svg(square, 0) },
]

mkdirSync('public', { recursive: true })
writeFileSync('public/favicon.svg', svg(rounded, 0))

const browser = await chromium.launch()
const page = await browser.newPage()
for (const icon of icons) {
  await page.setViewportSize({ width: icon.size, height: icon.size })
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block;width:${icon.size}px;height:${icon.size}px}</style>${icon.svg}`,
  )
  await page.screenshot({
    path: `public/${icon.file}`,
    omitBackground: true,
    clip: { x: 0, y: 0, width: icon.size, height: icon.size },
  })
  console.log('wrote public/' + icon.file)
}
await browser.close()
