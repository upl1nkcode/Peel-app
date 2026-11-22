# Licenses

Every dependency and model is recorded here when it is added (rule in `CLAUDE.md`). Peel is a public, open-source repo; anything non-permissive (GPL/AGPL/CC-NC) needs the product owner's approval first.

## npm packages (direct)

| Package | Version | License | Type |
|---|---|---|---|
| @mediapipe/tasks-vision | 1.2.2 | Apache-2.0 | runtime (auto cutout engine; its wasm is loaded lazily, never in the initial bundle) |
| @jsquash/webp | 1.5.0 | Apache-2.0 | runtime (WhatsApp-style WebP, spec 0012; libwebp in WebAssembly, loaded lazily, never in the initial bundle) |
| wasm-feature-detect | 1.10.1 | Apache-2.0 | runtime (dependency of @jsquash/webp: picks its SIMD or plain wasm build) |
| idb | 8.0.4 | ISC | runtime (small promise wrapper over IndexedDB for the sticker store, spec 0008; named in plan §5) |
| react | 19.3.1 | MIT | runtime |
| react-dom | 19.3.1 | MIT | runtime |
| @eslint/js | 10.0.1 | MIT | dev |
| @lhci/cli | 0.15.1 | Apache-2.0 | dev (Lighthouse CI: speed and accessibility budgets on the built app, spec 0014 AC-13; brings Lighthouse, Apache-2.0; results stay on disk, no upload) |
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
| fake-indexeddb | 6.2.7 | Apache-2.0 | dev (in-memory IndexedDB for the sticker store's unit tests) |
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

## Test photos (accuracy benchmark, specs 0014 and 0015)

Composited into `bench/fixtures/` (test data only, not shipped in the app). Spec 0015's two fixtures reuse these works. Details in `bench/fixtures/README.md`.

| Work | Author | License | Source |
|---|---|---|---|
| Woman in White Sleeveless Dress Sitting on Gray Concrete Seat during Daytime transparent.png | dzeeshah (via Pixabay) | CC0 | https://commons.wikimedia.org/wiki/File:Woman_in_White_Sleeveless_Dress_Sitting_on_Gray_Concrete_Seat_during_Daytime_transparent.png |
| Public bookcase of the Muri-Gümligen municipal library.jpg | Dafadllyn | CC0 | https://commons.wikimedia.org/wiki/File:Public_bookcase_of_the_Muri-G%C3%BCmligen_municipal_library.jpg |
| Lilac tortoiseshell and white Oriental Shorthair cat no background.png | Heikki Siltala (catza.net) | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Lilac_tortoiseshell_and_white_Oriental_Shorthair_cat_no_background.png |
| Grass at a lawn with morning dew 01.jpg | Leonhard Lenz | CC0 | https://commons.wikimedia.org/wiki/File:Grass_at_a_lawn_with_morning_dew_01.jpg |
| 160803-N-RY232-001 - Navy Working Uniform (NWU) Type III.png | USN | Public domain | https://commons.wikimedia.org/wiki/File:160803-N-RY232-001_-_Navy_Working_Uniform_(NWU)_Type_III.png |
| 160803-N-RY232-004 - Navy Working Uniform (NWU) Type III.png | USN | Public domain | https://commons.wikimedia.org/wiki/File:160803-N-RY232-004_-_Navy_Working_Uniform_(NWU)_Type_III.png |
| Living room of a typical rural house in northeast Brazil.jpg | Wilfredor | CC0 | https://commons.wikimedia.org/wiki/File:Living_room_of_a_typical_rural_house_in_northeast_Brazil.jpg |
| 160803-N-RY232-002 - Navy Working Uniform (NWU) Type III.png | MC1 Julia A. Casper, US Navy | Public domain | https://commons.wikimedia.org/wiki/File:160803-N-RY232-002_-_Navy_Working_Uniform_(NWU)_Type_III.png |
| Crisp bread.png | Tiia Monto | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Crisp_bread.png |
| Snowy Sainte-Famille Street in Quebec City.jpg | Wilfredor | CC0 | https://commons.wikimedia.org/wiki/File:Snowy_Sainte-Famille_Street_in_Quebec_City.jpg |
| Teacup.png | Rijksmuseum | CC0 | https://commons.wikimedia.org/wiki/File:Teacup.png |
| Laminate Kitchen Countertop Beige.jpg | Kurtkaiser | CC0 | https://commons.wikimedia.org/wiki/File:Laminate_Kitchen_Countertop_Beige.jpg |
| Wii-Wheel.png | Evan-Amos, modified by Gunnar.offel | Public domain | https://commons.wikimedia.org/wiki/File:Wii-Wheel.png |
| Autumn leaves, Dumitru Rascanu park.jpg | Iurie Nistor | CC0 | https://commons.wikimedia.org/wiki/File:Autumn_leaves,_Dumitru_Rascanu_park.jpg |

## Fonts and assets

App icons are generated from original SVG by `scripts/generate-icons.mjs` (no third-party artwork).
