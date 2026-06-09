# Param-bound dimension editing + expression entry — Design

**Date:** 2026-06-09
**Track:** Tier-1 "Inventor 2012 parity for furniture" (5th feature)
**Base:** master `c81f2de` (sketch dimension inline-edit)
**Manifest:** no bump (still v20) — no new shared fields, no kernel change.

## Goal

Double-clicking a sketch dimension edits it **regardless of kind**. Literal dims accept
constant arithmetic; param-bound dims edit the bound parameter's *expression* and cascade to
everything bound to that param — undoable, geometry visibly moves. This completes the
deferred item from the dimension inline-edit feature (param dims previously refused with a toast)
and fixes the pre-existing coord-discard bug in the param-change cascade.

## Context (audited code, 2026-06-09)

- **Dimension value type** (`packages/shared/src/constraints.ts:10-12`):
  `DimensionValue = { kind:'literal'; value:number } | { kind:'param'; paramName:string }`.
- **ParameterRegistry** (`packages/app/src/parameters/ParameterRegistry.ts`) — per-App singleton,
  rebuilt from `activePart.parameters` on part change. Holds `SketchParameter = {name, expression,
  value, unit:'mm'|'deg'}`. API: `setParameter(input)` (parses expression via `expr-eval`,
  evaluates, cascades, returns `Result`), `dryRun(input)` (validate w/o mutation), `getValue(name)`,
  `getAll()`, `subscribe(listener)`. Full expression engine: function whitelist
  (min/max/abs/sqrt/floor/ceil/round), cycle detection, var-references by name.
- **Two parallel param-edit paths today:**
  - `ParametersPanel` (sketch params) → `registry.setParameter()` **directly** → fires the subscribe
    cascade (App.tsx ~1310-1385: `store.setParameterInStore` + `kernel.setParameter` +
    `sketcherClient.updateDimensionValue` per param-bound dim). **Not undoable.**
  - `PropertiesPanel` (feature params) → `EditParameterCommand` → kernel + store, undoable, but
    **bypasses the registry/sketch cascade**.
- **Coord-discard bug** (`App.tsx:~1376-1384`): the param-change cascade does
  `void client.updateDimensionValue(dim.id, resolved)` — discards the solver's `{coords, dof}`, so a
  param edit re-solves but **sketch geometry never moves**. Same class as the bug fixed in
  `UpdateDimensionValueCommand` last feature. The subscribe effect already writes store + kernel,
  so **persistence is covered** — only the coord application is missing.
- Persistence: autosave reads `part.parameters` from kernel/store, both synced by the subscribe
  effect. Driving `registry.setParameter` is sufficient for cascade + persistence + geometry
  (once the coord-discard is fixed).

## Behavior

- **Literal dim** → editor seeded with the current number → accept a plain number *or* constant
  arithmetic (`100/2`, `2*30+5`) → evaluates to a literal number, stored as `{kind:'literal'}`. A
  param-name reference (`width-18`) is **rejected** with a toast ("references a parameter — bind it
  via the dimension dialog"). Existing `UpdateDimensionValueCommand` path, unchanged otherwise.
- **Param-bound dim** → editor seeded with the **parameter's expression** (e.g. `width-18`) → edit
  the formula (numbers, arithmetic, other param names) → commit writes the new expression through
  `registry.setParameter`, cascading to **all** dims/features bound to that param + re-solving their
  sketches. Undoable.
- **Invalid** → editor stays open, no dispatch, toast the reason:
  - Literal: empty/NaN, ≤0 for length/radius/diameter, or a param-ref.
  - Param: registry parse error / cycle / unknown var (use the registry's error message); or the
    evaluated value ≤0 when the dim kind ∈ {dim-length, dim-radius, dim-diameter}.
- **Esc** cancels.

## Units (each its own TDD slice)

1. **`parseDimensionInput` extension** (pure, `packages/app/src/sketcher/parseDimensionInput.ts`) —
   evaluate constant arithmetic via a local `expr-eval` `Parser` with an *empty* variable scope; if
   `expr.variables()` is non-empty → reject as a param-ref (distinct result so the caller can toast
   the bind hint). Preserve existing ≤0 (length/radius/diameter) and angle-as-degrees rules. Plain
   integers/decimals must still parse. Unit-tested.

2. **`UpdateParameterExpressionCommand`** (new, undoable, `packages/app/src/commands/`) — constructed
   with the full `before: SketchParameter` + `afterExpr: string` + the registry. `apply()` =
   `registry.setParameter({...before, expression: afterExpr})`; `revert()` =
   `registry.setParameter(before)`. Thin: the existing (bug-fixed) subscribe effect does
   store+kernel+solver. Preserves `unit`. Unit-tested by driving a real/fake registry and asserting
   the toggled expression on apply **and** revert (not hand-authored).

3. **Coord-discard fix** (load-bearing, `App.tsx:~1376-1384`) — change
   `void client.updateDimensionValue(dim.id, resolved)` to `await` the result and apply
   `applyCoordDiff(sketch.id, coords)` + `setSketchDof(dof)`, so sketch geometry moves on the new dim
   edit, on existing Parameters-panel edits, and on undo. (App effect → locked by e2e/§6, not a unit
   test.)

4. **App.tsx wiring** — `handleEditDimension` drops the param-refuse branch; seeds the editor with
   the number (literal) or the param's expression (param, read from `registry.getAll()`).
   `handleDimEditCommit` branches on `dim.value.kind`:
   - literal → `parseDimensionInput` → `UpdateDimensionValueCommand` (existing);
   - param → `registry.dryRun({...param, expression: typed})` validate + kind-aware ≤0 guard on the
     evaluated value → `UpdateParameterExpressionCommand`.

5. **`DimensionRenderer.tsx`** — both kinds now open the editor; remove/repurpose the param-refuse
   callback so param dims no longer short-circuit.

6. **e2e** (`tests/e2e/`) — real double-click a param-bound dim → type a new expression → assert
   **all** linked dims + geometry moved + survives save/reload + undo restores; plus a literal
   `100/2`→50 case.

## Out of scope

- Auto-promoting a literal dim to a parameter.
- Routing the Parameters / Properties panels through the new command (left untouched — surgical).
- Angle-unit toggle; `DimensionDialog` as an alternate edit entry point.
- The `EditParameterCommand` / PropertiesPanel feature-param path is not touched.

## Risks

- The coord-fix changes a shared effect both edit paths flow through — the §6 gate must confirm
  Parameters-panel edits still behave and that undo moves geometry back.
- A param drives multiple dims: editing one moves all of them (expected — it's a shared parameter).
- Manifest unchanged; params already serialize, so no migration.

## Success criteria

- Editing a param-bound dim's expression moves all linked geometry, persists across reload, and is
  undoable (verified in §6 browser + a real e2e).
- Literal dim accepts `100/2`→50; rejects `width-18` with a hint.
- Existing literal inline-edit + Parameters-panel edit still work (no regression).
- `npx tsc --noEmit` clean on touched files; full app suite green.
