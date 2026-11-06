# Licenses

Every dependency and model is recorded here when it is added (rule in `CLAUDE.md`). Peel is a public, open-source repo; anything non-permissive (GPL/AGPL/CC-NC) needs the product owner's approval first.

## npm packages (direct)

| Package | Version | License | Type |
|---|---|---|---|
| @mediapipe/tasks-vision | 1.2.2 | Apache-2.0 | runtime (auto cutout engine; its wasm is loaded lazily, never in the initial bundle) |
| react | 19.3.1 | MIT | runtime |
| react-dom | 19.3.1 | MIT | runtime |
| @eslint/js | 10.0.1 | MIT | dev |
| @playwright/test | 1.64.1 | Apache-2.0 | dev |
| @testing-library/dom | 10.4.2 | MIT | dev |
| @testing-library/jest-dom | 7.0.1 | MIT | dev |
| @testing-library/react | 16.3.3 | MIT | dev |
| @types/node | 24.19.2 | MIT | dev |
| @types/react | 19.3.0 | MIT | dev |
| @types/react-dom | 19.3.0 | MIT | dev |
| @vitejs/plugin-react | 6.2.1 | MIT | dev |
| @vitest/coverage-v8 | 5.1.0 | MIT | dev |
| eslint | 10.14.0 | MIT | dev |
| eslint-config-prettier | 10.1.8 | MIT | dev |
| eslint-plugin-react-hooks | 7.1.1 | MIT | dev |
| globals | 17.14.0 | MIT | dev |
| jsdom | 29.1.1 | MIT | dev |
| prettier | 3.9.10 | MIT | dev |
| typescript | 6.0.3 | Apache-2.0 | dev |
| typescript-eslint | 8.72.1 | MIT | dev |
| vite | 8.3.5 | MIT | dev |
| vite-plugin-pwa | 2.0.0 | MIT | dev |
| vitest | 5.1.0 | MIT | dev |
| workbox-window | 7.4.1 | MIT | dev |

## Models

| Model | File | License | Source |
|---|---|---|---|
| MediaPipe MagicTouch (Tap v1, fast engine) | `models/magic_touch.tflite` | Apache-2.0 (model card) | storage.googleapis.com/mediapipe-models, see `models/README.md` |
| MediaPipe interactive segmenter v2 (Tap v2, precise engine) | `models/interactive_segmentation.task` | Apache-2.0 | storage.googleapis.com/mediapipe-models, see `models/README.md` |
| MediaPipe Tasks Vision WebAssembly engine | copied from `@mediapipe/tasks-vision` at build (`/engine/`) | Apache-2.0 | npm package |

## Fonts and assets

App icons are generated from original SVG by `scripts/generate-icons.mjs` (no third-party artwork).
