# 0005 — Mask to dots: contours, holes, corners, round trip

- **Status:** Draft
- **Issues:** story #33; tasks #34 (marching squares), #35 (holes by orientation), #36 (corner vs smooth), #37 (round-trip accuracy)
- **Plan reference:** STICKER_WEBAPP_PLAN.md §4 ("Auto → dots"), Phase 4

## Why
Automatic cutouts (Phase 6) give a soft mask, not an outline. To fix a mistake the user needs the same draggable dots that lasso and pen give. This step turns a mask into rings of dots. It has to be faithful: if turning the mask into dots moves the edge, every automatic cutout gets worse before the user touches it. The outline must follow the mask's 50% line to a fraction of a pixel, holes must stay holes, sharp corners must stay sharp, and curves must stay smooth.

## Decisions in this spec (please check these)
1. **Nothing is dropped** (decided 2026-11-04 by the product owner). Every island and every hole becomes a ring, however small. This is the most exact option; the user can remove pieces by hand.
2. **Dots follow the contour within 0.5 px on soft edges and 1 px on hard edges** (hard-edge rule decided 2026-11-05 by the product owner: "follow the true shape"). The drawn curve (Béziers) of the dots is checked against the traced 50% line in both directions, as spec 0003 AC-21 checks density. A contour point is on a *hard* edge when the two pixel values it lies between are exactly 0 and exactly 1 (255 in an 8-bit mask). There the traced line is a pixel staircase up to about 0.5 px either side of the real shape. Holding dots within 0.5 px of the steps would need about 150 dots on a hard-edged circle of radius 100 px; with 1 px they follow the real shape with about 25. Soft edges, such as the AI model's masks, keep 0.5 px.
3. **A dot is a corner when the outline turns sharply.** Only the sharpest dot of each turn becomes the corner; gentler turns are smooth.
   - **Soft edges:** a turn of 45° or more, measured between the chords to the contour points 2 px of arc before and after. Soft circles with a radius of 5 px or more stay smooth.
   - **Hard edges** (decided 2026-11-05 by the product owner): the pixel staircase turns by 45° and 90° on its own, and clips true corners by up to 0.7 px, so the 2 px rule cannot tell steps from corners there. Instead, the hard points are first smoothed once (each becomes ½ itself + ¼ each neighbour), and the turn is measured between the edge directions from 4 px to 1 px of arc before the dot and from 1 px to 4 px after it. A corner needs 50° or more. Measured on hard shapes: circles with a radius of 10 px or more never get a corner; corners of 60° or more are kept 95–100% of the time; 45° corners (an octagon) are mostly rounded, still within the 1 px of Decision 2.
   - On short rings the soft support shrinks to a quarter of the perimeter, the hard support to an eighth, and the hard gap to a quarter of the hard support.
   - Where the dots sit: a soft corner dot moves to where its two edges (1–2 px either side) meet. A hard corner dot stays on the traced line, because extending a pixel staircase across one step misplaces that meeting point by more than the trace itself is off (up to about 0.7 px); hard corners are therefore within the 1 px of Decision 2 of the true corner, soft ones within 0.5 px. Smooth dots on hard edges sit on the staircase smoothed once, which is closer to the true shape.
4. **Diagonal touches join.** Where two selected pixels touch only at a corner, they belong to the same ring (the marching-squares saddle is settled by the average of the four samples: at least 50% joins the selected sides).

## Pixel convention
As spec 0004: pixel `(i, j)` covers `[i, i+1) × [j, j+1)`, and its mask value is sampled at its centre `(i + 0.5, j + 0.5)`. Everything outside the image counts as 0, so every contour is closed. The contour is the 50% line, found by linear interpolation between neighbouring centres.

## What

### Tracing (#34)
- **AC-1** Given a binary mask with an axis-aligned rectangle of selected pixels from `(x0, y0)` to `(x1, y1)` (exclusive), then tracing gives one closed contour whose straight parts lie exactly on `x = x0`, `x = x1`, `y = y0` and `y = y1`. The corners are cut by at most 0.5 px.
- **AC-2** Given two separate blobs, then tracing gives two contours, one per blob. Given two selected pixels touching only diagonally, they give one contour (Decision 4).
- **AC-3** Given a soft mask, then contour points lie where linear interpolation between neighbouring pixel centres crosses 0.5, to within 1e-9 px. Example: centres with values 0.2 and 0.8, one pixel apart, give a crossing exactly halfway between them.
- **AC-4** Given a subject touching the image border, then its contour runs along the border (at x = 0, x = width, y = 0 or y = height) and is closed.
- **AC-5** Tracing accepts values in [0, 1] (`Float32Array`) and 8-bit masks (`AlphaMask`, value / 255). An empty mask gives no contours; a fully selected mask gives one contour along the border.

### Holes (#35)
- **AC-6** Given a donut, then the result is an outer `add` ring followed by an inner `subtract` ring.
- **AC-7** Given an island inside a hole inside a subject, then the rings are ordered by nesting depth (all depth-0 `add` rings, then depth-1 `subtract`, then depth-2 `add`, …). Rendering them in that order (spec 0004) gives back the same regions.
- **AC-8** Nothing is dropped: a single selected pixel gives its own ring, and a single unselected pixel inside a subject gives its own `subtract` ring (Decision 1). Ring order is deterministic for the same mask.

### Dots and corners (#36)
- **AC-9** For every ring, the drawn curve of its dots stays within the tolerance of the traced contour, in both directions: 0.5 px, or 1 px along hard edges (Decision 2). This is checked on points sampled along both, at most every 0.1 px. A contour sample must be within the tolerance of its own edge; a curve sample must be within the tolerance of the nearest contour point (1 px if that point is on a hard edge).
- **AC-10** A rectangle of at least 4 × 4 px gives exactly 4 dots, all `corner`, each within 0.5 px of the true corner.
- **AC-11** A circle (hard-edged or anti-aliased) with a radius from 10 to 200 px gives only `smooth` dots, at most `⌈4·√r⌉ + 4` of them (44 at r = 100; the traced contour has about 600 points there). For a hard-edged circle the drawn curve stays within 0.75 px of the true circle: it follows the shape, not the pixel steps.
- **AC-12** A shape with both, such as a rounded rectangle or a "D" (half disc), has corner dots exactly at its sharp corners and smooth dots on its curves.
- **AC-13** Every ring has at least 3 dots, even a single selected pixel (it becomes 4 dots), so every result is a valid `Ring` for spec 0003.

### Round trip (#37)
- **AC-14** For each fixture, rendering the rings (spec 0004 `renderMask`) and thresholding the result at 50% gives an IoU of at least 0.99 with the original mask thresholded at 50%. Fixtures: circle, rounded rectangle, donut, two blobs, island in a hole, five-pointed star, a "D", a soft blurred blob, and a seeded random blobby shape. Each is 256 × 256 px or larger.
- **AC-15** Stricter than IoU: a pixel may change side (selected or not) only if its centre is within 1 px of the traced contour (1.5 px along hard edges). No pixel far from an edge ever changes.

### Speed
- **AC-16** Turning a 4032 × 3024 mask of a person-like shape (one subject with two holes, about 12,000 px of outline in all) into rings takes < 500 ms on desktop CI. This is a `*.perf.test.ts`.

## Contract
```ts
// src/core/contour/ — pure, no DOM
export interface CoverageMask { width: number; height: number; data: Float32Array } // 0..1
export function fromAlphaMask(mask: AlphaMask): CoverageMask
/** A closed traced line (first point not repeated); hard[k] marks points between exact 0 and 1 values. */
export interface Contour { points: Point[]; hard: boolean[] }
export function traceContours(mask: CoverageMask): Contour[]
export function contoursToRings(contours: readonly Contour[]): Ring[] // depth order, add/subtract
export function contourToNodes(contour: Contour): Node[] // dots + corner/smooth
export function maskToRings(mask: CoverageMask): Ring[] // all of the above
export const CONTOUR_LEVEL = 0.5
export const DOT_TOLERANCE_PX = 0.5 // soft edges
export const HARD_EDGE_TOLERANCE_PX = 1 // where the traced line runs between exact 0 and 1 values
export const CORNER_ANGLE_DEG = 45 // soft edges
export const CORNER_SUPPORT_PX = 2
export const HARD_CORNER_ANGLE_DEG = 50 // hard edges, after one smoothing pass
export const HARD_CORNER_SUPPORT_PX = 4 // edge directions from 4 px to 1 px either side
export const HARD_CORNER_GAP_PX = 1
```
Geometry is in image px floats.

## Out of scope
- Running the model, and keeping its soft mask as `softEdge.source = 'model'` (Phase 6).
- Smart edge refinement (Phase 5).
- Showing the dots on screen (Phase 8).
- Dropping or merging small rings (Decision 1: nothing is dropped).
