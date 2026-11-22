# 0015 — Clean Auto cutouts on low-detail photos

- **Status:** Approved (2026-11-22, product owner)
- **Issues:** story #164; tasks #160 (scorecard), #161 (zoomed sharpening), #162 (smart edge sized to the photo), #159 (only the tapped person), #163 (real-phone check)
- **Plan reference:** STICKER_WEBAPP_PLAN.md Phase 10; follows spec 0014 (the scorecard)

## Why

Accuracy is the product, and the product owner wants near-perfect cutouts (spec 0014 Decision 2). From their testing (2026-11-22), the cutouts that disappoint share one cause: **Auto gets less detail than it needs.**

- **Low-resolution photos** of every kind people send: phone photos, forwarded pictures, screenshots. "It is MOSTLY the added background, but again it really depends sometimes it does a really good job."
- **A small subject in a bigger photo.** Hair "isnt a big issue from my testing, it is when the photo is low res, or the subject I am picking is small or low res, other than that not bad."
- **Two overlapping people** on a blurry screenshot: Auto takes both (#159, reported on the PR #157 preview).

How Auto works today (spec 0007):
1. The **fast** engine (Tap v1, 512 px) sees the whole photo shrunk, and its shaky result shows first.
2. During "Sharpening…", the **precise** engine (Tap v2, 768 px) sees the whole photo again, and its result replaces the first.
3. The **smart edge** (spec 0006) recolours an 8 px band around the outline into the finished cutout.

The owner is happy with this flow and its speed: "it runs the model and the result is shake and then it says 'sharpenning' and after that usually the result is pretty good."

Two weaknesses show in the scorecard (`docs/accuracy.md`, 2026-11-20). They are the basis of this story:

- **A small subject gets few model pixels.** The precise engine always looks at the whole photo, so a person filling a tenth of the frame gets about a tenth of its attention.
- **The smart edge sometimes makes the model's cutout worse.**
  - Hair at 1600 px: precise IoU 0.9847, finished 0.9788.
  - Skin-object at 1600 px: 0.9765 → 0.9703.
  - Two-people: worse at every size.

  Its band is 8 px of photo pixels at every size: 0.5% of a 1600 px photo, but 2% of a 400 px one.

The scorecard also can't yet see the owner's main complaint. Today's "extra" score only counts a *second subject* picked up, not background in general. And its six test photos are sharp composites with large subjects.

## Decisions

1. **One theme: low detail** (product owner, 2026-11-22). The story covers:
   - low-resolution, forwarded and screenshot photos;
   - small subjects;
   - the hair and edge mess both cause;
   - Auto taking both overlapping people (#159).
2. **The current two models, used smarter** (product owner: "Try the current models smarter first, and leave the bigger model option for an later update"). No new model, download or dependency. A stronger model is #165, for later.
3. **Scorecard first, then one PR per fix**, in this order, each revertible on its own:
   1. #160, the scorecard;
   2. #161, zoomed sharpening;
   3. #162, smart edge;
   4. #159, only the tapped person.

   Each fix PR carries a before/after table of the finished rows and a preview link (spec 0014 Decision 1). #159 gets its own fix only if its criterion (AC-13) still fails after #161 and #162. Otherwise it closes in the PR where it starts passing, with the scores. A fix that doesn't win is not shipped. Its PR is closed, with its numbers posted on its issue.
4. **The ship rule.** A fix ships only when:
   - no **finished** score, on any fixture at any size, is worse than the baseline beyond spec 0014 AC-9's tolerances (and this spec's AC-2 tolerances for the new scores);
   - at least one finished score the fix targets gets better.

   The fast, precise and lasso stages may move, each with a reason in the PR. "Improves some scores and hurts others" does not ship as is.
5. **Background left on is the slightly better mistake** (product owner: "Extra background I guess cause I can edit it out but so does the less of the person"). When a fix trades one for the other, a rise in **missed** is the harder no. Both are held by the ship rule.
6. **No new wait, no new step** (product owner, quoted above). The user sees what they see today: the fast result, "Sharpening…", the sharper result. Nothing new is shown, and nothing is added to Finish or the Library. The sharpened result must not arrive noticeably later (AC-8). This is measured as the user feels it, from the tap to the sharper result, on the first tap and on later taps (Claude's call, 2026-11-22, from the owner's "it works good as is now").
7. **Test photos stay composites** of free-licence cut-outs on real backgrounds (spec 0014 Decisions 3 and 9, AC-2 and AC-3), so the exact truth is known. The owner's own photos stay private and are never committed. They are checked by eye on the phones (#163).
8. **A finished row that misses its target after this story is reported, not failed** (spec 0014 Decision 2). Only regressions fail CI.

## What

### The scorecard sees low detail (#160)

- **AC-1** `scoreCutout(got, truth, extra?)` also returns:
  - **background:** |inside `got` ∧ outside `truth` ∧ outside `extra`| ÷ |inside `truth`|. This is the background left on, as a share of the subject's size. It is 0 when `got` is empty, and when both `got` and `truth` are empty. When `truth` is empty and `got` isn't, it is |inside `got`| (Infinity is not used).
  - **missed:** |inside `truth` ∧ outside `got`| ÷ |inside `truth`|. This is the share of the subject cut away. It is 0 when `truth` is empty.

  Both are checked against hand-worked masks, including:
  - a 10 × 10 square shifted by 2 px (background 0.2, missed 0.2);
  - a cutout that covers the distractor (background 0, extra > 0).
- **AC-2** The report gives both a column in every stage table:
  - target ≤ **0.005** each, marked ✅ or ❌ as the other columns;
  - CI tolerance **0.001** each (spec 0014 AC-9);
  - a second short list, "Most background left on (finished)", the five finished rows with the largest background.

  The `bench/accuracy-baseline.json` that #160 commits keeps every existing score byte-identical. It only adds the new scores and the new rows (AC-3), which proves #160 changes nothing in the app.
- **AC-3** `scripts/compose-accuracy-fixtures.py` adds two fixtures, under spec 0014's source, size and soft-edge rules (AC-1 to AC-3, Decision 9):

  | Fixture | Subject (tap) | Also in the photo | Checks |
  |---|---|---|---|
  | `small-subject` | a person whose bounding box is 15–25% of the photo's long side | busy background | small subject, hair at few pixels |
  | `overlap` | person A, in front | person B behind A, partly hidden by A, overlapping at least 30% of A's bounding box, mean colour of each within 40 levels per RGB channel of the other | only the tapped person (#159) |

  `overlap` writes `overlap.extra.png` for person B (only B's visible part). The layering copies #159's photo, where the tapped person stands in front of the other (Claude's call, 2026-11-22). Sources already licensed for spec 0014 may be reused.
- **AC-4** Every fixture gains a sixth size, **screenshot**:
  - the base downscaled to 720 px on its long side;
  - then a Gaussian blur of σ 1.5 px;
  - then re-encoded at JPEG quality 50.

  This is roughly a screenshot of a video frame, like #159's photo. Its truth is the base truth downscaled the same way and blurred by the same σ. The ladder is then: 1600, 1000, 600, 400, forwarded, screenshot.
- **AC-5** The bench's **precise** and **finished** stages run what Auto runs: the fast engine first, then the precise engine on Auto's own path, through the same shared code. When #161 lands, that path is the zoomed one, and the bench scores it without a bench-only copy. The bench also records, per fixture and size, the milliseconds from the tap to the precise result (the sharper result the user waits for), for the first tap, and at 1000 px and screenshot also for a second add tap on the same subject (only those two sizes, to keep the CI job under its 45 minutes). `docs/accuracy.md` shows it as information. It is never compared with the baseline, because CI machines differ.

### Zoomed sharpening (#161)

- **AC-6** Given the fast result and the taps, the precise engine runs on a **crop** of the full-resolution photo instead of the whole photo:
  - The crop is the bounding box of the fast result's inside pixels and every add tap, padded on each side by **P** of its own width and height, then clipped to the photo.
  - **P** starts at 25%. The builder may tune it on the bench, and the value used is recorded in `docs/decisions.md`.
  - The crop goes through the same inference copy as today (long side ≤ 1024 px).
  - Taps are moved into crop coordinates (image pixels, float). Remove taps outside the crop are dropped.
  - The result is placed back at full photo size, with alpha 0 outside the crop.
- **AC-7** It falls back to today's whole-photo run when:
  - there is no fast result (the fast engine is unavailable, failed, or found nothing);
  - the crop covers ≥ 80% of the photo's area;
  - the zoomed result's inside pixels touch a crop edge that is not a photo edge, which means the crop cut the subject. The precise engine then reruns on the whole photo, and the bench reports how many fixture × size rows took this path.

  Each fallback has a unit test.
- **AC-8** The user sees the same flow as today (Decision 6): the same phases, status lines and notices, in the same order. Every existing auto-cutout test stays green unchanged. In one bench run, #161's PR reports the median time from tap to sharper result (AC-5) with the whole-photo and the zoomed path, for the first tap and for the second tap. Each zoomed median is ≤ 1.2 × its whole-photo median.

  Two costs make this a real limit, not a formality:
  - Today both engines start at the tap, side by side. The zoomed run can only start once the fast result gives the crop.
  - The precise worker reuses the photo's embedding across taps, but a crop that changes with each tap needs a new one.

  How to stay inside the limit is the builder's call. Options include reusing the crop while new add taps stay inside it, or starting the whole-photo run at the tap and replacing its result with the zoomed one. Any approach must keep Decision 6: no new visible step. The owner's phone check (AC-14) is the final word on "felt slower".
- **AC-9** #161's PR shows the before/after table and meets the ship rule (Decision 4).

### Smart edge sized to the photo (#162)

- **AC-10** The report gains a "finished vs precise" list: every fixture × size where finished is worse than precise by more than 0.002 IoU or 0.001 background. After #162, the list is empty, or each remaining row is a known miss with its own issue, marked as such in the report (spec 0014 Decision 8). The means are the builder's call. Options include a band width that follows the photo's size and a band that stays out where the model is confident. The values chosen go in `docs/decisions.md`.
- **AC-11** The editor preview and the saved sticker use the same smart-edge settings for the same photo. The settings depend on the photo's full size, never on the preview scale, so no preview shortcut leaks into the saved sticker (CLAUDE.md). This has a unit test.
- **AC-12** #162's PR shows the before/after table and meets the ship rule.

### Only the tapped person (#159)

- **AC-13** On `overlap`, the finished cutout's **extra** is ≤ 0.005 and its **missed** is ≤ 0.02 at every size, screenshot included. If #161 and #162 already achieve this, #159 closes in the PR where it starts passing. Otherwise #159 gets its own fix PR, under the ship rule. If no fix meets this with the current models, #159 stays open as a known miss, marked in the report with its scores (Decision 8), and the story still completes (Claude's call, 2026-11-22).

### On real phones (#163)

- **AC-14** `docs/device-test-log.md` gets a section, "Low-detail Auto (spec 0015)", with rows for the product owner's own photos on the iPhone 15 Pro and Galaxy S23:
  - a low-resolution photo;
  - a forwarded one;
  - a screenshot;
  - a small subject;
  - two overlapping people.

  Each row records whether Auto's result came out cleaner than before, and whether "Sharpening…" felt slower. The owner fills it from each fix PR's preview and from the final main deploy.

## Contract

- `scoreCutout` returns `Scores` with `background: number` and `missed: number` added. `bench/accuracy.json` and the baseline gain both fields per row, plus `ms` per row, which is never compared.
- In `src/core/segmentation/` (pure, no DOM, React, Node or browser imports):
  - `zoomCrop(fastAlpha: AlphaMask | null, taps: readonly Tap[], photo: Size, padding: number): Bounds | null`: the crop (max exclusive, as `cropRgba`), or `null` for "use the whole photo";
  - `tapsInCrop(taps, crop): Tap[]`;
  - `cutsSubject(alpha, crop, photo): boolean`.

  Coordinates are image pixels (float). The precise worker engine sends the crop to its worker as a region of the photo. The worker places the result back at full photo size, so `AutoResult` keeps its meaning. The bench uses the same engine code (AC-5).

## Out of scope

- Holes inside a subject (#158) and the dots round trip (#156): left for later (product owner, 2026-11-22: holes are "rare, leave it for later").
- A new or bigger model (#165), and any new download or dependency.
- Any visible change: no new buttons, settings, status lines or steps.
- The fast engine's own result, and the Lasso, Dots and Brush tools.
