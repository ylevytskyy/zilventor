# Drawings MVP — Design Spec

**Date:** 2026-05-28
**Status:** Approved (design); per-chunk plans to follow
**Goal:** A user can produce a genuinely usable, Inventor-2012-compatible furniture construction drawing, and can import an existing Inventor DXF drawing as a reference. First-angle / ISO-metric conventions throughout.

## MVP definition (acceptance)

1. **Export fidelity** — the exported DXF (R12 / AC1009, the only format Inventor 2012 opens cleanly) carries the dimensions, labels, headings, and title-block fields a workshop needs to build from.
2. **Usable production drawing** — radial/diametric dims on holes, view labels + scale, section headings, complete title block, and a parts list on the sheet.
3. **Import** — an Inventor-exported DXF opens in ZilVentor as a non-editable reference underlay.
4. **Inventor 2012 compatible** — DXF opens without error; first-angle projection symbol present.

## Locked decisions (brainstorm)

- **Import meaning:** DXF **reference underlay** (non-editable backdrop), *not* editable-DXF parsing and *not* "use the existing 3D import". Round-tripping arbitrary `.idw` is out of scope (no public Inventor SDK).
- **Projection convention:** **First-angle (ISO/metric)**. Current code is third-angle — switch the neighbour table.
- **Build order:** **Export-fidelity first** (A–E), then import (F).
- **First-angle is a hard global switch** (no toggle). Existing third-angle drawings re-lay-out on regenerate. YAGNI for a single metric shop.
- **Parts list includes hardware rows** with empty dimension cells (Inventor-like).

## Out of scope (deferred)

- Native DXF `HATCH` entity — R12/AC1009 has none; loose `LINE` segments on `SECTION-HATCH` are the correct R12 representation and render identically in Inventor 2012.
- ISO 5457 drawing frame with zoning grid / fold / registration marks — overkill for A3/A4 cabinet drawings.
- Center-marks / centerlines in DXF — the hole table already carries every hole's X/Y coordinate + tag.
- Editable DXF import (orphaned non-parametric entities; architecturally incoherent).
- DWG export, IDW import/export.
- Auto-placed parts-list balloons (needs `componentId` in `Edge2D.sourceFaceIds` — a kernel change). Manual balloons only.

## Architecture context

- Drawings are `.zidw` documents, projection-derived from 3D parts/assemblies. Flat 2D import therefore cannot become parametric — hence underlay-only.
- **Three parallel renderers** must each be updated for any visible element: `renderDrawingSvg.ts` (canvas/screen), `renderDrawingPdf.ts` / PNG (print), `renderDrawingDxf.ts` (export). This is the dominant cost multiplier — every visual chunk touches all three.
- Annotations are a typed discriminated union (`DrawingAnnotation` in `packages/shared/src/drawing/types.ts`); the `kind:'holeTable'` annotation is the precedent for a sheet-placed table (pure compute fn + dual/triple renderer + `Add…Command`).
- Drawing commands must set **both** `activeDocument` and `activeDrawing` on `setState` (systemic gotcha, see `drawingDocState()` helper).

## Chunks

### Chunk A — Radial & diametric dimensions  *(highest value: every hole carries a ⌀)*

Current state: type (`types.ts:253-254`), `ToolMode` `'addRadial'`/`'addDiametric'` (`toolMode.ts:13-14`), ribbon buttons (`DrawingTab.tsx:181-184`), `AddDimensionDialog` (`AddDimensionDialog.tsx:49`), and on-canvas render (`DimensionElement.tsx:507-508`) **all exist**. Missing pieces:

- **A1 — arc-center resolver.** `arc-center` PointRef falls through to `edge.points[0]` (circumference, not center) in **both** `renderDrawingDxf.ts:40-51` and `renderDrawingSvg.ts:747-758`. Add a branch computing the circle center (circumcenter from three arc points; reuse the circumcenter math at `renderDrawingDxf.ts:462-470`). *Slice: failing test on resolved center → fix both resolvers.*
- **A2 — create-side click handler.** `DrawingCanvas.tsx:889` is a stub comment for these modes. Wire: pick arc/circle edge → set `addDimensionDialogState` → on OK dispatch `AddDrawingDimensionCommand`. *Slice: test that addRadial click on an arc edge produces a `kind:'radial'` dim via the bus.*
- **A3 — DXF emit.** `emitDimension()` (`renderDrawingDxf.ts` ~545, after angular). `'radial'`: leader from center to perimeter at `dim.angleDeg`, text `R<r>`, R12 `DIMENSION` dimType 4. `'diametric'`: through-diameter line, text `%%C<2r>`. *Slice: parse-back test asserts R/⌀ DIMENSION entities.*
- **A4 — PDF emit.** Mirror in `renderDrawingPdf.ts`.

### Chunk B — First-angle projection

- **B1 — table swap.** `deriveProjectedOrientation.ts` neighbour table third-angle → first-angle (`direction:'top'`→`'bottom'`, `'right'`→`'left'`, etc.). Update the locked third-angle test cases to first-angle. *Slice: rewrite the orientation table tests red→green.*
- **B2 — projection-angle symbol.** First-angle ISO symbol (truncated-cone two-view glyph) near the title block, all three renderers. *Slice: renderer test asserts the symbol primitives.*

### Chunk C — View labels & headings

- **C1 — view label + scale** under base/projected views ("VIEW" name + `SCALE n:m`), all three renderers, from `projection.bbox` + view scale.
- **C2 — section heading** "SECTION A-A" under section views (detail captions already exist at `renderDrawingSvg.ts:204-206`), all three renderers.

### Chunk D — Title-block completeness

- Render `approvedBy` + `notes` (resolved in `titleBlock.ts:9,14` but dropped by every emitter). Add to `TitleBlockFields` and the SVG/PDF/DXF title-block emitters. Grow title-block height or add a notes row as needed. *Notes row doubles as the general-tolerance slot ("UNLESS NOTED ±0.5 mm").*

### Chunk E — Parts list on sheet

- New `kind:'partsList'` `DrawingAnnotation` (`positionMm`, snapshot `rows[]`, `columns[]`) following `holeTable.ts`.
- `computePartsListRows` pure fn in `packages/shared/src/drawing/partsList.ts`.
- `AddPartsListCommand`: join `aggregateBomRecursive()` (item#/qty/name, stable `bomItemNumbers`) with `aggregateCutListRecursive()` (L/W/T, material, edge-bands) by part path; **snapshot** rows at command time (caches passed in by caller, falling back to BOM-only if cut-list cache is cold — mirrors the export-source-gap pattern).
- Columns: Item │ Qty │ Part Name │ Material │ L×W×T │ Edge-bands. Hardware rows included with empty dim cells.
- ToolMode + ribbon button; three renderer branches mirroring `renderHoleTableAnnotation`.

### Chunk F — DXF reference-underlay import

- Add `dxf-parser` dependency.
- `ImportDxfUnderlayCommand`: parse `LINE`/`POLYLINE`/`LWPOLYLINE`/`CIRCLE`/`ARC`/`TEXT` into a non-editable underlay layer stored on the drawing (a drawing-level underlay structure, not editable annotations).
- Render the underlay (distinct muted style) in SVG + PDF. Excluded from DXF re-export (read-only reference, avoids round-trip confusion). MTEXT / block-insert / lineweights deferred.

## Testing strategy

- TDD per slice (red → green → refactor); each slice names its failing test.
- DXF chunks: **parse-back** assertions (read the emitted DXF entities), not string matching.
- One real-geometry e2e per chunk where it touches the live UI (DrawingCanvas), via the `window.__zilventorStore` bridge and `await import('/src/commands/…')`.
- Perf probe where a chunk adds a hot path (parts-list aggregation, underlay render).
- Run the **full** `test:unit` before claiming a chunk done (cross-file regressions are invisible to single-file runs).

## Risks

- **Three-renderer drift** — a visible element rendered in only one path is the recurring bug class. Each visual slice must touch SVG + PDF + DXF.
- **First-angle switch breaks locked third-angle tests** — expected; rewrite them as part of B1, don't suppress.
- **Parts-list cache coldness** — `AddPartsListCommand` from a drawing context may have a cold cut-list cache; fall back to BOM-only rows gracefully.
- **arc-center kernel assumption** — assumes arc edges store circumference points, not center, in `edge.points`. Verify against real kernel output in the A1 test before trusting the circumcenter fix.
