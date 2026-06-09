# Sketch Dimension Inline-Edit — Design Spec

**Date:** 2026-06-09
**Status:** Approved (brainstorm complete)
**Track:** Tier-1 "Inventor 2012 parity for furniture" — 4th feature (after sketch slice 1 `08cf120`, slice 2 `91a795c`, assembly pattern+mirror `e1b5498`).
**Base:** master `91a795c` · manifest v20 (NO bump) · app-only.

## Summary

Double-click a sketch dimension label in the 2D sketcher → edit its numeric value inline → the constraint solver re-cascades and the geometry **visibly moves**. The edit is undoable via the command bus. This also makes slice-2's latent fillet-coincident drift-fix actually triggerable (no dimension-edit path existed before, so the coincident constraints it shipped were correct-but-dormant).

App-only. **NO new shared fields, NO kernel change, NO manifest bump (stays v20).**

## Grounding (verified against real code, not assumed)

- **Dimension model** (`packages/shared/src/constraints.ts:16-22`): `DimensionConstraint` discriminated union with 6 kinds — `dim-length`, `dim-distance`, `dim-angle`, `dim-radius`, `dim-diameter`, `dim-point-line-distance`. Each carries `value: DimensionValue = {kind:'literal', value:number} | {kind:'param', paramName:string}` plus a `paramName` slot. Stored directly in the sketch's `constraints` array.
- **The command already exists and is tested but UNWIRED from the UI**: `packages/app/src/commands/UpdateDimensionValueCommand.ts` — `constructor(sketchId, dimId, before:number, after:number, sketcherClient?)`, `apply()`/`revert()`. It is dead code from the UI side (never imported in `App.tsx`).
- **Solver path** (`packages/sketcher-worker/src/GcsSystem.ts:564`): `updateDimensionValue(id, resolvedValue): Promise<{dof: DofStatus, coords: PrimitiveCoordsDiff[]}>` → sets resolved value → `rebuildGcs()` (which calls `gcs.solve()`) → returns full coord diff. Exposed app-side via `SketcherClient.updateDimensionValue` (`packages/app/src/sketcher/SketcherClient.ts:38`) as a Comlink pass-through.
- **Coords reach the store via** `useAppStore.applyCoordDiff(sketchId, diff)` (`useAppStore.ts:1107`) → mutates `activePart.featureTree[n].primitives` → the `useEffect` at `App.tsx:1596-1605` re-renders `CommittedSketchRenderer`. Canonical trigger is the drag path: `SelectTool` → `onCoords` callback (`App.tsx:1194`) → `applyCoordDiff`.
- **THE GAP (load-bearing):** `UpdateDimensionValueCommand.apply()` calls `updateDimensionValueInStore` (patches only the dimension's number) and `await sketcherClient.updateDimensionValue(...)` but **discards the returned `{coords, dof}`** — so primitive coordinates are NOT patched and the canvas geometry will NOT move. The param-registry subscription path (`App.tsx:1379`, `void client.updateDimensionValue(...)`) has the **same** discard.
- **Open uncertainty (conf 78):** `AddDimensionCommand` (`AddDimensionCommand.ts:26-29`) has the identical discard pattern, yet adding a dimension presumably moves geometry — implying a possible secondary coord-propagation path. **Resolved empirically by the §6 browser gate**, not by assumption. If a secondary path exists, the fix may be redundant or must mirror that path; the implementer determines this in-browser before finalizing.
- **Inline-edit precedent to mirror**: `ParametersPanel.tsx:52` — `<span onDoubleClick={...}>` → `<input autoFocus>` with Enter/Esc/blur commit.
- **Glyph hit-testing**: `DimensionRenderer.tsx` SVG overlay; each `<g data-testid="dimension-glyph" style={{pointerEvents:'auto'}}>` already opts into pointer events but has NO handler today.

## Decisions (locked in brainstorm)

| Axis | Decision |
|---|---|
| Edit UI | **Inline `<input>`** over the label (mirror `ParametersPanel`); Enter/blur commit, Esc cancel. Fallback to `DimensionDialog` only if edge-clipping bites. |
| Param-bound dims | **Refuse inline edit**; show a toast/hint pointing to the Parameters panel. No silent linkage break. |
| Kinds in scope | **All 6 kinds** (the solver path is kind-agnostic). Angle edits/displays in the same unit `DimensionDialog` uses (degrees), converting deg↔rad at the boundary. |
| Value entry | **Plain number, validated.** Reject empty/NaN; reject ≤0 for radius/diameter/length. No expressions. |

## Behavior

### Trigger + pick
- Add `onDoubleClick` to each dimension glyph `<g>` in `DimensionRenderer.tsx`, carrying the dimension `id`, kind, and current resolved value.
- Literal dim → open inline editor at the glyph's screen position.
- `value.kind === 'param'` dim → toast: `Linked to parameter '<name>' — edit it in the Parameters panel.` No edit.

### Inline editor
- `<input autoFocus>` seeded with the current value (angle in degrees). Local component state; no store writes while typing.
- Enter / blur → validate + commit. Esc → cancel (revert, no dispatch).

### Validation
- Parse a plain number. Empty/NaN → invalid (stay in edit; no command).
- `dim-radius` / `dim-diameter` / `dim-length`: reject ≤0.
- `dim-angle`: any number; convert degrees→radians before dispatch (match `DimensionDialog`).
- Others (`dim-distance`, `dim-point-line-distance`): any number (matches add-dimension validation).

### Commit → command → solve → coords applied
- Dispatch `store.bus.execute(new UpdateDimensionValueCommand(sketchId, dimId, before, after, sketcherClient))`.
- **Fix the coord gap inside the command** (after confirming in-browser it's needed): capture `const result = await sketcherClient.updateDimensionValue(dimId, after)` then `applyCoordDiff(sketchId, result.coords)` + `setSketchDof(result.dof)`. Mirror in `revert()` with `before`.
- All 6 kinds flow through this single path.

## Architecture / units

- **`DimensionRenderer.tsx`** (changed) — gains double-click → calls an `onEditDimension(id)`-style dep; no business logic in the renderer.
- **Inline editor** — either a small sub-component in the overlay or local state in the renderer; owns its own input + key handling. Single purpose: capture a validated number for one dimension.
- **`UpdateDimensionValueCommand`** (changed) — gains coord-application on apply/revert. Unchanged constructor signature.
- **App wiring** — `App.tsx` provides the `onEditDimension` callback that reads current value, branches literal-vs-param, validates, and dispatches the command via the bus. Mirrors how fillet/chamfer edge-pick + dispatch were wired in slice 2.

## Testing

TDD, red→green per slice:
1. **Command coord-apply** — `UpdateDimensionValueCommand.apply()` calls `applyCoordDiff` with the solver's returned coords (fake client returns a known diff; assert store primitives moved + dof set). `revert()` restores. **This test must drive the real producer's return through the real consumer — not hand-author the diff into the store.**
2. **Validation** — empty/NaN rejected; ≤0 rejected for radius/diameter/length; angle deg→rad conversion correct; valid → dispatches with the right `after`.
3. **Param refuse** — `value.kind==='param'` → no dispatch, toast invoked.
4. **Double-click wiring** — glyph double-click invokes the edit callback with the right dim id (renderer-level test).
5. **e2e** — real-canvas: draw sketch with a radius + linear dim → double-click each → type new value → assert dimension value AND geometry updated; undo restores both.

### §6 browser gate (THE gate — non-negotiable)
Drive the real canvas in a browser:
- Edit a radius and a linear dimension; **confirm the geometry visibly moves** and the solver re-solves (this empirically resolves the conf-78 secondary-coord-path uncertainty — if geometry already moves WITHOUT the fix, re-scope; if not, the fix is confirmed load-bearing).
- Edit a fillet's radius and confirm slice-2's coincident drift-fix behaves (no gap/over-constraint).
- Read screenshots + store coords back. Unit/e2e green ≠ works-on-canvas (slice-2 lesson).

## Deferred (next slice)

- Param-bound dimension editing (write-through to `ParameterRegistry`, cascade to all linked dims) — fix that path's identical coord-discard too.
- Expression entry (`100/2`, `width-18`) via the ParametersPanel evaluation engine.
- Angle unit toggle (deg/rad).
- Edit via `DimensionDialog` as an alternative entry point.

## Risks

1. **Coord-apply gap may be covered by a secondary path** (`AddDimensionCommand` discards coords yet works). Browser gate settles it; do not assume the fix is needed OR redundant.
2. Inline input clipping near canvas edge → fall back to `DimensionDialog`.
3. Angle deg/rad round-trip mismatch with `DimensionDialog` → match its exact convention.
