# 0003 — Selection model, edit commands, undo/redo, density, serialization

- **Status:** Implemented
- **Issues:** story #20; tasks #21 (model), #22 (edit commands), #23 (history), #24 (density), #25 (serialization)
- **Plan reference:** §3 (crop modes), §3.2 (dots), §3.6 (undo), §4 (selection model), §8 (saved selections), Phase 2
- **Code:** `src/core/selection/`, `src/core/history/`. Pure TypeScript, no DOM imports. All coordinates are imagePts (image pixels, float, y down).

## Why
Every crop mode (Auto, Lasso, Dots, Brush) edits **one shared selection**, so a cut can be started in one mode and finished in another. A user fixing a shoulder dot by dot has to be able to undo any mistake without losing the work before it. The selection is saved with each sticker so it can be reopened and refined later rather than redone. The product exists because existing tools were imprecise, so no operation may shift the outline by more than the user asked for.

## Conventions
- Builds on spec 0002: `Point`, `Node {x, y, kind}`, rings with implicit closure.
- A **selection is immutable.** Every edit returns a new `Selection` and never mutates its input. Unchanged rings and strokes are shared by reference (structural sharing).
- A **command** is plain data (`{ type: 'moveNode', ... }`). `applyCommand(selection, command)` is a pure function. Commands reference rings and nodes by index.
- **Undo restores snapshots.** The history keeps the selection as it was before and after each command, not inverse operations. Undo is therefore exact by construction.
- A **drag is one command.** The UI previews the drag without touching history and commits a single `moveNode`/`moveNodes` when the finger lifts.

## What

### Selection model (#21)
- **AC-1** Given `emptySelection()`, then it has no rings, no strokes, no soft edge and feather 0.
- **AC-2** Given a selection, then it holds `rings: Ring[]` (each `{ op: 'add' | 'subtract', nodes: Node[] }`), an optional `softEdge: { source: 'model' | 'guided', bandPx }`, `strokes: BrushStroke[]` and `feather` (0–3 px). Node coordinates are image px floats, stored exactly as given: no rounding, no clamping to the image bounds, because dots may sit slightly outside the photo to cover edge pixels.
- **AC-3** Given any command applied to a selection, then the input selection, its rings and its nodes are unchanged (checked against a deep copy taken before), and rings the command did not touch are the same objects (`===`) in the result.

### Edit commands (#22)
- **AC-4** `moveNode(ring, node, to)` sets that node's position; its kind is unchanged.
- **AC-5** `moveNodes(refs, delta)` moves every referenced node by `delta`, across one or several rings. A node referenced twice moves once.
- **AC-6** `nudge(refs, dx, dy)` is `moveNodes` labelled for the nudge pad (one step per tap, typically 1 image px).
- **AC-7** `insertNode(ring, afterNode, point, kind = 'smooth')` inserts a node between `afterNode` and the next node (wrapping after the last), at exactly `point`.
- **AC-8** `deleteNode(ring, node)` removes the node. If the ring would be left with fewer than 3 nodes, the whole ring is removed.
- **AC-9** `toggleKind(ring, node)` switches the node between `corner` and `smooth`.
- **AC-10** `addRing(nodes)` and `subtractRing(nodes)` append a ring with op `add` or `subtract`. Rings are kept in the order added (the renderer composes them in order).
- **AC-11** `addStroke(stroke)` appends a brush stroke; `setFeather(px)` sets feather; `setSoftEdge(softEdge | null)` sets or clears the soft edge.
- **AC-12** Given a command with an out-of-range ring or node index, or a non-finite coordinate or delta, then it throws `InvalidCommandError` and nothing changes.
- **AC-13** Given `addRing`/`subtractRing` with fewer than 3 nodes, or with all nodes on one line (for example a back-and-forth lasso), then it throws `InvalidCommandError`; the UI shows a message instead of creating an empty ring.
- **AC-14** Given `setFeather` outside [0, 3], `setSoftEdge` with `bandPx` outside [2, 20], or a stroke with non-positive size, hardness outside [0, 1] or no points, then it throws `InvalidCommandError`.
- **AC-15** For every command type: apply then undo gives a selection deep-equal to the original, and redo gives one deep-equal to the applied result.

### History (#23)
- **AC-16** Given a sequence of commands, when undoing all of them and redoing all of them, then each step returns exactly the state at that point (deep-equal), and `canUndo`/`canRedo` report correctly at both ends.
- **AC-17** Given some undone steps, when a new command is executed, then the redo branch is discarded (`canRedo` is false).
- **AC-18** Given a command that throws, then history and current state are unchanged. Given a command that changes nothing (it returns the same selection), then no step is recorded.
- **AC-19** Given a memory cap expressed in stored points (nodes plus brush-stroke points that a step does not share with its neighbour), when the history exceeds it, then the oldest steps are dropped first. The newest steps and the current state are always kept, even when one step alone exceeds the cap. Default cap: **250,000 points** (about 12 MB).
- **AC-20** Given 1,000 commands, then undo and redo are each O(1) (no replaying of commands).

### Dot density (#24)
`setDensity(ring, tolerancePx)` recomputes the ring's dots from its current curve. Corner nodes are always kept as dots. The other new dots are smooth.
- **AC-21** Given a ring and a tolerance, then the new outline deviates from the old one by at most the tolerance in both directions. Every point sampled along the old curve (at most every 0.1 image px) lies within the tolerance of the new curve, and every point sampled along the new curve lies within the tolerance of the old one. This is checked on the drawn curves (Béziers), not just the dots.
- **AC-22** Given a ring of 64 smooth nodes on a circle of radius 200, then a tolerance of 2 px gives fewer than 64 dots and a tolerance of 0.01 px gives more than 64 (the slider gives fewer *and* more dots).
- **AC-23** Given a ring with corner nodes, then every corner node is still present in the result, at the same position and still a corner.
- **AC-24** Given a tolerance that is non-finite or outside [0.01, 8] px, then it throws `InvalidCommandError`. A ring whose result would equal its current nodes records no history step.
- **AC-25** Property test (seeded): for 50 random rings and tolerances in [0.25, 4], AC-21 holds.

### Serialization (#25)
- **AC-26** Given any selection and the image size, when serializing to JSON and parsing it back, then the result is deep-equal to the original, with float coordinates bit-exact.
- **AC-27** Given JSON with a `version` other than 1, then parsing throws `UnsupportedSelectionVersionError`, whose `version` property holds the value found.
- **AC-28** Given malformed JSON (not JSON, a missing field, a wrong type, a non-finite number, a ring with fewer than 3 nodes, an unknown op/kind/mode), then parsing throws `InvalidSelectionError` with a message naming the bad field path (for example `rings[2].nodes[5].x`). It never returns a partial selection.
- **AC-29** Given the parsed document, then `imageSize` is returned alongside the selection so the loader can detect an image whose size changed.

## Contract
```ts
// src/core/selection
interface Ring { op: 'add' | 'subtract'; nodes: readonly Node[] }
interface BrushStroke { mode: 'erase' | 'restore'; sizePx: number; hardness: number; points: readonly Point[] }
interface SoftEdge { source: 'model' | 'guided'; bandPx: number }
interface Selection { rings: readonly Ring[]; softEdge?: SoftEdge; strokes: readonly BrushStroke[]; feather: number }
emptySelection(): Selection
type NodeRef = { ring: number; node: number }
type Command =
  | { type: 'moveNode'; ring: number; node: number; to: Point }
  | { type: 'moveNodes' | 'nudge'; refs: readonly NodeRef[]; delta: Point }
  | { type: 'insertNode'; ring: number; afterNode: number; point: Point; kind?: Node['kind'] }
  | { type: 'deleteNode' | 'toggleKind'; ring: number; node: number }
  | { type: 'addRing' | 'subtractRing'; nodes: readonly Node[] }
  | { type: 'setDensity'; ring: number; tolerancePx: number }
  | { type: 'addStroke'; stroke: BrushStroke }
  | { type: 'setFeather'; px: number }
  | { type: 'setSoftEdge'; softEdge: SoftEdge | null }
applyCommand(selection, command): Selection          // throws InvalidCommandError
class InvalidCommandError extends Error {}
serializeSelection(selection, imageSize: Size): string
parseSelection(json: string): { selection: Selection; imageSize: Size }
class InvalidSelectionError extends Error {}           // message includes the field path
class UnsupportedSelectionVersionError extends Error { version: unknown }

// src/core/history
createHistory(initial: Selection, options?: { maxPoints?: number }): {
  readonly current: Selection; readonly canUndo: boolean; readonly canRedo: boolean
  execute(command: Command): Selection; undo(): Selection; redo(): Selection
}
DEFAULT_HISTORY_MAX_POINTS = 250_000

// src/core/geometry (helper used by density)
sampleSegment(segment, maxStepPx): Point[]            // points along a Bézier, consecutive samples ≤ maxStepPx apart
isDegenerateRing(ring): boolean                       // < 3 points or all on one line (already used by contains)
```

## Data
Selection JSON, version 1:
```json
{ "version": 1,
  "imageSize": { "width": 4032, "height": 3024 },
  "selection": { "rings": [{ "op": "add", "nodes": [{ "x": 10.25, "y": 3.5, "kind": "corner" }] }],
                 "softEdge": { "source": "model", "bandPx": 6 },
                 "strokes": [{ "mode": "erase", "sizePx": 10, "hardness": 0.8, "points": [{ "x": 1, "y": 2 }] }],
                 "feather": 0.5 } }
```
`softEdge` is omitted when absent. The model's soft alpha raster is **not** in this JSON; the storage layer (Phase 7) saves it next to the sticker. Future versions add a migration `vN → vN+1`; version 1 has none.

## Out of scope
Rendering the selection to a mask (Phase 3), contour tracing (Phase 4), the model's soft-mask raster storage (Phase 7), the UI (Phase 8): node selection state, drag preview, slider and nudge-pad widgets, "reset to auto result" (Phase 6). Rotating or scaling a whole ring, and multi-ring boolean simplification.

Carried to the UI/input specs (rulings from Phase 1): the DOM pointer adapter rejects non-finite samples, and calls `reset()` on the gesture machine on blur or `visibilitychange`.

## Calls made by the author (please check)
1. **Undo by snapshots, not inverse commands.** Undo is exact by construction and cannot drift. Memory is bounded by counting the points each step does not share with its neighbour (AC-19), with a cap of 250,000 points (about 12 MB) to stay well inside iPhone Safari's memory alongside 12 MP image buffers.
2. **Commands reference rings and nodes by index.** Indices shift when rings or nodes are removed. The UI re-derives its selected dots after each command (Phase 8).
3. **Density works from the current curve, keeps every corner, and guarantees the deviation on the drawn curve** (AC-21), not just between dots. This means extra dots are added until the curve itself is within tolerance. One slider session (finger down to finger up) becomes one command computed from the curve at the start, so repeated slider moves can't drift.
4. **Rings are kept and rendered in order.** A subtract ring removes only what was added before it. Ring direction (cw/ccw) doesn't matter.
5. **Inserting a smooth dot on an edge can move the neighbouring curve slightly**, because Catmull-Rom refits through the new dot. The dot itself lands exactly where tapped, and undo restores the previous shape.
6. **Out-of-range values throw rather than clamp** (feather, band, tolerance, stroke). The UI widgets clamp; core rejects bad data loudly.
7. **The selection JSON stores the image size**, so reopening a sticker against a resized image can be detected rather than silently misaligned.
