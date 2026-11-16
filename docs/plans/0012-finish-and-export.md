# Finish and Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish a sticker (outline, edge softness, padding), choose one of three outputs, and get it out of the app with Share, Copy or Download. iPhone users get a guide to "Add Sticker".

**Architecture:**
- **Pure (`src/core/sticker/`):**
  - the Finish settings with their defaults and a reader that repairs bad values;
  - the output pipeline `finishImage` and `outputSize`;
  - the size-budget loop;
  - the download file names.
- **Encoding:**
  - PNG with our encoder (spec 0004);
  - WebP with `@jsquash/webp` (libwebp in WebAssembly), loaded by dynamic import the first time WhatsApp-style is made.
- **Render worker:**
  - two newest-wins jobs, `finish` (the file) and `finishPreview` (the Sticker output shown for Original);
  - the handler may now reply asynchronously;
  - the worker keeps the last trimmed cutout, so a change of outline or padding doesn't render the 12 MP mask again.
- **UI:**
  - a `FinishScreen` over the editor, which stays mounted underneath, so "Back" finds it as it was;
  - an `exportActions` service with feature detection;
  - an `AddStickerGuide`.
- **Storage:** Finish settings ride on the sticker record and the backup manifest.

**Tech Stack:** TypeScript (strict), React 19, Vitest + RTL (jsdom), Playwright. **New dependency:** `@jsquash/webp` 1.5.0 (Apache-2.0) with `wasm-feature-detect` (Apache-2.0); the product owner approved it on 2026-11-16 (spec 0012 Decision 1).

**Spec:** `docs/specs/0012-finish-and-export.md` (story #81; #82–#85)

## Global Constraints

- **Purity:** `src/core/` has no DOM, React or browser imports or globals (core tests use `Date.now()`, not `performance`). Pixel work runs in the render worker, never on the main thread (AC-7).
- **Numbers, from the spec:**
  - Sticker: long side ≤ 1024.
  - WhatsApp-style: exactly 512 × 512, content inside 480 × 480, odd margin pixel to the right or bottom.
  - Budget: 102,400 bytes, at qualities `[90, 80, 70, 60, 50, 40]`, with `alpha_quality` 100.
  - Outline: `widthPct` 1–6 (step 0.5, default 3), colour `white` (255, 255, 255) or `black` (0, 0, 0), off by default.
  - Padding: `paddingPct` 0–20 (step 1, default 0).
  - Edge softness: feather 0–3 (step 0.25).
  - Preview: at most one update every 150 ms while dragging.
  - "Copied": shown for 2 s.
  - Download links: revoked after 30 s.
  - Speed (AC-7, Node): Sticker < 1.5 s; Original with outline < 6 s.
- **Copy is exact** (spec 0012):
  - **Buttons:** "Done", "Back", "Save"/"Saved", "Share", "Copy", "Copied", "Download", "How to add to iPhone Stickers".
  - **Output:** a radiogroup "Output" with the radios "Sticker", "Original", "WhatsApp-style".
  - **Outline:** a switch "Outline", a range "Width" ("Width N%"), and a radiogroup "Outline colour" with "White" and "Black".
  - **Sliders:** a range "Edge softness" ("Softness N px") and a range "Padding" ("Padding N%").
  - **File line:** "PNG · W × H px · N KB" (or "WEBP · …"), and "Preparing…".
  - **Errors:**
    - "This sticker is too detailed for WhatsApp-style (over 100 KB). Try the Sticker output."
    - "Couldn't load the WebP encoder. Connect to the internet and try again."
    - "Couldn't share. Try Download instead."
    - "Couldn't copy. Try Share or Download instead."
    - "Nothing is selected yet." (an empty mask)
  - **The guide:** AC-19's text, word for word.
- **KB** in the file line is `Math.max(1, Math.round(bytes / 1024))`.
- **File names** (AC-16) use local time: `peel-sticker-YYYY-MM-DD-HHMM[-original].png` and `…-whatsapp.webp`.
- **Process:**
  - Test names are `should_...` with the spec 0012 AC id.
  - jsdom has no 2D canvas and no WebAssembly encoder: components get fake renderers; the real encoder is tested in Node (Task 2) and in Playwright (Task 8).
  - Coverage: `src/core/` ≥ 90%, overall ≥ 75%.
- **Git:** branch `feat/81-finish-and-export`; one commit per task (Conventional Commits, `Refs #N`); the PR closes #81–#85.

## Review Focus

1. **A tap on Share after a change, before the new file is ready.** The buttons are disabled until the file for the current settings exists. A tap never shares the older file (Task 6: the file carries the settings it was made from, and Share checks them against the current ones).
2. **A huge photo with the outline on, in the Original output.** `addOutline`'s distance field must not hold 8 bytes per pixel (100 MB at 12 MP): it moves to `Float32Array`, with identical output (Task 1).
3. **A selection whose mask is empty** (only subtract rings, or everything erased). "Done" is enabled because a ring exists, so the Finish screen shows "Nothing is selected yet." and every action stays disabled. Nothing throws (Tasks 3 and 5).
4. **Reopening a sticker saved before this story, or importing an old backup.** There is no `finish` field: the defaults are used, and saving again writes the field (Task 4).
5. **Leaving the Finish screen or picking a photo while a file is being made.** A late result never shows on the editor or on another photo's Finish screen (Task 5: results are matched to the request that asked for them).

---

### Task 1: Output specs and pipeline (#83)

**Files:**
- Create: `src/core/sticker/specs.ts`, `src/core/sticker/budget.ts`, `src/core/sticker/index.ts`, with tests next to them, and `src/core/sticker/specs.perf.test.ts`
- Modify: `src/core/mask/outline.ts` (the distance field becomes `Float32Array`)

**Interfaces:**
- Produces, from `src/core/sticker`:
  - `OutputKind`, `FinishSettings`, `DEFAULT_FINISH`, as in the spec's Contract.
  - `readFinish(raw: unknown): FinishSettings`: each bad or missing field gets its default; numbers are clamped to their range and snapped to their step.
  - `sameFinish(a: FinishSettings, b: FinishSettings): boolean`.
  - `finishImage(cutout: RgbaImage, settings: FinishSettings): RgbaImage` (AC-1 to AC-4). `cutout` is already trimmed.
  - `outputSize(cutoutSize: Size, settings: FinishSettings): Size`. It equals `finishImage`'s size; tested on ten random cases.
  - `OUTPUT_MIME: Record<OutputKind, 'image/png' | 'image/webp'>`.
  - `finishFileName(now: Date, kind: OutputKind): string`.
  - `TooLargeError`; `encodeWithinBudget(encode, budgetBytes, qualities)`; `WHATSAPP_BUDGET_BYTES = 102_400`; `WHATSAPP_QUALITIES = [90, 80, 70, 60, 50, 40]`.

- [ ] **Step 1: Write the failing tests** in `specs.test.ts` and `budget.test.ts`:
  - `should_build_the_output_in_order (AC-1)`:
    - On a 100 × 50 opaque red rectangle with outline 4% white and padding 10%, using Sticker:
      - the size is 128 × 78: the outline reaches 4 px out (alpha > 0 up to d = 4), so 108 × 58 after trim, plus 10 px of padding per side;
      - pixel (0, y) is transparent padding;
      - the first outline pixel is white with alpha 255;
      - the centre is red, unchanged.
    - Swapping the order of outline and padding would leave the outline at the edge, which this catches.
  - `should_fit_the_sticker_in_1024 (AC-2)`:
    - A 4000 × 1000 cutout with outline 3% and padding 5%: the long side is 1024 ± 1 and the aspect ratio is within 1 px.
    - A 300 × 200 cutout: its size is unchanged (never enlarged).
  - `should_keep_the_full_size_for_original (AC-3)`: a 3000 × 2000 cutout, outline off and padding 0, comes back byte-identical.
  - `should_pad_whatsapp_to_512 (AC-4)`:
    - The output is 512 × 512.
    - The bounding box of alpha > 0 lies inside [16, 496) on both axes.
    - For an odd leftover, the right margin is the one with 1 px more than the left.
  - `should_read_bad_finish_values_as_defaults (Data)`: `readFinish({ output: 'gif', outline: { on: 'yes', widthPct: 99 }, paddingPct: -3 })` gives output `sticker`, outline off, width 6, padding 0. `readFinish(undefined)` equals `DEFAULT_FINISH`.
  - `should_name_files_in_local_time (AC-16)`: for `new Date(2026, 10, 16, 9, 5)`:
    - Sticker gives `peel-sticker-2026-11-16-0905.png`;
    - Original gives `peel-sticker-2026-11-16-0905-original.png`;
    - WhatsApp-style gives `peel-sticker-2026-11-16-0905-whatsapp.webp`.
  - `should_try_qualities_until_the_file_fits (AC-5)`:
    - With a fake encoder giving `quality × 2000` bytes: the result is the 100,000-byte file, after the tries 90, 80, 70, 60 and 50.
    - With a fake always over budget: rejects with `TooLargeError`.
  - `should_keep_the_outline_identical_with_a_float32_field (Review Focus 2)`: a golden check. Before changing `outline.ts`, run `addOutline` on three fixtures (a disc, a donut, a 2 px line) at widths 1.5, 4 and 9, and store the SHA-256 of each result in the test. The test then asserts those hashes.
- [ ] **Step 2: Run** `npx vitest run src/core/sticker src/core/mask/outline` — expected: FAIL (module not found; the golden test passes until Step 3 changes the field).
- [ ] **Step 3: Implement.**
  - **`finishImage`:** scale with `resizeRgba` (skip it when s = 1, to avoid a copy), outline with `addOutline`, trim with `cropRgba(…, trimBounds(alphaOf(img), 0))`, then pad by `cropRgba` with bounds grown by the padding.
  - **WhatsApp-style:** after those four steps, scale to fit 480 × 480 (never enlarging), then centre on a 512 × 512 transparent image.
  - **`outline.ts`:** only the `dist` buffer changes type (`Float32Array`; `FAR` stays 1e20).
- [ ] **Step 4: Write `specs.perf.test.ts`** (`should_make_outputs_within_budget (AC-7)`):
  - The fixture is a 4000 × 3000 image whose left half is opaque with a wavy edge.
  - Time the pure pipeline plus `encodePng`, using `services/deflate`'s Node `CompressionStream`.
  - Sticker must take < 1500 ms; Original with outline 3% < 6000 ms.
  - Run it alone: `npm run test:perf -- src/core/sticker`.
- [ ] **Step 5: Run** `npx vitest run src/core` and the perf test. Expected: PASS. Commit: `feat(core): sticker outputs, size budget and file names (spec 0012)` with `Refs #83`.

### Task 2: WebP encoder (#83)

**Files:**
- Modify: `package.json` (`@jsquash/webp` 1.5.0, exact version), `docs/licenses.md` (both packages, as "runtime (WhatsApp-style WebP, spec 0012; its wasm is loaded lazily, never in the initial bundle)"), and `vite.config.ts` (`optimizeDeps.exclude: ['@jsquash/webp']`, if the dev server needs it)
- Create: `src/services/webp/webpEncoder.ts`, `src/services/webp/index.ts`, `src/services/webp/webpEncoder.test.ts`

**Interfaces:**
- Produces:
  - `type WebpEncode = (image: RgbaImage, quality: number) => Promise<Uint8Array>`.
  - `class EncoderUnavailableError extends Error`.
  - `loadWebpEncoder(init?: () => Promise<unknown>): Promise<WebpEncode>`:
    - it `import()`s `@jsquash/webp/encode` once and caches the promise;
    - a failure clears the cache (so the next call retries, AC-6) and rejects with `EncoderUnavailableError`;
    - it encodes with `{ quality, alpha_quality: 100, method: 4, lossless: 0 }`.

- [ ] **Step 1: Write the failing tests:**
  - `should_encode_a_valid_webp_with_alpha (AC-4)`:
    - In Node, compile `node_modules/@jsquash/webp/codec/enc/webp_enc.wasm` with `WebAssembly.compile(readFileSync(…))` and pass `() => init(module)`.
    - The bytes start with `RIFF`, have `WEBP` at offset 8, and contain a `VP8L` or `ALPH` chunk (alpha kept).
  - `should_fit_a_busy_512_sticker_in_100kb (AC-5)`: a 512 × 512 image of seeded random noise, with a 16 px transparent margin, through `encodeWithinBudget` with the real encoder. The result is ≤ 102,400 bytes.
  - `should_retry_after_a_failed_load (AC-6)`: an `init` that rejects once, then resolves. The first call rejects with `EncoderUnavailableError`, the second resolves.
- [ ] **Step 2: Run** `npx vitest run src/services/webp` — expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Pass the image as `{ data: new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.length), width, height } as ImageData`. Return `new Uint8Array(arrayBuffer)`.
- [ ] **Step 4: Run** the tests, then `npm run build`. Check that the WebP wasm and its JS are separate chunks, not in `index-*.js`: `grep -L jsquash dist/assets/index-*.js` must list the file. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: lazy WebP encoder for WhatsApp-style stickers (spec 0012)` with `Refs #83`.

### Task 3: Finish jobs in the render worker (#83)

**Files:**
- Modify: `src/workers/protocol.ts`, `src/workers/newestWins.ts`, `src/workers/wire.ts`, `src/workers/renderHandler.ts`, `src/services/workerClient.ts`, `src/ui/editor/session.ts` (`Renderer` gains two methods)
- Test: `newestWins.test.ts`, `wire.test.ts`, `renderHandler.test.ts`, `workerClient.test.ts`

**Interfaces:**
- Consumes: Task 1's `finishImage`, `OUTPUT_MIME`, `encodeWithinBudget`, `TooLargeError`; Task 2's `loadWebpEncoder`, `EncoderUnavailableError`; `encodePng`; `services/deflate`.
- Produces:
  - `Handler` may return `Reply | Promise<Reply> | undefined`. `newestWins` posts a promise's reply when it settles, and a rejection becomes the `error` reply, as `wire.ts` does for a throw.
  - `ToRenderWorker` gains `{ type: 'finish' | 'finishPreview'; jobId; imageId; selection: Selection; settings: FinishSettings }`.
  - `FromRenderWorker` gains:
    - `{ type: 'finished'; jobId; bytes: Uint8Array; mime: 'image/png' | 'image/webp'; width; height }`, with `bytes.buffer` transferred;
    - `{ type: 'finishFailed'; jobId; reason: 'empty' | 'tooLarge' | 'encoderUnavailable' }`.
  - `createRenderHandler(deps?: { deflate?: Deflate; loadWebp?: () => Promise<WebpEncode> })`, with the real ones as defaults.
  - Client and `Renderer` methods `finish(imageId, selection, settings)` and `finishPreview(imageId, selection, settings)`, resolving to `FromRenderWorker | Cancelled`.

- [ ] **Step 1: Write the failing tests:**
  - `should_post_an_async_reply_when_it_settles` and `should_post_an_error_when_an_async_job_rejects` (newestWins and wire).
  - `should_finish_a_sticker_png (AC-2)`: the handler with a 40 × 20 image and a square ring. The reply is `finished`, `image/png`, with the width and height of `outputSize` on the trimmed cutout. The bytes decode (Node `zlib.inflateSync` of the IDAT data) to the pixels of `finishImage`.
  - `should_report_an_empty_cutout (Review Focus 3)`: a selection whose only ring is subtract gives `finishFailed` with reason `empty`.
  - `should_report_too_large_and_unavailable (AC-5, AC-6)`:
    - with `loadWebp` resolving to an encoder that always returns 200 KB, the reason is `tooLarge`;
    - with `loadWebp` rejecting with `EncoderUnavailableError`, the reason is `encoderUnavailable`.
  - `should_render_the_mask_once_for_settings_changes (AC-7)`: spy on the render through an injected `render` dep. Three `finish` jobs with the same selection and different padding render it once. A changed feather renders it again.
  - `should_keep_finish_and_preview_apart (AC-9)`: in the client, a `finishPreview` request doesn't cancel a pending `finish`.
- [ ] **Step 2: Run** `npx vitest run src/workers src/services/workerClient` — expected: FAIL.
- [ ] **Step 3: Implement.**
  - The handler keeps the last cutout: `{ imageId, key: serializeSelection(selection, size), cutout }`. It uses the current refiner, as `render` does.
  - It makes the file from that cutout.
  - It maps `EmptyMaskError`, `TooLargeError` and `EncoderUnavailableError` to `finishFailed`.
  - `setImage` and `setModelAlpha` clear the cache.
- [ ] **Step 4: Run** the tests. Expected: PASS. Run `npm test`: green.
- [ ] **Step 5: Commit:** `feat(workers): finish jobs with async replies (spec 0012)` with `Refs #83`.

### Task 4: Finish settings saved with the sticker (#82)

**Files:**
- Modify:
  - `src/core/backup/types.ts` and `format.ts` (`finish?` on the record and on the manifest line);
  - `src/services/storage/stickerStore.ts` (`finish?` on the row);
  - `src/ui/editor/useStickers.ts` (`SaveSnapshot.finish`; `saved` also compares the Finish settings with `sameFinish`);
  - `src/ui/editor/session.ts` (the snapshot carries the current settings, set through a new `setFinish(settings)`; `reopen` returns the record's `readFinish(record.finish)`).
- Test: `format.test.ts`, `stickerStore.test.ts`, `EditorScreen.stickers.test.tsx`

**Interfaces:**
- Consumes: Task 1's `FinishSettings`, `readFinish`, `sameFinish`, `DEFAULT_FINISH`.
- Produces: `StickerRecord.finish?: FinishSettings`; `session.setFinish(s: FinishSettings): void`; `session.reopen(...)` resolves to `{ photo, finish }`. EditorScreen keeps `finish` state and passes it to `session.setFinish`.

- [ ] **Step 1: Write the failing tests:**
  - `should_store_and_read_back_the_finish (AC-11)`: the store saves a record with `finish` and `get` returns it.
  - `should_back_up_and_import_the_finish (AC-11, Data)`: in the backup, the round trip keeps `finish`. An old manifest without it imports with no `finish`, and `readFinish` gives the defaults.
  - `should_save_the_finish_and_mark_changes_unsaved (AC-11)`, an EditorScreen test:
    - set Padding 10 on the Finish screen (Task 5 adds the screen; until then, call `session.setFinish` through the test's fake host);
    - Save: the stored record has `finish.paddingPct === 10`;
    - change the width: the button says "Save" again;
    - reopen the sticker: padding is 10.
- [ ] **Step 2: Run** `npx vitest run src/core/backup src/services/storage src/ui/editor/EditorScreen.stickers.test.tsx` — expected: FAIL.
- [ ] **Step 3: Implement.** The manifest line writes `finish` only when present. Parsing goes through `readFinish`, and a bad `finish` never rejects a sticker.
- [ ] **Step 4: Run.** Expected: PASS; `npm test` green.
- [ ] **Step 5: Commit:** `feat: save finish settings with the sticker (spec 0012)` with `Refs #82`.

### Task 5: The Finish screen (#82)

**Files:**
- Create: `src/ui/finish/FinishScreen.tsx`, `FinishScreen.css`, `useFinishOutput.ts`, `FinishScreen.test.tsx`
- Modify: `src/ui/editor/EditorScreen.tsx` ("Done" in the top bar; renders `FinishScreen` while finishing and marks the editor `inert`), `EditorScreen.css`

**Interfaces:**
- Consumes:
  - Task 3's `Renderer.finish` / `finishPreview`;
  - Task 4's finish state and `session.setFinish`;
  - `useStickers`' panel (`onSave`, `saved`, `canSave`, `disabled`);
  - `session.edit({ type: 'setFeather', px })`.
- Produces:
  - `useFinishOutput(renderer, photoId, selection, settings)` returns `{ file: FinishedFile | null; preview: Blob | null; preparing: boolean; error: string | null }`, where `FinishedFile = { blob: Blob; name: string; width: number; height: number; settings: FinishSettings; selection: Selection }`.
  - `FinishScreen` props: `{ settings, onSettings, feather, onFeather, output: ReturnType<typeof useFinishOutput>, save: { label: 'Save' | 'Saved'; disabled: boolean; onSave }, onBack, actions: ReactNode, guide: ReactNode }`. The actions and the guide come from Tasks 6 and 7.

- [ ] **Step 1: Write the failing tests** (a fake renderer whose `finish` resolves on demand):
  - `should_open_from_done_only_with_a_ring (AC-8)`: "Done" is disabled with no ring. With a ring, it shows a region "Finish sticker" with "Back", "Save", the "Output" radiogroup (Sticker checked), the "Outline" switch (off, with Width and the colour choice disabled), "Edge softness" and "Padding".
  - `should_show_the_newest_output (AC-9)`:
    - Change the padding twice. The older `finish` resolves after the newer one, and the file line shows the newer size.
    - Drag the Width slider through 10 `input` events within 100 ms: at most one `finish` request until 150 ms pass, and one on `change`.
  - `should_preview_original_with_the_sticker_output (AC-9)`: choosing Original requests `finish` with `output: 'original'` and `finishPreview` with `output: 'sticker'`. The file line shows the Original's size.
  - `should_show_slider_values (AC-10)`: "Width 3%", "Softness 0 px", "Padding 0%". Releasing Edge softness at 1.5 calls `setFeather` once with 1.5, and Undo in the editor brings back 0.
  - `should_keep_settings_for_a_new_photo (AC-12)`: set outline on, pick another photo, and it's still on. Re-render the app (reload) and it's back to the defaults.
  - `should_show_preparing_and_errors (AC-17, AC-5, AC-6, Review Focus 3)`:
    - while `finish` is pending, the file line says "Preparing…";
    - `finishFailed` maps to the error texts: `tooLarge` and `encoderUnavailable` to theirs, `empty` to "Nothing is selected yet.".
  - `should_ignore_a_late_result_after_back (Review Focus 5)`: go Back while `finish` is pending, then let it resolve; reopen Finish for another photo. The file line never shows the first photo's size.
- [ ] **Step 2: Run** `npx vitest run src/ui/finish src/ui/editor/EditorScreen` — expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Preview:** an `<img>` of an object URL (revoked when it's replaced and on unmount), over an 8 px checkerboard drawn in CSS.
  - **Throttle:** a 150 ms leading-and-trailing throttle on settings changes while a slider is dragged. The trailing request always uses the latest settings.
  - **Layout (AC-20):** a 100dvh flex column; the preview `flex: 1 1 40%` with `min-height: 40dvh`; the controls `overflow-y: auto`.
- [ ] **Step 4: Run.** Expected: PASS; `npm test`, typecheck and lint green.
- [ ] **Step 5: Commit:** `feat(ui): finish screen with outline, softness, padding and output (spec 0012)` with `Refs #82`.

### Task 6: Share, Copy and Download (#84)

**Files:**
- Create: `src/services/export/exportActions.ts`, `index.ts`, `exportActions.test.ts`; `src/ui/finish/ExportActions.tsx`, `ExportActions.test.tsx`

**Interfaces:**
- Consumes: Task 5's `FinishedFile`; Task 1's `finishFileName`, `OUTPUT_MIME`.
- Produces:
  - `canShareType(nav: Pick<Navigator, 'canShare'> | undefined, mime: string): boolean`. It probes with `new File([ONE_PIXEL[mime]], 'probe', { type: mime })`, where `ONE_PIXEL` holds a valid 1 × 1 PNG and WebP as byte constants.
  - `canCopyPng(env: { clipboard?: Pick<Clipboard, 'write'>; ClipboardItem?: { supports?: (t: string) => boolean } }): boolean`.
  - `shareFile(nav, file: File): Promise<'shared' | 'cancelled'>`. It rejects on other errors.
  - `copyPng(clipboard, blob: Blob): Promise<void>`.
  - `downloadBlob(blob: Blob, name: string, doc = document, revokeAfterMs = 30_000): void`.

- [ ] **Step 1: Write the failing tests:**
  - `should_show_share_only_when_files_can_be_shared (AC-14)`: with no `canShare`, false. With a `canShare` that returns false for WebP, true for a PNG output and false for WhatsApp-style.
  - `should_show_copy_for_png_where_supported (AC-15)`:
    - with no `ClipboardItem`, false;
    - with `ClipboardItem` and no `supports`, true;
    - with `supports` returning false, false;
    - for WhatsApp-style, Copy is never shown.
  - `should_share_at_once_with_the_ready_file (AC-14, Review Focus 1)`:
    - clicking Share calls `navigator.share` synchronously within the click handler: the spy records before any `await` resolves;
    - it's called with one `File` named by `finishFileName`;
    - when the file's settings differ from the current ones, Share is disabled;
    - an `AbortError` shows nothing; another error shows "Couldn't share. Try Download instead.".
  - `should_copy_and_say_copied (AC-15)`: "Copied" shows, then goes after 2 s (fake timers). A failure shows its text.
  - `should_download_with_the_spec_name (AC-16)`: a link click with `download = 'peel-sticker-…-whatsapp.webp'`, revoked after 30 s.
  - `should_disable_actions_while_preparing (AC-13, AC-17)`: the order is Share, Copy, Download, and all are disabled while preparing.
- [ ] **Step 2: Run** `npx vitest run src/services/export src/ui/finish` — expected: FAIL.
- [ ] **Step 3: Implement.** The click handlers call `share`/`clipboard.write` before any `await`. Detection runs once per mime, at mount.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: share, copy and download with feature detection (spec 0012)` with `Refs #84`.

### Task 7: The iPhone "Add to Stickers" guide (#85)

**Files:**
- Create: `src/ui/finish/AddStickerGuide.tsx`, `AddStickerGuide.test.tsx`, and `src/ui/finish/device.ts` (`isAppleTouch(ua: string, maxTouchPoints: number): boolean`)
- Modify: `FinishScreen.tsx`, to place the guide and pass whether Share is shown

**Interfaces:**
- Consumes: Task 6's `canShareType`.
- Produces: `AddStickerGuide` props `{ shareShown: boolean; initiallyOpen: boolean }`. EditorScreen keeps a session-only `guideSeen` ref, so the guide is open on the first Finish screen of a session only.

- [ ] **Step 1: Write the failing tests:**
  - `should_detect_iphone_and_ipad (AC-18)`:
    - iPhone, iPad and iPod user agents are true;
    - `Macintosh` with 5 touch points is true, with 0 is false;
    - Android and Windows are false.
  - `should_open_the_guide_the_first_time (AC-18)`: the first Finish screen shows the guide open, with `aria-expanded="true"`. After Back and Done again, it's closed. The button toggles it.
  - `should_say_the_steps (AC-19)`: the five list items, with the exact text, and the closing sentence.
  - `should_use_download_steps_without_share (AC-19)`: with `shareShown` false, steps 1 and 2 have the Download wording.
  - `should_hide_the_guide_elsewhere (AC-18)`: on an Android user agent, there's no "How to add to iPhone Stickers" button.
- [ ] **Step 2: Run** `npx vitest run src/ui/finish` — expected: FAIL.
- [ ] **Step 3: Implement.** Use a button with `aria-expanded` and `aria-controls`, and an `<ol>`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(ui): iPhone add-to-stickers guide (spec 0012)` with `Refs #85`.

### Task 8: End to end, screenshots and docs (#81–#85)

**Files:**
- Create: `e2e/finish.spec.ts`, `e2e/helpers/finish.ts` (`openFinish(page)`: `seedAndOpen`, then tap "Done")
- Modify:
  - `e2e/editor-screens.spec.ts`: add `should_match_the_finish_screen (spec 0012 AC-21)` through `eachScreen`, as `finish-off` and `finish-on`. Delete every committed baseline whose image shows the top bar, since "Done" is new; CI remakes them.
  - `docs/decisions.md`: a section "Finish and export decisions (spec 0012)".
  - `STICKER_WEBAPP_PLAN.md`: tick Phase 9's Finish and Export lines, and in the guide line tick only the "Add to Stickers" part.
  - `docs/device-test-log.md`: create it with the #85 real-iPhone checklist, to fill in after merge.

- [ ] **Step 1: Write the tests**, in every project unless they say otherwise:
  - `should_download_a_sticker_png (AC-2, AC-16)`:
    - Download Sticker; the suggested name matches `/^peel-sticker-\d{4}-\d{2}-\d{2}-\d{4}\.png$/`.
    - Decode the file in the page with `createImageBitmap`: the long side is ≤ 1024, and an inside pixel has alpha 255.
  - `should_download_a_whatsapp_webp (AC-4, AC-5)`: the file is ≤ 102,400 bytes and decodes to 512 × 512 in the page (WebKit included), with a transparent corner.
  - `should_share_the_file_where_supported (AC-14)`: an `addInitScript` stubs `navigator.canShare` and `navigator.share`, the latter recording `files[0].type` and `.name`. Tap Share: it was called once with `image/png`. Without the stub, Share is hidden in Desktop Chrome.
  - `should_show_the_guide_on_iphone_only (AC-18)`: visible in iphone-15, absent in pixel-8 and desktop-chrome.
  - `should_fit_the_finish_screen (AC-20)`: at 375 × 812 and 430 × 932, `scrollWidth <= clientWidth`, and the preview's height is ≥ 40% of the viewport.
  - `should_go_back_with_everything_as_it_was (AC-8)`: zoom in, then Done, Back: `canvasInfo(page).displayScale` is unchanged.
- [ ] **Step 2: Run** `npm run build && npx playwright test e2e/finish.spec.ts --workers=2`. Expected: PASS (the screenshots are made by CI).
- [ ] **Step 3: Run** the whole local gate: typecheck, lint, format:check, `npm test`, `npx playwright test --workers=2`. Expected: all green except screenshot baselines that don't exist yet.
- [ ] **Step 4: Write the docs**, with one decisions bullet per spec Decision, plus each ledger Ruling that changed behaviour.
- [ ] **Step 5: Commit:** `test(e2e): finish and export flows, screenshots; docs (spec 0012)` with `Refs #81`.
