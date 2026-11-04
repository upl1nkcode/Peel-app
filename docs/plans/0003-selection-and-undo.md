# Selection model, commands, undo, density, serialization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pure-TypeScript selection that every crop mode edits through undoable commands, with a density slider that never moves the curve more than asked, and versioned JSON for reopening stickers.

**Architecture:** `src/core/selection/` holds the immutable `Selection` types, `applyCommand` (one pure function over a discriminated union of command data), density re-simplification and JSON (de)serialization. `src/core/history/` keeps an array of selection snapshots plus an index; snapshots share unchanged rings and strokes by reference, and a point-count budget drops the oldest. Density reuses spec 0002's `toBezierSegments`, `simplifyPath` and `simplifyRing`.

**Tech Stack:** TypeScript 6.0 (strict), Vitest 5. No new dependencies (validation is hand-written).

**Spec:** `docs/specs/0003-selection-and-undo.md` (issues #20–#25)

## Global Constraints

- `src/core/` has no DOM, React or browser APIs (typecheck via `tsconfig.core.json` fails otherwise). Coordinates are image px floats, never rounded or clamped.
- Selections are immutable. Every command returns a new object and never mutates its input. Untouched rings and strokes stay `===`.
- Errors: `InvalidCommandError` (commands), `InvalidSelectionError` (parse, message names the field path), `UnsupportedSelectionVersionError` (`version` property).
- Limits: feather **[0, 3]**, soft-edge band **[2, 20]** px, density tolerance **[0.01, 8]** px, stroke `sizePx > 0`, hardness **[0, 1]**, ≥ 1 stroke point, ring ≥ 3 non-collinear nodes. History cap **250,000** points. Density sampling step ≤ **0.1** px. JSON `version` **1**.
- Test names `should_...` with the AC id; seeded randomness (`src/test/random.ts`); coverage of `src/core/` ≥ 90%. Timing tests go in `*.perf.test.ts`.
- Implementation branch `feat/21-25-selection-and-undo`; one commit per task (Conventional Commits).

## Review Focus

1. **Aliasing:** a caller mutates the `nodes` array or a `Point` it passed to `addRing`/`moveNode` afterwards. The selection must not change, so commands copy `{x, y, kind}` (Task 2).
2. **Bad indices:** negative, fractional (1.5) or `NaN` indices, an empty `refs` list, and refs naming the same node twice. Bad ones throw `InvalidCommandError`. An empty `refs` returns the same selection and records no history step (Tasks 2, 3).
3. **One huge step:** a single step bigger than the whole history cap (a 300,000-node ring with a cap of 250,000). It is kept, older steps are dropped, and undo still works (Task 3).
4. **Density edge cases and speed:** density on an all-corner ring, on a 3-node ring, and at the tolerance bounds 0.01 and 8. Also speed: a 300-node ring about 3,000 px around must finish in < 100 ms so the slider feels live (Task 4, perf test).
5. **JSON edge cases:** `-0` (JSON writes `0`; normalised and documented), floats like `1e-300` and `0.1 + 0.2`, unknown extra fields (ignored), and a ring whose 3 nodes are collinear (rejected like `addRing`) (Task 5).

---

### Task 1: Selection model (#21)

**Files:**
- Create: `src/core/selection/types.ts`, `src/core/selection/errors.ts`, `src/core/selection/model.ts`
- Modify: `src/core/geometry/polygon.ts` (export `isDegenerateRing`, replacing the private `isDegenerate`)
- Test: `src/core/selection/model.test.ts`, `src/core/geometry/polygon.test.ts` (one added test)

**Interfaces:**
- Consumes: `Point`, `Node`, `Size` (`geometry/types.ts`)
- Produces: the `Ring`, `BrushStroke`, `SoftEdge`, `Selection`, `NodeRef` and `Command` types exactly as in the spec Contract. Also `emptySelection(): Selection`, `InvalidCommandError`, `InvalidSelectionError`, `UnsupportedSelectionVersionError` (constructor `(version: unknown)`), and `isDegenerateRing(ring: readonly Point[]): boolean`.

- [ ] **Step 1: Write the failing tests**
  - `should_start_empty` (AC-1): `emptySelection()` equals `{ rings: [], strokes: [], feather: 0 }` and has no `softEdge` key. Two calls return distinct objects.
  - `should_hold_rings_soft_edge_strokes_and_feather` (AC-2): build a literal `Selection` with two rings (add, subtract), a soft edge, one stroke and feather 1.5. Assert the fields read back with node coordinates exact, for example `{ x: -0.375, y: 4032.0625 }` outside the image.
  - `should_detect_degenerate_rings` (polygon.test, AC-13 support): `[]`, 2 points, 3 collinear points and 3 identical points are degenerate. A triangle and a figure-8 are not.
  - `should_carry_the_found_version` (AC-27 support): `new UnsupportedSelectionVersionError(7).version === 7`, and it is `instanceof Error`.
- [ ] **Step 2: Run** `npx vitest run src/core/selection src/core/geometry/polygon` — Expected: FAIL (modules or exports missing).
- [ ] **Step 3: Implement.** Use `readonly` arrays in every type. Error classes set `override name`. `contains` now calls the exported `isDegenerateRing`.
- [ ] **Step 4: Run** the Step 2 command, then `npm run lint && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add selection model types`

---

### Task 2: Edit commands (#22)

**Files:**
- Create: `src/core/selection/commands.ts`
- Test: `src/core/selection/commands.test.ts`

**Interfaces:**
- Consumes: Task 1 types and errors, `isDegenerateRing`
- Produces: `applyCommand(selection: Selection, command: Command): Selection`. `setDensity` throws `InvalidCommandError('setDensity is not implemented')` until Task 4 replaces it. A command that changes nothing (empty `refs`, or a `delta` of `{0, 0}`) returns the **same** selection object.

- [ ] **Step 1: Write the failing tests**
  - Fixtures: `square` (4 corner nodes), `tri`, and a selection with two rings plus one stroke.
  - Helper `expectUnchanged(before, after)`: checks a `structuredClone` taken before the command against the input after it.
  - One `should_...` per AC, each asserting the exact resulting nodes:
    - `should_move_one_node_and_keep_its_kind` (AC-4)
    - `should_move_referenced_nodes_once_across_rings` (AC-5)
    - `should_nudge_like_move_nodes` (AC-6)
    - `should_insert_after_a_node_with_wrap_and_default_smooth_kind` (AC-7): insert after the last node goes between the last and node 0, appended at the end.
    - `should_delete_a_node_and_remove_rings_left_below_3` (AC-8)
    - `should_toggle_corner_and_smooth` (AC-9)
    - `should_append_add_and_subtract_rings_in_order` (AC-10)
    - `should_add_strokes_and_set_feather_and_soft_edge` (AC-11): also `setSoftEdge(null)` removes the key.
  - `should_not_mutate_input_and_share_untouched_rings` (AC-3): for one command of every type, `expectUnchanged` holds and the untouched ring is `===` in the result.
  - `should_copy_caller_data` (Review Focus 1): mutate the passed `nodes` array, a passed node and `to` after the call. The result is unchanged.
  - `should_reject_bad_indices_and_non_finite_values` (AC-12, Review Focus 2): an `it.each` table over -1, 1.5, `NaN`, out-of-range ring and node indices, `NaN` in `to`/`delta`/`point`, and `Infinity`. Each throws `InvalidCommandError`, and `expectUnchanged` holds.
  - `should_reject_degenerate_new_rings` (AC-13): 2 nodes, 3 collinear nodes, and a back-and-forth lasso.
  - `should_reject_out_of_range_feather_band_and_strokes` (AC-14): feather -0.1 and 3.1, band 1.9 and 20.1, size 0, hardness 1.1, empty points. The bounds 0, 3, 2, 20 and 1 are accepted.
  - `should_return_the_same_selection_for_no_op_commands` (Review Focus 2): empty refs and a zero delta give `toBe(input)`.
- [ ] **Step 2: Run** `npx vitest run src/core/selection/commands` — Expected: FAIL.
- [ ] **Step 3: Implement** with one `switch` over `command.type`. Write small `ringAt`/`nodeAt` guards (integer, in range) that throw `InvalidCommandError`, and `copyNode`/`copyPoint` helpers that check `Number.isFinite`. Use exhaustive `never` checking.
- [ ] **Step 4: Run** the Step 2 command, then `npm run lint && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add selection edit commands`

---

### Task 3: History (#23)

**Files:**
- Create: `src/core/history/history.ts`
- Test: `src/core/history/history.test.ts`

**Interfaces:**
- Consumes: `Selection`, `Command`, `applyCommand` (Task 2)
- Produces: `createHistory(initial: Selection, options?: { maxPoints?: number })` returning `{ readonly current; readonly canUndo; readonly canRedo; execute(command): Selection; undo(): Selection; redo(): Selection }`, and `DEFAULT_HISTORY_MAX_POINTS = 250_000`. Calling `undo` at the start or `redo` at the end returns `current` unchanged.

- [ ] **Step 1: Write the failing tests**
  - `should_round_trip_every_command_type_through_undo_and_redo` (AC-15): an `it.each` over one command of each type (every type except `setDensity`, which Task 4 adds to this table). Check execute, then undo (`toEqual` the original), then redo (`toEqual` the applied result).
  - `should_undo_and_redo_a_sequence` (AC-16): 5 commands. Undo all, checking each intermediate state deep-equal to a reference list, then redo all. Check `canUndo`/`canRedo` at both ends.
  - `should_discard_the_redo_branch_on_a_new_command` (AC-17).
  - `should_ignore_throwing_and_no_op_commands` (AC-18): after a throwing command, `current` and `canRedo` are unchanged. A no-op command does not add an undo step (undo goes back past it to the earlier state).
  - `should_drop_the_oldest_steps_beyond_the_point_cap` (AC-19): with `maxPoints: 100`, 10 `addRing` commands of 30 nodes each leave exactly the last 3 undoable and keep `current`.
  - `should_keep_a_single_step_larger_than_the_cap` (Review Focus 3): `maxPoints: 1000` and a 5,000-node ring. Undo still returns the empty selection.
  - `should_undo_and_redo_without_replaying` (AC-20): execute 1,000 `moveNode` commands and keep each returned selection. Every `undo()` and `redo()` must return the **same object** (`toBe`) that `execute` returned for that step. A replay would build new objects.
- [ ] **Step 2: Run** `npx vitest run src/core/history` — Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `states: Selection[]`, `index`, `costs: number[]`, `total`.
  - **Step cost:** the points (nodes plus stroke points) of rings and strokes in the new state that are not present by identity (a `Set` of the previous state's ring and stroke objects).
  - **Base cost:** `states[0]` costs its full point count.
  - **Execute:** truncate after `index`, push, then drop from the front while `total > maxPoints` and `index > 0`. When dropping, recompute the new base's full cost.
- [ ] **Step 4: Run** the Step 2 command, then `npm run lint && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add undo/redo history with a memory cap`

---

### Task 4: Dot density (#24)

**Files:**
- Modify: `src/core/geometry/bezier.ts` (add `sampleSegment`), `src/core/selection/commands.ts` (wire `setDensity`), `src/core/history/history.test.ts` (add `setDensity` to the AC-15 table)
- Create: `src/core/selection/density.ts`
- Test: `src/core/geometry/bezier.test.ts` (added tests), `src/core/selection/density.test.ts`, `src/core/selection/density.perf.test.ts`

**Interfaces:**
- Consumes: `toBezierSegments`, `pointOnSegment`, `simplifyPath`, `simplifyRing` (spec 0002); `applyCommand` (Task 2)
- Produces:
  - `sampleSegment(seg: BezierSegment, maxStepPx: number): Point[]`. It includes `p0` and `p3` exactly, and consecutive samples are ≤ `maxStepPx` apart.
  - `resimplifyRing(nodes: readonly Node[], tolerancePx: number): Node[]` in `density.ts`.
  - `DENSITY_SAMPLE_STEP = 0.1`.

- [ ] **Step 1: Write the failing tests**
  - `should_sample_a_segment_with_bounded_steps_and_exact_ends` (bezier.test): random seeded segments, including a fast-then-slow one where `c1` is near `p0` and `c2` far away. Assert the step bound and the exact ends.
  - `should_keep_the_curve_within_tolerance_both_ways` (AC-21). Measure with a test-local `hausdorffBothWays(oldNodes, newNodes)`: sample both curves with `sampleSegment` at 0.05, then take each sample's distance to the other sample polyline. Assert ≤ tolerance.
  - `should_give_fewer_and_more_dots` (AC-22): 64 smooth nodes, r = 200. A tolerance of 2 gives `< 64`; 0.01 gives `> 64`.
  - `should_keep_every_corner` (AC-23): a rounded rectangle with 4 corners and 20 smooth nodes.
  - `should_reject_bad_tolerance_and_skip_no_op_density` (AC-24): 0.009, 8.01, `NaN` and `Infinity` throw. If the result equals the current nodes, the command returns the same selection.
  - `should_hold_the_tolerance_for_random_rings` (AC-25): 50 seeded rings (8–40 nodes, mixed kinds, radius 20–400 with ±30% radial wobble), tolerance seeded in [0.25, 4]. AC-21 holds.
  - Edge cases (Review Focus 4): an all-corner ring returns its corners unchanged; a 3-node ring returns ≥ 3 nodes; tolerances 0.01 and 8 both work.
  - `density.perf.test.ts`: a 300-node ring about 3,000 px around runs in < 100 ms, best of 5.
- [ ] **Step 2: Run** `npx vitest run src/core/selection/density src/core/geometry/bezier` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`sampleSegment`:** `n = ceil(3 · maxLeg / maxStepPx)`, uniform in t. `maxLeg` is the longest control-polygon leg; `|B′(t)| ≤ 3 · maxLeg`, which bounds the step. Set the last sample to `p3` exactly.
  - **Dense samples:** `resimplifyRing` samples the old curve at `DENSITY_SAMPLE_STEP`, keeping each sample's index in the dense sequence.
  - **Pick dots:**
    - **No corners:** use `simplifyRing(dense, tol)`.
    - **Corners present:** split the dense sequence at the corners and run `simplifyPath` on each span, so the corners stay as endpoints.
    - Kept corners stay `corner`; every other kept sample becomes `smooth`.
  - **Repair loop:** build the new curve, sample it, and check both directions with a uniform grid over polyline segments (cell size `max(tol, 1)`). For every gap between consecutive new nodes that contains a violation, insert the dense sample with the largest violation in that gap. Repeat until no violations remain. Stop if every dense sample is already a node.
  - **Wire `setDensity`:** check the tolerance range, then compare the result against the current nodes (same length and coordinates) for the no-op rule.
- [ ] **Step 4: Run** the Step 2 command, `npx vitest run src/core/history`, `npm run test:perf`, `npm run lint` and `npm run typecheck` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(core): add dot density re-simplification`

---

### Task 5: Serialization (#25)

**Files:**
- Create: `src/core/selection/serialize.ts`, `src/core/selection/index.ts` (re-exports)
- Test: `src/core/selection/serialize.test.ts`

**Interfaces:**
- Consumes: Task 1 types and errors, `isDegenerateRing`
- Produces: `serializeSelection(selection: Selection, imageSize: Size): string`, `parseSelection(json: string): { selection: Selection; imageSize: Size }`, `SELECTION_FORMAT_VERSION = 1`

- [ ] **Step 1: Write the failing tests**
  - `should_round_trip_bit_exact` (AC-26): seeded random selections with rings, strokes, a soft edge with and without, and awkward floats (`0.1 + 0.2`, `1e-300`, `4032.000000001`). Assert `toEqual` and `Object.is` per coordinate.
  - `should_normalise_negative_zero` (Review Focus 5): `-0` comes back as `0` (documented in a code comment).
  - `should_reject_unknown_versions` (AC-27): versions 0, 2, `"1"` and a missing version throw `UnsupportedSelectionVersionError` with `.version` equal to the value found (`undefined` when missing).
  - `should_reject_malformed_documents_with_the_field_path` (AC-28): an `it.each` table of `[mutation, expected path]`, for example a non-JSON string → `$`, `rings[0].nodes[1].x = "3"` → `rings[0].nodes[1].x`, op `"union"`, kind `"round"`, a ring with 2 nodes, a collinear ring, `feather: 9`, a missing `strokes` and `imageSize.width: 0`. Each throws `InvalidSelectionError` whose message contains the path.
  - `should_ignore_unknown_extra_fields` (Review Focus 5).
  - `should_return_the_image_size` (AC-29).
- [ ] **Step 2: Run** `npx vitest run src/core/selection/serialize` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Serialize:** `JSON.stringify` of `{ version, imageSize, selection }`, omitting `softEdge` when absent.
  - **Parse:** write small typed readers (`readNumber(v, path)`, `readEnum`, `readArray`) that throw `InvalidSelectionError(path + ': ' + reason)`.
  - **Shared validation:** ring and stroke rules reuse the same limits as the commands. Export the limits from `commands.ts` as constants so both files use the same values.
  - **Version check:** check `version` before anything else.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm run test:coverage && npm run test:perf` — Expected: all PASS, `src/core/` coverage ≥ 90%.
- [ ] **Step 5: Commit** `feat(core): add versioned selection JSON`

---

### Done when
All five tasks are committed, CI is green, spec 0003 is set to Implemented in the same PR, and the PR has `Closes #20` … `#25` (one line each).
