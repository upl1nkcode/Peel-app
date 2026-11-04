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
