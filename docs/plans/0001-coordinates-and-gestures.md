# Coordinates, gestures and hit-testing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pure-TypeScript core that maps touches to exact image pixels, turns pointer events into tool-vs-view actions, does pinch/pan math, and hit-tests dots and edges.

**Architecture:** Four small modules under `src/core/` (`coords`, `gestures`, `geometry/hitTest`), all plain functions or one small state machine over plain data. No DOM, no React. Every module is covered by table tests, property-style loops and edge-case tests that run in Node via Vitest.

**Tech Stack:** TypeScript 6.0 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest 5. No new dependencies.

**Spec:** `docs/specs/0001-coordinates-and-gestures.md` (issues #9, #10, #11, #12, #13)

## Global Constraints

- `src/core/` must not import DOM, React or browser APIs, and must not use `window`, `document`, `navigator` (enforced by lint in Task 1).
- Coordinates are image pixels (float); name variables `imagePt`, `canvasPt`, `screenPt`, `devicePt`.
- Zoom range is **1 to 16**, relative to fit. Touch radius default **22** CSS px. Round-trip error **< 0.01** image px.
- Test names are `should_...`; each test mentions its AC id in a comment or the name (e.g. `// AC-1`).
- Coverage for `src/core/` must be at least 90%.
- Conventional Commits; one commit per task; branch `feat/10-13-coordinates-and-gestures`.

## Review Focus

Inputs the spec implies but its ACs don't spell out. Each is pinned by a test in the owning task and added to the spec as an AC (AC-19 to AC-22).

1. Zero or negative canvas/image size, or non-positive dpr: throw `RangeError` instead of returning NaN (Task 1).
2. Fractional dpr such as 2.625 (common on Android) and fractional canvas sizes: round-trip still < 0.01 px (Task 1).
3. Two fingers at the exact same point at gesture start (start distance 0): no zoom change, no NaN, pan still works (Task 2).
4. `cancel` event for one of two active pointers, and a `down` event for a pointer id that is already down: handled without throwing or emitting a stray tool action (Task 3).
5. Empty node list or edge list, and a polyline edge with duplicate points (zero length): returns `null` / `t = 0`, never NaN (Task 4).

---

### Task 1: Primitives and coordinate transforms (#10)

**Files:**
- Create: `src/core/geometry/types.ts`, `src/core/coords/types.ts`, `src/core/coords/transform.ts`
- Test: `src/core/coords/transform.test.ts`
- Modify: `eslint.config.js` (core-purity rule), `vite.config.ts` (coverage threshold for `src/core/**`)

**Interfaces:**
- Produces:
  - `geometry/types.ts`: `interface Point { x: number; y: number }`, `interface Size { width: number; height: number }`, `interface Bounds { minX: number; minY: number; maxX: number; maxY: number }`
  - `coords/types.ts`: `interface Viewport { canvas: Size; image: Size; dpr: number }`, `interface View { zoom: number; center: Point }`, `const MIN_ZOOM = 1`, `const MAX_ZOOM = 16`
  - `coords/transform.ts`: `assertViewport(vp): void` (throws `RangeError`), `fitScale(vp): number`, `viewScale(vp, view): number`, `initialView(vp): View` (zoom 1, center = image middle), `canvasToImage(vp, view, canvasPt): Point`, `imageToCanvas(vp, view, imagePt): Point`, `screenToCanvas(origin: Point, screenPt: Point): Point`, `canvasToDevice(vp, canvasPt): Point`

- [ ] **Step 1: Write the failing tests** in `transform.test.ts`:
  - `should_round_trip_within_0_01_px_for_all_dpr_zoom_and_pan` (AC-1): loop dpr ∈ {1, 2, 2.625, 3}, zoom ∈ {1, 1.5, 4, 16}, a 3×3 grid of centers inside the image, a 3×3 grid of canvasPts; assert `|imageToCanvas(canvasToImage(p)) − p| < 0.01`.
  - `should_center_a_letterboxed_image_at_zoom_1` (AC-2): portrait image 300×600 in 400×400 canvas, and landscape 600×300 in 400×800 canvas; map the 4 corners with `imageToCanvas` and assert the image touches the canvas on the limiting axis and the margins on the other axis are equal.
  - `should_match_hand_computed_points` (AC-3): `it.each` table with at least 6 rows (center, corners, an off-image margin point, a zoom-4 off-center view); off-image points come out outside `[0,width]×[0,height]`.
  - `should_subtract_origin_and_scale_by_dpr` (AC-4).
  - `should_throw_range_error_for_degenerate_viewports` (AC-19): zero canvas width, negative image height, `dpr = 0`, `NaN` zoom in a view passed to `viewScale`.
- [ ] **Step 2: Run** `npm test -- transform` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the signatures above. `scale = fitScale × zoom`; `imagePt = center + (canvasPt − canvasCenter) / scale` and its inverse. Add an ESLint block for `src/core/**` using `no-restricted-globals` (`window`, `document`, `navigator`, `localStorage`) and `no-restricted-imports` (`react`, `react-dom`). In `vite.config.ts` set `test.coverage.thresholds` to `{ 'src/core/**': { lines: 90, functions: 90, branches: 90, statements: 90 } }` so only core is gated at 90%.
- [ ] **Step 4: Run** `npm test -- transform && npm run lint && npm run typecheck` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(core): add coordinate transforms with exact image-pixel mapping`

---

### Task 2: Pinch, pan and zoom math (#12)

**Files:**
- Create: `src/core/coords/view.ts`
- Test: `src/core/coords/view.test.ts`

**Interfaces:**
- Consumes: `Viewport`, `View`, `MIN_ZOOM`, `MAX_ZOOM`, `viewScale`, `canvasToImage`, `initialView` (Task 1)
- Produces: `clampView(vp: Viewport, view: View): View`, `applyTwoFingerGesture(vp: Viewport, startView: View, startPts: readonly [Point, Point], nowPts: readonly [Point, Point]): View`, `toggleActualSize(vp: Viewport, view: View, canvasPt: Point): View`

- [ ] **Step 1: Write the failing tests** in `view.test.ts`:
  - `should_keep_the_anchor_image_point_under_the_midpoint` (AC-5): for 5 gestures (pure zoom, pure pan, both, zoom out, rotated fingers) starting at a view where no clamp can trigger (zoom 4, center mid-image), assert `canvasToImage(vp, result, nowMid)` equals `canvasToImage(vp, startView, startMid)` within 0.01.
  - `should_clamp_zoom_between_1_and_16` (AC-6): a spread that asks for zoom 40 gives 16; a pinch that asks for 0.2 gives 1.
  - `should_clamp_center_inside_the_image_and_fix_axes_that_fit` (AC-7): `clampView` with a center far outside gives a center on the image edge; at zoom 1 on a letterboxed axis the center on that axis is the image middle; at zoom 4 both axes are free within `[0, size]`.
  - `should_toggle_actual_size_anchored_at_the_tap_and_back_to_fit` (AC-8): from zoom 1, result has `viewScale = 1/dpr` (use an image large enough that this lies within 1–16; assert clamped otherwise), the tapped imagePt stays under the tap; calling again returns zoom 1.
  - `should_ignore_zoom_when_start_fingers_coincide` (AC-20): `startPts` identical → zoom unchanged, no NaN, pan applied.
- [ ] **Step 2: Run** `npm test -- view` — Expected: FAIL.
- [ ] **Step 3: Implement.** New zoom = `clamp(startView.zoom × nowDist/startDist)` (ratio 1 when `startDist` is 0); then choose `center` so the imagePt under `startMid` (computed with `startView`) maps to `nowMid` under the new scale; finally `clampView`. `toggleActualSize` compares current zoom to the actual-size zoom with a 1% tolerance to decide whether to return to fit.
- [ ] **Step 4: Run** `npm test -- view && npm run lint && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add pinch, pan and actual-size view math`

---

### Task 3: Gesture state machine (#11)

**Files:**
- Create: `src/core/gestures/machine.ts`, `src/core/gestures/types.ts`
- Test: `src/core/gestures/machine.test.ts`

**Interfaces:**
- Consumes: `Point` (Task 1)
- Produces:
  - `type PointerEventIn = { type: 'down' | 'move' | 'up' | 'cancel'; pointerId: number; point: Point }`
  - `type GestureAction = { type: 'toolStart' | 'toolMove' | 'toolEnd' | 'toolCancel'; point: Point } | { type: 'viewStart' | 'viewUpdate' | 'viewEnd'; points: readonly [Point, Point] }`
  - `createGestureMachine(): { dispatch(event: PointerEventIn): GestureAction[]; reset(): void }`
  - States (internal): `idle`, `tool`, `view`, `ignoring` (after a view gesture or cancel, until all pointers are up)

- [ ] **Step 1: Write the failing tests** in `machine.test.ts` with a small helper that feeds an event list and returns the flat action type list:
  - `should_emit_tool_start_move_end_for_one_pointer` (AC-9).
  - `should_cancel_the_tool_once_then_start_the_view_when_a_second_pointer_lands` (AC-10).
  - `should_emit_only_view_updates_while_two_pointers_move` (AC-11).
  - `should_not_resume_a_stroke_after_one_of_two_pointers_lifts` (AC-12): after `viewEnd`, a further `move`/`down` of the remaining pointer yields no `tool*`; after all up, a new down starts a tool stroke.
  - `should_never_emit_tool_actions_after_cancel_for_every_lift_order` (AC-13): enumerate all permutations of lift order for 2 and 3 pointers, with `up` and `cancel` variants and a simultaneous-lift variant; assert no `tool*` after `toolCancel`, and the machine is idle afterwards (a fresh single stroke works).
  - `should_ignore_a_third_pointer_while_two_are_active` (AC-13).
  - `should_ignore_unknown_pointer_ids` (AC-14).
  - `should_handle_cancel_for_one_of_two_pointers_and_duplicate_down` (AC-21): no throw, no stray tool action.
- [ ] **Step 2: Run** `npm test -- machine` — Expected: FAIL.
- [ ] **Step 3: Implement** the signatures. Track active pointers in a `Map<number, Point>`; `view` gestures use the first two pointers by insertion order. `toolCancel` fires only if a tool stroke is in progress.
- [ ] **Step 4: Run** `npm test -- machine && npm run lint && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add gesture state machine (tool vs pinch/pan)`

---

### Task 4: Hit-testing for dots and edges (#13)

**Files:**
- Create: `src/core/geometry/hitTest.ts`
- Test: `src/core/geometry/hitTest.test.ts`

**Interfaces:**
- Consumes: `Point`, `Viewport`, `View`, `imageToCanvas` (Task 1)
- Produces: `nearestNode(nodes: readonly Point[], canvasPt: Point, vp: Viewport, view: View, radiusPx = 22): { index: number; distancePx: number } | null`, `nearestEdge(edges: readonly (readonly Point[])[], canvasPt: Point, vp: Viewport, view: View, radiusPx = 22): { edgeIndex: number; t: number; imagePt: Point; distancePx: number } | null`

- [ ] **Step 1: Write the failing tests** in `hitTest.test.ts`:
  - `should_find_the_nearest_node_within_22_px_at_zoom_1_and_16` (AC-15): a node 21.9 px away hits, 22 px hits (inclusive), 22.1 px misses; at both zoom levels the screen distance, not image distance, decides.
  - `should_break_ties_by_lowest_index_for_nodes_and_edges` (AC-16).
  - `should_return_edge_index_arc_length_t_and_closest_point` (AC-17): straight edge `[(0,0),(100,0)]`, touch above x=25 → `t = 0.25`; a bent 2-segment polyline gives `t` by arc length; farther than the radius gives `null`.
  - `should_test_nodes_and_edges_independently` (AC-18).
  - `should_return_null_for_empty_input_and_handle_zero_length_edges` (AC-22): empty arrays → `null`; an edge of two identical points gives `t = 0`, no NaN.
- [ ] **Step 2: Run** `npm test -- hitTest` — Expected: FAIL.
- [ ] **Step 3: Implement.** Convert candidates to canvas space with `imageToCanvas` and measure in canvas px; for edges, project onto each polyline segment (clamped), keep the minimum, tie → lowest edge index then lowest segment; `t` = cumulative arc length to the projection divided by total length (0 for zero-length edges).
- [ ] **Step 4: Run** the full verification: `npm run lint && npm run typecheck && npm run test:coverage` — Expected: all PASS, `src/core/` coverage ≥ 90%.
- [ ] **Step 5: Commit** `feat(core): add node and edge hit-testing`

---

### Done when
All four tasks committed on the branch, CI green, spec 0001 status set to Implemented in the same PR, issues #9–#13 closed by the PR (`Closes #9 … #13`).
