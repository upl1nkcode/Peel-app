// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { emptySelection } from '../selection/model'
import { serializeSelection } from '../selection/serialize'
import { testDeflate, testInflate } from '../testing/codecs'
import { utf8Decode, utf8Encode, type ZipEntry } from '../zip'
import {
  backupEntries,
  BACKUP_VERSION,
  isPng,
  NotABackupError,
  parseBackup,
  photoExtension,
  type StickerRecord,
} from './index'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const png = (...rest: number[]) => Uint8Array.from([...PNG_SIGNATURE, ...rest])
const when = new Date(Date.UTC(2026, 10, 7, 12, 0, 0))

async function record(
  id: string,
  options: { type?: string; alpha?: boolean } = {},
): Promise<StickerRecord> {
  const imageSize = { width: 4, height: 3 }
  const r: StickerRecord = {
    id,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    imageSize,
    photo: {
      bytes: Uint8Array.from([1, 2, 3, id.length]),
      type: options.type ?? 'image/jpeg',
    },
    selection: serializeSelection(emptySelection(), imageSize),
    sticker: png(1, 2),
    thumbnail: png(3),
  }
  if (options.alpha) {
    r.modelAlpha = {
      width: 4,
      height: 3,
      deflated: await testDeflate(
        Uint8Array.from({ length: 12 }, (_, i) => i * 20),
      ),
    }
  }
  return r
}

const asMap = (entries: ZipEntry[]) =>
  new Map(entries.map((e) => [e.name, e.data] as const))

const manifestOf = (files: Map<string, Uint8Array>) =>
  JSON.parse(utf8Decode(files.get('peel-backup.json') as Uint8Array)) as {
    format: string
    version: number
    exportedAt: string
    stickers: Record<string, unknown>[]
  }

const withManifest = (
  files: Map<string, Uint8Array>,
  change: (m: ReturnType<typeof manifestOf>) => unknown,
) => {
  const m = manifestOf(files)
  const out = new Map(files)
  out.set('peel-backup.json', utf8Encode(JSON.stringify(change(m) ?? m)))
  return out
}

describe('backup format', () => {
  it('should_write_the_backup_layout (AC-15)', async () => {
    const a = await record('a1', { alpha: true })
    const b = await record('b2')
    const entries = backupEntries([a, b], when)
    expect(entries.map((e) => e.name)).toEqual([
      'peel-backup.json',
      'stickers/a1/photo.jpg',
      'stickers/a1/selection.json',
      'stickers/a1/sticker.png',
      'stickers/a1/thumbnail.png',
      'stickers/a1/model-alpha.bin',
      'stickers/b2/photo.jpg',
      'stickers/b2/selection.json',
      'stickers/b2/sticker.png',
      'stickers/b2/thumbnail.png',
    ])
    const m = manifestOf(asMap(entries))
    expect(m.format).toBe('peel-backup')
    expect(m.version).toBe(1)
    expect(BACKUP_VERSION).toBe(1)
    expect(m.exportedAt).toBe('2026-11-07T12:00:00.000Z')
    expect(m.stickers[0]).toEqual({
      id: 'a1',
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      imageSize: { width: 4, height: 3 },
      photoType: 'image/jpeg',
      modelAlpha: { width: 4, height: 3 },
      files: {
        photo: 'photo.jpg',
        selection: 'selection.json',
        sticker: 'sticker.png',
        thumbnail: 'thumbnail.png',
        modelAlpha: 'model-alpha.bin',
      },
    })
    expect(m.stickers[1]).not.toHaveProperty('modelAlpha')
    expect(
      utf8Decode(
        asMap(entries).get('stickers/a1/selection.json') as Uint8Array,
      ),
    ).toBe(a.selection)
  })

  it('should_round_trip_stickers (AC-16)', async () => {
    const input = [
      await record('a1', { alpha: true }),
      await record('b2'),
      await record('c3', { type: 'image/png' }),
    ]
    const out = await parseBackup(
      asMap(backupEntries(input, when)),
      [],
      testInflate,
    )
    expect(out.damaged).toBe(0)
    expect(out.stickers).toEqual(input)
    expect(out.stickers[1]).not.toHaveProperty('modelAlpha')
  })

  it('should_read_a_backup_re_zipped_inside_a_folder (decision 7)', async () => {
    // Finder's "Compress" and Windows' "Compressed folder" put everything
    // under the folder's name, and Finder adds __MACOSX/ entries.
    const input = [await record('a1', { alpha: true }), await record('b2')]
    const prefix = 'peel-stickers-2026-11-07/'
    const entries = backupEntries(input, when)
    const files = new Map(entries.map((e) => [prefix + e.name, e.data]))
    files.set('__MACOSX/peel-stickers-2026-11-07/._peel-backup.json', png())
    const out = await parseBackup(
      files,
      [prefix + 'stickers/b2/sticker.png'],
      testInflate,
    )
    expect(out.stickers).toEqual([input[0]])
    expect(out.damaged).toBe(1)
  })

  it('should_not_guess_between_two_folders_with_a_manifest (decision 7)', async () => {
    const entries = backupEntries([await record('a1')], when)
    const files = new Map<string, Uint8Array>()
    for (const e of entries) {
      files.set('one/' + e.name, e.data)
      files.set('two/' + e.name, e.data)
    }
    await expect(parseBackup(files, [], testInflate)).rejects.toThrow(
      NotABackupError,
    )
  })

  it('should_count_damaged_stickers (AC-17)', async () => {
    const ids = [
      'ok',
      'missing',
      'badjson',
      'notpng',
      'alpha',
      'zipdamage',
      'size',
    ]
    const input = await Promise.all(
      ids.map((id) => record(id, { alpha: id === 'alpha' })),
    )
    const files = asMap(backupEntries(input, when))
    files.delete('stickers/missing/sticker.png')
    files.set('stickers/badjson/selection.json', utf8Encode('{"version":1,'))
    files.set('stickers/notpng/sticker.png', Uint8Array.from([1, 2, 3]))
    files.set(
      'stickers/alpha/model-alpha.bin',
      await testDeflate(new Uint8Array(11)),
    )
    files.delete('stickers/zipdamage/photo.jpg')
    files.set(
      'stickers/size/selection.json',
      utf8Encode(serializeSelection(emptySelection(), { width: 5, height: 3 })),
    )

    const out = await parseBackup(
      files,
      ['stickers/zipdamage/photo.jpg'],
      testInflate,
    )
    expect(out.stickers.map((s) => s.id)).toEqual(['ok'])
    expect(out.damaged).toBe(6)
  })

  it('should_count_malformed_entries_and_duplicates (AC-17)', async () => {
    const files = asMap(
      backupEntries([await record('a1'), await record('b2')], when),
    )
    const broken = withManifest(files, (m) => {
      m.stickers.push({ id: 'x/y' }, { ...m.stickers[0] })
      return m
    })
    const out = await parseBackup(broken, [], testInflate)
    expect(out.stickers.map((s) => s.id)).toEqual(['a1', 'b2'])
    expect(out.damaged).toBe(2)
  })

  it('should_reject_files_that_are_not_backups (AC-18)', async () => {
    const files = asMap(backupEntries([await record('a1')], when))
    const noManifest = new Map(files)
    noManifest.delete('peel-backup.json')
    const garbled = new Map(files).set('peel-backup.json', utf8Encode('{nope'))
    const cases = [
      noManifest,
      garbled,
      withManifest(files, (m) => ({ ...m, format: 'other' })),
      withManifest(files, (m) => ({ ...m, version: 2 })),
      withManifest(files, (m) => ({ ...m, stickers: 'none' })),
      withManifest(files, () => [1, 2]),
    ]
    for (const f of cases) {
      await expect(parseBackup(f, [], testInflate)).rejects.toThrow(
        NotABackupError,
      )
    }
    await expect(
      parseBackup(files, ['peel-backup.json'], testInflate),
    ).rejects.toThrow(NotABackupError)
  })

  it('should_keep_an_empty_photo_type (Review Focus 4)', async () => {
    const r = await record('a1', { type: '' })
    const entries = backupEntries([r], when)
    expect(entries.map((e) => e.name)).toContain('stickers/a1/photo.bin')
    const out = await parseBackup(asMap(entries), [], testInflate)
    expect(out.stickers[0]?.photo.type).toBe('')
    expect(photoExtension('image/jpeg')).toBe('jpg')
    expect(photoExtension('image/png')).toBe('png')
    expect(photoExtension('image/webp')).toBe('webp')
    expect(photoExtension('image/heic')).toBe('heic')
    expect(photoExtension('image/gif')).toBe('bin')
    expect(photoExtension('')).toBe('bin')
  })

  it('should_recognise_png_signatures', () => {
    expect(isPng(png())).toBe(true)
    expect(isPng(png().subarray(0, 7))).toBe(false)
    expect(isPng(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe(
      false,
    )
  })
})
