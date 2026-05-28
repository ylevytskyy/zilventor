# Load a STEP file and view it in the app

**Date**: 2026-05-28
**Status**: Approved — ready for plan
**Predecessors**: Sub-project 1.5 (Inventor importer) built the entire STEP-ingest pipeline; this is a follow-up that exposes a stand-alone entry point.

## Goal

A user can pick a `.step` / `.stp` file via **File → Open** and immediately see it as a new part document in the 3D viewport with the existing orbit / pan / zoom controls. No other workflow changes.

## User-visible behavior

1. **File → Open…** dialog accepts `.step` / `.stp` in addition to today's `.zipt` / `.ziasm` / `.zidw`.
2. Selecting a STEP file:
   - Reads bytes, calls `kernel.importStep`, builds a new `PartDocument`.
   - Activates it (`setActivePart`) so the viewport renders the imported mesh.
   - Part name = STEP file basename with extension stripped (`MyKnob.step` → `"MyKnob"`, `Hinge.stp` → `"Hinge"`).
   - BrowserPane shows the part with the single `ImportedFeature` under origin work geometry.
3. On parse failure or empty shape, the existing `ErrorDialog` reports the cause; no part is activated.

## Non-goals (deferred)

- Placing the imported part into an assembly (next seed; will reuse `PlaceComponent` and/or the 5c hardware-library pattern).
- Drawings / section / projection of stand-alone imports. (Probably works for free via the existing `ImportedFeature` evaluator, but unverified — not in scope.)
- Save-back / export to STEP.
- Color, names, assembly hierarchy from STEP-CAF (XDE/XCAF). We use plain `STEPControl_Reader`.
- Auto-conversion of non-millimetre units declared in the STEP header. (STEP usually defaults to mm; deferred until a real file fails.)
- Multi-body explosion (one STEP root → multiple `PartDocument`s). MVP keeps all roots as one compound under one `ImportedFeature`.

## Reuse — what is already in place

| Piece | Location | Provided by |
| --- | --- | --- |
| OCCT STEP reader | `packages/kernel/src/occt/StepIO.ts` (`readStep`) | 1.5 |
| Kernel API `importStep` | `packages/kernel/src/api.ts` (`importStep({stepBytes, partName})`) | 1.5 |
| `ImportedFeature` schema (`kind:'imported', id, sourceStep, bodyRef`) | `packages/shared/src/types.ts` | 1.5 |
| ImportedFeature evaluator (produces a `NamedShape` for the viewport/section/projector) | kernel | 1.5 |
| Brep-blob cache keyed by `bodyRef` | `importedShapeCache` in `api.ts` | 1.5 |
| `.zipart` pack/unpack carries the brep blob | `ProjectPacker` | 1.5 |
| Viewport renders any `PartDocument` with origin work-geometry + body features | existing | — |
| `FileTab.handleOpen` already branches by extension among `.zipt` / `.ziasm` / `.zidw` | `packages/app/src/shell/tabs/FileTab.tsx` | existing |

## What changes

### 1. New helper — `packages/app/src/import/importStepIntoNewPart.ts`

Single exported function:

```ts
export async function importStepIntoNewPart(
  file: File,
  kernel: KernelApi,
): Promise<{ partId: string; part: PartDocument }>;
```

Responsibilities:

1. Read `file.arrayBuffer()`.
2. Compute `partName = file.name` with trailing `.step` / `.stp` (case-insensitive) stripped. Reuse `stepFilenameBasename()` from `buildPartDocument.ts` after extracting it into the shared origin-features module.
3. Call `kernel.importStep({ stepBytes, partName })` → `{ brepBlobId, … }`.
4. Build a minimal `PartDocument`:
   ```ts
   {
     id: <fresh uuid>,
     name: partName,
     units: 'mm',
     parameters: {},
     featureTree: [
       ...ORIGIN_FEATURES,                       // shared with buildPartDocument
       { kind: 'imported', id: <fresh uuid>, sourceStep: file.name, bodyRef: brepBlobId },
     ],
     properties: {},
     materials: [],
     hardware: [],
   }
   ```
5. Pack to `.zipart` bytes in-memory via `ProjectPacker`.
6. `kernel.loadFromBytes(packed)` → `partId`.
7. `kernel.getPart(partId)` → `part`.
8. Return `{ partId, part }`.

`ORIGIN_FEATURES` is the same 7-feature seed already used by `buildPartDocument.ts`. Extract it into a shared module (`packages/app/src/import/originFeatures.ts`) so both callers consume the same list — this is a small targeted improvement in code we're touching anyway.

### 2. `FileTab.handleOpen` — extend accept list + branch

```ts
const [handle] = await showOpenFilePicker({
  types: [
    { description: 'ZilInventor part',     accept: { 'application/zilinventor-part':     ['.zipt']  } },
    { description: 'ZilInventor assembly', accept: { 'application/zilinventor-assembly': ['.ziasm'] } },
    { description: 'ZilInventor drawing',  accept: { 'application/zilinventor-drawing':  ['.zidw']  } },
    { description: 'STEP file',            accept: { 'application/step':                 ['.step', '.stp'] } },
  ],
});
const file = await handle.getFile();
if (/\.stp?$/i.test(file.name) || /\.step$/i.test(file.name)) {
  const { part } = await importStepIntoNewPart(file, kernel);
  setActivePart(part);
  setStatus('Imported');
  return;
}
// …existing `.zipt`/`.ziasm`/`.zidw` branches unchanged.
```

The extension check is the only new branching logic in `handleOpen`.

## Data flow

```
File.step
  → ArrayBuffer
  → kernel.importStep({stepBytes, partName})    [reads STEP, caches brep blob, returns brepBlobId]
  → PartDocument { featureTree: [...origin, ImportedFeature(bodyRef = brepBlobId)] }
  → ProjectPacker.pack(part) → .zipart bytes (in-memory)
  → kernel.loadFromBytes(bytes) → partId
  → kernel.getPart(partId)
  → setActivePart(part)
  → existing viewport renders mesh
```

## Error handling

| Failure | Surface | Message |
| --- | --- | --- |
| `readStep` parse failure (`IFSelect` status ≠ `RetDone`) | `ErrorDialog` via existing `handleOpen` catch | `"Couldn't read STEP file: <reason>"` |
| Empty shape | `ErrorDialog` | existing `"STEP produced an empty shape"` |
| OPFS pack/load failure | `ErrorDialog` | `"Open failed: <message>"` (existing path) |
| User cancels picker | silent (`AbortError`) | existing |

No new error types or codes.

## Testing

### Unit — `packages/app/src/import/__tests__/importStepIntoNewPart.spec.ts`

- Mocks `kernel.importStep` and `kernel.loadFromBytes`.
- Asserts the built `PartDocument` has:
  - `name = basename(file.name)`,
  - `featureTree[0..6] === ORIGIN_FEATURES`,
  - `featureTree[7].kind === 'imported'` with `sourceStep === file.name` and `bodyRef === brepBlobId`.
- Asserts `kernel.importStep` is called with `partName = basename`.
- Asserts `kernel.loadFromBytes` receives the packed `.zipart` bytes and `setActivePart` is called with the round-tripped part.

### Integration — kernel side already covered

`packages/kernel/src/occt/__tests__/StepIO.integration.spec.ts` exercises `readStep` against real OCCT.

### E2E — `tests/e2e/load-step-file.spec.ts` (one new test)

Fixture: a tiny `tests/fixtures/cube-20mm.step` (committed, ~3 KB).

Steps:
1. Boot app.
2. `File → Open…` → choose `cube-20mm.step` via Playwright-injected file handle.
3. Assert status text becomes `"Imported"`.
4. Assert BrowserPane shows a part named `"cube-20mm"`.
5. Assert viewport canvas has non-empty draw calls / non-zero bounding box (use `window.__zilventorStore` introspection — the existing bridge other drawing e2e tests use).

## Risks and the one investigation the plan must front-load

The Inventor importer was the only previous caller of `kernel.importStep` + `buildPartDocument`. It may set things up that the stand-alone path can't replicate, e.g.:

- `importedShapeCache` may need to be seeded **before** `loadFromBytes` triggers `execute()`, otherwise the `ImportedFeature` evaluator faults with a missing-blob error.
- `kernel.loadFromBytes` may bail if the packed `.zipart` references a partId that doesn't match the manifest, or if there's an in-memory partId collision.
- `ProjectPacker.pack` may require the brep blob to be supplied as a side-channel argument (in 1.5, the importer pipeline owns the blob bytes separately from the kernel cache).

**Plan front-loads this**: Task 1 is a tiny red end-to-end probe — write the minimal `importStepIntoNewPart` against a known-good in-memory STEP, run it, see what blows up. Fix only what's strictly necessary in `api.ts` / `ProjectPacker.ts`. This investigation may grow into 1-2 small kernel-side patches but does not change MVP scope.

## Estimated size

- ~150 LOC of net new app-layer code.
- 0 LOC of new kernel API (we reuse `importStep` + `loadFromBytes`).
- ≤ ~30 LOC of kernel patches if the front-loaded probe surfaces real gaps.
- 1 implementer batch, plus the front-loaded investigation task.
- 1 new e2e test, 1 new unit test.
- No manifest bump (v19 already covers `ImportedFeature`).

## Decisions captured

- **Format**: STEP (`.step` / `.stp`) only.
- **Use case**: hardware / fixture library — primary driver, though MVP only delivers open + view; the place-into-assembly follow-up will turn this into an actual hardware-library path.
- **Integration**: imports become full part documents (`PartDocument` with `ImportedFeature`), not opaque assembly components.
- **MVP**: open + view only. No drawings, BOM, nesting, place-into-assembly, or export-back-to-STEP.
- **Entry point**: extend the existing **File → Open…** dialog (not a separate "Import STEP" button). One user gesture; the dialog's own accept list disambiguates.
- **Kernel wiring**: reuse `ProjectPacker` + `kernel.loadFromBytes` round-trip; no new `kernel.registerPart` API.
