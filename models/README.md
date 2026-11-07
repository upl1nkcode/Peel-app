# Tap models

The two MediaPipe interactive segmenters behind auto cutout (spec 0007). They are served from our own site (`/models/`) and cached by the app on first use; the build (`vite/peelModels.ts`) splits files over 24 MiB into parts, because Cloudflare Pages serves files of at most 25 MiB.

| File | Model | Bytes | SHA-256 | Source | Licence |
|---|---|---|---|---|---|
| `magic_touch.tflite` | Tap v1 (MagicTouch, float32, 512×512) — the fast engine | 6,227,884 | `e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25` | https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/latest/magic_touch.tflite | Apache-2.0 ([model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf)) |
| `interactive_segmentation.task` | Tap v2 (interactive segmenter v2, int8, 768×768) — the precise engine | 30,525,312 | `38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03` | https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task | Apache-2.0 |

Downloaded 2026-11-06. To update a model, replace the file and update this table. Phones download the new one by themselves: cached files are keyed by their SHA-256, so a changed file misses the cache.
