import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

interface ModelFile {
  path: string
  bytes: number
  sha256: string
  parts?: { path: string; bytes: number }[]
}
interface ModelManifest {
  files: Record<'engineLoader' | 'engineWasm' | 'fast' | 'precise', ModelFile>
}

const PAGES_LIMIT = 25 * 1024 * 1024

test('should_serve_every_model_file_under_the_pages_limit (AC-17)', async ({
  request,
}) => {
  const res = await request.get('/models/manifest.json')
  expect(res.ok()).toBe(true)
  const manifest = (await res.json()) as ModelManifest
  expect(Object.keys(manifest.files).sort()).toEqual([
    'engineLoader',
    'engineWasm',
    'fast',
    'precise',
  ])
  expect(manifest.files.precise.parts?.length).toBe(2)
  for (const file of Object.values(manifest.files)) {
    const parts = file.parts ?? [{ path: file.path, bytes: file.bytes }]
    const chunks: Buffer[] = []
    for (const part of parts) {
      const got = await request.get(part.path)
      expect(got.ok(), part.path).toBe(true)
      const body = await got.body()
      expect(body.length, part.path).toBe(part.bytes)
      expect(body.length, part.path).toBeLessThanOrEqual(PAGES_LIMIT)
      chunks.push(body)
    }
    const whole = Buffer.concat(chunks)
    expect(whole.length, file.path).toBe(file.bytes)
    expect(createHash('sha256').update(whole).digest('hex'), file.path).toBe(
      file.sha256,
    )
  }
})

test('should_not_fetch_engine_or_models_until_auto_is_used (AC-19)', async ({
  page,
  request,
}) => {
  const urls: string[] = []
  page.on('request', (r) => urls.push(r.url()))
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.waitForTimeout(2000)
  expect(urls.filter((u) => /\/(engine|models)\//.test(u))).toEqual([])
  const sw = await (await request.get('/sw.js')).text()
  expect(sw).not.toMatch(/engine\/|models\//)
})
