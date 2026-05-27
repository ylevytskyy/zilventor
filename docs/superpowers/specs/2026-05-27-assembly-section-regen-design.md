# Assembly Section Cut — Pose-Aware, Components-Based (Create + Regen) — Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming)
**Manifest:** v19 — **no bump** (read-only geometry; `activeDrawingSourceComponents` is runtime-only, never serialized)

## Problem

Assembly-sourced section views are broken in two ways:

1. **Regenerate bails.** `regenerateSectionView.ts` throws `"Assembly section Regenerate is not yet supported — re-create the section view."` for assembly-sourced section views.
2. **Create is pose-blind (latent bug).** Both create and the would-be regen go through the kernel `api.ts` wrapper `cutAssemblyBySectionPlane(asmId, …)` (`packages/kernel/src/api.ts:446`), which **ignores the asmId** (`void asmId`, line 482) and dumps **all** cached part shapes into one compound at their **local origins, with no pose applied** (line 455). namedShapeCache holds parts in local coordinates; assembly poses are applied only at projection time. So an assembly section view cuts every part as if stacked at the origin — geometrically wrong for any non-trivially-posed assembly.

A **correct, pose-aware, per-component** cut already exists and is unit-tested (incl. nested sub-assembly pose composition): `packages/kernel/src/section/cutBySectionPlane.ts:350` `cutAssemblyBySectionPlane(oc, asm, plane, dir, opts: AssemblyCutOptions, splitPlane?, splitSide?)` — it flattens leaves with composed world poses, calls `opts.bodyResolver(partId, pose)` per component, cuts each, and merges compounds + faceTags. It is **not wired** to the api layer (the poseless dump shadows it).

## Decision (locked in brainstorming)

- **Scope:** fix **both** create and regen (Q1). Regen-only would make reopen→Regenerate silently change the geometry vs. what create produced; the only consistent + correct option is to route both through the pose-aware cut.
- **Modes:** **all three** — full, half (`splitPlane`/`cutSide`), stepped (`stepSegments`) (Q2). The kernel module already has pose-aware functions for full/half and stepped.
- **Components source:** unify create + regen on the existing `activeDrawingSourceComponents` store slot (`{partId, pose}[]`) — the same list assembly *projection* uses (live and reopen). Do NOT reconstruct an `AssemblyDocument`.

## Non-goal (explicit)

**Per-component hatch material** stays the current gray default (`materialResolver ⇒ ''`). Material is not wired into assembly section hatch even at create today (the poseless dump supplies no `materialResolver`). Deferring it keeps create + regen consistent (both gray) and this feature focused on the geometry fix. Material-correct assembly hatch is a follow-up (would extend `AssemblyComponentInput` with `materialId`, threaded through `loadAssemblyForProjection` + the live component builder).

Also out of scope: detail views of assembly sections (already work via pure-2D clip); changing the part section path.

## Architecture

The pose-aware cut is fed a flat `components: {partId, pose}[]` list (mirrors `getProjectorInput({ kind:'assembly', components })`). The only genuinely new code is an OCCT pose→shape transform; everything else is wiring + a small refactor.

### Kernel layer (`packages/kernel/`)

1. **`transformShapeByPose(oc, shape, pose)`** — new, in `src/occt/TransformOps.ts` (alongside `translateShape`). Build a `gp_Trsf` from `pose = { translation:{x,y,z}, quaternion:[x,y,z,w] }`: rotation via `gp_Trsf::SetValues` of the quaternion-derived 3×3 rotation matrix (binding-safe; use `gp_Quaternion`→`SetRotation` if that binding exists and is simpler), then translation; run `BRepBuilderAPI_Transform(shape, trsf, /*copy=*/true)` → posed `OcctShape`. Reuses the `translateShape` construction pattern; quaternion math mirrors `src/assembly/quat.ts`.

2. **Leaves-based core** — factor the per-leaf loop out of the existing `cutAssemblyBySectionPlane(oc, asm, …)` and `cutAssemblyByStepSegments(oc, asm, …)` in `src/section/cutBySectionPlane.ts` into a core that takes a pre-flattened `leaves: readonly { partId: string; pose: Pose }[]` plus `{ bodyResolver, materialResolver }`. The existing `asm`-taking functions keep their signatures and delegate after `flattenLeaves(asm, …)`. **Disposal:** the core disposes each posed body returned by `bodyResolver` after cutting (posed shapes are fresh copies and must be freed). The existing `asm` path is currently unused (only tested), so retuning its disposal contract to "core owns the body" is safe — update its test resolver accordingly.

3. **New api methods** on the kernel `Api` (`src/api.ts`):
   - `cutAssemblyComponentsBySectionPlane(components: readonly {partId:string; pose:Pose}[], plane, arrowDirection, splitPlane?, splitSide?): Promise<CutSectionResult>`
   - `cutAssemblyComponentsByStepSegments(components, planes, arrowDirection): Promise<CutSectionResult>`

   Each builds `bodyResolver = (partId, pose) ⇒ { const ns = namedShapeCache.get(partId); return ns ? transformShapeByPose(oc, ns.shape, pose) : null; }` and `materialResolver = () ⇒ ''`, calls the leaves-core with `components` as the leaves, then tessellates and returns `{ projectorInput, faceTags }` exactly like the existing cut wrappers (lines 416–549). The old poseless `cutAssemblyBySectionPlane(asmId)` / `cutAssemblyByStepSegments(asmId)` become unused (leave in place; removal is optional cleanup).

### App layer (`packages/app/`)

4. **Kernel-client wrappers** in `src/kernel/cutBySectionPlane.ts`: `cutAssemblyComponentsBySectionPlane(components, …)` and `cutAssemblyComponentsByStepSegments(components, …)` (thin pass-throughs to the kernel, like the existing `cutAssemblyBySectionPlane`).

5. **`AddSectionViewCommand`** (`src/commands/AddSectionViewCommand.ts`): for `source.kind === 'assembly'`, read `state.activeDrawingSourceComponents` and call the new components cut (dispatch full/half vs stepped on mode) instead of the poseless `cutAssemblyBySectionPlane(kernelId,…)` / `cutAssemblyByStepSegments(kernelId,…)`. The part path is unchanged.

6. **`regenerateSectionView`** (`src/drawing/regenerateSectionView.ts`): replace the assembly bail (lines ~55–57) with the same components cut (full/half/stepped dispatch on the SectionView's mode), reading `activeDrawingSourceComponents`, then re-project via `projectSectionView` and do the existing single atomic `useAppStore.setState(drawingDocState(...))` write (projection + hatchSegments + `inputFingerprint = activeDrawingSourceFingerprint`), identical to the part path.

## Data flow

`activeDrawingSourceComponents: {partId, pose}[]` (populated by `loadAssemblyForProjection` at drawing activation — live and reopen) → AddSectionViewCommand / regenerateSectionView → app `cutAssemblyComponents*` wrapper → kernel api method (builds bodyResolver from namedShapeCache + transformShapeByPose) → leaves-core (per-component pose+cut+merge) → `{projectorInput, faceTags}` → `projectSectionView` → SectionView `{projection, hatchSegments}`.

## Error handling

- Empty `activeDrawingSourceComponents` (no assembly loaded) → keep current bail semantics with a clear message; do not crash.
- A component whose `partId` is not in namedShapeCache → `bodyResolver` returns null, that component is skipped (matches the leaves-core's existing skip-on-null).
- Tangent/empty per-component cut → already skipped by the leaves-core (existing behavior).
- Any kernel error in regen → caught by the existing `handleRegenerate` catch (surfaces `err.message`, keeps the view stale).

## Testing (TDD, red→green per slice)

- **kernel unit** — `transformShapeByPose`: a unit box translated/rotated by a known pose has a transformed vertex at the expected location (assert a corner moves).
- **kernel unit** — leaves-core via a new components api method: a 2-component "assembly" where one component is posed by an offset → the merged section compound has cut faces at the offset, NOT stacked at origin (the teeth: a poseless cut would put both at origin).
- **app unit** — `AddSectionViewCommand` assembly path calls `cutAssemblyComponentsBySectionPlane` (full + half) and `cutAssemblyComponentsByStepSegments` (stepped) with `activeDrawingSourceComponents` (mock kernel); part path unchanged.
- **app unit** — `regenerateSectionView` assembly path no longer throws; calls the components cut for each mode and writes the atomic store update.
- **e2e T-6-28** — real Chromium: build a 2-part assembly with a non-trivial component pose → create drawing → add a section view → save/reopen → edit a part param → Regenerate → assert the section regenerates (hatch segment count changes / reflects the posed cut) and the cut reflects the pose (geometry not collapsed to origin). Read the browser console (must be clean).
- **perf** — probe an N-component assembly section cut (N posed copies + N boolean cuts); record p95 against a generous budget (furniture-scale ~5–30 parts).

## Risks / notes

- **Disposal:** each `transformShapeByPose` makes a fresh copy; the leaves-core must dispose every posed body. Watch for leaks (the kernel is strict).
- **`activeDrawingSourceComponents` at create:** must be populated when an assembly-sourced drawing is active. Assembly base/projected/iso view creation already relies on it (`projectViewFromSource`), so it should be; the plan must verify AddSectionViewCommand sees it.
- **Quaternion→gp_Trsf:** confirm the OCCT binding for `gp_Quaternion`/`gp_Trsf::SetValues` in this build; fall back to `SetValues` with a hand-rolled rotation matrix if `gp_Quaternion` is unavailable.
- **Perf:** per-component boolean cuts scale with part count; acceptable for furniture assemblies, but the probe guards against pathological regressions.
