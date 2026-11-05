# 0005 — Mask to dots: contours, holes, corners, round trip

- **Status:** Draft
- **Issues:** story #33; tasks #34 (marching squares), #35 (holes by orientation), #36 (corner vs smooth), #37 (round-trip accuracy)
- **Plan reference:** STICKER_WEBAPP_PLAN.md §4 ("Auto → dots"), Phase 4

## Why
Automatic cutouts (Phase 6) give a soft mask, not an outline. To fix a mistake the user needs the same draggable dots that lasso and pen give. This step turns a mask into rings of dots. It has to be faithful: if turning the mask into dots moves the edge, every automatic cutout gets worse before the user touches it. The outline must follow the mask's 50% line to a fraction of a pixel, holes must stay holes, sharp corners must stay sharp, and curves must stay smooth.

## Decisions in this spec (please check these)
1. **Nothing is dropped** (decided 2026-11-04 by the product owner). Every island and every hole becomes a ring, however small. This is the most exact option; the user can remove pieces by hand.
2. **Dots follow the contour within 0.5 px.** The drawn curve (Béziers) of the dots stays within 0.5 image px of the traced 50% line, in both directions, as spec 0003 AC-21 checks density. The plan asks for "sub-pixel tolerance"; 0.5 px is half a pixel.
3. **A dot is a corner when the outline turns by 45° or more** within 2 px of it, measured between the chords to the contour points 2 px of arc before and after. Only the sharpest dot of each turn becomes the corner. Gentler turns are smooth. So rectangles keep sharp corners, and circles with a radius of 3 px or more stay smooth (they turn by 2/r radians over that span).
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
- **AC-9** For every ring, the drawn curve of its dots stays within 0.5 px of the traced contour, in both directions. This is checked on points sampled along both, at most every 0.1 px.
- **AC-10** A rectangle of at least 4 × 4 px gives exactly 4 dots, all `corner`, each within 0.5 px of the true corner.
- **AC-11** A circle (binary or anti-aliased) with a radius from 10 to 200 px gives only `smooth` dots, at most `⌈4·√r⌉ + 4` of them (44 at r = 100; the traced contour has about 600 points there).
- **AC-12** A shape with both, such as a rounded rectangle or a "D" (half disc), has corner dots exactly at its sharp corners and smooth dots on its curves.
- **AC-13** Every ring has at least 3 dots, even a single selected pixel (it becomes 4 dots), so every result is a valid `Ring` for spec 0003.

### Round trip (#37)
- **AC-14** For each fixture, rendering the rings (spec 0004 `renderMask`) and thresholding the result at 50% gives an IoU of at least 0.99 with the original mask thresholded at 50%. Fixtures: circle, rounded rectangle, donut, two blobs, island in a hole, five-pointed star, a "D", a soft blurred blob, and a seeded random blobby shape. Each is 256 × 256 px or larger.
- **AC-15** Stricter than IoU: a pixel may change side (selected or not) only if its centre is within 1 px of the traced contour. No pixel far from an edge ever changes.

### Speed
- **AC-16** Turning a 4032 × 3024 mask of a person-like shape (one subject with two holes, about 12,000 px of outline in all) into rings takes < 500 ms on desktop CI. This is a `*.perf.test.ts`.

## Contract
```ts
// src/core/contour/ — pure, no DOM
export interface CoverageMask { width: number; height: number; data: Float32Array } // 0..1
export function fromAlphaMask(mask: AlphaMask): CoverageMask
export function traceContours(mask: CoverageMask): Point[][] // closed polylines, first point not repeated
export function contoursToRings(contours: readonly (readonly Point[])[]): Ring[] // depth order, add/subtract
export function contourToNodes(contour: readonly Point[]): Node[] // dots + corner/smooth
export function maskToRings(mask: CoverageMask): Ring[] // all of the above
export const CONTOUR_LEVEL = 0.5
export const DOT_TOLERANCE_PX = 0.5
export const CORNER_ANGLE_DEG = 45
export const CORNER_SUPPORT_PX = 2
```
Geometry is in image px floats.

## Out of scope
- Running the model, and keeping its soft mask as `softEdge.source = 'model'` (Phase 6).
- Smart edge refinement (Phase 5).
- Showing the dots on screen (Phase 8).
- Dropping or merging small rings (Decision 1: nothing is dropped).
