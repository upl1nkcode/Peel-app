# 0004 — Mask rendering: selection → alpha mask → transparent PNG

- **Status:** Draft
- **Issues:** story #26; tasks #27 (ring rasterization), #28 (add/subtract compositing), #29 (brush strokes), #30 (feather, trim, resize, outline), #31 (render pipeline order), #32 (apply mask, encode PNG)
- **Plan reference:** STICKER_WEBAPP_PLAN.md §4 (render), §8 (output), Phase 3

## Why
The selection (spec 0003) is only geometry. The user sees, saves and shares pixels. This step turns the selection into an 8-bit alpha mask at the photo's full resolution, then into a transparent PNG. Edge quality is what the user judges a cutout by: edges must be smooth and exactly where the outline is, the inside fully opaque, the outside fully transparent, and nowhere a seam, halo or stray background pixel. The saved sticker must come from the full-resolution render, never from a quick preview.

## Pixel convention
Pixel `(i, j)` is the square `[i, i+1) × [j, j+1)` in image coordinates; its centre is `(i + 0.5, j + 0.5)`. A mask value is the fraction of that square that is selected, from 0 to 255.

## Decisions in this spec (please check these)
1. **Rings are combined per sample point, not per pixel.** Each pixel row is sampled on 256 sub-rows. On each sub-row, the selected intervals are worked out exactly (nonzero rule per ring, then add/subtract in order) and their exact horizontal coverage is added to the pixels. Blending each ring's anti-aliased coverage instead would leave a visible seam where two add rings touch, and a fringe where a subtract ring meets an add ring. No dependency.
2. **Our own PNG encoder** (in `src/core/`, deflate supplied by the caller; the browser uses its built-in `CompressionStream`). Canvas `toBlob` premultiplies alpha, which changes the colour of semi-transparent edge pixels; our encoder writes the exact RGBA. No dependency.
3. **Curves are flattened to within 0.05 px**, stricter than the 0.25 px in issue #27. A quarter-pixel error would shift the edge pixels' coverage by up to 25%.
4. **Feather is a Gaussian blur with σ = feather / 2.5**, so a straight edge's 10–90% transition is about `feather` px wide. At the image border the mask is extended outward (clamp), so a subject touching the photo's edge stays opaque there.
5. **Work is done at full precision; the mask is rounded to 8 bits once, at the end.**

## What

### Rasterizing rings (#27)
- **AC-1** Given a ring that is an axis-aligned rectangle (corner nodes) with integer coordinates, then pixels inside are exactly 255, pixels outside exactly 0, and no other value appears.
- **AC-2** Given any non-self-intersecting polygon ring (all corner nodes), including fractional and rotated ones, then every pixel's value is within 1.5 of `255 × (exact area of the polygon inside that pixel)`, and within 1 where only one edge crosses the pixel. That is one 8-bit step plus rounding; the extra half step covers slivers thinner than a pixel. Edge pixels have values strictly between 0 and 255 wherever the exact area is strictly between 0.5/255 and 1 − 0.5/255.
- **AC-3** Given a figure-8 ring (one self-crossing), then both lobes are filled (nonzero rule). A ring that loops twice in the same direction fills once.
- **AC-4** Curved segments are flattened so that the flattened outline is within 0.05 px of the Bézier curve (checked on sampled curves, as in spec 0003 AC-21).
- **AC-5** Rings partly or entirely outside the image are clipped; nothing is written outside the mask, and the parts inside match AC-2.

### Add and subtract (#28)
- **AC-6** Given an add ring and a smaller subtract ring inside it, then the result is a donut: the hole is 0, the body 255, and both edges anti-aliased within AC-2's bounds.
- **AC-7** Rings apply in order: add A then subtract B then add C gives `(A − B) ∪ C`, and swapping the last two gives `(A ∪ C) − B`. A subtract ring before any add ring removes nothing.
- **AC-8** Given two add rings that share an edge exactly (two squares side by side), then the pixels along the shared edge are 255: no seam. Given an add ring and a subtract ring that share an edge, then the result along it matches the exact area of `A − B` (within 1.5, as AC-2).

### Brush strokes (#29)
- **AC-9** Brush size is the diameter in image pixels; the radius is `r = sizePx / 2`. A stroke's strength at a pixel depends on the distance `d` from the pixel centre to the stroke's polyline (one point is a dot): `a(d) = 1 − smoothstep(r·hardness − 0.5, r + 0.5, d)`. So a pixel is at full strength for `d ≤ r·hardness − 0.5`, untouched for `d ≥ r + 0.5`, and hardness 1 gives a 1 px anti-aliased edge.
- **AC-10** Erase: `m ← m · (1 − a)`. Restore: `m ← m + a · (1 − m)`. Strokes apply in order. A stroke's strength is computed once over its whole polyline, so overlapping parts of one stroke do not erase or restore twice.
- **AC-11** Strokes are clipped to the image. Points outside the image are allowed, and only pixels inside the image change.

### Feather, trim, resize, outline (#30)
- **AC-12** Feather `f` in [0, 3] blurs the mask with a Gaussian of σ = f / 2.5 (kernel radius ⌈3σ⌉). Feather 0 changes nothing. Pixels farther than the kernel radius from any pixel that differs from them are unchanged, so a fully opaque interior stays 255 and the background stays 0. For a straight edge and f in [1, 3], the 10%–90% transition is f px wide, within 0.25 px.
- **AC-13** Feather extends the mask outward at the image border (clamp), so a subject that touches the border stays opaque there.
- **AC-14** `trimBounds(mask, paddingPx)` returns the smallest rectangle containing every non-zero pixel, grown by `paddingPx` on each side (it may extend past the image). A mask with no non-zero pixel throws `EmptyMaskError`.
- **AC-15** `cropRgba(image, bounds)` copies that rectangle. Parts outside the source are transparent (0, 0, 0, 0).
- **AC-16** `resizeRgba(image, width, height)` scales down by exact area averaging on premultiplied colour, so no dark or light fringe appears at edges: a fully transparent neighbour never changes a pixel's colour. Scaling up throws `RangeError` (no output needs it).
- **AC-17** `addOutline(image, { widthPx, color })` grows the image by `⌈widthPx⌉ + 1` px on each side and draws the outline under the subject. Outline alpha is 1 at distance ≤ `widthPx − 0.5` from the subject (pixels with alpha ≥ 50%) and 0 at ≥ `widthPx + 0.5`, ramping linearly between. Fully opaque subject pixels are unchanged, so the outline shows only outside the subject.

### The render pipeline (#31)
- **AC-18** `renderMask(selection, imageSize, options?)` runs, in this order: (1) rings, (2) soft edge, (3) brush strokes in order, (4) feather. Tests prove each order. A restore stroke inside a subtract hole stays restored (brush after rings). A hard erase stroke's edge is softened by feather (feather after brush). The soft-edge step receives the mask with rings but without strokes.
- **AC-19** Step 2 is supplied by the caller as `options.refineEdge`; it runs only when the selection has a `softEdge`. Without a refiner the step is skipped. The guided filter (Phase 5) and the model's soft alpha (Phase 6) plug in here.
- **AC-20** The result is exactly `imageSize` and is rounded to 8 bits once. Nothing outside the image is written or read, whatever the selection contains.
- **AC-21** `options.scale` in (0, 1] renders a preview at `⌈width · scale⌉ × ⌈height · scale⌉`, scaling ring coordinates, brush sizes and feather by `scale`. Only `renderMask` takes a scale; the cutout path below never does.

### Cutout and PNG (#32)
- **AC-22** `applyMask(image, mask)` returns RGBA with RGB unchanged and alpha `round(imageAlpha · mask / 255)`. It throws `RangeError` if the sizes differ, so a preview-sized mask can never be applied to the full-resolution photo.
- **AC-23** `cutout(image, selection, options?)` renders at full resolution and applies the mask. Its options are `{ refineEdge? }` only, with no scale.
- **AC-24** `encodePng(image, deflate)` writes a valid 8-bit RGBA PNG (colour type 6, non-interlaced). Decoding it gives back exactly the same RGBA bytes, including RGB under partial alpha. `deflate` turns bytes into a zlib stream. In the browser it is `CompressionStream('deflate')`. A stored-blocks fallback in core needs no compression library (for tests).
- **AC-25** Playwright, on WebKit (iPhone 15) and Chromium (Pixel 8): a PNG made by `encodePng` with browser deflate decodes in the browser with the same alpha values, and opaque pixels keep their exact RGB.

### Speed
- **AC-26** Rendering a 12 MP (4032 × 3024) mask has a budget of < 1.5 s on desktop CI. The selection is two add rings and one subtract ring with 2,000 nodes in total, 20 brush strokes of 50 points, and feather 1.5. This is a `*.perf.test.ts`; the phone check is the real-device pass after the phase.

## Contract
```ts
// src/core/mask/types.ts — 8-bit, row-major, width × height
export interface AlphaMask { width: number; height: number; data: Uint8Array }
// RGBA, 4 bytes per pixel, not premultiplied
export interface RgbaImage { width: number; height: number; data: Uint8Array }
export class EmptyMaskError extends Error {}

// src/core/mask/render.ts
export type EdgeRefiner = (
  mask: Float32Array, // 0..1 coverage, imageSize, after step 1; refined in place
  size: Size,
  softEdge: SoftEdge,
) => void
export function renderMask(
  selection: Selection,
  imageSize: Size,
  options?: { scale?: number; refineEdge?: EdgeRefiner },
): AlphaMask

// src/core/mask/ (one file per step): rasterizeRings, applyStrokes, feather,
// trimBounds, cropRgba, resizeRgba, addOutline, applyMask, cutout
// src/core/png/encode.ts
export type Deflate = (data: Uint8Array) => Promise<Uint8Array> // zlib stream
export function encodePng(image: RgbaImage, deflate: Deflate): Promise<Uint8Array>
export const storedDeflate: Deflate // no compression; valid zlib
// src/services/deflate.ts (browser): CompressionStream('deflate')
export const browserDeflate: Deflate
```
Geometry is in image pixels (float). The mask functions are pure (no DOM); only `services/deflate.ts` touches a browser API.

## Out of scope
- Computing the soft-edge band and matting (guided filter, Phase 5; model alpha, Phase 6). This spec only defines where they plug in.
- Running renders in a worker, live preview drawing while dragging (Phase 8 may draw outlines with Canvas 2D), and output specs, sizes and WebP (Phase 9, #83).
- Colour management. PNGs carry no colour-space chunk, so pixels are taken as sRGB; Phase 7 decides how photos are decoded.
- Upscaling, and outline styles other than a solid colour.
