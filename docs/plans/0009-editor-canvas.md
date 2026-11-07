# Editor canvas: zoom, loupe, views, undo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The tap-to-cut screen becomes the editor shell, with:
- a canvas that pinches 1×–16×, pans, toggles 100%/fit on double-tap, and draws crisp photo pixels against five views
- a loupe while aiming
- hold-to-compare, Undo, Redo and Reset to auto
- a phone-first layout with a bottom toolbar and options sheets

**Architecture:**
- **Pure (`src/core/`):**
  - `gestures/sequence.ts` turns the gesture machine's tool actions into taps, double-taps, long-presses and aims, with a polled 250 ms deadline.
  - `coords/view.ts` gains wheel zoom.
  - `editor/` holds the view colour formula, the loupe placement and scale, and the preview render scale.
- **UI (`src/ui/editor/`, moved from `src/ui/auto/`):**
  - `session.ts` holds the controller, history and renderer.
  - `EditorCanvas.tsx` owns the view, gestures, drawing and loupe.
  - `drawView.ts` draws a frame from two canvases: the photo, and the cutout (photo × mask at the mask's resolution).
  - `EditorScreen.tsx` lays out the top bar, status strip, action row, sheets and toolbar.

**Tech Stack:** TypeScript 6 (strict), React 19, Vitest 5 + RTL (jsdom), Playwright (CDP touch on Chromium for pinch). No new dependencies.

**Spec:** `docs/specs/0009-editor-canvas.md` (story #58; #59–#64)

## Global Constraints

- **Purity:** `src/core/` has no DOM, React or browser imports or globals. Coordinates are image px floats. Names say `screenPt`, `canvasPt` or `imagePt`. "Display scale" = device px per image px = `viewScale(vp, view) × vp.dpr`.
- **Saving is untouched:** the save path stays `renderFull` (spec 0008). Preview canvases never reach storage.
- **Constants, from the spec:**
  - `DOUBLE_TAP_MS = 250`, `DOUBLE_TAP_SLOP_PX = 24`
  - `PRESS_SLOP_PX = 10` and `LONG_PRESS_MS = 500` (existing)
  - zoom 1–16
  - wheel factor `2^(−deltaY/200)`: line mode × 16 px, page mode × canvas height
  - loupe: `LOUPE_DIAMETER_PX = 120`, `LOUPE_OFFSET_PX = 90`, `LOUPE_MAGNIFY = 4`, `LOUPE_MAX_CSS_PER_IMAGE_PX = 32`
  - checkerboard: `CHECKER_PX = 8`, `#ffffff` / `#cfcfd6` (the top-left square of the canvas is white)
  - view backgrounds `#000000`, `#ffffff`, `#ff0000`; overlay shade 0.5; colour tolerance ±2 per channel
  - touch targets ≥ 44×44 CSS px
  - frame median < 8 ms over 30 frames
- **Copy is exact:**
  - "Photo", "Stickers", "Undo", "Redo", "Reset to auto", "Compare", "Auto", "View"
  - the views: "Overlay", "Checkerboard", "Black", "White", "Red"
  - "Pick a photo"
  - "Tap to add · Hold to remove · Slide to aim"
  - The heading "Peel" stays, in the top bar (the smoke test reads it).
- **Test hooks:**
  - The visible canvas is `data-testid="canvas"`, with `data-zoom` (4 decimals), `data-display-scale` (4 decimals), `data-mask-scale` (the held render's scale, 4 decimals or empty) and `data-view` (the mode).
  - The full-size photo canvas stays in the DOM, hidden, as `data-testid="photo"`.
  - The cutout canvas (photo RGB, mask alpha, at the mask's resolution) stays in the DOM, hidden, as `data-testid="cutout"`.
  - The editor root is `data-testid="editor"` with `data-phase`.
  - Each frame is wrapped in `performance.mark`/`measure('peel-frame')`.
- **Process:**
  - Test names are `should_...` with the AC id.
  - jsdom has no 2D canvas: drawing is checked in Playwright. Component tests check requests, intents and state.
  - Coverage: `src/core/` ≥ 90%, overall ≥ 75%.
- **Git:** branch `feat/58-editor-canvas`; one commit per task (Conventional Commits, `Refs #N`); the PR closes #58–#64.

## Spec corrections made with this plan

These update `docs/specs/0009-editor-canvas.md` in this PR:

- **AC-16:** "A tap, long-press or aim whose point is outside the photo does nothing." The canvas now has margins around the photo. Clamping a tap in the margin to the photo's edge would add something the user didn't point at.
- **AC-10:** "A pinch requests its render when it ends, and wheel zoom 150 ms after the last wheel event." Otherwise every frame of a pinch would request a render.
- **AC-6:** wheel `deltaMode` page counts as the canvas height.
- **Contract:** `AutoState` gains `hasAutoResult: boolean` and `autoResultSelection: Selection | null`. The second is the history snapshot that holds the latest Auto result, or null when that result isn't applied. AC-20 needs both.

## Review Focus

1. **Undo or redo back to an older Auto result:** the preview and a save must use that selection's own model alpha, not the newest one. Example: the fast result is undone after the precise one replaced it (Task 9).
2. **The canvas changes size** (rotating the phone, the sheet opening) **while zoomed in:** the photo point at the centre stays at the centre, the view is clamped again, and a 0-size canvas never produces NaN or a render request (Task 6).
3. **A tap still waiting (250 ms) when a new photo is picked or a sticker re-opened:** it must not land on the new photo (Task 7).
4. **A small photo (120×80) whose fit is already above 100%:** double-tap leaves the view valid, pixels are crisp, and the mask is the scale-1 render (Task 7).
5. **A 12 MP photo at 100% and above:** the scale-1 cutout draws in full (no blank canvas) and panning stays within the frame budget. Only two full-size canvases exist: the photo and the cutout. Overlay is drawn without a third (Task 11).

---

### Task 1: Wheel zoom (#59)

**Files:**
- Modify: `src/core/coords/view.ts`
- Test: `src/core/coords/view.test.ts`

**Interfaces:**
- Produces: `applyWheelZoom(vp: Viewport, view: View, canvasPt: Point, deltaYPx: number): View`. Zoom × `2 ** (-deltaYPx / 200)`, anchored at `canvasPt`, clamped (reuse `anchoredView`). Throws `RangeError` for a non-finite `deltaYPx`.

- [ ] **Step 1: Write the failing tests**
  - `should_zoom_by_the_wheel_around_the_pointer (AC-6)`:
    - deltaY −200 doubles zoom and deltaY 200 halves it
    - the imagePt under `canvasPt` stays within 0.01 px while unclamped
    - −10000 clamps to 16 and +10000 to 1
  - `should_refuse_a_non_finite_wheel_delta (AC-6)`: `NaN` and `Infinity` throw `RangeError`.
- [ ] **Step 2: Run** `npx vitest run src/core/coords`. Expected: FAIL, `applyWheelZoom` is not exported.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): wheel zoom around the pointer` (Refs #59)

### Task 2: Press sequencer (#59, #60)

**Files:**
- Create: `src/core/gestures/sequence.ts`
- Test: `src/core/gestures/sequence.test.ts`

**Interfaces:**
- Consumes: `GestureAction` (`toolStart`, `toolMove`, `toolEnd`, `toolCancel`, with `point` in canvas px); `classifyPress`, `PRESS_SLOP_PX`.
- Produces:
  - `DOUBLE_TAP_MS = 250`, `DOUBLE_TAP_SLOP_PX = 24`
  - `type PressIntent = { type: 'tap' | 'longPress' | 'doubleTap' | 'aimStart' | 'aimMove' | 'aimEnd'; canvasPt: Point } | { type: 'cancel' }`
  - `createPressSequencer(): PressSequencer` with:
    - `input(action, t): PressIntent[]`
    - `readonly deadline: number | null`
    - `poll(t): PressIntent[]`
    - `reset(): void`
- Rules:
  - **Aiming:** a press that moves > 10 px from its start emits `aimStart` once (at the current point), then `aimMove` per move. On end it emits `aimEnd` at the end point.
  - **Long-press:** emitted at the down point on end.
  - **A first tap waits:** `deadline = upT + 250`.
  - **Second down near the first:** if it arrives with `t ≤ deadline` and within 24 px of the waiting tap's down point, the deadline is suspended (`null`) until that press ends. If the second press is a tap, emit `doubleTap` at its down point and drop the waiting tap. Otherwise emit the waiting `tap` first, then the second press's own intents.
  - **Second down elsewhere or late:** a down farther than 24 px or after the deadline flushes the waiting `tap` first.
  - **Polling:** `poll(t)` emits the waiting tap once `t ≥ deadline`.
  - **Cancel:** `toolCancel` emits `cancel` when a press is active and drops that press. A tap that was already waiting stays.
  - **Reset:** `reset()` drops everything, including a waiting tap.

- [ ] **Step 1: Write the failing tests** (times in ms, points in canvas px)
  - `should_wait_250_ms_before_a_tap (AC-4)`: down/up at (10,10), t 0→80 gives `[]`. `deadline` is 330. `poll(329)` gives `[]`; `poll(330)` gives `[tap (10,10)]`, and later polls give `[]`.
  - `should_turn_two_taps_into_a_double_tap (AC-3)`:
    - tap at 0–80, then tap at (20,25) from 300 to 360: the end gives `[doubleTap (20,25)]`, `deadline` is null, and later polls give `[]`
    - a second down at 331 gives the first `tap` from `poll(331)`, then a new waiting tap
    - a second down 25 px away at 200 gives `[tap]` at once
  - `should_hold_the_first_tap_while_the_second_is_down (AC-3)`: tap 0–80, then a second down at 300. `poll(400)` gives `[]` while it's held. If it is lifted at 900 as a long-press, the end gives `[tap (first), longPress (second)]`.
  - `should_aim_after_10_px (AC-13, AC-16)`: moves of 6 px give nothing; 11 px gives `aimStart`; the next move gives `aimMove`; the end gives `aimEnd` at the end point. No tap or long-press is emitted.
  - `should_emit_a_long_press_on_lift (AC-16)`: held 600 ms within 10 px gives `[longPress (down point)]` at once.
  - `should_cancel_on_a_second_finger (AC-2, AC-15)`: `toolCancel` mid-aim gives `[cancel]`, and nothing follows on end. A tap that was waiting before still fires on `poll`.
  - `should_drop_a_waiting_tap_on_reset (Review Focus 3)`: tap, then `reset()`, then `poll(1000)` gives `[]`.
- [ ] **Step 2: Run** `npx vitest run src/core/gestures`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `createPressSequencer` in `src/core/gestures/sequence.ts`.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): tap, double-tap, long-press and aim from one pointer` (Refs #59 #60)

### Task 3: View colours, loupe and preview scale (#59, #60, #61)

**Files:**
- Create: `src/core/editor/views.ts`, `src/core/editor/loupe.ts`, `src/core/editor/preview.ts`, `src/core/editor/index.ts`
- Test: `src/core/editor/editor.test.ts`

**Interfaces:**
- Produces:
  - **View colours:**
    - `type ViewMode = 'overlay' | 'checkerboard' | 'black' | 'white' | 'red'`
    - `VIEW_MODES: readonly ViewMode[]` (that order)
    - `VIEW_LABELS: Record<ViewMode, string>`
    - `type Rgb = readonly [number, number, number]`
    - `VIEW_BACKGROUNDS: Record<'black' | 'white' | 'red', Rgb>`
    - `CHECKER_PX = 8`, `CHECKER_LIGHT: Rgb = [255,255,255]`, `CHECKER_DARK: Rgb = [207,207,214]`
    - `checkerColourAt(cssX: number, cssY: number): Rgb`: light when `floor(x/8) + floor(y/8)` is even
    - `viewPixel(mode: ViewMode, p: Rgb, a: number /*0..1*/, checker: Rgb): Rgb`: AC-11's formulas, unrounded
  - **Loupe:**
    - `LOUPE_DIAMETER_PX = 120`, `LOUPE_OFFSET_PX = 90`, `LOUPE_MAGNIFY = 4`, `LOUPE_MAX_CSS_PER_IMAGE_PX = 32`
    - `loupePlacement(fingerCanvasPt: Point, canvasSize: Size): { center: Point; below: boolean }`
    - `loupeScale(cssPerImagePx: number): number` = `min(4 × s, 32)`
  - **Preview:**
    - `displayScale(vp, view): number` = `viewScale(vp, view) × vp.dpr`
    - `isCrisp(displayScale): boolean` = `> 1`
    - `previewScale(vp, view): number` = `min(1, displayScale)`
    - `needsFinerMask(heldScale: number | null, wanted: number): boolean`: null, or `wanted > held × 1.01`

- [ ] **Step 1: Write the failing tests**
  - `should_compute_each_view_colour (AC-11)`:
    - p = [200,100,50]: overlay at a=1 is p, at a=0 is [100,50,25], at a=0.5 is [150,75,37.5]
    - black, white and red at a=0 give their background, and at a=1 give p
    - checkerboard at a=0.25 with checker [207,207,214] is 0.25·p + 0.75·c
  - `should_lay_out_the_checkerboard_in_8_px_squares (AC-11)`: (0,0) and (7.9,7.9) are light; (8,0) and (0,8) are dark; (8,8) is light.
  - `should_place_the_loupe_above_the_finger (AC-14)`:
    - finger (200,300) in 400×600 gives center (200,210), below false
    - finger (10,300) gives center.x 60; finger (395,300) gives center.x 340
    - finger (200,140): 140−90−60 < 0, so center (200,230), below true
    - a canvas 100 wide gives center.x 50
  - `should_magnify_the_loupe_4x_up_to_32_px (AC-13)`: `loupeScale(0.5)` is 2, `loupeScale(4)` is 16, `loupeScale(12)` is 32.
  - `should_render_at_screen_resolution_below_100_percent (AC-9)`:
    - vp canvas 400×300, image 4000×3000, dpr 2, zoom 1: displayScale 0.2, previewScale 0.2, isCrisp false
    - zoom 16: displayScale 3.2, previewScale 1, isCrisp true
  - `should_ask_for_a_finer_mask_only_when_zooming_in (AC-10)`: `needsFinerMask(null, 0.2)` is true; (0.2, 0.2), (0.2, 0.201) and (1, 0.5) are false; (0.2, 0.25) is true.
- [ ] **Step 2: Run** `npx vitest run src/core/editor`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules and `index.ts`.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): view colours, loupe placement and preview scale` (Refs #59 #60 #61)

### Task 4: Auto controller exposes its latest result (#63)

**Files:**
- Modify: `src/services/segmentation/autoCutout.ts`
- Test: `src/services/segmentation/autoCutout.test.ts`

**Interfaces:**
- Produces: `AutoState.hasAutoResult: boolean` and `AutoState.autoResultSelection: Selection | null`.
  - Both reset on `setImage`.
  - `hasAutoResult` becomes true when a result becomes `target`.
  - `autoResultSelection` is `history.current` right after the controller applies a result or `resetToAuto()`. It is null when a result only becomes the target because the user had changed the selection.

- [ ] **Step 1: Write the failing tests**, with the existing fake engines in that file:
  - `should_report_the_latest_auto_result (spec 0009 AC-20)`:
    - after `setImage`: false and null
    - after a tap's fast result: true, and `autoResultSelection` is `history.current`
  - `should_not_claim_a_result_the_user_moved_away_from (AC-20)`:
    - after a result, `history.execute` a `setFeather` (a user change), then the precise result arrives
    - `hasAutoResult` is true and `autoResultSelection` is null
    - `resetToAuto()` makes `autoResultSelection === history.current`
  - `should_forget_the_result_for_a_new_photo (AC-20)`: `setImage` again gives false and null.
- [ ] **Step 2: Run** `npx vitest run src/services/segmentation/autoCutout`. Expected: FAIL (fields missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(services): auto controller reports its latest result` (Refs #63)

### Task 5: Move the screen to `src/ui/editor` (no behaviour change)

**Files:**
- `git mv` the following:
  - `src/ui/auto/AutoScreen.tsx` → `src/ui/editor/EditorScreen.tsx`
  - `AutoScreen.css` → `EditorScreen.css`
  - `AutoScreen.test.tsx` → `EditorScreen.test.tsx`
  - `AutoScreen.stickers.test.tsx` → `EditorScreen.stickers.test.tsx`
  - `StickerPanel.tsx`, `StickerPanel.css` and `useStickers.ts` → `src/ui/editor/`
- Create: `src/ui/editor/session.ts` (`createSession` and `Renderer` moved out of the screen, unchanged)
- Modify: `src/App.tsx` (imports, `EditorScreen`)

**Interfaces:**
- Produces:
  - `EditorScreen(props: EditorScreenProps)`, with the old `AutoScreenProps` renamed
  - `createSession(deps: SessionDeps)` and `Renderer` from `session.ts`
  - `DIFFERENT_SIZE` re-exported from `EditorScreen.tsx`

- [ ] **Step 1: Move and rename.** Update imports and test names of describe blocks only.
- [ ] **Step 2: Run** `npx vitest run src/ui src/App.test.tsx && npx tsc -b && npx eslint src`. Expected: the same pass count as before the move (no behaviour change).
- [ ] **Step 3: Commit** `refactor(ui): move the screen to ui/editor and split out the session` (Refs #58)

### Task 6: Editor canvas: fit, drawing, views, render scale (#59, #61)

**Files:**
- Create:
  - `src/ui/editor/drawView.ts`: `buildCutout(source: HTMLCanvasElement, mask: AlphaMask): HTMLCanvasElement` (the old `drawCutout`), `drawFrame(...)`, `checkerPattern(ctx, dpr)`
  - `src/ui/editor/EditorCanvas.tsx`
  - `src/ui/editor/EditorCanvas.test.tsx`
  - `e2e/helpers/editor.ts`: `seedBackup()` moved from `e2e/stickers.spec.ts`, `seedAndOpen(page)`, `imageToClient(page, imagePt)` at fit from the canvas box and `data-image-size`, `canvasPixel(page, cssPt)`
  - `e2e/editor.spec.ts`
- Modify: `EditorScreen.tsx` (uses `EditorCanvas`; drops the backdrop and its fit scale), `EditorScreen.test.tsx`, `EditorScreen.stickers.test.tsx`, `e2e/auto.spec.ts` (`press` uses `imageToClient` on `canvas`), `e2e/stickers.spec.ts` (imports the helper)

**Interfaces:**
- Consumes: Task 3 (`ViewMode`, `previewScale`, `needsFinerMask`, `isCrisp`, `displayScale`, checker constants); `core/coords` (`initialView`, `clampView`, `viewScale`, `canvasToImage`).
- Produces:
  - `EditorCanvasProps`:
    - `photo: { id: string; width: number; height: number; source: HTMLCanvasElement } | null`
    - `selection: Selection`
    - `renderMask(selection: Selection, scale: number): Promise<AlphaMask | null>` (null = cancelled)
    - `viewMode: ViewMode`, `comparing: boolean`, `tool: 'auto' | 'view'`
    - `onIntent(intent: { type: 'add' | 'remove'; imagePt: Point }): void`
    - `now?: () => number`
  - **Measuring:** the canvas's size comes from `getBoundingClientRect()`, read on mount, on `ResizeObserver` and on every `pointerdown`. A 0-size canvas draws nothing and requests nothing.
  - **Drawing:**
    - `drawFrame` sets the canvas to its size × dpr and fills it.
    - Crisp: `imageSmoothingEnabled = !isCrisp(displayScale)`.
    - Compare: the photo only.
    - Overlay: fill black, draw the photo at `globalAlpha` 0.5, then the cutout with `globalCompositeOperation = 'lighter'` at `globalAlpha` 0.5. This gives `0.5p + 0.5ap`, which is AC-11, with no extra canvas.
    - Other views: fill the background (the checker pattern is 16 CSS px tiles anchored at the canvas origin), then the cutout source-over.
    - Draws are batched per `requestAnimationFrame`.
  - **Rendering:**
    - On a new photo or selection, request `previewScale` for the current view. Requests only change the held mask when they resolve for the current selection.
    - On a resize, request again when `needsFinerMask`.
    - A new photo resets to `initialView` (AC-7).
    - On a resize, keep `canvasToImage(centre)` at the centre, then `clampView`.

- [ ] **Step 1: Write the failing tests**
  - In `EditorCanvas.test.tsx` (fake `renderMask` records `(selection, scale)`; canvas rect stubbed to 400×300; `devicePixelRatio` 2; photo 4000×3000):
    - `should_start_fitted_and_render_at_screen_resolution (AC-7, AC-9)`: `data-zoom` is 1.0000 and one request has scale 0.2.
    - `should_render_again_when_the_selection_changes (AC-10)`: a new selection gives a second request at 0.2.
    - `should_ignore_a_render_for_an_old_selection (AC-10)`: the first request resolves after the selection changed, and `data-mask-scale` stays empty until the second resolves.
  - In `e2e/editor.spec.ts` (all projects; `seedAndOpen` imports the spec 0008 seed backup, 120×80 with rect (10,10)–(110,70), and opens it):
    - `should_draw_crisp_pixels_above_100_percent (AC-8)`: at fit (display scale > 1 for 120×80), two device pixels inside image pixel (60,40) are equal, and pixels across the x = 10 edge differ in alpha-driven colour within one device pixel.
    - `should_show_the_full_resolution_mask_at_100_percent (AC-9)`: the hidden `cutout` canvas is 120×80 and `data-mask-scale` is 1.0000.
- [ ] **Step 2: Run** `npx vitest run src/ui/editor` and `npx playwright test e2e/editor.spec.ts --project=desktop-chrome`. Expected: FAIL (`EditorCanvas` missing; e2e hooks missing).
- [ ] **Step 3: Implement** `drawView.ts` and `EditorCanvas.tsx`, and wire them into `EditorScreen`. Update the e2e helpers.
- [ ] **Step 4: Run** the same, plus `npx playwright test e2e/photo.spec.ts e2e/stickers.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): editor canvas with crisp pixels and screen-resolution previews` (Refs #59 #61)

### Task 7: Gestures: pinch, pan, wheel, double-tap, Auto taps and aims (#59, #60)

**Files:**
- Modify: `src/ui/editor/EditorCanvas.tsx`, `src/ui/editor/EditorScreen.tsx` (`onIntent` → `session.tap`)
- Test: `src/ui/editor/EditorCanvas.test.tsx`, `src/ui/editor/EditorScreen.test.tsx`, `e2e/editor.spec.ts`

**Interfaces:**
- Consumes: `createGestureMachine`, `createPressSequencer` (Task 2), `applyTwoFingerGesture`, `toggleActualSize`, `applyWheelZoom` (Task 1).
- Behaviour:
  - **Pointer events:** `pointerdown`/`move`/`up`/`cancel` go to the gesture machine in canvas px, with `setPointerCapture` where available.
  - **Pinch:** `viewStart`/`viewUpdate` apply `applyTwoFingerGesture` from the start view; on `viewEnd`, request again if `needsFinerMask`.
  - **One-finger pan in View:** `toolStart`/`toolMove` call `applyTwoFingerGesture` with both start points equal and both current points equal (pan only).
  - **Sequencer:** tool actions also go to the sequencer, and its deadline is a `setTimeout` that calls `poll`.
  - **Double-tap:** `doubleTap` calls `toggleActualSize` at its point.
  - **Auto intents:** `tap` gives `add`; `longPress` gives `remove`; `aimEnd` gives `add`.
  - **Points:** each converts with `canvasToImage`. A point outside `[0,w]×[0,h]` gives nothing; a point inside is clamped to `[0.5, size − 0.5]`.
  - **Resets:** a new photo calls `sequencer.reset()`.
  - **Wheel:** `wheel` (passive: false, `preventDefault`) calls `applyWheelZoom` with deltaY in px, and requests 150 ms after the last wheel event.

- [ ] **Step 1: Write the failing tests**
  - In `EditorCanvas.test.tsx` (fake timers for `setTimeout`):
    - `should_pinch_and_keep_the_midpoint_still (AC-1)`: two pointers down at (100,150) and (200,150), then moved to (50,150) and (250,150). `data-zoom` is 2.0000, and no `onIntent` call is made. No render is requested while the fingers move; one is requested at scale 0.4 after they lift (AC-10).
    - `should_cancel_a_press_when_a_second_finger_lands (AC-2)`: one pointer down, moved 20 px, a second down, all up. No intent, no loupe.
    - `should_add_250_ms_after_a_tap (AC-4, AC-16)`: tap at canvas (200,150). No intent at 249 ms; at 250 ms, `add` at the image centre ±0.01.
    - `should_zoom_on_double_tap_and_add_nothing (AC-3)`: two taps 100 ms apart. `data-zoom` becomes the actual-size zoom (`1/dpr/fitScale` = 5.0000 for 4000 px into 400 px at dpr 2). No intent after 1 s. Another double-tap goes back to 1.0000.
    - `should_remove_on_long_press_at_lift (AC-16)`: held 600 ms gives `remove` at once.
    - `should_add_where_an_aim_lifts (AC-16)`: down (100,100), move to (150,100), up. `add` at the image point of (150,100). If it lifts in the margin outside the photo (use a 400×400 rect so the photo is letterboxed), nothing.
    - `should_pan_with_one_finger_in_the_view_tool (AC-5)`: at zoom 4, dragging 40 px left moves `center.x` by 40/scale, and no intent is made.
    - `should_zoom_with_the_wheel (AC-6)`: deltaY −200 gives zoom 2. `deltaMode` 1 with deltaY −12.5 also gives 2.
    - `should_keep_the_centre_when_the_canvas_resizes (Review Focus 2)`: at zoom 4 (wheel deltaY −400), the rect changes to 300×400. The imagePt at the centre stays within 0.01, and `data-zoom` has no NaN. A 0×0 rect makes no request.
    - `should_double_tap_a_small_photo_safely (Review Focus 4)`: a 120×80 photo in 400×300 at dpr 2 is above 100% at fit. A double-tap leaves zoom at 1.0000 with no NaN, and the request scale is 1.
  - In `EditorScreen.test.tsx`: `should_drop_a_waiting_tap_when_a_new_photo_is_picked (Review Focus 3)`: tap, then pick a new photo within 250 ms. The engine sees no tap.
  - In `e2e/editor.spec.ts`:
    - `should_pinch_with_two_fingers (AC-1)`: `pixel-8` only. A CDP `Input.dispatchTouchEvent` two-finger spread makes `data-zoom` > 1.5, and the selection is unchanged (`data-phase` idle).
    - `should_double_tap_to_100_percent (AC-3)`: all projects. `dblclick` on the canvas makes `data-display-scale` 1.0000 when fit is below 100%. Use a 2000×1500 photo generated in the page with `DataTransfer`, because the seed photo is above 100% at fit.
- [ ] **Step 2: Run** `npx vitest run src/ui/editor`. Expected: FAIL (no gestures yet).
- [ ] **Step 3: Implement.** Remove the old `classifyPress` handlers from the screen.
- [ ] **Step 4: Run** `npx vitest run src/ui/editor` and `npx playwright test e2e/editor.spec.ts e2e/auto.spec.ts --project=desktop-chrome --project=pixel-8`. Expected: PASS. The real-model tests still find their subjects, because their taps are converted with `imageToClient`.
- [ ] **Step 5: Commit** `feat(ui): pinch, pan, wheel and double-tap zoom; tap, hold and slide in Auto` (Refs #59 #60)

### Task 8: Loupe (#60)

**Files:**
- Create: `src/ui/editor/Loupe.tsx`
- Modify: `src/ui/editor/EditorCanvas.tsx`
- Test: `src/ui/editor/EditorCanvas.test.tsx`, `e2e/editor.spec.ts`

**Interfaces:**
- Consumes: `loupePlacement`, `loupeScale`, `LOUPE_DIAMETER_PX` (Task 3); `drawFrame` (Task 6) with a transform centred on the aimed imagePt.
- Produces:
  - `<Loupe>` is a `canvas` with `data-testid="loupe"`, positioned absolutely at `center − 60`, 120×120 CSS px (× dpr), `border-radius: 50%`, `pointer-events: none`, and `data-below`.
  - The crosshair is drawn last: 1 px white lines through the centre, with 1 px dark (#000) lines on either side.
  - The loupe shows only when the tool uses drags (`auto` now). In `view`, one finger pans and no loupe shows.

- [ ] **Step 1: Write the failing tests**
  - `should_show_the_loupe_while_aiming_and_hide_it_on_lift (AC-13, AC-15)`: there is no loupe after 6 px of movement; after 11 px it shows, centred 90 px above the finger. It hides on up, on `pointercancel`, and when a second finger lands.
  - `should_not_show_the_loupe_while_panning (AC-13)`: in the View tool, a 40 px drag shows no loupe.
  - `should_flip_the_loupe_below_near_the_top (AC-14)`: aiming at y = 100 gives `data-below="true"`, with the centre 90 px below.
  - In e2e: `should_magnify_under_the_finger_with_a_crosshair (AC-13)`: desktop-chrome, mouse-drag aim on the seed photo. The loupe's centre pixel is the crosshair (white or black ±2). A pixel 10 CSS px from the centre matches the canvas colour at the photo point it shows.
- [ ] **Step 2: Run** `npx vitest run src/ui/editor/EditorCanvas`. Expected: FAIL (no loupe).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, plus the e2e test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): loupe with crosshair while aiming` (Refs #60)

### Task 9: Compare, Undo, Redo, Reset to auto, and each result's own model alpha (#62, #63)

**Files:**
- Modify: `src/ui/editor/session.ts`, `src/ui/editor/EditorScreen.tsx`
- Test: `src/ui/editor/EditorScreen.test.tsx`

**Interfaces:**
- Consumes: `History.canUndo`, `canRedo`, `undo()` and `redo()`; `AutoState.hasAutoResult` and `autoResultSelection` (Task 4); `auto.resetToAuto()`.
- Produces session methods:
  - `undo()` and `redo()`
  - `canUndo` and `canRedo` getters
  - `resetToAuto()`
  - `alphaFor(selection): AlphaMask | null`, backed by a `WeakMap<Selection, AlphaMask>`:
    - it is filled whenever the controller's `onChange` reports `modelAlpha` for the current `history.current`, and by `reopen`
    - when `history.current` changes, the renderer gets `setModelAlpha(photo.id, alphaFor(current))` if that alpha differs from the one last sent
    - `snapshot()` uses `alphaFor(sel)`
- The action row has buttons "Undo", "Redo", "Reset to auto" (rendered only when `hasAutoResult`) and "Compare". Compare is held through pointerdown/up/cancel/leave and keydown/keyup for Space and Enter, ignoring key repeat. It sets `comparing` on `EditorCanvas`.

- [ ] **Step 1: Write the failing tests**
  - `should_enable_undo_and_redo_only_when_possible (AC-19)`:
    - no photo: both are disabled
    - after an Auto result: Undo is enabled
    - Undo empties the selection and enables Redo
    - Redo brings the result back
  - `should_offer_reset_to_auto_only_after_a_result (AC-20)`:
    - it is hidden before any tap, and after re-opening a sticker
    - after a result, it is shown and disabled
    - after Undo, it is enabled; clicking it makes the selection the result again, and Undo is available
  - `should_render_an_undone_result_with_its_own_model_alpha (Review Focus 1)`:
    - set-up: a fast result with alpha A, then a precise result with alpha B
    - after Undo, the renderer's last `setModelAlpha` is A
    - Save's `renderFull` gets A
    - after Redo, B
  - `should_show_the_original_while_compare_is_held (AC-18)`: pointerdown on Compare sets `data-comparing="true"` on the canvas; pointerup clears it. Space keydown sets it; keyup clears it.
- [ ] **Step 2: Run** `npx vitest run src/ui/editor/EditorScreen.test.tsx`. Expected: FAIL (no buttons).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/ui/editor`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): compare, undo, redo and reset to auto` (Refs #62 #63)

### Task 10: Layout, toolbar and sheets (#64, AC-17)

**Files:**
- Create: `src/ui/editor/Toolbar.tsx` (tool buttons and the options sheet)
- Modify: `EditorScreen.tsx`, `EditorScreen.css`, `src/App.tsx` (drops the tagline; the "Peel" heading moves into the top bar), `src/index.css` (light and dark tokens)
- Modify: `e2e/stickers.spec.ts` and the helpers (open the "Stickers" sheet first)
- Test: `src/ui/editor/EditorScreen.test.tsx`

**Interfaces:**
- **Layout:** a grid filling `100dvh`, with rows top bar / canvas (`1fr`) / action row / sheet / toolbar. Padding comes from `env(safe-area-inset-*)`. `body` gets `overflow: hidden` while the editor is mounted, and only the canvas has `touch-action: none`.
- **Tools:** the buttons are "Auto" and "View", with `aria-pressed`.
- **Sheet:** tapping the active tool toggles `sheetOpen`; tapping another tool selects it and opens its sheet.
- **View sheet:** a `role="radiogroup"` labelled "View", with five `role="radio"` buttons. The chosen view lives in screen state and survives tool and photo changes.
- **Stickers:** the button toggles a sheet holding `<StickerPanel>`, which stays open until it is tapped again.
- **Status strip:** the status lines, the photo error alert and "Use Lasso" sit absolutely over the top of the canvas.
- **No photo:** the canvas area shows a "Pick a photo" button that opens the same file input. The tools, Undo, Redo and Compare are disabled.
- **Theme:** colours are CSS custom properties, with `@media (prefers-color-scheme: dark)` overrides. Canvas backgrounds are drawn, not themed.

- [ ] **Step 1: Write the failing tests**
  - `should_lay_out_top_to_bottom (AC-21)`: the DOM order is top bar ("Photo", "Stickers"), canvas, action row, sheet, toolbar ("Auto", "View").
  - `should_name_every_control_and_mark_the_active_tool (AC-22)`: every button has an accessible name; "Auto" has `aria-pressed="true"`; the views are a radiogroup whose "Overlay" radio is checked.
  - `should_open_the_tool_sheet_and_toggle_it (AC-23)`:
    - Auto's sheet shows "Tap to add · Hold to remove · Slide to aim"
    - clicking View shows five radios
    - clicking View again hides them
    - choosing "Red", switching to Auto, then picking a new photo keeps `data-view="red"`
  - `should_disable_tools_until_a_photo_is_picked (AC-24)`: "Pick a photo" is shown in the canvas area; Auto, View, Undo, Redo and Compare are disabled.
  - `should_show_auto_status_whatever_sheet_is_open (AC-17)`: with the View sheet open, the "Sharper cutout ready" text is visible in the status strip.
  - In e2e: `should_draw_each_view_with_the_spec_colours (AC-11)`:
    - all projects, using `seedAndOpen`
    - for each view radio, probe the canvas at the centres of image pixels (60,40) (inside, a = 1) and (5,5) (outside, a = 0)
    - expected colour is `viewPixel(mode, p, a, checkerColourAt(cssX, cssY))`, with `p` from the hidden `photo` canvas, ±2
  - In e2e: `should_fit_the_screen_with_44_px_targets (AC-21, AC-22)`:
    - all projects
    - `document.scrollingElement.scrollHeight ≤ innerHeight` and `scrollWidth ≤ innerWidth`
    - every visible button and label in the editor has a bounding box ≥ 44×44
    - the canvas's computed `touch-action` is `none`
- [ ] **Step 2: Run** `npx vitest run src/ui/editor`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update e2e helpers and specs for the sheets.
- [ ] **Step 4: Run** `npx vitest run src/ui src/App.test.tsx` and `npx playwright test e2e/editor.spec.ts e2e/stickers.spec.ts e2e/photo.spec.ts e2e/smoke.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): phone-first editor layout with toolbar and sheets` (Refs #64)

### Task 11: Screenshots, speed, docs (#58, #61, #64)

**Files:**
- Create: `e2e/editor-screens.spec.ts`, `e2e/editor-speed.spec.ts`
- Modify:
  - `playwright.config.ts`: `snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}'` (no platform suffix)
  - `.github/workflows/*.yml`: the e2e job uploads `e2e/__screenshots__` and `test-results` as an artifact, `if: always()`
  - `docs/decisions.md` (spec 0009 section), `docs/specs/0009-editor-canvas.md` (status at merge)

**Interfaces:**
- **Screenshot tests:**
  - They run only on Linux (`test.skip(process.platform !== 'linux', 'baselines are made on CI Linux')`), in the `pixel-8` project only.
  - The screen is seeded with `seedAndOpen`, with the status strip idle.
  - `toHaveScreenshot(name, { maxDiffPixelRatio: 0.001 })`.
  - The first CI run writes the missing baselines and fails. Download them with `gh run download`, commit them, and push.
- **Speed test:** desktop-chrome only.
  - A 4032×3024 photo is generated in the page (`OffscreenCanvas` → JPEG Blob → `DataTransfer` into the file input).
  - Wheel-zoom to 100% or more and choose View, then drag the mouse 30 steps.
  - Read the `peel-frame` measures.

- [ ] **Step 1: Write the tests**
  - `should_match_each_view_at_fit_and_100_percent (AC-12)`: 5 views × {fit, 100% via double-tap} = 10 screenshots of the canvas element.
  - `should_match_the_editor_layout (AC-25)`:
    - widths 375 (812 high) and 430 (932 high), `colorScheme` light and dark: 4 full-page screenshots
    - each also asserts `scrollWidth ≤ innerWidth`
  - `should_draw_a_frame_under_8_ms (AC-26)`: the median of the last 30 `peel-frame` durations is < 8.
  - `should_draw_a_12_mp_photo_at_100_percent (Review Focus 5)`: in Checkerboard, at the photo's centre, the canvas pixel equals the photo pixel ±2 (the cutout is visible, not blank). `data-mask-scale` is 1.0000.
- [ ] **Step 2: Run** `npx playwright test e2e/editor-speed.spec.ts --project=desktop-chrome`. Expected: PASS. The screenshot spec is skipped on Windows.
- [ ] **Step 3: Update docs:** add the spec 0009 decisions and any rulings to `docs/decisions.md`. Then run the full suite: `npm run lint`, `typecheck`, `format:check`, `test:coverage`, `test:perf`, `test:e2e`.
- [ ] **Step 4: Commit** `test(e2e): editor screenshots and frame budget` (Refs #58 #61 #64)
- [ ] **Step 5: On the PR:**
  - The first CI run writes the baselines.
  - `gh run download <run> -n <artifact>`, check the images by eye, and commit `test(e2e): screenshot baselines from CI Linux`.
  - CI goes green on the second run.
