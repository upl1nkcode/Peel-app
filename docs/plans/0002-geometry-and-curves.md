# Lasso paths, smoothing, simplification, curves, polygons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pure-TypeScript geometry that turns a noisy finger path into a clean ring of as few dots as possible, with smooth curves through them, plus the polygon utilities everything else relies on.

**Architecture:** One small file per concern in `src/core/geometry/` (`polygon`, `lasso`, `smooth`, `simplify`, `bezier`, `refine`), each a set of pure functions over `Point[]`. Rings are arrays with implicit closure. A thin `refineLasso` composes dedupe → smooth → simplify.

**Tech Stack:** TypeScript 6.0 (strict), Vitest 5. No new dependencies.

**Spec:** `docs/specs/0002-geometry-and-curves.md` (issues #14, #15, #16, #17, #18, #19). Depends on plan 0001 Task 1 (`src/core/geometry/types.ts` with `Point`, `Size`, `Bounds`).

## Global Constraints

- `src/core/` has no DOM/React/browser imports; coordinates are image pixels (float, y down).
- Rings never repeat the first point; closure is implicit. Orientation is reported as seen on screen: positive shoelace sum = `'cw'`.
- Lasso dedupe distance **0.5** px; smoothing strength is an integer **0–4** (Chaikin ¼/¾); Catmull-Rom is **centripetal (α = 0.5)**.
- Accuracy test values (AC-8): radius 100, ±1 px noise, within **1.5 px**, area within **1%**, point count below **10%**.
- Test names `should_...` with the AC id; seeded randomness only (no `Math.random` in tests); coverage for `src/core/` ≥ 90%.
- Branch `feat/14-19-geometry-and-curves`; one commit per task; Conventional Commits.

## Review Focus

Each is pinned by a test in the owning task and added to the spec as an AC (AC-23 to AC-28).

1. Huge point counts (50,000 raw touch samples): simplification and smoothing finish well under 100 ms and do not overflow the stack (RDP must be iterative) (Task 4).
2. Closed ring whose first and last points coincide, or a lasso that crosses itself: `close()` drops the duplicate; self-intersecting rings still give finite area/contains results (Tasks 1, 2).
3. All points identical, or all collinear: simplify returns a valid 2-point (path) or 3-point-free degenerate result without throwing; smoothing and Béziers return finite numbers (Tasks 3, 4, 5).
4. Two nodes only (a closed ring of 2) and three nodes: Bézier conversion is defined (straight or lens-free) with no NaN (Task 5).
5. Very small features: a ring with 3 points all within 0.4 px of each other keeps its shape contract (`close()` throws `InvalidLassoError` after dedupe) (Task 2).

---

### Task 1: Polygon utilities (#19)

**Files:**
- Create: `src/core/geometry/polygon.ts`
- Test: `src/core/geometry/polygon.test.ts`

**Interfaces:**
- Consumes: `Point`, `Bounds` (plan 0001 Task 1)
- Produces: `signedArea(ring: readonly Point[]): number`, `area(ring): number`, `bounds(ring): Bounds` (throws `RangeError` on empty input), `orientation(ring): 'cw' | 'ccw'` (zero area → `'cw'`), `contains(point: Point, ring: readonly Point[]): boolean` (nonzero winding, boundary inclusive)

- [ ] **Step 1: Write the failing tests** with fixture rings (unit square both windings, concave C of 7+ vertices, figure-8, a hole ring):
  - `should_compute_signed_area_bounds_and_orientation` (AC-19): square 10×10 clockwise-on-screen → `+100`, `'cw'`; reversed → `−100`, `'ccw'`; C-shape area equals hand-computed value; figure-8 signed areas cancel to 0 (documented in the test); a hole listed `ccw` inside a `cw` outer.
  - `should_use_nonzero_winding_for_contains` (AC-20): inside square; inside C arms; not inside the C notch; inside both figure-8 lobes.
  - `should_treat_boundary_as_inside_and_1e-6_outside_as_outside` (AC-21): on an edge, on a vertex, and 1e-6 outside both.
  - `should_handle_degenerate_rings_without_throwing` (AC-22): 0, 1, 2 points and 3 collinear points give `area 0`, `contains false`.
  - `should_give_finite_results_for_a_self_intersecting_ring` (AC-24).
- [ ] **Step 2: Run** `npm test -- polygon` — Expected: FAIL.
- [ ] **Step 3: Implement** the signatures: shoelace for areas; winding-number crossing test with an explicit on-segment check (epsilon 1e-9 relative to the segment length) for the boundary.
- [ ] **Step 4: Run** `npm test -- polygon && npm run lint && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add polygon utilities (area, bounds, orientation, contains)`

---

### Task 2: Lasso recording (#15)

**Files:**
- Create: `src/core/geometry/lasso.ts`
- Test: `src/core/geometry/lasso.test.ts`

**Interfaces:**
- Consumes: `Point`
- Produces: `class InvalidLassoError extends Error`, `createLasso(): Lasso` where `interface Lasso { add(p: Point): void; addMany(ps: readonly Point[]): void; points(): readonly Point[]; close(): Point[] }`; constant `LASSO_MIN_DISTANCE = 0.5`

- [ ] **Step 1: Write the failing tests:**
  - `should_drop_points_closer_than_0_5_px_to_the_last_kept_point` (AC-1): single and batch adds, including a point at exactly 0.5 (kept) and 0.49 (dropped).
  - `should_return_a_ring_without_repeating_the_first_point` (AC-2): last point within 0.5 of the first is dropped; a path returning exactly to the start yields n distinct points.
  - `should_throw_invalid_lasso_error_for_fewer_than_3_kept_points` (AC-3): includes 3 raw points all within 0.4 px (AC-27).
  - `should_extend_the_same_path_after_a_pause_and_reject_adds_after_close` (AC-4).
- [ ] **Step 2: Run** `npm test -- lasso` — Expected: FAIL.
- [ ] **Step 3: Implement** with a closure over a `Point[]` and a `closed` flag; `points()` returns a copy.
- [ ] **Step 4: Run** `npm test -- lasso && npm run lint && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add lasso path recording with dedupe`

---

### Task 3: Jitter smoothing (#16)

**Files:**
- Create: `src/core/geometry/smooth.ts`
- Test: `src/core/geometry/smooth.test.ts`

**Interfaces:**
- Consumes: `Point`, `bounds` (Task 1, in tests)
- Produces: `type SmoothStrength = 0 | 1 | 2 | 3 | 4`, `smoothRing(ring: readonly Point[], strength: SmoothStrength): Point[]`

- [ ] **Step 1: Write the failing tests:**
  - `should_return_the_input_unchanged_at_strength_0` (AC-5): deep-equal and a new array.
  - `should_produce_n_times_2_to_the_k_points` (AC-6): n = 5, k = 0..4.
  - `should_stay_within_the_original_bounds_of_a_square` (AC-7): every strength.
  - `should_return_finite_points_for_identical_and_collinear_input` (AC-25).
- [ ] **Step 2: Run** `npm test -- smooth` — Expected: FAIL.
- [ ] **Step 3: Implement** Chaikin on a closed ring: each edge `(a, b)` yields `0.75a + 0.25b` then `0.25a + 0.75b`; repeat `strength` times.
- [ ] **Step 4: Run** `npm test -- smooth && npm run lint && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add Chaikin jitter smoothing`

---

### Task 4: Ramer–Douglas–Peucker simplification (#17)

**Files:**
- Create: `src/core/geometry/simplify.ts`, `src/test/random.ts` (seeded `mulberry32(seed): () => number`)
- Test: `src/core/geometry/simplify.test.ts`

**Interfaces:**
- Consumes: `Point`
- Produces: `simplifyPath(path: readonly Point[], epsilon: number): Point[]` (keeps both endpoints), `simplifyRing(ring: readonly Point[], epsilon: number): Point[]` (splits at the two mutually farthest points; result has at least 3 points unless the input is degenerate)

- [ ] **Step 1: Write the failing tests:**
  - `should_collapse_collinear_points_to_the_two_endpoints` (AC-9).
  - `should_reduce_a_known_zigzag_to_the_known_output` (AC-10): table with at least 3 cases (epsilon below, at and above the zig-zag amplitude).
  - `should_keep_every_removed_point_within_epsilon_and_output_a_subsequence` (AC-11): 200 seeded random paths (10–300 points) × epsilons {0.25, 0.75, 2}; measure each removed point's distance to the output polyline; assert ≤ epsilon + 1e-9 and subsequence order.
  - `should_not_remove_shape_changing_points_at_epsilon_0` (AC-12).
  - `should_not_depend_on_where_the_ring_starts` (AC-26): rotate a circle ring's start index; output point sets equal.
  - `should_simplify_50000_points_quickly_without_stack_overflow` (AC-23): a 50,000-point noisy circle in under 100 ms, no throw.
  - `should_handle_identical_points_without_throwing` (AC-25).
- [ ] **Step 2: Run** `npm test -- simplify` — Expected: FAIL.
- [ ] **Step 3: Implement** RDP iteratively with an explicit stack of index ranges and a keep-mask; perpendicular distance to the chord, falling back to point distance for zero-length chords.
- [ ] **Step 4: Run** `npm test -- simplify && npm run lint && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add RDP simplification for paths and rings`

---

### Task 5: Catmull-Rom to Bézier (#18)

**Files:**
- Create: `src/core/geometry/bezier.ts`
- Modify: `src/core/geometry/types.ts` (add `Node`, `BezierSegment`)
- Test: `src/core/geometry/bezier.test.ts`

**Interfaces:**
- Consumes: `Point`
- Produces: `interface Node extends Point { kind: 'corner' | 'smooth' }`, `interface BezierSegment { p0: Point; c1: Point; c2: Point; p3: Point }`, `toBezierSegments(nodes: readonly Node[], closed: boolean): BezierSegment[]` (closed: `n` segments; open: `n − 1`; fewer than 2 nodes → `[]`), and test helper `pointOnSegment(seg, t): Point` exported from `bezier.ts`

- [ ] **Step 1: Write the failing tests:**
  - `should_pass_through_every_node` (AC-13): random seeded nodes, closed and open; `p0`/`p3` equal nodes exactly and `pointOnSegment` at t=0 and 1 match.
  - `should_make_corner_handles_point_along_the_chords_and_square_edges_straight` (AC-14): a square of corners has `c1`, `c2` collinear with `p0`, `p3` on every edge.
  - `should_make_smooth_handles_collinear_with_the_node` (AC-15): for every smooth interior node, the incoming `c2`, the node and the outgoing `c1` are collinear (cross product ≈ 0).
  - `should_be_continuous_at_the_seam_of_a_closed_ring` (AC-16): last `p3` equals first `p0`; collinearity holds at node 0 for smooth nodes; open paths have end handles toward the single neighbour.
  - `should_return_finite_numbers_for_coincident_nodes_two_nodes_and_three_nodes` (AC-17, AC-28).
  - `should_not_overshoot_for_collinear_smooth_nodes` (AC-18): sampled points stay on the line.
- [ ] **Step 2: Run** `npm test -- bezier` — Expected: FAIL.
- [ ] **Step 3: Implement** centripetal Catmull-Rom tangents (knot spacing `|Δ|^0.5`, guarding zero distance) converted to Bézier handles; a `corner` node uses a handle on its side of the chord direction toward the neighbour (one third of the chord) instead of the smooth tangent.
- [ ] **Step 4: Run** `npm test -- bezier && npm run lint && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add centripetal Catmull-Rom to Bezier conversion`

---

### Task 6: Lasso refinement pipeline and accuracy (#14)

**Files:**
- Create: `src/core/geometry/refine.ts`, `src/core/geometry/index.ts` (re-exports)
- Test: `src/core/geometry/refine.test.ts`

**Interfaces:**
- Consumes: `createLasso`, `smoothRing`, `simplifyRing`, `area`, `SmoothStrength`
- Produces: `refineLasso(ring: readonly Point[], options: { strength: SmoothStrength; epsilon: number }): Point[]` (smooth then simplify); default options exported as `DEFAULT_LASSO_REFINE = { strength: 1, epsilon: 0.75 }`

- [ ] **Step 1: Write the failing test:** `should_turn_a_noisy_circle_into_a_clean_ring_within_tolerance` (AC-8): seeded ±1 px noise on a radius-100 circle with 240 samples run through `createLasso().addMany(...).close()` then `refineLasso(ring, DEFAULT_LASSO_REFINE)`; assert every output point is within 1.5 px of the true circle, the area is within 1% of `π·100²`, and the point count is below 24.
- [ ] **Step 2: Run** `npm test -- refine` — Expected: FAIL.
- [ ] **Step 3: Implement** `refineLasso` as `simplifyRing(smoothRing(ring, strength), epsilon)`.
- [ ] **Step 4: Run** the full verification: `npm run lint && npm run typecheck && npm run test:coverage` — Expected: all PASS, `src/core/` coverage ≥ 90%. If AC-8 fails, stop and change the spec's numbers first, then the test.
- [ ] **Step 5: Commit** `feat(core): add lasso refinement pipeline`

---

### Done when
All six tasks committed, CI green, spec 0002 status Implemented in the same PR, `Closes #14 … #19`.
