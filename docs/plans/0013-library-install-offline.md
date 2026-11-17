# Library, Install and Offline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Peel opens on a Library of saved stickers, with selection mode for Share, Duplicate, Export and Delete.
- It installs on Android and iPhone with help.
- It works fully offline after the first visit.
- It says when a new version is ready.
- It speaks English and Romanian.

**Architecture:**
- **Languages (`src/ui/i18n/`):**
  - typed catalogs `en` and `ro`, read through `useT()` from a context;
  - services and core keep throwing typed errors and returning codes, and the UI turns them into catalog keys.
- **Screens (`src/App.tsx`):**
  - App owns the screen: `'library' | 'editor'`.
  - The editor stays mounted under the Library: it is hidden and `inert`, so its workers and Finish settings survive, as the Finish screen does over the editor.
  - The Library talks to the editor through an `EditorHandle` ref.
- **Sticker store state** moves out of the editor's `useStickers` into an App-level `useLibrary`. The editor keeps only saving (`useSave`).
- **Library Share** uses a second render worker, started on the first tick, with a new `finishSaved` job. The job decodes the saved sticker PNG with a new exact core decoder, then runs spec 0012's `finishImage` and encoders.
- **Offline:**
  - the model store shares in-flight downloads;
  - `prefetchModels` downloads the four files after the Library first shows;
  - the WebP encoder joins the precache.
- **Update:** `registerType: 'prompt'` behind a small `watchForUpdate` service.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), React 19, Vitest + RTL (jsdom), Playwright, vite-plugin-pwa 2. **No new dependency.**

**Spec:** `docs/specs/0013-library-install-offline.md` (story #86; #87–#91)

## Global Constraints

- **Purity:** `src/core/` has no DOM, React, Node or browser imports or globals. `Intl.PluralRules` is JavaScript and allowed.
- **Numbers, from the spec:**
  - grid: 3 columns under 600 px, else 120–160 px columns;
  - long press: 500 ms, at most 10 px of movement;
  - buttons: at least 44 × 44 px;
  - models: about 51 MB (engine loader, engine wasm, v1, v2).
- **Copy is exact (English):**
  - **Library:** "Peel", "Select", "Done", "New sticker", "No stickers yet", "Tap + to make your first one.", "Open sticker", "{count} selected".
  - **Bar:** "Share", "Duplicate", "Export", "Delete", "Preparing…", "Couldn't share. Try Export instead."
  - **Delete dialog:** "Delete this sticker?", "Delete {count} stickers?", "This can't be undone.", "Delete", "Cancel".
  - **Unsaved dialog:** "Save changes to this sticker?", "Save this sticker?", "Save", "Don't save", "Cancel".
  - **Editor top bar:** "Library", "Save", "Saved", "Done". The "Photo" and "Stickers" buttons go.
  - **⋯ menu:** "More" (its button's name), "Export all", "Import", "Language", "Automatic", "English", "Română", "Install Peel".
  - **Install card:** "Install Peel to keep your stickers safe. Browsers can clear a website's data after a few days without a visit.", with "Install" and "Close".
  - **iPhone install guide:** AC-16's text, word for word, titled "Install Peel".
  - **Offline line:** "Downloading for offline use… {percent}%", "Ready to use offline.", "Auto needs the internet the first time."
  - **Update bar:** "A new version of Peel is ready.", "Reload".
  - Every existing message keeps its English text.
- **Romanian:**
  - ș/ț with comma below (U+0219, U+021B, U+0218, U+021A), never ş/ţ;
  - plurals from `Intl.PluralRules('ro')`: `one`, `few`, `other` ("1 autocolant", "2 autocolante", "20 de autocolante");
  - language names in their own language in both catalogs.
- **Storage keys:**
  - `localStorage` `peel.language` ∈ `auto | en | ro`, every access in try/catch;
  - store meta `installCardClosed`.
- **Accessibility:**
  - tiles are buttons; in selection mode they carry `aria-pressed`;
  - dialogs are `role="dialog"` with `aria-modal="true"` and `aria-labelledby`; focus goes to the first button, and Escape acts as Cancel;
  - never use `window.confirm`, `alert` or `prompt`.
- **Process:**
  - Test names are `should_...` with the spec 0013 AC id.
  - e2e runs with `--workers=2` locally.
  - Coverage: `src/core/` ≥ 90%, overall ≥ 75%.
- **Git:** branch `feat/86-library-install-offline`; at least one commit per task (Conventional Commits, `Refs #N`); the PR closes #86–#91.

## Review Focus

1. **Lifting the finger after a long press.**
   - The `click` that follows must not untick the tile it just ticked, nor open it.
   - On iPhone, the image's own touch-and-hold menu must not appear (`-webkit-touch-callout: none`, `user-select: none`, and `contextmenu` prevented on tiles).
   - Covered in Task 6.
2. **Deleting, from the Library, the sticker that is open in the hidden editor, then saving in the editor.** The save makes a new sticker and doesn't fail on a missing ID. "Saved" doesn't claim a sticker that's gone (Task 9).
3. **Tapping Auto while the first-visit download is fetching the same model.** There's one fetch per file, and both callers get the same checked bytes. Auto's progress still reaches 100% (Task 4).
4. **Android Back on the Finish screen.** It returns to the editor, not the Library. With the unsaved dialog open, Back acts as Cancel (Task 9).
5. **Two ticked stickers whose files get the same name** (the same minute). The second is `…-2.png`, so the share sheet doesn't drop one. A sticker deleted in another tab while ticked is unticked quietly and doesn't block Share (Task 8).

---

### Task 1: Languages: catalogs, `useT`, and no hard-coded text (#91)

**Files:**
- Create in `src/ui/i18n/`: `en.ts`, `ro.ts`, `i18n.tsx`, `language.ts`, with `language.test.ts`, `catalog.test.ts` and `hardcoded.test.ts`
- Modify every `.tsx` under `src/ui/` and `src/App.tsx`. Also modify the files whose English strings reach the screen:
  - `src/core/mask/types.ts`, `src/core/sticker/budget.ts`;
  - `src/services/photo/loadPhoto.ts`, `src/services/segmentation/{autoCutout,status}.ts`, `src/services/storage/{persistence,errors}.ts`;
  - `src/ui/editor/{useLasso,useStickers}.ts`, `src/ui/finish/useFinishOutput.ts`.

**Interfaces:**
- Produces:
  - `en` as `const`.
  - `type MessageKey = keyof typeof en`.
  - `ro: Record<MessageKey, string>`.
  - `type Lang = 'en' | 'ro'`; `type LangChoice = 'auto' | Lang`.
  - `pickLanguage(languages: readonly string[]): Lang` (AC-24).
  - `format(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string`:
    - replaces `{name}`;
    - a key ending in `_plural` holds forms joined by `|`, in `Intl.PluralRules` category order: `one|other` for `en`, `one|few|other` for `ro`.
  - `I18nProvider({ choice, children })`.
  - `useT(): (key, params?) => string`.
  - `useLang(): Lang`.
  - The default context is English, so components rendered without a provider (every existing test) read English.
  - `readChoice(storage?: Storage): LangChoice` and `writeChoice(choice, storage?)`, both in try/catch.
- Services and core no longer carry display text:
  - Errors keep their classes and `reason` codes (`message` stays for logs).
  - `statusLines(state)` returns `{ key: MessageKey; params? }[]`.
  - `importMessage(result)` returns `{ key, params }`.
  - `STORAGE_STATUS_TEXT` becomes a key map.
  - The UI formats all of them.

- [ ] **Step 1: Write the failing tests:**
  - `should_pick_romanian_only_when_it_comes_first (AC-24)`:
    - `['ro-RO','en']` → `ro`; `['ro']` → `ro`; `['ro-MD']` → `ro`;
    - `['en-GB','ro']` → `en`; `['de','ro']` → `ro` (first en/ro wins);
    - `['de','fr']` → `en`; `[]` → `en`.
  - `should_keep_the_two_catalogs_alike (AC-26)`:
    - the same key set in both;
    - for each key, the same set of `{…}` placeholders;
    - `_plural` keys have 2 forms in `en` and 3 in `ro`.
  - `should_use_comma_below_letters (AC-26)`: no value in `ro` contains U+015F, U+0163, U+015E or U+0162.
  - `should_choose_romanian_plural_forms (AC-26)`: `format('ro','selectedCount_plural',{count:n})` gives:
    - n = 1: "1 autocolant selectat";
    - n = 2: "2 autocolante selectate";
    - n = 20: "20 de autocolante selectate".
  - `should_have_no_hard_coded_text (AC-25)`:
    - Parse each `.tsx` in `src/ui/**` and `src/App.tsx` with `typescript`'s `createSourceFile`.
    - Fail on:
      - a `JsxText` with a letter (`/\p{L}/u`) after trimming;
      - a string literal or no-substitution template as the value or expression of the JSX attributes `aria-label`, `title`, `alt`, `placeholder` or `aria-description`.
    - `ALLOWED` is a `Set` of exact strings, each with a comment saying why (e.g. `'×'`, `'⋯'`, `'+'`).
    - Print every offender as `file:line text`.
  - `should_keep_the_choice_when_storage_throws (AC-24)`: `readChoice` with a `Storage` whose `getItem` throws returns `'auto'`, and `writeChoice` doesn't throw.
- [ ] **Step 2: Run** `npx vitest run src/ui/i18n`. Expected: FAIL. The modules are missing; once they exist, `hardcoded.test` lists the current offenders.
- [ ] **Step 3: Implement** the modules. Move every user-facing string into `en.ts`, with the Romanian in `ro.ts`. Use keys named by screen, e.g. `finish.share`, `library.empty.title`, `error.storageFull`. Replace the strings with `t(...)`.
  - Services keep their English error messages for logs only.
  - Existing tests that import message constants (`SHARE_FAILED`, `NOTHING_TO_SAVE`…) switch to `en['…']`.
- [ ] **Step 4: Run** `npx vitest run`, `npm run lint` and `npm run typecheck`. Expected: all PASS, and no existing test changes its expected English text.
- [ ] **Step 5: Commit** `feat(i18n): English and Romanian catalogs; no hard-coded text (spec 0013)` with `Refs #91`.

### Task 2: Exact PNG decoder for our own files (#87)

**Files:**
- Create: `src/core/png/decode.ts`, `src/core/png/decode.test.ts`
- Modify: `src/core/png/index.ts`

**Interfaces:**
- Produces `decodePng(bytes: Uint8Array, inflate: Inflate): Promise<RgbaImage>` for 8-bit RGBA, non-interlaced PNGs: the format `encodePng` writes and every saved sticker uses. Anything else throws `UnsupportedPngError`.

- [ ] **Step 1: Write the failing tests:**
  - `should_decode_what_encode_png_writes_byte_for_byte (AC-8)`: encode three images (1 × 1; 37 × 23 random RGBA including alpha 0 and 1; 300 × 2 gradient), then decode. `data` is identical, and so are width and height.
  - `should_undo_every_filter (AC-8)`: a hand-built PNG of 5 rows using filters 0, 1, 2, 3 and 4 (Paeth) decodes to the known pixels.
  - `should_reject_other_pngs (AC-8)`:
    - colour type 2: `UnsupportedPngError`;
    - interlace 1: `UnsupportedPngError`;
    - bad signature: `UnsupportedPngError`;
    - IDAT split across two chunks: decodes fine.
- [ ] **Step 2: Run** `npx vitest run src/core/png`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement:**
  - read chunks;
  - concatenate the IDATs;
  - `inflate` (zlib);
  - unfilter row by row with bpp 4.
  - Don't check CRCs: the file comes from our own store.
- [ ] **Step 4: Run** `npx vitest run src/core/png`. Expected: PASS. Commit `feat(core): exact PNG decoder for saved stickers (spec 0013)` with `Refs #87`.

### Task 3: Duplicate and export selected (#87)

**Files:**
- Modify: `src/services/backup/backup.ts` (+ test), `src/services/storage/stickerStore.ts` (+ test)

**Interfaces:**
- Produces:
  - `exportAll(store, now, ids?: readonly string[])`. With `ids`, only those, in list order. `null` when none remain.
  - `duplicateStickers(store, ids: readonly string[], now: number): Promise<number>`:
    - copies each;
    - returns how many it saved;
    - rethrows `StorageFullError` after the copies made before it.

- [ ] **Step 1: Write the failing tests** (fake-indexeddb, as spec 0008's tests):
  - `should_export_only_the_ticked_stickers (AC-10)`: of 3 saved, export 2 ids. The ZIP imports into an empty store as exactly those 2, byte-identical, and is named `peel-stickers-YYYY-MM-DD.zip`.
  - `should_duplicate_byte_for_byte_with_a_new_id (AC-9)`:
    - the copy has a new UUID, and `createdAt` = `updatedAt` = now;
    - photo, sticker, thumbnail, selection, modelAlpha and finish are equal;
    - the original is untouched;
    - 2 ids give 2 copies, listed first in the originals' relative order (`updatedAt` = now + 1 for the first, now for the second).
  - `should_keep_copies_made_before_storage_fills (AC-9)`: a store whose second `save` throws `StorageFullError`. One copy exists, and the error is rethrown.
- [ ] **Step 2: Run** `npx vitest run src/services/backup src/services/storage`. Expected: FAIL.
- [ ] **Step 3: Implement** as the signatures say.
- [ ] **Step 4: Run** the same command. Expected: PASS. Commit `feat(storage): duplicate and export selected stickers (spec 0013)` with `Refs #87`.

### Task 4: Everything offline after the first visit (#89)

**Files:**
- Modify: `src/services/segmentation/modelStore.ts` (+ test), `vite.config.ts`, `e2e/models.spec.ts`, every `e2e/*.spec.ts` import line
- Create: `src/services/segmentation/prefetch.ts` (+ test), `e2e/helpers/test.ts`

**Interfaces:**
- Produces:
  - `ModelStore.get` shares downloads: a file already being fetched by another call is awaited, not fetched again. Each caller's `onProgress` still runs from 0 to its own total.
  - `prefetchModels(store: ModelStore, files: readonly ModelFile[], env: { saveData: boolean; onlineAtStart: boolean }, onStatus: (s: OfflineStatus) => void): Promise<void>`.
  - `type OfflineStatus = { kind: 'downloading'; percent: number } | { kind: 'ready' } | { kind: 'needsInternet' }`.
  - `e2e/helpers/test.ts` exports `test` and `expect`. Its `prefetch` option defaults to `false`. When `false`, an init script defines `navigator.connection = { saveData: true }`, so ordinary tests download nothing.

- [ ] **Step 1: Write the failing tests:**
  - `should_fetch_a_file_once_for_two_callers (Review Focus 3)`:
    - with a fake `fetch` that counts and streams in 4 chunks, two concurrent `get([fast])` make exactly 1 fetch;
    - both resolve with equal bytes;
    - each progress sequence only increases and ends at `fast.bytes`.
  - `should_prefetch_all_four_files_in_order (AC-18)`:
    - fetch order: engine loader, engine wasm, fast, precise;
    - statuses: `downloading` with whole percents that only increase, then `ready`;
    - with everything already cached: just `ready`, with no fetch.
  - `should_skip_the_download_on_save_data (AC-18, Decision 13)`: `saveData: true` → no fetch and one `needsInternet`.
  - `should_report_a_failure_once (AC-18)`: a failing fetch → `needsInternet`, with no retry inside the call.
  - Update `e2e/models.spec.ts`'s spec 0007 AC-19 test to the new rule. With `test.use({ prefetch: true })`:
    - after the Library shows, the four files are requested;
    - the ⋯ menu reads "Ready to use offline." within 60 s. That part needs the menu wired into the app, so it lands with Task 9.
- [ ] **Step 2: Run** `npx vitest run src/services/segmentation`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - `get` keeps a `Map<key, Promise<ArrayBuffer>>` of in-flight files with per-file listeners.
  - `prefetchModels` is `store.get(files, …)` mapped to statuses (a no-op with `needsInternet` when `saveData` is set).
  - `vite.config.ts`:
    - remove `globIgnores`;
    - add `webp_enc*.wasm` to `globPatterns`;
    - raise `maximumFileSizeToCacheInBytes` to cover the 346 KB wasm, if needed.
  - Switch every e2e spec's `@playwright/test` import of `test`/`expect` to `./helpers/test` (one `sed`, then Prettier).
- [ ] **Step 4: Run:**
  - `npx vitest run`;
  - `npm run build`, then check `dist/sw.js` lists `webp_enc` (AC-20);
  - `npx playwright test e2e/pwa.spec.ts e2e/models.spec.ts --workers=2`.

  Expected: PASS. Commit `feat(offline): share model downloads, prefetch them, precache the WebP encoder (spec 0013)` with `Refs #89`.

### Task 5: Install and update services (#88, #90)

**Files:**
- Create: `src/services/install/install.ts`, `src/services/install/index.ts`, `src/services/install/install.test.ts`, `src/services/update/update.ts`, `src/services/update/index.ts`, `src/services/update/update.test.ts`
- Modify: `vite.config.ts` (`registerType: 'prompt'`), `src/main.tsx`, `e2e/pwa.spec.ts`

**Interfaces:**
- Produces:
  - `isInstalled(env: { matchMedia?: (q: string) => { matches: boolean }; navigator?: { standalone?: boolean } }): boolean` (AC-14).
  - `captureInstallPrompt(target: EventTarget): InstallPrompt`, where `InstallPrompt = { available(): boolean; prompt(): Promise<'accepted' | 'dismissed'>; onChange(cb: () => void): () => void }` (AC-15).
  - `watchForUpdate(register: (opts: { onNeedRefresh(): void }) => (reload?: boolean) => Promise<void>): UpdateWatch`, where `UpdateWatch = { ready(): boolean; reload(): Promise<void>; onChange(cb): () => void }` (AC-22, AC-23).
  - `main.tsx` creates the watch with the real `registerSW` and passes it, with `captureInstallPrompt(window)`, into `<App>`.

- [ ] **Step 1: Write the failing tests:**
  - `should_hide_install_when_running_installed (AC-14)`: standalone media → true; `navigator.standalone` → true; neither → false; no `matchMedia` → false.
  - `should_keep_and_use_the_install_prompt_once (AC-15)`:
    - dispatching a fake `beforeinstallprompt` (with `preventDefault`, `prompt()` and `userChoice` resolving `{ outcome: 'accepted' }`) → `preventDefault` was called and `available()` is true;
    - `prompt()` resolves `'accepted'`; then `available()` is false and listeners ran;
    - a second `prompt()` rejects;
    - `appinstalled` also makes it unavailable.
  - `should_offer_reload_when_a_version_waits (AC-22, AC-23)`: with a fake `register`, `ready()` is false until `onNeedRefresh` fires, then true. `reload()` calls the returned function with `true` once.
  - In `e2e/pwa.spec.ts`, `should_wait_for_reload_before_updating (AC-22)`: the built `sw.js` handles a `SKIP_WAITING` message and doesn't call `skipWaiting()` on install. Read it through `request.get('/sw.js')` and look for the `message`/`SKIP_WAITING` handler, and for no top-level `self.skipWaiting()`.
- [ ] **Step 2: Run** `npx vitest run src/services/install src/services/update`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `main.tsx`, replace `registerSW({ immediate: true })` with the watch (still `immediate: true`).
- [ ] **Step 4: Run** the unit tests, then `npm run build` and `npx playwright test e2e/pwa.spec.ts --workers=2`. Expected: PASS. Commit `feat(pwa): install prompt and update watch services (spec 0013)` with `Refs #88, #90`.

### Task 6: Library screen: grid, selection mode and dialogs (#87)

**Files:**
- Create in `src/ui/library/`: `LibraryScreen.tsx`, `LibraryScreen.css`, `ConfirmDialog.tsx`, `useLongPress.ts`, `LibraryScreen.test.tsx`

**Interfaces:**
- Consumes `useT` (Task 1).
- Produces `LibraryScreen(props: LibraryProps)`. `LibraryProps`:
  - `stickers: readonly StickerSummary[]`;
  - `blocked: string | null`: the text shown in place of the grid, AC-12;
  - `message: string | null`;
  - `busy: boolean`;
  - `onNew(file: File): void`;
  - `onOpen(id: string): void`;
  - `onDuplicate(ids)`, `onExport(ids)`, `onDelete(ids)`: each `Promise<void>`;
  - `share: ShareState`, where `ShareState = { shown: boolean; preparing: boolean; message: string | null; onShare(): void }`. Task 8 fills it; this task passes `{ shown: false, preparing: false, message: null, onShare() {} }`;
  - `onTicked(ids: readonly string[]): void`;
  - `menu: ReactNode` and `top: ReactNode` (the install card and update bar), both from Task 7;
  - the hidden file input is labelled "Pick a photo" (`accept="image/*"`), as the editor's is today.
- Produces `ConfirmDialog({ title, body?, actions: { label, kind: 'primary' | 'danger' | 'plain', onClick }[], onCancel })`, reused by Task 9's unsaved dialog.

- [ ] **Step 1: Write the failing tests** (RTL, fake timers for the long press):
  - `should_show_the_grid_newest_first (AC-1)`: 3 summaries → 3 "Open sticker" buttons in the given order, each with an `img`; "New sticker", "Select" and "More" buttons exist.
  - `should_show_the_empty_state (AC-2)`: no stickers → "No stickers yet" and "Tap + to make your first one."; "Select" is disabled.
  - `should_pick_a_photo_from_plus (AC-3)`: a change on "Pick a photo" calls `onNew(file)`, and "New sticker" clicks the input.
  - `should_open_on_tap (AC-4)`: a click calls `onOpen(id)`.
  - `should_start_selecting_on_a_long_press (AC-7)`:
    - pointerdown, then 500 ms → that tile is `aria-pressed="true"`;
    - the header reads "1 selected" and has "Done";
    - "New sticker" is gone; the bar shows Duplicate, Export and Delete enabled;
    - the following `click` keeps it ticked and doesn't call `onOpen` (Review Focus 1).
  - `should_not_start_selecting_when_the_finger_moves (AC-7)`: pointermove of 11 px before 500 ms → no selection mode; the click opens.
  - `should_start_selecting_from_select (AC-7)`: "Select" → none ticked and the bar actions disabled; tapping two tiles ticks them ("2 selected"); "Done" clears.
  - `should_confirm_before_deleting (AC-11)`:
    - Delete → a dialog named "Delete 2 stickers?" with "This can't be undone.";
    - Cancel → no call;
    - Delete again, then "Delete" → `onDelete(['a','b'])`, and selection mode ends;
    - Escape acts as Cancel.
  - `should_duplicate_and_export_the_ticked (AC-9, AC-10)`: each callback is called with the ticked ids in grid order.
  - `should_block_the_grid_when_storage_fails (AC-12)`: `blocked` set → its text shows, there's no grid, and "New sticker" still works.
  - `should_suppress_the_ios_callout (Review Focus 1)`: a tile's `contextmenu` event is default-prevented.
- [ ] **Step 2: Run** `npx vitest run src/ui/library`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Grid CSS:** `repeat(3, 1fr)` below 600 px; `repeat(auto-fill, minmax(120px, 160px))` above.
  - **Tiles:** `aspect-ratio: 1`, a checkerboard background, `object-fit: contain`, and `-webkit-touch-callout: none; user-select: none; touch-action: manipulation`.
  - **Header:** sticky.
  - **FAB:** fixed bottom-right, 56 px, with `env(safe-area-inset-bottom)`.
  - **Bar:** fixed at the bottom.
  - Colours use the existing tokens in `index.css`.
- [ ] **Step 4: Run** `npx vitest run src/ui/library`, lint and typecheck. Expected: PASS. Commit `feat(library): grid, selection mode and delete dialog (spec 0013)` with `Refs #87`.

### Task 7: ⋯ menu, language, install card and guide, update bar, offline line (#88, #89, #90, #91)

**Files:**
- Create in `src/ui/library/`: `MoreMenu.tsx`, `InstallCard.tsx`, `InstallGuide.tsx`, `UpdateBar.tsx`, with tests

**Interfaces:**
- Consumes: `InstallPrompt`, `isInstalled` and `UpdateWatch` (Task 5); `OfflineStatus` (Task 4); `isAppleTouch` (spec 0012); `LangChoice` and `writeChoice` (Task 1).
- Produces:
  - `MoreMenu({ canExportAll, onExportAll, onImport(file), choice, onChoice, install: InstallOffer | null, storageLine, offline: OfflineStatus | null })`, where `InstallOffer = { kind: 'prompt' | 'guide'; open(): void }`.
  - `InstallCard({ offer, onClose })`.
  - `InstallGuide({ onClose })`.
  - `UpdateBar({ watch })`.
  - `installOffer(env, prompt, onGuide): InstallOffer | null`: `null` when installed. `prompt` when `available()`. `guide` on Apple touch (spec 0012 `isAppleTouch`). Otherwise `null` (AC-16).

- [ ] **Step 1: Write the failing tests:**
  - `should_list_the_menu_in_order (AC-13)`: the item names in order are "Export all", "Import", "Language", "Install Peel", then the storage line, then the offline line. "Export all" is disabled when `canExportAll` is false. Escape, an outside tap and choosing an item each close it.
  - `should_switch_language_at_once (AC-24)`:
    - choosing "Română" calls `onChoice('ro')`;
    - inside an `I18nProvider` driven by that state, the menu's "Export all" becomes the Romanian text without a remount, and `document.documentElement.lang` is `ro`;
    - "English" and "Română" read the same in both languages.
  - `should_offer_install_by_platform (AC-14 to AC-16)`:
    - installed → `null`;
    - a captured prompt → `prompt`, and `open()` calls `prompt()`;
    - an iPhone user agent without a prompt → `guide`;
    - desktop Firefox with neither → `null`.
  - `should_show_the_iphone_guide_text (AC-16)`: the three steps and the last line, word for word.
  - `should_show_the_install_card_until_closed (AC-17)`: with an offer and at least one sticker it shows. With no stickers or a `null` offer it's hidden. "Close" calls `onClose` (which writes the meta in Task 9).
  - `should_show_reload_when_a_version_waits (AC-22, AC-23)`: a fake watch flips `ready` → the bar shows "A new version of Peel is ready.", and "Reload" calls `watch.reload()`.
  - `should_show_offline_progress (AC-19)`: the three `OfflineStatus` kinds map to the three lines, e.g. "Downloading for offline use… 42%".
- [ ] **Step 2: Run** `npx vitest run src/ui/library`. Expected: FAIL.
- [ ] **Step 3: Implement.** The menu is a popover anchored to "More": `role="menu"` with `menuitem`s, the language as `menuitemradio`, and the two status lines as plain text below a separator. Import is a hidden file input (`accept=".zip,application/zip"`).
- [ ] **Step 4: Run** `npx vitest run src/ui`. Expected: PASS. Commit `feat(library): more menu, language, install help, update bar (spec 0013)` with `Refs #88, #90, #91`.

### Task 8: Share from the Library (#87)

**Files:**
- Modify: `src/workers/protocol.ts`, `src/workers/renderHandler.ts` (+ test), `src/services/workerClient.ts` (+ test, if the client needs the new job)
- Create: `src/ui/library/useShareFiles.ts` (+ test)

**Interfaces:**
- Consumes:
  - `decodePng` (Task 2);
  - `finishImage`, `finishFileName`, `OUTPUT_MIME`, `readFinish` (spec 0012);
  - `canShareType` and `shareFile`, generalised to files (spec 0012).
- Produces:
  - a new render job `{ type: 'finishSaved'; jobId; png: Uint8Array; settings: FinishSettings }`, answered as `finished` / `finishFailed` like `finish`. Its own type, so it never cancels the editor's jobs.
  - `useShareFiles(ticked: readonly string[], deps: { store: StickerStore | null; createRenderer(): Renderer; now(): Date; nav?: Navigator }): ShareState`:
    - starts its renderer on the first tick and terminates it when nothing is ticked;
    - prepares one file at a time, in tick order, caching by id;
    - drops a file when its tick goes.
  - `canShareFiles(nav, types: readonly string[]): boolean`: one probe with one file per type.
  - `shareFiles(nav, files: File[])`: the same result type as `shareFile`.

- [ ] **Step 1: Write the failing tests:**
  - `should_finish_a_saved_sticker_exactly (AC-8)`:
    - the handler gets `finishSaved` with `encodePng(redRect100x60)` and Sticker settings with outline 4% white;
    - the reply's bytes decode (`decodePng`) to the same pixels as `finishImage(redRect, settings)`, re-encoded.
  - `should_prepare_files_in_tick_order_and_share_at_once (AC-8)`:
    - with a fake renderer that resolves on demand, ticking a then b → "Preparing…", and only after both resolve, `preparing` is false;
    - `onShare()` calls `nav.share` synchronously with 2 files, named from each sticker's saved output: a PNG name and a `…-whatsapp.webp` name for one saved as WhatsApp-style.
  - `should_suffix_colliding_names (Review Focus 5)`: two Sticker PNGs in the same minute → `peel-sticker-…-0905.png` and `peel-sticker-…-0905-2.png`.
  - `should_untick_a_sticker_gone_from_the_store (Review Focus 5)`: `store.get` gives `undefined` for b → b is skipped, and Share proceeds with a.
  - `should_hide_share_without_file_sharing (AC-8)`: `canShare` false for webp while one ticked is WhatsApp-style → `shown: false`.
  - `should_treat_a_closed_sheet_as_no_error (AC-8)`: an `AbortError` → no message. `NotAllowedError` → "Couldn't share. Try Export instead."
- [ ] **Step 2: Run** `npx vitest run src/workers src/ui/library src/services`. Expected: FAIL.
- [ ] **Step 3: Implement.** The handler decodes with the worker's inflate (`browserInflate`, through a `RenderDeps.inflate` dep like `deflate`), then reuses the existing `finish(jobId, cutout, settings)` path. `useShareFiles` reads each record's `sticker` and `finish` (through `readFinish`) with `store.get`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Commit `feat(library): share ticked stickers in their saved finish (spec 0013)` with `Refs #87`.

### Task 9: App wiring: Library home, editor back and save, Android Back (#87)

**Files:**
- Modify: `src/App.tsx` (+ `App.test.tsx`), `src/ui/editor/EditorScreen.tsx` (+ tests), `src/ui/editor/EditorScreen.css`
- Create: `src/ui/library/useLibrary.ts` (+ test), `src/ui/editor/useSave.ts` (+ test)
- Delete: `src/ui/editor/StickerPanel.tsx`, `StickerPanel.css` and `useStickers.ts`. Their tests move to `useLibrary`/`useSave`, keeping the spec 0008 AC ids.
- Modify e2e:
  - `e2e/helpers/editor.ts`: `seedAndOpen` taps the Library tile; `openStickers`/`closeStickers`/`importFile` go through the ⋯ menu; `pickGenerated` uses the Library's "Pick a photo".
  - `e2e/stickers.spec.ts`, `e2e/photo.spec.ts`: picking another photo first goes back with "Library".

**Interfaces:**
- Consumes everything above.
- Produces:
  - `useLibrary(deps: StickerDeps)`. It returns the store, `stickers`, `blocked`, `message`, `busy`, `status` (the storage key), `refresh()`, `remove(ids)`, `duplicate(ids)`, `exportSome(ids | null)`, `importFile(file)`, `meta.get/set`. It's spec 0008's lifecycle (open, outdated, persistence) moved out of `useStickers`.
  - `useSave(library, host, photoId, selection, finish)`. It returns `{ canSave, saved, save(): Promise<boolean>, message }`. After `host.open(record)`, `saved` is true for the opened state (AC-4).
  - `EditorHandle`:
    - `openFile(file: File): Promise<string | null>`: an error message, or null when opened;
    - `openSticker(id: string): Promise<void>`;
    - `unsaved(): 'none' | 'new' | 'changed'`;
    - `save(): Promise<boolean>`;
    - `deleted(ids: readonly string[]): void`.
  - `EditorScreen` gets `handle` (a ref), `onLibrary(): void` and `visible: boolean`.

- [ ] **Step 1: Write the failing tests:**
  - `should_open_on_the_library (AC-1)`: `App` with fake deps shows "No stickers yet", and the editor is hidden and `inert`.
  - `should_open_the_editor_from_plus_and_stay_on_a_bad_photo (AC-3)`:
    - a good file → the editor shows;
    - an unreadable file → the Library stays and shows "This photo can't be opened. Try a JPEG or PNG."
  - `should_reopen_as_saved (AC-4)`: tapping a tile → the editor shows the sticker, and its top bar has "Saved".
  - `should_ask_before_leaving_unsaved_work (AC-5)`:
    - "changed" + Library → a dialog "Save changes to this sticker?";
    - Cancel stays; Don't save → Library, nothing stored;
    - Save → stored, then the Library;
    - a failed save → the error shows and the editor stays;
    - "new" → "Save this sticker?";
    - a photo with no ring → no dialog.
  - `should_save_from_the_editor_top_bar (AC-6)`: Save → "Saved"; any edit → "Save". The "Photo" and "Stickers" buttons no longer exist.
  - `should_save_as_new_after_the_open_sticker_is_deleted (Review Focus 2)`: open sticker a, go to the Library and delete a (which calls `handle.deleted(['a'])`). The editor's Save then stores a new id and shows "Saved"; nothing rejects on the missing id.
  - `should_go_back_with_the_back_gesture (Decision 14, Review Focus 4)`. Dispatch `popstate`:
    - on the Finish screen → the editor;
    - on the editor with nothing unsaved → the Library;
    - with the unsaved dialog open → the dialog closes (Cancel) and the editor stays, with its history entry pushed back.
  - Update `e2e/stickers.spec.ts` for spec 0008 AC-4/AC-15–AC-18: save, reload → the tile is on the Library; Export all and Import through ⋯.
  - Add `e2e/library.spec.ts`:
    - `should_select_and_delete_with_a_long_press (AC-7, AC-11)` with `page.touchscreen` (hold 600 ms through `page.mouse` on desktop);
    - `should_duplicate_and_export (AC-9, AC-10)`: the export download's name and that it re-imports.
- [ ] **Step 2: Run** `npx vitest run src`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **App:**
    - holds `screen`;
    - renders `LibraryScreen` and the always-mounted `EditorScreen` (with `hidden`/`inert` when not visible);
    - pushes `history.pushState({ peel: 'editor' })` on opening the editor, and the Finish screen pushes `{ peel: 'finish' }`;
    - one `popstate` listener does what Back does.
  - **Prefetch:** App starts `prefetchModels` once after the first Library render (Task 4) and feeds the offline line.
  - **Install card meta:** `installCardClosed` through `useLibrary`'s `meta`.
  - **Editor top bar:** "Library" (left), "Save"/"Saved", "Done". Open warnings (`DIFFERENT_SIZE`) and save errors show in the status strip.
- [ ] **Step 4: Run:**
  - `npx vitest run --coverage`;
  - `npm run lint` and `npm run typecheck`;
  - `npm run test:e2e -- --workers=2`.

  Expected: all PASS (screenshot diffs for the editor's top bar are expected and handled in Task 10). Commit `feat(app): the Library is home; editor back, save and Android Back (spec 0013)` with `Refs #87`.

### Task 10: Offline and Romanian end to end, screenshots, docs (#86–#91)

**Files:**
- Create: `e2e/offline.spec.ts`, `e2e/i18n.spec.ts`
- Modify: `e2e/editor-screens.spec.ts`, `docs/decisions.md`, `STICKER_WEBAPP_PLAN.md`, `docs/device-test-log.md`, the spec's status

**Interfaces:** consumes everything.

- [ ] **Step 1: Write the tests:**
  - `should_work_in_airplane_mode_after_the_first_visit (AC-21)`, with `test.use({ prefetch: true, serviceWorkers: 'allow' })`:
    1. Go online; wait for "Ready to use offline." in ⋯ (60 s).
    2. `context.setOffline(true)` and reload; the Library shows the seeded sticker.
    3. Pick a photo, tap Auto at its centre, and wait for the cutout.
    4. Done → Download Sticker, then Original, then WhatsApp-style (each file checked as in `finish.spec`).
    5. Save → the Library has 2 tiles.

    Skip on a browser where the reload doesn't come from the service worker, with the reason in `test.skip`.
  - `should_show_no_english_in_romanian (AC-27)`, with `test.use({ locale: 'ro-RO' })`. Visit the Library (seeded), selection mode, ⋯, the delete dialog, the editor with each tool's sheet, the Finish screen and the install guide. On each, `document.body.innerText` contains none of the `en` values that differ from `ro`: import the catalogs into the test, take values ≥ 4 letters, and skip placeholders.
  - `should_fit_the_library (AC-28)`: at 375 × 812 and 430 × 932, for the Library, selection mode and ⋯ open, `scrollWidth ≤ clientWidth`, and every visible button's box is at least 44 × 44.
  - `should_match_the_library (AC-29)` in `editor-screens.spec.ts`, through `eachScreen`: the Library empty, with 9 seeded stickers, selection mode with 2 ticked, and ⋯ open.
- [ ] **Step 2: Run** `npx playwright test e2e/offline.spec.ts e2e/i18n.spec.ts e2e/library.spec.ts --workers=2`. Expected: PASS, or a precise failure to fix in the owning task's code.
- [ ] **Step 3:** Delete the editor screenshot baselines whose top bar changed, push, and take CI's `screenshots` artifact (pixel-8). Check every new baseline by eye before committing it.
- [ ] **Step 4: Docs:**
  - `docs/decisions.md` gains "Library, install and offline decisions (spec 0013)" with the 14 decisions in one line each.
  - `STICKER_WEBAPP_PLAN.md` ticks Phase 9's library, install and update items.
  - `docs/device-test-log.md` gets a "Library, install and offline (spec 0013)" table. Rows:
    1. long-press select, Share 2 stickers;
    2. Delete and Duplicate;
    3. install on Android with the button;
    4. install on iPhone with the guide;
    5. airplane mode after the first visit, with Auto;
    6. Romanian phone language;
    7. update bar after a deploy;
    8. Android Back.
  - The spec's status becomes Implemented.
- [ ] **Step 5: Run** the whole gate: lint, typecheck, `format:check`, `test:coverage` and e2e. Commit `test(e2e): offline, Romanian and Library screenshots; docs (spec 0013)` with `Refs #86`.
