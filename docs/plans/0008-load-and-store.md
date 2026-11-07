# Photo loading, sticker storage and backup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any photo opens upright and within the size cap. A cutout can be saved on the phone with its original photo, selection and model alpha, then re-opened exactly, kept from clean-up, and backed up and restored as a ZIP.

**Architecture:**
- **Pure (`src/core/`):** the size cap (`photo/`), a ZIP writer and reader (`zip/`) and the backup format (`backup/`). Compression is injected, the way `encodePng` takes a `Deflate`.
- **Services:**
  - `services/photo/` decodes photos.
  - `services/storage/` keeps stickers in IndexedDB through `idb`, with versioned migrations and typed errors, and asks for persistent storage.
  - `services/sticker/` builds the saved PNG, thumbnail and model alpha from a full-resolution render.
  - `services/backup/` exports and imports ZIP files.
- **UI:** a temporary panel on the tap-to-cut screen ties these together.

**Tech Stack:** TypeScript 6.0 (strict), React 19, Vitest 5 + RTL, Playwright. New runtime dependency `idb@8.0.4` (ISC). New dev dependency `fake-indexeddb@6.2.7` (Apache-2.0). `CompressionStream` / `DecompressionStream` (`deflate`, `deflate-raw`).

**Spec:** `docs/specs/0008-load-and-store.md` (story #52; #53–#57)

## Global Constraints

- `src/core/` has no DOM, React or browser imports or globals. Coordinates are image px floats. Pure functions take compression as injected functions.
- Constants:
  - `MAX_PHOTO_PIXELS = 12_582_912`
  - `MAX_PHOTO_SIDE_PX = 16_384`
  - `THUMBNAIL_LONG_SIDE_PX = 256`
  - `SCHEMA_VERSION = 1` (database `peel`)
  - `BACKUP_VERSION = 1`
  - ZIP limits: 4 GiB (0xFFFFFFFF bytes) and 65,535 entries
- Copy is exact, from the spec:
  - "This photo can't be opened. Try a JPEG or PNG."
  - "This photo opened at a different size here; the outline may be off."
  - "Peel was updated in another tab. Reload to use your stickers."
  - "Not enough space to save this sticker. Delete some stickers or free up space on your phone."
  - "Stickers are kept on this device."
  - "Your browser may clear stickers if Peel isn't used for a while. Add Peel to your Home Screen, or export a backup."
  - "Imported N stickers. M were already here." ("sticker" when N = 1) plus " K couldn't be read." when K > 0
  - "This file isn't a Peel backup."
  - "Too many stickers for one backup file. Delete some, then export again."
  - Buttons "Save", "Saved", "Export all", "Import", "Delete", "Delete this sticker?"
- The saved sticker PNG is always the full-resolution render. The screen preview never reaches storage.
- Bytes go into IndexedDB as `ArrayBuffer`, never `Blob`.
- Test names `should_...` with the AC id. Storage tests run with `fake-indexeddb` in `// @vitest-environment node`. Coverage: `src/core/` ≥ 90%, overall ≥ 75%.
- Branch `feat/52-load-and-store`; one commit per task (Conventional Commits, `Refs #N`); the PR closes #52–#57. Add `idb` and `fake-indexeddb` in Task 4's commit and record both in `docs/licenses.md`.

## Spec corrections made with this plan

These update `docs/specs/0008-load-and-store.md` in this PR:

- **AC-20 gains:** "If the cutout renders to nothing (a ring too small to cover a pixel), Save shows 'Nothing to save: the cutout is empty.' and stores nothing." `trimBounds` throws `EmptyMaskError` on an all-zero mask, so the spec has to say what the user sees.
- **The render worker gains `{ type: 'renderFull'; jobId; imageId; selection }`**, a scale-1 render. The worker client cancels an older request of the same type, so a save that used `render` would be cancelled by the next preview render.
- **AC-2's rounding is pinned:** s = min(1, √(12,582,912 / (W·H)), 16,384 / max(W, H)). The result is max(1, ⌊W·s⌋) × max(1, ⌊H·s⌋).
- **The thumbnail size is pinned:** s = min(1, 256 / max(w, h)), size max(1, round(w·s)) × max(1, round(h·s)), downscaled with `resizeRgba` (area-averaged, the same on every browser).

## Review Focus

1. **Saving while a result is still arriving:** a precise result or a new tap that lands during a save must not change what that save stores. The save snapshots the selection and model alpha when Save is tapped (Task 9).
2. **Deleting the sticker that is open, then saving:** this creates a new sticker. It does not "update" a missing one or bring the deleted one back under its old ID (Tasks 4 and 9).
3. **Another tab upgrades the database:** a `versionchange` closes this tab's connection and shows AC-11's message, so the other tab's upgrade is not blocked forever (Task 4).
4. **Photos with an empty MIME type** (some Android pickers): they are stored as `""`, exported as `photo.bin`, and import back with `""` (Tasks 3 and 8).
5. **Importing a large backup** (about 225 MB for 50 stickers): the ZIP is read once into one buffer, entries are `subarray` views (no per-entry copies of stored files), and stickers are written one at a time (Tasks 2 and 8).

---

### Task 1: Photo size cap (#53)

**Files:**
- Create: `src/core/photo/size.ts`, `src/core/photo/index.ts`
- Test: `src/core/photo/size.test.ts`

**Interfaces:**
- Produces: `MAX_PHOTO_PIXELS = 12_582_912`, `MAX_PHOTO_SIDE_PX = 16_384`, `cappedSize(width: number, height: number): Size` (`Size` from `core/geometry/types`). Throws `RangeError` unless both are positive integers.

- [ ] **Step 1: Write the failing tests**
  - `should_keep_photos_within_the_cap (AC-2)`: `cappedSize` keeps 4032×3024, 4000×3000, 4096×3072 and 1×1 unchanged.
  - `should_scale_larger_photos_into_the_cap (AC-2)`:
    - 8064×6048 → 4096×3072
    - 6000×4000 → 4344×2896
    - 5000×3000 → 4579×2747
    - 30000×3000 → 11217×1121
    - 100000×1 → 16384×1
    - 20000×100 → 16384×81
    - 1×20000000 → 1×16384
    - 4097×3072 → 4096×3071

    For each, also check width·height ≤ 12,582,912 and max side ≤ 16,384.
  - `should_reject_bad_sizes`: 0, −1, 1.5 and NaN throw `RangeError`.
- [ ] **Step 2: Run** `npx vitest run src/core/photo`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** with s and the floors as in "Spec corrections". If float rounding leaves W·H > the cap, decrement the longer side until it fits.
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): photo size cap` (Refs #53)

---

### Task 2: ZIP writer and reader (#57)

**Files:**
- Create: `src/core/zip/write.ts`, `src/core/zip/read.ts`, `src/core/zip/index.ts`
- Create: `src/core/zip/fixtures.ts` (two small ZIPs as base64, made once with Python's `zipfile`, one STORED and one DEFLATED, each holding `a.txt` = "hello" and `dir/b.bin` = bytes 0..255)
- Test: `src/core/zip/zip.test.ts`

**Interfaces:**
- Consumes: `crc32` from `core/png/zlib`.
- Produces:
  - `ZipEntry = { name: string; data: Uint8Array }`
  - `writeZip(entries: readonly ZipEntry[], modified: Date): Uint8Array[]`: the file as chunks. Method 0, UTF-8 flag (bit 11), DOS time from `modified` (local fields).
  - `ZipLimitError`: thrown when the file would exceed 0xFFFFFFFF bytes or 65,535 entries.
  - `Inflate = (data: Uint8Array) => Promise<Uint8Array>`
  - `readZip(bytes: Uint8Array, inflateRaw: Inflate): Promise<{ files: Map<string, Uint8Array>; damaged: string[] }>`: reads the central directory. Method 0 entries are `subarray` views. Method 8 entries are inflated.
  - `NotAZipError`: thrown when there is no end-of-central-directory record.

- [ ] **Step 1: Write the failing tests**
  - `should_round_trip_entries (AC-15, AC-16)`: `readZip(concat(writeZip(entries, d)))` returns the same names and bytes, including an empty file and a 70 KB file.
  - `should_write_crcs_and_stored_method (AC-15)`: each local and central header has method 0 and the CRC-32 of its data.
  - `should_read_zips_made_elsewhere (AC-18)`: both fixtures give `a.txt` = "hello" and `dir/b.bin` = 0..255, using `inflateRaw` from `DecompressionStream('deflate-raw')` (available in Node).
  - `should_count_damaged_entries (AC-17, AC-18)`:
    - a CRC mismatch, an encrypted flag (bit 0), method 12 and a truncated entry are each listed in `damaged`
    - the other entries are still read
    - bytes with no end record throw `NotAZipError`
  - `should_refuse_zips_over_the_limits (AC-19)`: 65,536 empty entries throw `ZipLimitError`. The size check runs on declared sizes, without allocating 4 GiB: expose `checkZipLimits(count: number, totalBytes: number)` and test it with 2³²−1 against 2³².
  - `should_return_views_not_copies (Review Focus 5)`: a stored entry's `.buffer` is the input buffer.
- [ ] **Step 2: Run** `npx vitest run src/core/zip`. Expected: FAIL.
- [ ] **Step 3: Implement.** The writer emits local header + data per entry, then the central directory, then the end record. Version needed is 20. External attributes are 0.
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS. Then check the format once by hand (not part of the suite, because CI has no `py`): write a ZIP from a scratch script and run `py -I -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip())" file.zip`. Expected: `None`. Record the result in the ledger.
- [ ] **Step 5: Commit** `feat(core): zip writer and reader` (Refs #57)

---

### Task 3: Backup format (#57)

**Files:**
- Create: `src/core/backup/format.ts`, `src/core/backup/index.ts`, `src/core/backup/types.ts`
- Test: `src/core/backup/format.test.ts`

**Interfaces:**
- Consumes: `ZipEntry`, `Inflate` (Task 2); `checkSelection` and `parseSelection` (`core/selection/serialize`).
- Produces (in `types.ts`, shared with storage):

  ```
  interface StickerRecord {
    id: string
    createdAt: number
    updatedAt: number
    imageSize: Size
    photo: { bytes: Uint8Array; type: string }
    selection: string
    modelAlpha?: { width: number; height: number; deflated: Uint8Array }
    sticker: Uint8Array
    thumbnail: Uint8Array
  }
  ```

  - `BACKUP_VERSION = 1`
  - `photoExtension(type: string): 'jpg' | 'png' | 'webp' | 'heic' | 'bin'`
  - `backupEntries(stickers: readonly StickerRecord[], exportedAt: Date): ZipEntry[]`
  - `parseBackup(files: Map<string, Uint8Array>, damagedNames: readonly string[], inflate: Inflate): Promise<{ stickers: StickerRecord[]; damaged: number }>`. `inflate` is zlib, used to check the model alpha's length.
  - `NotABackupError`
  - `isPng(bytes: Uint8Array): boolean` (the 8-byte signature)

- [ ] **Step 1: Write the failing tests**
  - `should_write_the_backup_layout (AC-15)`:
    - the entry names are `peel-backup.json` and `stickers/<id>/{photo.jpg, selection.json, sticker.png, thumbnail.png, model-alpha.bin}`; `model-alpha.bin` only when present
    - the JSON has `format: 'peel-backup'`, `version: 1`, `exportedAt` (ISO), and per sticker `id, createdAt, updatedAt, imageSize, photoType, files`
  - `should_round_trip_stickers (AC-16)`: `parseBackup` of the entries (as a map) gives records deep-equal to the input, field by field.
  - `should_count_damaged_stickers (AC-17)`: each of these is counted once and its sticker skipped, while the rest import:
    - a sticker listed in the JSON whose `sticker.png` is missing
    - one whose `selection.json` fails `parseSelection`
    - one whose `sticker.png` lacks the PNG signature
    - one whose model alpha inflates to the wrong length
    - one whose files are in `damagedNames`
  - `should_reject_files_that_are_not_backups (AC-18)`: no `peel-backup.json`, unparsable JSON, `format` ≠ 'peel-backup', or `version` ≠ 1 → `NotABackupError`.
  - `should_keep_an_empty_photo_type (Review Focus 4)`: type `''` is written as `photo.bin` and parsed back as `''`. `photoExtension` maps `image/jpeg`→jpg, `image/png`→png, `image/webp`→webp, `image/heic`→heic, and anything else→bin.
- [ ] **Step 2: Run** `npx vitest run src/core/backup`. Expected: FAIL.
- [ ] **Step 3: Implement.** The selection is stored as its JSON text, unchanged.
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): sticker backup format` (Refs #57)

---

### Task 4: Sticker store, migrations and storage errors (#54, #55)

**Files:**
- Create: `src/services/storage/db.ts`, `src/services/storage/stickerStore.ts`, `src/services/storage/errors.ts`, `src/services/storage/index.ts`
- Test: `src/services/storage/stickerStore.test.ts`
- Modify: `package.json` (`idb@8.0.4` exact; dev `fake-indexeddb@6.2.7` exact), `docs/licenses.md`

**Interfaces:**
- Consumes: `StickerRecord` (Task 3).
- Produces:
  - `SCHEMA_VERSION = 1`
  - `Migration = (db: IDBPDatabase, tx: IDBPTransaction<unknown, string[], 'versionchange'>) => void`
  - `MIGRATIONS: readonly Migration[]`, where index 0 creates the version 1 stores (`stickers` keyPath `id` with index `updatedAt`, `files` keyPath `['id', 'kind']`, `meta` keyPath `name`)
  - `openStickerStore(idb: IDBFactory, migrations = MIGRATIONS): Promise<StickerStore>`
  - `StickerStore`:
    - `save(record: StickerRecord): Promise<void>` (put, one transaction over `stickers` + `files`)
    - `list(): Promise<StickerSummary[]>` (`{ id, createdAt, updatedAt, imageSize, thumbnail }`, newest first)
    - `get(id): Promise<StickerRecord | undefined>`
    - `delete(id): Promise<void>`
    - `has(id): Promise<boolean>`
    - `getMeta(name): Promise<unknown>`
    - `setMeta(name, value): Promise<void>`
    - `onOutdated(cb: () => void): void`
    - `close(): void`
  - Errors: `StorageFullError` (from `QuotaExceededError`, at put or commit), `StorageOutdatedError` (open with a newer stored version → `VersionError`).

- [ ] **Step 1: Write the failing tests** (each test gets a fresh `new IDBFactory()` from `fake-indexeddb`)
  - `should_save_list_get_and_delete (AC-5, AC-8)`:
    - `list()` is newest first by `updatedAt`
    - `get` returns bytes equal to the saved ones
    - `delete` then `get` gives `undefined`, and no `files` rows remain for that ID
    - `get('nope')` is `undefined`; `delete('nope')` resolves
  - `should_list_without_reading_large_files (AC-8)`: wrap the factory's `files` store reads (spy on `IDBObjectStore.prototype.get` / `getAll` for store name `files`); `list()` makes none.
  - `should_save_all_or_nothing (AC-5, AC-12)`:
    - a `files` put that throws `QuotaExceededError` (stub one put via a spy) rejects with `StorageFullError`
    - `get(id)` is `undefined`
    - earlier stickers are unchanged
  - `should_migrate_v1_to_v2 (AC-10)`:
    - open with `MIGRATIONS`, save a sticker, close
    - re-open with `[...MIGRATIONS, (db) => db.createObjectStore('extra')]` (version 2)
    - the sticker is still there, `objectStoreNames` contains `extra`, and a migration spy shows index 1 ran once
  - `should_refuse_a_newer_database (AC-11)`: open at version 2, close, then open with `MIGRATIONS` (version 1) → `StorageOutdatedError`.
  - `should_close_when_another_tab_upgrades (Review Focus 3)`: while store A is open, opening store B at version 2 completes, and A's `onOutdated` callback runs.
  - `should_keep_meta`: `setMeta('persistRequested', true)` then `getMeta` gives `true` after re-opening.
- [ ] **Step 2: Run** `npx vitest run src/services/storage`. Expected: FAIL.
- [ ] **Step 3: Implement** with `idb`'s `openDB(name, migrations.length, { upgrade(db, oldVersion, _new, tx) { for v in oldVersion..new-1: migrations[v](db, tx) }, blocking() { db.close(); outdated() } })`. Convert `Uint8Array` → `ArrayBuffer` (`slice` when it is a view of a larger buffer) on write, and back on read.
- [ ] **Step 4: Run** the Step 2 command, `npm run lint` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(services): IndexedDB sticker store with migrations` (Refs #54 #55). The commit body names the two dependencies with one-line reasons.

---

### Task 5: Persistent storage (#56)

**Files:**
- Create: `src/services/storage/persistence.ts`
- Test: `src/services/storage/persistence.test.ts`

**Interfaces:**
- Consumes: `StickerStore.getMeta` / `setMeta` (Task 4).
- Produces:
  - `StorageManagerLike = Partial<Pick<StorageManager, 'persist' | 'persisted'>>`
  - `requestPersistenceOnce(storage: StorageManagerLike | undefined, store: StickerStore): Promise<void>`
  - `persistenceStatus(storage: StorageManagerLike | undefined): Promise<'persisted' | 'atRisk'>`
  - `STORAGE_STATUS_TEXT: Record<'persisted' | 'atRisk', string>` (the spec's two lines)

- [ ] **Step 1: Write the failing tests**
  - `should_ask_once_ever (AC-13)`:
    - two calls, with a re-opened store between them, call `persist` once
    - `getMeta('persistRequested')` is `true`
    - with `storage` undefined, or with no `persist`, nothing throws and nothing is recorded
  - `should_show_the_storage_status (AC-14)`: `persisted()` true → 'persisted'; false, missing, or rejecting → 'atRisk'. The texts equal the spec's.
- [ ] **Step 2: Run** `npx vitest run src/services/storage/persistence`. Expected: FAIL.
- [ ] **Step 3: Implement.** Record `persistRequested` before awaiting `persist()`, so a slow prompt cannot cause a second request.
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(services): ask once for persistent storage` (Refs #56)

---

### Task 6: Building the saved sticker (#54)

**Files:**
- Create: `src/services/sticker/buildSticker.ts`, `src/services/sticker/index.ts`
- Modify: `src/workers/protocol.ts` (add `renderFull`), `src/workers/renderHandler.ts`, `src/services/workerClient.ts` (`renderFull(imageId, selection)`)
- Test: `src/services/sticker/buildSticker.test.ts`, `src/workers/renderHandler.test.ts`

**Interfaces:**
- Consumes: `renderMask`, `applyMask`, `trimBounds`, `cropRgba`, `resizeRgba`, `EmptyMaskError` (`core/mask`); `encodePng`, `Deflate` (`core/png`); `smartEdgeRefiner` (`core/matting`, through the worker); `Inflate` (Task 2).
- Produces:
  - `THUMBNAIL_LONG_SIDE_PX = 256`
  - `thumbnailSize(w, h): Size`
  - `buildSticker(input: { image: RgbaImage; selection: Selection; modelAlpha: AlphaMask | null }, deps: { renderFull(selection: Selection): Promise<AlphaMask>; deflate: Deflate }): Promise<{ sticker: Uint8Array; thumbnail: Uint8Array; modelAlpha?: { width; height; deflated } }>`. Throws `EmptyMaskError` when the render is all zero.
  - `inflateModelAlpha(saved, inflate: Inflate): Promise<AlphaMask>`
  - `ToRenderWorker` gains `{ type: 'renderFull'; jobId: number; imageId: string; selection: Selection }`, answered with `rendered`.

- [ ] **Step 1: Write the failing tests**
  - `should_render_the_full_resolution_sticker (AC-6)`:
    - on a 40×30 test image with a ring selection and a model soft edge, `buildSticker`'s `sticker` bytes equal `encodePng(cropRgba(applyMask(image, renderMask(sel, size, { refineEdge: smartEdgeRefiner(image, alpha) })), trimBounds(mask, 0)), storedDeflate)`
    - the test passes a `renderFull` that runs exactly that `renderMask`, and `deflate: storedDeflate`
  - `should_make_a_256px_thumbnail (AC-7)`:
    - `thumbnailSize` maps 1000×500 → 256×128, 100×80 → 100×80, 3000×1 → 256×1, 1×1 → 1×1
    - the thumbnail's IHDR width and height match `thumbnailSize` of the cropped sticker
  - `should_keep_the_model_alpha_exactly (AC-5, AC-9)`: `inflateModelAlpha` of the saved model alpha gives back the input alpha's bytes. With `modelAlpha` null, it is omitted.
  - `should_refuse_an_empty_cutout`: a ring smaller than a pixel's centre gives `EmptyMaskError`.
  - `should_render_full_size_on_its_own_message (AC-6)` (render handler): `renderFull` replies `rendered` with a mask of the image's full size. A later `render` does not cancel it, because the client's newest-wins is per message type.
- [ ] **Step 2: Run** `npx vitest run src/services/sticker src/workers`. Expected: FAIL.
- [ ] **Step 3: Implement.** `deflate` produces the model alpha's zlib stream (`browserDeflate` in the app). `inflateModelAlpha` checks that the inflated length equals width × height (`RangeError` otherwise).
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(services): build the full-resolution sticker` (Refs #54)

---

### Task 7: Photo loader with orientation and the cap (#53)

**Files:**
- Create: `src/services/photo/loadPhoto.ts`, `src/services/photo/index.ts`, `scripts/make-orientation-fixtures.py`, `e2e/fixtures/orientation/` (8 JPEGs + `README.md`)
- Delete: `src/ui/auto/loadPhoto.ts` (`AutoScreen` and `App` import the new one; the fake `loadPhoto` in `AutoScreen.test.tsx` returns a `LoadedPhoto`)
- Modify: `src/ui/auto/AutoScreen.tsx`. The stage gets `data-image-size="WxH"` with the loaded size, and the backdrop canvas gets `data-testid="photo"`.
- Test: `e2e/photo.spec.ts` (all projects)

**Interfaces:**
- Consumes: `cappedSize` (Task 1).
- Produces:
  - `LoadedPhoto = { image: RgbaImage; bytes: Uint8Array; type: string }`
  - `loadPhoto(file: Blob): Promise<LoadedPhoto>`
  - `PhotoUnreadableError`
  - `AutoScreenProps.loadPhoto` becomes `(file: Blob) => Promise<LoadedPhoto>`

- [ ] **Step 1: Build the fixtures** with `py scripts/make-orientation-fixtures.py` (Pillow; run by hand, outputs committed).
  - The upright pattern is 120×80. Quadrants: top-left red (230, 30, 30), top-right green (30, 200, 30), bottom-left blue (30, 30, 230), bottom-right yellow (230, 220, 30).
  - For each orientation 1–8, store the pixels transformed by the inverse of that orientation, and set the EXIF Orientation tag, so a correct reader shows the upright pattern.
  - Save as JPEG quality 95, named `orientation-N.jpg`.
- [ ] **Step 2: Write the failing e2e tests**
  - `should_load_every_orientation_upright (AC-1)`: for N = 1..8, pick the fixture. `data-image-size` is `120x80`, and the mean of each quadrant on `[data-testid=photo]`, sampled 10 px inside each quadrant corner, is within 12 of its colour per channel. The fixture shows at scale 1.
  - `should_cap_large_photos (AC-2)`: in the page, draw a 5000×3000 canvas, `toBlob('image/jpeg')`, and pick it through `setInputFiles({ name, mimeType, buffer })`. `data-image-size` is `4579x2747`.
  - `should_explain_unreadable_files (AC-3)`: pick orientation-1, then a 100-byte random `.jpg`, then a `.txt`. Each time the message is shown, and `data-image-size` stays `120x80`.
- [ ] **Step 3: Run** `npx playwright test e2e/photo.spec.ts`. Expected: FAIL (no `data-image-size`, no message).
- [ ] **Step 4: Implement.**
  - Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })` and size it with `cappedSize`.
  - Draw into a DOM canvas of the capped size with `imageSmoothingQuality = 'high'`, then `getImageData`. Return the file's bytes (`new Uint8Array(await file.arrayBuffer())`) and `file.type`.
  - Map any decode failure to `PhotoUnreadableError`. The screen shows its message and keeps the current photo.
  - If a browser in the suite fails AC-1, stop and record the measured result before adding a fallback (CLAUDE.md: browser limits are reported).
- [ ] **Step 5: Run** the Step 3 command and `npx vitest run src/ui src/App.test.tsx`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(services): photo loader with orientation and size cap` (Refs #53)

---

### Task 8: Export and import (#57)

**Files:**
- Create: `src/services/backup/backup.ts`, `src/services/backup/index.ts`
- Test: `src/services/backup/backup.test.ts` (node, with `fake-indexeddb`)

**Interfaces:**
- Consumes: `writeZip`, `readZip`, `ZipLimitError`, `NotAZipError` (Task 2); `backupEntries`, `parseBackup`, `NotABackupError` (Task 3); `StickerStore`, `StorageFullError` (Task 4).
- Produces:
  - `exportAll(store: StickerStore, now: Date): Promise<{ name: string; blob: Blob } | null>`: `null` when there are no stickers; throws `ZipLimitError`. The name is `peel-stickers-YYYY-MM-DD.zip` in local time.
  - `importBackup(store, file: Blob, codecs: { inflateRaw: Inflate; inflate: Inflate }): Promise<{ added: number; existing: number; damaged: number }>`. Throws `NotABackupError` (also for `NotAZipError`) or `StorageFullError`.
  - `importMessage(result): string`
  - `browserInflate` and `browserInflateRaw` (`DecompressionStream`), next to `browserDeflate` in `src/services/deflate.ts`

- [ ] **Step 1: Write the failing tests**
  - `should_round_trip_through_a_zip (AC-15, AC-16)`: save 3 records in store A, export, import into an empty store B. `B.get` of each equals `A.get` byte for byte, and the result is `{ added: 3, existing: 0, damaged: 0 }`.
  - `should_merge_and_skip_existing (AC-17)`:
    - B already holds 1 of the 3 IDs, with different bytes. After import it still has its own bytes, and the result is `{ added: 2, existing: 1, damaged: 0 }`.
    - `importMessage` gives "Imported 2 stickers. 1 were already here." Also: `{ added: 1, existing: 0, damaged: 0 }` → "Imported 1 sticker. 0 were already here.", and `{ added: 0, existing: 2, damaged: 1 }` → "Imported 0 stickers. 2 were already here. 1 couldn't be read."
  - `should_refuse_non_backups (AC-18)`: a PNG file, and a ZIP without `peel-backup.json`, both throw `NotABackupError` and store nothing.
  - `should_keep_stickers_added_before_storage_filled (AC-12)`: make the 2nd save throw `StorageFullError`. Import rejects with it, and B still holds the 1st sticker.
  - `should_name_the_export_by_local_date (AC-15)`: `now = new Date(2026, 10, 7, 23, 30)` → `peel-stickers-2026-11-07.zip`. An empty store → `null`.
- [ ] **Step 2: Run** `npx vitest run src/services/backup`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Read the file once (`new Uint8Array(await file.arrayBuffer())`).
  - Check `store.has(id)` before each save, and save one sticker at a time.
  - The export blob is `new Blob(writeZip(entries, now), { type: 'application/zip' })`.
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(services): export and import stickers as zip` (Refs #57)

---

### Task 9: Temporary sticker panel (#52, AC-9, AC-20)

**Files:**
- Create: `src/ui/auto/StickerPanel.tsx`, `src/ui/auto/StickerPanel.css`
- Modify: `src/ui/auto/AutoScreen.tsx` (session gains the current sticker ID, `save`, `reopen` and the photo bytes; the screen shows messages), `src/App.tsx` (opens the store, wires `navigator.storage`, codecs and `buildSticker`)
- Test: `src/ui/auto/StickerPanel.test.tsx`, `src/ui/auto/AutoScreen.test.tsx`

**Interfaces:**
- Consumes: everything above. `createAutoCutout` (spec 0007), whose `setImage` empties the selection (one step). After it, `history.execute({ type: 'restore', selection })` restores a saved selection (one undoable step). `renderer.setImage(id, image, modelAlpha)`.
- Produces:
  - `<StickerPanel stickers onSave canSave saved onOpen onDelete onExport onImport status />`, presentational
  - `AutoScreen` props gain `store: Promise<StickerStore>`, `storage: StorageManagerLike | undefined`, `codecs`, and `build: typeof buildSticker` dependencies

- [ ] **Step 1: Write the failing tests** (RTL; fake store over `fake-indexeddb`; fake renderer whose `renderFull` runs `renderMask`)
  - `should_save_reopen_and_update (AC-5, AC-9, AC-20)`:
    - pick, tap, Save → one thumbnail and "Saved"
    - pick another photo, then tap the thumbnail → the selection equals the saved one, and `data-image-size` is the saved size
    - Save again → still one sticker, with `updatedAt` larger and `createdAt` and ID equal
  - `should_save_what_was_on_screen_at_the_tap (Review Focus 1)`: start a save, make the precise result arrive before `renderFull` resolves → the stored selection is the one at the Save tap.
  - `should_save_as_new_after_deleting_the_open_sticker (Review Focus 2)`: open a sticker, delete it (Delete → "Delete this sticker?" → Delete), Save → one sticker with a new ID.
  - `should_warn_when_the_photo_opens_at_another_size (AC-9)`: a fake `loadPhoto` returns another size → the message is shown, and the selection is still restored.
  - `should_disable_save_without_a_cutout (AC-20)`; `should_say_nothing_to_save_for_an_empty_render` (the spec correction); `should_show_storage_full (AC-12)`; `should_show_outdated (AC-11)` (the store promise rejects with `StorageOutdatedError`, or `onOutdated` fires); `should_ask_for_persistence_after_the_first_save (AC-13)`; `should_show_the_storage_status (AC-14)`; `should_disable_export_without_stickers (AC-15)`; `should_show_the_import_result (AC-17)`; `should_show_too_many_for_a_backup (AC-19)`.
- [ ] **Step 2: Run** `npx vitest run src/ui src/App.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Save** snapshots the history's current selection and the model alpha (the controller's, or the one restored by re-open) before any `await`.
  - **Model alpha:** it is the selection's when `softEdge.source === 'model'`.
  - **Re-open** runs `controller.setImage`, then `renderer.setImage(id, copy, modelAlpha)`, then the restore step.
  - **Export** downloads through a temporary `<a download>` with an object URL, revoked after the click.
  - **Import** uses an `<input type=file accept=".zip,application/zip">`.
- [ ] **Step 4: Run** the Step 2 command, `npm run lint` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): temporary sticker panel` (Refs #52 #54 #56 #57)

---

### Task 10: End-to-end, docs (#52)

**Files:**
- Create: `e2e/stickers.spec.ts`
- Modify: `docs/decisions.md` (spec 0008 section), `docs/specs/0008-load-and-store.md` (status at merge), `docs/licenses.md` (check the rows exist)

- [ ] **Step 1: Write the e2e tests.** The first three run in all projects. They need no models: each seeds a sticker by importing a backup that the test builds in Node with `writeZip` + `backupEntries` from `src/core`, holding one sticker made from `orientation-1.jpg` with a rectangle selection. The fourth runs only in `desktop-chrome`, with the real models.
  - `should_keep_stickers_after_reload (AC-5, AC-8)`: import the test's backup, reload → its thumbnail is listed.
  - `should_round_trip_a_backup (AC-15, AC-16, AC-4)`:
    - export → the download is named `peel-stickers-YYYY-MM-DD.zip`
    - `readZip` gives the same entries as the imported backup, except `exportedAt`
    - `photo.jpg` equals the fixture file's bytes
  - `should_merge_on_import (AC-17)`: import the same backup twice → "Imported 0 stickers. 1 were already here."
  - `should_reopen_and_save_the_same_png (AC-9)` (`desktop-chrome`, real models):
    - pick `e2e/fixtures/auto/object.jpg`, tap the cup, wait for `done`, Save, export (zip 1)
    - reload, tap the thumbnail, Save, export (zip 2)
    - `sticker.png` and `selection.json` are byte-equal in both, and `updatedAt` grew
- [ ] **Step 2: Run** `npx playwright test e2e/stickers.spec.ts`. Expected: PASS. If a test fails, debug it before going on.
- [ ] **Step 3: Update docs** with spec 0008's decisions and any rulings. Then run the full suite: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run test:coverage`, `npm run test:perf`, `npm run test:e2e`.
- [ ] **Step 4: Commit** `test(e2e): stickers survive reloads and round-trip through backups` (Refs #52 #54 #57)
