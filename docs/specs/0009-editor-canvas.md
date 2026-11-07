# 0009 — I can zoom in and see exactly which pixels are kept

- **Status:** Approved
- **Issues:** story #58; tasks #59 (editor canvas: pinch zoom, pan, double-tap 100%/fit), #60 (loupe with crosshair), #61 (view toggles), #62 (hold-to-compare), #63 (undo, redo, reset to auto), #64 (bottom toolbar and tool options sheet)
- **Plan reference:** STICKER_WEBAPP_PLAN.md §3.6 (precision aids), §7 (phone-first UI), Phase 8. Builds on spec 0001 (view transforms, gesture machine), spec 0003 (undo history), spec 0007 (Auto) and spec 0008 (sticker panel).

## Why

Accuracy is the product, and nobody can judge a cutout they can't see. Today the photo is only shown fitted to the screen, so on a 12 MP photo one screen pixel covers about nine photo pixels: a strand of leftover background, or a missing fingertip, is invisible until the sticker is used. The user needs to zoom deep in, see each kept pixel against a background that exposes leftovers, and see what is under their finger. They also need to undo mistakes safely.

This story turns the temporary tap-to-cut screen (spec 0007 decision 8) into the editor shell that the Dots, Lasso and Brush tools plug into in the next stories.

## Decisions

1. **Pinch zooms and two fingers pan, like a normal photo, in every tool; double-tap also toggles 100% and fit** (decided 2026-11-07 by the product owner). On Auto a single tap therefore acts 250 ms after the finger lifts, so the two taps of a double-tap only zoom and add nothing. An Auto result already takes 0.35–0.9 s, so the wait hardly shows.
2. **Slide to aim in Auto** (decided 2026-11-07 by the product owner). Pressing and sliding shows the loupe with a crosshair, and lifting adds the object under the crosshair. A quick tap adds and a long-press removes, as before. A press that moved used to do nothing, so nothing that worked before changes.
3. **At 100% and above, photo pixels are drawn as crisp squares** (my call). Smoothing would blur a leftover background pixel into its neighbours, which is the opposite of the story. Below 100% the image is downscaled smoothly. (Amended in the final review: at exactly 100% the photo sits at a fractional offset, so smoothing smeared every pixel over two.)
4. **At 100% and above, the cutout shown is the full-resolution render**, the same mask a save stores (my call). Below 100% it is rendered at screen resolution, as the plan's preview rule says. Zooming in asks for a sharper render only when the one on screen is too coarse; panning and zooming out never ask for one.
5. **The Overlay view shades what is removed instead of drawing an outline line** (my call). A line would cover the very edge pixels being checked; shading shows the exact boundary at any zoom. Overlay is the default view.
6. **The toolbar shows only tools that exist** (my call): Auto and View now. Dots, Lasso and Brush add their buttons in their own stories, so a shipped build never has dead buttons.
7. **In the View tool, one finger pans** (my call). It is for looking, so it never edits. Taps there do nothing, except that a double-tap zooms.
8. **The spec 0008 sticker panel moves into a "Stickers" sheet** opened from the top bar (my call), unchanged inside. Phase 9's Finish and Library screens replace it.
9. **The editor follows the system's light or dark setting** (my call; plan §7). The canvas backgrounds (checkerboard, black, white, red) are the same in both, so colours are judged the same way.

## What

Sizes are CSS pixels unless they say device pixels. "Display scale" means device pixels per photo pixel, so 100% is a display scale of 1 (spec 0001 AC-8).

### Zoom and pan (#59)

- **AC-1** Given a photo, when two fingers pinch, then the view zooms between 1× (whole photo fitted) and 16×. The photo point under the starting midpoint of the fingers stays under their current midpoint, and the view stays inside the photo (spec 0001 AC-5 to AC-7). This holds in every tool and never changes the selection.
- **AC-2** Given one finger pressing in a tool, when a second finger goes down, then the press is cancelled: nothing is added, removed or aimed, the loupe hides, and the two fingers pinch and pan (spec 0001 AC-10). A new press needs all fingers lifted first.
- **AC-3** Given two taps where the second goes down within 250 ms of the first lifting and within 24 px of the first, when the second lifts, then the view toggles between 100% (anchored at the second tap) and fit (spec 0001 AC-8), and neither tap does anything else. This holds in every tool. (Taps are as spec 0007 AC-25: held < 500 ms, moved ≤ 10 px.)
- **AC-4** Given a tap that is not followed by a second tap within 250 ms, then its tool action happens 250 ms after it lifted, at the point where it went down.
- **AC-5** Given the View tool, when one finger (or a mouse button) drags, then the view pans by the drag, clamped as in AC-1, and the selection never changes.
- **AC-6** Given a mouse wheel or a trackpad pinch (a `wheel` event, with or without Ctrl), then the view zooms by a factor of `2^(−deltaY / 200)` (in pixels; lines count as 16 px, pages as the canvas height), anchored at the pointer and clamped to 1×–16×.
- **AC-7** Given a new photo is picked or a sticker re-opened, then the view starts fitted (1×).

### What the canvas shows (#59, #61)

- **AC-8** Given a display scale of 1 or above, then each photo pixel is drawn as a crisp square: any two device pixels inside the same photo pixel have the same colour. Below 1, the image is downscaled smoothly. A display scale within 1e-9 of 1 counts as 1.
- **AC-9** Given a display scale of 1 or more, then the mask on screen is the scale-1 render of the current selection, identical to what a save stores (spec 0008 AC-6). Below 1, it is rendered at the display scale.
- **AC-10** Given a pinch, pan or zoom out, then no new render is requested. A render is requested when the selection changes, or when zooming in needs a finer mask than the one on screen (AC-9). A pinch requests its render when it ends, and wheel zoom 150 ms after the last wheel event. Until the render arrives, the previous mask is shown stretched.
- **AC-11** Given the View sheet, then it offers five views: Overlay (the default), Checkerboard, Black, White and Red. The chosen view stays when switching tools and photos. For a photo pixel of colour `p` and mask alpha `a` (0 to 1), the canvas shows:
  - **Overlay:** `p × (1 − 0.5 × (1 − a))`. The whole photo, with what is removed shaded to half brightness.
  - **Checkerboard:** `a × p + (1 − a) × c`, where `c` is a checkerboard of 8 px squares in `#ffffff` and `#cfcfd6`. The squares stay 8 px at every zoom.
  - **Black, White, Red:** `a × p + (1 − a) × b`, with `b` = `#000000`, `#ffffff` or `#ff0000`.
  Each channel may be off by at most 2 (out of 255), for rounding and colour management.
- **AC-12** Given a photo and selection, then a screenshot of each view at fit and at 100% matches its stored baseline (issue #61).

### Loupe (#60)

- **AC-13** Given one finger down in a tool that uses drags (in this story, Auto's slide to aim), when it has moved more than 10 px from where it went down, then a circular loupe 120 px across appears. It shows the canvas around the finger magnified 4×, but at most 32 px per photo pixel, in the current view, with photo pixels as crisp squares (AC-8). A crosshair at its centre marks the photo point the finger is on. The crosshair stays visible on any colour: a 1 px white line with a 1 px dark outline.
- **AC-14** Given the loupe is showing, then its centre is 90 px above the finger, kept inside the canvas horizontally. If it would go past the canvas's top edge, it shows 90 px below the finger instead.
- **AC-15** Given the loupe is showing, when the finger lifts, the press is cancelled (AC-2) or the pointer is cancelled, then the loupe hides at once.

### Auto in the editor (amends spec 0007 AC-24)

- **AC-16** Given the Auto tool, then:
  - a tap adds the object at the point where it went down, 250 ms after lifting (AC-4)
  - a long-press (held ≥ 500 ms, moved ≤ 10 px) removes, as soon as it lifts
  - a press that moved more than 10 px aims: the loupe follows it, and lifting adds the object at the lift point
  Every point is kept at least half a photo pixel inside the photo (as today). A tap, long-press or aim whose point is outside the photo does nothing.
- **AC-17** Given an Auto status (downloading, working, "Sharper cutout ready", errors and "Use Lasso", spec 0007), then it shows in a status strip over the top of the canvas, whichever sheet is open.

### Compare, undo, redo, reset (#62, #63)

- **AC-18** Given a photo, while the "Compare" button is held (pointer down, or Space or Enter held while it has focus), then the canvas shows the original photo: no shading and no cutout. When it is released, cancelled or left, the chosen view returns. Pinch and pan still work while it is held.
- **AC-19** Given the history (spec 0003), then "Undo" is disabled exactly when there is nothing to undo, and "Redo" exactly when there is nothing to redo. They undo and redo every selection change: Auto results, resets and re-opened stickers.
- **AC-20** Given a photo with no Auto result yet (including a re-opened sticker before any tap), then "Reset to auto" is not shown. Once Auto has produced a result for this photo, it is shown. It is disabled while the selection already equals the latest Auto result. Tapping it makes the latest Auto result the selection, as one undoable step.

### Layout (#64)

- **AC-21** Given the editor, then from top to bottom it has:
  - a top bar with "Photo" (pick a photo) and "Stickers" (opens the spec 0008 panel in a sheet)
  - the canvas
  - an action row with Undo, Redo, Reset to auto and Compare
  - the tool options sheet
  - the bottom toolbar with Auto and View
  It fills `100dvh`, pads by `env(safe-area-inset-*)`, and the page doesn't scroll. Only the canvas has `touch-action: none`.
- **AC-22** Given any button or tool in the editor, then its touch target is at least 44 × 44 px and it has an accessible name. The active tool is marked with `aria-pressed="true"`, and the views are a radio group.
- **AC-23** Given a tool button, when it is tapped, then that tool becomes active and its options sheet opens. Tapping the active tool again closes or reopens its sheet. The Auto sheet shows "Tap to add · Hold to remove · Slide to aim". The View sheet shows the five views.
- **AC-24** Given no photo yet, then the canvas area shows a "Pick a photo" button, and the tools, Undo, Redo and Compare are disabled.
- **AC-25** Given widths 375 px and 430 px, in light and dark, then a screenshot of the editor with a photo matches its stored baseline, and nothing overflows horizontally.

### Speed

- **AC-26** Given a 12 MP photo, then drawing one frame of the canvas at any zoom and in any view takes under 8 ms in desktop Chromium, measured in the page (median of 30 frames while panning). The real-phone check confirms smooth panning on a mid-range phone.

## Contract

Coordinates are image pixels (float), except where a name says `screenPt` or `canvasPt`.

- **View math** reuses `src/core/coords` (`clampView`, `applyTwoFingerGesture`, `toggleActualSize`, `viewScale`). Wheel zoom is a new pure function there: `applyWheelZoom(vp, view, canvasPt, deltaYPx): View` (AC-6).
- **Press sequencing** is pure, in `src/core/gestures`. It takes pointer events and a clock, and gives tool intents: `tap`, `longPress`, `aimStart`, `aimMove`, `aimEnd`, `doubleTap` and `cancel`. The 250 ms wait is a deadline the caller polls; there are no timers in core (AC-2 to AC-4, AC-16).
- **Loupe placement** is pure: `loupePlacement(fingerCanvasPt, canvasSize): { center: Point; below: boolean }` (AC-14).
- **View colours** are pure: `viewPixel(view, p, a, checkerColour)` gives AC-11's formulas. Tests check the canvas drawing against it.
- **Auto controller:** `AutoState` gains `hasAutoResult: boolean` and `autoResultSelection: Selection | null`, the history snapshot that holds the latest Auto result, or null when that result isn't applied (AC-20).
- The render worker's `render(imageId, selection, scale)` is unchanged. AC-9's scale-1 preview uses the same render path as `renderFull`.

## Data

None. Nothing new is stored. The chosen view is not remembered between visits.

## Out of scope

- **The Dots, Lasso and Brush tools** and their buttons (stories #65 and #74).
- **The Finish screen, Library and Share** (Phase 9). The spec 0008 panel stays, in a sheet.
- **Translations.** The editor is English only until #91.
- **Rotating or cropping the photo, keyboard zoom shortcuts, and remembering the view between visits.**
- **A minimap or a zoom percentage readout.**
