# 0002 — Lasso paths, smoothing, simplification, curves, polygons

- **Status:** Implemented
- **Issues:** story #14; tasks #15 (lasso recording), #16 (smoothing), #17 (RDP), #18 (Catmull-Rom to Bézier), #19 (polygon utilities)
- **Plan reference:** §3.2, §3.3, §4, Phase 1
- **Code:** `src/core/geometry/` — pure TypeScript, no DOM imports. All coordinates are imagePts (image pixels, float, y down).

## Why
What a finger traces is noisy. It has to become a clean outline made of a small number of editable dots, with smooth curves between them, without drifting from what the user drew. These are the building blocks the lasso, the dots tool and the contour tracer (Phase 4) all share.

## Conventions
- `Point = {x, y}`. A **path** is `Point[]` (open). A **ring** is `Point[]` with an implicit closing edge from last to first; the first point is never repeated at the end.
- A **node** is `{x, y, kind: 'corner' | 'smooth'}`.
- **Orientation** is reported as seen on screen (y down): `'cw'` or `'ccw'`. Signed area is the shoelace sum `½ Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)`; in y-down space a **positive** value means clockwise on screen. Outer rings are `cw`, holes `ccw` (Phase 4 relies on this).

## What

### Lasso recording (#15)
- **AC-1** Given a recorder, when points are added one at a time or in a batch (the coalesced touch samples of one frame), then each point is kept only if it is at least 0.5 px from the last kept point.
- **AC-2** Given a recorder with at least 3 kept points, when `close()` is called, then it returns a ring (no repeated first point; a final point within 0.5 px of the first is dropped).
- **AC-3** Given fewer than 3 kept points, when `close()` is called, then it throws `InvalidLassoError`.
- **AC-4** Given an open recorder, when more points are added later (the user zoomed/panned and continued), then they extend the same path in order. Adding after `close()` throws.

### Jitter smoothing (#16)
Smoothing is Chaikin corner cutting on a closed ring (cut at ¼ and ¾ of each edge); `strength` is the integer number of iterations (0–4).
- **AC-5** Given strength 0, then the output equals the input (same points, same order).
- **AC-6** Given a ring of n points and strength k, then the output has `n · 2ᵏ` points.
- **AC-7** Given a square and any strength, then every output point lies within the square's original bounds.
- **AC-8** Given a noisy circle (radius 100, ±1 px noise, ≥ 200 samples), when running the lasso pipeline (dedupe → smooth strength 1 → simplify ε = 1.0), then every output point is within 1.5 px of the true circle, the enclosed area is within 1% of the true area, and the point count is below 25% of the input count. *(Revised 2026-11-04: the first draft had ε = 0.75 and 10%, which cannot pass. With ±1 px per-sample jitter, RDP has to keep jitter larger than ε, and even a perfect circle needs about 26 points at ε = 0.75. Measured at ε = 1.0 over 20 seeds with 240 samples: worst error 0.99 px, worst area error 0.40%, at most 48 points.)*

### Simplification (#17)
Ramer–Douglas–Peucker with epsilon in image pixels (sub-pixel values allowed). `simplifyPath` for open paths (endpoints kept); `simplifyRing` for rings (start from the two mutually farthest points so the result does not depend on where the user began).
- **AC-9** Given collinear points, then a path collapses to its 2 endpoints.
- **AC-10** Given a known zig-zag and ε, then the output equals the hand-computed point list (table test).
- **AC-11** Given random paths and ε (property test, seeded), then every removed point is within ε of the simplified polyline, and the output is a subsequence of the input (never invents points).
- **AC-12** Given ε = 0, then no point that changes the shape is removed (collinear points may be).

### Curves (#18)
Centripetal Catmull-Rom (α = 0.5) converted to cubic Bézier segments `{p0, c1, c2, p3}`; one segment per edge between nodes.
- **AC-13** Given any nodes, then segment `i` starts exactly at node `i` and ends exactly at node `i+1` (the curve passes through every dot), and sampling each segment at t = 0 and 1 reproduces the node coordinates.
- **AC-14** Given a `corner` node, then the tangent handles on both sides point along the chords to the neighbouring nodes (a sharp point at the node); a square made of corners has straight edges.
- **AC-15** Given a `smooth` node, then the incoming and outgoing handles are collinear with the node (C¹ continuity).
- **AC-16** Given a closed ring, then the last segment ends at node 0 and the seam is continuous and, for smooth nodes, collinear like any other node. Open paths: the end nodes have handles toward their single neighbour.
- **AC-17** Given coincident or repeated nodes, then no NaN/Infinity appears in any output (degenerate handles collapse to the node).
- **AC-18** Given three or more collinear smooth nodes, then the curve stays on that line (no overshoot).

### Polygon utilities (#19)
- **AC-19** `signedArea`, `area` (absolute), `bounds` (min/max x/y), `orientation` are correct for a square (both windings), a concave C shape and a figure-8 (signed areas of lobes cancel; documented), and orientation of a hole is `ccw` when the outer is `cw`.
- **AC-20** `contains(point, ring)` uses the **nonzero winding rule** (the same as the renderer in Phase 3): inside a square, inside the arms of the C but not in its notch, inside both lobes of the figure-8.
- **AC-21** Points exactly on an edge or vertex count as inside (documented, tested); points just outside by 1e-6 do not.
- **AC-22** Degenerate rings (fewer than 3 points, zero area) give `area = 0`, `contains = false`, and do not throw.

### Robustness (all modules)
- **AC-23** Given 50,000 raw samples, then smoothing and simplification complete in under 100 ms without stack overflow (RDP is iterative).
- **AC-24** Given a self-intersecting ring, then `area`, `signedArea` and `contains` return finite results.
- **AC-25** Given all-identical or all-collinear points, then smoothing, simplification and Bézier conversion return finite numbers and do not throw.
- **AC-26** Given a ring, then `simplifyRing` returns the same point set regardless of which point the ring starts at.
- **AC-27** Given 3 raw points all within 0.4 px of each other, then `close()` throws `InvalidLassoError` (they dedupe to fewer than 3).
- **AC-28** Given 2 or 3 nodes (closed or open), then `toBezierSegments` returns finite segments (2 closed nodes give 2 straight segments; fewer than 2 nodes give `[]`).

## Contract
```ts
// src/core/geometry
class InvalidLassoError extends Error {}
createLasso(): { add(p: Point): void; addMany(ps: readonly Point[]): void; points(): readonly Point[]; close(): Point[] }
smoothRing(ring: readonly Point[], strength: 0 | 1 | 2 | 3 | 4): Point[]
simplifyPath(path, epsilon): Point[]
simplifyRing(ring, epsilon): Point[]
toBezierSegments(nodes: readonly Node[], closed: boolean): BezierSegment[]
signedArea(ring): number
area(ring): number
bounds(ring): Bounds
orientation(ring): 'cw' | 'ccw'
contains(point, ring): boolean
refineLasso(ring, { strength, epsilon }): Point[]   // smoothRing then simplifyRing; DEFAULT_LASSO_REFINE = { strength: 1, epsilon: 1.0 }
pointOnSegment(segment, t): Point
```

## Data
None. (Nodes become part of the Selection model in spec 0003.)

## Out of scope
Flattening Béziers to polylines and anti-aliased rasterization (Phase 3), contour tracing (Phase 4), boolean ring operations, density re-simplification UI, live-wire.

## Calls made by the author (please check)
1. Smoothing is Chaikin (matches the "points per iteration" criterion in #16), strength = integer iterations; default in the lasso is 1. Chaikin rounds sharp corners slightly, which is why strength 0 exists and corner-heavy objects use dots to restore them.
2. Rings never repeat the first point; closure is implicit everywhere.
3. `contains` includes the boundary and uses nonzero winding to match the planned renderer.
4. The noisy-circle accuracy bounds in AC-8 started as 1.5 px, 1% and 10% with ε = 0.75. They proved unrealistic. On 2026-11-04 the product owner chose ε = 1.0 with a 25% point-count bound; the accuracy bounds are unchanged.
