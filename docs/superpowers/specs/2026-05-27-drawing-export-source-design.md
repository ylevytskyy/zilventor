# Drawing-export source gap — design

**Date:** 2026-05-27
**Status:** Approved (brainstorming) — ready for plan
**Area:** Sub-project 6 (2D drawing generation) — post-roadmap follow-up #18
**Manifest impact:** none (read-only feature; no serialized shape change — stays v19)

## Problem

When a drawing is the active document, all four export buttons in `DrawingTab`
(PDF / SVG / PNG / DXF) are disabled in the normal new-drawing and reopen
workflows. Users literally cannot click Export on a drawing they are looking at.

**Root cause (verified):**

- `setActiveDocument({ kind: 'drawing' })` sets both `activePart` and
  `activeAssembly` to `null` (`packages/app/src/store/useAppStore.ts:368-373`).
- `DrawingTab` derives the export source as
  `const source = useAppStore((s) => s.activePart ?? s.activeAssembly)`
  (`packages/app/src/shell/tabs/DrawingTab.tsx:15`).
- Each export button is `disabled={!source}`
  (`DrawingTab.tsx:260, 273, 290, 307`).

So whenever a drawing is active, `source` is `null` and every export button is
dead. The F10 DXF-export e2e had to inject a stub `PartDocument` into the store
to re-enable the button — confirming this is a real, pre-existing production gap,
not a test artifact.

## Key insight — the export does not need a *live* model

The export render functions use `source` for **only two** things:

1. **Title-block metadata** — `resolveTitleBlock(drawing, sheet, source, …)`
   reads exactly `source.name` (part-name fallback) and
   `'materials' in source ? source.materials[0]` (material name)
   (`packages/shared/src/drawing/titleBlock.ts:46, 60`). Both fields exist on
   `PartDocument` and `AssemblyDocument`.
2. **Part vs. assembly discrimination** for hole-table annotations —
   `renderHoleTableAnnotation(…, source)` branches on `'featureTree' in source`
   (part-only). `PartDocument` has `featureTree`; `AssemblyDocument` does not.

**All view geometry is already baked into `drawing.sheets[].views[].projection`
at save time.** The render functions never read `drawing.source`, never call the
kernel, and never need a live model — they only need a document *object* carrying
`name` + `materials` (+ the `featureTree` discriminator). The current
`disabled={!source}` gate is therefore a UX accident, not a functional
requirement.

## What we already have (and discard)

- `activateDrawingDocument.ts` (reopen path) **already unpacks the full
  `AssemblyDocument`** for assembly-sourced drawings
  (`unpackAssembly(asmBytes)` → `asmDoc`, line 35) and then **throws it away**,
  keeping only `activeDrawingSourceComponents` + fingerprint.
- `CreateDrawingCommand.apply()` has the full `PartDocument`/`AssemblyDocument`
  in hand — it captures `activePart.id` (line 37) and `activeAssembly`
  (`activeAsmDoc`, line 39) *before* `setActiveDocument` nulls them.
- `loadDrawingSource.ts` reads the source `.zipt` bytes (line 84) on the part
  reopen/create path; it just doesn't unpack the manifest into a document.
- `unpackProject(bytes).manifest` is the `{ formatVersion, kind, createdAt,
  appVersion, document }` envelope (see `resolvePartInfo.ts:13-14`,
  `AddHardwareCommand.ts:99-102`). The `PartDocument` is `migrateManifest(manifest).document`.

So the source document is essentially **free to capture** at every load site.

## Design — decisions locked in brainstorming

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Where the export source comes from | **Store slot at activation** (stash the already-loaded document; not lazy-resolve, not source-optional) |
| Q2 | Assembly-sourced drawings in v1 | **Full parity** — part *and* assembly export both work |
| Q3 | Behavior when source genuinely fails to load (reopened `.zidw`, source file deleted/moved) | **Keep buttons disabled** — slot is null → `disabled` holds; defer source-optional export |

### 1. New store slot

In `packages/app/src/store/useAppStore.ts`, alongside the existing
`activeDrawingSource*` slots (declared ~line 103-117, initialized ~line 353-355):

```ts
/** The resolved source document (PartDocument | AssemblyDocument) for the active
 *  drawing, used by the export buttons for title-block metadata + part/assembly
 *  discrimination. Set wherever a drawing's source is loaded (CreateDrawingCommand,
 *  activateDrawingDocument). NOT reset by drawingDocState() — same lifecycle
 *  contract as activeDrawingSourcePartId. Null when no source is loaded (missing
 *  source file → export buttons correctly stay disabled). */
activeDrawingSourceDocument: PartDocument | AssemblyDocument | null;
```

Initialize to `null`. Add to the `AppState` interface so `DrawingTab`'s selector
is typed. Existing `setState({ … } as never)` source-slot writes extend to carry
this slot (same `as never` pattern already in use).

### 2. `loadDrawingSource` — return the unpacked part document

Extend `LoadDrawingSourceResult` with `sourceDocument: PartDocument | null`.

- **Real path** (OPFS bytes read succeeds): after reading `bytes`, also
  `unpackProject(bytes)` → `migrateManifest(manifest)` → `.document as PartDocument`.
  Return it as `sourceDocument`.
- **Fallback (test-fixture) path** (OPFS read fails, `partPath` stem ==
  `activePartId`): no bytes/manifest available → `sourceDocument: null`.
- Cache stores `sourceDocument` alongside `partId` + `sourceFingerprint`.

### 3. `CreateDrawingCommand`

- Capture the active source document before `setActiveDocument` (the command
  already captures `activeAsmDoc`; add a `const activePartDoc = state.activePart`).
- **Part branch:** set
  `activeDrawingSourceDocument: loadResult.sourceDocument ?? activePartDoc`
  (the `??` covers the e2e fixture path where the real OPFS unpack is skipped but
  `activePart` is the source).
- **Assembly branch:** set `activeDrawingSourceDocument: activeAsmDoc`.
- **`revert()`:** snapshot the prior `activeDrawingSourceDocument` into a private
  field and restore it, mirroring the existing three source-slot rollbacks
  (lines 10-12, 138-142).

### 4. `activateDrawingDocument` (reopen)

- **Assembly success branch** (line 42 setState): add
  `activeDrawingSourceDocument: asmDoc` (already unpacked at line 35).
- **Part success branch** (line 74 setState): add
  `activeDrawingSourceDocument: <sourceDocument from loadDrawingSource>`.
- **Every failure / cleanup path** that nulls the other source slots (assembly
  catch ~line 52, part catch ~line 90) **also nulls
  `activeDrawingSourceDocument`** → Q3 behavior (missing source ⇒ disabled)
  falls out automatically.

### 5. `DrawingTab`

```ts
const source = useAppStore((s) => s.activePart ?? s.activeAssembly ?? s.activeDrawingSourceDocument);
```

`disabled={!source}` and the four button handlers are unchanged. Part- and
assembly-sourced drawings now both enable all four export buttons.

### Rejected alternatives

- **Lazy re-resolve from `drawing.source.partPath` on each export click** —
  adds async-on-click + a duplicate disk read of bytes we already loaded at
  activation. No upside.
- **Make `source` optional across all four export commands + degrade title
  block / hole tables** — touches all renderers, loses material/parameter
  title-block fidelity. (This is the deferred Q3-B path, only relevant for the
  missing-source edge case.)
- **Change `setActiveDocument` to keep `activePart` when a drawing whose source
  is that part is activated** — breaks the load-bearing invariant that
  `activePart === null` while a drawing is active (ribbon, autosave routing, the
  `activeDrawing` audit all depend on it). A parallel slot is the surgical move.

## Components & data flow

```
CreateDrawingCommand.apply()      activateDrawingDocument()  (reopen)
  capture activePart / activeAsmDoc     unpack asmDoc / loadDrawingSource
        │                                       │
        ▼                                       ▼
  setState activeDrawingSourceDocument = <part|assembly doc | null>
        │
        ▼
  useAppStore.activeDrawingSourceDocument
        │  (NOT reset by drawingDocState)
        ▼
  DrawingTab: source = activePart ?? activeAssembly ?? activeDrawingSourceDocument
        │
        ▼
  Export {PDF,SVG,PNG,DXF}Command  →  render* (resolveTitleBlock, hole-table discriminator)
        (geometry already in drawing.sheets — source used for metadata only)
```

## Error handling

- Source file missing/unreadable on reopen → load fails → all source slots
  (including `activeDrawingSourceDocument`) null → buttons stay disabled; the
  existing "Source part not found — Regenerate disabled" status notice already
  covers the messaging. No new error path.
- Malformed manifest in `unpackProject` → caught by the existing try/catch in
  both load sites → slot null → disabled. No crash.

## Testing

### Unit (TDD red→green per slice)

1. **`loadDrawingSource` returns `sourceDocument`** — real path: stub `opfs.read`
   to return packed bytes; assert `result.sourceDocument.name`. Fallback path:
   OPFS read throws + stem matches `activePartId`; assert `sourceDocument === null`.
2. **`CreateDrawingCommand` sets the slot** — part: assert
   `activeDrawingSourceDocument` is the loaded/captured `PartDocument`; assembly:
   assert it's `activeAsmDoc`. `revert()`: assert the prior value is restored.
3. **`activateDrawingDocument` sets the slot** — part reopen + assembly reopen
   set it; failure path nulls it.
4. **`drawingDocState()` no-reset guard** — extend the existing
   source-slot-preservation invariant test to assert
   `activeDrawingSourceDocument` survives a `drawingDocState()` write.
5. **`DrawingTab` enables buttons from the slot alone** — render with
   `activePart`/`activeAssembly` null and `activeDrawingSourceDocument` set;
   assert the four export buttons are **enabled**. (RED before the DrawingTab
   selector change — they are disabled today.)

### E2E (real-environment — the actual gate, CLAUDE.md §6)

- **`T-6-23` (or next free id):** create/open a drawing backed by a **real OPFS
  part** (no injected stub). Assert all four export buttons are **enabled** —
  this is the regression proof: the F10 e2e injected a stub `PartDocument`; this
  e2e proves the stub is no longer required. Trigger at least one export (DXF)
  and confirm the command runs end-to-end.
- **Assembly variant:** same assertion for an assembly-sourced drawing (Q2
  parity) — open a `.zidw` whose source is a real `.ziasm`; assert buttons
  enabled.
- Re-run the gate locally and read the browser console back (every prior drawing
  feature surfaced a production gap only visible in the real flow).

### Perf

Negligible — activation does one extra `unpackProject` (manifest JSON parse) on
bytes already read for the kernel load. No new perf spec; note the single extra
unpack in the plan.

## Scope

~5 source files (`useAppStore.ts`, `loadDrawingSource.ts`,
`CreateDrawingCommand.ts`, `activateDrawingDocument.ts`, `DrawingTab.tsx`) +
their tests + one (two-variant) e2e. `drawingDocState.ts` gets a comment update
only (its no-reset behavior already covers the new slot since it whitelists what
it *does* reset). Single implementation plan.

## Out of scope (deferred follow-ups)

- **Source-optional export** (Q3-B) — exporting a drawing whose source file is
  gone, using only baked-in geometry with a degraded title block.
- **DXF v1 follow-ups** — native `DIMENSION`/`HATCH` entities, true-1:1-size
  export, all-sheets/zip.
- **Assembly section Regenerate completion** — unrelated kernel work.
