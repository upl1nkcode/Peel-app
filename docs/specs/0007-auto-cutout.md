# 0007 — Auto cutout (tap the subject)

- **Status:** Implemented
- **Issues:** story #45; tasks #46 (engine interface and fake), #47 (fast tap engine, was "person segmenter"), #48 (precise tap engine), #49 (downscale and upscale), #50 (download, offline, fallback), #51 (auto result to selection)
- **Plan reference:** STICKER_WEBAPP_PLAN.md §3.1 (Auto), §4 ("Auto → dots"), §5.1 (engines), Phase 6

## Why

Most people want the subject out of the photo with one tap and then only fix the leftovers. Tracing a dog by hand takes minutes; a model finds it in under a second. The result has to be precise, because every dot the model gets wrong is a dot the user has to drag back, and everything has to happen on the phone: no upload, no account, and it keeps working offline.

## Decisions

Four models were tried on six public-domain photos in Chromium and WebKit (comparison: <https://claude.ai/artifact/3J4bA9BMyKMy5HmRzuah5j>).

| Model | Download | Time per tap, laptop CPU | What it got wrong |
|---|---|---|---|
| Selfie person model | 0.25 MB | 0.05–0.5 s | Kept faint copies of a crowd; grabbed steam and a lamp; took a man and his mug as one person |
| Multiclass person model | 16.4 MB | 0.5–1.4 s | Kept the whole crowd; haze over the whole photo |
| Tap v1 (MagicTouch) | 6.2 MB | 0.35–0.9 s | Took the man along with a tapped mug; lost part of a mug handle and some hair edge |
| Tap v2 (interactive segmenter) | 30.5 MB | ~9–10 s | No visible mistakes on the six photos |

1. **Tap only, no "Person" button** (decided 2026-11-06 by the product owner). The user taps the person or object they want. The person models picked up other people and nearby objects, while tapping picked only the subject. This replaces plan §3.1's Person mode; #47 becomes the fast tap engine.
2. **Fast first, precise second** (decided 2026-11-06 by the product owner). Every tap runs Tap v1 (fast) and Tap v2 (precise). v1's result shows in about a second; v2's result replaces it when ready. v2 takes about 10 s per tap on a laptop CPU, on every tap, not only the first.
3. **Models are self-hosted** on the app's own site (plan §5.1), not loaded from Google's servers: no third-party requests, and they can be cached for offline use. Cloudflare Pages serves files of at most 25 MiB, so v2 ships as two parts that the app joins and checks against the whole file's SHA-256.
4. **The fast model downloads first.** The engine (14.6 MB) and v1 (6.2 MB) come first, so the first cutout is ready after about 21 MB; v2 (30.5 MB) downloads after, and refines once it arrives. Nothing downloads until the user first uses Auto.
5. **Inference runs on a copy with a long side of at most 1024 px**, area-averaged. Both models work at 512–768 px internally, so a larger copy only costs time. The mask comes back at 1024 px and is upscaled to the full photo (bilinear, pixel centres aligned). The smart edge (spec 0006) then recomputes the edge band from the full-resolution photo, with the upscaled model alpha as its fallback.
6. **CPU only for now.** The graphics-chip option gave an empty mask in the test browser, which has no real graphics chip. Whether it works and helps on phones is measured in the real-phone check after this story; a follow-up switches it on if it does.
7. **The auto result gets an 8 px smart-edge band**, the width spec 0006's accuracy criteria were measured with.
8. **A simple tap-to-cut screen ships with this story** so it can be tried on real phones. Phase 8's editor replaces it. It has no saving, dots or lasso.

## What

### Engine contract (#46)

- **AC-1** Given the fake engine, when it loads, it reports progress events that only increase and end at its stated total, then segments deterministically: each add tap gives a disc of radius 20 px around it, each remove tap clears a disc of radius 20 px, at the image's size. It can be set to fail loading with a given reason, or to take a given time per tap. Every UI and controller test uses it.
- **AC-2** Given any engine, then: segmenting before `load` resolves rejects; a tap outside the image (x ∉ [0, width) or y ∉ [0, height), or not finite) is a `RangeError`; no taps gives an all-zero alpha and no selection; the alpha always has the image's width and height.

### Fast engine (#47)

- **AC-3** Given masks from single taps, then the combined mask is, per pixel, `max(add masks) × (1 − max(remove masks))`. Tap v1 takes one point per run, so this is how it adds and removes.
- **AC-4** Given an image already segmented with taps T, when one more tap is added, then only the new tap is run (one model call), and the result equals segmenting T plus the new tap from scratch.

### Downscale and upscale (#49)

- **AC-5** Given a photo with a long side over 1024 px, the inference copy has a long side of exactly 1024 px, keeps the aspect ratio (short side rounded to the nearest pixel, at least 1), and is area-averaged (spec 0004's `resizeRgba`). A photo of 1024 px or less is used as it is.
- **AC-6** Given a mask upscaled exactly 2×, then each output pixel is the bilinear blend of the source pixel centres around it, with edges clamped; for the 2×1 mask [0, 1] the output row is [0, 0.25, 0.75, 1].
- **AC-7** Given a source mask with a vertical step (1 left of x = s, 0 right of it) upscaled to any size, then its 50% line lands at `s × outputWidth / sourceWidth`, within 0.01 output px; the same holds for horizontal steps. A constant mask stays constant.
- **AC-8** On a 12 MP photo in Node, downscaling, upscaling a 1024 px mask and building the auto selection (AC-13) together take under 1000 ms. (Measured during the build: about 290 ms to downscale, 85 ms to upscale and 420 ms to trace and place the dots; the first draft's 600 ms did not allow for spec 0005's dot placement on a soft edge.)

### Precise engine (#48)

- **AC-9** Given taps in image px, then the strokes sent to Tap v2 are `{ x / width, y / height }`, add taps as positive and remove taps as negative, in tap order.

### Fast then precise (#47, #48)

- **AC-10** Given both engines ready, when the user taps, then the fast result becomes the selection first, and the precise result then replaces it. The status reads "Sharpening…" between the two.
- **AC-11** Given a precise run in progress, when the user taps again, then the stale precise result is never applied; the fast result for the new taps shows, then the precise result for the new taps.
- **AC-12** Given the user has edited the selection since the last auto result (any history step), when a precise result arrives, then it does not replace the selection; it becomes the reset-to-auto target, and the status reads "Sharper cutout ready".
- **AC-13** Given an auto mask at full size, then the auto selection is: rings from spec 0005's `maskToRings`, `softEdge = { source: 'model', bandPx: 8 }`, no brush strokes, feather 0; and the render worker gets the same mask as its model alpha. Given an all-zero mask from taps that include a remove, the selection becomes empty (the user removed what they had added; amended 2026-11-07 after the final review). Given an all-zero mask otherwise (nothing found under the add taps, or remove taps only), the selection is not changed and the status reads "Nothing found there. Tap on the subject."
- **AC-14** Given an auto result followed by edits, when the user resets to auto, then the selection equals the latest auto selection exactly, as one undoable step, and the model alpha is the one that selection came from.
- **AC-15** Given the precise engine is unavailable, then fast results stay as the final result and the status reads "Sharper cutout not available on this device". Given the fast engine is unavailable but the precise one works, then each tap waits for the precise result.

### Download, offline and fallback (#50)

- **AC-16** Given a first use of Auto, then the status shows "Downloading cutout model: X of Y MB" (one decimal place), Y being the total of the files still to download, known before the first byte from the app's model manifest; X only increases and ends at Y.
- **AC-17** Given a downloaded file whose SHA-256 differs from the manifest (for v2: the joined whole), then it is not cached and that engine is unavailable.
- **AC-18** Given Auto has been used once, when the app is reloaded offline, then Auto works with no network request for engine or model files.
- **AC-19** Given the app is opened and Auto is not used, then no engine or model file is requested.
- **AC-20** Given neither engine can run (offline on first use, the download fails, storage is full, or the browser lacks what the engine needs), then the status names the reason ("You're offline. The cutout model needs one download first.", "The cutout model didn't download. Check the connection and try again.", "Not enough storage for the cutout model.", "Auto cutout doesn't work in this browser."), offers "Use Lasso", and the controller reports the fallback tool `lasso`. A browser without what the engine needs downloads nothing. A failed download (offline, download or storage) is tried again on the next tap, the next photo, or when the connection returns (added 2026-11-07 after the final review).

### Real models (e2e, Chromium)

Fixtures are composites: a public-domain or CC0 cut-out subject (with its own alpha) placed on a public-domain or CC0 background photo, so the ground truth is exact.

- **AC-21** Given the object fixture, when the subject is tapped, then the fast result has IoU ≥ 0.75 with the ground truth and the precise result IoU ≥ 0.9 (IoU of the 50% masks).
- **AC-22** Given the two-object fixture, when object A is tapped and then object B, then the result has IoU ≥ 0.85 with A ∪ B; when B is then long-pressed, IoU ≥ 0.9 with A.
- **AC-23** Given the person fixture, when the person is tapped, then the precise result has IoU ≥ 0.9, and the rendered cutout keeps soft hair: of the pixels within 2 px of the ground truth's 50% line around the head, at least 25% have alpha strictly between 0.1 and 0.9.

### Tap-to-cut screen (temporary, decision 8)

- **AC-24** Given the screen, when the user picks a photo, then it is shown fitted to the screen (EXIF orientation applied); a tap adds, and a long-press (held ≥ 500 ms, moved ≤ 10 screen px) removes. The cutout shows over a checkerboard, rendered at screen resolution by the render worker.
- **AC-25** Given a press (down point and time, up point and time), then it is a tap when held < 500 ms and moved ≤ 10 screen px, a long-press when held ≥ 500 ms and moved ≤ 10 px, and neither when moved more.

## Contract

```ts
// src/core/segmentation/ (pure, no DOM)
export interface Tap { imagePt: Point; mode: 'add' | 'remove' }
export const INFERENCE_LONG_SIDE_PX = 1024
export const AUTO_BAND_PX = 8
export function inferenceSize(size: Size): Size
export function upscaleMask(mask: CoverageMask, size: Size): CoverageMask // bilinear, centres aligned
export function combineTapMasks(adds: readonly CoverageMask[], removes: readonly CoverageMask[], size: Size): CoverageMask
export function tapsToStrokes(taps: readonly Tap[], size: Size): { mode: 'positive' | 'negative'; x: number; y: number }[]
export function autoSelection(mask: CoverageMask): Selection | null // null when all zero

// src/core/gestures/press.ts
export const LONG_PRESS_MS = 500
export const PRESS_SLOP_PX = 10
export function classifyPress(down: { screenPt: Point; t: number }, up: { screenPt: Point; t: number }): 'tap' | 'longPress' | null

// src/core/selection: new command, undoable like the rest
| { type: 'restore'; selection: Selection } // validated like a loaded selection

// src/services/segmentation/
export interface SegmentationEngine {
  readonly name: 'fast' | 'precise'
  load(onProgress: (loadedBytes: number, totalBytes: number) => void): Promise<void> // rejects with EngineUnavailable
  setImage(imageId: string, image: RgbaImage): Promise<void>
  readonly files: readonly ModelFile[] // so the bytes still to download are known before the first byte (AC-16)
  segment(imageId: string, taps: readonly Tap[]): Promise<{ alpha: AlphaMask; selection: Selection | null }> // at the image's full size; traced in the worker
}
export class EngineUnavailable extends Error { reason: 'offline' | 'download' | 'storage' | 'unsupported' }
export interface ModelFile { path: string; bytes: number; sha256: string; parts?: { path: string; bytes: number }[] }
```

The render worker gains `{ type: 'setModelAlpha'; imageId; modelAlpha }`, so a new auto result does not re-send the photo. Engines run in module workers (`segmentation.worker.ts`), one per engine, using `@mediapipe/tasks-vision` (`InteractiveSegmenterLegacy` for v1, `InteractiveSegmenter` for v2). Files are fetched by the app, checked, stored in Cache Storage under `peel-models-v1`, and handed to MediaPipe as buffers and blob URLs. Geometry is in image px floats.

## Data

Nothing new is saved with a sticker; the model alpha is kept in memory only (storing it is Phase 7). Engine and model files live in Cache Storage `peel-models-v1`, keyed by path and SHA-256, so a changed file (a model or engine update) is downloaded again and its old version removed.

## Out of scope

- A "Person" button (decision 1) and the person models.
- The graphics-chip option (decision 6).
- The editor's Auto tool, dots, lasso and saving (Phase 8). The temporary screen's "Use Lasso" only reports the fallback.
- Running the real-model e2e tests in WebKit: Playwright's WebKit build has no `OffscreenCanvas` in workers (seen on Windows), which the engine needs. iPhone is checked by hand on the PR preview (iOS 17 or later; older iOS gets AC-20's "doesn't work in this browser").
- Photo-loading limits and HEIC handling (image loader, Phase 7). The temporary screen downsizes photos to a long side of at most 4096 px.
