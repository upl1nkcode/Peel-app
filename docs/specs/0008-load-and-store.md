# 0008 — Photos load the right way up, and stickers are never lost

- **Status:** Approved
- **Issues:** story #52; tasks #53 (EXIF orientation and the photo size cap), #54 (IndexedDB sticker repository), #55 (schema migrations and quota errors), #56 (persistent storage request), #57 (ZIP export and import)
- **Plan reference:** STICKER_WEBAPP_PLAN.md §1 (storage caveat), §4 (selection model), §8 (output and backup), Phase 7

## Why

A sticker is only worth making if it lasts. Today a cutout disappears when the app is closed. On an iPhone, Safari may also delete a site's data after about a week without use unless the app is on the Home Screen. People also move to new phones. And any photo from the phone must open the right way up: a sideways photo would put every dot in the wrong place.

## Decisions

1. **Each saved sticker keeps its original photo** (decided 2026-11-07 by the product owner), stored exactly as picked, so it can be re-opened and fine-tuned later with the same pixels. With the sticker PNG, that is about 4–5 MB per sticker.
2. **Import merges and skips duplicates** (decided 2026-11-07 by the product owner). Stickers whose ID is already on the phone are left as they are, and nothing on the phone is deleted by an import.
3. **A small temporary panel** on the tap-to-cut screen lets you save, re-open, delete, export and import, so this can be tried on phones (decided 2026-11-07 by the product owner). Phase 9's Library replaces it.
4. **Photos are capped at 4096 × 3072 pixels' worth (12,582,912 px), and at 16,384 px on the long side.** A literal 12,000,000 cap would shrink every standard 12 MP iPhone photo (4032 × 3024 = 12,192,768 px) by about 1%. This cap leaves 12 MP photos from phones untouched. It replaces spec 0007's limit of 4096 px on the long side. The long-side limit keeps extreme panoramas within every browser's canvas size.
5. **The model alpha is saved with the sticker.** An auto selection's smart edge needs it (spec 0007), so without it a re-opened auto cutout could not be rendered. It is stored as raw 8-bit values compressed with deflate, not as a PNG, because browsers may colour-manage PNGs they decode. Raw bytes come back exactly.
6. **The thumbnail is a PNG**, not WebP as plan §8 says: Safari cannot encode WebP from a canvas.
7. **Backups are plain ZIP files written by our own code** (no dependency). Entries are stored uncompressed, since PNGs and JPEGs are already compressed, and CRC-32 comes from the existing PNG code. Import also reads deflate-compressed entries, so a backup re-zipped on a computer still imports.
8. **Persistent storage is requested once, on the first save.** Browsers decide from engagement and installation, and asking before anything is saved would waste the one request.

## What

### Photo loading (#53)

- **AC-1** Given the eight orientation fixtures (JPEG photos with EXIF Orientation 1–8, all showing the same upright test pattern), when each is picked, then the loaded image is upright: its size is the upright size, and each of the pattern's four coloured quadrants is in the right place (mean colour within 12 of the reference per channel). This holds in all three test browsers.
- **AC-2** Given a photo of W × H pixels, then it loads at W × H when W·H ≤ 12,582,912 and max(W, H) ≤ 16,384. Otherwise it loads at max(1, ⌊W·s⌋) × max(1, ⌊H·s⌋), where s = min(√(12,582,912 / (W·H)), 16,384 / max(W, H)); if rounding still leaves it over, the longer side shrinks by one pixel at a time. A photo is never enlarged. Examples:
  - 8064 × 6048 → 4096 × 3072
  - 4032 × 3024 → unchanged
  - 6000 × 4000 → 4344 × 2896
  - 30000 × 3000 → 11217 × 1121
  - 100000 × 1 → 16384 × 1
- **AC-3** Given a file that is not a photo the browser can decode (a corrupt JPEG, a text file, or HEIC where unsupported), when it is picked, then "This photo can't be opened. Try a JPEG or PNG." is shown and the current photo and cutout stay as they were.
- **AC-4** Given a picked photo, then the loader returns the decoded image and the file's original bytes and MIME type, unchanged.

### Saving and re-opening (#54)

- **AC-5** Given a cutout with at least one ring, when the user taps Save, then one sticker is stored with:
  - an ID and created/updated times
  - the original photo's bytes and MIME type, and the loaded image size
  - the selection in spec 0003's JSON format
  - the model alpha, if the selection's soft edge uses it
  - the sticker PNG
  - a thumbnail

  The save is all or nothing.
- **AC-6** The sticker PNG is the full-resolution cutout: `renderMask` at scale 1 with the smart edge, then `applyMask` on the loaded image, then trimmed with `trimBounds` (padding 0) and written with `encodePng`. It is byte-identical to what those functions produce. Nothing from the screen-resolution preview is used.
- **AC-7** The thumbnail is the sticker image scaled to at most 256 px on its long side (never enlarged): s = min(1, 256 / max(w, h)), size max(1, round(w·s)) × max(1, round(h·s)), downscaled by area averaging (`resizeRgba`) and encoded as PNG.
- **AC-8** Given saved stickers, then `list()` returns them newest first by updated time, without reading photo, sticker or model-alpha bytes. `get(id)` returns everything. `delete(id)` removes every part. Unknown IDs: `get` returns `undefined` and `delete` does nothing.
- **AC-9** Given a saved sticker, when it is re-opened, then:
  - Its photo loads through AC-1/AC-2 at the saved image size.
  - The selection and model alpha equal the saved ones exactly, as one undoable step.
  - Rendering it again as in AC-6 gives the saved PNG byte for byte.
  - Save then updates that sticker: the updated time changes, the created time and ID don't, and no new sticker appears.

  If the photo no longer loads at the saved size (a different browser decoded it differently), the sticker opens anyway and "This photo opened at a different size here; the outline may be off." is shown.

### Upgrades and full storage (#55)

- **AC-10** The database has a schema version, starting at 1, and an ordered list of migrations. Given a database written at version 1 with a sticker, when it is opened by code at version 2 with a migration, then the sticker is still there and the migration's change is applied. Migrations run once each, in order.
- **AC-11** Given a database at a newer version than the app (an older copy of the app is open), then "Peel was updated in another tab. Reload to use your stickers." is shown and nothing is written.
- **AC-12** Given the storage is full (the browser reports `QuotaExceededError`), when the user saves or imports, then "Not enough space to save this sticker. Delete some stickers or free up space on your phone." is shown. Nothing from the failed save is stored, and earlier stickers are untouched. For an import, the stickers already added stay.

### Persistent storage (#56)

- **AC-13** Given `navigator.storage.persist` exists, when the first sticker is saved successfully, then `persist()` is called once. It is never called again on that device, even after a reload; the request is remembered in the database. It is never called before a save.
- **AC-14** The panel shows the storage status, read with `navigator.storage.persisted()` (which asks nothing):
  - Persisted: "Stickers are kept on this device."
  - Not persisted, or the API is missing: "Your browser may clear stickers if Peel isn't used for a while. Add Peel to your Home Screen, or export a backup."

### Backup (#57)

- **AC-15** Given saved stickers, when the user taps "Export all", then a file `peel-stickers-YYYY-MM-DD.zip` (local date) is downloaded. It contains:
  - `peel-backup.json`: `{ "format": "peel-backup", "version": 1, "exportedAt": ISO time, "stickers": [...] }`, with each sticker's ID, times, image size, photo MIME type and file names
  - for each sticker, under `stickers/<id>/`: `photo.<ext>` (jpg, png, webp, heic or bin, from the MIME type), `selection.json`, `sticker.png`, `thumbnail.png`, and `model-alpha.bin` when there is one

  Entries are stored (method 0) with correct CRC-32s. Standard tools (Python's `zipfile`, `unzip -t`) open the file without errors. "Export all" is disabled when there are no stickers.
- **AC-16** Given a backup exported from one device, when it is imported on a device with no stickers, then every sticker is stored with identical ID, times, image size and bytes (photo, selection, sticker, thumbnail, model alpha).
- **AC-17** Given a backup, when it is imported where some IDs already exist, then:
  - only new IDs are added; existing stickers are not changed
  - the result reads "Imported N stickers. M were already here." (singular "sticker" when N = 1)
  - a sticker whose files are missing or damaged (bad selection JSON, not a PNG, wrong size) is skipped and counted: "K couldn't be read."
- **AC-18** Given a file that is not a Peel backup (not a ZIP, no `peel-backup.json`, or an unknown format or version), when it is imported, then "This file isn't a Peel backup." is shown and nothing is stored. Entries compressed with deflate (method 8) are read. Encrypted entries, ZIP64 and other methods count as damaged.
- **AC-19** Given stickers whose backup would exceed the plain ZIP limits (4 GiB, or 65,535 entries), when the user exports, then "Too many stickers for one backup file. Delete some, then export again." is shown and no file is written.

### Temporary panel (decision 3)

- **AC-20** On the tap-to-cut screen, a panel shows:
  - Save: enabled when the cutout has at least one ring; shows "Saved" after a save. If the cutout renders to nothing (a ring too small to cover a pixel), it shows "Nothing to save: the cutout is empty." and stores nothing.
  - the saved stickers' thumbnails, newest first: tapping one re-opens it, and each has a Delete button that asks "Delete this sticker?" inline before deleting
  - Export all, and Import (a file picker for `.zip`)
  - the storage status line (AC-14)

## Contract

Coordinates are image pixels (float).

- `src/core/photo/size.ts`: `MAX_PHOTO_PIXELS = 12_582_912`, `MAX_PHOTO_SIDE_PX = 16_384`, `cappedSize(width, height): { width, height }` (AC-2).
- `src/core/zip/`: `writeZip(entries: { name: string; data: Uint8Array }[], modified: Date): Uint8Array[]` (the file as chunks, method 0) and `readZip(bytes: Uint8Array, inflateRaw: Inflate): Promise<{ files: Map<string, Uint8Array>; damaged: string[] }>`. Damaged entries are reported per name, not thrown. `ZipLimitError` is thrown by `writeZip` (AC-19); `NotAZipError` by `readZip`.
- `src/core/backup/`: `backupEntries(stickers, exportedAt)` and `parseBackup(files, damagedNames, inflate)`. The second returns `{ stickers, damaged: number }` or throws `NotABackupError`.
- `src/services/photo/loadPhoto.ts`: `loadPhoto(file: Blob): Promise<{ image: RgbaImage; bytes: Uint8Array; type: string }>`. It rejects with `PhotoUnreadableError` (AC-3). It replaces `src/ui/auto/loadPhoto.ts`.
- `src/services/storage/`: `openStickerStore(indexedDB: IDBFactory, migrations?)` returns `{ save, list, get, delete, has, getMeta, setMeta, onOutdated, close }`. Errors: `StorageFullError` (AC-12), `StorageOutdatedError` (AC-11). `requestPersistence(storage, store)` and `persistenceStatus(storage)` (AC-13, AC-14).
- `src/services/backup/`: `exportAll(store, now)` and `importBackup(store, file, codecs)`, which saves new stickers one at a time (AC-12, AC-17).
- The render worker's `renderFull { imageId, selection, modelAlpha? }` renders at scale 1 with the model alpha being saved (AC-6).
- `StickerRecord`:

  ```
  {
    id: string            // crypto.randomUUID()
    createdAt: number     // ms since epoch
    updatedAt: number
    imageSize: { width: number; height: number }
    photo: { bytes: Uint8Array; type: string }
    selection: string     // spec 0003 JSON
    modelAlpha?: { width: number; height: number; deflated: Uint8Array }
    sticker: Uint8Array   // PNG
    thumbnail: Uint8Array // PNG
  }
  ```

## Data

- **IndexedDB database `peel`, version 1:**
  - `stickers`: key `id`, with index `updatedAt`. It holds the ID, times, image size, photo MIME type, selection JSON and thumbnail.
  - `files`: key `[id, kind]`, where `kind` is `photo`, `sticker` or `modelAlpha`. Large bytes live here, so listing reads none of them.
  - `meta`: key `name`. It holds `persistRequested`.

  Bytes are stored as `ArrayBuffer`, not `Blob` (older Safari versions lost Blobs in IndexedDB).
- **Model alpha:** zlib-deflated 8-bit values, row-major, width × height bytes when inflated (`CompressionStream('deflate')`).
- **Backup format:** version 1, as in AC-15.

## Out of scope

- **The Library screen, Share, outputs other than the full-resolution PNG, and the Finish screen** (Phase 9). The temporary panel stands in for the Library.
- **Decoding HEIC where the browser can't.** iPhones hand Safari a JPEG when a photo is picked.
- **ZIP64, compressed export, and encrypted backups.**
- **Cloud sync and moving stickers between devices other than by the ZIP file.**
