# Material hatch PATTERN — editable per-material angle/spacing

**Status:** Design approved (2026-05-28). Goes to writing-plans next.

## Why

`MaterialEntry.hatchAngleDeg?` / `hatchSpacingMm?` already exist (optional, `packages/shared/src/material.ts:10–11`), `getHatchSpec` reads them with `45°/3mm` fallback, and `projectSectionView` already plumbs a per-face `getHatchSpec` callback at all three call sites (`AddSectionViewCommand` full/half + stepped, `regenerateSectionView`). Three renderers (canvas/SVG/DXF) draw the pre-baked segments untouched.

Yet **no material anywhere in the codebase sets these fields** and the **`MaterialRegistryEditor` UI has no controls for them**. Worse, for single-PART section views the kernel stamps `materialId: ''` on every face tag (`packages/kernel/src/section/cutBySectionPlane.ts:226/231/234/304/674`) so the existing `hatchLookup` always misses and returns the default — only ASSEMBLY-sourced sections (where the kernel rewrites `materialId` to `partId → materials[0].id` at lines 392/443) get per-material lookup. As a result, every section view today renders 45°/3mm regardless of any material settings. Different materials look identical in section — the engineering-drawing convention is dormant for both data and wiring (in the single-part case).

This feature makes the dormant fields settable AND extends the single-part hatchLookup with a `materials[0]` fallback symmetric to the existing color-feature fallback (`colorForFace` falls back to `state.activePart?.materials?.[0]?.color` when the per-component override isn't present).

## Scope (surgical)

Add **"Hatch angle (°)"** and **"Hatch spacing (mm)"** inputs to `MaterialRegistryEditor`'s **edit-row form only** (Add form stays minimal; new materials inherit the default until edited). Two new table columns. Pair them as a both-or-neither override with a `clearHatch` flag, mirroring the existing `Sheet L/W` + `clearSheetStock` pattern exactly. **Plus** extend the three `hatchLookup` definitions (`AddSectionViewCommand` full/half + stepped + `regenerateSectionView`) with a `materials[0]` fallback when `materialId === ''`, mirroring the color feature's part-source fallback. No manifest bump, no renderer change, no `AddMaterialCommand` change.

### Premise refinements (vs the seed brainstorm)

1. **No seed catalog.** Materials start with an empty registry (`materials: []` in `newPart()` + v9→v10 migration); the "seed sensible defaults per material" half of the original seed has nothing to attach to. Feature collapses to editable fields. Per-material auto-distinct-on-create and name-keyword presets were both rejected in brainstorming.
2. **Part-source projection only LOOKS wired.** Each of the three call sites does build `hatchLookup` from `state.activePart?.materials ?? state.activeAssembly?.materials ?? []`, but the kernel's single-part cut paths leave `materialId: ''` on every face tag, so `hatchLookup('')` never finds a match. For ASSEMBLY-source the kernel rewrites `materialId` to the component part's `materials[0].id`, so assembly lookup works as-is. The fix is a 1-line tweak per site: `materialId ? materials.find(…) : materials[0]`, exactly mirroring `colorForFace = state.activeDrawingSourceComponentColors?.[partId] ?? state.activePart?.materials?.[0]?.color`.

## Decisions (from brainstorming)

| Axis | Choice | Why |
|---|---|---|
| Seeding | **Editable fields only** | No fixed catalog to pre-seed; free-form names; auto-cycling introduces nondeterminism; keyword presets are fragile (team may use Ukrainian names). User sets per material; absent ⇒ default. |
| Pattern vocabulary | **Single direction (angle + spacing)** | Existing generator (`generateHatchSegments`) is single-direction; ANSI31-style; furniture rarely needs crosshatch. Two fields per material. |
| Where in UI | **Edit row only, not Add form** | Mirrors sheet stock precedent exactly; keeps Add minimal; new materials inherit default until intentionally overridden. |
| Pairing | **Both-or-neither pair with `clearHatch` flag** | Pattern override is conceptually one thing; gives clean clear-to-default semantics; gives correct undo/redo (the spread-merge reducer can't remove keys otherwise). |
| Validation | angle finite in **[0, 180)**; spacing finite **> 0** | Hatch angle is modulo 180 (a line is direction-less); spacing must be positive. |
| Manifest | **No bump** | Fields are already optional on `MaterialEntry` (`v10` added the `materials` array; subsequent versions are unrelated). Old materials without the fields keep working. |

## Files touched (5, all small)

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

4. **`packages/app/src/commands/AddSectionViewCommand.ts`** — 2 lines (full/half site + stepped site)
   - `AddSectionViewCommand.ts:138-140` and `:295-297` — change the `hatchLookup` body so empty `materialId` falls back to `materials[0]`: `const mat = materialId ? materials.find((m) => m.id === materialId) : materials[0];`. The `getHatchSpec(mat ?? synthetic)` line is unchanged.

5. **`packages/app/src/drawing/regenerateSectionView.ts`** — 1 line (lines 138-140)
   - Same edit as above. Same rationale.

### Files explicitly NOT touched

- `packages/shared/src/material.ts` — type already correct; `getHatchSpec` already correct; `isMaterialEntry` is intentionally left alone (it isn't on the load path per `restoreLastOpenDocument`/`unpackProject` audits, so adding validation there has no runtime effect and would be tangential to the request — §3 surgical).
- `packages/shared/src/drawing/projectSectionView.ts` — already calls `getHatchSpec` per face for both sources.
- `packages/shared/src/drawing/hatchGenerator.ts` (a.k.a. `generateHatchSegments`) — already consumes angle/spacing correctly (covered by existing material-hatch unit tests).
- `packages/kernel/src/section/cutBySectionPlane.ts` — the `materialId: ''` stamp is intentional kernel behavior; the fix lives in the APP layer's `hatchLookup` fallback so we don't perturb the kernel section API (which would impact assembly section + regen).
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

`tests/e2e/drawing/material-hatch-pattern.spec.ts` (new). Uses a SINGLE-PART section view to exercise the new `materials[0]` fallback path. Modeled on the existing material-hatch-color e2e's dev-hook usage but simpler (one part, one material, no manifest splicing needed).

Flow:
1. Boot the dev app and `buildBox` (30×30×20).
2. Via the bus: `AddMaterialCommand` (name, color), then `EditMaterialCommand` setting `hatchAngleDeg: 20, hatchSpacingMm: 2`. Read the resulting `activePart.materials[0]` — assert both fields landed.
3. Via the bus: `CreateDrawingCommand` (part source), `AddBaseViewCommand` (front), patch viewMatrix, `AddSectionViewCommand` (full mode, horizontal cut).
4. Read `hatchSegments` from the resulting section view. Compute each segment's line angle: `atan2(p1.y - p0.y, p1.x - p0.x) * 180/π`, normalized to `[0, 180)`. Assert every segment's angle ≈ **20° ± 2°**, and explicitly **NOT ≈ 45°**.
5. `await page.waitForTimeout(700)` (let the 500ms autosave debounce fire), then `page.reload()`. After `waitForKernelReady`, assert the restored part's `materials[0]` still has `hatchAngleDeg: 20, hatchSpacingMm: 2`.

**Teeth verification (per `feedback_verify_before_done_claim` + `feedback_plan_snippets_are_reference`):** before merging, temporarily back out the new `materials[0]` fallback in `hatchLookup` → e2e fails on step 4 (angle ≈ 45° instead of 20°). Restore. This proves the new fallback is what's making the test pass, not pre-existing wiring.

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
