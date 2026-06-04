# Multi-body STEP import: full model on open + Explode into Assembly

**Date:** 2026-06-04
**Status:** Design — approved, pending spec review
**Related:** ships on top of the viewport fit-to-model fix (`2ac47d5`).

## Problem

Opening a multi-body / mixed STEP loses geometry:

1. **Part-mode (File → Open with no active assembly)** special-cases a multi-body
   STEP: it calls `extractStepSolids` and keeps **only `solids[0]`** (status
   "Imported first body of N"). The other bodies are discarded.
   (`packages/app/src/shell/tabs/FileTab.tsx` ~161–180.)

2. **`extractStepSolids` only collects `TopAbs_SOLID`.** The real MQ-1 Predator
   STEP (15 MB) contains 8 solid bodies *plus* non-solid geometry — 5
   `OPEN_SHELL` + 1 `SHELL_BASED_SURFACE_MODEL` (the thin wings/surfaces). Both
   the part-mode `solids[0]` path and the assembly-explosion path
   (`ImportStepAsComponentCommand`, multi-body) drop that non-solid geometry
   entirely.

Only importing the **whole compound shape** (what `importStepIntoNewPart` does
for single-body STEP) reproduces the complete model. Verified facts:

- Whole-compound tessellated mesh: 44,564 verts, bbox **X ±7,319 · Y −205…+2,438
  · Z −8,220…+790** (includes wings).
- The 8 extractable solids span only **X ∈ [−4,831, +502]** (no wings).

## Goals

- **Default open shows the full model.** Opening any STEP with no active
  assembly imports the whole compound as **one part** (all solids + non-solid
  wings, native positions). Fast, complete, framed (auto-fit already shipped).
- **Explode into Assembly on demand.** A command converts an imported part into
  a multi-component assembly: one component per solid body + one "Surfaces"
  component holding all non-solid geometry. Components placed at identity pose so
  native STEP coordinates assemble them correctly. Nothing dropped.

Non-goals (YAGNI): reading STEP product/assembly structure (NEXT_ASSEMBLY_USAGE
names) — components get generated names; per-shell splitting of the surfaces
bucket; retaining the original STEP bytes.

## Design

### Phase 1 — Full model on open (small)

`FileTab.handleOpen`, STEP branch, part-mode (`activeDocument?.kind !==
'assembly'`): **remove** the multi-body sub-branch that calls `extractStepSolids`
and keeps `solids[0]`. For *any* STEP (single or multi-body), import the whole
shape as one part via the existing `importStepIntoNewPart(file, kernel)` →
`setActivePart(part)`. Status "Imported".

- `importStepIntoNewPart` already imports the whole `importStep` brep (the
  cached compound includes solids + shells), so this needs no kernel change.
- The activePart re-mesh effect does not auto-execute `imported` features, but
  `setActivePart` triggers the rendering path that already worked for
  single-body imports; framing auto-fits via the `active3dDocId` effect.
- `solidCount` is no longer consulted in part-mode; `extractStepSolids` import
  in `FileTab` may become unused there (remove the now-dead branch only).

### Phase 2 — Explode into Assembly (larger)

**Kernel** (`packages/kernel/src/api.ts` + `occt/StepIO.ts` sibling):
new API `splitImportedShape(brepBlobId: string): Promise<{ solids: string[];
surfaces: string | null }>`.

- Looks up the cached imported shape (the whole compound) by `brepBlobId`
  (`importedShapeCache`, the same cache `extractStepSolids` registers into).
- Iterates the compound's top-level children (`TopoDS_Iterator` over the
  compound, or explore by type):
  - each `TopAbs_SOLID` child → wrapped in its own compound → registered as a
    new imported brep blob → pushed to `solids[]`.
  - all non-solid children (shells, faces, surface models) → added into **one**
    `TopoDS_Compound` → registered as a single blob → `surfaces` (or `null` if
    none).
- Coordinates are left untouched (no recentering — mirrors `extractStepSolids`),
  so identity-pose components reproduce the assembled model.
- Reuses the `extractStepSolids` wrapping/registration helpers.

**App** (`packages/app/src/commands/ExplodeIntoAssemblyCommand.ts`, new):
- Input: the active imported `PartDocument` (its ImportedFeature's brep blob id).
- `apply()`:
  1. `kernel.splitImportedShape(blobId)` → `{ solids, surfaces }`.
  2. For each solid blob and the surfaces blob: `buildImportedPartDocument(name,
     blobId, sourceName)` → `registerPart` → `saveToBytes` → `opfs.write`.
     Names: `<base>_1 … <base>_N` for solids, `<base>_surfaces` for the bucket.
  3. Build a new `AssemblyDocument` with N (+1) components, each referencing its
     part, **pose = identity**.
  4. `setActiveDocument({ kind: 'assembly', document })`.
- `undo()`: restore the prior active document (the single part); deregister the
  created parts (mirror `ImportStepAsComponentCommand`'s redo/cleanup contract).
- Framing auto-fits the assembly (active-doc change arms the one-shot).
- **Command entry point:** an "Explode into Assembly" button in the ribbon,
  enabled when the active document is a part whose feature tree is a single
  imported feature. (Exact tab/placement: Assembly tab — confirm in plan.)

**Reconcile the assembly-insert path:** `ImportStepAsComponentCommand`'s
multi-body branch (insert STEP into an already-active assembly) is changed to use
the same keep-all split (solids + surfaces bucket) instead of `extractStepSolids`
alone, so it stops dropping wings. Same generated-name scheme.

## Data flow

```
File → Open (no assembly)
  → importStepIntoNewPart  → whole compound part → setActivePart → render + auto-fit   [Phase 1]

Explode into Assembly (active = imported part)
  → kernel.splitImportedShape(blobId) → { solids[], surfaces }
  → N+1 PartDocuments (buildImportedPartDocument → registerPart → save → OPFS)
  → new AssemblyDocument (components @ identity) → setActiveDocument → render + auto-fit   [Phase 2]
```

## Error handling

- `splitImportedShape`: throw/clear-error if `brepBlobId` not in cache; if the
  compound has zero solids, still produce a `surfaces`-only assembly (don't
  fail). If both empty → error surfaced to status bar, no doc change.
- `ExplodeIntoAssemblyCommand`: if the active document is not an eligible
  imported part, the command is disabled (button greyed) — no-op guard in
  `apply` as defense.
- OPFS write failure for any split part → abort the whole command atomically
  (no partial assembly), surface the error, leave the part active.

## Testing

**Phase 1**
- Unit (`FileTab` STEP part-mode): multi-body STEP → `importStepIntoNewPart`
  called once; `extractStepSolids`/`solids[0]` path NOT taken.
- Kernel-integration: whole-compound import of `Assem1.STEP` → mesh bbox X
  ±7,319 (wings present), ~44.5k verts.
- E2E: open Predator (no assembly) → one part, scene bbox spans full ±7,319,
  camera framed (far ≫ 10000).

**Phase 2**
- Kernel-integration: `splitImportedShape` on the Predator blob → 8 solid blobs
  + 1 surfaces blob; union bbox X ±7,319 (wings retained in surfaces bucket).
- Unit (`ExplodeIntoAssemblyCommand`): builds N+1 components at identity pose;
  `undo` restores the single part and deregisters created parts.
- E2E: open → Explode → N+1 components in tree, scene bbox full ±7,319, framed;
  undo returns to the single part.

**No manifest bump** (no persisted-schema change; new parts/assembly use existing
document kinds). Framing is already shipped and reused.

## Open items for the plan

- Exact ribbon placement + label/enablement of the Explode command.
- Whether `surfaces` bucket should be omitted when empty (single-solid STEP).
- Confirm `buildImportedPartDocument` accepts an arbitrary blob id from
  `splitImportedShape` (it does for `extractStepSolids` blobs today).
