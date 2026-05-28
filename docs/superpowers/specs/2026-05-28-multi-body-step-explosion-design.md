# Multi-body STEP Explosion — Design

**Date:** 2026-05-28
**Status:** Approved (brainstorming complete)
**Predecessors:** load-STEP-file (`133dbc0`), import-STEP-into-assembly (`ad4c85e`), STEP-import cross-browser + .zip polish (through `5429e9a`).

## Goal

When the user imports a STEP file containing N disjoint solids into an assembly, fan out atomically into **N PartDocuments + N ComponentInstances** at the origin. The existing `solidCount = 1` path is unchanged. Part-mode (File→Open with no active assembly) falls back to single-body: register only the first solid and surface a status message.

## User-facing decisions (locked)

| # | Question | Decision |
|---|----------|----------|
| Q1 | When does explosion fire? | **Auto** when `solidCount > 1`. No dialog, no opt-in button. |
| Q2 | Part-mode behavior on multi-body STEP? | **Take first solid + setStatus** `"Imported first body of N from <filename>"`. Existing path otherwise. |
| Q3 | Naming for exploded parts? | `<sourceName>_1`, `<sourceName>_2`, … `<sourceName>_N`. `dedupeName` resolves collisions. |

## Architecture

The change is additive. No manifest bump. No new on-disk format. Existing `ImportedFeature` / `kernel.registerPart` / `addComponent` are reused verbatim.

### Pipeline (assembly mode)

```
ImportStepAsComponentCommand.apply
  ↓
importStepIntoNewParts(name, bytes)              [NEW app helper]
  ↓ extractStepSolids(bytes)                     [NEW kernel API]
  │   readStep → TopoDS_Shape (compound or solid)
  │   TopExp_Explorer_2(shape, TopAbs_SOLID)
  │   for each sub-solid → writeBRep → brepBlobId
  │   returns [{ brepBlobId, boundingBox, faceCount, triangleCount }, …]
  ↓
for i in 0..N-1:
  buildImportedPartDocument({ name: dedupeName(`${base}_${i+1}`), brepBlobId: results[i].brepBlobId })
  kernel.registerPart(part)
  bytes = kernel.saveToBytes(partId)
  opfs.write(opfsPath, bytes)
returns [{ partId, opfsPath, part }, …]
  ↓
for each result:
  addComponent({ partPath: opfsPath, position: {0,0,0}, rotation: {0,0,0}, … })
  ↓
revert payload: { componentIds[], partIds[], opfsPaths[] }
```

### Pipeline (part mode — File→Open, no active assembly)

```
FileTab.handleOpen   [STEP branch, already exists]
  ↓
kernel.importStep(stepBytes)
  ↓
if solidCount > 1:
  result = extractStepSolids(stepBytes)[0]      [first solid only]
  build + register single PartDocument
  setStatus(`Imported first body of ${N} from ${filename}`)
else:
  existing single-body path
```

## Components

### 1. Kernel — `extractStepSolids`

**Location:** new exported function in `packages/kernel/src/occt/StepIO.ts`; new method on `KernelApi` in `packages/kernel/src/api.ts`.

**Signature:**
```typescript
extractStepSolids(stepBytes: Uint8Array): Array<{
  brepBlobId: string;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  faceCount: number;
  triangleCount: number;
}>
```

**Behavior:**
- Reuse `readStep` to parse once.
- Iterate sub-solids via `TopExp_Explorer_2(shape, TopAbs_SOLID, TopAbs_SHAPE)`.
- For each sub-solid: serialize via `writeBRep(subSolid)` → `brepBlobId`; cache under `importedShapeCache[brepBlobId]`.
- `solidCount = 1` → single-element array (no special branch).
- `solidCount = 0` → throw `Error('STEP file contains no solids')`.

**Sub-shape serialization risk + fallback.** Direct `writeBRep` on a sub-shape from `TopExp_Explorer` is the obvious path but not yet verified against OCCT-WASM behavior. If serialization produces a non-rooted or corrupted blob, the fallback is to wrap each sub-solid in a fresh `TopoDS_Compound` (via `BRep_Builder.MakeCompound + Add`) before `writeBRep`. The kernel API surface (`extractStepSolids`) stays the same either way. The plan opens with a small spike inside the kernel package; the spike commits a passing kernel-integration test on the real 2-cube fixture before any app-layer work begins.

### 2. App helper — `importStepIntoNewParts`

**Location:** new file `packages/app/src/import/importStepIntoNewParts.ts`. Sibling of (not replacing) `importStepIntoNewPart.ts`.

**Signature:**
```typescript
async function importStepIntoNewParts(
  baseName: string,
  stepBytes: ArrayBuffer
): Promise<Array<{ partId: string; opfsPath: string; part: PartDocument }>>
```

**Behavior:**
1. `results = kernel.extractStepSolids(new Uint8Array(stepBytes))`.
2. For each `result[i]`:
   - `name = dedupeName(`${baseName}_${i + 1}`, kernel.partNames())` (or equivalent uniqueness source).
   - `part = buildImportedPartDocument({ name, sourceStep: <source-filename>, brepBlobId: result.brepBlobId, boundingBox: result.boundingBox, faceCount: result.faceCount })`.
   - `kernel.registerPart(part)`.
   - `bytes = kernel.saveToBytes(part.id)`.
   - `opfsPath = /parts/${part.id}.zip` (existing convention).
   - `opfs.write(opfsPath, bytes)`.
3. Return the array. No setActiveDocument — caller decides.

### 3. `ImportStepAsComponentCommand` — extended

**Location:** `packages/app/src/commands/ImportStepAsComponentCommand.ts`.

**apply (new behavior):**
- Call `importStepIntoNewParts(baseName, stepBytes)`.
- For each entry, build a `ComponentInstance` at origin (identity rotation) and call `addComponent`.
- Stash revert payload: `{ kind: 'multi', componentIds: string[], partIds: string[], opfsPaths: string[] }`.
- If `results.length === 1`, the payload uses `kind: 'single'` and behaves exactly as today (back-compat invariant — covered by an existing test).

**revert:**
- For each `componentId` in reverse insertion order: remove from `activeAssembly.components`.
- For each `partId`: `kernel.deletePart(partId)`.
- For each `opfsPath`: `opfs.delete(opfsPath)` (best-effort; warn on failure but do not throw — matches existing pattern).

**Redo-optimized branch:**
- Same precedent as singular: skip `importStep` + `saveToBytes`; rely on `deletePart` NOT evicting `importedShapeCache` (verified by import-STEP-into-assembly precedent).
- On redo, re-`registerPart` each cached PartDocument, re-`addComponent` each cached ComponentInstance.

### 4. `FileTab.handleOpen` — STEP branch extension

**Location:** `packages/app/src/components/FileTab.tsx` (or wherever the STEP branch ships today).

**Change:** in the no-active-assembly path, peek `kernel.importStep(bytes).solidCount`. If `> 1`, replace the single-body register call with `extractStepSolids(bytes)[0]` + register + `setStatus(`Imported first body of ${N} from ${filename}`)`. Else existing path.

(Assembly-active path is handled by `ImportStepAsComponentCommand` per §3 above; no change needed there.)

### 5. Naming

`baseName` derived from the source filename via `stripStepExtension(filename)`:
- `Cadeira_preta.step` → `Cadeira_preta`
- `Cadeira_preta.stp` → `Cadeira_preta`
- `Cadeira_preta.zip` (after `extractStepFromZip` returns its inner `.stp`) → use the inner filename's basename.

`dedupeName(`${base}_${i + 1}`, existingNames)` produces `Cadeira_preta_1`, `Cadeira_preta_2`, …. Collisions with existing parts (e.g. user already imported once) become `Cadeira_preta_1_2`, etc. — existing dedupe behavior, no reinvention.

## Data flow

```
.step bytes
  │
  ├─→ kernel.importStep      ─→  { brepBlobId, solidCount, … }    [unchanged]
  │
  └─→ kernel.extractStepSolids ─→ Array<{ brepBlobId, … }> × N    [NEW]
                                       │
                                       ▼
                  for each: buildImportedPartDocument
                                       │
                                       ▼
                       kernel.registerPart × N
                                       │
                                       ▼
                kernel.saveToBytes + opfs.write × N
                                       │
                                       ▼
                  ImportStepAsComponentCommand
                                       │
                  (assembly mode)      │     (part mode)
                       ┌───────────────┴───────────────┐
                       ▼                               ▼
              addComponent × N            register first only + setStatus
              at origin / identity
```

## Error handling

- `solidCount = 0` → `extractStepSolids` throws `'STEP file contains no solids'`; `ImportStepAsComponentCommand.apply` catches and surfaces via `setStatus` (matches existing import-error pattern).
- `extractStepSolids` partial failure mid-loop (e.g. one sub-solid serialization fails) → throw immediately; `apply` has not yet called `registerPart` for any of them, so no cleanup needed.
- `registerPart` partial failure (one of the N) → rollback: `deletePart` + `opfs.delete` everything registered so far, then re-throw.
- `addComponent` partial failure (one of the N) → rollback: remove already-added components, `deletePart` + `opfs.delete` all N parts, re-throw.
- `revert` best-effort: deleting a part or opfs file that's already gone logs a warning, doesn't throw (matches existing pattern).
- Naming collision overflow (`_1_2_3…` runaway) → `dedupeName` already caps reasonably; no new guard.
- `solidCount` warning threshold: warn (`console.warn`) at `solidCount > 50`. Do NOT refuse; user may genuinely want 100 hinges.

## Testing strategy (TDD per slice)

### Slice 1 — kernel spike + extraction
- **RED**: `packages/kernel/src/__tests__/extractStepSolids.integration.spec.ts` — load real `two-cubes.step` fixture, assert `extractStepSolids(bytes).length === 2`, each entry has distinct `brepBlobId`, bounding boxes are disjoint.
- **GREEN**: implement `extractStepSolids` (StepIO.ts + api.ts wiring). If direct `writeBRep(subSolid)` fails, switch to `BRep_Builder.MakeCompound + Add` fallback inside this slice.
- **REFACTOR**: extract any shared explorer-walk helper if duplicated with existing `solidCount` count loop.

### Slice 2 — app helper
- **RED**: `packages/app/src/import/__tests__/importStepIntoNewParts.spec.ts` — mock kernel; assert N PartDocuments registered with `_1` … `_N` names; collisions deduped; OPFS write called N times with `/parts/{partId}.zip` paths.
- **GREEN**: implement `importStepIntoNewParts.ts`.

### Slice 3 — assembly command extension
- **RED**: `packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts` — extend with multi-body case: `apply` calls `addComponent` N times at origin; `revert` removes all N components + deletes all N parts + opfs.deletes all N paths.
- **GREEN**: extend `ImportStepAsComponentCommand.ts`.
- **REGRESSION**: existing single-body test (`solidCount = 1`) must still pass byte-for-byte — back-compat invariant.

### Slice 4 — part-mode FileTab branch
- **RED**: `packages/app/src/components/__tests__/FileTab.handleOpen.spec.ts` — STEP open with no active assembly + `solidCount = 3` → only first solid registered + `setStatus` called with `"Imported first body of 3 from <name>"`.
- **GREEN**: extend `FileTab.handleOpen` STEP branch.

### Slice 5 — e2e
- **RED**: `tests/e2e/multi-body-step-explosion.spec.ts` — create assembly, drop real `two-cubes.step` via `__zilventorImportStepFromBytes`, assert feature tree shows two components (`<base>_1`, `<base>_2`), reload page → both persist, undo → both gone.
- **GREEN**: nothing new — all wiring already done by slices 1-4; this slice locks the real flow.

### Fixture
- `packages/kernel/src/__tests__/fixtures/two-cubes.step` — two disjoint axis-aligned 10mm cubes, one at origin, one offset by (50,0,0). Either generate via OCCT during test setup or hand-author (small file, ~3 KB).

### Manual smoke (after merge)
- Real STEP from the user's hardware library with multiple bodies (e.g. a hinge assembly) imported into a furniture assembly; confirm body count + names; pose components manually; save + reload.

## Out of scope

- **STEP-CAF labels** — pulling per-body names from STEP-CAF (`STEPCAFControl_Reader`) needs XDE/XCAF in the OCCT-WASM build. Tracked as a separate "STEP-CAF importer" follow-up.
- **Single-PartDocument with N bodies** — the alternative "one part, multi-body feature" is rejected by Q3 decision.
- **Per-body color / material from STEP** — same XDE/XCAF dependency; out.
- **Auto-mate / collision / interference between exploded bodies** — pure import; no constraint generation.
- **Performance tuning for >50 bodies** — warn-only; refuse-or-streamlined path is deferred.
- **Drawing projection for multi-body imports** — should work transparently (each body is a regular PartDocument). Not actively re-tested by this spec; covered by an existing drawing-import follow-up.

## Manifest

No bump. `v19` stays. The feature is additive: new kernel API, new app helper, extended existing command, extended existing FileTab branch. On-disk format unchanged (one OPFS `.zip` per part, exactly as today).

## Estimated surface area

- **Kernel**: ~80 lines new (`extractStepSolids` in StepIO.ts + KernelApi binding in api.ts).
- **App**: ~40 lines new helper, ~60 lines net in `ImportStepAsComponentCommand`, ~15 lines in `FileTab.handleOpen` STEP branch.
- **Tests**: ~4 unit spec files (~40-80 lines each), 1 kernel integration spec, 1 e2e spec, 1 binary fixture.

## Design risks (acknowledged)

1. **Sub-shape `writeBRep` may misbehave** — opens with a kernel spike; fallback is fresh-compound wrap. Worst case: one extra hour vs. estimate.
2. **Naming collision against existing parts** — `dedupeName` may produce ugly `_1_2_3` chains in pathological cases. Acceptable; matches existing behavior.
3. **`solidCount` warning threshold of 50** — arbitrary; can be tuned post-merge if a user complains.
4. **OPFS rollback on partial failure** — adds complexity to `apply`. Mitigated by failing FAST inside `extractStepSolids` (atomic kernel step) before any OPFS writes; the only N-step OPFS operations are guarded by the rollback loop.
