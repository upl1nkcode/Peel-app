# 0012 — I can finish my sticker, get it out of the app, and add it to iPhone stickers

- **Status:** Implemented
- **Issues:** story #81; tasks #82 (Finish screen: outline, edge softness, padding), #83 (output specs and encoder), #84 (share, download and copy with feature detection), #85 (iPhone "Add to Stickers" guide)
- **Plan reference:** STICKER_WEBAPP_PLAN.md §1 (what the web can do with stickers), §8 (output), Phase 9. Builds on:
  - spec 0004: mask rendering, feather, trim, outline and resize;
  - spec 0008: saving stickers, the sticker record and backups;
  - spec 0009 to 0011: the editor and its tools.

## Why

A sticker can be cut out precisely, but it can't leave the app. "Save" keeps it in Peel's own storage on the phone, and "Export all" makes a backup ZIP. Nothing goes to Photos, Messages or WhatsApp. That is the reason someone makes a sticker.

This story adds the last step:
- **Finish** the sticker: an optional outline, edge softness and padding.
- **Choose an output:** a 1024 px sticker, the original size, or a 512 px WhatsApp-style image.
- **Get it out:** share it, copy it or download it.

On an iPhone, a web app can't put a sticker into the system's Stickers (plan §1; no app can). The path is Share → Save Image → Photos → touch and hold the subject → Add Sticker. Peel shows that path as a short guide.

The pieces exist and are tested:
- mask rendering and feather (spec 0004);
- trim, outline and resize (spec 0004);
- our own PNG encoder (spec 0004).

This story adds the output pipeline, a WebP encoder, the Finish screen and the export actions.

## Decisions

**Decision 1 is the product owner's**, made on 2026-11-16. The rest are my calls; numbers 3 and 5 matter most for what people get, so please check them.

1. **WhatsApp-style WebP is made by libwebp compiled to WebAssembly (`@jsquash/webp`, Apache-2.0), on every browser.**
   - Safari can't encode WebP from a canvas: it silently returns a PNG. That still held in Safari 27.2 (spec 0008 made thumbnails PNG for the same reason).
   - The encoder is about 115–125 KB gzipped. It downloads only the first time someone picks WhatsApp-style, never in the initial bundle.
   - It makes the same file on iPhone, Android and desktop.
2. **The Finish screen opens from a "Done" button in the top bar.** It replaces the editor until "Back".
   - "Done" is enabled when Save would be: a photo is open and the selection has a ring.
   - The name avoids a clash with the Lasso's "Finish".
3. **The outline width and the padding are a share of the sticker's size, not pixels.**
   - Both are a percentage of the trimmed cutout's long side, so the sticker looks the same in all three outputs.
   - A width in pixels would be a hairline on the 4000 px Original and a fat border on the 512 px WhatsApp image.
   - **Outline:** off by default; white or black; 1–6% wide, default 3%.
   - **Padding:** 0–20%, default 0%.
4. **Edge softness is the selection's existing feather** (0–3 photo px, spec 0003). The Finish screen sets it with the existing `setFeather` command when the slider is let go, so Undo in the editor undoes it. Its unit stays photo px: changing it would change every saved sticker's look.
5. **The file for Share and Copy is made before the tap.**
   - Safari only allows sharing and copying straight after a tap. Making a 12 MP PNG takes longer than that, so making it after the tap would make Share fail on iPhone.
   - The file is made when the Finish screen opens and again after each change. While it's being made, Share, Copy and Download are disabled and the file line says "Preparing…".
6. **Copy is offered for PNG outputs only.** Browsers that copy images to the clipboard all take PNG; WebP is not required by the clipboard standard.
7. **The saved sticker stays the plain cutout** (spec 0008 AC-6), and its thumbnail too. The Finish settings are saved beside it and come back when it is reopened. Library thumbnails with outlines can come with the Library (#87).
8. **A new photo keeps the current outline, padding and output choice**, so a set of stickers comes out alike. A reopened sticker uses its own saved settings. Settings are not kept after a reload. Edge softness belongs to each selection, as now.
9. **The "Add to Stickers" guide shows on iPhone and iPad only**, folded under a "How to add to iPhone Stickers" button on the Finish screen. It's open the first time the Finish screen is shown in a session.

## What

Sizes are CSS px unless they say photo px or output px. "The cutout" is the full-resolution render of the selection applied to the photo (spec 0004 `cutout`), trimmed to its pixels with no padding. L is the cutout's long side in photo px.

### The output (#83)

- **AC-1** Given a cutout and Finish settings, when an output is made, then it is built in this order, and the result is exact for each step:
  1. Scale the cutout by s (AC-2), averaging over areas on premultiplied colour (spec 0004 AC-16), never enlarging.
  2. If the outline is on, add it with width = widthPct% × L × s output px, using spec 0004's `addOutline` (solid colour under every pixel with alpha ≥ 50%).
  3. Trim to the pixels with alpha > 0.
  4. Add padding of round(paddingPct% × L × s) transparent output px on every side.
  
  Where alpha > 0, RGB is never changed except by the averaging of step 1 and the outline under semi-transparent pixels. The preview on screen never reaches the file (spec 0004 AC-22 still holds).
- **AC-2** Given the "Sticker" output, then it is a transparent PNG whose long side is at most 1024 output px, including outline and padding. s = min(1, 1024 / (L × (1 + 2 × widthPct% + 2 × paddingPct%))), with the outline counted only when it's on. A cutout already smaller is not enlarged. The aspect ratio is kept to within 1 output px.
- **AC-3** Given the "Original" output, then it is the same with s = 1: the cutout at full resolution, with outline and padding added around it.
- **AC-4** Given the "WhatsApp-style" output, then it is a transparent WebP of exactly 512 × 512 output px.
  - The sticker (with its outline and padding) is scaled to fit inside 480 × 480 and centred, leaving at least 16 px of margin on every side.
  - The aspect ratio is kept to within 1 output px.
  - If centring leaves an odd pixel, it goes to the right or bottom margin.
- **AC-5** Given the WhatsApp-style output, then its file is at most 100 KB (102,400 bytes).
  - It is encoded lossy at quality 90 first, then at 80, 70, 60, 50 and 40, stopping at the first that fits.
  - If none fits, making it fails with a `TooLargeError` and the Finish screen says "This sticker is too detailed for WhatsApp-style (over 100 KB). Try the Sticker output."
  - The alpha channel is always encoded at full quality.
- **AC-6** Given the WebP encoder hasn't been downloaded and can't be (offline, or the download fails), when WhatsApp-style is chosen, then the Finish screen says "Couldn't load the WebP encoder. Connect to the internet and try again." The other outputs still work. Choosing WhatsApp-style again retries.
- **AC-7** Given a 12 MP photo (4000 × 3000) with a cutout of about half of it, then on the CI runner in Node, using the pure pipeline plus our PNG encoder:
  - the Sticker output is made in under 1.5 s;
  - the Original output with outline on is made in under 6 s.
  
  On the phone, outputs are made in the render worker, never on the main thread.

### The Finish screen (#82)

- **AC-8** Given a photo and a selection with at least one ring, when "Done" in the top bar is tapped, then the Finish screen opens, from top to bottom:
  - a top bar with "Back" (to the editor, with everything as it was) and "Save";
  - the preview: the chosen output on the checkerboard (8 CSS px squares), fitted to the space;
  - the file line, for example "PNG · 1024 × 768 px · 412 KB";
  - the output choice, a radiogroup "Output": Sticker (default), Original, WhatsApp-style;
  - an "Outline" switch, with a "Width" slider and a "White"/"Black" choice, enabled only when it's on;
  - an "Edge softness" slider and a "Padding" slider;
  - the export actions (AC-13 to AC-17);
  - on iPhone, the guide (AC-18).
  
  With no ring, "Done" is disabled.
- **AC-9** Given the Finish screen, when the output or any setting changes, then the preview and the file line show the new output.
  - Sliders update the preview at most every 150 ms while dragging and once on release.
  - The newest change always wins: a slower earlier result never replaces a newer one.
  - The preview is the output file itself for Sticker and WhatsApp-style. For Original, it's the Sticker output, which looks the same scaled down (Decision 3), with the file line giving the Original's size.
- **AC-10** Given the Finish screen, then the sliders are:
  - **Width:** 1% to 6% in steps of 0.5, showing "Width N%".
  - **Edge softness:** 0 to 3 photo px in steps of 0.25, showing "Softness N px".
  - **Padding:** 0% to 20% in steps of 1, showing "Padding N%".
  
  Edge softness is applied with `setFeather` on release (Decision 4) and shows on the preview.
- **AC-11** Given Finish settings, when the sticker is saved (from the Finish screen or the Stickers panel), then the settings are saved with it: output, outline on/off, width and colour, and padding. When it's reopened, they come back. A sticker saved before this story opens with the defaults. "Save" says "Saved" while what's on screen is what was saved (spec 0008), and changing a Finish setting makes it "Save" again.
- **AC-12** Given the settings, then they are kept as Decision 8 says. A new photo keeps the current settings, a reopened sticker uses its own, and a reload gives the defaults: Sticker, outline off (width 3%, white), padding 0%.

### Share, copy and download (#84)

- **AC-13** Given the Finish screen, then the export actions are "Share", "Copy" and "Download", in that order. Each one only shows where it works. None is ever shown and then fails for lack of support.
- **AC-14** "Share" shows only if `navigator.canShare` exists and returns true for a probe file of the output's type (a 1 × 1 PNG, or WebP for WhatsApp-style). Tapping it calls `navigator.share({ files: [file] })` at once, with the file already made (Decision 5).
  - The share sheet being closed (`AbortError`) shows nothing.
  - Any other error shows "Couldn't share. Try Download instead."
- **AC-15** "Copy" shows only for PNG outputs, and only if `navigator.clipboard.write` and `ClipboardItem` exist and `ClipboardItem.supports('image/png')` is true. Where `ClipboardItem.supports` itself doesn't exist, PNG counts as supported (it's the one image type the clipboard standard requires). Tapping it writes the file as `image/png` at once, then shows "Copied" for 2 s. On failure it shows "Couldn't copy. Try Share or Download instead."
- **AC-16** "Download" always shows. Tapping it downloads the file through a link with `download` set, revoking the object URL 30 s later (as spec 0008's backup does). The file names are, in local time:
  - `peel-sticker-YYYY-MM-DD-HHMM.png` for Sticker;
  - `peel-sticker-YYYY-MM-DD-HHMM-original.png` for Original;
  - `peel-sticker-YYYY-MM-DD-HHMM-whatsapp.webp` for WhatsApp-style.
- **AC-17** Given the file is being made (Decision 5), then Share, Copy and Download are disabled and the file line says "Preparing…". If making it fails, they stay disabled and the error shows in place of the file line.

### The iPhone "Add to Stickers" guide (#85)

- **AC-18** Given an iPhone or iPad, then the Finish screen shows a "How to add to iPhone Stickers" button. It opens and closes the guide, and is open the first time the Finish screen shows in a session.
  - "iPhone or iPad" means the user agent says iPhone, iPad or iPod, or it says Macintosh and the device has touch (`navigator.maxTouchPoints > 1`, iPadOS).
  - On other devices, neither the button nor the guide shows.
- **AC-19** The guide says, as a numbered list:
  1. Choose **Sticker**, then tap **Share**.
  2. Tap **Save Image**.
  3. Open **Photos** and open the image.
  4. Touch and hold the sticker until it lifts, then let go.
  5. Tap **Add Sticker**.
  
  Under it: "Your sticker is now in the stickers of Messages and the keyboard."
  
  If Share isn't shown (AC-14), step 1 says "Choose **Sticker**, then tap **Download**" and step 2 says "Open the download and tap **Share**, then **Save Image**."

### Layout and look

- **AC-20** Given a 375 × 812 or a 430 × 932 screen, then the Finish screen fits without the page scrolling sideways. The preview takes the space left above the controls, at least 40% of the height. The controls area scrolls when it doesn't fit.
- **AC-21** Screenshots in light and dark, at 375 and 430 px, on Pixel 8: the Finish screen with the outline off, and with it on (white, 3%). The second one is the "outline on and off" check of #82.

## Contract

```ts
// src/core/sticker/specs.ts — pure
export type OutputKind = 'sticker' | 'original' | 'whatsapp'
export interface FinishSettings {
  output: OutputKind
  outline: { on: boolean; widthPct: number; color: 'white' | 'black' }
  paddingPct: number
}
export const DEFAULT_FINISH: FinishSettings
/** AC-1 to AC-4: the output pixels from a trimmed cutout. */
export function finishImage(cutout: RgbaImage, settings: FinishSettings): RgbaImage
/** The output's width and height without making it (file line for Original). */
export function outputSize(cutoutSize: Size, settings: FinishSettings): Size

// src/core/sticker/budget.ts — pure
export class TooLargeError extends Error {}
/** AC-5: tries qualities in order and returns the first file ≤ budget. */
export function encodeWithinBudget(
  encode: (quality: number) => Promise<Uint8Array>,
  budgetBytes: number,
  qualities: readonly number[],
): Promise<Uint8Array>
```

The render worker gains one message, `finish`, with the Finish settings and the selection. It replies with `{ bytes, type: 'image/png' | 'image/webp', width, height }` or a typed error: `empty`, `tooLarge` or `encoderUnavailable`. Newest wins, as for other render messages.

## Data

- `StickerRecord` (spec 0008) gains an optional `finish?: FinishSettings`. The object store is schemaless, so there is no database migration; a record without it uses `DEFAULT_FINISH`.
- In a backup, the manifest line gains the optional `finish`. An older Peel ignores it when importing; this Peel imports older backups with the defaults.
- Values are checked on reading: an unknown output, or a number out of its range, falls back to that field's default.

## Out of scope

- Adding stickers to WhatsApp or iMessage sticker packs (needs a native app, #104).
- Outline colours beyond white and black; drop shadows; rotation and text (#105).
- Thumbnails and backups with the Finish look (Decision 7); the Library screen (#87).
- Offline caching of the WebP encoder (#89 caches the app and models; the encoder joins it there).
- Romanian text (#91).
- Animated stickers.
