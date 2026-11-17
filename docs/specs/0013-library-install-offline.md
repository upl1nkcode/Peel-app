# 0013 — My stickers live in a library, the app installs easily, and it works offline

- **Status:** Approved
- **Issues:** story #86; tasks #87 (library grid with re-open, re-edit and delete), #88 (install button on Android, install guide on iPhone), #89 (offline caching of app and models), #90 (update available prompt), #91 (English and Romanian translations)
- **Plan reference:** STICKER_WEBAPP_PLAN.md §1 (install, offline, storage caveat), §7 (screens), Phase 9. Builds on:
  - spec 0007: model download, checking and caching;
  - spec 0008: the sticker store, persistent storage, backups, and the temporary sticker panel this replaces;
  - spec 0009 to 0012: the editor, its tools and the Finish screen.

## Why

Peel opens straight onto "pick a photo". Saved stickers sit in a small temporary panel, added in spec 0008 so saving could be tried on phones. There is no home for the stickers you've made, and nothing tells you how to install the app. On an iPhone, Safari may delete a site's data after about 7 days without a visit unless the app is on the Home Screen.

The app shell already loads offline, but only after you've used Auto are the cutout models stored on the phone. So someone who opens Peel once, then goes into airplane mode, has no Auto. Updates install silently, and all text is English.

This story makes Peel feel like an installed app:
- a **Library** as the home screen;
- **install help** on Android and iPhone;
- **everything** available offline after the first visit;
- a **"new version" prompt**;
- **English and Romanian**.

## Decisions

**Decisions 1 to 3 are the product owner's**, made on 2026-11-17. The rest are my calls; 5, 6, 9 and 12 matter most for what people get, so please check them.

1. **The Library is the home screen, in the "select several" style** (mockup B). Tap a sticker to edit it. Touch and hold to start selecting; then a bar offers Share, Duplicate, Export and Delete for the ticked stickers. A round **+** makes a new sticker.
2. **The models download on the first visit** (about 51 MB: engine 14.6 MB, tap v1 6.2 MB, tap v2 30.5 MB), so the whole app works in airplane mode afterwards. This replaces spec 0007 AC-19 ("no engine or model file is requested until Auto is used") and Decision 4's "nothing downloads until the user first uses Auto". The download order stays the same: engine and v1 first, then v2.
3. **The interface stays clean and simple**; the features are what matter. The Library reuses what exists: the sticker store, backups, the Finish pipeline and the export actions.
4. **The Library grid shows the saved thumbnails as they are** (the plain cutout, spec 0008 AC-7), newest edited first. Thumbnails with the Finish look would mean rendering every tile; that can come later.
5. **Leaving the editor with unsaved changes asks first:** "Save changes to this sticker?" with **Save**, **Don't save** and **Cancel**. Nothing is saved without asking, and nothing is lost without asking. Duplicate covers "try a variant without losing the original".
6. **Sharing from the Library sends each sticker as its saved Finish settings make it** (output, outline, padding; spec 0012 AC-11), defaulting to a Sticker PNG for stickers saved before spec 0012. The files are made in the background as stickers are ticked, so Share calls `navigator.share` straight away in the tap, as on the Finish screen (spec 0012 Decision 5). Safari only allows sharing directly in a tap.
7. **A "Select" button** in the Library's top bar also starts selecting, for people who can't or don't touch and hold (keyboard, desktop, screen readers). While selecting it reads "Done".
8. **The ⋯ menu** in the Library's top bar holds: Export all, Import, Language, "Install Peel" (when it can be installed), and the storage and offline status lines.
9. **The install reminder is one card at the top of the Library**, shown when the app isn't installed and at least one sticker is saved, until it's dismissed or Peel is installed. It says why: the stickers are safer.
10. **The update bar shows only on the Library**, never in the editor or on the Finish screen. Reloading there can't lose work.
11. **No translation library.** A small typed message catalog per language: TypeScript checks that both languages have every message, and a test checks that no screen has hard-coded text. Plurals use `Intl.PluralRules` (Romanian has three forms: 1 autocolant, 2 autocolante, 20 de autocolante).
12. **The chosen language is kept in `localStorage`**, wrapped in try/catch, so it is a per-device convenience. "Automatic" (follow the phone) is the default.
13. **The download skips Save-Data.** When the browser says the user asked to save data (`navigator.connection.saveData`, Chrome only), the first-visit download doesn't start; Auto then downloads on first use, as before. The e2e tests that don't test the download set it too, so 51 MB isn't fetched in every test.
14. **Android's Back gesture works inside the app.** Opening the editor or the Finish screen adds a history entry, so Back returns one screen (with Decision 5's question when there are unsaved changes) instead of closing Peel.

## What

### Library (#87)

- **AC-1** Given the app opens, then the Library shows: the title "Peel", a "Select" button and a ⋯ menu button in the top bar, the saved stickers in a grid, and a round "New sticker" (+) button in the bottom right corner. The grid has 3 columns on screens narrower than 600 px, and as many 120–160 px columns as fit on wider ones. Each tile shows the sticker's thumbnail on a checkerboard, contained and centred. Stickers are newest first by `updatedAt`.
- **AC-2** Given no saved stickers, then the Library shows, instead of the grid, "No stickers yet" and "Tap + to make your first one." The + button shows as usual; "Select" is disabled.
- **AC-3** When "New sticker" is tapped, then the phone's photo picker opens. Picking a photo opens the editor with it, as the tap-to-cut screen does now. Cancelling the picker stays on the Library.
- **AC-4** Given the Library, when a sticker is tapped, then the editor opens it with its photo, selection, model alpha and Finish settings as saved (spec 0008 AC-9, spec 0012 AC-11). It shows "Saved" until something changes.
- **AC-5** Given the editor, then its top bar has a "Library" back button. When it's tapped with nothing unsaved, the Library shows. With unsaved changes (the cutout on screen differs from the saved sticker, or it's a new cutout with at least one ring), then a dialog asks "Save changes to this sticker?" (for a new one: "Save this sticker?"):
  - **Save:** saves as Save does now, then shows the Library. If saving fails, the error shows and the editor stays.
  - **Don't save:** shows the Library; nothing is stored.
  - **Cancel:** closes the dialog; the editor stays as it was.
  A new photo with no ring counts as nothing unsaved. Android's Back gesture (the browser's history Back) does what the "Library" button does, and on the Finish screen what its "Back" does (Decision 14); Back on the Library leaves the app as usual.
- **AC-6** Given the editor and the Finish screen, then Save keeps working as now (spec 0008 AC-5, spec 0012 AC-11). The temporary sticker panel (spec 0008 AC-20) is removed; its jobs move to the Library (AC-7 to AC-12) and the ⋯ menu (AC-13).
- **AC-7** Given the Library with stickers, when a tile is touched and held for 500 ms without moving more than 10 px, or "Select" is tapped, then selection mode starts:
  - a held tile starts ticked; "Select" starts with none ticked;
  - each tile shows a round tick box, and tapping a tile ticks or unticks it instead of opening it;
  - the top bar reads "N selected" (plural forms per language) and "Select" becomes "Done";
  - the + button hides and a bar at the bottom shows Share, Duplicate, Export and Delete, each disabled while nothing is ticked.
  "Done" ends selection mode and clears the ticks. Scrolling the grid never starts it.
- **AC-8** Given ticked stickers, then "Share" shows only if `navigator.canShare` exists and returns true for probe files of the needed types (AC-14 of spec 0012, with every ticked file's type in one probe). The ticked stickers' files are made in the background as they're ticked (Decision 6), in their saved output with their saved Finish settings, named as spec 0012 AC-16 says plus `-2`, `-3`… when names collide. While any is being made, Share is disabled and the bar says "Preparing…". Tapping Share calls `navigator.share({ files })` at once. A closed share sheet is not an error; any other failure says "Couldn't share. Try Export instead."
- **AC-9** When "Duplicate" is tapped, then each ticked sticker is copied as a new sticker: a new ID, `createdAt` and `updatedAt` now, everything else byte for byte the same. The copies appear first in the grid and selection mode ends. A storage-full error (spec 0008 AC-12) shows its message, and copies made before it stay.
- **AC-10** When "Export" is tapped, then a backup ZIP with only the ticked stickers downloads, in the format of spec 0008 (it imports with Import), named as spec 0008's backups are (`peel-stickers-YYYY-MM-DD.zip`, local date).
- **AC-11** When "Delete" is tapped, then a dialog asks "Delete this sticker?" or "Delete N stickers?", with the line "This can't be undone." and the buttons **Delete** and **Cancel**. Delete removes every part of each ticked sticker (spec 0008) and ends selection mode; Cancel changes nothing. The dialog is an in-page dialog, never `window.confirm`.
- **AC-12** Given the Library, then a storage that can't be opened shows "Stickers can't be saved in this browser." in place of the grid, with + still working. A storage made outdated by another tab (spec 0008 AC-11) shows its message and disables every action that reads or writes stickers.
- **AC-13** The ⋯ menu lists, in order:
  - "Export all" (disabled with no stickers), as spec 0008's export;
  - "Import", as spec 0008's import, with its messages;
  - "Language" (AC-24);
  - "Install Peel" (AC-16), only when it applies;
  - the storage status line (spec 0008 AC-14);
  - the offline status line (AC-19).
  It closes on Escape, on a tap outside, and after choosing an item. Results and errors of Export all and Import show as a message on the Library.

### Install (#88)

- **AC-14** Given Peel runs installed, then nothing about installing shows. "Installed" means `matchMedia('(display-mode: standalone)')` matches, or `navigator.standalone` is true (iPhone).
- **AC-15** Given Android Chrome (or another browser) fires `beforeinstallprompt`, then the event is kept (its default prevented) and "Install Peel" shows. Tapping it calls the kept event's `prompt()` once. After the choice, or after `appinstalled`, "Install Peel" hides.
- **AC-16** Given an iPhone or iPad (spec 0012's `isAppleTouch`) not installed, then "Install Peel" shows in the ⋯ menu and opens a short guide as a dialog:
  1. Tap **Share** in Safari (on newer iPhones it's in the **⋯** menu).
  2. Tap **Add to Home Screen**. If you don't see it, tap **View More**.
  3. Tap **Add**, then open Peel from your Home Screen.
  Its last line says: "Your stickers stay on this phone, and Peel works without internet."
  On other browsers that never fire `beforeinstallprompt` (desktop Safari, Firefox), "Install Peel" doesn't show.
- **AC-17** Given Peel isn't installed and at least one sticker is saved, then a card at the top of the Library says "Install Peel to keep your stickers safe. Browsers can clear a website's data after a few days without a visit." with "Install" (as AC-15 or AC-16) and a close button. Once closed, it never shows again on that device (kept in the store's meta). It never shows when "Install Peel" wouldn't (AC-15, AC-16).

### Offline (#89)

- **AC-18** Given the first visit online, without Save-Data (Decision 13), then once the Library has shown, the engine and both models download in the background, checked and cached exactly as spec 0007 says (AC-16, AC-17, the `peel-models-v1` cache). Files already cached aren't downloaded again. A failed file is retried on the next app start, not in a loop. Opening Auto during the download uses it, as now, without starting a second download of the same file.
- **AC-19** The ⋯ menu's offline status line reads:
  - while downloading: "Downloading for offline use… N%" (bytes of all three files, whole numbers, only increasing);
  - when all are cached: "Ready to use offline.";
  - after a failure, or with Save-Data: "Auto needs the internet the first time."
- **AC-20** Given the WebP encoder, then its script and wasm files (`webp_enc*.js`, `webp_enc*.wasm`) are in the service worker's precache, so WhatsApp-style works offline after the first visit. This replaces spec 0012 Decision 1's "not in the precache"; it is still not in the initial bundle and still loads only when WhatsApp-style is chosen.
- **AC-21** Given a first visit that completed (status "Ready to use offline."), when the network is cut and the app is reloaded, then:
  - the Library opens with the saved stickers;
  - a new photo can be cut out with Auto, dots, lasso and brush;
  - it can be finished and downloaded in all three outputs, WhatsApp-style included;
  - it can be saved, and appears in the Library.
  This runs as a Playwright test with the browser context offline. A test browser where Playwright can't serve the app from its service worker offline is skipped, with the reason written in the test; the real-phone check covers it.

### Update (#90)

- **AC-22** The service worker registers with `registerType: 'prompt'`. Given a new version is waiting, then the Library shows a bar: "A new version of Peel is ready." with a "Reload" button (Decision 10). The editor and the Finish screen never show it; going back to the Library shows it. It has no close button and stays until Reload.
- **AC-23** When "Reload" is tapped, then the waiting service worker takes over (`skipWaiting`) and the page reloads once, running the new version. The bar shows again only for a newer version after that.

### Languages (#91)

- **AC-24** Given the phone's languages (`navigator.languages`, in order), then Peel shows Romanian if the first one whose language is English or Romanian is Romanian (`ro`, `ro-RO`, `ro-MD`…), and English otherwise. The ⋯ menu's "Language" offers "Automatic", "English" and "Română"; a choice applies at once, without a reload, and is kept (Decision 12). `<html lang>` follows the language in use.
- **AC-25** Every user-facing text comes from the message catalog: visible text, `aria-label`, `title`, `alt` and `placeholder`, dialogs, and error and status messages, including the ones that live in `.ts` files today (for example `useStickers`' messages and the export errors). File names stay English and untranslated. Language names show in their own language ("English", "Română") in both. A test parses every `.tsx` file under `src/ui/` and `src/App.tsx` and fails on JSX text with a letter in it, or on a string literal in one of those attributes. A short allow-list holds what isn't language (for example "×", "%", "px"); each entry says why.
- **AC-26** The English and Romanian catalogs have exactly the same keys, and every message with a placeholder (`{count}`, `{size}`…) has the same placeholders in both (checked by TypeScript and by a test). Romanian uses ș and ț with a comma below (U+0219, U+021B), never the cedilla forms ş and ţ (U+015F, U+0163); a test checks the catalog. Plurals follow `Intl.PluralRules` for the language.
- **AC-27** Given Romanian, then every screen (Library, selection mode, ⋯ menu, dialogs, editor and its sheets, Finish screen, guides) shows no English text, which the e2e test checks with `ro-RO` by looking for every English catalog message that differs in Romanian. Numbers and sizes keep their format ("840 × 1024 px · 312 KB").

### Screens

- **AC-28** Given a 375 × 812 or a 430 × 932 screen, then the Library, selection mode and the ⋯ menu fit without the page scrolling sideways, and the grid scrolls under a fixed top bar. Every button is at least 44 × 44 px.
- **AC-29** Screenshots in light and dark, at 375 and 430 px, on Pixel 8: the Library empty, the Library with 9 stickers, selection mode with 2 ticked, and the ⋯ menu open. The existing editor screenshots are remade for the "Library" back button.

## Contract

- `src/ui/library/`: `LibraryScreen` (grid, selection mode, bar, dialogs, ⋯ menu, install card, update bar). Only the screen; the store, backups and export functions come from `services/`.
- `src/ui/i18n/`: `en.ts`, `ro.ts` (`const` catalogs; `ro` typed as `Record<keyof typeof en, string>`), `useT()` returning `t(key, params?)`, `pickLanguage(languages: readonly string[]): 'en' | 'ro'` (AC-24), `plural(lang, count, forms)`.
- `src/services/install/`: `isInstalled(env)`, `captureInstallPrompt(window)` returning `{ available(): boolean; prompt(): Promise<'accepted' | 'dismissed'>; onChange(cb) }` (AC-14, AC-15).
- `src/services/segmentation`: `prefetchModels(store, files, { saveData })` returning progress events `{ loaded, total }` and a final `'ready' | 'failed'` (AC-18, AC-19), reusing `createModelStore`'s download and check.
- `src/services/storage`: `duplicate(store, id, now)` (AC-9) and `exportSome(store, ids, now)` beside `exportAll` (AC-10).
- `src/main.tsx`: `registerSW({ onNeedRefresh })` with `registerType: 'prompt'`; `updateSW(true)` on Reload (AC-22, AC-23).
- `src/core/` gains nothing that touches the DOM; plural choice uses `Intl.PluralRules`, which is part of JavaScript.

## Data

- **Store meta (spec 0008):** `installCardClosed: true` (AC-17).
- **`localStorage`:** `peel.language` = `'auto' | 'en' | 'ro'` (Decision 12). A missing or unreadable value means `'auto'`.
- No change to the sticker record or the backup format.

## Out of scope

- Thumbnails with the Finish look (Decision 4).
- Renaming, sorting, searching or folders in the Library.
- Languages other than English and Romanian.
- Android sticker packs and iMessage sticker packs (story #104).
- Changing the deployed site's security headers (#99) and the icons and splash (#101).
