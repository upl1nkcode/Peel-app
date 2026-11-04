# 0001 — Coordinates, gestures and hit-testing

- **Status:** Approved
- **Issues:** story #9; tasks #10 (transforms), #11 (gesture state machine), #12 (pinch/pan math), #13 (hit-testing)
- **Plan reference:** §3.6, §4, §7 (gesture rules), Phase 1
- **Code:** `src/core/coords/`, `src/core/gestures/`, `src/core/geometry/hitTest.ts` — pure TypeScript, no DOM imports.

## Why
Precision is the product. If a touch is mapped to the wrong image pixel at some zoom or screen density, every cutout drifts. And if a second finger can leave a stray mark, users lose trust. This layer must be exact and fully testable without a browser.

## Spaces and conventions
- **imagePt** — image pixels, float, origin top-left, y down. Geometry is always stored in this space.
- **canvasPt** — CSS pixels relative to the canvas element's top-left (`clientX/Y` minus the element's rect origin).
- **devicePt** — canvas backing-store pixels = `canvasPt × dpr`.
- `Point = {x, y}`, `Size = {width, height}`.
- **Viewport** = `{ canvas: Size (CSS px), image: Size (image px), dpr }`.
- **View** = `{ zoom, center }`. `zoom` is relative to *fit* (1 = whole image fits the canvas, letterboxed; max 16). `center` is the imagePt shown at the canvas center.
- `fitScale = min(canvas.width / image.width, canvas.height / image.height)`; `scale = fitScale × zoom` (CSS px per image px).
- `imagePt = center + (canvasPt − canvasCenter) / scale`.

## What

### Transforms (#10)
- **AC-1** Given any viewport with dpr 1, 2 or 3 and zoom from 1 to 16, when a canvasPt is converted to imagePt and back, then the result differs from the original by < 0.01 px. Fractional dpr (e.g. 2.625) and fractional canvas sizes are included.
- **AC-2** Given zoom 1 on a portrait or landscape image in a canvas of a different aspect ratio, when mapping the four image corners to canvas space, then the image is centered, touches the canvas on its limiting axis, and has equal letterbox margins on the other.
- **AC-3** Given a known viewport/view, when converting specific canvasPts (center, corners, off-image margin), then imagePts match hand-computed values (table test). Points outside the image give imagePts outside `[0,width]×[0,height]` rather than being clamped.
- **AC-4** Given a clientX/Y and the canvas rect origin, then `screenToCanvas` subtracts the origin; `canvasToDevice` multiplies by dpr.

### Pinch and pan math (#12)
- **AC-5** Given a two-finger gesture that changes finger distance and midpoint, when applying it to the starting view, then the imagePt that was under the starting midpoint is under the current midpoint (± 0.01 px) whenever no clamp is active.
- **AC-6** Given a gesture that would zoom below 1 or above 16, then zoom is clamped to [1, 16] and the same anchor rule holds as far as the clamp allows.
- **AC-7** Given any pan, then the view center is clamped so every image pixel can be brought to the screen center but never beyond: `center ∈ [0,width]×[0,height]`. On an axis where the scaled image fits inside the canvas, that axis of `center` is fixed to the image middle (no sliding a fully visible image around).
- **AC-8** Given a "zoom to actual size" request, then zoom is set so 1 image pixel = 1 device pixel (`scale = 1/dpr`), clamped to [1, 16] and anchored at the tapped point; requesting it again returns to zoom 1 (fit).

### Gesture state machine (#11)
Input: pointer events `down | move | up | cancel` with `{pointerId, point}` (touch only; the DOM adapter lives in `ui/`). Output: actions the UI applies.

Actions: `toolStart`, `toolMove`, `toolEnd`, `toolCancel` (carry the pointer's point) and `viewStart`, `viewUpdate`, `viewEnd` (carry the two pointers' points).

- **AC-9** Given no pointers down, when one pointer goes down, moves and lifts, then the output is `toolStart`, `toolMove…`, `toolEnd` in order, with no view actions.
- **AC-10** Given one pointer drawing (tool active), when a second pointer goes down, then `toolCancel` is emitted exactly once, followed by `viewStart`; no later action of that gesture is a `tool*` action.
- **AC-11** Given two pointers down, when they move, then only `viewUpdate` is emitted (never `tool*`).
- **AC-12** Given two pointers down, when either lifts, then `viewEnd` is emitted, and the remaining pointer does **not** start a tool stroke. A new stroke can only start after all pointers are up.
- **AC-13** Given every lift order of two and of three pointers (including simultaneous lift and `cancel` events), then the machine never emits a `tool*` action after `toolCancel` and ends in the idle state with no pointers tracked. A third pointer is ignored while two are active.
- **AC-14** Given `move`/`up` events for an unknown pointerId, then they are ignored without error.
- **AC-21** Given a `cancel` event for one of two active pointers, or a `down` for a pointerId that is already down, then no error is thrown and no stray `tool*` action is emitted.
- **No delay:** `toolStart` fires immediately on the first touch. The cancel in AC-10 is what guarantees "no accidental marks", so every tool must support `toolCancel` by discarding its in-progress stroke.

### Hit-testing (#13)
Distances are measured in canvas CSS px after transforming, so the touch radius is constant on screen at any zoom.

- **AC-15** Given nodes (imagePts), a touch canvasPt and radius 22 px, when finding the nearest node, then it returns the nearest node within 22 px (inclusive) or `null`, at zoom 1 and zoom 16 alike.
- **AC-16** Given a touch equally close to two nodes (or two edges), then the lower index wins, every time.
- **AC-17** Given edges as polylines (`Point[][]`, a straight edge is 2 points; curved edges are passed pre-flattened), when finding the nearest edge, then it returns `{edgeIndex, t, imagePt, distancePx}` where `t ∈ [0,1]` is the arc-length fraction along that edge and `imagePt` is the closest point on it; `null` if farther than the radius.
- **AC-18** Given a touch within radius of both a node and an edge that ends at that node, then node hit-testing is separate from edge hit-testing; the caller decides priority (the dots tool prefers the node).

### Degenerate input (all modules)
- **AC-19** Given a viewport with zero or negative canvas/image size, non-positive dpr, or a view with non-finite zoom or center, then transforms throw `RangeError` (never return NaN).
- **AC-20** Given a two-finger gesture whose start fingers coincide (distance 0), then zoom is unchanged, no NaN appears, and pan still applies.
- **AC-22** Given empty node/edge lists or an edge with duplicate points (zero length), then hit-testing returns `null` / `t = 0` and never NaN.

## Contract
```ts
// src/core/coords
fitScale(vp): number; viewScale(vp, view): number
canvasToImage(vp, view, canvasPt): Point; imageToCanvas(vp, view, imagePt): Point
screenToCanvas(origin, screenPt): Point; canvasToDevice(vp, canvasPt): Point
// src/core/coords (pinch/pan)
applyTwoFingerGesture(vp, startView, startPts: [Point,Point], nowPts: [Point,Point]): View
clampView(vp, view): View; toggleActualSize(vp, view, canvasPt): View
// src/core/gestures
createGestureMachine(): { dispatch(event): GestureAction[]; reset(): void }
// src/core/geometry/hitTest.ts
nearestNode(nodes, canvasPt, vp, view, radiusPx = 22): { index, distancePx } | null
nearestEdge(edges, canvasPt, vp, view, radiusPx = 22): { edgeIndex, t, imagePt, distancePx } | null
```

## Data
None (no persistence). `View` is session state only.

## Out of scope
DOM pointer-event adapter, canvas rendering, loupe, momentum/inertia, rotation gestures, mouse/pen input, double-tap detection (the UI layer decides tap vs. double-tap and calls `toggleActualSize`), flattening Béziers (spec 0002 / Phase 3).

## Calls made by the author (please check)
1. `zoom` is relative to fit; "actual size" is 1 image px = 1 **device** px, which is the truly pixel-exact view on phones.
2. Pan clamp keeps the *center* inside the image (any pixel reachable, image never lost) rather than forbidding empty margins, so edge pixels can be placed under the loupe.
3. After a cancelled stroke, the remaining finger never resumes drawing until all fingers lift.
