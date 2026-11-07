import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { readZip, utf8Decode } from '../src/core/zip'
import { importFile, SEED_PHOTO as PHOTO, seedBackup } from './helpers/editor'

const inflateRaw = (data: Uint8Array) =>
  Promise.resolve(new Uint8Array(inflateRawSync(data)))

/**
 * Stickers survive reloads and round-trip through backups (spec 0008 AC-4,
 * AC-5, AC-8, AC-15 to AC-17), in every project. No models are needed: each
 * test seeds a sticker by importing a backup built here from src/core.
 */

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
