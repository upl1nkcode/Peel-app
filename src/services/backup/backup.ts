import {
  manifestEntry,
  NotABackupError,
  parseBackup,
  stickerEntries,
  type ManifestSticker,
} from '../../core/backup'
import {
  checkZipLimits,
  createZipWriter,
  NotAZipError,
  readZip,
  type Inflate,
} from '../../core/zip'
import type { StickerStore } from '../storage'

export interface ImportResult {
  added: number
  existing: number
  damaged: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `peel-stickers-YYYY-MM-DD.zip` in local time (spec 0008 AC-15). */
export function backupFileName(now: Date): string {
  return `peel-stickers-${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`
}

/** Files per sticker without a model alpha, for the early AC-19 check. */
const MIN_FILES_PER_STICKER = 4

/**
 * Every saved sticker as one ZIP backup (spec 0008 AC-15), or `null` when
 * there are none. Throws `ZipLimitError` past plain ZIP's limits (AC-19).
 *
 * One sticker is read at a time and its bytes go into a Blob before the
 * next is read; the file is a Blob of those Blobs (no copy). So memory holds
 * the backup about once, plus one sticker, not every sticker twice. The
 * manifest is written last, once every sticker's line is known.
 */
export async function exportAll(
  store: StickerStore,
  now: Date,
): Promise<{ name: string; blob: Blob } | null> {
  const summaries = await store.list()
  if (summaries.length === 0) return null
  checkZipLimits(summaries.length * MIN_FILES_PER_STICKER + 1, 0)
  const writer = createZipWriter(now)
  const parts: Blob[] = []
  const listings: ManifestSticker[] = []
  for (const { id } of summaries) {
    const record = await store.get(id)
    if (!record) continue
    const { entries, listing } = stickerEntries(record)
    parts.push(new Blob(entries.flatMap((e) => writer.add(e)) as BlobPart[]))
    listings.push(listing)
  }
  parts.push(
    new Blob([
      ...writer.add(manifestEntry(listings, now)),
      ...writer.finish(),
    ] as BlobPart[]),
  )
  return {
    name: backupFileName(now),
    blob: new Blob(parts, { type: 'application/zip' }),
  }
}

/**
 * Adds a backup's stickers whose IDs are not on this device yet (spec 0008
 * AC-16, AC-17); existing ones are left untouched and nothing is deleted.
 * Stickers are saved one at a time, so those added before storage fills up
 * stay (AC-12). Throws `NotABackupError` for anything that is not a Peel
 * backup (AC-18) and `StorageFullError` when storage runs out.
 */
export async function importBackup(
  store: StickerStore,
  file: Blob,
  codecs: { inflateRaw: Inflate; inflate: Inflate },
): Promise<ImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let zip: Awaited<ReturnType<typeof readZip>>
  try {
    zip = await readZip(bytes, codecs.inflateRaw)
  } catch (e) {
    if (e instanceof NotAZipError) {
      throw new NotABackupError(`not a ZIP file: ${e.message}`)
    }
    throw e
  }
  const { stickers, damaged } = await parseBackup(
    zip.files,
    zip.damaged,
    codecs.inflate,
  )
  const result: ImportResult = { added: 0, existing: 0, damaged }
  for (const sticker of stickers) {
    if (await store.has(sticker.id)) {
      result.existing++
      continue
    }
    await store.save(sticker)
    result.added++
  }
  return result
}

/** The import result line (spec 0008 AC-17). */
export function importMessage(result: ImportResult): string {
  const noun = result.added === 1 ? 'sticker' : 'stickers'
  const base = `Imported ${String(result.added)} ${noun}. ${String(result.existing)} were already here.`
  return result.damaged > 0
    ? `${base} ${String(result.damaged)} couldn't be read.`
    : base
}
