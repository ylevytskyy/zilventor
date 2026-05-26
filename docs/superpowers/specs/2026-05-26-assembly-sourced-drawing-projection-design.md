# Assembly-sourced drawing projection — design

**Date:** 2026-05-26
**Status:** Approved (brainstorming) → writing-plans
**Feature:** Project an assembly (`.ziasm`, all visible component parts, recursively, at composed poses) into a drawing's base/projected/iso views, and make assembly-sourced `.zidw` reopen go stale + Regenerate when the assembly or any component part changes.

## Goal

A drawing whose `source.sourceKind === 'assembly'` can project its source `.ziasm` into base/projected/iso views. Today only `sourceKind === 'part'` works:

- `projectViewFromSource` (`packages/app/src/drawing/projectViewFromSource.ts`) has no assembly branch — only `getProjectorInput({ kind: 'part', partId })`.
- `CreateDrawingCommand` loads source only for `'part'` ("future work" for assembly).
- `activateDrawingDocument` nulls slots + sets status for assembly sources (reopen "opens but Regenerate disabled").

**Decided in brainstorming (all three recommendations accepted):**
1. **Static composed poses** — reuse the 3D viewport flattening helpers, NO constraint solve at projection time.
2. **Recursive nested assemblies** — reuse `visibleLeaves`, which already recurses through nested `.ziasm` refs and filters `visible:false`.
3. **Composite fingerprint** — hash the `.ziasm` bytes + every referenced leaf part's bytes (stable order), so editing ANY part triggers staleness on reopen.

## Existing pipeline (verified, do not rebuild)

The kernel side is already complete:

- `AssemblyComponentInput` (`packages/kernel/src/adapter/drawing/getProjectorInput.ts:7-13`):
  ```ts
  export type AssemblyComponentInput = {
    partId: string; // kernel UUID — MUST be loaded via loadFromBytes BEFORE getProjectorInput
    pose: {
      translation: { x: number; y: number; z: number };
      quaternion: readonly [number, number, number, number];
    };
  };
  ```
- `getProjectorInput({ kind: 'assembly', components })` → `getAssemblyProjectorInput` (`getProjectorInput.ts:132-176`): for each component, `lookupNamedShape(comp.partId)`, tessellate, `applyPose` (quaternion + translation) to every triangle/edge, union bboxes. Returns one aggregated `ProjectorInput`.
- `projectView(input, orientation)` (`packages/shared/src/drawing/projector.ts:26-71`): accepts ONE pre-aggregated `ProjectorInput`; depth-buffer hidden-line classification. Already works for compound/multi-part input.

So **all new code lives in the app layer** and exists only to produce a correct `AssemblyComponentInput[]` (with partIds pre-loaded) + a composite fingerprint.

## Architecture — one new bounded unit + thin branches

### New unit: `loadAssemblyForProjection.ts` (app layer, mirrors `loadDrawingSource.ts`)

Input: top `.ziasm` path, opfs, kernel. Output: `{ components: AssemblyComponentInput[]; sourceFingerprint: string }`.

Steps:
1. **Recursively unpack** the assembly tree into a `SubAssemblyCache` (resolves nested `.ziasm` refs + their `innerStaticPoses` — the same primitive the 3D viewport uses; `SubAssemblyCache.unpack()` reads bytes → `unpackAssembly` → optional pre-solve).
2. **Flatten visible leaves**: `visibleLeaves(asmDoc, cache)` → `{ componentPath, partPath, ... }[]`, filtering `visible:false`. (`packages/app/src/assembly/walkers/visibleLeaves.ts:12-42`, solver-free.)
3. **Compose static world poses**: `flattenForSolver(asmDoc, cache)` then `composedPoses(asmDoc, cache, { poses: flat.unknowns, pathToUnknown: flat.pathToUnknown, rigidSubtreeRoots: flat.rigidSubtreeRoots })` → `Map<pathKey, Pose>`, **no constraint solve** (initial-unknowns static-composition path; mirrors App.tsx:3229-3234 solver-free fallback). (`composedPoses.ts:28-64`, `flattenForSolver.ts:51-118`.)
4. **Build components**: for each visible leaf — read part bytes from OPFS, `kernel.loadFromBytes(bytes)` → partId (cached per partPath), join leaf's composed `Pose` → `AssemblyComponentInput { partId, pose }`. Map `Pose` → `{ translation:{x,y,z}, quaternion:[...] }` exactly (implementer confirms `Pose` shape + the path-key serializer used to join leaf → pose map).
5. **Composite fingerprint**: `djb2Bytes(concat(asmBytes, …leafPartBytes in visibleLeaves traversal order))`. `djb2Bytes` is reusable (`loadDrawingSource.ts:38-45`); traversal order is deterministic.

### Integration branches (thin)

- **`projectViewFromSource`** — branch on `state.activeDrawing?.source.sourceKind`. `'assembly'` → read the components slot → `getProjectorInput({ kind: 'assembly', components })` → `projectView`. `'part'` → unchanged.
- **Store** (`useAppStore.ts`) — add `activeDrawingSourceComponents: AssemblyComponentInput[] | null` alongside the existing `activeDrawingSourcePartId` / `activeDrawingSourceFingerprint`. Exactly one source slot is populated per active drawing. **`drawingDocState()` must NOT reset the new slot** (same gotcha that bit the view-projection feature — ~20 edit commands call it).
- **`CreateDrawingCommand`** — assembly branch calls `loadAssemblyForProjection`, fills components slot + fingerprint.
- **`activateDrawingDocument`** (reopen) — replace the assembly bail with `loadAssemblyForProjection`; null slots + `setStatus` on failure; `setStatus('Opened')` on success.
- **Regenerate** — locate and remove the assembly disable (UI in `FileTab`/`handleRegenerate` or an early bail); route through the same `projectViewFromSource` assembly branch.

## Staleness / Regenerate round-trip

A view stores the fingerprint it was projected against. On reopen, `activateDrawingDocument` recomputes the composite fingerprint; `computeStaleViewIds` compares stored-vs-current at activation. Edit any component part (or the assembly structure) → different composite hash → view stale → Regenerate re-projects from the reloaded source. This is the headline behavior.

## Error handling

- **Missing component part file** → fail the whole projection (null slots + `setStatus`). Do NOT silently drop a part — a partial assembly drawing is misleading.
- **Empty / all-invisible assembly** → projects nothing (empty view), not an error.

## Testing

**TDD slices (red→green→refactor):**
1. `loadAssemblyForProjection` static-pose composition on a 2-part fixture (assert both parts' partIds + correct composed poses, no solver invoked).
2. Composite fingerprint changes when one part's bytes change; stable when nothing changes.
3. `projectViewFromSource` assembly branch returns projected geometry spanning both parts.
4. Store slot population (`activeDrawingSourceComponents` set for assembly, null for part; `drawingDocState` preserves it).
5. `CreateDrawingCommand` + `activateDrawingDocument` assembly branches populate slots.

**e2e T-6-19** (real geometry, mirrors T-6-17 `tests/e2e/drawing/`): build a 2-part assembly at distinct poses → create assembly-sourced drawing → `AddBaseViewCommand` → assert visible edges span BOTH parts. Then the round-trip: Save As `.zidw` → edit one part → reopen → assert the view is **stale** → Regenerate → assert geometry updated. Must drive the REAL `loadAssemblyForProjection` / `packDrawing` path (no masked stand-ins — per the file-reopen lesson).

**perf T63j** (`tests/perf/`): project a modest assembly (~10 visible leaves); measure p95, document headroom. Working budget ~500ms (real number from the run; no assembly perf budget exists today — part single-view was <200ms).

## Out of scope (v1)

- Section/detail Regenerate for assemblies (separate follow-up; `handleRegenerate` bails for those even on parts).
- Flexible-component live re-solve at projection time (static composed poses only, per decision 1).
- Per-component layer / visibility overrides specific to the drawing.

## Open items for the plan's verifier / implementer to confirm against real code

1. Exact `Pose` translation shape (`{x,y,z}` vs array) and the path-key serializer used to join `visibleLeaves` componentPath → `composedPoses` map key.
2. Where the Regenerate assembly disable actually lives (UI vs `handleRegenerate`).
3. How `state.activeDrawing.source.sourceKind` is reached from `projectViewFromSource` (store field vs doc-tree resolution).
4. Composite-fingerprint byte order convention (asm-first, then leaves in `visibleLeaves` order) is deterministic across save + reopen.
