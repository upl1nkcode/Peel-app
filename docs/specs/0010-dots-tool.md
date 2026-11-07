# 0010 — I can fine-tune the outline dot by dot

- **Status:** Approved
- **Issues:** story #65; tasks #66 (drag dots with large touch targets), #67 (fine mode), #68 (insert by tapping an edge, delete by double-tap), #69 (corner/smooth by long-press), #70 (multi-select and move), #71 (nudge pad), #72 (dot density slider), #73 (starting shapes)
- **Plan reference:** STICKER_WEBAPP_PLAN.md §3.2 (Dots), §3.6 (precision aids), §7 (phone-first UI), Phase 8. Builds on spec 0001 (view transforms, hit-testing, gestures), spec 0002 (curves), spec 0003 (edit commands, undo, density) and spec 0009 (editor, press sequencing, loupe).

## Why

Auto gets most objects nearly right, but "nearly" isn't the product. Take a cup where Auto cut off the tip of the handle, or kept a 3 px strip of table under the base. Today the only fixes are more taps, which re-run the model and may not help, or Undo. Nothing lets the user put the outline exactly on the edge they can see at 100%.

The Dots tool does that. The outline becomes dots the user drags onto the exact edge, adds, deletes, and switches between sharp corners and curves. Fine dragging and a 1-pixel nudge make single-pixel placement possible on a phone. Starting shapes let the user cut something out without Auto at all, for example when Auto can't run on their phone (spec 0007 AC-20).

The logic layer already exists and is tested: every dot command, undo, density and hit-testing (specs 0001–0003). This story is the tool on screen: gestures, the options sheet, how dots look, and a few small pure helpers.

## Decisions

All of these are my calls: the product owner chose to skip the questions on 2026-11-08. The first one matters most for accuracy; please check it.

1. **Moving dots keeps Auto's soft edge.** The model's alpha still refines the 8 px band around the new outline, so hair and fur detail stays where it was good. Outside that band the dots always win (spec 0006).
   - **The cost:** suppose the user drags the outline out 20 px to take in a missed cup handle, and the handle has the same colour as what's behind it. Then up to 8 px inside the new line can follow the model (which says "not cup") instead of the dots.
   - **The alternative** is switching to the image-only soft edge (`guided`) on the first dot edit. That makes the dots win everywhere, but loses the model's hair detail on the whole selection.
2. **Double-tap on a dot deletes it; a double-tap anywhere else still toggles 100% and fit** (spec 0009 AC-3). Both taps must land on the same dot.
3. **Box-select is a one-finger drag on empty space; there's no separate Select mode.** In Dots, one finger on empty space did nothing, and panning is two fingers in every tool, so nothing is lost. A stray drag only selects dots, which changes nothing and isn't an undo step.
4. **Tapping a dot selects it, and only it.** A box selects every dot inside it, replacing the selection. Tapping empty space clears the selection.
5. **Fine mode is on by default.** It's a toggle in the Dots sheet, and engages only after the finger holds still mid-drag, so a quick drag is never slowed down.
6. **The density slider springs back to the middle when released.** Each move is relative to the current dots, as spec 0003 decision 3 requires: one move of the slider (finger down to finger up) is computed from the curve as it was when the move started. A slider that stayed where it was left would suggest a stored setting, but nothing is stored.
7. **The density slider changes every ring at once,** as one undo step.
8. **A starting shape is added to what's already there,** as another `add` ring. On an empty selection it becomes the whole selection.
9. **In the Dots tool the outline is drawn as a thin line** on top of every view. You can't tap an edge you can't see. Spec 0009 decision 5 (shading only, no line) still holds in Auto and View.
10. **The toolbar becomes Auto · Dots · View.** Lasso and Brush add theirs in story #74 (spec 0009 decision 6).

## What

Sizes are CSS pixels unless they say image or device pixels. Taps, long-presses, double-taps and the 250 ms wait are as spec 0009 AC-2 to AC-4: a tap is held < 500 ms and moves ≤ 10 px; a long-press is held ≥ 500 ms and moves ≤ 10 px. A press that moves more than 10 px is a drag. "Hit" means within 22 px on screen at any zoom (spec 0001), with dots winning over edges and the nearest dot winning over others.

### Showing the dots (#66, #69)

- **AC-1** Given the Dots tool and a selection with rings, then:
  - every ring's outline is drawn as its curve (spec 0002), as a 1 px white line with a 1 px dark outline;
  - every dot is drawn on top, 8 px across: smooth dots as circles, corner dots as squares, both white with a 1.5 px dark outline;
  - selected dots are 12 px across and filled with the accent colour.

  Their size on screen is the same at every zoom. Auto and View show no dots and no line.
- **AC-2** Given the Dots tool and an empty selection, then the sheet's hint reads "Start with a shape, or use Auto", and tapping or dragging on the canvas changes nothing.

### Drag a dot (#66, #67)

- **AC-3** Given a press that hits a dot and becomes a drag, then that dot follows the finger: its new position is its old one plus the finger's movement since it went down, converted to image px. So the first 10 px aren't lost, and the dot keeps its offset from the finger. The outline and the dot move in the same frame as the finger. This works at fit and at 16× (#66).
- **AC-4** Given a dot drag, when it ends, then the move is one undo step (`moveNode`, or `moveNodes` for a selection as in AC-11). A drag that ends where it started records nothing. A drag cancelled by a second finger (spec 0009 AC-2) puts the dot back and records nothing.
- **AC-5** Given a dot drag, then the loupe shows (spec 0009 AC-13 to AC-15). Its crosshair is centred on the dot, not on the finger, and shows the dot and outline over the magnified pixels.
- **AC-6** Given "Fine" is on (the default) and a dot drag, when the finger has stayed within 2 px of one point for 300 ms, then fine mode engages for the rest of the drag. From that point the dot moves ¼ as far as the finger. The loupe's ring turns the accent colour while it's engaged. With "Fine" off, the dot always follows the finger 1 to 1 (#67).
- **AC-7** Given a dot drag, then the dot may go past the photo's edge, as spec 0003 AC-2 allows; positions are image px floats, never rounded.

### Add, delete, corner or curve (#68, #69)

- **AC-8** Given a tap that hits an edge but no dot, then 250 ms after it lifts (spec 0009 AC-4), a smooth dot is inserted on that edge at the point of the drawn curve nearest to where the tap went down, within 0.01 image px. That is one undo step (`insertNode`), and the new dot becomes the selection.
- **AC-9** Given a double-tap whose two presses both hit the same dot, then that dot is deleted as one undo step (`deleteNode`). A ring left with fewer than 3 dots is removed (spec 0003 AC-8), and the view doesn't zoom. Any other double-tap toggles 100% and fit as before.
- **AC-10** Given a long-press that hits a dot, then on lift that dot switches between corner and smooth, as one undo step (`toggleKind`), and the curve redraws at once.

### Select several and move them (#70)

- **AC-11** Given a tap that hits a dot, then that dot becomes the only selected dot. Given a tap that hits nothing, then nothing is selected. Given a drag that starts on no dot and no edge, then a box from where it went down to the finger is drawn, and on lift every dot inside it is selected, replacing the selection. A box isn't an undo step.
- **AC-12** Given several selected dots, when one of them is dragged, then they all move by the same amount, and the move is one undo step (`moveNodes`). Dragging a dot that isn't selected selects it alone first.
- **AC-13** Given any change that doesn't come from the Dots tool (undo, redo, an Auto result, reset to auto, a new photo, a re-opened sticker), then the dot selection is cleared. Deleting a selected dot removes it from the selection.

### Nudge pad (#71)

- **AC-14** Given selected dots, when one of the four arrow buttons (← ↑ ↓ →) in the Dots sheet is tapped, then every selected dot moves exactly 1 image px that way, as one undo step per tap (`nudge`). The buttons are disabled when no dot is selected. Their accessible names are "Nudge left", "Nudge up", "Nudge down" and "Nudge right".

### Dot density (#72)

- **AC-15** Given the "Dots" slider in the Dots sheet, labelled "Fewer" at the left and "More" at the right, with its thumb in the middle, then:
  - moving it from the middle to a position `s` in [−1, 1] sets every ring to `setDensity` with a tolerance of `0.5 × 16^(−s)` px left of the middle (up to 8 px) and `0.5 × 0.02^(s)` px right of it (down to 0.01 px);
  - the result is computed from the rings as they were when the finger went down;
  - while it moves, the dots and outline update to the newest position as soon as the previous one is computed, and positions in between may be skipped;
  - the canvas keeps panning and pinching meanwhile, because density runs off the main thread.
- **AC-16** Given the slider is released, then the result for the release position is one undo step for all rings together, and the thumb returns to the middle. A release that changes nothing, including one at the middle, records nothing (spec 0003 AC-24).

### Starting shapes (#73)

- **AC-17** Given the "Rectangle" or "Ellipse" button in the Dots sheet, when it is tapped, then a ring is added:
  - **where:** centred on the middle of the part of the photo that is visible, 60% of that part's width and height;
  - **the rectangle** is 4 corner dots;
  - **the ellipse** is 8 smooth dots, each exactly on the ellipse;
  - it is one undo step (`addRing`), its dots are immediately editable, and none of them is selected.

### Layout

- **AC-18** Given the editor, then the toolbar is Auto · Dots · View, with the spec 0009 rules (AC-22, AC-23). From top to bottom, the Dots sheet shows:
  - the hint "Drag a dot · Tap the line to add · Double-tap to delete · Hold for corner";
  - a row with the "Fine" switch, "Rectangle" and "Ellipse";
  - the "Dots" slider;
  - the nudge pad as one row of four buttons.

  Every control is at least 44 × 44 px and has an accessible name. At 375 × 812 the canvas keeps at least 300 px of height.
- **AC-19** Given widths 375 px and 430 px, in light and dark, with the Dots tool open on a photo with a selection, then a screenshot matches its stored baseline and nothing overflows horizontally. The spec 0009 AC-25 baselines are re-made, because the toolbar changes.

### Speed

- **AC-20** Given a 12 MP photo and a selection of 2,000 dots, with the Dots tool active, then drawing one frame takes under 8 ms in desktop Chromium. That is the median of 30 frames, both while panning and while dragging a dot (spec 0009 AC-26). The real-phone check confirms that dragging feels immediate on a mid-range phone.
- **AC-21** Given a dot drag, then the outline follows the finger every frame without waiting for a mask render. While the finger moves, the cutout is re-rendered at screen resolution, at most one render at a time, using the newest positions. It is rendered properly (spec 0009 AC-9) once the drag ends.

## Contract

Coordinates are image px (float), except where a name says `canvasPt`. These pure helpers go in `src/core/editor/dots.ts` (no DOM):

- `hitDots(selection, canvasPt, vp, view): DotHit | null`, where `DotHit` is either `{ kind: 'node', ref: NodeRef }` or `{ kind: 'edge', ring, afterNode, imagePt }` (AC-8, AC-11). It uses the drawn curve (`toBezierSegments`, sampled), and dots win over edges.
- `dragPosition(state, fingerCanvasPt, t): { positions: Point[]; fine: boolean }`. It is created by `startDrag(nodes, fingerCanvasPt, t, vp, view, fineEnabled)` and handles AC-3 and AC-6. Time is passed in, with no timers.
- `nodesInBox(selection, a: Point, b: Point, vp, view): NodeRef[]` (AC-11).
- `densityTolerance(s: number): number | null`. It returns null at exactly 0 (AC-15, AC-16).
- `startingShape(kind: 'rectangle' | 'ellipse', visible: Rect): Node[]` (AC-17).

The density for the slider runs in the render worker as a new message, `resimplify(selection, tolerancePx) → Selection`, using spec 0003's `setDensity` on each ring. Undo steps use spec 0003's existing commands; the density result is applied as one `restore`.

## Data

None. Dots, kinds and positions are already part of the saved selection (spec 0003 serialization). The Fine switch and the dot selection are not remembered.

## Out of scope

- **Lasso, Brush and the magnetic snap** (story #74).
- **Changing the soft edge from the UI** (band size, model or guided, feather).
- **Two-finger tap to select;** two fingers always pinch and pan (plan §7).
- **Keyboard editing of dots** other than through the nudge buttons, auto-repeat on holding a nudge button, and auto-pan when a dot is dragged to the canvas edge.
- **Merging Auto and dot edits.** A new Auto tap after dot edits replaces the selection with the new Auto result, as today; Undo brings the edits back.
- **Translations** (#91).
