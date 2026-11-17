import type { Message } from '../../ui/i18n'
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
 * Every saved sticker as one ZIP backup (spec 0008 AC-15), or only those in
 * `ids` (spec 0013 AC-10); `null` when there are none. Throws `ZipLimitError` past plain ZIP's limits (AC-19).
 *
 * One sticker is read at a time and its bytes go into a Blob before the
 * next is read; the file is a Blob of those Blobs (no copy). So memory holds
 * the backup about once, plus one sticker, not every sticker twice. The
 * manifest is written last, once every sticker's line is known.
 */
export async function exportAll(
  store: StickerStore,
  now: Date,
  ids?: readonly string[],
): Promise<{ name: string; blob: Blob } | null> {
  const wanted = ids && new Set(ids)
  // With `ids`, only those, in list order (spec 0013 AC-10).
  const summaries = (await store.list()).filter(
    (s) => !wanted || wanted.has(s.id),
  )
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

/** The import result line (spec 0008 AC-17), as messages for the UI to word and join with spaces (spec 0013). */
export function importMessage(result: ImportResult): Message[] {
  const lines: Message[] = [
    { key: 'import.result_plural', params: { count: result.added } },
    { key: 'import.existing', params: { count: result.existing } },
  ]
  if (result.damaged > 0) {
    lines.push({ key: 'import.damaged', params: { count: result.damaged } })
  }
  return lines
}

/**
 * Copies each sticker in `ids` as a new sticker: a new ID, created and updated
 * now, everything else the same (spec 0013 AC-9). The copies keep the order
 * of `ids` at the top of the list (the first is newest). Copies saved before
 * a `StorageFullError` stay; the error is rethrown. Returns how many it saved.
 */
export async function duplicateStickers(
  store: StickerStore,
  ids: readonly string[],
  now: number,
): Promise<number> {
  let saved = 0
  for (const [i, id] of ids.entries()) {
    const record = await store.get(id)
    if (!record) continue
    const at = now + (ids.length - 1 - i)
    await store.save({
      ...record,
      id: crypto.randomUUID(),
      createdAt: at,
      updatedAt: at,
    })
    saved++
  }
  return saved
}
