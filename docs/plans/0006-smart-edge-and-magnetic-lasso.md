# Smart edge and magnetic lasso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cutout's edge follows the photo: smart edge recomputes alpha in a band from the object and background colours, and the magnetic lasso snaps a finger path onto the strongest nearby edge, both running in workers.

**Architecture:** `src/core/matting/` holds pure functions. `edges.ts` builds a colour Sobel edge map over a rectangle. `liveWire.ts` runs Dijkstra on it and refines the path between pixels. `magnetic.ts` turns a finger path into anchors and live-wire segments inside a reach corridor. `smartEdge.ts` builds the band from the traced 50% line (spec 0005's `traceContours`) and estimates alpha per band pixel from windowed object and background colour means, as an `EdgeRefiner` for `renderMask`. `src/workers/` holds the typed protocol, newest-wins scheduling and two handlers; the `*.worker.ts` entries only wire handlers to `self`. `src/services/workerClient.ts` is the main-thread side.

**Tech Stack:** TypeScript 6.0 (strict), Vitest 5, Vite module workers. No new dependencies.

**Spec:** `docs/specs/0006-smart-edge-and-magnetic-lasso.md` (issues #38, #39, #40, #42, #43, #44)

## Global Constraints

- `src/core/` has no DOM, React or browser imports or globals (`tsconfig.core.json` has no DOM lib). Coordinates are image px floats; pixel (i, j) is centred at (i + 0.5, j + 0.5). Colours are 8-bit sRGB / 255; the image's alpha channel is ignored.
- Constants: `SNAP_REACH_PT = 12`; `COLOUR_TRUST_DISTANCE = 0.15` (Euclidean RGB distance, channels 0..1); soft-edge band width in [2, 20] px at full resolution; live-wire step cost `(cost(q) + 0.05) × (1 or √2)`; colour window radius `R = ⌈bandPx / 2⌉ + 2`.
- Edge cost = 1 − strength / (max strength in the computed rect), 1 everywhere when that max is 0.
- Test names `should_...` with the AC id; seeded randomness (`src/test/random.ts`). Coverage of `src/core/` ≥ 90%, overall ≥ 75%. Timing tests go in `*.perf.test.ts` (run alone by `npm run test:perf`).
- Branch `feat/39-44-smart-edge`; one commit per task (Conventional Commits, `Refs #N`).

## Review Focus

1. **Image borders:** a finger path along the image border and a band that reaches past it. The edge map clamps to border pixels, corridors and windows clip to the image, and nothing reads out of bounds (Tasks 1, 3, 4).
2. **Degenerate finger paths:** one point, repeated identical points, and a path shorter than one pixel give one snapped point, not an error. Non-finite coordinates or a reach ≤ 0 are a `RangeError` (Task 3).
3. **Holes and several islands:** a donut and two discs with a soft edge get a band around every ring, with the hole's inside treated as background (Task 4).
4. **Wide reach at fit zoom:** a 300 px finger path with a 120 px reach on a 4032 × 3024 image computes the edge map only around the path, in < 60 ms (Task 3 perf).
5. **Odd preview sizes:** preview scales whose sizes round up (e.g. 0.3 of 101 × 77), with a model alpha. The image and the model alpha are area-averaged to exactly the mask size, and the band check uses the full-resolution width (Task 4).

---

### Task 1: Colour edge-cost map (#39)

**Files:**
- Create: `src/core/matting/edges.ts`, `src/core/matting/index.ts`, `src/test/sceneFixtures.ts`
- Test: `src/core/matting/edges.test.ts`

**Interfaces:**
- Consumes: `RgbaImage` (`src/core/mask/types.ts`), `softMask`, `circle` (`src/test/maskFixtures.ts`), `mulberry32`.
- Produces:
  - `Rect { x; y; width; height }` (whole px, inside the image).
  - `EdgeMap { rect; strength: Float32Array; cost: Float32Array; normalX: Float32Array; normalY: Float32Array }`. `normalX`/`normalY` hold the unit direction across the edge: the main eigenvector of the colour structure tensor Σ_c [gx², gx·gy; gx·gy, gy²]. This is an addition to the spec contract that `refineSubpixel` needs.
  - `edgeMap(image: RgbaImage, rect: Rect): EdgeMap`.
  - Fixture `paintScene(coverage: Float32Array, size: Size, fg: RGB, bg: RGB, opts: { noise: number; seed: number; texture?: number }): RgbaImage`. Each channel is `cov·fg + (1 − cov)·bg (+ texture·sin(0.9x)·cos(0.7y) on the object) + noise·(u1 + u2 + u3 − 1.5)`, rounded to 8 bits. Also `RGB = [number, number, number]` and `stepImage(width, height, column, left: RGB, right: RGB): RgbaImage`.

- [ ] **Step 1: Write the failing tests**
  - `should_put_the_lowest_cost_on_a_step_edge (AC-1)`: `stepImage(20, 12, 10, …)`, rect = whole image. In every row, the two smallest costs are at columns 9 and 10 and equal, and cost is non-decreasing moving away from them.
  - `should_find_same_brightness_colour_edges (AC-2)`: red [0.7, 0.4, 0.4] vs green [0.3, 0.55, 0.45] (Rec. 601 luma within 0.01). Cost on the step ≤ 0.1.
  - `should_give_cost_1_on_flat_images (AC-3)`: every cost is 1, no NaN. A sub-rect returns arrays of `rect.width × rect.height`, and its values equal the whole-image map's at the same pixels, including next to the image border (clamped samples).
- [ ] **Step 2: Run** `npx vitest run src/core/matting/edges` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `edgeMap`. Per channel, Sobel `gx, gy` with the 1-2-1 kernels divided by 8, reading neighbours with coordinates clamped to the image (not the rect). Strength = √Σ(gx² + gy²). For the normal, use θ = ½·atan2(2·Jxy, Jxx − Jyy), normal = (cos θ, sin θ); on a flat pixel use (1, 0).
- [ ] **Step 4: Run** the Step 2 command, `npm run lint`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): colour edge-cost map for the magnetic lasso` (Refs #39)

---

### Task 2: Live-wire and sub-pixel refinement (#40)

**Files:**
- Create: `src/core/matting/liveWire.ts`, `src/core/matting/liveWire.perf.test.ts`
- Test: `src/core/matting/liveWire.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `liveWire(map: EdgeMap, from: Point, to: Point, allowed?: Uint8Array): Point[]` (pixel centres, image px). `refineSubpixel(map: EdgeMap, path: readonly Point[]): Point[]`.

- [ ] **Step 1: Write the failing tests**
  - **Shared scenes:** 420 × 420, fg [0.8, 0.3, 0.2] on bg [0.2, 0.5, 0.8], noise 0.02. A 17° half-plane edge through (210.2, 210.6), and a circle of radius 150 at (210.3, 209.7). For each, two edge points about 300 px apart. The corridor is pixels within 120 px of the straight from–to segment.
  - `should_follow_a_synthetic_edge_within_1_px (AC-4)`: every path point is within 1 px of the true edge.
  - `should_refine_the_path_within_0_25_px (AC-5)`: every `refineSubpixel` point is within 0.25 px.
  - `should_start_end_and_stay_inside (AC-6)`: the first and last points are the centres of the pixels containing `from` and `to`; every point is allowed; `from` and `to` in one pixel give one point. A `from` outside the image, or a `to` outside `allowed`, is a `RangeError`.
  - `liveWire.perf.test.ts` — `should_find_a_300_px_path_in_under_30_ms (AC-7)`: the line scene, best of 5.
- [ ] **Step 2: Run** `npx vitest run src/core/matting/liveWire` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`liveWire`:** Dijkstra over `map.rect`, 8-connected, with the Global Constraints step cost. Use a binary heap on typed arrays (`Int32Array` indices, `Float64Array` keys) with lazy deletion. Stop when `to` is popped; walk `prev` back.
  - **`refineSubpixel`:** for each point p with normal n, sample strength bilinearly at p − n, p and p + n (centre convention; clamp to the rect). With `den = s₋ − 2s₀ + s₊`, if `den < 0` move by `t·n` where `t = clamp(0.5·(s₋ − s₊)/den, −1, 1)`; otherwise keep p.
- [ ] **Step 4: Run** the Step 2 command and `npx vitest run liveWire.perf` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): live-wire shortest path with sub-pixel refinement` (Refs #40)

---

### Task 3: Magnetic lasso core (story #38)

**Files:**
- Create: `src/core/matting/magnetic.ts`, `src/core/matting/magnetic.perf.test.ts`
- Test: `src/core/matting/magnetic.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `SNAP_REACH_PT = 12`; `snapToEdges(image: RgbaImage, finger: readonly Point[], reachPx: number): Point[]`.

- [ ] **Step 1: Write the failing tests** (scenes as Task 2, reach 12 px unless stated)
  - `should_snap_onto_the_edge (AC-8)`: finger = the true edge plus seeded smooth wobble up to 0.75 × reach (sum of 3 sines along the arc). Every result point is within 0.25 px of the edge.
  - `should_stay_within_reach_of_the_finger (AC-9)`: every result point is within reach + 1 of the finger polyline. The first and last are within reach of the first and last finger points.
  - `should_prefer_the_stronger_edge (AC-10)`: two parallel 17° edges 8 px apart, contrasts 0.4 and 0.2. The finger runs midway. The result is within 0.25 px of the stronger edge.
  - `should_not_cut_across_a_u_turn (AC-11)`: a U-shaped hairpin edge whose arms are 16 px apart, with the finger tracing it. Every finger point has a result point within reach.
  - `should_follow_the_finger_on_flat_areas (AC-12)`: a flat image. AC-9 holds, and there is no NaN.
  - `should_handle_degenerate_paths (Review Focus 2)`: a single point, a repeated point, or a 0.3 px path each give one point. A NaN coordinate, reach 0 or reach −1 is a `RangeError`. An empty finger gives `[]`.
  - `should_clip_at_the_image_border (Review Focus 1)`: a finger along y = 1 on an image whose edge is at y = 3 gives points within 0.25 px of y = 3.
  - `magnetic.perf.test.ts` — `should_snap_1000_px_in_under_30_ms (AC-13)`: the circle scene, a 1,000 px finger path, reach 12, best of 5.
  - `magnetic.perf.test.ts` — `should_search_only_near_the_finger (Review Focus 4)`: a 4032 × 3024 image, a 300 px finger, reach 120, < 60 ms.
- [ ] **Step 2: Run** `npx vitest run src/core/matting/magnetic` — Expected: FAIL.
- [ ] **Step 3: Implement** `snapToEdges`:
  1. Validate the inputs. The rect is the finger's bounding box grown by reach + 2, clipped to the image; compute one `edgeMap` over it.
  2. Put anchors on the finger at arc length 0, then every `max(2·reach, 8)` px, plus the last point. Snap each anchor to the minimum-cost pixel whose centre is within reach of its finger point. Break ties by distance to the finger point, then by lower index.
  3. Join consecutive anchors with `liveWire`. Its `allowed` mask holds the pixels within reach of the finger sub-polyline between the two anchors' arc positions.
  4. Concatenate the segments, dropping each joint's duplicate, then apply `refineSubpixel`.
- [ ] **Step 4: Run** the Step 2 command and `npx vitest run magnetic.perf` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): magnetic lasso snaps finger paths to nearby edges` (Refs #38)

---

### Task 4: Smart edge (#42, #43)

**Files:**
- Create: `src/core/matting/smartEdge.ts`, `src/core/matting/smartEdge.perf.test.ts`
- Modify: `src/test/sceneFixtures.ts` (scene builders), `src/core/matting/index.ts`
- Test: `src/core/matting/smartEdge.test.ts`

**Interfaces:**
- Consumes: `traceContours` (spec 0005), `renderMask`, `EdgeRefiner`, `AlphaMask`, `maskToRings`, Task 1 fixtures.
- Produces:
  - `COLOUR_TRUST_DISTANCE = 0.15`.
  - `bandMask(coverage: Float32Array, size: Size, bandPx: number): Uint8Array`: 1 where a pixel centre is within `bandPx / 2` of a segment of the traced 50% line.
  - `smartEdgeRefiner(image: RgbaImage, modelAlpha?: AlphaMask): EdgeRefiner`.
  - Fixtures: `discScene(kind, delta, opts)` returns `{ image, truth, selection }`, where the selection has one ring on a circle of radius 25 + delta around (48.3, 47.8) in 96 × 96. `hairScene(delta)` adds 24 strands 0.8 px wide from radius 24 to 32. `blurredModel(truth, factor = 4)`: area-average down, then bilinear up, as an `AlphaMask`.

- [ ] **Step 1: Write the failing tests** (band 8 unless stated; "truth" is the painted coverage)
  - `should_leave_pixels_outside_the_band_unchanged (AC-14)`: for disc, donut and two-disc selections (Review Focus 3), and a disc cut off by the image border (Review Focus 1), rendering with and without the soft edge gives bit-identical alpha outside `bandMask`. In the donut, the band's background colour inside the hole comes from the hole. On the cut-off disc, no NaN appears and the band stops at the border.
  - `should_accept_bands_from_2_to_20_px (AC-15)`: `bandPx` 2 and 20 work, and a band of 2 is no wider than 1 px each side. `bandPx` 1.9 or 20.1 is a `RangeError`.
  - `should_snap_alpha_to_the_real_edge (AC-16)`: scenes `contrast` ([0.8, 0.3, 0.2] / [0.2, 0.5, 0.8], noise 0.02), `isoluminant` ([0.7, 0.4, 0.4] / [0.3, 0.55, 0.45], 0.02) and `textured` ([0.6, 0.4, 0.3] / [0.2, 0.5, 0.8], noise 0.04, texture 0.15), each with delta ∈ {0, 2, −2}. Over the band: mean |α − truth| ≤ 0.02; wrong-side share ≤ 1%; share of truth-0 pixels with α > 0.1 ≤ 0.5%.
  - `should_keep_hair_strands (AC-17)`: `hairScene` with delta ∈ {0, 2, −2}. Strand keep ≥ 0.9, background clear ≥ 0.99, mean error ≤ 0.04.
  - `should_fall_back_where_colours_are_alike (AC-18)`: the same colour inside and out gives band α = coverage exactly (`guided`) or = model alpha / 255 (`model`). Colours 0.075 apart give each band pixel midway between the estimate and the fallback, within 1e-6. Compute the estimate in the test from the window means.
  - `should_keep_the_fallback_without_known_colours (AC-19)`: a 3 px strand ring with band 20 is unchanged.
  - `should_refine_model_alpha (AC-20)`: rings from `maskToRings(blurredModel(truth))`, source `model`, with the blurred alpha. The AC-16 and AC-17 bounds hold. A `model` soft edge without a model alpha, or with one of another size, is a `RangeError`.
  - `should_not_leak_previews (AC-21, Review Focus 5)`: previews at 0.3 and 0.5 (101 × 77 image, with and without a model alpha). Then a full render is bit-identical to a fresh refiner's full render. The preview's image is the area average at `⌈size·s⌉`.
  - `smartEdge.perf.test.ts` — `should_add_under_600_ms_on_12_mp (AC-22)`: spec 0005's person mask painted as a scene, band 20. Best of 2 of (render with smart edge) − (render without).
- [ ] **Step 2: Run** `npx vitest run src/core/matting/smartEdge` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Band check:** the refiner derives the scale from `size.width / image.width`. If `bandPx / scale` (with 1e-9 slack) is outside [2, 20], it throws `RangeError`.
  - **Resampling:** when the size differs from the image, area-average the image (and model alpha) to the size, cached by size.
  - **`bandMask`:** trace the coverage (`traceContours`). For each segment, mark pixels whose centre is within `bandPx / 2`.
  - **Known colours:** known object = outside the band with coverage ≥ 0.5; known background = outside the band with coverage < 0.5.
  - **Per band pixel:**
    - F, B = the mean colour of the known object and background pixels in the (2R + 1)² window, clipped to the image. Use integral images per 256 × 256 tile of the band's bounding box, padded by R.
    - If either count is 0, keep the fallback.
    - Otherwise `est = clamp(((I − B)·(F − B)) / |F − B|², 0, 1)`, `w = min(1, |F − B| / 0.15)`, and `α = w·est + (1 − w)·fallback`.
  - **Fallback:** the coverage, or the model alpha / 255 for `model`.
- [ ] **Step 4: Run** the Step 2 command, `npx vitest run smartEdge.perf`, lint and typecheck — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): smart edge estimates alpha from object and background colours` (Refs #42, #43)

---

### Task 5: Workers with typed messages (#44)

**Files:**
- Create: `src/workers/protocol.ts`, `src/workers/newestWins.ts`, `src/workers/renderHandler.ts`, `src/workers/liveWireHandler.ts`, `src/workers/wire.ts`, `src/workers/render.worker.ts`, `src/workers/livewire.worker.ts`, `src/services/workerClient.ts`, `src/services/workers.ts`
- Test: `src/workers/newestWins.test.ts`, `src/workers/renderHandler.test.ts`, `src/workers/liveWireHandler.test.ts`, `src/workers/wire.test.ts`, `src/services/workerClient.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4; `renderMask`; `Selection`.
- Produces:
  - Message unions exactly as in the spec contract.
  - `interface Reply<M> { message: M; transfer: ArrayBuffer[] }`.
  - `createRenderHandler(): (msg: ToRenderWorker) => Reply<FromRenderWorker> | undefined` (`setImage` returns undefined) and `createLiveWireHandler()`, likewise.
  - `newestWins<Req extends { type: string; jobId?: number }, Res>(handle, post, defer = (f) => setTimeout(f, 0))`. It returns `onMessage(req)`. Messages without `jobId` (`setImage`) run at once, in order. Job requests queue; on the deferred drain, each `type` runs only its newest job, and the older ones post `{ type: 'cancelled', jobId }`.
  - `wireWorker(scope: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m: unknown, t: ArrayBuffer[]): void }, handler)`. If a handler throws, it posts `{ type: 'error', jobId, message }`.
  - `createWorkerClient(port)`: `send(msg, transfer)` for `setImage`; `request(msg, transfer): Promise<Res | { type: 'cancelled' }>`, newest per `type`. A superseded promise resolves `cancelled` at once, and late replies to it are ignored.
  - `startRenderWorker()` / `startLiveWireWorker()` in `services/workers.ts` use `new Worker(new URL('../workers/render.worker.ts', import.meta.url), { type: 'module' })`.

- [ ] **Step 1: Write the failing tests**
  - `should_match_direct_calls (AC-23)`: render and snap replies deep-equal `renderMask(…, { scale, refineEdge: smartEdgeRefiner(image, modelAlpha) })` and `snapToEdges(…)` on small scenes.
  - `should_reuse_images_by_id (AC-24)`: two renders after one `setImage` both work. An unknown id gives `error`. A second `setImage` replaces the first, and the old id then gives `error`.
  - `should_run_only_the_newest_job (AC-25)`: three `render` jobs before the drain give one `rendered` (the newest) and two `cancelled`. In the client, the first two promises resolve `cancelled` and a late reply to job 1 is ignored.
  - `should_report_errors_and_keep_serving (AC-26)`: a throwing request gives `error` with the message, and the next request succeeds.
  - `should_transfer_buffers (AC-27)`: the `rendered` reply's transfer list holds `mask.data.buffer`. The client's `setImage` passes `image.data.buffer` in its transfer list.
- [ ] **Step 2: Run** `npx vitest run src/workers src/services/workerClient` — Expected: FAIL.
- [ ] **Step 3: Implement** the files above. The `*.worker.ts` entries are two lines: `wireWorker(self as unknown as WorkerScope, newestWins(createRenderHandler(), …))`.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm run test:coverage && npm run test:perf && npm run build` — Expected: all PASS; the build output lists `render.worker` and `livewire.worker` chunks.
- [ ] **Step 5: Commit** `feat: render and live-wire workers with typed messages` (Refs #44)

---

### Done when
All five tasks are committed and CI is green. `docs/decisions.md` records any rulings that change behaviour. Spec 0006 is set to Implemented in the same PR, and the PR has `Closes #38`, `#39`, `#40`, `#42`, `#43`, `#44` (one line each).
