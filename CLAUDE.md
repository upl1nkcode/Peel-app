# Peel — rules for Claude Code

Peel is a phone-first PWA that cuts subjects out of photos onto a transparent background, on-device, as accurately as possible. Read `STICKER_WEBAPP_PLAN.md` for the full design and `docs/decisions.md` for confirmed decisions.

## Workflow (spec-driven + TDD)

1. **Start from an issue** on the "Peel" board. No issue, no branch. Move the card to In Progress.
2. **Spec first** for stories: `docs/specs/NNNN-short-name.md` from `docs/specs/0000-template.md`, with Given/When/Then criteria (AC-1, AC-2, ...). Get approval on the spec before writing code. Tasks and bugs keep criteria in the issue.
3. **Plan:** `superpowers:writing-plans` -> `docs/plans/NNNN-short-name.md` (committed).
4. **Tests first:** each AC becomes at least one `should_...` test that mentions its AC ID. Show it failing, then write the minimal code, then refactor (`superpowers:test-driven-development`).
5. **If the spec is wrong mid-way:** stop, fix the spec, then the tests, then the code. The spec is the source of truth.
6. **PR:** `Closes #N`, link the spec. Run `superpowers:verification-before-completion` before saying anything is done. Squash merge; set spec status to Implemented; card to Done.

Branches: `<type>/<issue>-<short-name>` (e.g. `feat/12-lasso-recording`). Commits: Conventional Commits (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`). No direct pushes to `main` (after Phase 0 CI exists).

## Code rules (plan §11)

- TDD always; show failing test output before implementing.
- `src/core/` has no DOM, React or browser imports. Subagents must be told this.
- Store geometry in **image pixels (float)**; name variables `screenPt` / `canvasPt` / `imagePt`.
- Live preview at screen resolution, final render at full resolution. Preview shortcuts must never leak into the saved sticker.
- No server, no paid services, no tracking. Models are lazy-loaded and cached, never in the initial bundle.
- Record every dependency and model license in `docs/licenses.md`. Ask before adding a non-permissive license, changing the stack, or adding anything that needs a server or paid service.
- Add a dependency in the same PR that uses it, with a one-line reason in the PR description.
- No secrets in code, git or logs. Configuration comes from environment variables; `.env` is git-ignored.
- If a browser limitation blocks a feature, stop and tell the user.
- **Accuracy is the product.** When a choice trades precision for convenience, prefer precision and ask if unsure.

## Environment notes

- Windows. Run Python as `py` (not `python`).
- Use Playwright MCP tools to explore pages. Tests must never depend on live websites.
- Real-phone check (iPhone via PWA install, Android) is required after each phase.

## Definition of done

Acceptance criteria met and tested; spec Implemented (stories); lint, typecheck, unit, e2e green in CI; docs updated; one approving review; card in Done. Coverage: `src/core/` >= 90%, overall >= 75%.

## Commands

- `npm run dev` / `build` / `preview`
- `npm run lint` · `typecheck` · `format:check` (`format` to fix)
- `npm test` (Vitest + React Testing Library, jsdom) · `test:coverage` · `test:watch`
- `npm run test:e2e` (Playwright: iPhone 15 on WebKit, Pixel 8 and Desktop Chrome on Chromium; builds and serves the app itself). First run: `npx playwright install chromium webkit`.
- Test names: `should_...`; unit tests live next to the code as `*.test.ts(x)`, e2e in `e2e/`.
