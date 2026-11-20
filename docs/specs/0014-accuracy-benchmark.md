# 0014 — Accuracy benchmark and device verification

- **Status:** Approved (product owner, 2026-11-20)
- **Issues:** story #92; tasks #93 (ground-truth fixtures), #94 (benchmark script), #95 (full end-to-end flows incl. offline), #96 (Lighthouse budgets), #97 (real iPhone and Android pass)
- **Plan reference:** STICKER_WEBAPP_PLAN.md Phase 10, §10 (definition of done)

## Why

Accuracy is the product. The product owner wants **near-perfect cutouts every time**. Today some come out perfect and some come out a bit off. From their testing, most problems first, with the frequency in their own words:

1. **Low-resolution photos.** This is the main problem.
2. **Hair and fur.** "sometimes not all the time".
3. **Two people in the photo, only one wanted.** Auto takes both. Lasso fixes it, but that is still an accuracy problem.
4. **A person next to something skin-coloured.** The first pass grabs the object, and the finished cutout drops it again.

They haven't tried every kind of photo. The benchmark should therefore find weak spots nobody has hit yet, not just confirm the known ones.

This story builds the **scorecard**. It is a fixed set of test photos with known correct outlines. Each one is scored for coverage, edge, extra subjects and soft hair, at several resolutions and at each stage of the cutout. CI fails if any score gets worse. Fixing what misses the targets is the **next** story, low resolution first, then hair (decided 2026-11-20 by the product owner). This story changes nothing a user sees.

## Decisions

1. **Scorecard first, fixes after** (product owner, 2026-11-20). This story only measures and protects. Each later fix is its own PR with before-and-after scores and a preview link, so it can be undone on its own with one revert PR.
2. **Near-perfect targets** (proposed and accepted 2026-11-20). A photo meets its target when the finished cutout has:
   - coverage (IoU) ≥ **0.98**;
   - mean edge error ≤ **1.0 px**;
   - 99th-percentile edge error ≤ **4 px**;
   - extra ≤ **0.5%**;
   - soft-edge alpha error ≤ **0.05** (fixtures with soft edges only; a builder's call, see AC-4).

   Every resolution is measured in that photo's own pixels. Missing a target is **reported, not failed**: CI fails only on regressions (AC-9). The targets are what the next story works towards.
3. **The test photos are composites** of public-domain (CC0) cut-outs on real backgrounds, built by a committed script, as spec 0007's fixtures are. The exact correct alpha is then known. The product owner's own photos are not used: nobody has an exact outline for them, and they are private.
4. **Low resolution is a size ladder made from each base photo at run time:**
   - the base (long side 1600 px);
   - 1000 px;
   - 600 px;
   - 400 px;
   - "forwarded", which is 1280 px re-encoded at JPEG quality 60, roughly what WhatsApp sends.

   Each smaller copy is area-averaged from the base, and its truth is downscaled with the same filter. Only the bases and their truths are committed.
5. **Stages are scored separately**, so a problem shows where it starts:
   - **fast**: Tap v1 alone;
   - **precise**: Tap v2's model alpha, upscaled;
   - **finished**: v2 plus the 8 px smart edge, which is what Auto saves;
   - **lasso** and **lasso-snap**: a finger-like lasso around the true outline (Decision 12).
   - The dots round trip (selection to dots and back, spec 0005) is checked on the finished and lasso results.
6. **Real models run in desktop Chromium**, through the app's own Auto code, as spec 0007's real-model e2e tests do. Phones would be too slow on CI. The lasso and the scoring are plain TypeScript in `src/core/` and run in Node.
7. **The scorecard has its own CI job** (`accuracy`), running in parallel with `e2e`. Tap v2 takes about 10 s per photo on a laptop CPU, so about 35 runs take a few minutes.
8. **A check that today's app fails is logged, not fixed here** (builder's call, following Decision 1). AC-7 (dots round trip), AC-12 (the hole) and AC-13 (Lighthouse) are real pass or fail checks. If one fails when it lands:
   - it is marked as a known miss in `docs/accuracy.md`;
   - it gets an issue for the next story;
   - its CI check guards today's value instead, so it can't get worse.

   Product code doesn't change in this story.
9. **Sources** (builder's call). CC0 or public domain is preferred. CC BY is allowed with attribution, since it is permissive, but share-alike and non-commercial licences are not. For `hair` and `pet`, if no source passes AC-3:
   - the fixture still ships with its hard truth;
   - its softError is `null`;
   - `docs/accuracy.md` says hair is then checked on real phones only (AC-15);
   - an issue tracks finding a soft source.

   The builder finds the sources.
10. **"Finished" is scored from a bench-only build** (builder's call). A separate Vite entry, not in the production build, imports the same segmentation services and smart-edge code that Auto uses. It returns full-resolution v1, v2 and finished alphas for one photo and tap. The production bundle is unchanged, and the scores come from the code users run.
11. **The baseline is made on CI** (builder's call), downloaded from the `accuracy` job's artifact and committed, as the screenshot baselines are. If runs on different CI machines disagree, the AC-9 tolerances become twice the largest spread seen over 3 CI runs, recorded in `docs/decisions.md`. The job stays blocking.
12. **The lasso stage uses the app's defaults** (builder's call). The lasso is traced at the zoom k where the subject's bounding box fills 90% of a 390 × 700 pt phone screen, with:
    - a finger wobble of ±3 pt (3 / k image px);
    - Smoothing 1;
    - the default soft edge.

    The stage is scored twice:
    - **lasso**, with Snap to edges off, the default (spec 0011 Decision 6);
    - **lasso-snap**, with it on (reach 12 / k image px).

## What

### Test photos (#93)

- **AC-1** Given `py scripts/compose-accuracy-fixtures.py SOURCES_DIR`, then it writes these to `bench/fixtures/` (each base 1600 px on its long side, JPEG quality 90), and running it twice gives identical files:

  | Fixture | Subject (tap) | Also in the photo | Checks |
  |---|---|---|---|
  | `hair` | a person with loose hair | busy background | hair, soft edge |
  | `pet` | a dog or cat with fur | grass or floor | fur, soft edge |
  | `two-people` | person A | person B close by, overlapping A's bounding box | extra |
  | `skin-object` | a person | a skin-coloured object (wood, bread, terracotta…) touching or overlapping them | extra |
  | `glossy` | a glossy mug | reflective surface | glare edges |
  | `hole` | an object with a see-through hole (a ring, scissors or a handle) | busy background | the hole must stay empty |

  For each it writes:
  - the photo;
  - `<fixture>.truth.png`: the subject's alpha exactly as composited;
  - `<fixture>.extra.png` for `two-people` and `skin-object`: the distractor's alpha;
  - an entry in `bench/fixtures/fixtures.json` with the tap point (the alpha-weighted centroid moved to the nearest fully opaque pixel, as in spec 0007).
- **AC-2** Every source is CC0, public domain or CC BY (Decision 9). Each is recorded with its URL, author and licence in `bench/fixtures/README.md` and `docs/licenses.md`. Each committed file is ≤ 800 KB and the folder is ≤ 6 MB (amended 2026-11-20: busy 1600 × 1000 backgrounds at JPEG quality 90 measured 250–775 KB, and quality matters more than size, since every smaller test size is made from these photos).
- **AC-3** The `hair` and `pet` truths have real soft edges. At least 2% of the subject's pixels inside its bounding box have alpha in 1–254. The script refuses a source that doesn't, so a hard-cut PNG can't pass for a hair truth.

### Scores (#94)

Functions in `src/core/accuracy/`: pure, no DOM, unit-tested with small hand-made masks. A mask is a `Uint8Array` of alpha 0–255 with a width and height. "Inside" means alpha ≥ 128.

- **AC-4** `scoreCutout(got, truth, extra?)` returns these values. Each is checked against hand-worked examples, including an empty `got`, an empty truth, and masks with different sizes, which throw a `RangeError`.
  - **iou:** |inside both| ÷ |inside either|. It is 1 when both are empty.
  - **edgeMean / edgeP99** (px): the boundary pixels are the inside pixels with a 4-neighbour outside, or on the image border. For each boundary pixel of `got`, take the distance to the nearest boundary pixel of `truth`, and the same the other way round. Pool both sets and report their mean and 99th percentile, using exact Euclidean distance transforms. A shift of a solid square by 2 px scores edgeMean 2 when measured along the shift.
  - **extra:** |inside `got` ∧ inside `extra`| ÷ |inside `got`|, or 0 without `extra`.
  - **softError:** mean |got − truth| ÷ 255 over the soft band, which is every pixel within 3 px of a truth pixel with alpha in 1–254. It is reported only when that band has ≥ 500 pixels; otherwise `null`.
- **AC-5** `lassoAround(truth, seed, wobblePx)` returns a closed path that follows the truth's 50% outline, pushed in or out by a smooth wobble of up to `wobblePx`, the way a finger's trace wanders. The same seed gives the same path. It becomes a selection the way the app's lasso does (Decision 12), giving the **lasso** and **lasso-snap** stages.

### The run (#94)

- **AC-6** `npm run bench:accuracy` builds the app, scores every fixture × size × stage, and writes:
  - `bench/accuracy.json`: every score, rounded to 4 decimals, with the stage, size and fixture;
  - `docs/accuracy.md`: a table per stage, with each score marked ✅ when it meets the Decision 2 target and ❌ with the gap when it doesn't, plus a short "worst five" list.
- **AC-7** The dots round trip doesn't change a result by more than IoU 0.002 and edgeMean 0.1 px. It is checked on the finished and lasso results at 1000 px, and reported in the same table.
- **AC-8** Two runs on the same machine give the same `bench/accuracy.json`. If the models turn out not to be bit-for-bit repeatable, the builder measures the spread over 3 runs and the tolerances in AC-9 become at least twice it, recorded in `docs/decisions.md`.

### Protection in CI (#94)

- **AC-9** The `accuracy` CI job runs the benchmark and compares it with the committed `bench/accuracy-baseline.json`. It fails, naming each fixture, size, stage and score, when any score is worse than the baseline by more than:
  - iou: 0.002;
  - edgeMean: 0.05 px;
  - edgeP99: 0.5 px;
  - extra: 0.001;
  - softError: 0.003.

  It does not fail for a missed target.
- **AC-10** `npm run bench:accuracy -- --update` rewrites the baseline. A PR that changes it shows the before-and-after numbers in its diff, and the PR template asks why. The job uploads `docs/accuracy.md` as an artifact.

### Full end-to-end flows (#95)

- **AC-11** On the iPhone 15 and Pixel 8 projects, one test walks the whole path without seeding. It cuts out with Lasso, because the built app has no fake engine and real-model runs are desktop-only:
  1. Library;
  2. + → photo → Lasso around the subject → Done;
  3. Finish (WhatsApp output) → Save;
  4. Library;
  5. reopen, change, save;
  6. tick both stickers → Duplicate → Export;
  7. delete one.

  It checks what the user would see at each step.
- **AC-12** On desktop Chrome, with the real models, the offline test (spec 0013 AC-21) also cuts out the `hole` fixture after going offline and saves it. The saved sticker's hole is empty: its alpha inside the hole is < 26.

### Lighthouse budgets (#96)

- **AC-13** A `lighthouse` CI job runs Lighthouse (mobile preset, simulated throttling) on the built app's Library, three times, and takes the median. It fails when any of these is missed:
  - performance ≥ 90;
  - accessibility ≥ 95;
  - best practices ≥ 95;
  - largest contentful paint ≤ 2.5 s;
  - total blocking time ≤ 200 ms;
  - the JavaScript and CSS loaded for the first screen, gzipped, ≤ 110% of the size measured when this lands.

  The engine and models are not counted: they load on first use or in the background.
- **AC-14** The measured numbers and the byte budget are recorded in `docs/accuracy.md` under "Speed". Changing a budget needs a `docs/decisions.md` line.

### Real-phone pass (#97)

- **AC-15** `docs/device-test-log.md` gets a Phase 10 table for the iPhone 15 Pro (installed from Safari) and the Samsung Galaxy S23 (installed from Chrome), filled in by the product owner from the main deploy:
  1. a person with loose hair, by Auto;
  2. a mug by Lasso + Dots;
  3. a shape with a hole;
  4. a low-resolution photo (a screenshot or a forwarded WhatsApp image);
  5. two people, keeping one;
  6. save → Photos → Add Sticker on iPhone, and WhatsApp on Android;
  7. airplane mode;
  8. a 12 MP photo.

  Anything that looks wrong becomes an issue.

## Contract

```ts
// src/core/accuracy/score.ts
export interface Mask { width: number; height: number; alpha: Uint8Array }
export interface Scores {
  iou: number; edgeMean: number; edgeP99: number; extra: number
  softError: number | null
}
export function scoreCutout(got: Mask, truth: Mask, extra?: Mask): Scores

// src/core/accuracy/lassoAround.ts (image pixels, float)
export function lassoAround(truth: Mask, seed: number, wobblePx: number): { x: number; y: number }[]

// bench/accuracy.json
{ "version": 1, "results": [ { "fixture": "hair", "size": 600 | "forwarded" | …,
  "stage": "fast" | "precise" | "finished" | "lasso" | "lasso-snap", ...Scores } ] }
```

## Out of scope

- Improving accuracy. That is the next story: low resolution first, then hair.
- The product owner's own photos in CI.
- Scoring on phones. Real-model runs stay desktop-only, and phones are checked by hand in AC-15.
- Graphics-chip inference (spec 0007 Decision 6).
- Datasets with non-commercial licences (for example the common matting benchmarks).
