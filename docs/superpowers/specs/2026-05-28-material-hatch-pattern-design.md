# Material hatch PATTERN — editable per-material angle/spacing

**Status:** Design approved (2026-05-28). Goes to writing-plans next.

## Why

`MaterialEntry.hatchAngleDeg?` / `hatchSpacingMm?` already exist (optional, `packages/shared/src/material.ts:10–11`), `getHatchSpec` reads them with `45°/3mm` fallback, and `projectSectionView` already plumbs a per-face `getHatchSpec` callback at all three call sites (`AddSectionViewCommand` full/half + stepped, `regenerateSectionView`) for **both** part-source and assembly-source views. Three renderers (canvas/SVG/DXF) draw the pre-baked segments untouched.

Yet **no material anywhere in the codebase sets these fields** and the **`MaterialRegistryEditor` UI has no controls for them**, so every section view falls back to the 45°/3mm default. Different materials therefore look identical in section — the engineering-drawing convention of distinguishing materials by hatch pattern is dormant.

This feature makes the dormant fields settable.

## Scope (surgical)

Add **"Hatch angle (°)"** and **"Hatch spacing (mm)"** inputs to `MaterialRegistryEditor`'s **edit-row form only** (Add form stays minimal; new materials inherit the default until edited). Two new table columns. Pair them as a both-or-neither override with a `clearHatch` flag, mirroring the existing `Sheet L/W` + `clearSheetStock` pattern exactly. No manifest bump, no renderer change, no projection change, no `AddMaterialCommand` change.

### Premise refinements (vs the seed brainstorm)

1. **No seed catalog.** Materials start with an empty registry (`materials: []` in `newPart()` + v9→v10 migration); the "seed sensible defaults per material" half of the original seed has nothing to attach to. Feature collapses to editable fields. Per-material auto-distinct-on-create and name-keyword presets were both rejected in brainstorming.
2. **Part-source already wired.** The premise's "decide whether to apply pattern to part-source hatch too" is moot — both `state.activePart?.materials ?? state.activeAssembly?.materials ?? []` lookups already exist at every section-projection call site.

## Decisions (from brainstorming)

| Axis | Choice | Why |
|---|---|---|
| Seeding | **Editable fields only** | No fixed catalog to pre-seed; free-form names; auto-cycling introduces nondeterminism; keyword presets are fragile (team may use Ukrainian names). User sets per material; absent ⇒ default. |
| Pattern vocabulary | **Single direction (angle + spacing)** | Existing generator (`generateHatchSegments`) is single-direction; ANSI31-style; furniture rarely needs crosshatch. Two fields per material. |
| Where in UI | **Edit row only, not Add form** | Mirrors sheet stock precedent exactly; keeps Add minimal; new materials inherit default until intentionally overridden. |
| Pairing | **Both-or-neither pair with `clearHatch` flag** | Pattern override is conceptually one thing; gives clean clear-to-default semantics; gives correct undo/redo (the spread-merge reducer can't remove keys otherwise). |
| Validation | angle finite in **[0, 180)**; spacing finite **> 0** | Hatch angle is modulo 180 (a line is direction-less); spacing must be positive. |
| Manifest | **No bump** | Fields are already optional on `MaterialEntry` (`v10` added the `materials` array; subsequent versions are unrelated). Old materials without the fields keep working. |

## Files touched (3, all small)

1. **`packages/app/src/shell/MaterialRegistryEditor.tsx`** — the only substantial change
   - Two new `<th>` between Sheet W and Actions: "Hatch angle (°)", "Hatch spacing (mm)".
   - `RowEditState.edit` gains `hatchAngleDeg: string; hatchSpacingMm: string`.
   - Two new `<input>`s in the edit row (text, numeric-mode, aria-labels "Edit hatch angle" / "Edit hatch spacing").
   - Two new read-only `<td>`s in the non-edit row: show `m.hatchAngleDeg ?? ''` / `m.hatchSpacingMm ?? ''`.
   - New `validateHatchPattern(angleStr, spacingStr)`:
     - both empty → `null`;
     - exactly one empty → `'Set both Hatch angle and Hatch spacing, or leave both empty.'`;
     - non-finite → `'Hatch angle/spacing must be numbers.'`;
     - angle outside `[0, 180)` → `'Hatch angle must be in [0, 180).'`;
     - spacing `<= 0` → `'Hatch spacing must be > 0.'`;
   - `onEditSubmit`: call `validateHatchPattern` after `validateSheetStock`; branch the `patch`:
     - both empty → `clearHatch: true` added;
     - both non-empty → `hatchAngleDeg: Number(...), hatchSpacingMm: Number(...)` added;
   - The Edit-button onClick that builds the initial `RowEditState.edit` now also seeds `hatchAngleDeg: m.hatchAngleDeg !== undefined ? String(m.hatchAngleDeg) : ''` and likewise for spacing.
   - Live `error` on `onChange` mirrors the existing sheet-stock pattern.
   - Confirm-delete row's `colSpan={6}` becomes `colSpan={8}`; the empty-state `colSpan={6}` becomes `colSpan={8}`.

2. **`packages/app/src/commands/EditMaterialCommand.ts`** — one line
   - `EditMaterialPatch` gains `clearHatch?: true;` next to `clearSheetStock?: true;`.
   - `apply()` / `revert()` paths unchanged: revert continues to re-apply the prev snapshot which (correctly) re-includes the previously-set hatch fields, or omits them if they were unset.

3. **`packages/app/src/store/useAppStore.ts`** — one line of TS in `updateMaterial`
   - Destructure `clearHatch` alongside `clearSheetStock`.
   - In the `applyPatch` reducer, after the existing `clearSheetStock` strip, mirror it for `clearHatch`: strip `hatchAngleDeg` and `hatchSpacingMm`.
   - Update the type on `updateMaterial` in the store interface (around line 283) to include `clearHatch?: true`.

### Files explicitly NOT touched

- `packages/shared/src/material.ts` — type already correct; `getHatchSpec` already correct; `isMaterialEntry` is intentionally left alone (it isn't on the load path per `restoreLastOpenDocument`/`unpackProject` audits, so adding validation there has no runtime effect and would be tangential to the request — §3 surgical).
- `packages/shared/src/drawing/projectSectionView.ts` — already calls `getHatchSpec` per face for both sources.
- `packages/shared/src/drawing/hatchGenerator.ts` (a.k.a. `generateHatchSegments`) — already consumes angle/spacing correctly (covered by existing material-hatch unit tests).
- `packages/app/src/commands/AddSectionViewCommand.ts` / `regenerateSectionView.ts` — `hatchLookup` already builds from `state.activePart?.materials ?? state.activeAssembly?.materials ?? []`.
- All 3 renderers (`ViewElement.tsx`, `renderDrawingSvg.ts`, `renderDrawingDxf.ts`) — draw pre-baked segments; nothing to change.
- `AddMaterialCommand.ts` / `AddMaterialOpts` — Add form stays minimal (sheet-stock precedent).

## Verification

### Unit (TDD, per CLAUDE.md §4a + `superpowers:test-driven-development`)

`packages/app/src/shell/__tests__/MaterialRegistryEditor.hatch.spec.tsx` (new):
- Renders **Hatch angle (°)** and **Hatch spacing (mm)** column headers.
- Read-only row shows existing values (or blank if absent).
- Edit row exposes two new inputs with the right aria-labels.
- Both-empty edit submit → bus receives `EditMaterialCommand` whose patch contains `clearHatch: true` and **no** `hatchAngleDeg`/`hatchSpacingMm`.
- Both-set valid edit submit → patch contains numeric `hatchAngleDeg` + `hatchSpacingMm` and **no** `clearHatch`.
- Half-pair edit → inline error, no bus call.
- Out-of-range angle (e.g. `200`) → inline error, no bus call.
- Non-positive spacing (e.g. `0` or `-3`) → inline error, no bus call.
- Pre-fills both fields when entering edit (verifying the seeding line).

`packages/app/src/store/__tests__/updateMaterial-clearHatch.spec.ts` (new):
- Material has `hatchAngleDeg: 30, hatchSpacingMm: 2`.
- `updateMaterial(id, { clearHatch: true })` → resulting material lacks both keys (strict — assert `'hatchAngleDeg' in m === false`, not just `m.hatchAngleDeg === undefined`).
- Round-trip: setting `hatchAngleDeg: 60, hatchSpacingMm: 4` lands both keys; then `clearHatch: true` removes both; combined `{ name: 'x', clearHatch: true }` updates name + clears hatch atomically.

`packages/app/src/commands/__tests__/EditMaterialCommand.hatch.spec.ts` (new):
- `EditMaterialPatch` type accepts `clearHatch` (compile-only assertion via a small type test, or via runtime `apply` exercise).
- Apply → revert restores prior hatch state (covers both "had-hatch ⇒ cleared ⇒ restored" and "no-hatch ⇒ set ⇒ unset on revert").
  - Note the latent pre-existing limitation of revert's spread-merge (can't remove keys absent from prev) — for our case revert continues to call `updateMaterial` with the prev snapshot's full rest object. To make revert correct for the "no-hatch ⇒ set" case we must ensure that path emits `clearHatch: true` when prev lacked the keys. **Implementer task: handle this in `revert()` — if `this.prev` is missing EITHER `hatchAngleDeg` OR `hatchSpacingMm` (i.e. not the full pair), pass `{ ...rest, clearHatch: true }` so the spread doesn't leak any newly-set keys.** (Sheet-stock has the same latent bug; we are NOT fixing it here, but we ARE getting our new field right from the start.)

### Real-environment e2e (CLAUDE.md §6, gate per `next_session_resume.md`)

`tests/e2e/material-hatch-pattern.e2e.ts` (new), modeled on the existing material-hatch-color e2e:

Flow:
1. Boot the dev app, create/open a part with at least one section-cutting box face.
2. Open the Material Registry editor; edit the existing material; set Hatch angle to **20°**, Hatch spacing to **2 mm**; Save.
3. Create a section view through that material via the existing AddSectionView UI path.
4. Read the resulting projected section's `hatchSegments` out of `window.__zilventorStore`. Compute the **angle of the first segment**: `atan2(p1.y - p0.y, p1.x - p0.x)`; assert close to **20°** (mod 180°) with a small tolerance — **NOT 45°**.
5. Compute the perpendicular spacing between adjacent parallel segments; assert close to **2 mm** — NOT 3 mm.
6. Save the part to disk, reload the app, re-open the file, re-read the material: hatch fields persist as 20 / 2.
7. Open the Material Registry, edit, clear both hatch fields; Save; re-create section; assert angle ≈ 45° again (default restored).

**Teeth verification (per `feedback_verify_before_done_claim` + `feedback_plan_snippets_are_reference`):** before merging, temporarily back out the `hatchLookup` wiring (e.g. replace it with the default-only callback) → e2e fails on step 4 (angle ≈ 45° instead of 20°). Restore.

### Perf gate

No new perf concern — the change is UI/wiring; `generateHatchSegments` was already running per face. Existing material-hatch perf coverage applies. No new `tests/perf/` spec needed.

## Out of scope (explicitly deferred)

- Crosshatch / double-line patterns
- ANSI-standard preset library (cast iron, bronze, glass, etc.)
- Auto-distinct-on-create or name-keyword seeding
- Hatch in DXF 1:1 export (already an open DXF follow-up)
- `isMaterialEntry` hardening for the new fields
- Part-source vs assembly-source divergence — both work uniformly
- Fixing the latent EditMaterialCommand sheet-stock revert quirk (separate concern)

## Workflow gate

Per the standard chain: **brainstorming ✅** → writing-plans (next, with Sonnet verifier) → worktree → subagent-driven-development (Sonnet implementer per batch, controller trust-but-verify) → finishing-a-development-branch (FF merge, rewrite `next_session_resume.md`, write `project_material_hatch_pattern_feature.md`).
