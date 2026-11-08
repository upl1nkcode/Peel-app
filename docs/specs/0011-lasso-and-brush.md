# 0011 — I can trace the exact shape with my finger and touch up with a brush

- **Status:** Approved
- **Issues:** story #74; tasks #75 (lasso drawing with live path and loupe), #76 (pause and continue across zoom and pan), #77 (magnetic toggle), #78 (add and subtract), #79 (convert a finished lasso to dots), #80 (erase and restore brush)
- **Plan reference:** STICKER_WEBAPP_PLAN.md §3.3 (Lasso), §3.4 (Brush), §3.6 (precision aids), §7 (phone-first UI), Phase 8. Builds on:
  - spec 0002: lasso recording, smoothing, curves;
  - spec 0003: commands, undo, density's curve guarantee;
  - spec 0004: brush strokes in the mask;
  - spec 0006: snapping to edges;
  - spec 0009: editor, press sequencing, loupe;
  - spec 0010: the Dots tool and its outline.

## Why

Two kinds of photo still can't be cut out well.

- **Auto finds nothing, or the wrong thing.** For example, one shoe out of a pair, a logo on a T-shirt, or a phone where the model can't run (spec 0007 AC-20). Today the only way in is a rectangle or an ellipse from the Dots tool, then dragging dot after dot. The lasso lets the user trace the shape directly.
  - The user zooms in to 16× and traces a section. They lift, pan, and carry on from where they stopped.
  - "Snap to edges" pulls the line onto the real edge.
  - The finished trace becomes dots, ready for the Dots tool.
- **Dots can't do it.** For example, a strand of hair across the background, a gap between fingers that's a few pixels wide, or a soft fur edge. The brush erases or restores the cutout itself, at a size the user can see in image pixels.

The logic exists and is tested: lasso recording and smoothing (spec 0002), snapping (spec 0006) and brush strokes in the mask (spec 0004). This story is the two tools on screen, plus a few pure helpers.

## Decisions

All of these are my calls: the product owner chose to skip the questions on 2026-11-08. Numbers 1 and 4 matter most for accuracy; please check them.

1. **Lifting the finger pauses the lasso; it doesn't close it.** The plan says the path closes on lift. But it also says the user can zoom, pan and continue the same lasso, and both can't be true. The lasso closes in one of two ways:
   - the finger lifts close to where the path started;
   - the user taps "Finish", which joins the end to the start with a straight line.
2. **Continuing moves the end the way a dot drag moves a dot** (spec 0010 AC-3). The path carries on from its end exactly, keeping the offset between finger and end, so it never jumps to where the finger landed.
3. **While a lasso is open, Undo removes its last section**: one drag, from finger down to finger up. That way a slip at the end of a long trace doesn't cost the whole trace. An open lasso isn't part of the undo history; only the finished ring is.
4. **How closely the dots follow the trace depends on the zoom it was traced at.** The drawn curve stays within 1 screen pixel of the trace, measured at that zoom: within 1/k image px, where k is the screen px per image px. It is never tighter than 0.25 px and never looser than 8 px (the density slider's range, spec 0003).
   - **Why:** a fixed tolerance in image pixels is wrong at both ends. On a 12 MP photo at fit, 1 px (spec 0002's lasso tolerance) keeps every wobble of the finger, giving thousands of dots. At 16× it throws away detail the user traced carefully.
   - **One tolerance per ring:** a lasso traced at several zooms uses its finest tolerance. Parts traced at fit then get more dots than they need, which the Fewer slider removes.
   - **Snapped sections** use 0.5 px, the contour tolerance of spec 0005. They aren't smoothed, because they already sit within 0.25 px of the edge (spec 0006 AC-8).
   - **Guaranteed on the curve:** the tolerance holds on the curve itself, not just at the dots, as the density slider guarantees (spec 0003 AC-21).
5. **Every dot from a lasso is smooth.** A sharp corner becomes a tight curve within the tolerance of the trace; a long-press makes it a corner (spec 0010 AC-10). Detecting corners in a finger trace would guess.
6. **"Snap to edges" is off by default.** It works best on clean edges (spec 0006); on busy photos it can jump to a nearby edge. The user turns it on when the edge is clean.
7. **Finishing a lasso switches to the Dots tool**, as issue #79 asks. Tap Lasso again for another one.
8. **The open lasso survives switching tools** and shows again when Lasso is chosen. It is dropped when another photo or sticker is opened, or on "Discard".
9. **Brush defaults: Erase, hardness 100%, and a size of 40 screen px at the zoom where the brush is first chosen.** The size is then kept in image pixels.
   - **Hardness 100%:** what's inside the circle is exactly what changes.
   - **A second finger:** it cancels the stroke, as it cancels a dot drag (spec 0009 AC-2). Unlike a lasso section, a stroke is quick to redo.
10. **The toolbar becomes Auto · Lasso · Dots · Brush · View**, in the order a cutout is usually made.
    - "Use Lasso" (spec 0007 AC-20) now opens the Lasso tool.
    - It only shows while the Auto tool is open. This fixes it covering the top of the photo in other tools on short screens, as found in story #65.
11. **Lasso and brush options aren't remembered after a reload.** Issue #79 says "smoothing strength from settings"; the Smoothing slider in the Lasso sheet is that setting.

## What

Sizes are CSS px unless they say image px. k is the screen (CSS) px per image px at the current zoom.

Taps, drags and the second finger work as spec 0009 AC-2 to AC-4. A drag is a press that moves more than 10 px. Two fingers always pan and pinch.

### Draw a lasso (#75)

- **AC-1** Given the Lasso tool and no open lasso, when a one-finger drag starts, then a lasso starts where the finger went down, so the first 10 px aren't lost. Every touch sample is recorded in image px floats, never rounded, as spec 0002 AC-1 describes. That includes the coalesced samples between frames, where the browser provides them. The path may go past the photo's edge.
- **AC-2** Given the Lasso tool, then:
  - the open path is drawn every frame, as a 2 px white line with a 1 px dark outline;
  - an 8 px white dot marks its start;
  - the selection's outline is drawn as in spec 0010 AC-1, without dots, so the user sees what they add to or cut from.

  Auto, Brush and View show no lasso.
- **AC-3** Given a lasso drag, then the loupe shows (spec 0009 AC-13 to AC-15). Its crosshair is on the finger, which is the newest point of the path, and it shows the path over the magnified pixels.
- **AC-4** Given an open lasso, when the finger lifts within 22 px of the start point, after having been at least 44 px from it during the lasso, then the lasso closes: the path becomes a ring in image px.
  - A Playwright touch path around a rectangle gives a ring whose drawn curve is within the AC-15 tolerance of the traced path.
  - A short drag that never got 44 px away doesn't close.

### Pause and continue (#76)

- **AC-5** Given a lasso drag, when the finger lifts anywhere else, then the lasso pauses. Its path stays, and a 20 px ring in the accent colour (the end handle) marks its end. The hint changes (AC-24).
  - Meanwhile, two fingers pan and pinch, and a double-tap toggles 100% and fit.
- **AC-6** Given a paused lasso, when a one-finger drag starts within 22 px of the end handle, then the path continues from its end. Each new point is the end plus the finger's movement since it went down, so the path never jumps.
  - The section is drawn at the new zoom.
  - A drag that starts anywhere else, or a tap, changes nothing.
- **AC-7** Given a lasso drag, when a second finger touches, then the section drawn so far is kept, the lasso pauses, and the gesture becomes a pan and pinch.
- **AC-8** Given an open lasso, then:
  - **Undo** removes its last section, and with no sections left the lasso is gone;
  - **Redo** is disabled;
  - the undo history has no steps for sections.

  Once the lasso closes, Undo and Redo work on the selection again.
- **AC-9** Given the Lasso sheet, then:
  - **"Finish"** closes an open lasso with a straight line from its end to its start;
  - **"Discard"** drops it, without an undo step;
  - both are disabled when no lasso is open.
- **AC-10** Given a lasso that can't become a ring, then it stays open, and the status reads "Draw around the area to cut out". That covers fewer than 3 distinct points, or all points on one line (spec 0002 AC-3, spec 0003 AC-13).

### Snap to edges (#77)

- **AC-11** Given the "Snap to edges" switch in the Lasso sheet (off by default) is on, then every lasso section is snapped onto the image's edges by the live-wire worker (spec 0006).
  - **Reach:** 12 pt on screen at the zoom where the section started, which is 12 / k image px (spec 0006 Decision 3).
  - **While drawing:** the finger's trail shows as a thin line, and the snapped line replaces it as it arrives. At most one snap request runs at a time, always for the newest trail.
  - **On lift:** the section becomes its final snapped line. The end handle accepts a new drag once that line has arrived.
  - **Joins:** each section starts at the previous section's end, so the path is continuous.
- **AC-12** Given a photo with a straight colour edge, and a lasso traced along it with a seeded wobble of up to half the reach:
  - snapping on, every point of the closed ring's curve along that edge is within 1 image px of the true edge;
  - snapping off, the ring follows the finger, with the wobble kept within the AC-15 tolerance.
- **AC-13** Given a snap request that fails, then that section keeps the finger's line, treated as an unsnapped section. The status reads "Couldn't snap to edges here, kept your line".

### Add and subtract (#78)

- **AC-14** Given the Lasso sheet, then it has a two-way choice, "Add" or "Subtract", with Add chosen by default. "Subtract" is disabled while the selection has no rings.
  - **Closing in Add** is one undo step (`addRing`), so the area joins the selection. A ring overlapping the selection merges with it: the mask is opaque over the union.
  - **Closing in Subtract** is one undo step (`subtractRing`), so the area is cut out. A ring inside the selection makes a hole: the mask is transparent inside it.
  - **The soft edge:** the selection's soft-edge setting applies to the new edges as to the rest (spec 0010 Decision 1).

### Convert to dots (#79)

- **AC-15** Given a lasso that closes, then its ring of dots is made like this:
  1. **Smoothing:** each unsnapped section is smoothed as an open path with its two ends kept, using Chaikin corner cutting (spec 0002 #16). The strength comes from the "Smoothing" slider: 0 (raw) to 4, default 1. Snapped sections aren't smoothed.
  2. **Tolerance:** each section has one; for an unsnapped section it is min(8, max(0.25, 1/k)) image px, with k as when it was traced, and 0.5 px for a snapped section. The ring uses the smallest tolerance of its sections (Decision 4).
  3. **Dots:** all smooth, placed so that every point sampled along the joined path (at most every 0.1 px) lies within the tolerance of the drawn curve, and every point sampled along the curve lies within the tolerance of the path. That is spec 0003 AC-21's guarantee, applied to the path.
- **AC-16** Given a lasso that closes, then the Dots tool opens with no dot selected, and every new dot is editable at once. The Lasso options (Add or Subtract, Snap, Smoothing) stay as they were for the next lasso.
- **AC-17** Given smoothing 0, then step 1 leaves the path unchanged.

### Brush (#80)

- **AC-18** Given the Brush tool, then the sheet has a two-way choice, "Erase" or "Restore", with Erase chosen by default.
  - **A one-finger drag** paints a stroke from where the finger went down; every touch sample is recorded in image px floats.
  - **On lift,** the stroke is one undo step (`addStroke`), with its mode, size and hardness as they were when it started.
  - **A second finger** cancels the stroke, and nothing is recorded.
  - **A tap** paints a single dab, 250 ms after lifting; a double-tap toggles 100% and fit and paints nothing.
  - **Spec 0004 governs the result:** erase and restore, hardness, order after the rings, and clipping to the photo.
- **AC-19** Given the Brush sheet, then:
  - **Size:** a "Size" slider shows the size as "Size N px", where N is a whole number of image px from 1 to 1000. The slider is logarithmic, so each step is the same ratio.
    - The first time Brush opens on a photo, the size is round(40 / k), kept within 1 to 1000.
    - Zooming doesn't change the size in image px, so the brush looks bigger when zoomed in.
  - **Hardness:** a "Hardness" slider shows "Hardness N%", from 0 to 100, with 100 as the default.
- **AC-20** Given a brush drag, then the loupe shows, with its crosshair on the finger. It draws the brush as a circle of its true size at the loupe's magnification. Below 100% hardness, a dashed inner circle shows where full strength ends: radius × hardness (spec 0004 AC-9).
- **AC-21** Given a brush drag, then:
  - the stroke's area is shown every frame, as a translucent band of the brush's diameter: red for Erase, green for Restore;
  - the cutout re-renders at screen resolution, at most one render at a time, with the stroke so far;
  - after lift it renders properly (spec 0009 AC-9);
  - saving uses the full-resolution mask (spec 0004).
- **AC-22** Given a selection with no rings, then Restore still paints in, so a sticker can be made with the brush alone, and Erase changes nothing visible.

### Layout

- **AC-23** Given the editor, then the toolbar is Auto · Lasso · Dots · Brush · View, with the spec 0009 rules (AC-22, AC-23).
  - At 375 px wide every button is at least 44 × 44 px.
  - "Use Lasso" opens the Lasso tool, and shows only while the Auto tool is open.
- **AC-24** From top to bottom, the sheets show:
  - **Lasso:**
    - the hint: "Trace around it with one finger · Lift to pause" with no open lasso, or "Drag the end dot to go on · End at the start to close" with one open;
    - a row with Add | Subtract and the "Snap to edges" switch;
    - the "Smoothing" slider, labelled "Raw" at the left and "Smooth" at the right;
    - a row with "Finish" and "Discard".
  - **Brush:**
    - the hint: "Paint over what to remove" (Erase) or "Paint over what to bring back" (Restore);
    - a row with Erase | Restore;
    - the Size slider;
    - the Hardness slider.

  Every control is at least 44 × 44 px and has an accessible name. At 375 × 812 the canvas keeps at least 300 px of height.
- **AC-25** Given widths 375 px and 430 px, in light and dark, then a screenshot matches its stored baseline, and nothing overflows horizontally, for:
  - the Lasso tool with an open lasso over a selection;
  - the Brush tool.

  The spec 0010 AC-19 and spec 0009 AC-25 baselines are re-made, because the toolbar changes.

### Speed

- **AC-26** Given a 12 MP photo, a selection of 2,000 dots and an open lasso of 5,000 points, then drawing one frame takes under 8 ms in desktop Chromium, both while tracing and while brushing. That is the median of 30 frames (spec 0010 AC-20).
- **AC-27** Given a lasso path 10,000 image px long, traced at fit on a 12 MP photo (tolerance 8 px), then turning it into dots (AC-15) takes under 1 s in Node.
  - It runs in the render worker.
  - Until the dots arrive, the path stays drawn, the hint reads "Making dots…", and the canvas keeps panning.
  - Spec 0003's density code takes 0.7 to 1.3 s on paths of this kind, measured on 2026-11-08, so the plan needs a faster way to give the same guarantee.

## Contract

Coordinates are image px (float), except where a name says `canvasPt`. Pure helpers (no DOM):

- **`src/core/geometry/smooth.ts`:** `smoothPath(path: readonly Point[], strength: SmoothStrength): Point[]`. Chaikin on an open path with both ends kept; strength 0 returns the input (AC-15, AC-17).
- **`src/core/editor/lasso.ts`:**
  - `LassoSection { points: Point[]; snapped: boolean; tolerancePx: number }`;
  - `sectionTolerance(k: number, snapped: boolean): number` (AC-15);
  - `snapReachPx(k: number): number`, which is `SNAP_REACH_PT / k` (AC-11);
  - `closesOnLift(pathCanvasPts: readonly Point[]): boolean`, with `CLOSE_RADIUS_PX = 22` and `CLOSE_AWAY_PX = 44` (AC-4);
  - `joinSections(sections: readonly LassoSection[], smoothing: SmoothStrength): Point[]` (AC-15 step 1);
  - `continueAt(end: Point, fingerDownCanvasPt, fingerCanvasPt, vp, view): Point` (AC-6).
- **`src/core/selection/density.ts`:** `fitRing(path: readonly Point[], tolerancePx: number): Node[]`. Smooth dots with AC-15's two-way guarantee, fast enough for AC-27. It throws `InvalidLassoError` for a ring that AC-10 rejects.
- **`src/core/editor/brush.ts`:**
  - `BRUSH_MIN_PX = 1`, `BRUSH_MAX_PX = 1000`;
  - `brushSizeAt(s: number): number` and `brushSliderAt(px: number): number`, the logarithmic slider in both directions;
  - `defaultBrushSize(k: number): number` (AC-19).

**Worker messages.** The render worker gains `fitRing(path, tolerancePx) → nodes`, newest wins. Snapping uses spec 0006's existing `snap(imageId, finger, reachPx)`.

**Undo.** Steps use spec 0003's existing commands: `addRing`, `subtractRing` and `addStroke`.

## Data

None. Rings and brush strokes are already part of the saved selection (spec 0003 serialization). The open lasso, the Lasso options and the brush settings are not saved.

## Out of scope

- **A polygon lasso** (tap-tap straight lines) and a "Replace" mode.
- **Snapping while brushing.**
- **Brush pressure** (plan §3.4) and a hover preview of the brush with a mouse.
- **Auto-pan** when the finger reaches the canvas edge.
- **Changing the soft edge from the UI.**
- **Remembering the tool options** across reloads (Decision 11).
- **Translations** (#91).
