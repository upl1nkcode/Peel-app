# Mask rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a `Selection` into an exact, anti-aliased, full-resolution 8-bit alpha mask, then into a transparent PNG whose pixels are exactly the cutout.

**Architecture:** `src/core/mask/` works on a `Float32Array` of coverage (0..1) the size of the output and rounds to 8 bits once. Rings are flattened to line segments, then each pixel row is sampled on 256 sub-rows. On each sub-row every ring's inside intervals are found (nonzero), folded in order (add = union, subtract = difference), and their exact horizontal coverage is added to the row. Brush strokes, feather and the post-processing steps are separate pure functions. `src/core/png/` encodes RGBA with a caller-supplied deflate. `src/services/deflate.ts` is the browser deflate (`CompressionStream`).

**Tech Stack:** TypeScript 6.0 (strict), Vitest 5, Playwright. No new dependencies.

**Spec:** `docs/specs/0004-mask-rendering.md` (issues #26–#32)

## Global Constraints

- `src/core/` has no DOM or browser APIs, including `CompressionStream`. Core tests may import only pure helpers from `src/test/`. Geometry is in image px floats. Pixel `(i, j)` is `[i, i+1) × [j, j+1)`.
- Precision: coverage math in float64, row accumulators `Float64Array`, the working mask `Float32Array`. Round to 8 bits only in `toAlphaMask` (`Math.round(clamp01(v) · 255)`).
- Constants: **256** sub-rows per pixel row; Bézier flattening tolerance **0.05** px; feather σ = **f / 2.5**, kernel radius ⌈3σ⌉, clamp at borders. Brush `a(d) = 1 − smoothstep(r·hardness − 0.5, r + 0.5, d)` with `r = sizePx / 2`.
- Errors: `EmptyMaskError` (trim), `RangeError` (size mismatch, upscaling, bad `scale` or image size).
- Test names `should_...` with the AC id; seeded randomness (`src/test/random.ts`). Coverage of `src/core/` ≥ 90%. Timing tests go in `*.perf.test.ts`.
- Branch `feat/27-32-mask-rendering`; one commit per task (Conventional Commits, `Refs #N`).

## Review Focus

1. **Sub-rows that hit a vertex exactly** (vertex y = j + (s + 0.5)/256, e.g. half-integer coordinates). The crossing must count once: an edge is active for y in [ymin, ymax). Horizontal and zero-length edges are skipped (Task 1).
2. **Degenerate and off-image rings:** a collinear ring (the parser now accepts these), duplicate consecutive nodes, a ring entirely outside the image, and a ring covering the whole image with coordinates far beyond it (±1e6). These render nothing, nothing, nothing and all 255 respectively, with no crash or out-of-range write (Tasks 1, 5).
3. **Tiny sizes:** 1×1 and 1×N images, `scale` giving a 1 px preview, a 0.1 px brush, and a brush bigger than the image (Tasks 3, 5).
4. **Feather at the borders:** a subject touching the image edge stays 255 at the edge after feather 3, and a constant mask is unchanged (Task 4).
5. **PNG layout:** odd widths, 1×1, a fully transparent image, and data over 65,535 bytes, which needs several stored blocks. All must decode to the exact bytes (Task 6).

---

### Task 1: Ring rasterization (#27)

**Files:**
- Create: `src/core/mask/types.ts`, `src/core/mask/flatten.ts`, `src/core/mask/rasterize.ts`, `src/test/area.ts`
- Test: `src/core/mask/flatten.test.ts`, `src/core/mask/rasterize.test.ts`

**Interfaces:**
- Consumes: `toBezierSegments`, `sampleSegment` (geometry); `Ring` (selection)
- Produces:
  - `AlphaMask`, `RgbaImage`, `EmptyMaskError` (as in the spec contract).
  - `toAlphaMask(coverage: Float32Array, size: Size): AlphaMask`.
  - `FLATTEN_TOLERANCE = 0.05`; `flattenRing(nodes: readonly Node[], scale = 1): Point[]` returns a closed polyline (the first point is not repeated).
  - `SUBROWS = 256`; `rasterizeRings(rings: readonly Ring[], size: Size, scale = 1): Float32Array` (coverage 0..1). Task 1 handles `add` rings; Task 2 adds the fold.
  - Test helper `pixelArea(polygon: readonly Point[], i: number, j: number): number`. It clips the polygon to the pixel square (Sutherland–Hodgman) and returns the shoelace area. It is exact for simple polygons.

- [ ] **Step 1: Write the failing tests**
  - `should_flatten_curves_within_0_05_px (AC-4)`: seeded random smooth rings. Every `sampleSegment(seg, 0.01)` point is within 0.05 of the flattened polyline, and every polyline vertex lies on the curve (within 1e-9). Corner-only rings flatten to exactly their nodes.
  - `should_fill_an_integer_rectangle_exactly (AC-1)`: rectangle (2,3)–(7,9) in a 10×12 mask. Assert 255 inside, 0 outside, and that the set of values is {0, 255}.
  - `should_match_exact_pixel_area (AC-2)`: 40 seeded polygons (convex, concave, rotated rectangles, fractional coordinates, 3–12 corner nodes), 32×32 mask. Assert `|value − 255·pixelArea| ≤ 1.5` everywhere, and `≤ 1` on pixels crossed by a single edge. Values are strictly in (0, 255) where `0.5/255 < area < 1 − 0.5/255`.
  - `should_fill_both_lobes_of_a_figure_8 (AC-3)` and `should_fill_a_doubled_loop_once (AC-3)`.
  - `should_clip_rings_outside_the_image (AC-5)`: a ring half outside matches `pixelArea` inside; a ring fully outside gives all 0. A ring at ±1e6 around the image gives all 255 (Review Focus 2).
  - `should_count_a_crossing_at_a_vertex_once (Review Focus 1)`: a diamond with vertices on half-integer y, plus a triangle with a vertex exactly on a sub-row centre. Compare against `pixelArea`.
  - `should_render_degenerate_rings_as_empty (Review Focus 2)`: a collinear ring and a ring with repeated nodes give all 0, and no error.
- [ ] **Step 2: Run** `npx vitest run src/core/mask` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - **`flattenRing`:** for each `toBezierSegments(nodes, true)` segment (coordinates × `scale`), subdivide at t = 0.5 (de Casteljau) until both control points are within `FLATTEN_TOLERANCE` of the chord *segment*; emit chord ends. The convex-hull property bounds the curve's distance.
  - **Edges:** `{ x0, y0, x1, y1, dir }` with y0 < y1 and `dir = ±1`; skip edges with y0 = y1. An edge is active for sub-row y when `y0 ≤ y < y1`.
  - **Per row j:** for each sub-row `y = j + (s + 0.5) / SUBROWS`, gather each ring's crossings (x and dir), sort by x, and walk the winding to get the intervals where winding ≠ 0. Union the rings (Task 2 generalises). Clip the intervals to [0, W] and add each to a `Float64Array` row accumulator with weight `1 / SUBROWS`, using exact fractional coverage at both ends plus a difference array for the full pixels between. Then prefix-sum the row into the mask, clamping to [0, 1].
  - Keep per-ring edges sorted by `y0` with an active list advanced row by row, so each sub-row only touches active edges.
- [ ] **Step 4: Run** the Step 2 command, then `npm run lint` and `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add anti-aliased ring rasterization`

---

### Task 2: Add/subtract compositing (#28)

**Files:**
- Modify: `src/core/mask/rasterize.ts`
- Test: `src/core/mask/rasterize.test.ts` (added tests)

**Interfaces:**
- Consumes: Task 1
- Produces: `rasterizeRings` honours `ring.op` in order.

- [ ] **Step 1: Write the failing tests**
  - `should_make_a_donut (AC-6)`: an add circle of r 12 and a subtract circle of r 6, same centre. Assert the hole is 0, the body 255, and the edges are within AC-2 against `pixelArea` of the polygonised circles (use corner-node polygons so the oracle is exact).
  - `should_apply_rings_in_order (AC-7)`: integer-aligned squares A, B, C that overlap pairwise, so every pixel is exactly 0 or 255 and the oracle is the boolean per pixel centre. Check `[+A, −B, +C]` equals `(A − B) ∪ C` and `[+A, +C, −B]` equals `(A ∪ C) − B`. A leading subtract removes nothing. Fractional edges are covered by AC-8.
  - `should_leave_no_seam_between_touching_rings (AC-8)`: squares (0,0)–(5,10) and (5,0)–(10,10) at fractional offsets (+0.37). Pixels across the shared edge are 255. For add square and subtract square sharing an edge, match the exact `A − B` area within 1.5.
- [ ] **Step 2: Run** `npx vitest run src/core/mask/rasterize` — Expected: FAIL (subtract treated as add).
- [ ] **Step 3: Implement** the fold per sub-row: start from an empty interval list; for each ring in order, `union` (add) or `difference` (subtract) its intervals with the running list. Both are linear merges of sorted, non-overlapping interval lists. Drop empty intervals.
- [ ] **Step 4: Run** the Step 2 command, lint, typecheck — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): composite add and subtract rings in order`

---

### Task 3: Brush strokes (#29)

**Files:**
- Create: `src/core/mask/strokes.ts`
- Test: `src/core/mask/strokes.test.ts`

**Interfaces:**
- Consumes: `BrushStroke` (selection)
- Produces: `strokeStrength(d: number, radius: number, hardness: number): number`; `applyStrokes(coverage: Float32Array, size: Size, strokes: readonly BrushStroke[], scale = 1): void` (in place).

- [ ] **Step 1: Write the failing tests**
  - `should_follow_the_brush_profile (AC-9)`: `strokeStrength` is 1 for d ≤ r·h − 0.5 and 0 for d ≥ r + 0.5, monotone between. Hardness 1 gives values strictly between 0 and 1 only for d in (r − 0.5, r + 0.5).
  - `should_size_the_brush_in_image_pixels (AC-9)`: a single-point erase of `sizePx` 10, hardness 1, at (20.5, 20.5) on a full mask. Pixel centres at distance ≤ 4.5 are 0 and ≥ 5.5 untouched.
  - `should_erase_and_restore_in_order (AC-10)`: on a mask of 0.8, an erase stroke then a restore stroke give per pixel `m1 = 0.8·(1 − a1)` then `m2 = m1 + a2·(1 − m1)`, with `a1`, `a2` from `strokeStrength`, within 1e-6. Swapping the two strokes gives the swapped formula. Restore on an empty mask gives `a`.
  - `should_not_double_count_a_self_overlapping_stroke (AC-10)`: a stroke that goes A→B→A equals the stroke A→B.
  - `should_clip_strokes_to_the_image (AC-11)`: points outside the image are allowed, and a stroke entirely outside changes nothing. A 0.1 px brush and a brush bigger than the image work (Review Focus 3).
- [ ] **Step 2: Run** `npx vitest run src/core/mask/strokes` — Expected: FAIL.
- [ ] **Step 3: Implement.** Per stroke (sizes and points × `scale`), allocate a `Float32Array` over the stroke's bounding box (± r + 0.5) clipped to the image. Each segment (or the single point) writes `max(existing, strokeStrength(distToSegment(pixelCentre)))` over its own clipped box. Then composite the box into the mask with the erase or restore formula. `max` of a decreasing profile equals the profile of the minimum distance, which is what AC-10 requires.
- [ ] **Step 4: Run** the Step 2 command, lint, typecheck — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add erase and restore brush strokes`

---

### Task 4: Feather, trim, crop, resize, outline (#30)

**Files:**
- Create: `src/core/mask/feather.ts`, `src/core/mask/trim.ts`, `src/core/mask/resize.ts`, `src/core/mask/outline.ts`
- Test: one `*.test.ts` next to each

**Interfaces:**
- Consumes: Task 1 types
- Produces:
  - `feather(coverage: Float32Array, size: Size, px: number): void` (in place).
  - `trimBounds(mask: AlphaMask, paddingPx: number): Bounds` (integer pixel bounds, `maxX`/`maxY` exclusive).
  - `cropRgba(image: RgbaImage, bounds: Bounds): RgbaImage`.
  - `resizeRgba(image: RgbaImage, width: number, height: number): RgbaImage`.
  - `addOutline(image: RgbaImage, options: { widthPx: number; color: readonly [number, number, number] }): RgbaImage`.

- [ ] **Step 1: Write the failing tests**
  - `should_soften_only_edges (AC-12)`: a 40×40 square mask with feather 2. Pixels farther than the kernel radius (⌈3·0.8⌉ = 3) from the edge are exactly 1 or 0. Feather 0 leaves the array identical.
  - `should_make_the_transition_about_feather_px_wide (AC-12)`: a vertical step edge, f ∈ {1, 1.5, 2, 3}. The 10%→90% crossing distance (linear interpolation along the row) is within 0.25 of f.
  - `should_keep_border_subjects_opaque (AC-13)`: a mask that is 1 on the left half including column 0, feather 3. Column 0 stays 1. A constant mask is unchanged (Review Focus 4).
  - `should_trim_with_padding (AC-14)`: bounds of the non-zero pixels grown by the padding (allowed past the image). An all-zero mask throws `EmptyMaskError`.
  - `should_crop_with_transparent_outside (AC-15)`.
  - `should_downscale_by_area_without_fringes (AC-16)`: 4×4 → 2×2 averages exactly. An opaque red pixel next to transparent pixels with garbage RGB keeps colour (255, 0, 0) wherever alpha > 0. Non-integer ratios (5×3 → 2×2) conserve total premultiplied colour. Upscaling throws `RangeError`.
  - `should_draw_the_outline_only_outside (AC-17)`: a 10×10 opaque square with `widthPx` 3. The image grows by 4 on each side; subject pixels are unchanged; outline alpha is 1 at distance ≤ 2.5 and 0 at ≥ 3.5, linear between, with the outline colour.
- [ ] **Step 2: Run** `npx vitest run src/core/mask` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`feather`:** separable normalised Gaussian; σ = px / 2.5, radius ⌈3σ⌉, clamp-to-edge.
  - **`resizeRgba`:** separable exact area weights (fractional end weights) on premultiplied float colour; un-premultiply and round at the end; RGB = 0 where alpha = 0.
  - **`addOutline`:** pad by ⌈widthPx⌉ + 1, binary set = alpha ≥ 128. Distance to the set's pixel centres via the exact squared Euclidean distance transform (Felzenszwalb–Huttenlocher, two 1-D passes). Outline alpha = clamp(widthPx + 0.5 − d, 0, 1). Composite the subject over the outline (straight-alpha "over").
- [ ] **Step 4: Run** the Step 2 command, lint, typecheck — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add feather, trim, resize and outline`

---

### Task 5: The render pipeline (#31)

**Files:**
- Create: `src/core/mask/render.ts`, `src/core/mask/render.perf.test.ts`
- Test: `src/core/mask/render.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4
- Produces: `EdgeRefiner`, `renderMask(selection, imageSize, options?)` as in the spec contract.

- [ ] **Step 1: Write the failing tests**
  - `should_restore_inside_a_subtract_hole (AC-18)`: brush after rings.
  - `should_feather_a_hard_erase_edge (AC-18)`: feather after brush.
  - `should_give_the_refiner_rings_without_strokes (AC-18, AC-19)`: a stub refiner records a copy of what it received (equals the rings-only raster) and writes 0.5 everywhere. The strokes still apply after it.
  - `should_skip_refinement_without_soft_edge_or_refiner (AC-19)`.
  - `should_return_the_image_size_rounded_once (AC-20)`: dimensions equal `imageSize`. Values equal `toAlphaMask` of the float pipeline. A selection whose rings and strokes lie far outside does not throw. A 1×1 and a 1×N image work. A non-integer or zero `imageSize` throws `RangeError`.
  - `should_render_a_scaled_preview (AC-21)`: `scale` 0.25 of 401×301 gives 101×76, equal to rendering the selection with coordinates, sizes and feather × 0.25 at that size. `scale` 0, > 1 or NaN throws `RangeError`.
  - `render.perf.test.ts` — `should_render_12_mp_in_under_1_5_s (AC-26)`: the AC-26 selection (seeded), best of 2.
- [ ] **Step 2: Run** `npx vitest run src/core/mask/render` — Expected: FAIL.
- [ ] **Step 3: Implement** `renderMask` as `rasterizeRings` → `refineEdge` (only if `selection.softEdge` and a refiner exist) → `applyStrokes` → `feather` → `toAlphaMask`, passing `scale` to each step.
- [ ] **Step 4: Run** the Step 2 command, `npm run test:perf`, lint, typecheck — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add the renderMask pipeline`

---

### Task 6: Cutout and PNG (#32)

**Files:**
- Create: `src/core/mask/cutout.ts`, `src/core/mask/index.ts`, `src/core/png/encode.ts`, `src/core/png/zlib.ts`, `src/core/png/index.ts`, `src/services/deflate.ts`, `src/test/png.ts`, `e2e/png.spec.ts`
- Test: `src/core/mask/cutout.test.ts`, `src/core/png/encode.test.ts`, `src/services/deflate.test.ts`

**Interfaces:**
- Consumes: Task 5
- Produces:
  - `applyMask(image: RgbaImage, mask: AlphaMask): RgbaImage`.
  - `cutout(image: RgbaImage, selection: Selection, options?: { refineEdge?: EdgeRefiner }): RgbaImage`.
  - `Deflate`, `encodePng(image, deflate): Promise<Uint8Array>`, `storedDeflate`, `crc32(bytes): number`, `adler32(bytes): number`.
  - `browserDeflate: Deflate`.
  - Test helper `decodePng(bytes: Uint8Array): RgbaImage`, pure. It checks the signature, chunk CRCs and IHDR, inflates **stored blocks only** and checks Adler-32, then unfilters all five filter types.

- [ ] **Step 1: Write the failing tests**
  - `should_keep_rgb_and_set_alpha_from_the_mask (AC-22)`, including an image that already has alpha. A size mismatch throws `RangeError`.
  - `should_cut_out_at_full_resolution (AC-23)`: equals `applyMask(image, renderMask(selection, size))`.
  - `should_round_trip_rgba_exactly (AC-24)`: seeded random RGBA (partial alphas, RGB under alpha 0 and 1) at sizes 1×1, 3×5, 17×9, 200×120 (> 65,535 bytes), and a fully transparent image. `decodePng(await encodePng(img, storedDeflate))` equals the input byte for byte (Review Focus 5).
  - `should_write_a_valid_png_layout (AC-24)`: signature, IHDR fields (8-bit, colour type 6, no interlace), IEND, and CRCs checked against known `crc32('IEND') = 0xAE426082`.
  - `should_produce_a_zlib_stream_the_platform_inflates (AC-24)` (services test): `browserDeflate` output decompressed with `DecompressionStream('deflate')` equals the input.
  - `e2e/png.spec.ts` — `should_decode_with_transparency_in_the_browser (AC-25)`: in Node, build a 64×48 RGBA test image with an opaque block, a gradient alpha and alpha-0 pixels. Encode with `encodePng`, using a deflate that runs `CompressionStream` in the page via `page.evaluate`. In the page, decode with `createImageBitmap`, draw it on a canvas and read `getImageData`. Alpha must equal the input exactly, and opaque pixels' RGB exactly. Runs on all three projects.
- [ ] **Step 2: Run** `npx vitest run src/core/mask src/core/png src/services` and `npx playwright test e2e/png.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`encodePng`:** signature, then IHDR, one IDAT and IEND. For each row pick the filter (0–4) with the smallest sum of |signed bytes|, then deflate the filtered rows.
  - **`storedDeflate`:** header `78 01`, stored blocks of ≤ 65,535 bytes (BFINAL on the last), big-endian Adler-32.
  - **`browserDeflate`:** `new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()`.
  - **`index.ts` files** re-export the public functions.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm run test:coverage && npm run test:perf && npm run test:e2e` — Expected: all PASS, `src/core/` ≥ 90%.
- [ ] **Step 5: Commit** `feat(core): apply masks and encode transparent PNGs`

---

### Done when
All six tasks are committed, CI is green, spec 0004 is set to Implemented in the same PR, and the PR has `Closes #26` … `#32` (one line each).
