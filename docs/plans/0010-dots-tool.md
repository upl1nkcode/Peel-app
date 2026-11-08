# Dots tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Dots tool in the editor. The user can:
- drag the outline's dots onto the exact edge, with fine mode and a loupe
- add dots by tapping the line, delete them by double-tapping, and switch corner/curve by holding
- box-select dots and move them together
- nudge by 1 image px, change the dot density, and start from a rectangle or ellipse

**Architecture:**
- **Pure (`src/core/editor/dots.ts`):** hit-testing on the drawn curves, box selection, drag positions with fine mode, the density slider's mapping, starting shapes, and keeping dot refs valid after a delete.
- **Worker:** the render worker gains a `resimplify` job, newest-wins like `render`, so the slider never blocks the main thread.
- **UI:** the canvas controller gains the `dots` tool. It draws the outline and dots, maps press intents to edits, previews drags, and renders the preview newest-first. The screen holds the dot selection, tied to the selection it belongs to, plus the Dots sheet.

**Tech Stack:** TypeScript 6 (strict), React 19, Vitest + RTL (jsdom), Playwright (CDP touch on Chromium). No new dependencies.

**Spec:** `docs/specs/0010-dots-tool.md` (story #65; #66–#73)

## Global Constraints

- **Purity:** `src/core/` has no DOM, React or browser imports or globals. Coordinates are image px floats, never rounded. Names say `canvasPt` or `imagePt`.
- **Constants, from the spec:**
  - hit radius `TOUCH_RADIUS_PX = 22` (existing); dots win over edges, and the nearest dot wins
  - `FINE_HOLD_MS = 300`, `FINE_STILL_PX = 2`, `FINE_FACTOR = 0.25`
  - dots: `DOT_PX = 8`, `DOT_SELECTED_PX = 12`, dot outline 1.5 px; line 1 px white with a 1 px dark outline
  - shapes: `SHAPE_FRACTION = 0.6`; the ellipse has `ELLIPSE_NODES = 8`
  - density: `s < 0 → 0.5 × 16^(−s)`, `s > 0 → 0.5 × 0.02^(s)`, and `s = 0 →` null
  - insert accuracy ≤ 0.01 image px; nudge exactly 1 image px
  - frame median < 8 ms over 30 frames
- **Copy is exact:**
  - the toolbar: "Auto", "Dots", "View"
  - the hints: "Drag a dot · Tap the line to add · Double-tap to delete · Hold for corner" and "Start with a shape, or use Auto"
  - the controls: "Fine", "Rectangle", "Ellipse", "Dots", "Fewer", "More"
  - "Nudge left", "Nudge up", "Nudge down", "Nudge right"
- **Test hooks:**
  - The canvas gets `data-tool`, `data-dot-count` (all dots in all rings) and `data-selected-count`, besides the spec 0009 hooks.
  - The loupe keeps `data-aim` and gains `data-fine` (`true`/`false`).
- **Undo steps** use spec 0003's existing commands through `session.edit(command)`. Nothing is added to `Command`.
- **Process:**
  - Test names are `should_...` with the spec 0010 AC id.
  - jsdom has no 2D canvas: drawing is checked in Playwright, and component tests check edits, state and hooks.
  - Coverage: `src/core/` ≥ 90%, overall ≥ 75%.
- **Git:** branch `feat/65-dots-tool`; one commit per task (Conventional Commits, `Refs #N`); the PR closes #65–#73.

## Review Focus

1. **A change under a drag:** an Auto result (the precise one arriving late), undo or a new photo lands while a dot or slider drag is in progress. The drag is dropped: nothing is committed against a selection that's gone, and no stale preview stays on screen (Task 5).
2. **Deleting the 3rd-last dot removes a whole ring:** the selected refs in later rings shift down one ring and still point at the same dots. Selected dots in the removed ring are dropped (Task 1).
3. **The slider is released while a `resimplify` for an older position is still running:** the commit uses the release position's result, never a stale preview (Task 6).
4. **At 16× a dot is dragged past the photo's edge and the canvas's edge:** the position stays finite, unrounded and off-photo, and the mask renders without error (Tasks 2 and 5).
5. **Many dots within 22 px (an Auto ring at fit):** taps pick the nearest dot, never an edge, and a 2,000-dot ring keeps frames under budget (Tasks 1 and 7).

---

### Task 1: Dot helpers (#66, #68, #70, #72, #73)

**Files:**
- Create: `src/core/editor/dots.ts`
- Modify: `src/core/editor/index.ts` (export)
- Test: `src/core/editor/dots.test.ts`

**Interfaces:**
- Consumes:
  - `nearestNode` and `TOUCH_RADIUS_PX` (geometry/hitTest)
  - `toBezierSegments`, `sampleSegment` and `pointOnSegment` (geometry/bezier)
  - `imageToCanvas` and `canvasToImage` (coords)
  - `Selection`, `NodeRef`, `Node`
- Produces:
  - `type DotHit = { kind: 'node'; ref: NodeRef } | { kind: 'edge'; ring: number; afterNode: number; imagePt: Point }`
  - `hitDots(sel: Selection, canvasPt: Point, vp: Viewport, view: View): DotHit | null`. Edges are the drawn curve; each Bézier segment is sampled with a step of at most 1 canvas px. The `imagePt` on an edge is refined on the segment to within 0.01 image px (ternary search on `t`).
  - `nodesInBox(sel, a: Point, b: Point, vp, view): NodeRef[]`. `a` and `b` are canvasPts at opposite corners, in either order; the edges are inclusive.
  - `densityTolerance(s: number): number | null`
  - `startingShape(kind: 'rectangle' | 'ellipse', visible: { x: number; y: number; width: number; height: number }): Node[]`
  - `visiblePhotoRect(vp, view)`: the photo's visible part in image px
  - `refsAfterDelete(sel: Selection, refs: readonly NodeRef[], deleted: NodeRef): NodeRef[]`. It uses the selection before the delete, and handles a whole ring being removed.
  - `sameRings(a: Selection, b: Selection): boolean`: deep-equal rings, ops, kinds and coordinates.

- [ ] **Step 1: Write the failing tests** (viewport 400×300 canvas, 800×600 image, dpr 1, so fit is 0.5 CSS px per image px)
  - `should_hit_the_nearest_dot_before_an_edge (AC-8, AC-11)`:
    - a square ring (100,100)–(300,300) of corners; a tap 5 canvas px from dot 0 hits that node
    - a tap on the middle of edge 0 hits `{edge, ring 0, afterNode 0}`, with `imagePt` within 0.01 of the true point
    - a tap 30 canvas px from everything gives null
  - `should_pick_the_nearest_of_crowded_dots (Review Focus 5)`: 50 dots 1 image px apart. A tap gives the nearest node, never an edge.
  - `should_insert_on_the_drawn_curve (AC-8)`: a smooth 8-node ring. The hit's `imagePt` is within 0.01 image px of the Bézier curve (check by dense sampling).
  - `should_hit_at_16x (AC-3, #66)`: the same square at zoom 16 centred on dot 0. A tap 20 canvas px away hits it; 23 px gives null.
  - `should_select_dots_in_a_box (AC-11)`: corners given in reverse order give the same refs; dots on the box edge are included; the refs span two rings.
  - `should_map_the_slider_to_a_tolerance (AC-15, AC-16)`: −1 → 8, −0.5 → 2, 0 → null, 1 → 0.01 (to 1e-12), 0.5 → 0.5 × √0.02.
  - `should_place_shapes_on_the_visible_photo (AC-17)`:
    - for visible (100,50,400,300), the rectangle is 4 corners at (160,110), (440,110), (440,290) and (160,290)
    - the ellipse is 8 smooth nodes, each satisfying the ellipse equation within 1e-9, centred at (300,200) with radii 120 and 90
  - `should_give_the_visible_photo_rect (AC-17)`: at fit it is the whole photo; zoomed in, it is the view's window, clipped to the photo.
  - `should_keep_refs_on_the_same_dots_after_a_delete (AC-13, Review Focus 2)`:
    - deleting node 1 of a 5-node ring shifts node 3 to node 2
    - deleting from a 3-node ring 0 drops that ring's refs, and ring 1's refs become ring 0
    - the deleted ref itself is dropped
  - `should_compare_rings (AC-16)`: copies are equal; changing one coordinate or a kind makes them different.
- [ ] **Step 2: Run** `npx vitest run src/core/editor`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** in `src/core/editor/dots.ts`.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): dot hit-testing, box select, shapes and density mapping` (Refs #66 #68 #70 #72 #73)

### Task 2: Drag positions and fine mode (#66, #67)

**Files:**
- Modify: `src/core/editor/dots.ts`
- Test: `src/core/editor/dots.test.ts`

**Interfaces:**
- Produces:
  - `startDrag(nodes: readonly Point[], fingerCanvasPt: Point, t: number, vp: Viewport, view: View, fineEnabled: boolean): DotDrag`
  - `dragTo(drag: DotDrag, fingerCanvasPt: Point, t: number): { drag: DotDrag; positions: Point[]; fine: boolean }`
  - `DotDrag` is plain data. It holds the start nodes and the finger's start point, plus the "still" anchor (point and time) and, once engaged, the engage point and the dots at that moment.
- **Movement:** finger movement converts to image px through the view's scale at the start. Positions are `start + delta`, or after engaging `engagedDots + (finger − engagePt) × 0.25`.
- **Engaging:** fine engages when `fineEnabled`, and the finger has stayed within 2 px of the still anchor for ≥ 300 ms (measured on the next `dragTo` call). A move farther than 2 px resets the anchor. Once engaged, it stays on.

- [ ] **Step 1: Write the failing tests** (fit 0.5 CSS px per image px, as Task 1)
  - `should_follow_the_finger_from_where_it_went_down (AC-3)`: a finger moving +10,+4 canvas px moves the dots +20,+8 image px, including the first 10 px. Two dots keep their spacing.
  - `should_follow_at_16x (AC-3, #66)`: zoom 16. Moving +16 canvas px moves 2 image px.
  - `should_go_quarter_speed_after_holding_still (AC-6)`:
    - moves at t 0, 100, 200, 350, staying within 1.5 px of a point from t 50 → `fine` is true at 350
    - then +8 canvas px moves the dot +4 image px (¼ of 16)
    - a 3 px move at t 200 resets the anchor, so `fine` is false at 400 and true at 500
  - `should_stay_one_to_one_with_fine_off (AC-6)`: the same sequence with `fineEnabled` false keeps `fine` false and 1:1 movement.
  - `should_keep_off_photo_positions_unrounded (AC-7, Review Focus 4)`: dragging past the photo edge gives negative and fractional positions, exactly `start + delta`.
- [ ] **Step 2: Run** `npx vitest run src/core/editor`. Expected: FAIL, `startDrag` is not exported.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): dot drag with fine mode` (Refs #66 #67)

### Task 3: Density in the render worker (#72)

**Files:**
- Modify:
  - `src/workers/protocol.ts`
  - `src/workers/renderHandler.ts`
  - `src/services/workerClient.ts`
  - `src/ui/editor/session.ts` (the `Renderer` interface)
- Test:
  - `src/workers/renderHandler.test.ts`
  - `src/services/workerClient.test.ts`

**Interfaces:**
- Produces:
  - **Message:** `ToRenderWorker` gains `{ type: 'resimplify'; jobId; selection: Selection; tolerancePx: number }`.
  - **Reply:** `FromRenderWorker` gains `{ type: 'resimplified'; jobId; selection: Selection }`.
  - **Renderer:** `Renderer.resimplify(selection: Selection, tolerancePx: number): Promise<FromRenderWorker | Cancelled>`.
  - **What the job does:** it applies `setDensity` to every ring, in order, and needs no image.
  - **Newest wins** per type, as `render` does (existing `newestWins`). A `resimplify` and a `render` never cancel each other.

- [ ] **Step 1: Write the failing tests**
  - `should_resimplify_every_ring (AC-15)`: two 64-node circles, tolerance 2. Both come back with fewer nodes, and the result equals applying `setDensity` to each ring locally.
  - `should_keep_only_the_newest_resimplify (AC-15)`: through `newestWins`, two queued `resimplify` jobs give `cancelled` then `resimplified`. A `render` queued between them still runs.
  - `should_send_resimplify_from_the_client (AC-15)`: the client posts the message and resolves with the reply.
- [ ] **Step 2: Run** `npx vitest run src/workers src/services`. Expected: FAIL (unknown message).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): resimplify dots off the main thread` (Refs #72)

### Task 4: Session edits (#66–#73)

**Files:**
- Modify: `src/ui/editor/session.ts`
- Test: `src/ui/editor/EditorScreen.test.tsx` (or a new `session.test.ts`, whichever the existing session tests use)

**Interfaces:**
- Produces: `session.edit(command: Command): Selection`. It executes the command on the history, syncs the selection (the alpha is inherited as today), and returns `history.current`. A command that throws `InvalidCommandError` leaves everything unchanged and rethrows.

- [ ] **Step 1: Write the failing tests**
  - `should_make_each_edit_one_undo_step (AC-4, AC-8 to AC-10, AC-14)`: `moveNode`, `insertNode`, `deleteNode`, `toggleKind` and `nudge` each add one step. Undo after each returns the previous selection.
  - `should_keep_the_model_alpha_after_a_dot_edit (decision 1)`: an Auto-edged selection, then `moveNode`, then `snapshot()` still has the same `modelAlpha`.
- [ ] **Step 2: Run** `npx vitest run src/ui/editor`. Expected: FAIL (`edit` is missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): session edits as undo steps` (Refs #65)

### Task 5: The Dots tool on the canvas (#66–#70)

**Files:**
- Modify:
  - `src/ui/editor/canvasController.ts`
  - `src/ui/editor/drawView.ts`
  - `src/ui/editor/EditorCanvas.tsx`
  - `src/ui/editor/Loupe.tsx`
- Test: `src/ui/editor/EditorCanvas.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 and 2. The existing press sequencer, loupe placement, and `request`/`held` mask logic.
- Produces:
  - `EditorTool = 'auto' | 'dots' | 'view'`
  - `CanvasInputs` gains:
    - `selectedDots: readonly NodeRef[]`
    - `fine: boolean`
    - `onEdit(command: Command, selectAfter: readonly NodeRef[]): void`
    - `onSelectDots(refs: readonly NodeRef[]): void`
  - `drawDots(ctx, frame, selection, selected)` in `drawView.ts`: the outline and the dots.
- **Dots-tool rules (spec AC-1 to AC-13):**
  - **On a press, `toolStart` records `hitDots`.** A node hit starts a drag on `aimStart`. That drag covers the selected refs if the node is among them; otherwise the controller first calls `onSelectDots([ref])` and drags only that node. Any other press starts a box.
  - **`aimMove`:**
    - for a dot drag, it calls `dragTo` and sets a preview selection (`moveNodes` applied to the start selection); the loupe aims at the dragged dot and `data-fine` reflects fine mode
    - for a box, it draws the box
  - **`aimEnd`:**
    - for a dot drag, it calls `onEdit(moveNodes or moveNode, refs)` unless the delta is zero
    - for a box, it calls `onSelectDots(nodesInBox)`
  - **`cancel`** drops the preview, box and loupe, and edits nothing.
  - **`tap`:**
    - on a node: `onSelectDots([ref])`
    - on an edge: `onEdit(insertNode, [{ ring, node: afterNode + 1 }])`
    - on nothing: `onSelectDots([])`
    - all of these use the down point
  - **`doubleTap`:** when both presses hit the same node, `onEdit(deleteNode, refsAfterDelete(...))`. Otherwise it toggles the zoom as today. This needs the first press's hit; keep it beside `downImagePts`.
  - **`longPress`** on a node: `onEdit(toggleKind, selected)`.
  - **No rings:** taps and drags do nothing.
  - **The selection changes under a drag** (`setInputs` with a different `selection` than the drag's start): the drag, preview, box and loupe are dropped, and nothing is edited (Review Focus 1).
  - **Preview renders (AC-21):** while a preview selection exists, ask for a render only when none is pending. When one arrives and the preview has moved on, ask again. The outline is drawn from the preview in the same frame.
  - **Drawing (AC-1):** the dots and outline are drawn after the view, in the main canvas, only when `tool === 'dots'`. Cache one `Path2D` of the curves per selection, in image px. Stroke it with the view transform and line width `1 / cssPerImagePx`, so the line is 1 CSS px at any zoom.

- [ ] **Step 1: Write the failing tests** (the existing fake renderer and pointer helpers; the square ring)
  - `should_drag_a_dot_into_one_move (AC-3, AC-4)`: press on dot 0, move 30 px, lift → one `onEdit` call with `moveNode` and the expected `to`.
  - `should_put_the_dot_back_on_cancel (AC-4)`: press, move, then a second finger → no `onEdit`, and `data-aim` is gone.
  - `should_show_fine_mode_on_the_loupe (AC-5, AC-6)`: hold still 300 ms mid-drag → the loupe has `data-fine="true"`, and `data-aim` is the dot's position.
  - `should_insert_on_an_edge_tap (AC-8)`: a tap on edge 0, then 250 ms → `onEdit(insertNode)` with `selectAfter` `[{ring 0, node 1}]`.
  - `should_delete_on_a_double_tap_on_a_dot (AC-9)`: → `onEdit(deleteNode)`, and `data-zoom` is unchanged. A double-tap on empty space toggles the zoom and edits nothing.
  - `should_toggle_kind_on_a_long_press (AC-10)`: → `onEdit(toggleKind)`.
  - `should_select_by_tap_and_box (AC-11)`:
    - a tap on a dot → `onSelectDots([ref])`
    - a tap on nothing → `onSelectDots([])`
    - a drag on empty space around two dots → `onSelectDots` with both
  - `should_move_selected_dots_together (AC-12)`: with two selected, dragging one → `onEdit(moveNodes)` with both refs.
  - `should_drop_a_drag_when_the_selection_changes (Review Focus 1)`: mid-drag, `setInputs` with a new selection → the lift gives no `onEdit`.
  - `should_do_nothing_without_rings (AC-2)`: an empty selection → taps and drags call nothing.
  - `should_expose_dot_hooks (AC-1)`: `data-tool="dots"`, `data-dot-count="4"` and `data-selected-count` follow the inputs.
  - `should_render_one_preview_at_a_time (AC-21)`: during a drag with a slow fake renderer, at most one render is pending; when it resolves, one more is asked for the newest preview.
- [ ] **Step 2: Run** `npx vitest run src/ui/editor/EditorCanvas.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): dots tool gestures and drawing` (Refs #66 #67 #68 #69 #70)

### Task 6: Dots sheet, toolbar and wiring (#67, #71, #72, #73)

**Files:**
- Create: `src/ui/editor/DotsSheet.tsx`
- Modify:
  - `src/ui/editor/Toolbar.tsx` (Auto · Dots · View)
  - `src/ui/editor/EditorScreen.tsx`
  - `src/ui/editor/EditorScreen.css`
- Test: `src/ui/editor/EditorScreen.test.tsx`

**Interfaces:**
- **The screen** holds `dots: { selection: Selection; refs: NodeRef[] }`. The selected refs are `dots.selection === selection ? dots.refs : []`, so any change from outside clears them (AC-13).
  - `onEdit` calls `session.edit` and stores the refs against the returned selection.
  - `onSelectDots` stores the refs against the current selection.
- **`DotsSheet` props:**
  - `hasRings`, `fine` and `onFine`
  - `onShape(kind)`
  - `canNudge` and `onNudge(dx, dy)`
  - `onDensityStart()`, `onDensity(s)` and `onDensityEnd(s)`
- **The density flow (AC-15, AC-16, Review Focus 3):**
  1. On start, keep `start = selection`.
  2. Each `onDensity(s)` calls `renderer.resimplify(start, densityTolerance(s))`, and the canvas shows the newest result as its selection.
  3. On end, wait for the release value's own result (call it again if needed). Then `session.edit({ type: 'restore', selection })` unless `sameRings(start, result)`.
  4. The slider snaps back to 0, and the preview clears.
- **Shapes:** `session.edit(addRing(startingShape(kind, visiblePhotoRect(...))))`. The canvas reports its viewport and view through a callback or a ref.

- [ ] **Step 1: Write the failing tests**
  - `should_show_the_dots_tool (AC-18)`: the toolbar has Auto, Dots and View. Tapping Dots shows the hint, "Fine" (checked), "Rectangle", "Ellipse", the "Dots" slider and the four nudge buttons. Every control is ≥ 44 px in the CSS rules.
  - `should_hint_when_there_are_no_rings (AC-2)`: an empty selection shows "Start with a shape, or use Auto".
  - `should_add_a_starting_shape (AC-17)`: "Rectangle" adds one ring of 4 corners as one undo step, and nothing is selected. "Ellipse" adds 8 smooth nodes.
  - `should_nudge_selected_dots_by_one_pixel (AC-14)`: select a dot through the canvas callback, then "Nudge right" moves it +1,0 exactly, one undo step per tap. The buttons are disabled with nothing selected.
  - `should_clear_the_dot_selection_on_outside_changes (AC-13)`: after selecting, Undo, an Auto result or a new photo leave the nudge buttons disabled.
  - `should_commit_density_once_on_release (AC-15, AC-16)`: slider start, two moves and an end → one undo step, built from the start selection, and the thumb is back at 0.
    - A release at 0 records nothing.
    - With a fake renderer whose first `resimplify` resolves last, the commit uses the release value's result (Review Focus 3).
- [ ] **Step 2: Run** `npx vitest run src/ui/editor`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): dots sheet with fine, shapes, density and nudge` (Refs #67 #71 #72 #73)

### Task 7: Touch, screenshots and speed (e2e) (#66–#73)

**Files:**
- Create:
  - `e2e/dots.spec.ts`
  - `e2e/helpers/dots.ts`, if the helpers grow
- Modify:
  - `e2e/helpers/editor.ts`: `SeedOptions` gains `rings?: Ring[]`, which replaces the rectangle when given
  - `e2e/editor-screens.spec.ts`: Dots screens; AC-25 baselines re-made
  - `e2e/editor-speed.spec.ts`: AC-20

**Interfaces:**
- **Consumes:** the seed sticker (120×80 photo, rectangle (10,10)–(110,70) as 4 corners), the CDP touch helpers from spec 0009, the canvas hooks, and `imageToClient`.
- **The service worker stays blocked** in these files (`test.use({ serviceWorkers: 'block' })`), as in the editor files.

- [ ] **Step 1: Write the failing tests** (in all projects unless a test says otherwise; touch tests on Chromium via CDP, mouse elsewhere)
  - `should_drag_the_right_dot_by_touch (AC-3, #66)`: open Dots, drag the (110,70) corner by +5,+5 image px at fit and again at 16×. The pixel at image (112,72) becomes kept in the Checkerboard view, and the dot count stays 4.
  - `should_insert_and_delete_dots (AC-8, AC-9)`: a tap on the top edge gives `data-dot-count` 5; a double-tap on the new dot gives 4, and `data-zoom` is unchanged.
  - `should_toggle_a_corner_by_holding (AC-10)`: hold the (110,70) corner for 600 ms. At least one mask pixel within 6 image px of it changes, because the corner becomes a curve through the same dot. Holding it again restores every one of those pixels.
  - `should_box_select_and_move_together (AC-11, AC-12)`:
    - a drag on empty space around the two right-hand corners gives `data-selected-count` 2
    - dragging one of them moves both, and one Undo moves both back
  - `should_nudge_by_one_pixel (AC-14)`: select the (110,70) corner, then "Nudge right" twice. Pixel (111,40) becomes kept and (112,40) stays removed, at 100%+.
  - `should_change_dot_count_with_the_slider (AC-15, AC-16)`: on an Ellipse shape, dragging the slider to "More" raises `data-dot-count` while dragging. The release is one Undo step, and the thumb is back in the middle.
  - `should_start_from_a_rectangle (AC-17)`: on an empty selection, "Rectangle" gives `data-dot-count` 4, centred on the visible photo.
  - `should_fit_the_dots_sheet (AC-18)`: at 375×812, every Dots sheet control is at least 44×44 px, the canvas is at least 300 px tall, and nothing overflows horizontally.
  - **Screens (Linux, Pixel 8):** `should_match_the_dots_tool (AC-19)` at 375 and 430, light and dark, plus the AC-25 layouts with the new toolbar.
  - **Speed (desktop Chromium):** `should_draw_a_dots_frame_under_8_ms (AC-20)`. A 12 MP photo and a 2,000-node ellipse ring, in the Dots tool. The median of 30 frames is under 8 ms while panning and while dragging a dot.
- [ ] **Step 2: Run** `npx playwright test e2e/dots.spec.ts --workers=2`. Expected: FAIL only where Tasks 5 and 6 left behaviour out, which is none. If every test passes on its first run, break one rule on purpose (for example, ignore `selectedDots` in drags) and confirm the matching test fails.
- [ ] **Step 3: Fix** whatever the run shows.
- [ ] **Step 4: Run** the whole e2e suite with `--workers=2`. Expected: PASS. The screenshot tests are skipped off Linux; CI makes their baselines (checked by eye, then committed).
- [ ] **Step 5: Commit** `test(e2e): dots gestures, screens and frame budget` (Refs #65)

### Task 8: Decisions and docs (#65)

**Files:**
- Modify: `docs/decisions.md` (a "Dots tool decisions (spec 0010)" section, with the spec's decisions 1–10 in one line each, and any rulings)

- [ ] **Step 1: Write** the section.
- [ ] **Step 2: Run** `npm run lint && npm run typecheck && npm run format:check && npm test`. Expected: all green.
- [ ] **Step 3: Commit** `docs: dots tool decisions` (Refs #65)
