# All-sheets / zip DXF export — design

**Date:** 2026-05-27
**Status:** Approved (brainstorming)
**Predecessor:** DXF 1:1 export (`5b22932`) — twentieth post-roadmap drawing follow-up.

## Problem

Both DXF export buttons export only the **active sheet**:

- "Export DXF" → `ExportDrawingDxfCommand { drawing, sheetId: drawing.activeSheetId, source }` → `renderDrawingDxf(drawing, sheet, source)` (sheet-scaled, WYSIWYG).
- "Export DXF (1:1)" → `ExportDrawing1to1DxfCommand { drawing, sheetId: drawing.activeSheetId }` → `renderDrawingDxf1to1(drawing, sheet)` (true machining mm, geometry-only).

A multi-sheet drawing has no way to export every sheet in one action. Furniture-CAD users send each sheet to a CNC/cut shop as its own job.

## Decision (locked in brainstorming)

1. **Packaging:** zip of one-DXF-per-sheet (not tiled-into-one-DXF, not sequential downloads). One DXF = one drawing-space is the CAD/CAM convention; each sheet imports as its own job.
2. **Scope:** both export modes get an all-sheets variant (WYSIWYG + 1:1).
3. **UI:** two new buttons, rendered only when `drawing.sheets.length > 1`. Existing 5 buttons unchanged.

## Architecture

Reuse the existing single-sheet renderers **verbatim** in a loop; add packaging + commands + UI only. Stays R12 (`AC1009`). No manifest bump (read-only export, no serialized shape change).

### New module: `packages/app/src/drawing/dxfZip.ts`

Thin wrapper over `fflate.zipSync` — synchronous, in-memory (NOT streaming, so no streamx main-thread backpressure deadlock that bit the tar.gz path).

```
buildDxfZip(entries: Record<string, string>): Uint8Array
```

- Encodes each DXF string to UTF-8 bytes, calls `zipSync({ 'name.dxf': bytes, ... })`, returns the zip `Uint8Array`.
- Pure function — no store, no DOM. Trivially unit-testable via `fflate.unzipSync` round-trip.

Add `fflate` as a **direct dependency** of `packages/app` (already present transitively via jspdf).

### New commands (mirror the single-sheet pair)

`packages/app/src/commands/ExportAllSheetsDxfCommand.ts`
```
constructor({ drawing: DrawingDocument; source: PartDocument | AssemblyDocument })
```
- Loops **all** `drawing.sheets`; for each calls `renderDrawingDxf(drawing, sheet, source)`.
- Builds entries `01-${sheet.name}.dxf`, `02-…` (1-based, zero-padded index prefix → reading order + collision safety).
- `buildDxfZip(entries)` → blob (`application/zip`) → `triggerDownload(blob, { suggestedName: \`${drawing.name}-all-sheets.zip\`, ... })`.
- Guard: empty `drawing.sheets` → throw (matches single-command sheet-not-found discipline). `apply` is the export side-effect; `revert` is a no-op (export is not undoable — same as the existing DXF commands).

`packages/app/src/commands/ExportAllSheets1to1DxfCommand.ts`
```
constructor({ drawing: DrawingDocument })
```
- Loops only sheets with **≥1 projected view** (`sheet.views.some(v => v.projection != null)`); skips projection-less sheets (a no-geometry 1:1 DXF is noise; matches the single button's `hasProjectedView` intent).
- For each calls `renderDrawingDxf1to1(drawing, sheet)`; entries `01-${sheet.name}-1to1.dxf`, …
- `buildDxfZip` → `triggerDownload(... suggestedName: \`${drawing.name}-all-sheets-1to1.zip\`)`.
- Guard: no sheet has a projected view → throw.

Index prefix derives from the sheet's position in `drawing.sheets` (stable order), so the 1:1 zip may have gaps (e.g. `01-`, `03-`) when sheets are skipped — acceptable; it preserves the source sheet order unambiguously.

### UI: `DrawingTab.tsx`

Two new buttons, rendered only when `drawing.sheets.length > 1`:

- **"Export All Sheets (DXF)"** — `disabled={!source}` (same gate as single WYSIWYG). onClick → `bus.execute(new ExportAllSheetsDxfCommand({ drawing, source }))`.
- **"Export All Sheets (1:1)"** — `disabled={!anySheetHasProjectedView}` where `anySheetHasProjectedView = drawing.sheets.some(s => s.views.some(v => v.projection != null))`. onClick → `bus.execute(new ExportAllSheets1to1DxfCommand({ drawing }))`.

Existing single-sheet buttons and gating unchanged.

**Superstring-label trap:** new and existing labels share substrings (an unanchored `/DXF/i` or `/1:1/i` matches multiple buttons) — anchor every `getByRole(name: /.../i)` regex with `^…$` so each query resolves to exactly one button.

## Data flow

`DrawingTab` button → `bus.execute(command)` → command loops sheets → per-sheet `renderDrawingDxf[1to1]` → `Record<name, dxfString>` → `buildDxfZip` (fflate `zipSync`) → `Uint8Array` → `Blob('application/zip')` → `triggerDownload`.

No store mutation, no kernel call (geometry already baked into `drawing.sheets`). `source` is used by `renderDrawingDxf` only for title-block metadata (unchanged from single-sheet).

## Testing (TDD, red→green per slice)

- **`dxfZip.spec.ts`** — round-trip: `buildDxfZip({a, b})` → `fflate.unzipSync` → exact UTF-8 bytes recovered; entry names match; empty input → valid empty zip.
- **`ExportAllSheetsDxfCommand.spec.ts`** — renders every sheet (mock renderer, assert call count + args), entry names `01-…`/`02-…`, mimeType `application/zip`, suggestedName, empty-sheets guard throws, revert no-op.
- **`ExportAllSheets1to1DxfCommand.spec.ts`** — skips projection-less sheets (entry count < sheet count), index prefix tracks source order (gaps allowed), no-projection guard throws, `-1to1` suffix.
- **`DrawingTab.spec.ts`** — both new buttons absent when 1 sheet, present when >1; disabled gating (`!source`, no-projection); anchored label regexes. (Confirm spec exists — memory says it went 4→5 buttons.)
- **e2e (real env, per CLAUDE.md §6) — the gate.** New `tests/e2e/drawing/<spec>` (T-6-25): create a 2-sheet drawing with projected geometry, click each all-sheets button, capture the downloaded `.zip`, `unzipSync` in-test, parse-back each `.dxf`, assert 2 entries with expected geometry (and 1:1 extent at true mm). Read the browser console — every drawing feature's prod gap surfaced only here.
- **Perf probe T63m** — `buildDxfZip` + full render of an N-sheet drawing well under budget (target like prior probes, ample headroom expected since it is string + sync zip).

## Out of scope

- Tiling multiple sheets into one DXF coordinate space.
- Native DIMENSION / HATCH entities (needs R2000/AC1015 bump).
- Changing the existing single-sheet buttons or their filenames.
- All-sheets export for the non-DXF formats (PDF/SVG/PNG) — DXF only this round.
