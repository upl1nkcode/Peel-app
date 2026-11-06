# Auto cutout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a subject cuts it out on the phone: Tap v1 gives a result in about a second, Tap v2 then replaces it with a sharper one, the result becomes the shared selection (dots plus a model soft edge), and it all works offline after one download.

**Architecture:** `src/core/segmentation/` holds the pure parts: inference size, bilinear upscale, combining single-tap masks, taps to v2 strokes, and mask to auto selection. Each engine runs in its own module worker (`segmentation.worker.ts`). Its handler does the per-tap work against an `InferenceBackend`: MediaPipe in production, a fake in unit tests. On the main thread, `modelStore.ts` downloads, checks and caches the files, `workerEngine.ts` implements `SegmentationEngine` over a worker, and `autoCutout.ts` runs fast-then-precise against the selection history. A Vite plugin serves the engine and model files and writes their manifest. A temporary React screen ties it together for phone testing.

**Tech Stack:** TypeScript 6.0 (strict), React 19, Vitest 5 + RTL, Playwright, Vite module workers, vite-plugin-pwa (Workbox). New runtime dependency: `@mediapipe/tasks-vision@1.2.2` (Apache-2.0).

**Spec:** `docs/specs/0007-auto-cutout.md` (story #45; #46–#51)

## Global Constraints

- `src/core/` has no DOM, React or browser imports or globals. Coordinates are image px floats; pixel (i, j) is centred at (i + 0.5, j + 0.5). Variables are named `screenPt` / `canvasPt` / `imagePt`.
- Constants: `INFERENCE_LONG_SIDE_PX = 1024`, `AUTO_BAND_PX = 8`, `LONG_PRESS_MS = 500`, `PRESS_SLOP_PX = 10`, fake engine disc radius 20 px, Pages file limit 25 MiB (parts are cut at 24 MiB), cache name `peel-models-v1`.
- Status copy is exact, from the spec: "Downloading cutout model: X of Y MB" (one decimal, MB = 10⁶ bytes), "Cutting out…", "Sharpening…", "Sharper cutout ready", "Sharper cutout not available on this device", "Nothing found there. Tap on the subject.", and AC-20's four reasons plus the button "Use Lasso".
- MediaPipe runs on the CPU delegate only (decision 6). Engine and model files are fetched only by `modelStore` and only after the first Auto use (AC-19).
- Test names `should_...` with the AC id. Timing tests go in `*.perf.test.ts`. Real-model e2e tests run only in the `desktop-chrome` project. Coverage: `src/core/` ≥ 90%, overall ≥ 75%.
- Branch `feat/45-auto-cutout`; one commit per task (Conventional Commits, `Refs #N`); the PR closes #45–#51.

## Spec corrections made with this plan

The spec's contract is updated in this PR:

- `SegmentationEngine.segment` returns `{ alpha: AlphaMask; selection: Selection | null }` instead of a `CoverageMask`. Tracing 12 MP into rings takes ~135 ms, and the full-size coverage is 48 MB, so both happen in the worker. Only the 12 MB alpha and the rings are sent back.
- `SegmentationEngine` gains `readonly files: readonly ModelFile[]`, so the controller can total the bytes still to download before the first byte (AC-16).
- The render worker gains `{ type: 'setModelAlpha'; imageId; modelAlpha }`, so a new auto result doesn't re-send the photo.

## Review Focus

1. **Taps during download:** a tap before the fast engine is ready is queued (only the newest tap set is kept) and runs when it loads. It is not lost, and it doesn't error (Task 6).
2. **A new photo while a run is in flight:** results tagged with an old `imageId` are dropped, and the auto target and taps reset (Tasks 4 and 6).
3. **Tiny and extreme-aspect photos:** 1 × 1, 1 × 3000 and 3000 × 1 photos give an inference size of at least 1 × 1, and the upscaled mask has exactly the photo's size (Task 1).
4. **The download stops halfway** (fetch rejects mid-stream): nothing partial is cached, the status reports the download reason, and a later retry starts that file from zero (Task 3).
5. **Remove taps only, or a remove tap on nothing:** the mask is all zero and the status reads "Nothing found there…", with no exception (Tasks 1 and 6).

---

### Task 1: Pure segmentation core (#47, #48, #49)

**Files:**
- Create: `src/core/segmentation/{types.ts,inference.ts,combine.ts,strokes.ts,index.ts}`, `src/core/segmentation/inference.perf.test.ts`
- Test: `src/core/segmentation/{inference,combine,strokes}.test.ts`

**Interfaces:**
- Consumes: `CoverageMask`, `fromAlphaMask` (`src/core/contour`), `resizeRgba`, `RgbaImage`, `AlphaMask`, `toAlphaMask` (`src/core/mask`), `Size`, `Point`.
- Produces: `Tap { imagePt: Point; mode: 'add' | 'remove' }`; `Stroke { mode: 'positive' | 'negative'; x: number; y: number }`; `INFERENCE_LONG_SIDE_PX`; `inferenceSize(size: Size): Size`; `inferenceImage(image: RgbaImage): RgbaImage` (the same object when already small enough); `upscaleMask(mask: CoverageMask, size: Size): CoverageMask`; `combineTapMasks(adds, removes, size): CoverageMask`; `tapsToStrokes(taps, size): Stroke[]`; `checkTaps(taps, size): void` (the `RangeError` of AC-2).

- [ ] **Step 1: Write the failing tests**
  - `should_downscale_the_long_side_to_1024 (AC-5)`: 4032×3024 → 1024×768; 3024×4032 → 768×1024; 1000×1000 → itself, and `inferenceImage` returns the same object; 3000×1 → 1024×1; 1×1 → 1×1. The pixels equal `resizeRgba`'s.
  - `should_upscale_2x_bilinearly (AC-6)`: `[0, 1]` (2×1) → 4×1 `[0, 0.25, 0.75, 1]`. A 2×2 `[0, 1; 1, 1]` → 4×4, compared cell by cell with hand values (corner 0, edge clamped).
  - `should_keep_the_50_percent_line_when_upscaling (AC-7)`: for (src, dst) in {(100, 200), (1024, 4032), (768, 3024), (1024, 1000)}, with a vertical step at s = 37 and a horizontal one, the linear-interpolated 0.5 crossing of each output row lies within 0.01 px of `37 × dst / src`. A constant 0.3 mask stays 0.3 everywhere.
  - `should_combine_add_and_remove_taps (AC-3)`: per-pixel `max(adds) × (1 − max(removes))` on 3×1 masks (e.g. adds [0.2, 0.9, 0.5] and [0.6, 0.1, 0.5], remove [0, 0.5, 1] → [0.6, 0.45, 0]). No adds → all zero.
  - `should_turn_taps_into_normalised_strokes (AC-9)`: taps at (0, 0) add, (50, 25) remove, (99.5, 49.5) add on 100×50 → `[{positive, 0, 0}, {negative, 0.5, 0.5}, {positive, 0.995, 0.99}]`, in order.
  - `should_refuse_taps_outside_the_image (AC-2)`: x = width, y = −0.1, NaN and Infinity each throw `RangeError`; x = width − 1e−9 is accepted.
- [ ] **Step 2: Run** `npx vitest run src/core/segmentation` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** In `upscaleMask`, the source coordinate of output pixel x is `u = (x + 0.5) × src / dst − 0.5`, clamped to [0, src − 1]. Precompute per-axis index/weight tables, then interpolate rows and columns separably. `inferenceSize` scales the long side to 1024, and the short side is `max(1, round(short × 1024 / long))`.
- [ ] **Step 4: Write** `should_prepare_and_finish_a_12mp_photo_quickly (AC-8)` in `inference.perf.test.ts`: on a 4032×3024 image, time `inferenceImage` + `upscaleMask(1024×768 → 4032×3024)` + `autoSelection` (Task 2; mark this test `skip` until Task 2 lands) under 600 ms, best of 3.
- [ ] **Step 5: Run** the Step 2 command, then `npm run lint` and `npm run typecheck` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(core): inference size, mask upscale and tap combination` (Refs #47 #48 #49)

---

### Task 2: Auto selection, restore and press (#51, spec AC-13, AC-14, AC-25)

**Files:**
- Create: `src/core/segmentation/autoSelection.ts`, `src/core/gestures/press.ts`
- Modify: `src/core/selection/{types.ts,commands.ts,serialize.ts}` (extract `checkSelection`), `src/core/segmentation/index.ts`
- Test: `src/core/segmentation/autoSelection.test.ts`, `src/core/gestures/press.test.ts`, `src/core/selection/commands.test.ts`, `src/core/history/history.test.ts`

**Interfaces:**
- Consumes: `maskToRings` (`src/core/contour`), `applyCommand`, `createHistory`.
- Produces: `AUTO_BAND_PX = 8`; `autoSelection(mask: CoverageMask): Selection | null`; Command `{ type: 'restore'; selection: Selection }`; `checkSelection(value: unknown, path?: string): Selection` (shared with `parseSelection`); `LONG_PRESS_MS`, `PRESS_SLOP_PX`, `classifyPress(down, up): 'tap' | 'longPress' | null` with `{ screenPt: Point; t: number }` arguments.

- [ ] **Step 1: Write the failing tests**
  - `should_build_the_auto_selection_from_a_mask (AC-13)`: on a soft disc mask (`softMask`/`circle` fixtures), the rings deep-equal `maskToRings(mask)`, `softEdge` is `{ source: 'model', bandPx: 8 }`, `strokes` is `[]` and `feather` is 0. An all-zero mask returns `null`.
  - `should_restore_a_selection_as_one_undoable_step (AC-14)`: history from empty, then addRing, then restore(auto) → `current` deep-equals auto; `undo()` → the addRing state; `redo()` → auto. A restore with a 2-dot ring throws `InvalidCommandError` and records nothing.
  - `should_classify_taps_and_long_presses (AC-25)`: held 499 ms and moved 10 px → `'tap'`; 500 ms and 0 px → `'longPress'`; 100 ms and 10.01 px → `null`; 900 ms and 11 px → `null`.
- [ ] **Step 2: Run** `npx vitest run src/core/segmentation src/core/gestures src/core/selection src/core/history` — Expected: FAIL.
- [ ] **Step 3: Implement.** `restore` validates with `checkSelection`, the validator `parseSelection` already uses, extracted without behaviour change (the existing serialize tests must stay green), and throws `InvalidCommandError` with its message. Un-skip the AC-8 perf test.
- [ ] **Step 4: Run** the Step 2 command, then `npx vitest run src/core/segmentation/inference.perf.test.ts` (alone) — Expected: PASS, AC-8 < 600 ms.
- [ ] **Step 5: Commit** `feat(core): auto selection, restore command and press classification` (Refs #51)

---

### Task 3: Engine contract, fake engine and model store (#46, #50)

**Files:**
- Create: `src/services/segmentation/{types.ts,fakeEngine.ts,modelStore.ts,index.ts}`
- Test: `src/services/segmentation/{fakeEngine,modelStore}.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2 core.
- Produces:
  - `ModelFile { path: string; bytes: number; sha256: string; parts?: { path: string; bytes: number }[] }` and `ModelManifest { files: Record<'engineLoader' | 'engineWasm' | 'fast' | 'precise', ModelFile> }`.
  - `EngineUnavailable extends Error { reason: 'offline' | 'download' | 'storage' | 'unsupported' }`.
  - `SegmentationEngine` (spec contract as corrected above).
  - `createFakeEngine(opts?: { name?: 'fast' | 'precise'; totalBytes?: number; failLoad?: EngineUnavailable['reason']; delayMs?: number }): SegmentationEngine`. Progress comes in 4 equal steps; discs have radius 20; `segment` resolves after `delayMs` (default 0) using `combineTapMasks`, `toAlphaMask` and `autoSelection`.
  - `createModelStore(deps: { fetch: typeof fetch; caches: Pick<CacheStorage, 'open'>; digest: (data: ArrayBuffer) => Promise<string>; online: () => boolean }): { missingBytes(files): Promise<number>; get(files, onProgress): Promise<Map<string, ArrayBuffer>> }`.

- [ ] **Step 1: Write the failing tests**
  - `should_report_rising_progress_then_segment_discs (AC-1)`: progress `[25, 50, 75, 100]` of 100, then a tap at (50, 50) on 100×100 gives alpha 255 at the centre, 0 at (75, 50) and the matching selection. With `failLoad: 'storage'`, `load` rejects `EngineUnavailable` with reason `storage`.
  - `should_refuse_segmenting_before_load_and_outside_the_image (AC-2)`: before `load`, `segment` rejects; `{x: 100}` on a 100-wide image → `RangeError`; `[]` → all-zero alpha of the image's size with selection `null`.
  - `should_download_check_and_cache_model_files (AC-16, AC-17, AC-18)`: a fake fetch streams 3 chunks. Progress only rises and ends at the file size. A second `get` makes no fetch call. A file with a wrong hash rejects `download` and leaves the cache empty. A two-part file is fetched part by part, joined, and hashed as a whole.
  - `should_name_why_the_model_is_unavailable (AC-20)`: fetch rejects with `online() === false` → `offline`; fetch rejects mid-stream while online → `download` and nothing cached; `cache.put` throws `QuotaExceededError` → `storage`. A later `get` after a failure fetches again from zero (Review Focus 4).
- [ ] **Step 2: Run** `npx vitest run src/services/segmentation` — Expected: FAIL.
- [ ] **Step 3: Implement.** Hashes are lowercase hex SHA-256. The store reads each part's `Response.body` stream and counts bytes as they arrive. It caches only the whole, checked file, under its `path`. The production `digest` is `crypto.subtle.digest('SHA-256', …)`, and `online` is `() => navigator.onLine`.
- [ ] **Step 4: Run** the Step 2 command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(services): segmentation engine contract, fake engine and model store` (Refs #46 #50)

---

### Task 4: Segmentation worker and MediaPipe backend (#47, #48)

**Files:**
- Create: `src/workers/segmentationHandler.ts`, `src/workers/mediapipeBackend.ts`, `src/workers/segmentation.worker.ts`, `src/services/segmentation/workerEngine.ts`
- Modify: `src/workers/protocol.ts`, `src/workers/renderHandler.ts` (`setModelAlpha`), `src/services/workers.ts`, `package.json`, `docs/licenses.md`
- Test: `src/workers/segmentationHandler.test.ts`, `src/workers/renderHandler.test.ts`, `src/services/segmentation/workerEngine.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `wireWorker`, `newestWins`, `createWorkerClient`.
- Produces:
  - `InferenceBackend { setImage(image: RgbaImage): void; run(strokes: readonly Stroke[]): CoverageMask /* inference size */ }`.
  - Protocol `ToSegmentationWorker = { type: 'load'; jobId; loaderJs: ArrayBuffer; wasm: ArrayBuffer; model: ArrayBuffer } | { type: 'setImage'; imageId; image: RgbaImage /* inference copy */; fullSize: Size } | { type: 'segment'; jobId; imageId; taps: Tap[] }`; replies `loaded`, `segmented { jobId; imageId; alpha; selection }`, `cancelled`, `error`.
  - `createSegmentationHandler(engine: 'fast' | 'precise', makeBackend: (engine, files: { loaderJs: ArrayBuffer; wasm: ArrayBuffer; model: ArrayBuffer }) => Promise<InferenceBackend>)`; production passes `createMediapipeBackend` from `mediapipeBackend.ts`.
  - `createWorkerEngine(name, files: readonly ModelFile[], store, startWorker: () => Port & { terminate(): void }): SegmentationEngine`.

- [ ] **Step 1: Write the failing tests** (fake backend that records `run` calls and returns a disc per positive stroke)
  - `should_run_only_the_new_tap_in_the_fast_engine (AC-4)`: segment [A], then [A, B] → 2 `run` calls in total, each with exactly one positive stroke. The second result equals a fresh handler segmenting [A, B]. A remove tap runs once and is combined as a remove mask. A new `setImage` clears the per-tap cache.
  - `should_send_all_taps_as_strokes_to_the_precise_engine (AC-9)`: [add A, remove B] → one `run` with `tapsToStrokes` output.
  - `should_return_the_mask_at_full_size (AC-2, AC-13)`: `fullSize` 200×100 with a 100×50 inference copy → alpha 200×100, and the selection is `autoSelection(upscaleMask(…))`. A segment for an old `imageId` throws `unknownImage` (Review Focus 2).
  - `should_swap_the_model_alpha_without_resending_the_photo`: render handler `setImage`, then `setModelAlpha`, then render → equals a fresh `setImage` with that model alpha.
  - `should_load_through_the_store_then_the_worker (AC-2)`: `createWorkerEngine` with a fake store and a fake port. `load` posts `load` with the three buffers transferred; `segment` before `load` rejects.
- [ ] **Step 2: Run** `npx vitest run src/workers src/services/segmentation` — Expected: FAIL.
- [ ] **Step 3: Implement.** Run `npm install @mediapipe/tasks-vision@1.2.2` and add its row to `docs/licenses.md`. `mediapipeBackend.ts` (no unit test; covered by Task 8's e2e):
  - If `typeof OffscreenCanvas === 'undefined'`, throw `unsupported`.
  - Set `self.importScripts` to a function that throws `TypeError`, so MediaPipe falls back to `import()` in a module worker.
  - The fileset is `{ wasmLoaderPath: blobURL(loaderJs, 'text/javascript'), wasmBinaryPath: blobURL(wasm, 'application/wasm') }`.
  - Fast: `InteractiveSegmenterLegacy.createFromOptions(fileset, { baseOptions: { modelAssetBuffer, delegate: 'CPU' }, outputConfidenceMasks: true, outputCategoryMask: false, canvas: new OffscreenCanvas(1, 1) })`. Then `segment(imageData, { keypoint: { x, y } })` and use the last confidence mask.
  - Precise: `InteractiveSegmenter` with the same options, `setImage(imageData)` once per image, then `segment([{ brushMode: 1 | 2, point: [{ x, y }], isCompleted: true }, …])`.
  - Copy each mask with `getAsFloat32Array()`, then `close()` it.
- [ ] **Step 4: Run** the Step 2 command, then `npm run lint`, `npm run typecheck` and `npm run build` — Expected: PASS; the build emits a `segmentation.worker` chunk.
- [ ] **Step 5: Commit** `feat(workers): segmentation worker with MediaPipe tap engines` (Refs #47 #48)

---

### Task 5: Serving engine and model files (#50)

**Files:**
- Create: `models/magic_touch.tflite`, `models/interactive_segmentation.task`, `models/README.md` (source URLs, model cards, licence, download date), `vite/peelModels.ts`, `e2e/models.spec.ts`
- Modify: `vite.config.ts` (plugin; Workbox `globIgnores: ['engine/**', 'models/**']`), `tsconfig.node.json` (include `vite`), `docs/licenses.md` (Models section)

**Interfaces:**
- Produces: at the site root, `engine/vision_wasm_module_internal.{js,wasm}` (copied from `node_modules/@mediapipe/tasks-vision/wasm/`), `models/magic_touch.tflite`, `models/interactive_segmentation.task.part1`, `.part2` (cut at 24 MiB = 25,165,824 bytes), and `models/manifest.json` (`ModelManifest`, sizes and SHA-256 computed from the files at build time). In dev, the same paths are served from memory by `configureServer` middleware.

- [ ] **Step 1: Write the failing e2e tests** (`e2e/models.spec.ts`, all projects)
  - `should_serve_every_model_file_under_the_pages_limit (AC-17)`: every file and part in the manifest returns 200 at ≤ 25 MiB. The parts' sizes sum to the file's `bytes`. The SHA-256 of the joined parts (computed in Node) equals the manifest's.
  - `should_not_fetch_engine_or_models_until_auto_is_used (AC-19)`: load `/`, wait for `navigator.serviceWorker.ready`, then wait 2 s. No request URL contains `/engine/` or `/models/`. The SW precache list (read from `sw.js`) names neither.
- [ ] **Step 2: Run** `npx playwright test e2e/models.spec.ts --project=desktop-chrome` — Expected: FAIL (404 on the manifest).
- [ ] **Step 3: Implement** `peelModels(): Plugin`. Copy the two model files from the prototype downloads (MediaPipe storage URLs are in `models/README.md`) and check their sizes: 6,227,884 and 30,525,312 bytes. Record both models (Apache-2.0, model card links) in `docs/licenses.md`.
- [ ] **Step 4: Run** the Step 2 command, then `npm run build` — Expected: PASS. `dist/` has no file over 25 MiB.
- [ ] **Step 5: Commit** `build: self-host the MediaPipe engine and tap models` (Refs #50)

---

### Task 6: Fast-then-precise controller (#47, #48, #50, #51)

**Files:**
- Create: `src/services/segmentation/autoCutout.ts`, `src/services/segmentation/status.ts`
- Test: `src/services/segmentation/autoCutout.test.ts`, `src/services/segmentation/status.test.ts`

**Interfaces:**
- Consumes: `SegmentationEngine` (fakes), `createHistory`, `restore`, a `ModelStore`-like `missingBytes`.
- Produces:
  - `AutoState { download: { loadedBytes: number; totalBytes: number } | null; phase: 'idle' | 'cutting' | 'sharpening' | 'done'; notice: 'nothingFound' | 'sharperReady' | 'preciseUnavailable' | null; unavailable: EngineUnavailable['reason'] | null; fallbackTool: 'lasso' | null; modelAlpha: AlphaMask | null }`.
  - `createAutoCutout(deps: { fast: SegmentationEngine; precise: SegmentationEngine; history: History; missingBytes(files): Promise<number>; onChange(state: AutoState): void }): { start(): Promise<void>; setImage(imageId: string, image: RgbaImage): Promise<void>; tap(tap: Tap): void; resetToAuto(): void; useLasso(): void }`.
  - `statusLines(state: AutoState): string[]` (the exact copy).

- [ ] **Step 1: Write the failing tests** (fake engines with `delayMs`, Vitest fake timers)
  - `should_show_the_fast_result_then_the_precise_one (AC-10)`: fast 10 ms and precise 100 ms. At 10 ms, `history.current` is the fast selection and the lines include "Sharpening…". At 100 ms, it is the precise selection, `phase` is `done`, and `modelAlpha` is the precise alpha.
  - `should_never_apply_a_stale_precise_result (AC-11)`: tap A, then tap B at 50 ms. The precise result for [A] is never `history.current`; the final selection is precise [A, B].
  - `should_keep_user_edits_when_the_precise_result_arrives (AC-12)`: after the fast result, execute a `moveNode`, then let the precise result arrive. `current` keeps the edit, the notice is `sharperReady`, and `resetToAuto()` then makes `current` the precise selection (AC-14).
  - `should_report_nothing_found (AC-13)`: a single remove tap leaves the selection unchanged, with notice `nothingFound` (Review Focus 5).
  - `should_fall_back_when_engines_are_unavailable (AC-15, AC-20)`: precise fails `unsupported` → the fast results are final, notice `preciseUnavailable`. Fast fails but precise works → each tap waits for precise. Both fail `offline` → `unavailable: 'offline'`, lines show the offline message and "Use Lasso", and `useLasso()` sets `fallbackTool: 'lasso'`.
  - `should_total_the_download_before_the_first_byte (AC-16)`: `missingBytes` = 51,300,000. The first `download` state is `{0, 51300000}`, `loadedBytes` only rises, and the precise engine's bytes continue from the fast engine's. `statusLines` → "Downloading cutout model: 0.0 of 51.3 MB".
  - `should_queue_a_tap_made_during_download` (Review Focus 1) and `should_drop_results_for_an_old_photo` (Review Focus 2).
- [ ] **Step 2: Run** `npx vitest run src/services/segmentation` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - "The user edited" means `history.current !== lastApplied`, where `lastApplied` is the selection object this controller last put in the history.
  - Auto results go in with `restore`; `resetToAuto` executes `restore(latestAuto)`.
  - Engines load in order: fast, then precise.
- [ ] **Step 4: Run** the Step 2 command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(services): fast-then-precise auto cutout controller` (Refs #47 #48 #50 #51)

---

### Task 7: Temporary tap-to-cut screen (spec decision 8, AC-24)

**Files:**
- Create: `src/ui/auto/AutoScreen.tsx`, `src/ui/auto/AutoScreen.css`, `src/ui/auto/loadPhoto.ts`
- Modify: `src/App.tsx`, `src/App.test.tsx`
- Test: `src/ui/auto/AutoScreen.test.tsx`

**Interfaces:**
- Consumes: `createAutoCutout`, `statusLines`, `classifyPress`, `startRenderWorker` (with `setModelAlpha`), `createFakeEngine` (tests), `createWorkerEngine` and `createModelStore` (production wiring in `App.tsx`).
- Produces: `<AutoScreen engines={{ fast, precise }} missingBytes={…} />`. The root has `data-phase={state.phase}`. The cutout is drawn on a `<canvas data-testid="cutout">` over a CSS checkerboard. The fit scale is `min(1, fitScale)`, and the canvas is rendered at `min(1, fitScale × devicePixelRatio)` (scale 1 when the photo fits, so e2e pixels are image pixels).

- [ ] **Step 1: Write the failing tests** (RTL + fake engines; the render worker is replaced by a fake client)
  - `should_cut_out_on_tap_and_remove_on_long_press (AC-24)`: pick a 100×50 PNG through the file input (`loadPhoto` is mocked to return an `RgbaImage`). A pointer down/up 100 ms apart calls `tap` with mode `add` at the image point under the pointer. A 600 ms press calls it with `remove`. The status shows "Cutting out…" and then the fake result.
  - `should_offer_lasso_when_auto_is_unavailable (AC-20)`: fake engines fail with `unsupported`; "Auto cutout doesn't work in this browser." and a "Use Lasso" button are shown.
  - `App.test.tsx`: the app shows "Pick a photo".
- [ ] **Step 2: Run** `npx vitest run src/ui src/App.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** `loadPhoto(file)` uses `createImageBitmap(file, { imageOrientation: 'from-image' })`, scales the long side down to at most 4096 px, and reads the pixels through an `OffscreenCanvas`. Pointer events convert `screenPt → imagePt` through the fit transform.
- [ ] **Step 4: Run** the Step 2 command, then `npm run lint`, `npm run typecheck` and `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): temporary tap-to-cut screen` (Refs #45)

---

### Task 8: Real-model e2e, offline and docs (#45, #47, #48, #50)

**Files:**
- Create: `e2e/auto.spec.ts`, `e2e/fixtures/auto/` (composites, ground-truth alpha PNGs, `README.md` with sources and licences), `scripts/compose-fixtures.py`
- Modify: `docs/decisions.md` (spec 0007 section), `docs/specs/0007-auto-cutout.md` (status at merge)

- [ ] **Step 1: Build the fixtures** with `py scripts/compose-fixtures.py`. This needs Pillow, is run by hand, and its outputs are committed. Each composite is 960×600 JPEG quality 95. Each subject's alpha, placed exactly as composited, is saved as `*.alpha.png`. The script also writes `e2e/fixtures/auto/fixtures.json`: per fixture, the image, the alpha files, the tap points in image px (each subject's alpha-weighted centroid, nudged to the nearest pixel with alpha 255), and for the person, the head box (the top 25% of the alpha's bounding box). Sources, all CC0 on Wikimedia Commons (credits and URLs go in the README):
  - [Teacup.png](https://commons.wikimedia.org/wiki/File:Teacup.png) (Rijksmuseum)
  - [Worn Shoe.png](https://commons.wikimedia.org/wiki/File:Worn_Shoe.png) (Aupajo)
  - [Woman in White Sleeveless Dress … transparent.png](https://commons.wikimedia.org/wiki/File:Woman_in_White_Sleeveless_Dress_Sitting_on_Gray_Concrete_Seat_during_Daytime_transparent.png) (dzeeshah, via Pixabay)
  - Backgrounds: 960×600 gravel crops, at full resolution, from [Dog on dirt road.jpg](https://commons.wikimedia.org/wiki/File:Dog_on_dirt_road.jpg), taken from below the dog: (0, 840)–(960, 1440) for the objects and (960, 840)–(1920, 1440) for the person, in the 1920 px-wide rendition.

  Placement:
  - `object`: the teacup scaled to 360 px tall, centred.
  - `two-objects`: the teacup (A) and the shoe (B) scaled to 280 px tall, centred at x = 260 and x = 700.
  - `person`: the woman scaled to 600 px tall, centred horizontally, touching the bottom edge.
- [ ] **Step 2: Write the failing e2e tests** (`desktop-chrome` only, 240 s timeout; IoU on the canvas alpha ≥ 128 against the ground truth ≥ 128)
  - `should_select_the_tapped_object (AC-21)`: tap the cup's tap point. While `data-phase` is `sharpening`, poll the canvas until the IoU is ≥ 0.75 (the fast result); once it is `done` and the canvas has re-rendered, IoU ≥ 0.9.
  - `should_add_and_remove_objects (AC-22)`: tap A, then B → IoU ≥ 0.85 with A ∪ B; long-press B (600 ms) → IoU ≥ 0.9 with A.
  - `should_keep_soft_hair_on_a_person (AC-23)`: IoU ≥ 0.9; within 2 px of the ground truth's 50% line, inside the head box listed in the fixture README, ≥ 25% of the pixels have alpha in [26, 229].
  - `should_work_offline_after_the_first_download (AC-18)`: after AC-21's run, `context.setOffline(true)` and reload. Tapping gives a result, and `page.on('request')` records no URL containing `/engine/` or `/models/` after the reload (the files come from Cache Storage, read by `modelStore`).
  - `should_explain_offline_first_use (AC-20)`, in all projects: a fresh context goes offline after the page loads, picks a photo and taps → "You're offline. The cutout model needs one download first." and "Use Lasso".
- [ ] **Step 3: Run** `npx playwright test e2e/auto.spec.ts` — Expected: PASS. If a threshold is missed, stop: the spec is fixed first (CLAUDE.md), with the measured value.
- [ ] **Step 4: Update docs.** Add spec 0007's eight decisions, plus any rulings, to `docs/decisions.md`. Then run the full suite: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run test:coverage`, `npm run test:perf` and `npm run test:e2e`.
- [ ] **Step 5: Commit** `test(e2e): real-model auto cutout, offline and fallback` (Refs #45 #47 #48 #50)
