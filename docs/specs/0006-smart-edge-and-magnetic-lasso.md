# 0006 — Smart edge and magnetic lasso

- **Status:** Implemented
- **Issues:** story #38; tasks #39 (edge-cost map), #40 (live-wire), #42 (colour alpha estimate, was "guided filter matting"), #43 (band-limited smart edge), #44 (workers)
- **Plan reference:** STICKER_WEBAPP_PLAN.md §3.3 (magnetic option), §3.5 (smart edge), §4 (render pipeline step 2), §6 (`core/matting`, `workers/`), Phase 5

## Why

A drawn line or an AI mask is rarely exactly on the object's edge, and hair and fur are finer than any line. Two tools fix this using the photo itself:

- **Smart edge** recomputes alpha in a thin band along the outline, so the cutout follows the real edge, including single hair strands, instead of the drawn line.
- **Magnetic lasso** makes the lasso snap onto the strongest image edge near the finger, so a hand-traced outline lands on the real edge.

Both are heavy enough to freeze the screen on a phone, so they run in workers. This story is pure code (`src/core/matting/`) plus the worker plumbing; the buttons, slider and toggle come with the editor UI (Phase 8: #77 and the tool options sheet).

## Decisions in this spec (please check these)

1. **Smart edge estimates alpha from colours, not with the guided filter** (decided 2026-11-06 by the product owner). For each pixel in the band, the colours just inside the band (object) and just outside it (background) are averaged, and alpha is where the pixel's colour sits between the two. The plan's guided filter was prototyped first. It only softens an edge that is already right; it cannot move a line that is off the edge, and it leaves a faint haze on the background:

   | Line 2 px outside the true edge, band 8 px | Avg alpha error | Pixels on the wrong side of 50% | Hazy background pixels |
   |---|---|---|---|
   | No refinement | 0.221 | 329 | 295 |
   | Guided filter (colour guide, as planned) | 0.218 | 258 | 679 |
   | **Colour estimate** | **0.004** | **2** | **0** |
   | Hair: 24 strands 0.8 px wide, no refinement | 0.244 | 368 | 208 |
   | Hair: colour estimate | 0.020 | 32 | 0 |
   | AI model alpha at ¼ resolution, upscaled, as is | 0.151 | 36 | 321 |
   | AI model alpha: guided filter | 0.109 | 4 | 279 |
   | AI model alpha: colour estimate | 0.004 | 2 | 0 |

   Synthetic scenes (a disc on a background, 2% noise), so real photos will score lower; the Phase 10 benchmark (#94) measures real photos. Task #42 becomes "Colour alpha estimate"; no guided filter is built.
2. **Where object and background colours are too alike, the line wins.** The estimate is trusted in proportion to how far apart the two colours are: fully from a distance of 0.15 (RGB, each channel 0..1), not at all when they are equal. In between, alpha blends toward the fallback: the drawn rings' coverage, or the AI model's alpha when the soft edge's source is `model`. Guessing on a near-invisible edge would move the outline at random.
3. **Magnetic lasso reach is 12 pt on screen** (decided 2026-11-06 by the product owner). The line may snap to an edge at most 12 screen points from where the finger went. That is about 120 image px at fit zoom on a 12 MP photo and about 4 image px at 8×; the UI converts with the current zoom. Wider reaches (20 pt) jump to neighbouring edges such as a shirt seam more often; narrower (8 pt) demand careful tracing.
4. **Edges are found in colour, not brightness** (my call: accuracy). The edge strength adds the gradients of the red, green and blue channels, so a red object on a green background of the same brightness still has an edge. A brightness-only Sobel misses it.
5. **The snapped line is placed between pixels** (my call: accuracy). The shortest path runs through pixel centres, up to 0.5 px from the real edge (0.52 px measured). Each point is then moved across the edge to the peak of the edge strength, which puts it within 0.16 px (measured). Without this, half of the lasso's 1 px simplification tolerance (spec 0002) would be spent on pixel rounding.
6. **"Strongest nearby edge" is relative to the area being searched.** Edge cost is 1 − strength / (the strongest edge within the searched area), so a faint edge is still found when nothing stronger is near, whatever the rest of the photo holds.

## Pixel convention

As spec 0005: pixel (i, j) covers [i, i+1) × [j, j+1) and its centre is (i + 0.5, j + 0.5). Image colours are 8-bit sRGB values divided by 255; the image's alpha channel is ignored (photos are opaque).

## What

### Edge-cost map (#39)

- **AC-1** Given an RGBA image with a vertical step between columns 9 and 10, when the edge map is computed, then in every row away from the image border the two lowest costs are at columns 9 and 10, equal to each other, and cost rises with distance from the step.
- **AC-2** Given a red-on-green step whose two colours have the same brightness (Rec. 601 luma), then the cost on the step is at most 0.1 (Decision 4).
- **AC-3** Given a flat image (one colour), then every cost is 1 and nothing is NaN. Given an area of the image to work on, then only that area is computed, and pixels outside the image are treated as copies of the nearest border pixel.

### Live-wire (#40)

- **AC-4** Given an anti-aliased straight edge at 17° and a circle of radius 150 (2% noise), and two points on the edge about 300 px apart, when the cheapest 8-connected path between them is found within the allowed area, then every path point (pixel centre) is within 1 px of the true edge.
- **AC-5** Given the same paths, when they are refined between pixels (Decision 5), then every point is within 0.25 px of the true edge.
- **AC-6** The path starts at the pixel containing `from` and ends at the pixel containing `to`, never leaves the allowed area, and is a single point when both are in the same pixel. A `from` or `to` outside the image or the allowed area is a `RangeError`.
- **AC-7** A 300 px segment with a 120 px reach (about 100,000 allowed pixels) takes under 30 ms in Node.

### Magnetic lasso core (story)

- **AC-8** Given a finger path that wanders up to 0.75 × reach off a straight or circular edge (reach 12 px, seeded wobble), when it is snapped, then every point of the result is within 0.25 px of the true edge.
- **AC-9** Every point of the result is within reach + 1 px of the finger path, and the result starts within reach of the first finger point and ends within reach of the last.
- **AC-10** Given two parallel edges both within reach of the finger, one twice the contrast of the other, then the result follows the stronger edge.
- **AC-11** Given a U-shaped finger path whose two arms are closer than twice the reach, then the result does not cut across: every finger point has a result point within reach of it.
- **AC-12** Given a flat area (no edge within reach), then the result stays within reach of the finger path (AC-9 holds) and has no NaN.
- **AC-13** Snapping a 1,000 px finger path with a 12 px reach takes under 30 ms in Node.

### Smart edge (#42, #43)

The band is the set of pixels whose centre is within `bandPx / 2` of the 50% line of the rings' coverage (render pipeline step 1), so its total width is `bandPx`. The image border is not part of that line: where a selection runs off the image, no band is drawn along the border.

- **AC-14** Given any selection with a soft edge, then every pixel outside the band has exactly the alpha it would have without the soft edge (bit-identical after rendering).
- **AC-15** Given a band width outside [2, 20] px, the refiner throws a `RangeError` (the selection model already refuses these; spec 0003). Band widths 2 and 20 both work.
- **AC-16** Given synthetic scenes (contrasting colours, same-brightness colours, a textured object with 4% noise), a band of 8 px and the drawn line 0 or ±2 px off the true edge, when the soft edge (`guided`) is applied, then over the band: mean |alpha − true coverage| ≤ 0.02, at most 1% of band pixels are on the wrong side of 50%, and at most 0.5% of pure-background pixels get alpha above 0.1.
- **AC-17** Given the hair scene (24 strands 0.8 px wide reaching 7 px out from a disc, line 0 or ±2 px off), then at least 90% of the band's strand pixels (true coverage ≥ 50%) get alpha ≥ 50%, at least 99% of its background pixels get alpha < 50%, and the mean error is ≤ 0.04.
- **AC-18** Given object and background of the same colour, then the band equals the fallback exactly: the rings' coverage for `guided`, the model alpha for `model`. Given colours 0.075 apart (half the trust distance), then each band pixel lies halfway between the estimate and the fallback (Decision 2).
- **AC-19** Given a band pixel with no object pixel or no background pixel outside the band within the averaging window (for example a strand narrower than the band), then it keeps the fallback.
- **AC-20** Given the soft edge's source is `model` and a model alpha (the AI result at full image size), then the fallback is the model alpha. The band is still taken around the rings' 50% line, since the rings were traced from the model (spec 0005) and the user may have moved them since. On the AC-16 and AC-17 scenes, with rings traced from a blurred model alpha (¼ resolution, upscaled) and that alpha as the fallback, the AC-16 and AC-17 bounds hold. A `model` soft edge without a model alpha, or with one not at the image size, is a `RangeError`.
- **AC-21** Given a preview render (`scale` < 1), then the refiner uses the image area-averaged to the preview size and the band scaled (spec 0004 decision). A full render after any number of previews is bit-identical to a full render with no previews before it (preview shortcuts never leak).
- **AC-22** On the 12 MP person mask of spec 0005 AC-16 with a 20 px band, the soft edge adds under 600 ms to `renderMask` in Node.

### Workers (#44)

- **AC-23** The render worker and the live-wire worker accept and send only the typed messages in the contract. A render request's reply equals calling `renderMask` with the smart-edge refiner directly; a snap request's reply equals calling `snapToEdges` directly.
- **AC-24** An image is sent to a worker once (by id) and reused by later requests. A request naming an unknown image id gets an `error` reply.
- **AC-25** When several requests of one kind are waiting, only the newest runs; each older one gets a `cancelled` reply. The client resolves only the newest request of each kind and ignores replies to older ones.
- **AC-26** A request that throws gets an `error` reply with the message, and the worker keeps serving later requests.
- **AC-27** Masks and images move between threads as transferred buffers, not copies.

## Contract

All coordinates are image px (float). `src/core/matting/` has no DOM, React or browser imports.

```ts
// src/core/matting/edges.ts
export interface Rect { x: number; y: number; width: number; height: number } // whole px, inside the image
export interface EdgeMap {
  rect: Rect
  /** Colour Sobel magnitude per pixel of rect, row-major. */
  strength: Float32Array
  /** 1 − strength / max(strength in rect); 1 everywhere when the max is 0. */
  cost: Float32Array
}
/** With `only` (over rect, 1 = needed), other pixels get strength 0 and cost 1; cost is relative to the strongest needed pixel. */
export function edgeMap(image: RgbaImage, rect: Rect, only?: Uint8Array): EdgeMap

// src/core/matting/liveWire.ts
/** Cheapest 8-connected path of pixel centres; `allowed` is a mask over map.rect (1 = may pass). */
export function liveWire(map: EdgeMap, from: Point, to: Point, allowed?: Uint8Array): Point[]
/** Moves each point across the edge to the peak of edge strength (at most 1 px). */
export function refineSubpixel(map: EdgeMap, path: readonly Point[]): Point[]

// src/core/matting/magnetic.ts
export const SNAP_REACH_PT = 12 // Decision 3; the UI converts to image px
export function snapToEdges(image: RgbaImage, finger: readonly Point[], reachPx: number): Point[]

// src/core/matting/smartEdge.ts
export const COLOUR_TRUST_DISTANCE = 0.15 // Decision 2
export function bandMask(coverage: Float32Array, size: Size, bandPx: number): Uint8Array
/**
 * EdgeRefiner for renderMask (spec 0004). modelAlpha: full image size; required when source is 'model'.
 * renderMask passes its scale as the refiner's 4th argument, so a preview averages each preview
 * pixel's exact image footprint [o/s, (o+1)/s) and checks the band at full resolution exactly.
 */
export function smartEdgeRefiner(image: RgbaImage, modelAlpha?: AlphaMask): EdgeRefiner
```

Worker messages (`src/workers/protocol.ts`; handlers are plain functions tested in Node, the `*.worker.ts` files only wire them to `self`):

```ts
type ToRenderWorker =
  | { type: 'setImage'; imageId: string; image: RgbaImage; modelAlpha?: AlphaMask }
  | { type: 'render'; jobId: number; imageId: string; selection: Selection; scale: number }
type FromRenderWorker =
  | { type: 'rendered'; jobId: number; mask: AlphaMask }
  | { type: 'cancelled'; jobId: number }
  | { type: 'error'; jobId: number; message: string }

type ToLiveWireWorker =
  | { type: 'setImage'; imageId: string; image: RgbaImage }
  | { type: 'snap'; jobId: number; imageId: string; finger: Point[]; reachPx: number }
type FromLiveWireWorker =
  | { type: 'snapped'; jobId: number; path: Point[] }
  | { type: 'cancelled'; jobId: number }
  | { type: 'error'; jobId: number; message: string }
```

## Data

None. `Selection.softEdge` (`source`, `bandPx`) already exists and is saved (spec 0003). The model alpha is not stored by this story; Phase 6 (#47, #49, #51) produces it.

## Out of scope

- Buttons, the band slider, the "Snap to edges" toggle, and converting 12 pt to image px at the current zoom: editor UI (#77, Phase 8).
- Measuring frame rate on phones: the real-phone pass (#97). This story guarantees only that the heavy work runs in workers.
- Producing the model alpha (Phase 6).
- Laplacian zero-crossing and edge-direction terms of classic Intelligent Scissors: sub-pixel refinement (Decision 5) already places the line.
- Refining alpha outside the band, and brush strokes (they are applied after the soft edge, spec 0004).
