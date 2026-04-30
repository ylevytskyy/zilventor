# Sub-project 1.5 — Inventor 2012 → ZilInventor migration

**Date:** 2026-04-30
**Owner:** levytskyy
**Status:** spec — ready for plan

## Why

ZilInventor's locked file-compat policy (per `project_zilinventor_overview.md`) is the **A′ migration path**: `.ipt`/`.iam` cannot be read editably; the user's existing Inventor 2012 furniture library is migrated *once* via a STEP+JSON export from inside Inventor, then ZilInventor-native going forward. Sub-project 1.5 is the macro that does the export plus the importer that turns the export into `.zipt`/`.ziasm`. Without it, the user's library is stranded outside the new app.

This is a one-time tool, not an ongoing flow. No two-way sync, no incremental re-export, no Inventor-formula tracking.

## Scope decisions (locked)

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Both halves in scope** — Inventor-side macro + ZilInventor-side importer | Co-designing the JSON schema by producer and consumer; user gets a usable end-to-end migration path. |
| Q2 | **Geometry + assembly tree + iProperties + custom iProperties + numeric user parameters** captured (parameters as metadata only — geometry stays sealed STEP, no parametric replay) | Smallest scope that unblocks library use; BOM works; metadata survives. |
| Q3 | **Both single-doc and batch** entry points on the Inventor side | Both wrappers share one internal export function; trivial. |
| Q4 | **VBA** (`.ivb` distributable) | Lowest-friction delivery for one-time migration; no Visual Studio, no admin install. |
| Q5 | **Per-part STEP** (one STEP per unique referenced `.ipt`, plus `.iam.json` for assembly metadata) | Matches `.zipt`/`.ziasm` model; dedupes repeated occurrences naturally. |
| Q6 | **Recursive part+asm JSON** — one JSON per output, asm JSON references other JSONs by relative path | Mirrors how `.zipt`/`.ziasm` already work; standalone parts keep their metadata. |
| Q7 | **Read-only `imported` feature variant**, no parametric edits on imports | Avoids unstable face-naming on imported geometry; user re-authors parametrically as a fresh ZilInventor part if needed. |
| Q8 | **Generic `properties: Record<string, string \| number \| boolean>` bag** on `PartDocument` and `AssemblyDocument` | Captures all standard + custom iProperties losslessly without churning the schema. |
| Q9 | **File-tab ribbon button + folder picker** for the importer | Matches batch-folder export shape; one ribbon button on File tab. |

## Architecture overview

```
.ipt / .iam              folder of            .zipt / .ziasm
(Inventor 2012)   →      .step + .json   →    (OPFS, ZilInventor)
   ↑                       (on disk)            ↑
   VBA macro                                    File-tab "Import from
   batched over                                 Inventor" command,
   a folder tree                                folder picker
```

**Inventor side** — single distributable `.ivb` VBA module, two public entry points:

- `ZilInventor_ExportActiveDocument()` — exports the currently-open `.ipt` or `.iam`.
- `ZilInventor_BatchExportFolder()` — folder picker → folder picker → walks input recursively, processes every `.ipt`/`.iam`, mirrors source folder structure into the output, writes `_export-log.txt`.

Both call into a shared internal `ExportDocument(doc, outputRoot, sourceRelativePath)`.

**Intermediate folder layout**

For `Cabinet/SidePanel.ipt` the macro writes `<output>/Cabinet/SidePanel.step` + `<output>/Cabinet/SidePanel.ipt.json`. For `Cabinet/Cabinet.iam` it writes `<output>/Cabinet/Cabinet.iam.json` only — assemblies reference the per-part STEPs by relative path. Folder structure is preserved 1:1.

**ZilInventor side** — File-tab ribbon button **"Import from Inventor"** → folder picker for input → folder picker for OPFS target → progress dialog → walks the input tree, packs each `.ipt.json` into a `.zipt` and each `.iam.json` into a `.ziasm`, writes to OPFS preserving the folder tree.

## Inventor-side: VBA macro

### Single-file deliverable: `tools/inventor-export/ZilInventorExport.ivb`

Public entry points (callable from Inventor's `Tools → Macros` dialog):

```
Public Sub ZilInventor_ExportActiveDocument()
Public Sub ZilInventor_BatchExportFolder()
```

### Internal structure

| Routine | Responsibility |
|---|---|
| `ExportDocument(doc, outputRoot, relPath)` | Top-level dispatcher. `kPartDocumentObject` → `ExportPart`. `kAssemblyDocumentObject` → `ExportAssembly`. Else: log "unsupported", skip. |
| `ExportPart(partDoc, outputRoot, relPath)` | Calls Inventor's STEP translator on the open `.ipt` to write `<outputRoot>/<relPath>/<basename>.step`. Then `WritePartJson` for the sidecar. |
| `ExportAssembly(asmDoc, outputRoot, relPath)` | Walks `asmDoc.AllReferencedDocuments` once at the start to produce a deduped set of unique referenced parts and sub-asms. For each unique part → `ExportPart` (skip if already exported in this batch session). For each unique sub-asm → recurse `ExportAssembly`. Then `WriteAssemblyJson` listing this assembly's *direct* occurrences only (sub-asm hierarchy recovered via JSON refs). |
| `WritePartJson(partDoc, outPath)` | Reads iProperties + custom iProperties + numeric user parameters → `<basename>.ipt.json` (UTF-8 via `ADODB.Stream`). |
| `WriteAssemblyJson(asmDoc, outPath)` | Reads iProperties + numeric user parameters + occurrences → `<basename>.iam.json` (UTF-8). |
| `STEPExport(doc, outFile)` | Wraps `ApplicationAddIns.ItemById("{...STEP-translator-CLSID...}")` to invoke `SaveCopyAs` with AP214 + binary settings. |
| `ToJson*` helpers | Manual UTF-8 JSON building — no external dependency. Strings escape `\`, `"`, control chars; raw UTF-8 bytes via `ADODB.Stream`. Property/parameter values: string, number, or boolean only. |
| `LogLine(msg)` | Appends to `<outputRoot>/_export-log.txt` (UTF-8). |
| `IsAlreadyExported(absPath)` | Per-batch in-memory dedup set keyed by Inventor's resolved absolute file path. Same `.ipt` referenced from twenty `.iam`s exports once. |

### STEP flavor

**AP214** with binary encoding. Preserves units (mm, locked in `units: 'mm'`) and per-occurrence colors. AP203 dropped because it loses color info; user library may have meaningful color overrides.

### Batch entry-point UX

`ZilInventor_BatchExportFolder` is a 4-step interaction:

1. Folder picker — input root.
2. Folder picker — output root. Refuse to proceed if equal to or nested within the input root (would interleave `.step` files into source library).
3. Modal progress form (Inventor VBA `UserForm`) listing `<file>: ok / error`. Cancel button checked between files.
4. On finish: summary line + offer to open the log file.

Single-doc entry point reuses (2)–(4) and skips (1).

### Out-of-tree references

If an `.iam` references a part outside the chosen input root (e.g. `..\..\Library\Hinge.ipt`), the macro **still exports it** under a synthesized output relative path of `_external/<original-folder-basename>/<file>.step + .ipt.json`. JSON refs from the consuming `.iam.json` use that relative path. Logged at `info` level.

### Materials

Inventor materials map to a **string** in JSON (`material: "Plywood 18mm"` etc.). No translation to ZilInventor's color palette. Material is metadata-only; it surfaces in the BOM and properties panel, no rendering effect.

### Colors

Per-occurrence color override on an assembly read from `ComponentOccurrence.Appearance` — when present and different from the part's default appearance, written as `color: { hex: "#aabbcc" }` on the occurrence record. Per-part default appearance is **not** exported (would over-color every imported part).

### Schema versioning

All JSON files carry `schemaVersion: 1` at the top. Future schema bumps live in this same macro file (we control both ends).

## JSON sidecar schemas

### `<name>.ipt.json` — per-part metadata

```jsonc
{
  "schemaVersion": 1,
  "kind": "part",
  "exportedAt": "2026-04-30T14:23:01Z",
  "source": {
    "iptPath": "Cabinet/SidePanel.ipt",
    "fileVersion": "Inventor 2012"
  },
  "step": "SidePanel.step",
  "name": "SidePanel",
  "properties": {
    "partNumber": "Z-SIDE-600",
    "description": "Side panel 600 wide",
    "material": "Plywood 18mm",
    "mass": 1.234,
    "Cost Center": "Doors",
    "Stock Number": "ABC-123"
  },
  "parameters": {
    "Width":  { "value": 600, "unit": "mm",  "expression": "600 mm" },
    "Height": { "value": 720, "unit": "mm",  "expression": "Width * 1.2" }
  }
}
```

**`properties` rules.** Standard iProperty fields land under canonical lower-camel keys (`partNumber`, `description`, `material`, `mass`, `vendor`, `project`, `revisionNumber`, `stockNumber`, `costCenter`, `weight`, etc.). Custom iProperties keep their original Inventor key verbatim (case-sensitive, including spaces and Cyrillic). Values: string, number, or boolean. Empty/blank standard fields are omitted, not written as `""`.

**`parameters` rules.** Only Inventor *user parameters* (`Parameters.UserParameters`) — model and reference parameters skipped. Numeric only; text/boolean parameters skipped (logged). `expression` is the user's source string verbatim. `value` is Inventor's *resolved* numeric value at export time, in `unit`. `unit` ∈ `'mm' | 'deg' | 'rad' | 'unitless'`; any Inventor unit ZilInventor doesn't support is rejected (logged, parameter skipped). Importer treats `value` as authoritative and `expression` as a comment.

**Canonical iProperty key map** (verbatim list — applied by both writer and reader):

| Inventor field | JSON key |
|---|---|
| Part Number | `partNumber` |
| Description | `description` |
| Material | `material` |
| Mass (kg) | `mass` |
| Vendor | `vendor` |
| Project | `project` |
| Revision Number | `revisionNumber` |
| Stock Number | `stockNumber` |
| Cost Center | `costCenter` |
| Weight (kg) | `weight` |
| Title | `title` |
| Subject | `subject` |
| Author | `author` |
| Manager | `manager` |
| Company | `company` |
| Category | `category` |
| Keywords | `keywords` |
| Comments | `comments` |
| Status | `status` |

Any iProperty not in the table is treated as custom and keeps its original key.

### `<name>.iam.json` — per-assembly metadata + occurrences

```jsonc
{
  "schemaVersion": 1,
  "kind": "assembly",
  "exportedAt": "2026-04-30T14:23:05Z",
  "source": { "iamPath": "Cabinet/Cabinet.iam", "fileVersion": "Inventor 2012" },
  "name": "Cabinet",
  "properties": { "partNumber": "Z-CAB-001", "description": "Base cabinet 600" },
  "parameters": {},
  "occurrences": [
    {
      "occurrenceName": "SidePanel:1",
      "ref": "./SidePanel.ipt.json",
      "pose": {
        "translation": { "x": 0, "y": 0, "z": 0 },
        "quaternion": [0, 0, 0, 1]
      },
      "color": { "hex": "#aabbcc" },
      "visible": true,
      "grounded": false
    }
  ]
}
```

**`occurrences` rules.** *Direct* occurrences only — sub-asm structure recovered via JSON refs. Pose from `ComponentOccurrence.Transformation` decomposed into translation (mm) and quaternion `[x,y,z,w]`. Color rule per macro section. `visible` reads Inventor's visibility flag. `grounded` reads `ComponentOccurrence.Grounded`.

**Constraints not exported.** Inventor's assembly constraints (mate/flush/angle/insert) reference internal Inventor face/edge identities that don't survive STEP transit. Imported `.ziasm` files arrive with all occurrences positioned by `pose` only and zero constraints.

### Path/ref invariants

- All paths in JSON are relative, forward-slash, never absolute, never `..` outside the input root *except* for the synthetic `_external/...` prefix.
- `step` ref always points to a sibling file (same folder as the `.ipt.json`).
- Assembly `occurrences[].ref` always points to another file produced by the same macro run (the macro guarantees this by exporting referenced docs first).
- Filename collisions inside one folder are renamed to `<basename>__<short-hash>.step` etc., logged.

### JSON encoding

UTF-8 without BOM. Indented with 2 spaces. Numbers: plain decimal, no exponential. NaN/Infinity → field omitted with warning logged.

## ZilInventor schema additions (v8 → v9, additive)

### Type changes (`packages/shared/src/types.ts`)

```ts
export type PartDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  featureTree: Feature[];
  cachedGeometry?: CachedGeometry;
  properties: Record<string, string | number | boolean>;   // NEW
};

export type AssemblyDocument = {
  // ...all existing fields...
  properties: Record<string, string | number | boolean>;   // NEW
};

export type ImportedFeature = {
  kind: 'imported';
  id: string;
  /** Source filename of the originating STEP, for diagnostics only. */
  sourceStep: string;
  /** Blob id of the cached B-rep (only field that drives recompute). */
  bodyRef: string;
};

export type Feature =
  | // ...existing variants...
  | ImportedFeature;                                       // NEW

export type ProjectFile =
  | { formatVersion: 7 | 8 | 9; kind: 'part'; ... }
  | { formatVersion: 7 | 8 | 9; kind: 'assembly'; ... };

export function isImportedPart(doc: PartDocument): boolean {
  const nonOrigin = doc.featureTree.filter((f) => !f.id.startsWith('origin.'));
  return nonOrigin.length === 1 && nonOrigin[0]!.kind === 'imported';
}
```

### v8 → v9 migration (`packages/shared/src/fileFormat.ts`)

```ts
8: (mIn) => {
  const m = deepClone(mIn);
  const anyM = m as { kind?: string; document?: any };
  if (anyM.document && !anyM.document.properties) {
    anyM.document.properties = {};
  }
  return { ...m, formatVersion: 9 };
},
```

`CURRENT_FORMAT_VERSION` bumps to `9`. Existing v8 part/assembly files get `properties: {}` injected on load and re-save out as v9.

### Read-only enforcement at the UI seam

The kernel does not need to know about read-only — the predicate is only used at the UI:

1. **Ribbon command guards** — every Model-tab `Add*` command (AddSketch, AddExtrusion, AddRevolve, AddFillet, AddChamfer, AddShell, AddHole, AddSweep, AddLinearPattern, AddMirror, AddWorkAxis, AddWorkPlane, AddWorkPoint) checks `isImportedPart(activePart)` in its `canExecute()` and disables itself with tooltip: *"This part was imported from Inventor and is read-only. Re-author parametrically by creating a new part."*
2. **BrowserPane** disables right-click "Edit feature" / "Delete feature" on the imported feature node; suppresses double-click open of the imported feature (no edit dialog exists for it).
3. **Sketcher tab** — sketch creation on origin planes is *not* blocked at this level (origin planes work). The downstream extrude command is gated above. Net effect: a user can sketch on an imported part's origin plane but can't materialize the sketch into a feature. Acceptable corner; alternative is also blocking Sketch creation, which feels heavier.

### Kernel `ImportedFeature` evaluator

New file: `packages/kernel/src/adapter/features/ImportedFeature.ts`. Evaluates by reading the cached `.brep` blob from storage by `bodyRef` and returning it as the feature's body. No OCCT computation, no preview, no parameters touched. Adds an entry to `FeatureTree.evaluate(...)`'s discriminated dispatch.

### Face/edge naming on imported geometry

Imported parts have no `FaceNaming` history (no extrude/revolve/fillet etc. that builds up identifiable face roles). The user will still place imported parts in assemblies and add assembly constraints (4b) to their faces, so we need a stable naming scheme that doesn't depend on feature history.

**Convention** — for imported geometry, `FaceName` is derived from OCCT topology indices on the cached B-rep blob, frozen at import time:

```ts
// Face on an imported part
{ featureId: '<imported-feature-id>', role: 'imported-face', instance: <occtFaceIndex> }

// Edge on an imported part — uses existing canonicalEdgeName from a face pair
canonicalEdgeName(faceA, faceB)  // both faces have role 'imported-face'
```

`<occtFaceIndex>` is the index from iterating `TopExp_Explorer(shape, TopAbs_FACE)` in OCCT's deterministic order over the imported solid. Stability comes from the `.brep` blob being immutable — imported parts are read-only, the blob is never re-evaluated. Re-importing a slightly-changed Inventor part produces a *new* `.zipt` with possibly-different face indices, which can break constraints anchored to the old version. Documented limitation, consistent with the one-time-migration intent.

`StepIO.ts` returns `faceCount` alongside `brepBlobId`, letting the kernel bounds-check `instance < faceCount` when resolving picks. The 4b constraint solver and 4c face-pick controllers consume `FaceName` opaquely; they don't care whether the part is imported vs parametric.

### BOM integration

The 4c BOM aggregator reads each `.zipt` manifest's `name`. Extend it to opportunistically pull two extra fields from `properties`:

- "Part Number" — `properties.partNumber ?? name`
- "Description" — `properties.description ?? ''`

Schema field + extraction ship in 1.5; **BOM table column toggles are NOT in scope here** — that's a 4c follow-up.

## ZilInventor importer flow

### Entry point

New ribbon command on **File tab → Import group → "Import from Inventor"**. Command id: `import-from-inventor`. New file: `packages/app/src/commands/ImportFromInventorCommand.ts`.

### User flow

1. **Click button.** Command checks `'showDirectoryPicker' in window` and refuses with a toast if missing.
2. **Folder picker — input.** `showDirectoryPicker({ mode: 'read', id: 'inventor-import-input' })`. Returns a `FileSystemDirectoryHandle`.
3. **Modal: "Import from Inventor".** Dialog fields:
   - Input root: read-only display of picked folder name
   - "Import to:" dropdown — top-level OPFS folders + a "New folder…" option
   - Conflict handling radio: ▢ Overwrite existing files / ▣ Skip existing / ▢ Cancel on conflict (default = Skip)
   - [Cancel] [Import]
4. **Phase 1 — scan.** Walk input recursively; collect `*.ipt.json` and `*.iam.json`; parse each (validate `schemaVersion === 1`); build dependency graph. Detect cycles, abort with file list. Detect missing refs, abort with file list.
5. **Phase 2 — confirm.** Dialog updates to "Found N parts, M assemblies. Click Continue to import."
6. **Phase 3 — import.** Modal progress with line-per-file. Topological order: leaf parts first, then assemblies bottom-up.
   - **Per part:** read sibling STEP into `ArrayBuffer` → kernel RPC `kernelClient.importStep({ stepBytes, partName })` → kernel returns `{ brepBlobId, triangleCount, boundingBox }` → app builds v9 `PartDocument` with one `ImportedFeature`, packs as `.zipt`, writes to OPFS at the mirrored output path.
   - **Per assembly:** build `AssemblyDocument` directly (no kernel call) by mapping `occurrences[]` to `ComponentInstance[]`. Each occurrence's `partPath` resolves to the OPFS path of the previously-written `.zipt` (or `.ziasm` for sub-asms). Pose translation/quaternion → `ComponentInstance.pose`. `color` → `colorOverrides[pathKey([occurrence.id])]`. `grounded` → `groundedComponentPaths`. Constraints array stays empty.
   - Per-file conflict per radio choice. Cancel button between files.
7. **Phase 4 — summary.** Modal closes. Toast or in-place: "Imported N parts, M assemblies. K errors. (J skipped — already existed.)" Single button: open `_import-log.txt` written into the OPFS target.

### Output OPFS layout

Mirrors input folder structure 1:1, with extension swaps:

```
input/                           OPFS target/
  Cabinet/                         Cabinet/
    SidePanel.ipt.json    →          SidePanel.zipt
    SidePanel.step
    BackPanel.ipt.json    →          BackPanel.zipt
    BackPanel.step
    Cabinet.iam.json      →          Cabinet.ziasm
  _external/                       _external/
    Hardware/                        Hardware/
      Hinge.ipt.json      →            Hinge.zipt
      Hinge.step
```

Source `.step`/`.ipt.json`/`.iam.json` files are *not* copied into OPFS — they're consumed and discarded.

### Importer module layout

```
packages/app/src/import/
  __tests__/
    InventorImporter.spec.ts         // top-level orchestrator
    inventorJsonSchema.spec.ts       // schema validators + fixtures
    poseDecode.spec.ts               // pose JSON → ComponentInstance.pose
    resolveOutputPaths.spec.ts       // path mapping + collision rename
    buildPartDocument.spec.ts
    buildAssemblyDocument.spec.ts
    dependencyGraph.spec.ts          // topo order, cycle detect, missing refs
    fixtures/                        // hand-authored small JSONs
  InventorImporter.ts
  inventorJsonSchema.ts
  poseDecode.ts
  resolveOutputPaths.ts
  buildPartDocument.ts
  buildAssemblyDocument.ts
  dependencyGraph.ts
```

### Kernel addition

```
packages/kernel/src/occt/
  __tests__/
    StepIO.integration.spec.ts       // node + OCCT-WASM
    fixtures/step/
      cube-10mm.step
      two-bodies.step
      cyrillic-name.step
  StepIO.ts                          // STEPControl_Reader wrapper
```

New RPC method on the kernel API (`packages/kernel/src/api.ts`):

```ts
importStep(params: {
  stepBytes: ArrayBuffer;
  partName: string;
}): Promise<{
  brepBlobId: string;
  triangleCount: number;
  boundingBox: BoundingBox;
}>;
```

Uses `STEPControl_Reader` (geometry only — product structure already in JSON). Mesh tessellation reuses `Tessellator.ts`. `brepBlobId` from existing OPFS blob store.

For multi-body STEPs (`two-bodies.step`): import unifies all bodies into a single compound and stores it as the part's body. Documented limitation; multi-body parts get one importable solid.

### Conflict handling default = "Skip existing"

Rationale: user might run the macro twice. Default "Skip" prevents accidental clobber of in-progress edits. "Overwrite" is one click away when the user actually wants a clean re-migrate.

## Errors and partial state

| Stage | Error | Behavior |
|---|---|---|
| Macro: STEP export | Inventor returns translator error | Log `ERROR <relPath>: STEP export failed: <Inventor msg>`; **skip file**; continue batch. JSON sidecar not written. |
| Macro: cannot open referenced doc | `ReferencedDocument.Open` fails | Log; mark referenced occurrence `"ref": null` in JSON; continue. Importer renders broken occurrence as missing-part placeholder (4d). |
| Macro: parameter unsupported unit | e.g. `kg` on a parameter | Skip parameter; log warning; continue. |
| Macro: VBA runtime exception | Per-file `On Error GoTo` | Log with `Err.Description`; skip file; continue. Macro **does not abort entire batch** on per-file errors. |
| Importer: input not a directory | User cancelled / picked a file | Toast; dialog stays open. |
| Importer: schema validation fails | Wrong `schemaVersion`, missing required field | Log; **abort whole import**. Schema mismatch suggests user picked the wrong folder; fail loudly. |
| Importer: cycle in JSON ref graph | `A.iam.json` → `B.iam.json` → `A.iam.json` | Abort with cycle list. (Inventor can't produce; would mean corrupt export.) |
| Importer: missing JSON ref | `.iam.json` cites file not in input tree | Abort with explicit list. |
| Importer: kernel STEP read failure | OCCT rejects body | Log; skip part; continue. Assemblies referencing it import with broken-ref placeholders. |
| Importer: OPFS write failure | Quota / locked file | Abort with toast; partial state stays on OPFS. User retries with overwrite. |
| Importer: user cancel mid-batch | Cancel button | Loop exits cleanly between files. Already-written files stay. Summary shows partial counts. No rollback. |

## What is NOT migrated

Documented up front so the user can plan:

- **Inventor assembly constraints** (mate/flush/angle/insert) — geometry comes in by pose only.
- **iLogic rules** — no ZilInventor analogue.
- **Drawings (`.idw`/`.dwg`)** — sub-project 6 territory.
- **Sheet metal / weldment / weldment-symbol features** — bodies export as STEP geometry but feature-specific metadata is lost (verify with user during plan execution that this is acceptable for furniture-CAD scope).
- **Animations, presentations (`.ipn`)** — out of scope.
- **Inventor's custom appearances/textures** — only flat color captured; textured appearances flatten to base color.
- **Frame Generator structures** — bodies exported as STEP; generator metadata not retained.

## Testing strategy

### Layer 1 — Unit (`packages/app/src/import/__tests__/`)

Pure functions, no kernel/DOM/OCCT. Fast, run on every PR.

| Spec | Coverage |
|---|---|
| `inventorJsonSchema.spec.ts` | Fixtures: well-formed part/asm parses; rejects wrong `schemaVersion`; rejects missing `kind`; rejects malformed `pose`; preserves Cyrillic in keys/values + occurrence names. |
| `poseDecode.spec.ts` | Translation+quaternion JSON → `ComponentInstance.pose`; quaternion normalization; identity quat; 90° rotations around each axis. |
| `resolveOutputPaths.spec.ts` | Input rel path → OPFS rel path; collision rename (`SidePanel.zipt` exists → `SidePanel__<hash>.zipt`); `_external/` prefix; `..` segment rejection. |
| `buildPartDocument.spec.ts` | partJson + import result → v9 `PartDocument` with one `ImportedFeature`; `properties` flat-bag preserved; unsupported-unit parameters skipped with warning; `name` defaults to filename basename when `partNumber` empty. |
| `buildAssemblyDocument.spec.ts` | asmJson + path-resolution map → v9 `AssemblyDocument`; occurrences → `ComponentInstance[]` with correct partPath; constraints empty; `groundedComponentPaths` populated; `colorOverrides` keyed by `pathKey([occurrence.id])`. |
| `dependencyGraph.spec.ts` | Graph from JSON fixtures; topo order leaf-first; cycle detection; missing-ref detection. |

Fixtures: `packages/app/src/import/__tests__/fixtures/` — hand-authored small exemplars. No `.step` binaries (large blobs); STEP I/O exercised at Layer 2.

### Layer 2 — Kernel integration (`packages/kernel/src/occt/__tests__/StepIO.integration.spec.ts`)

Node + OCCT-via-WASM. Fixtures committed to `packages/kernel/src/occt/__tests__/fixtures/step/`:

- `cube-10mm.step` — single solid, no colors. Round-trips to known mesh tri count + bbox `[0,0,0,10,10,10]`.
- `two-bodies.step` — multi-solid file (importer unifies into compound; documented).
- `cyrillic-name.step` — STEP with Cyrillic product name (verifies UTF-8 path through STEP reader).

Small (a few KB each, hand-authored or one-time exported and inspected). No "real Inventor file" fixtures.

### Layer 3 — App E2E (`tests/e2e/import/`)

Single Playwright spec, two scenarios. Fixture tree under `tests/e2e/fixtures/inventor-export/`. `showDirectoryPicker` shimmed via existing OPFS pattern.

| Spec | Scenario |
|---|---|
| `import-from-inventor.spec.ts` | (a) **Single part**: cube fixture → import → part appears in OPFS → opening shows imported solid in viewport, properties panel shows iProperty values, parameters panel lists numeric parameters. (b) **Two-level assembly**: two parts + inner asm + outer asm → import → open outer `.ziasm` → browser pane shows two-level tree, viewport shows components placed correctly, BOM tab aggregates parts. |

### Layer 4 — Perf (`tests/perf/import-batch.spec.ts`)

Synthetic fixture: 50 parts + 10 assemblies (generated by helper script committed alongside spec). Asserts:

- p95 single-part import < 800 ms (cold OCCT) / < 200 ms (warm).
- 50-part batch end-to-end < 30 s on locked target hardware.
- OPFS write count proportional to file count (no quadratic blowup).

Threshold values: first run on target hardware sets numbers; test asserts within ±20%.

### Migration test (`packages/shared/src/__tests__/migrateManifest-v8-to-v9.spec.ts`)

- v8 part with no `properties` → migrates to v9 with `properties: {}`.
- v8 assembly with no `properties` → ditto.
- v9 file already current → no-op.
- v9 part with `imported` feature → migrates intact, `isImportedPart` true.
- Round-trip: v9 → save → load → equal manifest.

### Workspace gates per commit

- `pnpm -r typecheck` clean.
- `pnpm -r test:unit` green (existing 542+ tests + new 1.5 ones).

E2E + perf at phase boundaries (per existing convention).

### Out of scope for testing

- **Round-trip via Inventor** — Inventor's export is one-way out of the universe.
- **Differential migration** — one-time tool, no incremental import.
- **JSON schema migration across versions** — `schemaVersion: 1` is current; v2 ships its own migrator if it ever happens.

### Inventor-side testing

**No automated tests for the `.ivb` macro** — VBA needs a running Inventor instance with COM, which CI doesn't have. Verification is manual smoke (`docs/superpowers/manual-tests/subproject-1.5.md`) on the user's Inventor 2012 box, plus self-review of generated JSON by file inspection. Acceptable risk because the macro is small (~600–800 LOC), read-only on Inventor docs, and the importer-side has heavy CI coverage that catches schema drift instantly.

## Manual smoke test (`docs/superpowers/manual-tests/subproject-1.5.md`)

User-run checklist (Inventor 2012 box):

1. Single small `.ipt` with three numeric parameters and four iProperty fields → export → inspect JSON by hand → import in ZilInventor → open part → confirm geometry shape, parameters listed in Parameters panel, properties surface in BOM column.
2. Flat assembly with three placed instances of one part, two with color overrides → export → import → open `.ziasm` → confirm three components positioned correctly, two correctly colored.
3. Two-level assembly (`Cabinet.iam` containing `Door.iam` instances) → export → import → confirm sub-asm hierarchy preserved in browser pane.
4. Assembly referencing one part outside the input root → confirm `_external/` folder appears in output and the import succeeds.
5. Re-run macro on (1) into a populated output folder → confirm STEP+JSON overwritten without error; re-import with "Skip" → confirm no duplicate; re-import with "Overwrite" → confirm successful overwrite.

## Documentation deliverables

- `docs/superpowers/specs/2026-04-30-subproject-1.5-inventor-export-design.md` — this spec
- `docs/superpowers/manual-tests/subproject-1.5.md` — smoke test (written during plan execution)
- `docs/migration/INVENTOR-EXPORT-README.md` — user-facing: install the `.ivb`, run it, what the output folder looks like, what the importer does, what doesn't migrate
- `tools/inventor-export/ZilInventorExport.ivb` — the macro itself (committed to repo)

## Performance

Schema changes are zero-cost on existing files (one extra `{}` field). Imported parts evaluate in constant time (single blob read). New perf budget: import-batch p95 numbers in `tests/perf/import-batch.spec.ts` (calibrated on first run).

## Build sequence (sketch — full plan in writing-plans phase)

Rough phases, refined when the plan is written:

1. **Schema bump** — v8→v9 migration, `properties` field on documents, `ImportedFeature` variant, `isImportedPart` predicate, migration unit test. Workspace stays green.
2. **Kernel STEP I/O** — `StepIO.ts`, `importStep` RPC, integration tests with cube/two-bodies/cyrillic fixtures.
3. **Importer pure logic** — `inventorJsonSchema.ts`, `poseDecode.ts`, `resolveOutputPaths.ts`, `dependencyGraph.ts`, `buildPartDocument.ts`, `buildAssemblyDocument.ts` — all unit-tested with fixtures.
4. **Importer orchestrator** — `InventorImporter.ts` plus `ImportFromInventorCommand.ts` + dialog UI.
5. **Read-only enforcement** — guard each Model-tab Add* command with `isImportedPart`; BrowserPane edit-suppression on imported feature node.
6. **BOM extraction** — extend BOM aggregator to pull `properties.partNumber` / `properties.description`.
7. **E2E + perf specs** — `import-from-inventor.spec.ts`, `import-batch.spec.ts`. Calibrate perf thresholds on local run before commit.
8. **Inventor `.ivb` macro** — write `ZilInventorExport.ivb`. No CI coverage; review by reading the file and running it on the user's machine for the smoke test.
9. **User docs** — `INVENTOR-EXPORT-README.md`, `manual-tests/subproject-1.5.md`.
