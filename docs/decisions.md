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

