# Peel — Sticker Maker Web App (phone-first PWA)
### Implementation plan for Claude Code (TDD) — v2: precision cropping

> **Goal:** A free web app, optimized for phones (iPhone + Android), that cuts anything out of a photo — a person, a pet, an object — onto a **transparent background** as accurately as possible, and saves it as a sticker.
> **Install:** open the link → "Add to Home Screen". Works offline. No App Store, no server, €0 hosting.
> **Privacy:** all processing happens on the phone, in the browser. Photos never leave the device.
> **Process:** Brainstorm → confirm decisions → failing tests first → implement → verify on a real iPhone and Android phone after every phase.

---

## 0. How Claude Code should use this file

1. Read the whole plan before writing code. Start with Phase 0.
2. Skills to use if installed (e.g. the Superpowers plugin):
   - `brainstorming` — Phase 0, with the user, using §2.
   - `writing-plans` — break each phase into 2–10 minute tasks in `docs/plans/`.
   - `test-driven-development` — mandatory. RED → GREEN → REFACTOR. No production code without a failing test that demands it.
   - `executing-plans` / `subagent-driven-development` — one phase at a time, review checkpoint after each.
   - `systematic-debugging` — on unexpected failures, find the root cause first.
   - `verification-before-completion` — never claim done without running tests and showing output.
   - If a skill isn't installed, follow the equivalent process described here.
3. Commit after every GREEN + REFACTOR cycle (`test: ...` / `feat: ...`).
4. Ask the user before: adding a dependency with a non-permissive license, changing the stack, or adding anything that needs a server or a paid service.
5. **Accuracy is the product.** When a choice trades precision for convenience, prefer precision and ask the user if unsure.

---

## 1. What a web app can and can't do with stickers

| Want | On the web |
|---|---|
| Precise cutout (auto, dots, lasso, brush) | ✅ Fully possible, on-device |
| Install on iPhone / Android like an app | ✅ "Add to Home Screen" (Safari on iPhone; Chrome on Android also shows an install prompt) |
| Work offline | ✅ Service worker caches the app and AI models |
| Save into iOS system Stickers automatically | ❌ No app can do this, web or native. Path: **Share → Save Image → Photos → long-press subject → "Add Sticker"** (in-app guide) |
| iMessage / WhatsApp sticker packs | ❌ Needs a native app. Web app shares the sticker as a transparent image |
| Share / download / copy the sticker | ✅ Web Share API with files, PNG download, clipboard |
| Sticker library | ✅ IndexedDB on the device |

**Storage caveat:** Safari may delete a site's data after ~7 days without use unless it was added to the Home Screen. The app requests persistent storage, nudges iPhone users to install, and offers "Export all (ZIP)".

---

## 2. Brainstorming agenda (Phase 0, with the user)

One question at a time; record answers in `docs/decisions.md`.

| # | Question | Default |
|---|---|---|
| 1 | Accept §1 limits? | Yes |
| 2 | Framework? | **React + TypeScript + Vite**. Alternative: Angular |
| 3 | Auto engines? (§5.1) | Person segmenter + "tap the object" segmenter (both small, Apache-2.0) |
| 4 | Hosting? | **Cloudflare Pages** (free). Alternatives: GitHub Pages, Netlify, Vercel |
| 5 | Max zoom in the editor? | 16× |
| 6 | Default dot density after lasso/auto? | Medium (≈1 dot every 12 screen px at fit-zoom), adjustable |
| 7 | Sticker extras for v1? | White outline + edge softness slider |
| 8 | Languages? | English + Romanian |
| 9 | Open source? | Yes, public repo |

YAGNI: anything not confirmed here is out of scope.

---

## 3. Crop modes — the core of the app

All modes produce **one shared editable selection**, so the user can start with any mode and finish with any other. Typical flows:

- **Person:** Auto (person) → Smart edge keeps hair detail → Dots to fix a shoulder → Brush to erase a bit of background between fingers → Done.
- **Object:** Lasso around it → converts to dots → drag dots onto the exact edge → Done.
- **Anything:** Dots from a starting shape → drag/add dots around it → Done.

### 3.1 Auto
- **Person mode:** one tap on "Person" → segments people (body, hair, clothes) with a **soft alpha mask** (keeps hair strands semi-transparent instead of a jagged cut).
- **Tap-the-object mode:** tap on anything (mug, dog, car) → that object is selected. Tap more spots to add to the selection; long-press a spot to remove it.
- Result becomes the selection: a **vector outline with dots** (for editing) **plus** the model's soft edge (for hair/fur). See §4.
- Fails / nothing found → message + switch to Lasso.

### 3.2 Dots (polygon / path editing)
- Start from: the outline produced by Auto or Lasso, **or** a starting shape (rectangle, ellipse) placed over the photo.
- **Drag a dot** to move it. Dots are drawn small but have a **large invisible touch area** (≈44 px) so they're easy to grab at any zoom.
- **Precision drag:** while dragging, the dot moves at **¼ of finger speed** after holding still for 300 ms (toggle "Fine" mode), and the loupe shows the dot over the magnified pixels with a crosshair.
- **Tap on an edge** between two dots → inserts a dot there.
- **Double-tap a dot** → delete it. **Long-press a dot** → toggle **corner ↔ smooth** (smooth dots make a curve through neighbours; corners make sharp points, e.g. elbows, box corners).
- **Nudge pad:** selected dot can be moved 1 image-pixel at a time with arrow buttons.
- **Select several dots** (two-finger tap or box-select in "Select" tool) and move them together.
- **Dot density slider:** re-simplify the outline to fewer/more dots without changing its shape beyond a tolerance.
- Edges between dots are **curves** (centripetal Catmull-Rom → cubic Bézier) when dots are smooth, straight lines when corners.

### 3.3 Lasso (freehand, pixel-precise)
- Drag one finger along the exact shape; path is recorded at full input resolution (use `getCoalescedEvents()` for every touch sample, not just one per frame).
- **Loupe** above the finger (2–4× extra magnification, crosshair, offset so the finger doesn't hide the edge).
- **Zoom in and draw:** pinch to 16× zoom, draw a section, lift, pan with two fingers, **continue the same lasso** from where it stopped (a "pause" handle sits at the end of the open path).
- **Magnetic option ("Snap to edges"):** while drawing, the path snaps to the strongest nearby image edge (Intelligent Scissors / live-wire: shortest path on an edge-cost map). Best for clean edges (objects, clothing). Toggle on/off.
- **Add / Subtract mode:** draw an extra lasso to add an area, or subtract one (e.g. the gap between an arm and the body).
- On lift: close path → light smoothing to remove finger jitter (strength adjustable, 0 = raw) → **converted to dots** for fine-tuning (§3.2).

### 3.4 Brush (final touch-ups)
- **Erase** and **Restore** brushes with size and hardness sliders, sizes shown in image pixels.
- Brush works on the raster mask on top of the vector outline, so it handles things dots can't (hair strands, holes, fuzzy fur).
- Pressure ignored (fingers); size follows zoom so a "10 px" brush is always 10 image pixels.

### 3.5 Smart edge (refine)
- Optional per selection: within a thin band (e.g. 2–20 px, slider) along the outline, recompute alpha from the image itself (**guided-filter matting**) so the edge follows real hair/fur/blur instead of the drawn line.
- For Auto (person), it also blends in the model's soft alpha in that band.
- Outside the band: fully opaque inside, fully transparent outside — so the user's dots/lasso always win.

### 3.6 Precision aids (all modes)
- Pinch zoom 1×–16×, two-finger pan, double-tap to zoom to 100% (1 image pixel = 1 screen pixel) / back to fit.
- Loupe with crosshair during any drag.
- **View toggles:** original + outline overlay, cutout on checkerboard / black / white / red (exposes leftover background pixels), hold-to-compare before/after.
- **Unlimited undo/redo** for every operation (command pattern), plus "reset to auto result".
- Large photos supported up to ~12 MP (iPhone camera photos fit).

---

## 4. Selection model (the key design decision)

```
Selection
  paths:   Ring[]                 # vector, editable with dots
             Ring { nodes: Node[], op: 'add' | 'subtract' }
             Node { x, y (image px, float), kind: 'corner' | 'smooth' }
  softEdge?: { source: 'model' | 'guided', bandPx }  # optional edge refinement
  strokes: BrushStroke[]          # erase / restore, applied last
  feather: number                 # global edge softness (0–3 px)

render(selection, image) → AlphaMask (full resolution, 8-bit)
  1. rasterize rings in order (add = union, subtract = difference), anti-aliased, nonzero fill
  2. apply softEdge inside the band around the outline
  3. apply brush strokes in order
  4. feather
```

- **Auto → dots:** model mask → threshold at 50% → **marching squares** contour tracing → outer rings + holes → simplify (RDP with sub-pixel tolerance) → smooth/corner classification by angle → Rings. The original soft mask is kept as `softEdge.source = 'model'`.
- **Lasso → dots:** raw path → jitter smoothing → RDP → Rings.
- Everything is **pure TypeScript on plain arrays** in `src/core/`, so it's unit-tested in Node in milliseconds.
- Coordinates are always stored in **image pixels (floats)**, never screen pixels.

---

## 5. Tech stack

- **Vite + React + TypeScript (strict)**, **Zustand** for state
- **vite-plugin-pwa** (manifest, service worker, offline cache, update prompt)
- **Canvas 2D / OffscreenCanvas** rendering; heavy work (segmentation, matting, full-res render, encode) in **Web Workers**
- **IndexedDB** via `idb`
- **Testing:** Vitest, React Testing Library, **Playwright** with mobile emulation (iPhone 15 / Safari-WebKit, Pixel 8 / Chrome) incl. multi-touch, screenshot tests, `fake-indexeddb`
- **Quality:** ESLint, Prettier, Lighthouse CI
- **CI/CD:** GitHub Actions → tests → Cloudflare Pages (production on `main`, preview URL per PR to test on the phone)

### 5.1 AI engines (on-device, lazy-loaded, cached for offline)
| Engine | Use | License |
|---|---|---|
| MediaPipe Image Segmenter (selfie / multiclass person model) | Auto → Person, soft alpha incl. hair | Apache-2.0 |
| MediaPipe Interactive Segmenter | Auto → tap the object | Apache-2.0 |
| Optional later: full-auto background removal (e.g. `@imgly/background-removal`) | One-tap, no subject choice | AGPL-3.0 → repo must stay public |

All behind a `SegmentationEngine` interface; WebGPU when available, WASM fallback. Verify current model names, sizes and licenses before adding.

---

## 6. Architecture

```
src/
  core/                         # PURE TS, no DOM — ≥90% coverage
    geometry/   lasso, chaikin/jitter smoothing, rdp, catmullRom→bezier, polygon ops, hit-testing
    selection/  Selection model, ring ops (add/subtract), node edit commands, density re-simplify
    contour/    marchingSquares, ring orientation & hole detection
    mask/       AlphaMask, rasterize (AA, nonzero), boolean ops, brush, feather, resize, trim, outline(dilate)
    matting/    guidedFilter, band mask, edge-cost map (Sobel), liveWire (Dijkstra on cost map)
    coords/     screen ↔ canvas ↔ image transforms (zoom, pan, DPR, fit)
    history/    command stack (undo/redo)
    sticker/    output specs, fit/size-budget encoder strategy
  workers/      segmentation.worker, render.worker (mask + matting + encode), livewire.worker
  services/     segmentation, storage (IndexedDB), share/download/clipboard/zip, image-loader (EXIF, downscale)
  ui/
    editor/     EditorCanvas, Loupe, DotsLayer, LassoTool, BrushTool, AutoTool, ViewToggles, NudgePad, Toolbar
    screens/    Library, Pick, Editor, Finish(outline/softness/output), Export, InstallGuide, AddStickerGuide
  app/          routes, stores, PWA update prompt, i18n
tests/e2e/      Playwright
test/fixtures/  photos (person, hair, pet, object) + hand-made ground-truth masks
```

---

## 7. Phone-first UI

- Designed for 360–430 px wide first; bottom toolbar: **Auto · Dots · Lasso · Brush · View**, with tool options in a slide-up sheet.
- Buttons ≥ 44×44 px; primary actions in the thumb zone; `env(safe-area-inset-*)`; `100dvh`.
- Editor canvas uses `touch-action: none`; the rest of the app scrolls and zooms normally.
- Gesture rules (tested as a pure state machine): 1 finger = active tool; 2 fingers = pinch/pan, never edits; a second finger landing mid-stroke **cancels** the stroke (no accidental marks).
- Dark mode, EN/RO, accessibility labels, Lighthouse a11y ≥ 95.
- Performance budgets: initial JS < 200 KB gzipped; editor interactions 60 fps on a mid-range phone; full-res render of a 12 MP photo < 1.5 s in a worker; live preview renders at screen resolution while dragging, full res on release.

---

## 8. Output (`core/sticker/specs.ts`)

| Output | Format | Size |
|---|---|---|
| Sticker (default) | PNG, transparent, trimmed | max side 1024 px |
| Original quality | PNG, transparent | full cutout resolution |
| WhatsApp-style | WebP, transparent | 512×512, ~16 px margin, aim ≤ 100 KB |
| Library thumbnail | WebP | 256 px |
| Backup | ZIP of PNGs + selection JSON | — |

Selections are saved with each sticker so it can be **re-opened and re-edited** later.
Finish screen: optional white outline (width/color), edge softness, trim padding.

---

## 9. Phased TDD plan

Each task: failing test → see it fail → minimal code → pass → refactor → commit. Each phase ends with a preview URL the user opens on their **iPhone** and Android phone.

### Phase 0 — Brainstorm & scaffolding
- [ ] Brainstorm (§2) → `docs/decisions.md`.
- [ ] Vite React-TS, strict TS, ESLint/Prettier, Vitest, RTL, Playwright (WebKit iPhone, Chromium Pixel, Desktop).
- [ ] GitHub Actions + Cloudflare Pages; deploy "Hello Peel"; user installs it on iPhone via Add to Home Screen ✅.
- [ ] `CLAUDE.md` with §11 rules.

### Phase 1 — Coordinates, gestures, geometry (pure)
- [ ] Screen ↔ image transforms. *Table tests: DPR 1/2/3, zoom 1–16×, pan, letterboxing.*
- [ ] Gesture state machine (tool / pinch-pan / cancel on second finger). *Tests with synthetic pointer sequences.*
- [ ] Lasso recording (coalesced points, dedupe), close, jitter smoothing, RDP. *Tests.*
- [ ] Catmull-Rom → Bézier conversion, corner vs smooth nodes. *Tests: curve passes through nodes; corners produce sharp tangents.*
- [ ] Hit-testing: nearest node within touch radius (screen px) at any zoom; nearest edge for dot insertion. *Tests.*

### Phase 2 — Selection model & editing commands (pure)
- [ ] Ring/Node model; add/subtract rings. *Tests.*
- [ ] Commands: moveNode, moveNodes, insertNode, deleteNode, toggleKind, nudge, addRing, subtractRing, setDensity. *Each has a test, including undo/redo round-trip.*
- [ ] History stack (undo/redo, branch discard). *Tests.*
- [ ] Density re-simplification keeps shape within tolerance. *Property test: max deviation ≤ tolerance.*
- [ ] Serialization to JSON (saved with sticker). *Round-trip test.*

### Phase 3 — Masks (pure)
- [ ] Anti-aliased rasterization of curved rings (flatten Béziers adaptively, nonzero fill). *Tests: exact coverage for axis-aligned square; AA edge values; figure-8.*
- [ ] Boolean add/subtract of rings. *Tests.*
- [ ] Brush erase/restore with hardness, image-pixel sizes. *Tests.*
- [ ] Feather, trim, outline (dilation), resize. *Tests.*
- [ ] `render(selection)` pipeline order (§4). *Tests verifying order matters as specified.*

### Phase 4 — Contours: mask → dots (pure)
- [ ] Marching squares → rings, holes detected by orientation. *Tests: square, donut (hole), two separate blobs.*
- [ ] Sub-pixel RDP + corner/smooth classification by angle. *Tests.*
- [ ] Round-trip accuracy: mask → dots → render ≈ original. *Test: IoU ≥ 0.99 on fixtures.*

### Phase 5 — Edges: smart edge & magnetic lasso (pure, then worker)
- [ ] Sobel edge-cost map. *Tests on synthetic step-edge images.*
- [ ] Live-wire shortest path between two points. *Test: path follows a synthetic edge within 1 px.*
- [ ] Guided filter. *Tests vs. a reference implementation on small arrays.*
- [ ] Band-limited refinement (only changes alpha inside the band). *Test: pixels outside band unchanged.*
- [ ] Run in `render.worker` / `livewire.worker` with typed messages. *Protocol tests.*

### Phase 6 — Auto (AI) segmentation
- [ ] `SegmentationEngine` interface + fake engine.
- [ ] Person engine → soft mask → selection (rings + softEdge). *Playwright test on person fixture: IoU ≥ 0.9 vs. ground truth.*
- [ ] Tap-object engine: add/remove taps. *Playwright test on object fixture.*
- [ ] Downscale for inference, upscale mask to full res. *Test.*
- [ ] Model download progress, offline cache, unavailable → Lasso fallback. *Tests incl. offline Playwright run.*

### Phase 7 — Image loading & storage
- [ ] EXIF orientation (`createImageBitmap` `imageOrientation: 'from-image'` + fallback), 12 MP cap. *8-orientation fixture tests.*
- [ ] IndexedDB repository (sticker + selection JSON + thumbnail), migrations, quota errors, persist request, ZIP export/import. *Tests with fake-indexeddb.*

### Phase 8 — Editor UI (component tests, then Playwright touch tests)
- [ ] EditorCanvas with zoom/pan, double-tap 100%/fit. *Tests.*
- [ ] Loupe with crosshair during drags. *Test.*
- [ ] **Dots tool:** drag, fine mode (¼ speed), insert on edge tap, double-tap delete, long-press corner/smooth, multi-select, nudge pad, density slider. *Playwright touch tests for each gesture.*
- [x] **Lasso tool:** draw, pause/continue across zoom/pan, magnetic toggle, add/subtract, convert to dots. *Tests.*
- [x] **Brush tool:** erase/restore, size/hardness, size in image px. *Tests.*
- [ ] **Auto tool:** Person / Tap object, loading, errors. *Tests with fake engine.*
- [ ] **View toggles:** overlay, checkerboard/black/white/red, hold-to-compare. *Screenshot tests.*
- [ ] Undo/redo buttons and "reset to auto". *Tests.*

### Phase 9 — Finish, export, library, install
- [ ] Finish: outline, softness, padding, output choice. *Screenshot tests.*
- [ ] Export: Share (if `navigator.canShare({files})`), Download, Copy (if supported), Save. Unsupported hidden. *Tests.*
- [ ] iPhone "Add to Stickers" guide; Android install button; iPhone install guide; update prompt. *Tests.*
- [ ] Library: grid, re-open and re-edit, delete, export all. *Tests.*

### Phase 10 — Accuracy & device verification
- [ ] **Accuracy benchmark** (`npm run bench:accuracy`): fixtures (person with loose hair, person in front of busy background, pet, glossy object, object with hole) vs. ground-truth masks; report IoU and edge error for: Auto alone, Auto + smart edge, Lasso + dots. Store results in `docs/accuracy.md`; fail CI if they regress.
- [ ] Full E2E on emulated iPhone + Pixel; offline run.
- [ ] Lighthouse budgets.
- [ ] Manual checklist on a **real iPhone (installed to Home Screen)** and Android phone: cut out a person with hair, a mug via lasso + dots, a shape with a hole; save → Photos → Add Sticker; airplane mode; 12 MP photo. Log in `docs/device-test-log.md`.

### Phase 11 — Launch (free)
- [ ] Production deploy on Cloudflare Pages; security headers (CSP, cross-origin isolation if engines need threaded WASM).
- [ ] Privacy page, maskable icons, manifest, README with QR code to the URL.

---

## 10. Definition of done
- Lint, typecheck, unit, E2E, accuracy benchmark, Lighthouse: all green.
- Coverage: `src/core/` ≥ 90%, overall ≥ 75%.
- Phase demoed on a real iPhone via the preview URL before the next phase starts.

## 11. Rules for Claude Code (copy into `CLAUDE.md`)
- TDD always; show failing test output before implementing.
- `src/core/` has no DOM/React/browser imports.
- Store geometry in **image pixels (float)**; name variables `screenPt` / `canvasPt` / `imagePt`.
- Live preview at screen resolution, final render at full resolution — never let preview shortcuts leak into the saved sticker.
- No server, no paid services, no tracking. Models lazy-loaded and cached, never in the initial bundle.
- Record every dependency/model license in `docs/licenses.md`.
- If a browser limitation blocks a feature, stop and tell the user.

## 12. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Hair/fur looks jagged | Soft model alpha + smart-edge band + restore/erase brush |
| Fingers too imprecise | 16× zoom, loupe, fine-drag, nudge pad, magnetic lasso |
| Too many dots to manage | Density slider; smooth curves need fewer dots |
| Phone performance with big photos | Workers, preview at screen res, 12 MP cap |
| Safari memory limits | Release bitmaps/canvases, cap working canvas sizes |
| Data loss on iPhone if not installed | Persistent storage, install nudge, ZIP export |
| User expects auto-save into iOS Stickers | §1 + in-app guide |

## 13. Out of scope for v1
Native apps, iMessage/WhatsApp sticker packs, animated stickers, text on stickers, accounts, cloud sync.
