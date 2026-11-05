# Mask to dots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a soft or hard-edged mask into rings of draggable dots that follow its 50% line within 0.5 px (1 px along hard edges), with holes, sharp corners and smooth curves preserved.

**Architecture:** `src/core/contour/` traces the 50% line with marching squares over pixel centres (outside = 0), linking cell segments into closed `Contour`s that carry a per-point `hard` flag. Rings get their op from orientation and their order from nesting depth. Dots: corners by turn angle over a 2 px arc with non-maximum suppression, then per span a per-point-tolerance RDP, then a local two-way check of the drawn curve against the contour that inserts the worst contour point until it passes. Everything is linear in the outline length, so it does not reuse spec 0003's `resimplifyRing` (1.1 s on a 12,000-point ring, against a 0.5 s budget).

**Tech Stack:** TypeScript 6.0 (strict), Vitest 5. No new dependencies.

**Spec:** `docs/specs/0005-mask-to-dots.md` (issues #33–#37)

## Global Constraints

- `src/core/` has no DOM or browser APIs. Geometry is in image px floats. Pixel `(i, j)` is sampled at its centre `(i + 0.5, j + 0.5)`; outside the image counts as 0.
- Constants: `CONTOUR_LEVEL = 0.5` (selected when value ≥ 0.5); `DOT_TOLERANCE_PX = 0.5`; `HARD_EDGE_TOLERANCE_PX = 1`; `CORNER_ANGLE_DEG = 45`; `CORNER_SUPPORT_PX = 2`; curve checks sample every ≤ 0.1 px.
- A contour point is hard when the two values it interpolates between are exactly 0 and exactly 1. Saddles: the mean of the 4 samples ≥ 0.5 joins the selected corners.
- Nothing is dropped, except contours that enclose no area (fewer than 3 distinct points, or zero area, e.g. a lone pixel at exactly 0.5). They select nothing.
- Test names `should_...` with the AC id; seeded randomness (`src/test/random.ts`). Coverage of `src/core/` ≥ 90%. Timing tests go in `*.perf.test.ts`.
- Branch `feat/34-37-mask-to-dots`; one commit per task (Conventional Commits, `Refs #N`).

## Review Focus

1. **Saddles and exact-0.5 values:** a 2×2 checkerboard (one ring, Decision 4), a lone pixel at exactly 0.5 (no ring), and values exactly 0.5 on an edge (coinciding points are merged, not duplicated) (Task 1).
2. **Borders and tiny masks:** a full mask, 1×1 and 1×N masks, and a subject touching all four borders give closed rings along x = 0 / width and y = 0 / height (Task 1).
3. **Noisy masks:** a 12 MP mask with a subject plus 2,000 one-pixel specks and pinholes. Every speck gets its ring (nothing dropped), and depth sorting must not go quadratic: < 1.5 s in the perf test (Tasks 2, 4).
4. **Corners at the seams:** a corner at contour index 0, a ring with no corners, a ring whose points are all corners (a lone pixel's diamond), and rings shorter than 4 × the corner support (the support shrinks to a quarter of the perimeter) (Task 3).
5. **Mixed hard and soft edges:** a shape whose left side is hard and right side anti-aliased. The 1 px allowance applies only along the hard part; the soft part keeps 0.5 px (Task 3).

---

### Task 1: Marching squares (#34)

**Files:**
- Create: `src/core/contour/types.ts`, `src/core/contour/trace.ts`
- Test: `src/core/contour/trace.test.ts`

**Interfaces:**
- Consumes: `AlphaMask` (`mask/types`), `Point`
- Produces:
  - `CoverageMask`, `Contour { points: Point[]; hard: boolean[] }`, `CONTOUR_LEVEL`, `fromAlphaMask(mask): CoverageMask` (value / 255).
  - `traceContours(mask: CoverageMask): Contour[]`, closed (first point not repeated). Each contour starts at its smallest (y, x) point. Contours are listed in order of that start point.
  - Orientation: selected region on the left when walking in image coordinates (y down), so outer contours have negative `signedArea` and holes positive. Task 2 relies on this.

- [ ] **Step 1: Write the failing tests**
  - `should_trace_rectangle_edges_exactly (AC-1)`: binary rectangle (3, 2)–(9, 7) in 12×10. One contour. Every point lies on x ∈ {3, 9} or y ∈ {2, 7}, or on a corner chamfer within 0.5 px of a corner. All points `hard`.
  - `should_trace_separate_blobs_and_join_diagonals (AC-2)`: two blobs give 2 contours. Pixels (2, 2) and (3, 3) only give 1 contour. A 2×2 checkerboard gives 1 contour (Review Focus 1).
  - `should_interpolate_soft_values (AC-3)`: a horizontal ramp row (… 0.2, 0.8 …) gives a crossing exactly halfway, within 1e-9. A crossing between 0.3 and 0.9 lies at 1/3. Such points are not `hard`.
  - `should_close_contours_along_the_border (AC-4)`: a full 5×4 mask gives one contour on the image border. A subject touching all four borders is closed. 1×1 and 1×7 masks work (Review Focus 2).
  - `should_accept_8_bit_masks_and_empty_ones (AC-5)`: `fromAlphaMask` gives value / 255; an all-zero mask gives `[]`.
  - `should_skip_contours_without_area (Review Focus 1)`: a lone pixel at exactly 0.5 gives `[]`. Points from exact-0.5 values are never duplicated consecutively.
  - `should_orient_outer_and_hole_contours_oppositely (AC-6)`: donut gives one negative and one positive `signedArea`.
- [ ] **Step 2: Run** `npx vitest run src/core/contour` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - Cells span between pixel centres, with cell (ci, cj) for ci ∈ [−1, W−1], cj ∈ [−1, H−1]. Each cell emits 0–2 directed segments, inside on the left, between points on its edges keyed by a unique edge id (2 · (index of the edge's first sample) + horizontal/vertical bit).
  - Link the segments with a `Map` (or `Int32Array` over edge ids) from start edge to end edge, then walk the loops.
  - Crossing at t = (0.5 − a) / (b − a); `hard` when {a, b} = {0, 1}. Drop consecutive duplicate points (merging `hard` with AND), then contours whose area is 0.
- [ ] **Step 4: Run** the Step 2 command, `npm run lint`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): trace mask contours with marching squares`

---

### Task 2: Rings, holes and order (#35)

**Files:**
- Create: `src/core/contour/rings.ts`
- Test: `src/core/contour/rings.test.ts`

**Interfaces:**
- Consumes: Task 1; `signedArea`, `bounds`, `contains` (`geometry/polygon`); `Ring`
- Produces:
  - `contoursToRings(contours: readonly Contour[], toNodes: (c: Contour) => Node[] = cornerNodes): Ring[]`. `cornerNodes` (every point a `corner` dot) is the default until Task 3 passes `contourToNodes`.
  - `nestingDepth(contours: readonly Contour[]): number[]`.

- [ ] **Step 1: Write the failing tests**
  - `should_make_a_donut_from_add_and_subtract (AC-6)`: rings `[add, subtract]`.
  - `should_order_rings_by_depth (AC-7)`: subject ⊃ hole ⊃ island, plus a second subject. Ops are `[add, add, subtract, add]`. `renderMask` of the rings, thresholded at 50%, equals the mask thresholded (corner-only rings trace the contour exactly).
  - `should_keep_every_speck_and_pinhole (AC-8)`: a single selected pixel gives 1 ring of 4 dots. A single unselected pixel in a 5×5 block gives `[add, subtract]`. The same mask twice gives identical rings.
  - `should_match_orientation_to_depth (AC-6)`: on seeded random blob masks, the op from orientation equals the op from depth parity.
- [ ] **Step 2: Run** `npx vitest run src/core/contour/rings` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Op from orientation: negative area → `add`, positive → `subtract`.
  - Depth: number of other contours containing the midpoint of the contour's first segment (a point on a contour never lies on another, since contours do not cross). Only consider candidates whose bounds strictly contain this contour's bounds: sort contours by bounds area, descending, and test only larger ones.
  - Sort stably by depth, keeping trace order within a depth.
- [ ] **Step 4: Run** the Step 2 command, lint, typecheck — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): turn contours into ordered add and subtract rings`

---

### Task 3: Dots, corners and the curve check (#36)

**Files:**
- Create: `src/core/contour/corners.ts`, `src/core/contour/dots.ts`, `src/test/curveCheck.ts`
- Modify: `src/core/contour/rings.ts` (default `toNodes` becomes `contourToNodes`)
- Test: `src/core/contour/corners.test.ts`, `src/core/contour/dots.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2; `toBezierSegments`, `sampleSegment`
- Produces:
  - `CORNER_ANGLE_DEG = 45`, `CORNER_SUPPORT_PX = 2`; `findCorners(points: readonly Point[]): number[]` (sorted indices).
  - `DOT_TOLERANCE_PX = 0.5`, `HARD_EDGE_TOLERANCE_PX = 1`; `contourToNodes(contour: Contour): Node[]`.
  - Test oracle `curveExcess(contour: Contour, nodes: readonly Node[]): number`. It returns the largest amount by which AC-9 is exceeded (≤ 0 means pass). It samples both lines at 0.1 px and brute-forces nearest distances with a grid. The tolerance comes from the nearest contour sample, whose hard flag is that of its segment (hard only if both ends are hard).

- [ ] **Step 1: Write the failing tests**
  - `should_find_rectangle_corners_only (AC-10)`: a binary rectangle (≥ 4 × 4) gives exactly 4 corner indices, each within 0.5 px of a true corner. A soft (anti-aliased) rotated rectangle gives 4.
  - `should_find_no_corners_on_circles (AC-11)`: binary and anti-aliased circles with r ∈ {3, 10, 50, 200} give none.
  - `should_handle_short_rings_and_seams (Review Focus 4)`: a lone pixel's diamond gives 4 corners. A rectangle traced so that a corner is at index 0 still gives 4. A ring with no corners gives `[]`.
  - `should_follow_the_contour_within_tolerance (AC-9)`: 40 seeded random blob masks, half hard-edged, half soft, plus the mixed hard/soft shape (Review Focus 5). `curveExcess ≤ 0` for every ring.
  - `should_give_4_corner_dots_on_rectangles (AC-10)`.
  - `should_give_few_smooth_dots_on_circles (AC-11)`: r ∈ {10, 50, 100, 200}, hard and soft. All dots `smooth`, count ≤ ⌈4√r⌉ + 4. For hard circles the curve is within 0.75 px of the true circle.
  - `should_mix_corners_and_curves (AC-12)`: a "D" and a rounded rectangle have corner dots exactly at the sharp corners (within 0.5 px) and smooth dots elsewhere.
  - `should_give_every_ring_3_or_more_dots (AC-13)`: the single pixel gives 4 dots, and every random-blob ring gives ≥ 3.
- [ ] **Step 2: Run** `npx vitest run src/core/contour` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`findCorners`:** the arc-length table of the closed polyline. Support s = min(2, perimeter / 4). For each point, the points at arc ±s (interpolated, wrapping); turn = angle between chord(back → p) and chord(p → ahead). A candidate has turn ≥ 45°. Keep a candidate only if no other candidate within ±s of arc has a larger turn, or an equal turn and a smaller index.
  - **`contourToNodes`:**
    - Spans run between consecutive corners (or the whole ring, split at its two farthest-apart points when there are no corners).
    - In each span, run an RDP with per-point tolerance: split at the point with the largest `dist − 0.9 · tol(point)` while it is > 0.
    - Corners become `corner` dots, picks `smooth` dots.
    - Then check the drawn curve locally: for dot k, the contour points between dots k − 1 and k + 2 against curve segments k − 1 … k + 1, and each segment's samples against the contour points between its neighbouring dots, both ways with the AC-9 tolerances. Insert the contour point of largest excess into the failing gap as a `smooth` dot, and repeat until no gap fails. (A local window is stricter than AC-9's global nearest.)
    - If a ring ends up with fewer than 3 dots, add the farthest contour points.
  - **`rings.ts`:** the default `toNodes` is now `contourToNodes`.
- [ ] **Step 4: Run** the Step 2 command, lint, typecheck — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): place corner and smooth dots along contours`

---

### Task 4: `maskToRings`, round trip and speed (#37)

**Files:**
- Create: `src/core/contour/index.ts`, `src/test/maskFixtures.ts`, `src/core/contour/roundTrip.test.ts`, `src/core/contour/contour.perf.test.ts`
- Modify: `src/core/contour/rings.ts` (export `maskToRings`)

**Interfaces:**
- Consumes: Tasks 1–3; `renderMask`
- Produces: `maskToRings(mask: CoverageMask): Ring[]` = `contoursToRings(traceContours(mask))`; `index.ts` re-exports the public API. Fixtures: `maskFixtures(): { name: string; mask: CoverageMask }[]`, built by rasterizing known shapes with spec 0004 (soft), or thresholding them (hard), at ≥ 256 × 256.

- [ ] **Step 1: Write the failing tests**
  - `should_round_trip_every_fixture_with_iou_0_99 (AC-14)`: circle, rounded rectangle, donut, two blobs, island in a hole, five-pointed star, "D", soft blurred blob (spec 0004 `feather` at 3), and seeded random blob. Each in a hard and a soft version. Compute IoU of `renderMask(maskToRings(m))` ≥ 128 against `m ≥ 0.5`.
  - `should_only_change_pixels_near_edges (AC-15)`: on the same fixtures, every pixel that changes side has its centre within 1 px of a traced contour (1.5 px if the nearest contour point is hard).
  - `contour.perf.test.ts` — `should_convert_a_12_mp_mask_in_under_500_ms (AC-16)`: a 4032 × 3024 person-like mask (smooth body with head, two arm-gap holes, about 12,000 px of outline, soft edge from spec 0004), best of 2.
  - `contour.perf.test.ts` — `should_keep_thousands_of_specks_quickly (Review Focus 3)`: the same mask plus 2,000 seeded one-pixel specks and pinholes. All rings are kept (count = 1 + holes + specks), in < 1.5 s.
- [ ] **Step 2: Run** `npx vitest run src/core/contour` and `npx vitest run contour.perf` — Expected: FAIL (`maskToRings` missing).
- [ ] **Step 3: Implement** `maskToRings` and `index.ts`.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm run test:coverage && npm run test:perf` — Expected: all PASS, `src/core/` ≥ 90%.
- [ ] **Step 5: Commit** `feat(core): convert masks to rings with a round-trip accuracy check`

---

### Done when
All four tasks are committed, CI is green, `docs/decisions.md` has a "Mask to dots decisions" section, spec 0005 is set to Implemented in the same PR, and the PR has `Closes #33` … `#37` (one line each).
