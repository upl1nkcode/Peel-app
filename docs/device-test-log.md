# Device test log

Real-phone checks (CLAUDE.md: required after each phase). Fill in each row on the device; note the OS and browser versions.

## Finish and export (spec 0012, story #81)

Deployed build: <https://peel-app-9kg.pages.dev>, installed to the Home Screen.

| # | Check | iPhone | Android |
|---|---|---|---|
| 1 | "Done" opens the Finish screen; "Back" returns with the zoom as it was | "Done" ✓; "Back" not checked yet | |
| 2 | Outline on/off, white/black, width; padding; edge softness show on the preview | | |
| 3 | Sticker: Share opens the share sheet straight away (no second tap) | ✓ | |
| 4 | Share → Save Image → Photos → touch and hold → **Add Sticker** works (#85) | ✓ iOS keeps Peel's edge; sent in Messages | n/a |
| 5 | The guide is open the first time, closed the next; steps match what the phone shows (#85) | | n/a |
| 6 | Copy, then paste into Messages/WhatsApp: a transparent PNG | | |
| 7 | WhatsApp-style: Download gives a 512 × 512 WebP ≤ 100 KB; it can be sent as a sticker | | |
| 8 | WhatsApp-style in airplane mode the first time: "Couldn't load the WebP encoder…"; back online, picking it again works | | |
| 9 | 12 MP photo, Original with outline: the file is made without the page freezing | | |
| 10 | Save on the Finish screen; reopen the sticker: its Finish settings come back | | |

Tested by: product owner · Date: 2026-11-17 · Devices: iPhone 15 Pro, iOS 26.6.2, Safari (rows 1, 3, 4). Android: not yet.

## Library, install and offline (spec 0013, story #86)

Deployed build: <https://peel-app-9kg.pages.dev>. Clear the site's data (or use a new profile) before row 5 so it really is a first visit.

| # | Check | iPhone | Android |
|---|---|---|---|
| 1 | Touch and hold a sticker: it's ticked and nothing opens; tick a second; Share sends both in one sheet | | ✅ (tall stickers spilled out of their tiles: #151) |
| 2 | Delete (with its dialog) and Duplicate on ticked stickers | | ✅ |
| 3 | Install with the "Install Peel" button (⋯ menu or the card) | n/a | ✅ |
| 4 | Install with the iPhone guide; its steps match what Safari shows | | n/a |
| 5 | After the first visit says "Ready to use offline.": airplane mode, reopen, pick a photo, Auto, all three outputs, Save | | ✅ |
| 6 | Phone language Romanian: everything is in Romanian; Automatic/English/Română switch at once | | ✅ |
| 7 | After a new deploy, the Library shows "A new version of Peel is ready." and Reload loads it | | ✅ |
| 8 | Android Back: Finish → editor → Library (asking first when there are unsaved changes) | n/a | ✅ |

Tested by: product owner · Date: 2026-11-20 · Devices: Samsung Galaxy S23, Chrome (Android column). iPhone: not yet.

## Accuracy, on real phones (spec 0014, story #92)

From the main deploy, installed to the Home Screen (iPhone: from Safari; Android: from Chrome). Anything that looks wrong becomes an issue.

| # | Check | iPhone 15 Pro | Samsung Galaxy S23 |
|---|---|---|---|
| 1 | A person with loose hair, by Auto: the hair edge looks right | | |
| 2 | A mug by Lasso, then fixed with Dots | | |
| 3 | A shape with a hole: the background inside the hole is removed (known miss #158 for Auto) | | |
| 4 | A low-resolution photo (a screenshot or a forwarded WhatsApp image), by Auto | | |
| 5 | Two people, keeping only one | | |
| 6 | Save → Photos → Add Sticker on iPhone; WhatsApp on Android | | |
| 7 | Airplane mode: reopen, pick a photo, Auto, Save | | |
| 8 | A 12 MP photo straight from the camera | | |

Tested by: · Date: · Devices:

## Low-detail Auto (spec 0015, story #164)

The product owner's own photos (never committed), checked by Auto on each fix PR's preview and then on the main deploy. "Cleaner" means less background left on, with none of the subject cut away; "slower" means "Sharpening…" took noticeably longer than before.

| # | Photo | iPhone 15 Pro: cleaner than before? | iPhone 15 Pro: Sharpening felt slower? | Galaxy S23: cleaner than before? | Galaxy S23: Sharpening felt slower? |
|---|---|---|---|---|---|
| 1 | A low-resolution photo | | | | |
| 2 | A forwarded photo (WhatsApp or similar) | | | | |
| 3 | A screenshot (of a video or a story) | | | | |
| 4 | A small subject in a bigger photo | | | | |
| 5 | Two overlapping people, keeping one | | | | |

Tested by: · Date: · Build (PR preview or main):
