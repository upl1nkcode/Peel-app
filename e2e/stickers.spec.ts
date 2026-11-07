import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { backupEntries, type StickerRecord } from '../src/core/backup'
import { encodePng, storedDeflate } from '../src/core/png'
import { serializeSelection } from '../src/core/selection/serialize'
import { readZip, utf8Decode, writeZip } from '../src/core/zip'

/**
 * Stickers survive reloads and round-trip through backups (spec 0008 AC-4,
 * AC-5, AC-8, AC-15 to AC-17), in every project. No models are needed: each
 * test seeds a sticker by importing a backup built here from src/core.
 */

const PHOTO = readFileSync(
  resolve('e2e/fixtures/orientation/orientation-1.jpg'),
)
const inflateRaw = (data: Uint8Array) =>
  Promise.resolve(new Uint8Array(inflateRawSync(data)))

async function seedRecord(): Promise<StickerRecord> {
  const imageSize = { width: 120, height: 80 }
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ].map((p) => ({ ...p, kind: 'corner' as const }))
  const png = (v: number) =>
    encodePng(
      { width: 4, height: 4, data: new Uint8Array(64).fill(v) },
      storedDeflate,
    )
  return {
    id: '0b9c6c39-4f1a-4c51-9d7c-2f2a8b8f0e11',
    createdAt: Date.UTC(2026, 10, 1),
    updatedAt: Date.UTC(2026, 10, 2),
    imageSize,
    photo: { bytes: new Uint8Array(PHOTO), type: 'image/jpeg' },
    selection: serializeSelection(
      {
        rings: [{ op: 'add', nodes: rect(10, 10, 110, 70) }],
        strokes: [],
        feather: 0,
      },
      imageSize,
    ),
    sticker: await png(200),
    thumbnail: await png(120),
  }
}

async function seedBackup(): Promise<Buffer> {
  const entries = backupEntries([await seedRecord()], new Date(2026, 10, 2))
  return Buffer.concat(writeZip(entries, new Date(2026, 10, 2)))
}

async function importFile(page: Page, buffer: Buffer) {
  // The panel enables Import once the sticker store is open.
  await expect(page.getByLabel('Import')).toBeEnabled()
  await page.getByLabel('Import').setInputFiles({
    name: 'peel-stickers-2026-11-02.zip',
    mimeType: 'application/zip',
    buffer,
  })
}

const thumbnails = (page: Page) =>
  page.getByRole('button', { name: 'Open sticker' })

test('should_keep_stickers_after_reload (AC-5, AC-8)', async ({ page }) => {
  await page.goto('/')
  await importFile(page, await seedBackup())
  await expect(
    page.getByText('Imported 1 sticker. 0 were already here.'),
  ).toBeVisible()
  await expect(thumbnails(page)).toHaveCount(1)
  await page.reload()
  await expect(thumbnails(page)).toHaveCount(1)
})

test('should_round_trip_a_backup (AC-4, AC-15, AC-16)', async ({ page }) => {
  await page.goto('/')
  const seed = await seedBackup()
  await importFile(page, seed)
  await expect(thumbnails(page)).toHaveCount(1)

  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export all' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^peel-stickers-\d{4}-\d{2}-\d{2}\.zip$/,
  )
  const exported = readFileSync(await download.path())

  const before = await readZip(new Uint8Array(seed), inflateRaw)
  const after = await readZip(new Uint8Array(exported), inflateRaw)
  expect(after.damaged).toEqual([])
  expect([...after.files.keys()].sort()).toEqual(
    [...before.files.keys()].sort(),
  )
  for (const [name, data] of before.files) {
    if (name === 'peel-backup.json') continue
    expect(after.files.get(name), name).toEqual(data)
  }
  const manifest = (bytes: Uint8Array | undefined) => {
    const m = JSON.parse(utf8Decode(bytes ?? new Uint8Array())) as Record<
      string,
      unknown
    >
    delete m.exportedAt
    return m
  }
  expect(manifest(after.files.get('peel-backup.json'))).toEqual(
    manifest(before.files.get('peel-backup.json')),
  )
  const photo = [...after.files].find(([n]) => n.endsWith('/photo.jpg'))
  expect(photo?.[1]).toEqual(new Uint8Array(PHOTO))
})

test('should_merge_on_import (AC-17)', async ({ page }) => {
  await page.goto('/')
  const seed = await seedBackup()
  await importFile(page, seed)
  await expect(
    page.getByText('Imported 1 sticker. 0 were already here.'),
  ).toBeVisible()
  await importFile(page, seed)
  await expect(
    page.getByText('Imported 0 stickers. 1 were already here.'),
  ).toBeVisible()
  await expect(thumbnails(page)).toHaveCount(1)
})
