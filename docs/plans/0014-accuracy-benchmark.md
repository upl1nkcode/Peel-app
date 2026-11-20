# Accuracy Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scorecard that measures Peel's cutout accuracy on fixed test photos and fails CI when it gets worse. It also adds a whole-journey e2e test, an offline cutout check, Lighthouse budgets and the Phase 10 phone checklist.

**Architecture:**
- **Scoring, stage building and report formatting** are pure TypeScript in `src/core/accuracy/`, unit-tested in Vitest.
- **The real models run in desktop Chromium** in a bench-only page (`bench.html`, built only with `vite build --mode bench`). It decodes a fixture, resizes it, runs the app's own fast and precise engines, builds every stage with the same core code the editor uses, and returns the scores as JSON.
- **A Playwright suite** (`playwright.bench.config.ts`) drives that page for every fixture × size. It writes `bench/accuracy.json` and `docs/accuracy.md` and compares against `bench/accuracy-baseline.json`.

**Tech Stack:** TypeScript, Vite 8, Playwright 1.64, Vitest 5, Python 3 + Pillow (fixture script), `@lhci/cli` (Lighthouse CI, Apache-2.0, dev only).

**Spec:** `docs/specs/0014-accuracy-benchmark.md`

## Global Constraints

- `src/core/` has no DOM, React, Node or browser imports.
- Geometry is in image pixels (float). Name variables `imagePt` and so on.
- Targets (Decision 2), reported and never failed:
  - iou ≥ 0.98;
  - edgeMean ≤ 1.0 px;
  - edgeP99 ≤ 4 px;
  - extra ≤ 0.005;
  - softError ≤ 0.05.
- Regression tolerances (AC-9), which fail CI:
  - iou 0.002;
  - edgeMean 0.05 px;
  - edgeP99 0.5 px;
  - extra 0.001;
  - softError 0.003.
- Size ladder (Decision 4): base 1600, 1000, 600 and 400 px, plus `forwarded`, which is 1280 px re-encoded at JPEG quality 0.6. Every copy is area-averaged from the base with `resizeRgba`, and the truth goes through the same function.
- Stages (Decision 5, Decision 12): `fast`, `precise`, `finished`, `lasso`, `lasso-snap`.
- Lasso settings (Decision 12):
  - zoom k = 0.9 × min(390 / bboxW, 700 / bboxH);
  - wobble 3 / k image px;
  - Smoothing 1;
  - snap reach 12 / k image px (`snapReachPx(k)`);
  - no soft edge (a new lasso selection has none: `emptySelection()`).
- Product code (`src/` outside `src/core/accuracy/` and `src/bench/`) doesn't change (Decision 8). A failing pass/fail check becomes a known miss with an issue.
- Sources are CC0, public domain or CC BY, never share-alike or non-commercial (Decision 9). Record each in `bench/fixtures/README.md` and `docs/licenses.md`.
- Downloaded source images go in their own new directory in the scratchpad and are opened only by the compose script (`py -I`).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run local e2e with `--workers=2`.

## Review Focus

1. **Truth and photo misaligned after downscaling.** Every score at 600 or 400 px would then be biased. A perfect cutout must score iou 1 and edge 0 at every size. Test: Task 2 `should_score_the_truth_as_perfect_at_every_size`.
2. **An engine finds nothing** (`selection: null`). That stage must score iou 0 with edge `Infinity`, then report and compare cleanly, not crash the run. Tests: Task 2 `should_score_an_empty_auto_result_as_a_miss`, and Task 3 `should_format_infinity_as_a_miss`.
3. **A subject touching the photo's edge** (the `two-people` and `skin-object` people may touch the bottom). The boundary must count border pixels. Test: Task 1 `should_count_the_image_border_as_boundary`.
4. **A new fixture or size with no baseline row.** It must be listed as "new", not pass silently or throw. A baseline row with no result means a fixture was dropped, and that must fail. Test: Task 3 `should_report_new_rows_and_fail_dropped_ones`.
5. **softError switching between `null` and a number** across runs (a band that crosses 500 pixels). That is a reported change, never a silent pass. Test: Task 3 `should_flag_soft_error_appearing_or_vanishing`.

---

### Task 1: Scores (AC-4)

**Files:**
- Create: `src/core/accuracy/score.ts`, `src/core/accuracy/distance.ts`, `src/core/accuracy/index.ts`
- Test: `src/core/accuracy/score.test.ts`, `src/core/accuracy/distance.test.ts`

**Interfaces:**
- Produces:
  - `interface Mask { width: number; height: number; alpha: Uint8Array }`;
  - `interface Scores { iou: number; edgeMean: number; edgeP99: number; extra: number; softError: number | null }`;
  - `scoreCutout(got: Mask, truth: Mask, extra?: Mask): Scores`;
  - `distanceToSet(width: number, height: number, inSet: Uint8Array): Float64Array`, the exact Euclidean distance transform (Felzenszwalb–Huttenlocher), distance in px to the nearest set pixel, `Infinity` when the set is empty;
  - `SOFT_BAND_MIN_PX = 500`.

- [ ] **Step 1: Write the failing tests**:
  - `distance.test.ts`: `should_match_brute_force_distances (AC-4)` (random 17 × 11 sets, compared with an O(n²) brute force to 1e-9), and `should_be_infinite_without_set_pixels (AC-4)`.
  - `score.test.ts`, each naming AC-4:
    - `should_score_identical_masks_as_perfect`: iou 1, edgeMean 0, edgeP99 0, extra 0;
    - `should_score_two_empties_as_iou_1`;
    - `should_measure_a_2px_shift_along_the_shift`: a 20 × 20 square in a 40 × 40 image, shifted 2 px in x. iou = 18·20 / (22·20). The left and right boundary columns contribute 2 and the top and bottom rows 0 to 2, so assert edgeMean is in (0, 2] and edgeP99 = 2;
    - `should_count_the_image_border_as_boundary`: a full-image truth versus full minus a 1 px frame gives edgeMean 1;
    - `should_measure_extra_share`: half of `got` lies on `extra`, so extra 0.5;
    - `should_report_soft_error_only_over_500_band_pixels`: a soft ring band of 400 px gives `null`, and 600 px gives the exact mean |Δ|/255;
    - `should_score_an_empty_got_as_a_miss`: iou 0, edgeMean `Infinity`;
    - `should_reject_mismatched_sizes`: `RangeError`.
- [ ] **Step 2: Run** `npx vitest run src/core/accuracy`. Expected: FAIL, the modules don't exist.
- [ ] **Step 3: Implement** `distance.ts` and `score.ts` as the spec's AC-4 defines:
  - inside means alpha ≥ 128;
  - a boundary pixel is an inside pixel with a 4-neighbour outside, or one on the image border;
  - edge distances run boundary-to-boundary both ways, pooled; edgeP99 uses the nearest-rank percentile;
  - the soft band is pixels within 3 px of a truth pixel with alpha in 1–254, which is `distanceToSet` on the soft pixels ≤ 3.
- [ ] **Step 4: Run** `npx vitest run src/core/accuracy`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(accuracy): cutout scores (spec 0014 AC-4)`.

### Task 2: Stages (AC-5, AC-7)

**Files:**
- Create: `src/core/accuracy/stages.ts`, `src/core/accuracy/lassoAround.ts`
- Test: `src/core/accuracy/stages.test.ts`, `src/core/accuracy/lassoAround.test.ts`

**Interfaces:**
- Consumes:
  - Task 1 `Mask` and `scoreCutout`;
  - core: `renderMask` (mask/render), `smartEdgeRefiner` (matting/smartEdge), `snapToEdges` (matting/magnetic), `joinSections`, `sectionTolerance`, `ringTolerance` and `snapReachPx` (editor/lasso), `fitRing` (selection/density), `applyCommand` and `emptySelection` (selection), `maskToRings` (contour), `resizeRgba` (mask/resize);
  - `AlphaMask`, `RgbaImage` and `Selection` types.
- Produces:
  - `lassoAround(truth: Mask, seed: number, wobblePx: number): Point[]`;
  - `traceZoom(truth: Mask): number`, the Decision 12 k;
  - `finishedAlpha(image: RgbaImage, auto: { alpha: AlphaMask; selection: Selection | null }): AlphaMask`;
  - `lassoAlpha(image: RgbaImage, truth: Mask, opts: { seed: number; snap: boolean }): AlphaMask`;
  - `dotsRoundTrip(alpha: AlphaMask, image: RgbaImage, softEdge: Selection['softEdge'], modelAlpha?: AlphaMask): AlphaMask`;
  - `resizeMask(mask: Mask, width: number, height: number): Mask`, which goes through `resizeRgba` with alpha in all four channels so it is the same filter as the photo;
  - `sizeFor(base: { width: number; height: number }, longSide: number): { width: number; height: number }`, rounded and never enlarging.

- [ ] **Step 1: Write the failing tests**, each naming AC-5 or AC-7:
  - `lassoAround.test.ts`:
    - `should_stay_within_the_wobble_of_the_outline`: every path point lies within wobblePx + 0.75 px of the truth's 50% outline;
    - `should_repeat_for_a_seed_and_differ_between_seeds`;
    - `should_close_the_path`.
  - `stages.test.ts`:
    - `should_score_the_truth_as_perfect_at_every_size`: a synthetic 1600 × 1000 disc truth, resized with `resizeMask` to each ladder size and scored against itself, gives iou 1 and edgeMean 0. Then `finishedAlpha` with alpha = truth and selection = `autoSelection(truth)` on a flat two-colour image scores iou ≥ 0.999 at 400 px;
    - `should_score_an_empty_auto_result_as_a_miss`: selection `null` gives an all-zero alpha, and `scoreCutout` gives iou 0;
    - `should_follow_a_clean_edge_with_the_lasso`: a dark disc on white, scored with `lassoAlpha` snap off, gives iou ≥ 0.97; with snap on, edgeMean ≤ 1;
    - `should_keep_a_result_through_the_dots_round_trip (AC-7)`: on the disc, the round trip changes iou by ≤ 0.002 and edgeMean by ≤ 0.1 px;
    - `should_pick_the_decision_12_zoom`: a 200 × 400 px truth box gives k = 0.9 × min(390/200, 700/400) = 1.575.
- [ ] **Step 2: Run** `npx vitest run src/core/accuracy`. Expected: FAIL, the functions don't exist.
- [ ] **Step 3: Implement.**
  - `lassoAround`: trace the truth's 50% outline with `maskToRings` and take the largest add ring's sampled path. Offset each point along its normal by `wobblePx · (0.6·sin(2π·3t + φ1) + 0.4·sin(2π·7t + φ2))`, where t is the arc fraction and φ1 and φ2 come from a seeded mulberry32.
  - `lassoAlpha`: build one section from `lassoAround(truth, seed, 3 / k)`.
    - Snap off: `{ points, snapped: false, tolerancePx: sectionTolerance(k, false) }`.
    - Snap on: points = `snapToEdges(image, points, snapReachPx(k))`, `snapped: true`.
    - Then `joinSections([s], 1)`, then `fitRing(path, ringTolerance([s]))`, then `applyCommand(emptySelection(), { type: 'addRing', nodes })`, then `renderMask(sel, size)`.
  - `finishedAlpha`: `renderMask(selection, size, { refineEdge: smartEdgeRefiner(image, auto.alpha) })`, or zeros when the selection is `null`.
- [ ] **Step 4: Run** `npx vitest run src/core/accuracy`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(accuracy): stages and finger-like lasso (spec 0014 AC-5, AC-7)`.

### Task 3: Report and baseline (AC-6, AC-9)

**Files:**
- Create: `src/core/accuracy/report.ts`
- Test: `src/core/accuracy/report.test.ts`

**Interfaces:**
- Produces:
  - `type Size = 1600 | 1000 | 600 | 400 | 'forwarded'`;
  - `type Stage = 'fast' | 'precise' | 'finished' | 'lasso' | 'lasso-snap'`;
  - `interface Row extends Scores { fixture: string; size: Size; stage: Stage }`;
  - `interface BenchFile { version: 1; results: Row[]; roundTrip: { fixture: string; stage: 'finished' | 'lasso'; dIou: number; dEdgeMean: number }[] }`;
  - `TARGETS` and `TOLERANCES`, with the Global Constraints values;
  - `roundRow(row: Row): Row`, which rounds to 4 decimals and keeps `Infinity` and `null`;
  - `compareToBaseline(now: BenchFile, base: BenchFile): { regressions: string[]; added: string[]; dropped: string[] }`;
  - `formatReport(now: BenchFile, base: BenchFile | null): string`, the Markdown for `docs/accuracy.md`.

- [ ] **Step 1: Write the failing tests**, each naming AC-6 or AC-9:
  - `should_fail_on_a_drop_beyond_tolerance`: iou 0.990 → 0.9879 is a regression, and 0.990 → 0.9881 is not;
  - `should_compare_each_score_with_its_own_tolerance`: edgeMean +0.06 regresses, edgeP99 +0.4 doesn't, extra +0.002 regresses, softError +0.004 regresses;
  - `should_report_new_rows_and_fail_dropped_ones`: a row only in `now` goes in `added` with no regression; a row only in the baseline goes in `dropped`, and the caller fails on it;
  - `should_flag_soft_error_appearing_or_vanishing`: null → 0.02 and 0.02 → null both count as regressions, with a message naming softError;
  - `should_format_infinity_as_a_miss`: an edgeMean of `Infinity` renders as `∞ ❌` and compares as worse than any number;
  - `should_mark_targets_and_list_the_worst_five`: the Markdown has one table per stage with rows fixture × size, ✅ or ❌ with the gap (e.g. `0.962 ❌ −0.018`), a "Worst five" list ranked by iou gap, a "Dots round trip" table, and a "Before → after" column when a baseline is given.
- [ ] **Step 2: Run** `npx vitest run src/core/accuracy/report.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `report.ts`. Messages read like `hair 600 finished: iou 0.9701 → 0.9650 (−0.0051, tolerance 0.002)`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(accuracy): report and baseline comparison (spec 0014 AC-6, AC-9)`.

### Task 4: Test photos (AC-1, AC-2, AC-3)

**Files:**
- Create: `scripts/compose-accuracy-fixtures.py`, `bench/fixtures/*` (6 photos, truths, 2 extras, `fixtures.json`, `README.md`)
- Modify: `docs/licenses.md`
- Test: `src/core/accuracy/fixtures.test.ts`, which reads `bench/fixtures/` with `node:fs`. That is allowed in a test file but not in core code, and the test is excluded from the core-imports rule only if the lint config needs it.

**Interfaces:**
- Produces: `bench/fixtures/fixtures.json` as `Record<FixtureName, { image: string; truth: string; extra?: string; tap: { x: number; y: number }; holeProbe?: { x: number; y: number; width: number; height: number } }>`. FixtureName is `'hair' | 'pet' | 'two-people' | 'skin-object' | 'glossy' | 'hole'`. `holeProbe` is the largest axis-aligned box inside the hole, where truth is 0 and not connected to the border. Only `hole` has it, and Task 8 uses it.

- [ ] **Step 1: Write the failing test** `fixtures.test.ts`:
  - `should_list_six_fixtures_with_files (AC-1)`: each image, truth and extra exists, each base is 1600 px on its long side (read the JPEG SOF header and the PNG IHDR), and each tap is fully opaque in its truth;
  - `should_keep_photos_small (AC-2)`: each file ≤ 800 KB and the folder ≤ 6 MB (spec amended);
  - `should_credit_every_source (AC-2)`: each source in `README.md`'s table has a URL, an author and a licence from {CC0, Public domain, CC BY 4.0, CC BY 3.0, CC BY 2.0}, and appears in `docs/licenses.md`;
  - `should_have_soft_hair_and_fur (AC-3)`: for `hair` and `pet`, at least 2% of the bounding-box pixels have alpha in 1–254, unless `fixtures.json` marks the fixture `"hardTruth": true` (the Decision 9 fallback), in which case an issue number must be present.
- [ ] **Step 2: Run** `npx vitest run src/core/accuracy/fixtures.test.ts`. Expected: FAIL, no fixtures.
- [ ] **Step 3: Find the sources** (Wikimedia Commons first, filtered to CC0, PD and CC BY transparent PNGs, plus backgrounds). Download them into a new scratchpad folder. Check each subject PNG's soft share before choosing it.
- [ ] **Step 4: Write `compose-accuracy-fixtures.py`**, following `scripts/compose-fixtures.py`:
  - a premultiplied LANCZOS resize; JPEG quality 90 (fail, rather than compress harder, if a photo is over 800 KB);
  - truths as 8-bit L PNGs;
  - tap points as in spec 0007;
  - `holeProbe` by flood fill;
  - AC-3 refusal (exit 1 with the soft share).

  Run it twice and compare hashes. Expected: identical.
- [ ] **Step 5: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 6: Commit** `test(accuracy): ground-truth test photos (spec 0014 AC-1 to AC-3)`. If the Decision 9 fallback was used, open its issue first and put its number in `fixtures.json`.

### Task 5: The bench run (AC-6, AC-7, AC-8)

**Files:**
- Create: `bench.html`, `src/bench/main.ts`, `playwright.bench.config.ts`, `bench/accuracy.bench.ts`, `scripts/bench-accuracy.mjs`
- Modify: `vite.config.ts` (in `mode === 'bench'`, `build.rollupOptions.input = { main: 'index.html', bench: 'bench.html' }` and `outDir: 'dist-bench'`), `package.json` (`"bench:accuracy": "node scripts/bench-accuracy.mjs"`), `.gitignore` (`dist-bench/`), `eslint.config.js` and `tsconfig` includes if `bench/` needs them.

**Interfaces:**
- Consumes: Tasks 1–3; `createModelStore`, `createWorkerEngine` and `sha256Hex` (services/segmentation); `startSegmentationWorker` (services/workers); `virtual:peel-models`. These are wired exactly as `src/App.tsx` wires them.
- Produces:
  - `window.peelBench.run(input: { photo: string; truth: string; extra?: string; tap: Point; size: Size }): Promise<{ rows: Row[]; roundTrip: BenchFile['roundTrip'] }>`. The URLs are relative to the bench server. In bench mode only, a small Vite plugin in `vite.config.ts` copies `bench/fixtures/*` into `dist-bench/bench-fixtures/`, and the URLs point there.
  - `node scripts/bench-accuracy.mjs [--update]`: runs `npx playwright test -c playwright.bench.config.ts`, with `BENCH_UPDATE=1` when `--update` is given.

- [ ] **Step 1: Write the failing suite** `bench/accuracy.bench.ts`:
  - `should_score_every_fixture_size_and_stage (AC-6)`: for each fixture × size, call `run`. Expect 6 × 5 × 5 = 150 rows, every fixture getting all five stages at all five sizes, and every iou in [0, 1].
  - The suite writes `bench/accuracy.json` and `docs/accuracy.md` with `formatReport`.
  - `should_not_regress (AC-9)`: when `bench/accuracy-baseline.json` exists, `compareToBaseline` gives no regressions and no dropped rows. Otherwise it fails with "No baseline: commit bench/accuracy.json from the CI artifact as bench/accuracy-baseline.json". With `BENCH_UPDATE=1`, it copies `accuracy.json` to the baseline and passes.
- [ ] **Step 2: Run** `npm run bench:accuracy`. Expected: FAIL, because `bench.html` and `window.peelBench` don't exist.
- [ ] **Step 3: Implement `src/bench/main.ts`**:
  - decode with `createImageBitmap` and `OffscreenCanvas`; truths read from the R channel;
  - resize the photo and truths with `resizeRgba` and `resizeMask` to `sizeFor(base, n)`. For `forwarded`: 1280 px, then `convertToBlob({ type: 'image/jpeg', quality: 0.6 })`, then decode;
  - scale the tap by the size ratio;
  - for each engine: `setImage(id, image)`, then `segment(id, [{ imagePt: tap, mode: 'add' }])`;
  - build the stages: fast = v1 alpha, precise = v2 alpha, finished = `finishedAlpha(image, v2)`, lasso and lasso-snap with seed 1;
  - score each with `scoreCutout(got, truth, extra)`;
  - round trip at 1000 px only: finished uses v2's softEdge and alpha, lasso uses no soft edge.
- [ ] **Step 4: Write `playwright.bench.config.ts`**:
  - one project, Desktop Chrome, viewport 1280 × 1000;
  - `workers: 1`, `timeout: 30 * 60_000`;
  - webServer `vite build --mode bench && vite preview --outDir dist-bench --port 4174 --strictPort`.
- [ ] **Step 5: Run** `npm run bench:accuracy -- --update`, then `npm run bench:accuracy` twice. Expected:
  - all three pass;
  - the two `bench/accuracy.json` files are byte-identical (AC-8);
  - `docs/accuracy.md` shows the table.

  If the runs differ, apply Decision 11's spread rule later in Task 6 and note it in the ledger.
- [ ] **Step 6: Run** `npm run build` and check that `dist/` has no `bench` chunk: `ls dist/assets | grep -i bench` should print nothing. This checks the production bundle is unchanged.
- [ ] **Step 7: Commit** `test(accuracy): the benchmark run (spec 0014 AC-6 to AC-8)`, including the locally produced `docs/accuracy.md` but **not** a local baseline. Delete `bench/accuracy-baseline.json` before committing; Task 6 makes it on CI.

### Task 6: The accuracy CI job and baseline (AC-9, AC-10, Decision 11)

**Files:**
- Modify: `.github/workflows/ci.yml` (new `accuracy` job, needed by `deploy`), `.github/pull_request_template.md` (create if missing: "If `bench/accuracy-baseline.json` changed: why, and before → after for the changed rows")
- Create: `bench/accuracy-baseline.json` (from the CI artifact)

- [ ] **Step 1: Add the `accuracy` job**: checkout, Node 24 with the npm cache, `npm ci`, `npx playwright install --with-deps chromium`, `npm run bench:accuracy`, and upload `bench/accuracy.json`, `docs/accuracy.md` and `test-results` as the `accuracy` artifact with `if: always()`.
- [ ] **Step 2: Push.** Expected: `accuracy` fails with "No baseline…" (RED).
- [ ] **Step 3: Rerun the job twice** (`gh run rerun --job`) and download the three artifacts. Compare the three `accuracy.json` files.
  - If identical, keep the AC-9 tolerances.
  - If they differ, set each tolerance to max(the AC-9 value, 2 × the largest spread seen), record it in `docs/decisions.md`, and update `TOLERANCES` with a test (`should_use_the_measured_tolerances`, RED, then GREEN).
- [ ] **Step 4: Commit** one artifact's `accuracy.json` as `bench/accuracy-baseline.json`, plus its `docs/accuracy.md`. Push. Expected: `accuracy` passes (GREEN).
- [ ] **Step 5: Commit** `ci(accuracy): accuracy job and CI-made baseline (spec 0014 AC-9, AC-10)`.

### Task 7: The whole journey e2e (AC-11)

**Files:**
- Create: `e2e/journey.spec.ts`
- [ ] **Step 1: Write `should_walk_the_whole_journey (spec 0014 AC-11)`**, skipped on desktop-chrome, using `pickGenerated` and the existing lasso helpers. It walks each step:
  1. Library empty;
  2. + → photo → Lasso ring → Done;
  3. Finish, choosing WhatsApp → Save → "Saved";
  4. ‹ Library → 1 tile;
  5. open the tile → brush one stroke → Save → Library;
  6. Select → tick the tile → Duplicate → 2 tiles; tick both → Export, then a download named `peel-backup-*.zip` with 2 stickers;
  7. tick one → Delete → confirm → 1 tile.
- [ ] **Step 2: Run** `npx playwright test e2e/journey.spec.ts --workers=2`. Expected: FAIL first if the spec file is written before the helpers it needs exist; otherwise expect PASS. The journey uses only shipped behaviour, so a pass on first run is the expected outcome, and the ledger records that it guards rather than drives.
- [ ] **Step 3: Commit** `test(e2e): the whole journey on phones (spec 0014 AC-11)`.

### Task 8: Offline hole check (AC-12)

**Files:**
- Modify: `e2e/offline.spec.ts`

- [ ] **Step 1: Extend the airplane-mode test**: after going offline, pick `bench/fixtures/hole.jpg`, tap `fixtures.json` `hole.tap`, wait for both engines, Save. Read the cutout canvas over `holeProbe` (scaled to the canvas, as `auto.spec.ts` reads `canvas[data-testid=cutout]`) and expect the largest alpha there to be < 26.
- [ ] **Step 2: Run** `npx playwright test e2e/offline.spec.ts --project=desktop-chrome --workers=1`. Expected: PASS, or a hole that isn't empty.
  - If the hole isn't empty, Decision 8 applies: open an issue "Auto fills the hole of the hole fixture". Mark the assertion `test.fail()` with the issue number, so CI goes red when the fix lands and someone removes the mark. Note it as a known miss in `docs/accuracy.md`.
- [ ] **Step 3: Commit** `test(e2e): offline cutout keeps a hole empty (spec 0014 AC-12)`.

### Task 9: Lighthouse budgets (AC-13, AC-14)

**Files:**
- Create: `lighthouserc.json`, `lighthouse-budget.json`
- Modify: `package.json` (devDependency `@lhci/cli`, script `"lighthouse": "lhci autorun"`), `.github/workflows/ci.yml` (`lighthouse` job, needed by `deploy`), `docs/licenses.md`, `docs/accuracy.md` ("Speed" section)

- [ ] **Step 1: Measure.** `npm run build`, then `npx @lhci/cli collect --numberOfRuns=3 --url=http://localhost:4173/` against `npm run preview`, then read the median of performance, accessibility, best practices, LCP, TBT and the script plus stylesheet transfer sizes. Record them in the ledger.
- [ ] **Step 2: Write `lighthouserc.json`**:
  - `collect`: `startServerCommand: "npm run preview -- --port 4173 --strictPort"`, the URL `/`, 3 runs, mobile preset (the default);
  - `assert.assertions`: `categories:performance ≥ 0.9`, `categories:accessibility ≥ 0.95`, `categories:best-practices ≥ 0.95`, `largest-contentful-paint ≤ 2500`, `total-blocking-time ≤ 200`;
  - `budgetsFile: lighthouse-budget.json`, with script and stylesheet resource sizes at 110% of the Step 1 KB, rounded up;
  - `upload.target: "filesystem"` (no public upload).

  Where Step 1's median already misses a score, Decision 8 applies: set that assertion to the measured value, open an issue, and note the known miss.
- [ ] **Step 3: Run** `npm run lighthouse` locally. Expected: PASS. Then shrink one budget to 1 KB and expect FAIL (the RED proof). Restore it.
- [ ] **Step 4: Add the `lighthouse` CI job** (Node 24, `npm ci`, `npm run build`, `npm run lighthouse`, upload `.lighthouseci/`). Write the measured numbers and budgets under "Speed" in `docs/accuracy.md`.
- [ ] **Step 5: Commit** `ci: Lighthouse budgets (spec 0014 AC-13, AC-14)`, with the dependency's one-line reason in the PR body.

### Task 10: Phone checklist and docs (AC-15)

**Files:**
- Modify: `docs/device-test-log.md` (the Phase 10 table, AC-15's 8 rows, columns iPhone 15 Pro and Samsung Galaxy S23, left empty for the product owner), `docs/decisions.md` (spec 0014 section: Decisions 1–12 in one line each, plus any rulings), `STICKER_WEBAPP_PLAN.md` (tick Phase 10 items except the real-phone pass), spec 0014 status → Implemented

- [ ] **Step 1: Write the docs**, then run `npm run format:check`. Expected: PASS.
- [ ] **Step 2: Commit** `docs: Phase 10 phone checklist and decisions (spec 0014 AC-15)`.
