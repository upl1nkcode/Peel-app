# Decisions

Recorded during Phase 0 (issue #2). Source: `STICKER_WEBAPP_PLAN.md` §2 defaults, confirmed by the product owner on 2026-11-03 (they chose to accept all defaults and only be asked about real architectural forks).

## Why this app exists

The product owner tried existing sticker tools and found two problems: **automatic cutout accuracy was not satisfying**, and **the manual cropping tools were bad**. Peel exists to fix both. Accuracy is the product; when a choice trades precision for convenience, prefer precision.

## Product decisions (plan §2)

| # | Question | Decision |
|---|---|---|
| 1 | Accept the web limits in plan §1? | Yes |
| 2 | Framework | React + TypeScript (strict) + Vite |
| 3 | Auto engines | MediaPipe person segmenter + MediaPipe interactive ("tap the object") segmenter, behind a `SegmentationEngine` interface |
| 4 | Hosting | Cloudflare Pages (free); production on `main`, preview URL per PR |
| 5 | Max zoom in editor | 16x |
| 6 | Default dot density after lasso/auto | Medium (about one dot per 12 screen px at fit zoom), adjustable |
| 7 | Sticker extras for v1 | White outline + edge softness slider |
| 8 | Languages | English + Romanian |
| 9 | Open source | Yes, public repo |

Anything not listed here is out of scope for v1 (YAGNI). See plan §13.

## Process decisions

- **Spec-driven + TDD.** Issue -> spec -> spec review -> failing tests -> code -> PR. Details in `CLAUDE.md`.
- **Specs** live in `docs/specs/NNNN-short-name.md` (template: `docs/specs/0000-template.md`). Stories need a spec; tasks and bugs keep criteria in the issue.
- **Implementation plans** live in `docs/plans/` and are **committed** (decided 2026-11-03).
- **Git:** short-lived branches `<type>/<issue>-<short-name>`, Conventional Commits, squash merge, PR links the issue and spec. `main` is protected once CI exists.
- **Backlog:** GitHub Issues + the "Peel" project board. Source kit: `peel-github-setup/` (not part of the app).

## Open items

- Cloudflare account and API token are needed for issue #6 (deploy). The product owner provides these as repository secrets.

## Tooling decisions (issue #3)

- **ESLint 10 + Prettier**, not the oxlint that the current Vite template ships, as the plan specifies. ESLint uses `strictTypeChecked` rules so lint also catches unsafe `any` and loose types.
- **TypeScript pinned to 6.0.x** (not 7): `typescript-eslint` 8.x only supports TypeScript `<6.1`. Revisit when it supports 7.
- **tsconfig** turns on `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` explicitly, because geometry code indexes arrays constantly and accuracy is the product.
- `npm audit` reports a moderate `minimatch` advisory that is reachable only through ESLint (dev tooling, never shipped). Accepted; `npm audit fix --force` would downgrade ESLint to a broken version.

## Geometry decisions (spec 0002)

- **Lasso simplification tolerance is 1.0 image px** (decided 2026-11-04 by the product owner, replacing the draft value of 0.75). The draft could not meet its own dot-count bound. 1.0 px gives roughly half as many dots to edit, and every dot stays within 1 px of the true outline. The other options were 0.75 px (about 70 dots on a radius-100 circle) and 1.5 px (about 27 dots).

## Selection decisions (spec 0003)

- **The history cap counts the points that undo alone keeps alive.** For each step, it counts the dots and stroke points of an older state that the next state no longer shares. Rings and strokes that several states share are free, so adding rings costs almost nothing and editing a large ring costs one copy of it. The newest undo step is always kept, even when it alone is bigger than the cap.
- **Dot density means RDP dot spacing, checked on the drawn curves.** The tolerance sets how far apart RDP would space dots. If that is more dots than the ring has, the ring gets RDP's denser dots. Otherwise it gets the fewest dots that hold the curve: RDP's picks, or the ring's own dots with every removable smooth dot taken out (hand-placed dots are often already efficient). Corners always stay. Both curves are sampled at most every 0.1 image px and checked at 95% of the tolerance. If no valid result can be built, the ring is left as it was. Very wavy rings with few hand-placed dots still get more dots, even at 8 px, because their straight-line spacing is coarser than 8 px.
- **Selection JSON paths name the full field** (for example `selection.rings[2].nodes[5].x`, or `$` for the whole document). Image sizes must be positive whole pixels. `-0` is saved as `0`. Rings whose dots all lie on one line are accepted when loading, because moving or deleting dots can make one and every reachable selection must reopen.

## Mask rendering decisions (spec 0004)

- **Feather uses the discrete Gaussian** (e^(−t)·Iₙ(t) with t = σ², σ = feather / 2.5, radius ⌈3σ⌉). A Gaussian sampled at these small σ is too narrow: at feather 1.5 and 2 its edge transition is 1.8 and 2.3 px wide, outside the spec's ±0.25 px. The discrete Gaussian keeps the variance exactly σ² and stays within it.
- **Previews scale the soft-edge band too.** `renderMask` with `scale` multiplies the band handed to the edge refiner, as well as ring coordinates, brush sizes and feather, so previews match the full render.
- **A preview scale that rounds up to the full size renders at scale 1**, so a full-size mask never carries shrunken geometry into `applyMask`.
- **`trimBounds` padding is a whole number of pixels**; fractional or negative padding is refused.
- **PNGs are written by our own encoder** with the browser's built-in `CompressionStream` for compression (no dependency). Canvas export premultiplies alpha and changes semi-transparent edge colours; ours writes the exact pixels.
- **`tsconfig.node.json` resolves modules like a bundler** (`module: esnext`, `moduleResolution: bundler`), so Playwright tests can import `src/core` code.

## Mask to dots decisions (spec 0005)

- **Nothing is dropped** (decided 2026-11-04 by the product owner): every island and hole becomes a ring, however small. A one-pixel hole's traced diamond covers exactly half its pixel, so it renders at 50%.
- **Hard edges get 1 px, soft edges 0.5 px** (decided 2026-11-05 by the product owner: "follow the true shape"). A point is hard when it lies between pixel values of exactly 0 and 1. Smooth dots on hard edges sit on the staircase smoothed once, so the curve follows the real shape (within 0.75 px of a true circle) rather than the pixel steps.
- **Hard-edge corners need 50°, measured on the smoothed staircase** (decided 2026-11-05 by the product owner). The spec's 2 px chord rule could not tell pixel steps (up to 64°) from pixel-clipped true corners (down to 45°). Hard edges now compare the edge directions 1–4 px either side after one smoothing pass. Measured: no false corners on hard circles of radius ≥ 10; corners of 60° or more kept 95–100% of the time; 45° corners mostly rounded, within 1 px. Soft edges keep 45° on 2 px chords.
- **Thin parts keep their width** (decided 2026-11-05 by the product owner: "protect thin parts"). Where the shape, or a gap in it, is thin, the tolerance is at most a quarter of the local width (never below 0.1 px), measured across all contours, so walls between a hole and the outside and gaps between islands count. Before this, a hard 1-px line lost all 40 of its pixels in the round trip and a soft 1.1-px strand lost a third, while meeting every other criterion. Costs ~40 ms on a 12 MP mask and more dots along hair-thin strands.
- **Hard corner dots stay on the traced line; soft ones move to where their edges meet.** Extending a pixel staircase across a step misplaced a corner by more than the trace itself is off.
- **Dots are placed greedily, then checked.** Each dot reaches as far along the trace as a chord within 2 × the tolerance allows. Then every gap's drawn curve is checked against the trace both ways, and a dot is added where it strays. RDP was not used: it halves circular arcs, so its dot counts snap to powers of two.
- **Tracing thresholds on the float bit pattern** (v ≥ 0.5 exactly when the IEEE bits are ≥ those of 0.5, for non-negative values), 32 pixels per word. Only cells whose corners differ are visited. A 12 MP mask converts in about 135 ms locally. Mask values must be in [0, 1].

## Smart edge and magnetic lasso decisions (spec 0006)

- **Smart edge estimates alpha from colours instead of the guided filter** (decided 2026-11-06 by the product owner). In the band, each pixel's alpha is where its colour sits between the object colour just inside the band and the background colour just outside it. A prototype of the plan's guided filter could not move a line drawn 2 px off the edge (average alpha error 0.218 against 0.221 with no refinement) and hazed 679 background pixels; the colour estimate scored 0.004 with no haze, and kept 93–97% of 0.8 px hair strands. Task #42 was retitled accordingly.
- **Magnetic lasso reach is 12 screen points** (decided 2026-11-06 by the product owner). Options were 8 pt (tight) and 20 pt (forgiving, but jumps to neighbouring edges more often).
- **The colours are averaged over ⌈band⌉ + 2 px around each band pixel**, not ⌈band / 2⌉ + 2 as first planned. With the smaller window, pixels at the inner side of the band found no background pixels and kept the blurry model alpha: 10% of the background stayed hazy on the AI-model test, against a budget of 0.5%.
- **At extreme zoom the snap search stays at least 1.25 image px wide.** At 16× zoom, 12 pt is under one image pixel, and a narrower band of pixel centres can break apart; so the line may snap up to about 1 image px beyond 12 pt there.
- **The image border is not an edge.** Where a selection runs off the photo, no smart-edge band is drawn along the border, so a portrait cut off by the bottom of the photo keeps a solid edge there.
- **Previews pass their exact scale to the edge refiner** (spec 0004's `EdgeRefiner` gained a `scale` argument). The preview's colours are averaged over each preview pixel's exact footprint, as the outline is drawn, so the preview edge lines up with the saved one (it was up to 0.6 preview px off toward the right and bottom).

## Auto cutout decisions (spec 0007)

- **Tap only, no "Person" button** (decided 2026-11-06 by the product owner). Tapping picked only the subject, while the person models picked up other people and nearby objects. This replaces plan §3.1's Person mode.
- **Fast first, precise second** (decided 2026-11-06 by the product owner). Every tap runs MediaPipe's Tap v1 (MagicTouch, 6.2 MB, about 0.35–0.9 s) and Tap v2 (interactive segmenter, 30.5 MB, about 10 s per tap on a laptop CPU). v1's result shows first; v2's replaces it when ready, unless the user has edited the selection since (then "Sharper cutout ready" offers it). Results for older taps or an older photo are dropped. Each engine runs in its own worker, so v1 stays quick while v2 works.
- **Models and the engine are self-hosted** at `/models/` and `/engine/`, not loaded from Google: no third-party requests, and they work offline. Files over 24 MiB are split into parts (Cloudflare Pages serves at most 25 MiB per file); the app joins them and checks the whole file's SHA-256 before caching it in Cache Storage (`peel-models-v1`). The service worker does not precache them.
- **Nothing downloads until the first photo is picked**, and the fast model comes first: the first cutout needs about 21 MB (engine 14.6 MB + v1 6.2 MB), then v2 downloads. The app reads the file list from a build-time module, so it makes no request before then.
- **Inference runs on a copy with a long side of at most 1024 px** (area-averaged); the mask is upscaled to the full photo bilinearly with pixel centres aligned, and the smart edge recomputes an 8 px band from the full-resolution photo. The full pipeline after the model (upscale, trace, dots) is budgeted at 1000 ms for a 12 MP photo on a laptop (about 750 ms measured; tracing and dot placement are about 420 ms of it).
- **CPU only for now.** The graphics-chip option gave an empty mask in the test browser; the real-phone check decides whether a follow-up switches it on.
- **A browser without OffscreenCanvas in workers gets the fallback** ("Auto cutout doesn't work in this browser." and "Use Lasso"). Playwright's WebKit build on Windows is one; iOS Safari has had OffscreenCanvas since 16.4.
- **A temporary tap-to-cut screen ships with this story** (tap adds, a press held ≥ 500 ms and moved ≤ 10 screen px removes) so it can be tried on phones; Phase 8's editor replaces it. Photos are read with their EXIF orientation applied (the size cap is now spec 0008's).
- **The real-model tests use CC0 composites with exact ground truth** (`e2e/fixtures/auto/`), run on desktop Chromium only because of CPU time.
- **Removing every added subject empties the cutout** (final review, 2026-11-07; AC-13 amended). Tap A, then long-press A, gives an empty selection. "Nothing found there" is kept for add taps that find nothing and for remove taps alone.
- **Failed downloads are retried** on the next tap, the next photo, or when the connection returns; at most one load per engine runs at a time. A browser without WebAssembly or OffscreenCanvas downloads nothing and is told Auto doesn't work there. A Cache Storage error (private mode, locked-down browsers) also ends in that message instead of a stuck status.
- **Cached engine and model files are keyed by path and SHA-256** (final review), so a tasks-vision or model update cannot pair new code with an old cached file; old versions are removed after the new one is cached.
- **A tap lands where the finger went down**, kept at least half a pixel inside the photo, and the controller ignores taps outside the photo: touch keeps sending events to the canvas after the finger slides past its edge, and one such tap used to break every later run for that photo.
- **A new photo starts with an empty cutout** (one undoable step), so the previous photo's cutout is never drawn over it.

## Photo loading and sticker storage decisions (spec 0008)

- **Each saved sticker keeps its original photo** (decided 2026-11-07 by the product owner), byte for byte, so it can be re-opened and fine-tuned with the same pixels: about 4–5 MB per sticker.
- **Import merges and skips duplicates** (decided 2026-11-07 by the product owner): only new IDs are added, existing stickers are untouched, and an import never deletes anything.
- **A small temporary panel on the tap-to-cut screen** (decided 2026-11-07 by the product owner): Save, saved thumbnails (tap to re-open; Delete asks inline), Export all, Import and the storage status. Phase 9's Library replaces it.
- **Photos are capped at 4096 × 3072 pixels' worth (12,582,912 px) and 16,384 px on the long side**, replacing spec 0007's 4096 px long side. A literal 12,000,000 cap would shrink every 12 MP iPhone photo (4032 × 3024) by about 1%. `createImageBitmap(file, { imageOrientation: 'from-image' })` loads all eight EXIF orientations upright in Chromium and Playwright's WebKit.
- **The saved PNG is always the full-resolution render**, never the screen preview. The render worker has a separate `renderFull` message (a preview `render` can't cancel it), and it carries the model alpha being saved: worker-side `setModelAlpha` runs at once while jobs wait for the newest-wins drain, so a sharper result landing just after Save could otherwise change what is stored. A save takes the selection and model alpha at the moment Save is tapped.
- **The model alpha is saved as zlib-deflated raw bytes**, not a PNG (browsers may colour-manage decoded PNGs), so a re-opened auto cutout renders the same PNG byte for byte (checked end to end with the real models). If a re-opened photo decodes at another size, the alpha no longer fits: the model soft edge is dropped and "This photo opened at a different size here; the outline may be off." is shown.
- **Thumbnails are 256 px PNGs**, not WebP (Safari can't encode WebP from a canvas), downscaled by area averaging so every browser makes the same one.
- **IndexedDB through `idb`** (database `peel`, version 1): `stickers` (metadata, selection JSON, thumbnail), `files` (photo, sticker PNG, model alpha) and `meta`. Bytes are stored as ArrayBuffers, not Blobs (older Safari lost Blobs). Listing reads no large bytes. Saves are one transaction; a full disk (`QuotaExceededError`, at a request or at commit) saves nothing and says "Not enough space to save this sticker…". Schema changes are an ordered list of migrations; a database newer than the app, or another tab upgrading it, stops all writes with "Peel was updated in another tab. Reload to use your stickers."
- **Persistent storage is requested once ever, after the first save or the first import that adds stickers** (final review: a backup restored on a new phone needs keeping just as much; AC-13 amended). It is remembered in `meta`, and the status line reads `navigator.storage.persisted()`, which asks nothing.
- **Backups are plain ZIPs written by our own code** (no dependency): stored entries with CRC-32 and UTF-8 names, checked against Python's `zipfile` and `unzip -t`. Import also reads deflated entries and a backup re-zipped inside one folder (Finder's "Compress", Windows' "Compressed folder"; `__MACOSX/` is ignored); encrypted, ZIP64 and other entries count as damaged. Export reads one sticker at a time and puts its bytes in a Blob before reading the next; the file is a Blob of those Blobs, with `peel-backup.json` written last. So it holds the backup about once plus one sticker (final review: building it all at once held about twice the backup, 450 MB for 50 stickers, enough for iOS to close the tab). Past 65,535 entries or 4 GiB the export says "Too many stickers for one backup file…". The download's object URL is revoked 30 s after the click (Safari may still be reading it).
- **Copy for cases the spec doesn't name:** no IndexedDB → "Stickers can't be saved in this browser."; an unexpected failure → "Something went wrong. Try again."; a cutout that renders to nothing → "Nothing to save: the cutout is empty."


## Editor canvas decisions (spec 0009)

- **Pinch zooms and two fingers pan in every tool; double-tap toggles 100% and fit** (decided 2026-11-07 by the product owner). A single tap in Auto acts 250 ms after the finger lifts, so the two taps of a double-tap only zoom. On a desktop the wheel zooms by `2^(−deltaY / 200)` around the pointer.
- **Slide to aim in Auto** (decided 2026-11-07 by the product owner): pressing and sliding shows a 120 px loupe with a crosshair, and lifting adds the object under the crosshair. A quick tap adds and a long-press removes, as before.
- **Above 100% photo pixels are crisp squares; at 100% and above the cutout shown is the full-resolution render**, the same mask a save stores. Below 100% it is rendered at screen resolution and only re-rendered when the one held is too coarse. Zoom never goes below fit, so for a photo smaller than the screen 100% is the same as fit.
- **The Overlay view (the default) shades what is removed** instead of drawing an outline: the photo at half strength, the cutout added on top, over black. Checkerboard (8 CSS px squares), Black, White and Red are the other views; the choice stays across tools and photos.
- **The toolbar shows only tools that exist** (Auto and View); in View one finger pans and never edits. The spec 0008 sticker panel moves, unchanged, into a "Stickers" sheet that takes the tool sheet's place while open. Every control is at least 44 × 44 CSS px, and only the canvas moves (the page never scrolls).
- **Each photo starts its own history**, so Undo never brings back the previous photo's cutout. Each history step keeps the model soft edge it was made with, so an undone Auto result renders and saves with its own edge. "Reset to auto" appears once Auto has produced a result for the photo.
- **Compare shows the original photo only while held** (pointer or Space/Enter), and releases when the finger lifts, slides off, or the button loses focus.
- **The editor follows the system's light or dark setting**; the canvas backgrounds are the same in both, so colours are judged the same way.
- **Drawing a frame takes under 8 ms in desktop Chromium** for a 12 MP photo at 100% (median of 30 panning frames, measured in the page with `performance.measure('peel-frame')`): about 1.5 ms in Overlay and 0.1 ms in the other views on a laptop.
- **Screenshot baselines are made on CI Linux, Pixel 8 project only** (fonts and rasterising differ between systems), stored without a platform suffix under `e2e/__screenshots__/`. A missing baseline is written by the CI run and uploaded as the `screenshots` artifact; download it with `gh run download`, check the images by eye, and commit them. The status strip is hidden in screenshots because its text depends on the model download, which those tests block.
