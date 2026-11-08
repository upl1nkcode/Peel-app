# Lasso and Brush — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new editor tools.
- **Lasso:** trace with one finger, pause and continue across zoom and pan, optionally snap to edges, add or subtract, and get editable dots.
- **Brush:** erase or restore the cutout itself, with a size in image px and a hardness.

**Architecture:**
- **Pure helpers (`src/core/`):**
  - open-path smoothing;
  - lasso maths: tolerances, reach, closing, joining, continuing;
  - brush maths: the size slider, default size, loupe circles;
  - `fitRing`: dots with spec 0003's two-way curve guarantee. It reuses density's RDP pick and repair loop and skips its slow dot-removal pass.
- **Workers:**
  - the render worker gains a newest-wins `fitRing` job;
  - the live-wire worker (spec 0006), which the editor hasn't used yet, gets each photo and snaps sections.
- **UI:**
  - The canvas controller delegates the two tools to new modules, so `canvasController.ts` (924 lines) doesn't double:
    - `lassoTool.ts` records the drag, closes or pauses it, continues from the end handle, and shows the live snap trail;
    - `brushTool.ts` records the stroke, previews it, and makes dabs.
  - A `useLasso` hook owns the open lasso: sections, final snap, fit and commit.
  - The screen gets the Lasso and Brush sheets and a five-tool toolbar.

**Tech Stack:** TypeScript 6 (strict), React 19, Vitest + RTL (jsdom), Playwright (CDP touch on Chromium). No new dependencies.

**Spec:** `docs/specs/0011-lasso-and-brush.md` (story #74; #75–#80)

## Global Constraints

- **Purity:** `src/core/` has no DOM, React or browser imports or globals. Coordinates are image px floats, never rounded. Names say `canvasPt` or `imagePt`. k is CSS px per image px, which is the canvas's `displayScale`.
- **Constants, from the spec:**
  - closing: `CLOSE_RADIUS_PX = 22`, `CLOSE_AWAY_PX = 44`; the end handle grabs within 22 px;
  - tolerance: `sectionTolerance(k, false) = min(8, max(0.25, 1/k))`, `sectionTolerance(k, true) = 0.5`; the ring uses the minimum over its sections;
  - snapping: `snapReachPx(k) = SNAP_REACH_PT / k` (12 pt, existing constant);
  - smoothing: `SmoothStrength` 0–4, default 1;
  - brush: `BRUSH_MIN_PX = 1`, `BRUSH_MAX_PX = 1000`, `BRUSH_DEFAULT_CSS_PX = 40`, default hardness 100% (1 in `BrushStroke`);
  - drawing:
    - the path: 2 px white line with a 1 px dark outline;
    - the start dot: 8 px white;
    - the end handle: a 20 px accent ring;
    - the snap trail: 1 px white at 60% opacity;
    - the brush band: `rgba(220, 38, 38, 0.4)` for Erase, `rgba(22, 163, 74, 0.4)` for Restore;
  - speed: frame median < 8 ms over 30 frames; `fitRing` on a 10,000 px path at tolerance 8 < 1 s in Node.
- **Copy is exact:**
  - **Toolbar:** "Auto", "Lasso", "Dots", "Brush", "View".
  - **Lasso hints:** "Trace around it with one finger · Lift to pause", "Drag the end dot to go on · End at the start to close", "Making dots…".
  - **Brush hints:** "Paint over what to remove", "Paint over what to bring back".
  - **Lasso controls:** a radiogroup "Lasso mode" (radios "Add", "Subtract"), a switch "Snap to edges", a range "Smoothing" labelled "Raw" and "Smooth", and buttons "Finish" and "Discard".
  - **Brush controls:** a radiogroup "Brush mode" (radios "Erase", "Restore"), a range "Size" with the text "Size N px", and a range "Hardness" with the text "Hardness N%".
  - **Status lines:** "Draw around the area to cut out", "Couldn't snap to edges here, kept your line".
- **Test hooks:**
  - The canvas gains `data-lasso` (`none` | `drawing` | `paused` | `busy`) and `data-lasso-points` (all points of the open lasso, including the current drag).
  - The loupe gains `data-brush-radius` (`outer` or `outer,inner` in loupe CSS px, 4 decimals), present only in Brush.
- **Undo steps** use spec 0003's existing commands (`addRing`, `subtractRing`, `addStroke`) through `session.edit`. Nothing is added to `Command`.
- **Ruling (plan): "Given an open lasso" in AC-8 means "with the Lasso tool open".** Elsewhere the lasso is hidden (AC-2), and Undo works on the selection as usual.
- **Process:**
  - Test names are `should_...` with the spec 0011 AC id.
  - jsdom has no 2D canvas: drawing is checked in Playwright, and component tests check edits, state and hooks.
  - Coverage: `src/core/` ≥ 90%, overall ≥ 75%.
- **Git:** branch `feat/74-lasso-and-brush`; one commit per task (Conventional Commits, `Refs #N`); the PR closes #74–#80.

## Review Focus

1. **The selection changes while a lasso is snapping or being fitted** (an Auto result arrives, or Undo in another tool). The ring is added to the selection as it is when the fit returns, never to an older one. A new photo drops the result (Task 5).
2. **"Finish" draws a closing line that crosses the path.** The self-crossing ring is still added and renders without error, following spec 0004's fill rule (Task 5).
3. **A lasso traced partly off the photo.** Off-photo points are kept, snapping clamps them (spec 0006), and the ring renders clipped (Tasks 1 and 7).
4. **Brushing at 16×.** A 1 px brush still records a stroke with `sizePx = 1`. On a tiny photo the default size is clamped to 1 (Tasks 1 and 6).
5. **A drag on the end handle while the last section's snap or fit is still running.** It is ignored and nothing is lost; the handle works again once `busy` clears (Tasks 4 and 5).

---

### Task 1: Pure lasso and brush helpers (#75, #76, #77, #79, #80)

**Files:**
- Modify: `src/core/geometry/smooth.ts`, `src/core/geometry/index.ts`
- Create: `src/core/editor/lasso.ts`, `src/core/editor/brush.ts`, with tests next to them
- Modify: `src/core/editor/index.ts`, to export both

**Interfaces:**
- Produces:
  - `smoothPath(path: readonly Point[], strength: SmoothStrength): Point[]`.
  - `LassoSection { points: Point[]; snapped: boolean; tolerancePx: number }`.
  - `sectionTolerance(k: number, snapped: boolean): number`.
  - `snapReachPx(k: number): number`.
  - `CLOSE_RADIUS_PX`, `CLOSE_AWAY_PX`, and `closesOnLift(pathCanvasPts: readonly Point[]): boolean`. The start is the first point, the end the last.
  - `joinSections(sections: readonly LassoSection[], smoothing: SmoothStrength): Point[]`, an open path. It drops a section's first point when it equals the previous section's last.
  - `ringTolerance(sections: readonly LassoSection[]): number`, the minimum over the sections.
  - `continueAt(endImagePt: Point, downCanvasPt: Point, fingerCanvasPt: Point, vp: Viewport, view: View): Point`.
  - `BRUSH_MIN_PX`, `BRUSH_MAX_PX`, `BRUSH_DEFAULT_CSS_PX`.
  - `brushSizeAt(s: number): number`: s in [0, 1] maps to a whole px in [1, 1000], logarithmic.
  - `brushSliderAt(px: number): number`, its inverse.
  - `defaultBrushSize(k: number): number`.
  - `loupeBrushRadii(sizePx: number, hardness: number, k: number): { outer: number; inner: number | null }`, in loupe CSS px, using `loupeScale(k)` from `loupe.ts`. Hardness is in [0, 1], as in `BrushStroke`, and `inner` is null at 1.

- [ ] **Step 1: Write the failing tests.**
  - `should_keep_both_ends_when_smoothing_an_open_path (AC-15)`: a 5-point zig-zag at strength 2 starts and ends at the same points; its interior lies inside the input's bounds. Strength 0 returns equal points (AC-17).
  - `should_give_one_screen_px_tolerance_within_limits (AC-15)`:
    - `sectionTolerance(4, false) = 0.25` (clamped up from 1/4)
    - `sectionTolerance(0.5, false) = 2`
    - `sectionTolerance(0.05, false) = 8`
    - `sectionTolerance(0.05, true) = 0.5`
    - `ringTolerance` over sections with tolerances 2, 0.5 and 8 is 0.5
  - `should_convert_the_snap_reach_at_the_zoom (AC-11)`: `snapReachPx(3) = 4`.
  - `should_close_only_after_going_away (AC-4)`:
    - a path that ends 21 px from its start, having reached 50 px away, is true;
    - one that ends 23 px away is false;
    - one that never got more than 40 px away is false.
  - `should_join_sections_continuously (AC-15)`:
    - two raw sections, where the second starts at the first's end, give one path without the duplicate;
    - smoothing 1 leaves a snapped section's points unchanged and smooths the raw ones with their ends kept.
  - `should_continue_from_the_end_without_a_jump (AC-6)`:
    - at view zoom 2 (k = 2 at fit times 2), a finger that went down 5 px from the end and moved (+20, +10) CSS px gives end + (20, 10) / k;
    - a finger that hasn't moved gives the end exactly.
  - `should_map_the_size_slider_logarithmically (AC-19)`:
    - `brushSizeAt(0) = 1`, `brushSizeAt(1) = 1000`, `brushSizeAt(0.5) = 32` (round(√1000) = 32);
    - `brushSizeAt(brushSliderAt(n)) = n` for n in 1, 7, 40, 999.
  - `should_default_to_40_screen_px (AC-19, Review Focus 4)`:
    - `defaultBrushSize(0.1) = 400`
    - `defaultBrushSize(64) = 1`
    - `defaultBrushSize(0.01) = 1000`
  - `should_size_the_loupe_circles (AC-20)`:
    - size 20 at k = 1, hardness 1: outer = 10 × `loupeScale(1)`, inner null;
    - hardness 0.5: inner = outer / 2.
- [ ] **Step 2: Run them.** Run `npx vitest run src/core/geometry/smooth src/core/editor/lasso src/core/editor/brush`. Expected: FAIL, because the modules and functions aren't defined.
- [ ] **Step 3: Implement.**
  - `smoothPath`: Chaikin on the open edges, keeping the first and last points (n → 2(n−1) points per pass).
  - `continueAt`: `canvasToImage` of `imageToCanvas(end) + (finger − down)`, so a still finger returns the end bit-exactly. If the round trip isn't exact, return `end` when finger equals down.
- [ ] **Step 4: Run them again.** Expected: PASS. Then run `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: lasso and brush helpers (spec 0011)`, with `Refs #75 #76 #77 #79 #80`.

### Task 2: fitRing and the render worker job (#79)

**Files:**
- Modify: `src/core/selection/density.ts`, `src/core/selection/index.ts`
- Test: `src/core/selection/density.test.ts`, plus a new `src/core/selection/fitRing.perf.test.ts`
- Modify: `src/workers/protocol.ts`, `src/workers/renderHandler.ts` (+ test), `src/services/workerClient.ts` (+ test), and the `Renderer` interface in `src/ui/editor/session.ts`

**Interfaces:**
- Consumes: `InvalidLassoError` from `src/core/geometry/lasso.ts`, and `isDegenerateRing` from `polygon.ts`.
- Produces:
  - `fitRing(path: readonly Point[], tolerancePx: number): Node[]`. Every node is `smooth`. It throws `InvalidLassoError` for fewer than 3 distinct points or a degenerate ring, and `RangeError` for a tolerance outside [0.01, 8].
  - Worker messages `{ type: 'fitRing'; jobId; path: Point[]; tolerancePx }` and the replies `{ type: 'fitted'; jobId; nodes: Node[] }` or `error`.
  - `Renderer.fitRing(path, tolerancePx): Promise<FromRenderWorker | Cancelled>`, newest-wins like `resimplify`.

- [ ] **Step 1: Write the failing tests** in `density.test.ts`.
  - `should_fit_a_ring_within_tolerance_both_ways (AC-15)`, a seeded property test. For 30 paths (noisy circles of radius 20–400 with ±2 px noise, squares, and a long thin rectangle) and tolerances in {0.25, 0.5, 2, 8}: every point of the path resampled every 0.1 px is within the tolerance of the curve sampled every 0.1 px, and the reverse. Use brute-force distances in the test helper; the paths are small.
  - `should_give_fewer_dots_than_points (AC-15)`: a noisy circle of radius 400 with 2,000 points at tolerance 2 gives under 100 dots.
  - `should_reject_a_lasso_that_is_not_a_ring (AC-10)`: two points, and points all on one line, throw `InvalidLassoError`.
  - `should_fit_a_long_straight_closing_edge (Review Focus 2)`: a path whose last-to-first edge is 300 px long still meets the two-way check.
- [ ] **Step 2: Run them.** Run `npx vitest run src/core/selection/density`. Expected: FAIL, because `fitRing` isn't exported.
- [ ] **Step 3: Implement `fitRing` in `density.ts`, reusing its private helpers.**
  1. Validate the input. Resample the closed path so that consecutive points are ≤ 0.1 px apart; these are `ctx.pts`, with no corners.
  2. Set `limit = tolerancePx × CHECK_MARGIN`, and pick the dots with `pickByRdp(ctx, [])`.
  3. Run `repair(ctx, picked)`. Do **not** run `removeDots`: it is what made `resimplifyRing` take 0.7–1.3 s.
  4. If `repair` returns null, retry with the picks of `simplifyRingIndices(ctx.pts, limit / 4)`. If that fails too, return one smooth dot every `max(0.5, tolerancePx)` px along the path.
- [ ] **Step 4: Write `fitRing.perf.test.ts`.** `should_fit_a_10000_px_path_in_under_1_s (AC-27)`: a seeded noisy closed path 10,000 px long (±3 px wobble, one point every 4 px), at tolerance 8. Take the best of 3 runs, and expect < 1000 ms. Run it with `npm run test:perf -- fitRing`. Expected: PASS. If it fails, profile `repair`; the spec stands.
- [ ] **Step 5: Write the worker tests, then run them to see them fail.**
  - `should_fit_a_ring_in_the_worker (AC-27)` in `renderHandler.test.ts`: the reply equals `fitRing` called directly; a degenerate path replies `error`.
  - `should_cancel_an_older_fitRing (AC-27)` in `workerClient.test.ts`, modelled on the `resimplify` test.
- [ ] **Step 6: Implement the protocol case, the handler case and the client method.** Add `fitRing` to `Renderer`, and to every fake renderer the typecheck flags.
- [ ] **Step 7: Check and commit.** Run `npm test`, `npm run typecheck` and `npm run lint`; all must be green. Commit `feat: fit a lasso ring in the render worker (spec 0011 AC-15, AC-27)`, with `Refs #79`.

### Task 3: The live-wire worker in the editor (#77)

**Files:**
- Modify: `src/ui/editor/session.ts` (+ `session.test.ts`), `src/ui/editor/EditorScreen.tsx` (props), `src/App.tsx`

**Interfaces:**
- Produces:
  - `export interface Snapper { setImage(imageId: string, image: RgbaImage): void; snap(imageId: string, finger: Point[], reachPx: number): Promise<FromLiveWireWorker | Cancelled> }` in `session.ts`;
  - `EditorScreenProps.createSnapper?(): Snapper`;
  - `session.snapper: Snapper | null`;
  - `session.photoId: string | null`, if not already exposed.
- `App` passes `createSnapper={startLiveWireWorker}`.

- [ ] **Step 1: Write the failing test** `should_give_each_photo_to_the_snapper (AC-11)` in `session.test.ts`. It uses a fake snapper; showing a photo calls `setImage` once with that photo's id and a copy of its pixels, separate from the renderer's copy, because the transfer detaches the buffer.
- [ ] **Step 2: Run it.** Run `npx vitest run src/ui/editor/session`. Expected: FAIL.
- [ ] **Step 3: Implement.** Create the snapper lazily, like the renderer, and call `setImage(id, copyImage(image))` in `show`.
- [ ] **Step 4: Check and commit.** Run `npm test` and `npm run typecheck`; expected PASS. Commit `feat: give photos to the live-wire worker (spec 0011 AC-11)`, with `Refs #77`.

### Task 4: The Lasso tool on the canvas (#75, #76, #77)

**Files:**
- Create: `src/ui/editor/lassoTool.ts`
- Modify:
  - `src/ui/editor/canvasController.ts`: delegate to the tool, add the inputs and snapshot fields;
  - `src/ui/editor/drawView.ts`: `drawLasso`, plus `outlineOnly` on `DotsLayer`;
  - `src/ui/editor/EditorCanvas.tsx`: coalesced moves and the data hooks.
- Test: `src/ui/editor/EditorCanvas.test.tsx`, in a new `describe('lasso tool')`

**Interfaces:**
- Consumes: Task 1's helpers.
- Produces, in `canvasController.ts`:
  - `EditorTool = 'auto' | 'lasso' | 'dots' | 'brush' | 'view'`.
  - `CanvasInputs` gains:
    - `lasso?: { sections: readonly LassoSection[]; busy: boolean }`: the open lasso, null or undefined when none;
    - `snap?(finger: Point[], reachPx: number): Promise<Point[] | null>`: live trail only; null on failure or cancel;
    - `snapOn?: boolean`;
    - `onLassoSection?(section: DrawnSection): void`.
  - `DrawnSection { points: Point[]; k: number; closes: boolean }`. `points` are finger image px: deduped at 0.5 px with spec 0002's recorder, starting at the press-down point, or at `continueAt(...)` points for a continuation. `k` is the display scale when the drag started.
  - `CanvasSnapshot.lasso: 'none' | 'drawing' | 'paused' | 'busy'` and `lassoPoints: number`.
- `lassoTool.ts` exports `createLassoTool(ctx: ToolContext)`. Its handlers are `down(canvasPt)`, `moveRaw(canvasPt)`, `begin(canvasPt)`, `move(canvasPt)`, `end(canvasPt)`, `cancel()`, plus `layer(): LassoLayer | null` and `state()`. `ToolContext` is the small interface the controller passes: `inputs()`, `viewport()`, `view()`, `schedule()`, `emit()`, `setLoupe(at, aim)`, `now()`. The brush tool reuses the same `ToolContext` in Task 6.

- [ ] **Step 1: Write the failing tests.** Drive pointer events the way the existing dots-tool tests do.
  - `should_start_a_lasso_where_the_finger_went_down (AC-1)`: a drag from (100, 100) to (160, 100) in steps emits nothing until lift. On a lift far from the start, `onLassoSection` gets points that start at `canvasToImage((100, 100))` and include the samples before the 10 px slop, with `closes: false`. `data-lasso` is `drawing` during the drag.
  - `should_record_coalesced_samples (AC-1)`: a pointermove whose `getCoalescedEvents()` returns 3 events adds 3 points.
  - `should_show_the_loupe_on_the_finger (AC-3)`: during a lasso drag the loupe's `data-aim` is the finger's image point.
  - `should_close_when_lifting_near_the_start (AC-4)`: a square path that returns to within 10 px of its start emits `closes: true`; a short 30 px drag that comes back emits `closes: false`.
  - `should_continue_only_from_the_end_handle (AC-5, AC-6)`: with `lasso` = one paused section, a drag starting 15 px from its end emits a section whose first point is the end, exactly; one starting 60 px away emits nothing; a tap emits nothing. `data-lasso` is `paused`.
  - `should_keep_the_section_when_a_second_finger_lands (AC-7)`: a drag, then a second pointer down, emits the section so far with `closes: false`, and the view starts pinching.
  - `should_ignore_the_handle_while_busy (Review Focus 5)`: with `lasso.busy` true, a drag from the end emits nothing, and `data-lasso` is `busy`.
  - `should_snap_the_trail_while_drawing (AC-11)`: with `snapOn` and a deferred `snap`, only one request is in flight; moves meanwhile don't call it again; when it resolves, the newest trail is requested next. The reach passed is `snapReachPx(k)`.
- [ ] **Step 2: Run them.** Run `npx vitest run src/ui/editor/EditorCanvas`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement `lassoTool.ts` and wire it into the controller.**
  - **Recording:** record from `toolStart` and `toolMove` (raw points, before the slop). `aimStart` begins the section, and only a fresh lasso or a press within 22 px of the end handle begins one (and not while `busy`).
  - **Ending:** `cancel` emits the section so far, if it has a point beyond the start.
  - **Closing:** `end` emits with `closes = closesOnLift(all lasso points converted at the current view)`.
  - **Coalesced moves:** in `EditorCanvas`, call `pointerMove` once per coalesced event when `getCoalescedEvents` exists and returns more than one.
  - **Drawing:** in `drawView.ts`, `drawLasso(ctx, f, layer)` draws the sections and the current drag as one path: a 2 px white line over a 1 px dark outline (draw the dark line at 4 px under the white line at 2 px). It adds the 8 px start dot, the 20 px accent end ring (paused only) and the snap trail. The Lasso tool also draws the selection outline with `outlineOnly: true`. Cache a `Path2D` per sections array.
- [ ] **Step 4: Run and commit.** Run `npx vitest run src/ui/editor` and `npm run typecheck`; expected PASS. Commit `feat: lasso tool on the canvas (spec 0011 AC-1 to AC-7, AC-11)`, with `Refs #75 #76 #77`.

### Task 5: useLasso, the Lasso sheet, the toolbar and the wiring (#76, #77, #78, #79)

**Files:**
- Create: `src/ui/editor/useLasso.ts`, `src/ui/editor/LassoSheet.tsx`
- Modify: `src/ui/editor/Toolbar.tsx`, `src/ui/editor/EditorScreen.tsx`, `src/ui/editor/EditorScreen.css`
- Test: `src/ui/editor/EditorScreen.test.tsx`, in a new `describe('lasso tool')`. Extend its fake renderer with `fitRing` (it calls the real `fitRing`, deferrable like `deferredResimplify`) and add a fake snapper.

**Interfaces:**
- Consumes:
  - Task 1: `joinSections`, `ringTolerance`, `sectionTolerance`, `snapReachPx`;
  - Task 2: `Renderer.fitRing`;
  - Task 3: `session.snapper`;
  - Task 4: the canvas inputs and `DrawnSection`.
- Produces: `useLasso(session, { onFinished(): void })`, returning:
  - `open: { sections; busy } | null`;
  - `mode: 'add' | 'subtract'`, `snapOn`, `smoothing`, and their setters;
  - `notice: string | null`;
  - `addSection(d: DrawnSection)`, `undoSection()`, `finish()`, `discard()`, `drop()` (on a new photo or sticker);
  - `liveSnap(finger, reachPx)`, for the canvas's `snap` input.

- [ ] **Step 1: Write the failing tests.**
  - `should_show_five_tools (AC-23)`: the toolbar buttons, in order, are Auto, Lasso, Dots, Brush, View.
  - `should_open_lasso_from_use_lasso_only_in_auto (AC-23)`: with the engines unavailable, "Use Lasso" shows in Auto and opens the Lasso tool (pressed). It isn't shown in the Dots tool.
  - `should_show_the_lasso_hints_and_controls (AC-24)`: the hint switches between the two copies as a lasso opens. "Subtract" is disabled with no rings. "Finish" and "Discard" are disabled with no lasso open. By default Add is checked, "Snap to edges" is off and Smoothing is 1.
  - `should_add_a_closed_lasso_as_one_step_and_open_dots (AC-14, AC-15, AC-16)`: a canvas section with `closes: true` around a square calls `fitRing` with `joinSections(..., 1)` and `ringTolerance`. On the result, the selection gains one `add` ring equal to the fitted nodes; the tool is Dots with `data-selected-count="0"`; one Undo removes the ring.
  - `should_subtract_a_ring (AC-14)`: Subtract, with the seeded rectangle selection, adds a `subtract` ring.
  - `should_undo_the_last_section_while_open (AC-8)`: with two paused sections, Undo leaves one, and Redo is disabled; Undo again leaves no lasso; the selection history is unchanged.
  - `should_finish_and_discard (AC-9)`: Finish closes the 2-section lasso the same way as AC-15; Discard drops it, with no undo step.
  - `should_keep_an_invalid_lasso_open (AC-10)`: a closing section that is a straight line keeps the lasso open, shows "Draw around the area to cut out", and calls no `fitRing`.
  - `should_snap_each_section_on_lift (AC-11)`: with Snap on, a section goes to `snap` with `snapReachPx(k)`. While the snap is pending the lasso is `busy`. The resolved path becomes a section with `snapped: true` and tolerance 0.5, its first point replaced by the previous section's end.
  - `should_keep_the_finger_line_when_snapping_fails (AC-13)`: a snap error keeps the raw section and shows "Couldn't snap to edges here, kept your line".
  - `should_add_to_the_newest_selection (Review Focus 1)`: an Auto result lands while `fitRing` is deferred. The ring is applied to the new selection with `addRing`, so one Undo keeps the Auto result.
  - `should_drop_the_lasso_on_a_new_photo (AC-8, Decision 8)`: an open lasso survives switching to View and back, and is gone after picking another photo; a pending fit's result is ignored.
- [ ] **Step 2: Run them.** Run `npx vitest run src/ui/editor/EditorScreen.test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - **`useLasso`:** sections live in state. `addSection` snaps the section if `snapOn` and marks the lasso busy, then appends it. If the section closes, `close()` checks the joined path with `isDegenerateRing` (fewer than 3 points also fails) and calls `renderer.fitRing(path, ringTolerance)`. On `fitted`, if the photo id is unchanged, it calls `session.edit({ type: mode === 'add' ? 'addRing' : 'subtractRing', nodes })`, then drops the lasso and calls `onFinished`. On `error` it keeps the lasso open with the AC-10 notice. A `generation` counter makes stale results no-ops.
  - **`LassoSheet`:** follow `DotsSheet`'s structure and CSS classes; the radiogroup follows `ToolSheet`'s arrow-key pattern.
  - **`EditorScreen`:**
    - the canvas gets `lasso`, `snap`, `snapOn` and `onLassoSection`;
    - Undo calls `undoSection` when the tool is Lasso and a lasso is open, and Redo is disabled then;
    - "Use Lasso" shows only in Auto and calls `chooseTool('lasso')`;
    - the notice joins the status lines and clears on the next lasso action;
    - the hint reads "Making dots…" while busy during a close.
- [ ] **Step 4: Run and commit.** Run `npm test`, `npm run typecheck` and `npm run lint`; all must be green. Commit `feat: lasso sheet, snapping, add/subtract and dots (spec 0011 AC-8 to AC-16, AC-23, AC-24)`, with `Refs #76 #77 #78 #79`.

### Task 6: The Brush tool (#80)

**Files:**
- Create: `src/ui/editor/brushTool.ts`, `src/ui/editor/BrushSheet.tsx`
- Modify: `canvasController.ts`, `drawView.ts` (`drawStrokeBand`, and loupe circles via `drawLoupe`'s new `brush` field), `Loupe.tsx` (`data-brush-radius`), `EditorCanvas.tsx` (handle `displayScale()`), `EditorScreen.tsx`, `EditorScreen.css`
- Test: `EditorCanvas.test.tsx` (`describe('brush tool')`), `EditorScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1's brush helpers and Task 4's `ToolContext`.
- Produces:
  - `CanvasInputs.brush?: { mode: 'erase' | 'restore'; sizePx: number; hardness: number }`, with hardness in [0, 1] as in `BrushStroke`;
  - `EditorCanvasHandle.displayScale(): number | null`;
  - `CanvasSnapshot.loupe.brush?: { outer: number; inner: number | null }`.

- [ ] **Step 1: Write the failing tests.**
  - `should_paint_one_stroke_per_drag (AC-18)` (canvas): a drag calls `onEdit({ type: 'addStroke', stroke: { mode: 'erase', sizePx: 24, hardness: 1, points } }, [])` once, on lift. `points` starts at the press-down image point and includes the samples before the slop.
  - `should_cancel_a_stroke_on_a_second_finger (AC-18)`: a drag plus a second pointer gives no `onEdit`.
  - `should_dab_on_a_tap_and_zoom_on_a_double_tap (AC-18)`: one tap gives a one-point stroke after 250 ms; a double-tap gives none and changes `data-zoom`.
  - `should_preview_the_stroke_while_painting (AC-21)`: during the drag, `renderMask` is called with a selection whose last stroke has the points so far, one render at a time.
  - `should_show_the_brush_in_the_loupe (AC-20)`: during a drag, the loupe's `data-brush-radius` equals `loupeBrushRadii(24, 0.5, k)` formatted as `outer,inner`, and only `outer` at hardness 1.
  - `should_show_size_and_hardness (AC-19)` (screen):
    - opening Brush at a display scale of 0.5 shows "Size 80 px" and "Hardness 100%";
    - moving the Size slider to `brushSliderAt(7)` shows "Size 7 px";
    - zooming doesn't change the text;
    - Erase is checked.
  - `should_use_the_current_settings_for_a_stroke (AC-18, AC-19)` (screen): Restore at 50% hardness gives a stroke with `mode: 'restore'` and `hardness: 0.5`.
  - `should_restore_with_no_rings (AC-22)` (screen): on an empty selection a Restore stroke is recorded, and `lastRendered()` has the stroke.
  - `should_show_the_brush_hints (AC-24)` (screen).
- [ ] **Step 2: Run them.** Run `npx vitest run src/ui/editor`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - **`brushTool`:** records like the lasso tool. The preview is `applyCommand(p.selection, { type: 'addStroke', stroke })` through the controller's existing `preview` and `renderPreview`.
  - **`drawStrokeBand`:** strokes the points with `lineWidth = sizePx × k`, round caps and joins, in the AC-21 colours.
  - **`BrushSheet`:** follows `DotsSheet`.
  - **`EditorScreen`:** keeps `brush` state per photo id. When Brush opens on a photo for the first time, the size is `defaultBrushSize(canvasRef.current.displayScale())`.
- [ ] **Step 4: Run and commit.** Run `npm test`, `npm run typecheck` and `npm run lint`; all must be green. Commit `feat: erase and restore brush (spec 0011 AC-18 to AC-22, AC-24)`, with `Refs #80`.

### Task 7: Touch, screenshots and speed (e2e) (#75–#80)

**Files:**
- Create: `e2e/helpers/lasso.ts` (`openLasso`, `openBrush`, `trace(page, f, pts, {lift})`), `e2e/lasso.spec.ts`, `e2e/brush.spec.ts`
- Modify: `e2e/editor-screens.spec.ts`, `e2e/editor-speed.spec.ts`
- Delete: the baselines `e2e/__screenshots__/editor-screens.spec.ts/{dots,layout}-*.png`, because the toolbar changes; CI re-makes them.

The tests use the seed photo: 120 × 80, with colour quadrants split at x = 60 and y = 40. Convert with `data-display-scale` and `data-center`, as `e2e/helpers/dots.ts` does, and reuse its `finger`, `zoomAt`, `cutoutAlpha` and `cutoutAlphas`.

- [ ] **Step 1: Write the specs.**
  - `should_close_a_traced_lasso_into_dots (AC-1, AC-4, AC-16)`, on an empty selection: a touch trace around image (30, 20)–(90, 60) that returns to its start. Then `data-tool="dots"` and `data-dot-count` > 3; the cutout alpha at (60, 40) is 255 and at (10, 10) is 0.
  - `should_pause_zoom_and_continue (AC-5, AC-6)`: trace half, lift, `zoomAt` ×2 and pan with two fingers, drag from the end handle around the rest, and close. One ring is added, and `data-lasso-points` grew on the continue.
  - `should_snap_to_the_colour_edge (AC-12)`: Snap on. Trace a rectangle whose left side runs along x = 60, with seeded wobble of ±0.5 × reach. Every cutout alpha at x = 58.5 on rows 25–55 is 0, and at x = 61.5 it is 255. With Snap off, the same trace leaves at least one row wrong.
  - `should_subtract_a_hole (AC-14)`: Subtract over the seeded rectangle, around (40, 30)–(80, 50). The alpha at (60, 40) is 0 and at (20, 20) is 255.
  - `should_trace_off_the_photo (Review Focus 3)`: a lasso partly beyond the photo's right edge closes, and the alpha at (115, 40) is 255.
  - `should_erase_and_restore_with_the_brush (AC-18, AC-21)`: Erase across (60, 40) with size 10 makes the alpha there 0; Restore over it makes it 255; two Undos bring back the original.
  - `should_fit_the_sheets (AC-24)` at 375 × 812: both sheets' controls are ≥ 44 × 44, and the canvas is ≥ 300 px tall.
- [ ] **Step 2: Add the screenshots.** In `editor-screens.spec.ts`, add `should_match_the_lasso_tool (spec 0011 AC-25)` (an open lasso with a deterministic mouse path) and `should_match_the_brush_tool (spec 0011 AC-25)`, at 375 and 430, in light and dark.
- [ ] **Step 3: Add the speed test.** In `editor-speed.spec.ts`, add `should_draw_lasso_and_brush_frames_under_8_ms (AC-26)`: a 12 MP photo with a 2,000-node ellipse. Trace a 5,000-step mouse lasso, then measure 30 frames while tracing on, and 30 while brushing. The median of each is under 8 ms.
- [ ] **Step 4: Run the e2e.** Run `npm run build && npx playwright test e2e/lasso.spec.ts e2e/brush.spec.ts e2e/editor-speed.spec.ts --workers=2`. Expected: PASS. Screenshot tests skip locally, and their baselines come from CI.
- [ ] **Step 5: Commit** `test(e2e): lasso and brush touch, screenshots and speed (spec 0011)`, with `Refs #74`.

### Task 8: Decisions and docs (#74)

**Files:** Modify `docs/decisions.md` (a "Lasso and brush decisions (spec 0011)" section: decisions 1–11, the plan's AC-8 ruling, and any ledger rulings) and `STICKER_WEBAPP_PLAN.md` (tick Phase 8's Lasso and Brush lines). `docs/licenses.md` is unchanged, since there are no new dependencies.

- [ ] **Step 1: Write the docs.** Then run `npm run format:check`; expected: clean.
- [ ] **Step 2: Commit** `docs: lasso and brush decisions (spec 0011)`, with `Refs #74`.
