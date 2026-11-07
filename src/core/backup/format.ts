import { parseSelection } from '../selection/serialize'
import { utf8Decode, utf8Encode, type Inflate, type ZipEntry } from '../zip'
import type { StickerRecord } from './types'

export const BACKUP_FORMAT = 'peel-backup'
export const BACKUP_VERSION = 1
export const MANIFEST_NAME = 'peel-backup.json'

/** The file is not a Peel backup (spec 0008 AC-18). */
export class NotABackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotABackupError'
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Whether `bytes` start with the 8-byte PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((b, i) => bytes[i] === b)
  )
}

const EXTENSIONS: Record<string, 'jpg' | 'png' | 'webp' | 'heic'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

/** The backup file extension for a photo's MIME type (spec 0008 AC-15). */
export function photoExtension(
  type: string,
): 'jpg' | 'png' | 'webp' | 'heic' | 'bin' {
  return EXTENSIONS[type] ?? 'bin'
}

interface FileNames {
  photo: string
  selection: string
  sticker: string
  thumbnail: string
  modelAlpha?: string
}

const folder = (id: string) => `stickers/${id}/`

/** One sticker's line in `peel-backup.json`. */
export interface ManifestSticker {
  id: string
  createdAt: number
  updatedAt: number
  imageSize: { width: number; height: number }
  photoType: string
  modelAlpha?: { width: number; height: number }
  files: FileNames
}

/**
 * One sticker's files under `stickers/<id>/` and its manifest line (spec
 * 0008 AC-15). Bytes are not copied.
 */
export function stickerEntries(s: StickerRecord): {
  entries: ZipEntry[]
  listing: ManifestSticker
} {
  const names: FileNames = {
    photo: `photo.${photoExtension(s.photo.type)}`,
    selection: 'selection.json',
    sticker: 'sticker.png',
    thumbnail: 'thumbnail.png',
    ...(s.modelAlpha && { modelAlpha: 'model-alpha.bin' }),
  }
  const dir = folder(s.id)
  const entries: ZipEntry[] = [
    { name: dir + names.photo, data: s.photo.bytes },
    { name: dir + names.selection, data: utf8Encode(s.selection) },
    { name: dir + names.sticker, data: s.sticker },
    { name: dir + names.thumbnail, data: s.thumbnail },
  ]
  if (s.modelAlpha && names.modelAlpha) {
    entries.push({ name: dir + names.modelAlpha, data: s.modelAlpha.deflated })
  }
  return {
    entries,
    listing: {
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      imageSize: { width: s.imageSize.width, height: s.imageSize.height },
      photoType: s.photo.type,
      ...(s.modelAlpha && {
        modelAlpha: { width: s.modelAlpha.width, height: s.modelAlpha.height },
      }),
      files: names,
    },
  }
}

/** `peel-backup.json` listing `stickers` (spec 0008 AC-15). */
export function manifestEntry(
  stickers: readonly ManifestSticker[],
  exportedAt: Date,
): ZipEntry {
  const manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    stickers,
  }
  return { name: MANIFEST_NAME, data: utf8Encode(JSON.stringify(manifest)) }
}

/**
 * The entries of a backup ZIP (spec 0008 AC-15): `peel-backup.json`, then
 * each sticker's files under `stickers/<id>/`. Bytes are not copied.
 */
export function backupEntries(
  stickers: readonly StickerRecord[],
  exportedAt: Date,
): ZipEntry[] {
  const parts = stickers.map(stickerEntries)
  return [
    manifestEntry(
      parts.map((p) => p.listing),
      exportedAt,
    ),
    ...parts.flatMap((p) => p.entries),
  ]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0
const isTime = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)
const isFileName = (v: unknown): v is string =>
  typeof v === 'string' &&
  v !== '' &&
  !v.includes('/') &&
  v !== '.' &&
  v !== '..'
const isSize = (v: unknown): v is { width: number; height: number } =>
  isObj(v) && isCount(v.width) && isCount(v.height)

/**
 * Reads a backup's files (spec 0008 AC-16 to AC-18). Throws
 * `NotABackupError` when there is no readable `peel-backup.json` of format
 * `peel-backup`, version 1. A sticker with missing, damaged (named in
 * `damagedNames`) or invalid files is skipped and counted in `damaged`.
 * `inflate` (zlib) checks each model alpha's length.
 */
export async function parseBackup(
  zipFiles: ReadonlyMap<string, Uint8Array>,
  zipDamagedNames: readonly string[],
  inflate: Inflate,
): Promise<{ stickers: StickerRecord[]; damaged: number }> {
  const { files, damagedNames } = unwrapFolder(zipFiles, zipDamagedNames)
  const manifestBytes = damagedNames.includes(MANIFEST_NAME)
    ? undefined
    : files.get(MANIFEST_NAME)
  if (!manifestBytes) throw new NotABackupError(`no readable ${MANIFEST_NAME}`)
  let manifest: unknown
  try {
    manifest = JSON.parse(utf8Decode(manifestBytes))
  } catch {
    throw new NotABackupError(`${MANIFEST_NAME} is not JSON`)
  }
  if (
    !isObj(manifest) ||
    manifest.format !== BACKUP_FORMAT ||
    manifest.version !== BACKUP_VERSION ||
    !Array.isArray(manifest.stickers)
  ) {
    throw new NotABackupError('not a Peel backup, version 1')
  }

  const unreadable = new Set(damagedNames)
  const seen = new Set<string>()
  const stickers: StickerRecord[] = []
  let damaged = 0
  for (const meta of manifest.stickers as unknown[]) {
    const record = await readSticker(meta, files, unreadable, inflate)
    if (!record || seen.has(record.id)) {
      damaged++
      continue
    }
    seen.add(record.id)
    stickers.push(record)
  }
  return { stickers, damaged }
}

/**
 * A backup re-zipped on a computer (Finder's "Compress", Windows' "Compressed
 * folder") has every entry under one folder. With no manifest at the root and
 * exactly one `<folder>/peel-backup.json`, that folder becomes the root;
 * anything else is left as it is.
 */
function unwrapFolder(
  files: ReadonlyMap<string, Uint8Array>,
  damagedNames: readonly string[],
): { files: ReadonlyMap<string, Uint8Array>; damagedNames: readonly string[] } {
  const names = [...files.keys(), ...damagedNames]
  if (names.includes(MANIFEST_NAME)) return { files, damagedNames }
  const prefixes = names
    .filter((n) => !n.startsWith('__MACOSX/'))
    .filter((n) => /^[^/]+\/peel-backup\.json$/.test(n))
    .map((n) => n.slice(0, -MANIFEST_NAME.length))
  if (prefixes.length !== 1) return { files, damagedNames }
  const prefix = prefixes[0] as string
  const strip = (n: string) =>
    n.startsWith(prefix) ? [n.slice(prefix.length)] : []
  return {
    files: new Map(
      [...files].flatMap(([n, data]) =>
        strip(n).map((m) => [m, data] as const),
      ),
    ),
    damagedNames: damagedNames.flatMap(strip),
  }
}

async function readSticker(
  meta: unknown,
  files: ReadonlyMap<string, Uint8Array>,
  unreadable: ReadonlySet<string>,
  inflate: Inflate,
): Promise<StickerRecord | null> {
  if (
    !isObj(meta) ||
    !isFileName(meta.id) ||
    !isTime(meta.createdAt) ||
    !isTime(meta.updatedAt) ||
    !isSize(meta.imageSize) ||
    typeof meta.photoType !== 'string' ||
    !isObj(meta.files)
  ) {
    return null
  }
  const { id, imageSize } = meta
  const names = meta.files
  const hasAlpha =
    meta.modelAlpha !== undefined || names.modelAlpha !== undefined
  const dir = folder(id)
  const file = (name: unknown): Uint8Array | null => {
    if (!isFileName(name) || unreadable.has(dir + name)) return null
    return files.get(dir + name) ?? null
  }

  const photo = file(names.photo)
  const selectionBytes = file(names.selection)
  const sticker = file(names.sticker)
  const thumbnail = file(names.thumbnail)
  if (!photo || !selectionBytes || !sticker || !thumbnail) return null
  if (!isPng(sticker) || !isPng(thumbnail)) return null

  const selection = utf8Decode(selectionBytes)
  try {
    const parsed = parseSelection(selection)
    if (
      parsed.imageSize.width !== imageSize.width ||
      parsed.imageSize.height !== imageSize.height
    ) {
      return null
    }
  } catch {
    return null
  }

  const record: StickerRecord = {
    id,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    imageSize: { width: imageSize.width, height: imageSize.height },
    photo: { bytes: photo, type: meta.photoType },
    selection,
    sticker,
    thumbnail,
  }
  if (hasAlpha) {
    const size = meta.modelAlpha
    const deflated = file(names.modelAlpha)
    if (!isSize(size) || !deflated) return null
    if (size.width !== imageSize.width || size.height !== imageSize.height) {
      return null
    }
    try {
      const raw = await inflate(deflated)
      if (raw.length !== size.width * size.height) return null
    } catch {
      return null
    }
    record.modelAlpha = { width: size.width, height: size.height, deflated }
  }
  return record
}
