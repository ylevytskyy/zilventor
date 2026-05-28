# STEP-CAF Importer (flat enrichment) — Design

**Date:** 2026-05-28
**Status:** Approved (brainstorming) — proceeding to plan
**Feature #:** THIRTY-FIRST post-roadmap follow-up

## Problem

Inventor/Fusion-exported STEP files carry rich metadata — per-body **names**, per-body
**colors**, and an **assembly hierarchy with placement transforms**. Today's importer
throws all of it away:

- Bodies are named `<base>_1..N` (positional), not by their real CAF labels.
- Every imported body is placed at the **origin** (`makeOriginInstance` hard-codes
  identity pose) — a multi-part assembly imports as an overlapping pile.
- No color is assigned.

This feature reads that metadata via OCCT's XDE/XCAF module
(`STEPCAFControl_Reader` → `TDocStd_Document` → `XCAFDoc_ShapeTool`/`ColorTool`)
and applies it.

## Scope (locked via brainstorming)

**In v1 — flat enrichment:**
- **Names** — each leaf solid's part name comes from its CAF label.
- **Colors** — each component's color comes from its CAF color.
- **Placement** — each component's pose comes from its accumulated CAF world-transform.
- **Flat** — the assembly tree is flattened to its leaf solids; output is a single-level
  assembly of N components (same shape as today's multi-body explosion), just named,
  colored, and positioned.
- **Graceful degrade** — plain STEPs with no CAF data fall back to exactly today's
  behavior: `<base>_N` names, origin placement, no color.

**Explicitly out of v1 (deferred follow-ups):**
- Recursive nested sub-assembly `.ziasm` documents (flatten instead).
- Dedup-by-referred-shape (v1 makes one part per leaf *occurrence*; 8 identical screws
  → `screw_1..8` as 8 part files). See "Known limitations".
- Full CAF in part-mode (part-mode gets **name only**; no color/transform).

## Binding-availability spike (done — GO, confidence 98)

`opencascade.js@2.0.0-beta.b5ff984` (OpenCascade 7.6.2 stock full build). All required
XDE/XCAF classes are present in the shipped `opencascade.full.d.ts`:
`STEPCAFControl_Reader`, `TDocStd_Document`, `Handle_TDocStd_Document`,
`XCAFDoc_DocumentTool`, `XCAFDoc_ShapeTool`, `XCAFDoc_ColorTool`, `TDF_Label`,
`TDF_LabelSequence`.

**Residual risk:** `.d.ts` presence proves the type is *declared*, not 100% that the
symbol is emscripten-bound at runtime. Mitigation: **Plan task 1 is a runtime probe** —
an integration test that instantiates `STEPCAFControl_Reader` against a live `oc` and
reads a real CAF STEP. If the symbol is missing at runtime, we stop and report before
building anything else.

## Architecture

### Kernel: one new method (single parse)

```
extractStepWithCaf({ stepBytes: number[] }) -> {
  solids: Array<{
    brepBlobId: string;
    boundingBox: [number, number, number, number, number, number]; // [xMin,yMin,zMin,xMax,yMax,zMax]
    name: string | null;                                            // null when no CAF label
    color: { r: number; g: number; b: number } | null;             // floats 0..1; null when no CAF color
    pose: { translation: [number, number, number];                 // mm
            quaternion: [number, number, number, number] } | null; // [x,y,z,w]; null => identity/origin
  }>;
}
```

Implementation (single parse — see "Why single parse" below):
1. `STEPCAFControl_Reader` reads `stepBytes` (written to OCCT virtual FS like existing
   `StepIO.ts`), `Transfer`s into a `Handle(TDocStd_Document)`.
2. `XCAFDoc_DocumentTool::ShapeTool` → enumerate free shapes; recursively walk to
   **leaf solids**, accumulating each instance's `TopLoc_Location` into a cumulative
   world `gp_Trsf`.
3. Per leaf solid:
   - **geometry** — compound-wrap the solid (fresh `TopoDS_Compound` via
     `BRep_Builder.MakeCompound + Add`, matching today's `extractStepSolids` idiom to
     dodge the known heap behavior) → `writeBRep` → blob id; bounding box as today.
   - **name** — `TDataStd_Name` on the shape/instance label (instance name preferred,
     else referred-shape name); `null` if absent.
   - **color** — `XCAFDoc_ColorTool::GetColor(label, surf)` → fall back to generic
     (`XCAFDoc_ColorGen`); `{r,g,b}` floats; `null` if absent.
   - **pose** — cumulative `gp_Trsf` → `{ translation (mm), quaternion [x,y,z,w] }`;
     `null` when identity.
4. Throw `'STEP file contains no solids'` on N=0 (match existing `extractStepSolids`).

Existing `importStep` / `extractStepSolids` are **left untouched** for back-compat and
other callers (dev helpers, tests). The new method is additive.

#### Why single parse (not importStep-peek + CAF-read)

The multi-body STEP feature shipped a WASM heap leak from parsing the file twice
(`importStep` peek + `extractStepSolids`). `extractStepWithCaf` does everything in one
parse and is the **only** reader both import helpers call. Part-mode therefore also goes
through it (takes `solids[0]`) rather than adding a second CAF parse just for the name.

### App: mapping layer

**Assembly insert (multi-body explosion path — `ImportStepAsComponentCommand` /
`importStepIntoNewParts`):**
- Per leaf solid → a `PartDocument` via `buildImportedPartDocument`.
- **name** — CAF name if present, sanitized for use as an OPFS filename
  (`<name>.zipt`), deduped via existing `dedupeName` against `opfs.listAll()`;
  fallback `<base>_N` (existing rule: `N===1 ? baseName : `${baseName}_${i+1}``).
- **pose** — component instance pose set from `solids[i].pose` (replaces
  `makeOriginInstance` identity); when `pose === null`, fall back to origin. Keep
  `position`/`rotation` in sync with `pose` per existing `ComponentInstance` convention.
- **color** — when `solids[i].color` present, write
  `assembly.colorOverrides[componentPathKey] = { kind: 'hex', hex }` (RGB floats → hex).
- **show-colors** — if ≥1 component received a CAF color, enable the
  `showComponentColors` toggle so the colors actually render (recommend-and-proceed,
  approved).

**Part-mode (File→Open single part — `FileTab` / `importStepIntoNewPart`):**
- Geometry from `solids[0].brepBlobId` (= whole shape when single-body; first solid for
  multi-body, matching today's documented part-mode fallback + `setStatus`).
- Part name from `solids[0].name` (sanitized), fallback to source basename.
- No color, no transform.

## Data flow

```
File (.step/.stp, or .zip-wrapped) 
  → stepBytes 
  → kernel.extractStepWithCaf({ stepBytes })           [single parse]
  → { solids: [{ brepBlobId, boundingBox, name, color, pose }, ...] }
  → ASSEMBLY: per solid → buildImportedPartDocument(name) → registerPart 
             → saveToBytes → opfs.write → addComponent(pose) 
             → colorOverrides[path] = color → enable showComponentColors
  → PART:    solids[0] → buildImportedPartDocument(name) → registerPart → opfs.write
```

## Error handling

- **N=0 solids** — throw `'STEP file contains no solids'` (existing string).
- **No CAF data (plain STEP)** — `name`/`color`/`pose` are `null` per solid → caller
  degrades to `<base>_N` / no override / origin. No error.
- **Illegal filename chars in CAF name** — sanitize before forming `<name>.zipt`; then
  `dedupeName`.
- **Name collisions across imported leaves** — `dedupeName` parenthetical `(2)` style.
- **Runtime binding missing** (spike fails) — STOP, report, do not proceed.

## Testing

- **Task 1 runtime spike** — integration test: `new oc.STEPCAFControl_Reader_1()`
  exists, reads a real CAF STEP into a `TDocStd_Document`, shape tool yields ≥1 label.
- **New fixture** — a small **named + colored 2-body assembly STEP** with distinct
  names, distinct colors, and non-overlapping offsets. Committed under the kernel test
  fixtures dir alongside `two-bodies.step` / `cube-10mm.step`.
- **Kernel integration** (`extractStepWithCaf.integration.spec.ts`, real OCCT):
  - 2 solids, both names match fixture labels.
  - both colors match fixture colors (within float tolerance).
  - both poses non-identity and distinct (placement honored).
  - plain `cube-10mm.step` → 1 solid, `name`/`color`/`pose` degrade to `null`.
  - empty/unparseable → throws `'STEP file contains no solids'`.
- **App unit** — mapping layer: CAF name → deduped `.zipt`; CAF color → `colorOverrides`
  hex; CAF pose → component pose; null metadata → `<base>_N` / origin / no override;
  part-mode takes `solids[0].name`.
- **e2e** (`step-caf-import.spec.ts`, real fixture): import the 2-body CAF assembly →
  2 named components at distinct positions, colors applied, `showComponentColors` on;
  reload → names/colors/poses persist.
- **Regression** — re-run existing `cube-10mm.step` + `two-bodies.step` part-mode +
  assembly e2e green (proves graceful degrade + no geometry drift on the part-mode
  reroute through `extractStepWithCaf`).
- **Full gate** — `pnpm -r test:unit` (3111 baseline + new), kernel integration,
  e2e, perf, lint, typecheck.

## Known limitations / deferred follow-ups

1. **No dedup-by-referred-shape** — repeated identical hardware imports as N separate
   part files (`screw_1..8`). Follow-up: 1 part + N components when leaves share a
   referred shape. (Approved as out-of-v1; revisit if Inventor exports lean on repeated
   hardware.)
2. **Flat only** — nested sub-assemblies are flattened; no recursive `.ziasm` tree.
3. **Part-mode name-only** — single-part imports get the name but not color/transform.
4. **CAF colors → hex overrides** — palette mapping not attempted; raw RGB → hex.

## Manifest

No on-disk format change — additive. Manifest stays **v19**. (`colorOverrides`,
`pose`, and part naming all use existing persisted fields.)
