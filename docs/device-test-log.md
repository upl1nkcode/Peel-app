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
