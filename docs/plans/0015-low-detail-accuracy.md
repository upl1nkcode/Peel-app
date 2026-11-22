# Clean Auto Cutouts on Low-Detail Photos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The scorecard sees background left on and low-detail photos. Then Auto's sharpening zooms in on the subject, and the smart edge suits the photo's size. Each part ships as its own PR.

**Architecture:**
- **Scores:** pure TypeScript in `src/core/accuracy/`.
- **Zoom:**
  - `src/core/segmentation/zoom.ts` decides the crop;
  - the precise worker engine sends the crop as a *region* of the photo;
  - the segmentation worker places its result back in photo coordinates, so `AutoResult` keeps meaning "full photo size";
  - the auto-cutout controller starts the precise run after the fast result, handing it that result.
- **Smart edge:** the band width moves from a constant to a function of the photo's size, set where the auto selection is made.
- **Bench:** it calls the same engines through the same code (spec 0014 Decision 10).

**Tech Stack:** React 19, strict TypeScript, Vitest, Playwright (bench config), Python + Pillow (fixture script), MediaPipe Tap v1/v2 workers.

**Spec:** `docs/specs/0015-low-detail-accuracy.md` (and spec 0014 for everything the scorecard already does).

## Global Constraints

- `src/core/` has no DOM, React, Node or browser imports. Geometry is in image pixels (float).
- No new model, download or dependency (Decision 2).
- No visible change. The phases, status lines and notices stay the same, in the same order (Decision 6).
- Ship rule (Decision 4):
  - no **finished** score on any fixture × size is worse than the baseline beyond the tolerances (iou 0.002, edgeMean 0.05, edgeP99 0.5, extra 0.001, softError 0.003, background 0.001, missed 0.001);
  - at least one targeted finished score improves.
- Each task is its own branch and PR, with:
  - `Closes #N`;
  - a before/after table of the finished rows (`scripts/bench-diff.mjs`, Task 1);
  - the preview link `https://<branch-slug>.peel-app-9kg.pages.dev`, given to the product owner.

  Merge only on the owner's "merge it". The next task branches from `main` after that merge.
- The baseline is made on CI and committed from the `accuracy` artifact (spec 0014 Decision 11). The PR template's "why the baseline changed" is answered with before → after.
- Every fix PR updates `docs/accuracy.md` from the same CI artifact.
- Execution: inline (executing-plans). Each PR gets its own final Opus review before it is marked ready (this project ships per task, not per branch).

## Review Focus

1. **A subject that touches the photo's edge** (a person cut off at the bottom). The crop is clipped at the photo edge, and that edge must not count as "the crop cut the subject" (AC-7). Owned by Task 2: `should_not_treat_a_photo_edge_as_a_cut_edge`.
2. **A new tap while the zoomed run is still working.** The older crop's result must never be placed with the newer crop, or shown after the newer tap (spec 0007's newest-wins). Owned by Task 2: `should_place_each_result_with_its_own_crop`.
3. **A remove tap outside the crop, next to add taps inside it.** It is dropped, and the remaining taps are moved correctly (AC-6). Owned by Task 2: `should_drop_remove_taps_outside_the_crop`.
4. **A tiny or one-pixel fast result, or a 120 px photo.** The crop must still be a sensible, non-empty area: at least 32 px a side or the whole photo. Owned by Task 2: `should_keep_a_crop_at_least_32_px`.
5. **A 12 MP photo whose crop is bigger than 1024 px.** The crop goes through the same inference copy (≤ 1024 long side), and the result is placed at full size. Owned by Task 2: `should_downscale_a_large_crop_like_the_whole_photo`.

---

### Task 1: The scorecard sees low detail (#160, PR 1)

Branch `feat/160-low-detail-scorecard`. It covers spec AC-1 to AC-5, and AC-14's empty table. Nothing in the app changes.

**Files:**
- Modify:
  - `src/core/accuracy/score.ts`;
  - `src/core/accuracy/report.ts`;
  - `src/core/accuracy/stages.ts` (screenshot size, second tap);
  - `src/bench/main.ts`;
  - `bench/accuracy.bench.ts`;
  - `scripts/bench-accuracy.mjs`;
  - `scripts/compose-accuracy-fixtures.py`;
  - `bench/fixtures/*` (two new fixtures), `bench/fixtures/README.md`;
  - `docs/licenses.md`, `docs/device-test-log.md`, `docs/accuracy.md`, `bench/accuracy-baseline.json`.
- Create:
  - `src/core/mask/blur.ts` + test;
  - `scripts/bench-diff.mjs`.
- Test:
  - `src/core/accuracy/score.test.ts`, `report.test.ts`, `stages.test.ts`;
  - `src/core/mask/blur.test.ts`;
  - `bench/fixtures.test.ts`.

**Interfaces:**
- Produces (from `src/core/accuracy/score.ts`):
  - `Scores` gains `background: number` and `missed: number`;
  - `scoreCutout` is otherwise unchanged.
- Produces (from `report.ts`):
  - `Size = 1600 | 1000 | 600 | 400 | 'forwarded' | 'screenshot'`;
  - `TARGETS.background = TARGETS.missed = 0.005`;
  - `TOLERANCES.background = TOLERANCES.missed = 0.001`;
  - `interface Timing { fixture: string; size: Size; firstMs: number; secondMs: number | null; path: 'whole' | 'crop' | 'cut' }`;
  - `BenchFile` gains `timing?: Timing[]`. It is never compared and is stripped from the baseline.
- Produces (from `src/core/mask/blur.ts`): `gaussianBlur(data: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: 1 | 4, sigma: number): Uint8Array`. It is separable, with kernel radius `ceil(3σ)`, edges clamped and values rounded half up. It is deterministic on every platform.
- Produces (from `stages.ts`):
  - `SCREENSHOT = { longSide: 720, sigma: 1.5, quality: 0.5 }`;
  - `secondTap(truth: Mask, first: Point): Point`. It returns an alpha-255 pixel of the truth, at least 10% of the truth's bounding-box diagonal from `first`, chosen deterministically: the qualifying pixel nearest to the truth's bounding-box centre.
- Produces: `node scripts/bench-diff.mjs BEFORE.json AFTER.json` prints a Markdown table of every finished row where any score changed, as `before → after`, plus a count of rows worse beyond tolerance.

- [ ] **Step 1: Write the failing score tests** in `score.test.ts`:
  - `should_score_background_left_on_and_subject_missed (spec 0015 AC-1)`: a 10 × 10 square truth in a 20 × 20 mask, with `got` the same square shifted 2 px right. Expect `background` 0.2 and `missed` 0.2.
  - `should_not_count_the_distractor_as_background (AC-1)`: `got` covers the truth and the whole `extra`. Expect `background` 0 and `extra` > 0.
  - `should_score_empty_masks_without_infinity (AC-1)`:
    - empty `got` → background 0, missed 1;
    - both empty → 0 and 0;
    - empty truth with 7 inside pixels in `got` → background 7, missed 0.
- [ ] **Step 2: Run** `npx vitest run src/core/accuracy/score.test.ts`. Expected: the three new tests FAIL (`background` is undefined).
- [ ] **Step 3: Implement** both fields in `scoreCutout` with the AC-1 formulas, in the same pixel loop.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Write the failing report tests** in `report.test.ts`:
  - `should_show_and_guard_background_and_missed (AC-2)`:
    - both columns appear in every stage table, with ✅/❌ against 0.005;
    - a finished row whose background grows by 0.0011 is a regression;
    - a growth of 0.0009 is not.
  - `should_list_the_most_background_left_on (AC-2)`: a "Most background left on (finished)" list of five rows, by background, descending.
  - `should_not_fail_on_scores_the_baseline_lacks (AC-2)`: a baseline row without `background`/`missed` gives no regression for them.
  - `should_order_the_screenshot_size_last (AC-4)`: rows sort 1600, 1000, 600, 400, forwarded, screenshot.
  - `should_never_compare_timing (AC-5)`: a `timing` that differs wildly gives no regression.
- [ ] **Step 6: Run** `npx vitest run src/core/accuracy/report.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 7: Implement them in `report.ts`:**
  - the metrics, targets, tolerances, columns and list;
  - the `'screenshot'` size;
  - `Timing` and `timing?`;
  - `roundRow` rounds the new fields to 4 decimals.
- [ ] **Step 8: Run** the report tests. Expected: PASS.
- [ ] **Step 9: Write failing tests for `gaussianBlur` and `secondTap`:**
  - `should_blur_like_a_gaussian (AC-4)`:
    - a single 255 pixel in a 21 × 21 one-channel image at σ 1.5 gives a symmetric kernel summing to 255 ± 2, with the centre the maximum;
    - a flat image is unchanged.
  - `should_pick_a_second_tap_inside_the_subject (AC-5)`: on a 40 × 20 bar truth with `first` at its left end, the result has truth alpha 255 and lies ≥ 10% of the diagonal away.
- [ ] **Step 10: Run** `npx vitest run src/core/mask/blur.test.ts src/core/accuracy/stages.test.ts`. Expected: FAIL (not defined).
- [ ] **Step 11: Implement** `gaussianBlur` and `secondTap` as specified in Interfaces.
- [ ] **Step 12: Run** the same command. Expected: PASS.
- [ ] **Step 13: Add the fixtures to `scripts/compose-accuracy-fixtures.py`:**
  - **`small-subject`:** `woman.png`, scaled so its bounding box's long side is 20% of 1600 px, on a busy background not yet used. The script asserts 15–25%.
  - **`overlap`:** person A in front, person B behind and partly hidden by A, with B's box covering ≥ 30% of A's. The script asserts the overlap and that the mean RGB of each is within 40 levels per channel of the other. `extra` is B's visible alpha (B minus A's coverage). Sources already in `scratchpad/sources14` may be reused. Re-check them in `sources.json`.
  - Then run it twice, check the files are byte-identical, and add both to `fixtures.json` with their taps.
  - Then record them in `bench/fixtures/README.md` and `docs/licenses.md`.

  Expected: `npx vitest run bench/fixtures.test.ts` PASS (≤ 800 KB each, folder ≤ 6 MB).
- [ ] **Step 14: Update the bench page** (`src/bench/main.ts`):
  - `photoAt` handles `'screenshot'`: `sizeFor` 720, then `gaussianBlur` σ 1.5 on RGBA, then JPEG 0.5 through OffscreenCanvas as `forwarded` does.
  - `sizedMask` for `'screenshot'` downscales the truth/extra, then blurs it by the same σ.
  - The engines start in parallel exactly as Auto does today: `setImage` both, then `segment` both on the tap.
  - `firstMs` = from the `segment` calls to the precise result.
  - At 1000 px and screenshot only, segment both again with `[tap, secondTap]`. `secondMs` is the same measure.
  - `path: 'whole'`.
  - Return `timing` with `rows` and `roundTrip`.
- [ ] **Step 15: Update the bench driver and its script:**
  - `bench/accuracy.bench.ts` writes `timing` into `bench/accuracy.json` and strips it when copying to the baseline.
  - `scripts/bench-accuracy.mjs --only=<fixture>[,<fixture>]` sets `BENCH_ONLY`. The driver then runs only those fixtures, writes `bench/accuracy-only.json`, and skips the baseline comparison. This is for tuning in Tasks 2 and 3.
  - `docs/accuracy.md` shows a "Time to sharper result" table (median `firstMs` and `secondMs` by size), headed as information only.
- [ ] **Step 16: Create** `scripts/bench-diff.mjs` (Interfaces).
- [ ] **Step 17: Add the phone table.** `docs/device-test-log.md` gets the section "Low-detail Auto (spec 0015)", with the AC-14 rows (low-resolution, forwarded, screenshot, small subject, two overlapping people) × (iPhone 15 Pro, Galaxy S23), and the columns "cleaner than before?" and "Sharpening felt slower?", left empty.
- [ ] **Step 18: Verify locally.** Run `npm run lint && npm run typecheck && npm test`. Expected: all green.

  Then run `npm run bench:accuracy`. Expected:
  - it fails only on added rows (the new fixtures and the screenshot size) and on scores missing from the baseline;
  - every existing fixture × size × stage keeps its iou, edgeMean, edgeP99, extra and softError identical. Check with `node scripts/bench-diff.mjs bench/accuracy-baseline.json bench/accuracy.json`, which lists no changed existing score.
- [ ] **Step 19: Commit, push, open the PR** (`Closes #160`). After CI's `accuracy` job, commit its `bench/accuracy.json` as the baseline and its `docs/accuracy.md`, the same procedure as spec 0014. Run `bench-diff` against the old baseline again: no changed existing score (spec AC-2). Then all jobs green, the Opus final review, its fix pass, the preview link to the owner, and merge on "merge it".

### Task 2: Zoomed sharpening (#161, PR 2)

Branch `feat/161-zoomed-sharpening`. It covers spec AC-6 to AC-9.

**Files:**
- Create: `src/core/segmentation/zoom.ts` + `zoom.test.ts`; `scripts/bench-speed.mjs`.
- Modify:
  - `src/core/segmentation/index.ts`;
  - `src/workers/protocol.ts`;
  - `src/workers/segmentationHandler.ts` + test;
  - `src/services/segmentation/types.ts`;
  - `src/services/segmentation/workerEngine.ts` + test;
  - `src/services/segmentation/fakeEngine.ts`;
  - `src/services/segmentation/autoCutout.ts` + test;
  - `src/bench/main.ts`, `scripts/bench-accuracy.mjs`;
  - `docs/decisions.md`, `docs/accuracy.md`, `bench/accuracy-baseline.json`.

**Interfaces:**
- Consumes: `Bounds` (`src/core/geometry/types.ts`), `cropRgba(image, bounds)` (`src/core/mask/trim.ts`, with the same bounds convention), `Tap`, `AlphaMask`, `inferenceImage`, Task 1's `Timing`.
- Produces (from `src/core/segmentation/zoom.ts`):
  - `ZOOM_PADDING = 0.25`, `ZOOM_MAX_AREA = 0.8`, `ZOOM_MIN_SIDE_PX = 32`;
  - `zoomCrop(fastAlpha: AlphaMask | null, taps: readonly Tap[], photo: Size, padding = ZOOM_PADDING): Bounds | null`. It returns the bounding box of alpha ≥ 128 pixels and add taps, padded by `padding` × its width/height per side, grown to at least `ZOOM_MIN_SIDE_PX` a side, and clipped to the photo. It returns `null` with no fast alpha or no inside pixels and no add tap, or when the crop's area is ≥ `ZOOM_MAX_AREA` of the photo.
  - `contains(outer: Bounds, inner: Bounds): boolean`;
  - `tapsInCrop(taps: readonly Tap[], crop: Bounds): Tap[]`: moves the taps by `-minX, -minY` and drops remove taps outside.
  - `cutsSubject(alpha: AlphaMask, crop: Bounds, photo: Size): boolean`: alpha ≥ 128 on a crop edge that is not a photo edge.
- Produces (protocol): the segmentation `setImage` message gains `region?: Bounds`, meaning the image is this part of the photo. `fullSize` stays the photo's size. The `segmented` reply gains `cut: boolean`.
- Produces (services): `SegmentationEngine.segment(imageId, taps, around?: AlphaMask): Promise<AutoResult>`.
  - `around` is the fast result.
  - The precise worker engine zooms when it is given. The fast engine ignores it.
  - The result is always at full photo size.

- [ ] **Step 1: Write the failing `zoom.test.ts`:**
  - `should_crop_around_the_fast_result_with_padding (AC-6)`: a 1000 × 800 photo, inside pixels in x 400–499 and y 300–399, no taps outside. Expect `{ minX: 375, minY: 275, maxX: 525, maxY: 425 }` (max exclusive, as `cropRgba`).
  - `should_include_every_add_tap (AC-6)`
  - `should_keep_a_crop_at_least_32_px (Review Focus 4)`: a one-pixel fast result, and a 120 × 90 photo.
  - `should_use_the_whole_photo_without_a_fast_result_or_for_a_large_crop (AC-7)`: `null` for a `null` alpha, an empty alpha, and a crop ≥ 80% of the area.
  - `should_drop_remove_taps_outside_the_crop (Review Focus 3)`
  - `should_not_treat_a_photo_edge_as_a_cut_edge (Review Focus 1, AC-7)`: subject pixels on a crop edge equal to the photo edge → `false`; on an inner crop edge → `true`.
- [ ] **Step 2: Run** `npx vitest run src/core/segmentation/zoom.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `zoom.ts` (Interfaces) and export it from the index.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Write the failing worker handler tests** in `segmentationHandler.test.ts`, with the existing fake backend:
  - `should_place_a_region_result_in_the_photo (AC-6)`: `setImage` with `region` `{ minX: 200, minY: 100, maxX: 400, maxY: 300 }` of an 800 × 600 photo, and the backend returning a full-coverage mask. Expect `alpha` to be 800 × 600, 255 exactly inside the region, and 0 outside. Taps arrive in photo coordinates and reach the backend normalised to the region.
  - `should_report_a_cut_subject (AC-7)`: `cut` is true when the backend mask touches an inner region edge.
  - `should_downscale_a_large_crop_like_the_whole_photo (Review Focus 5)`: a 3000 × 2000 region is sent through `inferenceImage` (≤ 1024 long side), and the result is placed at full size.
- [ ] **Step 6: Run** `npx vitest run src/workers/segmentationHandler.test.ts`. Expected: FAIL.
- [ ] **Step 7: Implement it** in `protocol.ts` and `segmentationHandler.ts`:
  - convert taps photo → region before `tapsToStrokes`, using `tapsInCrop`;
  - upscale the small mask to the region's size, place it in a zeroed full-size alpha, set `cut` with `cutsSubject`, and run `autoSelection` on the placed full-size coverage.

  Without `region`, behaviour is unchanged.
- [ ] **Step 8: Run** the handler tests and the whole worker test folder. Expected: PASS.
- [ ] **Step 9: Write the failing worker engine tests** in `workerEngine.test.ts`, with the existing fake port:
  - `should_zoom_the_precise_engine_around_the_fast_result (AC-6)`: `segment(id, taps, around)` sends a `setImage` with the `cropRgba` pixels (through the shared inference copy) and `region` = `zoomCrop(...)`, then `segment`.
  - `should_reuse_the_crop_while_new_taps_fit (AC-8)`: a second call whose `zoomCrop` is contained in the current crop sends no new `setImage`.
  - `should_rerun_on_the_whole_photo_when_the_crop_cut_the_subject (AC-7)`: a `cut: true` reply leads to a whole-photo `setImage` (no region) and a second `segment`. Its result is returned.
  - `should_place_each_result_with_its_own_crop (Review Focus 2)`: two overlapping calls with different crops. The older call is cancelled (`SegmentCancelled`), and the newer result is in photo coordinates.
  - `should_ignore_around_on_the_fast_engine (AC-6)`
- [ ] **Step 10: Run** `npx vitest run src/services/segmentation/workerEngine.test.ts`. Expected: FAIL.
- [ ] **Step 11: Implement it in `workerEngine.ts`:**
  - keep the full-size photo per `imageId`, the object passed to `setImage` (the app already holds it, so there's no copy);
  - add the optional `around` to `types.ts`;
  - make `fakeEngine.ts` accept `around` and record it per call for tests.
- [ ] **Step 12: Run** the same command. Expected: PASS.
- [ ] **Step 13: Write the failing controller tests** in `autoCutout.test.ts`:
  - `should_start_the_precise_run_with_the_fast_result (AC-6)`: with both engines ready, a tap runs fast, and precise is called after the fast result, with `around` = that result's alpha.
  - `should_run_precise_on_the_whole_photo_when_fast_is_unavailable (AC-7)`: fast failed → precise starts at the tap without `around`.
  - `should_keep_the_same_phases_and_notices (AC-8)`: the phase sequence `cutting → sharpening → done` and the status lines are identical to today's, for one tap and for two taps.

  Every existing test in the file stays unchanged and green.
- [ ] **Step 14: Run** `npx vitest run src/services/segmentation/autoCutout.test.ts`. Expected: the new tests FAIL; the old ones pass.
- [ ] **Step 15: Implement it in `autoCutout.ts`.**
  - In `run('fast')`'s success path, when precise is owed and ready, run precise with `around = result.alpha`.
  - When fast is not ready or failed, precise runs at the tap as today.
  - Precise "owed" and the generation checks keep today's meaning.
- [ ] **Step 16: Run** `npm test`. Expected: all green.
- [ ] **Step 17: Update the bench.**
  - **Bench page:** fast first, then precise with `around = v1.alpha`. `firstMs` = from the fast `segment` call to the precise result. `path` comes from the engine (`'crop'`, `'whole'` or `'cut'`; expose it to the bench through a counter on the engine, not on `AutoResult`).
  - **`--whole` flag:** `scripts/bench-accuracy.mjs --whole` sets `BENCH_WHOLE=1`. The page then runs today's parallel whole-photo path and writes `bench/accuracy-whole.json`, without comparing.
  - **`scripts/bench-speed.mjs WHOLE.json ZOOM.json`:** prints the median `firstMs` and `secondMs` of each, the ratios, and the count of `'cut'` rows.
- [ ] **Step 18: Measure (AC-8, AC-9).** Run `npm run bench:accuracy -- --whole`, then `npm run bench:accuracy`, then `node scripts/bench-speed.mjs bench/accuracy-whole.json bench/accuracy.json`.

  Expected:
  - both ratios ≤ 1.2;
  - `bench-diff` shows no finished score worse beyond tolerance;
  - at least one targeted finished score better (small-subject, overlap or the low sizes).

  If a ratio is over 1.2, or a finished score is worse: tune `ZOOM_PADDING` on `--only`, using the spec's options (reuse the crop; start whole at the tap and replace). Ledger each ruling. If nothing wins, close the PR with the numbers on #161 (Decision 3).
- [ ] **Step 19: Record the decision.** Add `docs/decisions.md` "Low-detail Auto (spec 0015)": the padding used, and the measured ratios.
- [ ] **Step 20: Commit, push, PR** (`Closes #161`). The body carries:
  - the `bench-diff` table;
  - the `bench-speed` output;
  - the cut count;
  - the preview link.

  Then the CI baseline, `docs/accuracy.md`, the Opus final review, its fix pass, and merge on "merge it". If the overlap rows now meet AC-13, the PR also says `Closes #159`.

### Task 3: Smart edge sized to the photo (#162, PR 3)

Branch `feat/162-smart-edge-size`. It covers spec AC-10 to AC-12.

**Files:**
- Modify:
  - `src/core/accuracy/report.ts` + test (the "finished vs precise" list);
  - `src/core/segmentation/autoSelection.ts` + test;
  - possibly `src/core/matting/smartEdge.ts` + test;
  - `docs/decisions.md`, `docs/accuracy.md`, `bench/accuracy-baseline.json`.

**Interfaces:**
- Consumes: `Row`, `BenchFile` (Task 1); `AUTO_BAND_PX`, the band range [2, 20] (`SOFT_EDGE_BAND_RANGE`).
- Produces:
  - `finishedVsPrecise(rows: Row[]): { fixture: string; size: Size; dIou: number; dBackground: number }[]`: rows where finished is worse than precise by > 0.002 IoU or > 0.001 background;
  - `autoBandPx(photo: Size): number`, in [2, 20], used by `autoSelection` instead of the constant.

- [ ] **Step 1: Write the failing report test** `should_list_finished_rows_worse_than_precise (AC-10)`: a finished row with IoU 0.003 below its precise row is listed; one 0.001 below isn't. The report shows the list under "Finished vs precise", with known misses marked as such.
- [ ] **Step 2: Run** `npx vitest run src/core/accuracy/report.test.ts`. Expected: FAIL. Then implement `finishedVsPrecise` and the section, and run it again. Expected: PASS.
- [ ] **Step 3: Write the failing `autoSelection.test.ts` tests:**
  - `should_size_the_band_to_the_photo (AC-10)`: `autoBandPx` is non-decreasing in the long side, stays within [2, 20], and the auto selection carries it.
  - `should_use_the_same_band_in_preview_and_saved_sticker (AC-11)`: render the same selection with `renderMask` at preview scale 0.25 and at 1. The band used at full size equals `bandPx`, and the preview's equals `bandPx × 0.25` (no preview-only value).
- [ ] **Step 4: Run** `npx vitest run src/core/segmentation/autoSelection.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement `autoBandPx`** with a starting rule of `clamp(8 × longSide / 1600, 2, 20)`. Tune it on `--only=hair,pet,skin-object,two-people,small-subject,overlap`. If the band alone leaves rows on the "finished vs precise" list, add the confidence rule in `smartEdge.ts`: inside the band, a pixel whose model alpha is ≤ 13 or ≥ 242 keeps the model's alpha. Its test `should_keep_confident_model_alpha_in_the_band (AC-10)` goes first, then RED, then GREEN. Ledger each value tried, with its `bench-diff` summary.
- [ ] **Step 6: Run** `npm test`, then `npm run bench:accuracy`. Expected:
  - the "finished vs precise" list is empty, or each row left has an issue and is marked a known miss;
  - `bench-diff` passes the ship rule.
- [ ] **Step 7: Record and ship.** Add the values chosen to `docs/decisions.md`. Then commit, push and open the PR (`Closes #162`) with the table and the preview link. Then the CI baseline, `docs/accuracy.md`, the Opus final review, its fix pass, and merge on "merge it". If AC-13 now passes, the PR also says `Closes #159`.

### Task 4: Only the tapped person (#159, PR 4 if needed)

- [ ] **Step 1: Check.** After Task 3 merges, read the `overlap` finished rows in `docs/accuracy.md`. If extra ≤ 0.005 and missed ≤ 0.02 at every size (AC-13), #159 was closed by the PR that got there, and this task is done.
- [ ] **Step 2: Otherwise, find the cause** with superpowers:systematic-debugging on `--only=overlap`. Is B already in the fast result, so the crop includes it, or does the precise engine add B? Write the cause and one proposed fix as an amendment to this plan, in branch `fix/159-tapped-person-only`. The amendment comes with the failing test it will turn green. Then RED → GREEN → bench → ship rule → PR with the table and the preview link.
- [ ] **Step 3: If no fix meets AC-13 under the ship rule,** mark #159 as a known miss in the report with its scores and leave the issue open (spec AC-13). The story still completes.

### Task 5: Real phones (#163)

- [ ] **Step 1:** After each fix PR's preview, and after the final main deploy, ask the product owner to fill their rows in `docs/device-test-log.md` (AC-14). Their notes go in through a docs PR. Close #163 when both phones' rows are filled from the main deploy. Then set spec 0015 to Implemented and story #164 to Done.
