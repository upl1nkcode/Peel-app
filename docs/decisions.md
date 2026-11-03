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
