# DXF 1:1 Export — True Machining-Size, Geometry-Only

**Date:** 2026-05-27
**Status:** Approved (brainstorm)
**Predecessor:** F10 DXF export (`6996122`) + drawing-export source gap (`a22505d`)

## Problem

The existing DXF export (`renderDrawingDxf`) is **WYSIWYG sheet-space**: every view is drawn at
`positionMm + viewLocal × viewScale`, Y-flipped against the sheet. A 1000 mm panel shown at 1:5 exports
as 200 mm of geometry. The dimension *text* already carries the true model value, so the drawing is
*informationally* 1:1 — but the **geometry** is sheet-scaled. A furniture CNC/CAM consumer that machines
directly from DXF geometry (cut paths + hole positions) reads the wrong size.

## Goal

Add a second, **true-1:1** DXF export: emit view geometry at real machining millimetres (scale = 1.0),
re-spaced so views don't overlap. Geometry + holes only — the file is machine-fed, not human-read.

## Locked decisions (brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Which DXF v1 improvement | **True-1:1 geometry export** |
| Q2 | Multi-view layout at 1:1 | **All views, re-spaced at true size** |
| Q3 | Delivery + DXF version | **New button "Export DXF (1:1)", stay R12 (AC1009)** |
| Q4 | What travels with the geometry | **Geometry + holes only** (no dims / hatch / hole tables / title block) |

## Non-goals (deferred)

- Dimensions, section hatch, hole tables, title block in the 1:1 file (Q4 — the existing WYSIWYG DXF keeps those).
- Preserving the original 2D drafting arrangement (top-above-front, side-beside-front) at true size — v1 is a
  single horizontal row. Faithful 2D re-layout is a follow-up.
- Native `DIMENSION` / `HATCH` entities and any DXF version bump (Q3 — stays R12).
- All-sheets / zip export.

## Architecture

A new, self-contained renderer — **smaller** than the WYSIWYG one because it emits only edge geometry on two
layers and needs no `source` document.

### 1. `renderDrawingDxf1to1(drawing, sheet): string`
New file `packages/app/src/drawing/renderDrawingDxf1to1.ts`. Reuses `createDxfDocument` (unchanged).

**Per-view footprint** (model mm, scale = 1):
- `w = projection.bbox.maxX − projection.bbox.minX`
- `h = projection.bbox.maxY − projection.bbox.minY`

**Per-view transform → DXF Y-up:**
- `X = LX + (px − bbox.minX)`
- `Y = LY + (bbox.maxY − py)`   (the `maxY − py` flips SVG Y-down → DXF Y-up)

**Layout (v1 — single row):**
1. Collect views with a non-null `projection`.
2. Sort by original `positionMm.y` then `positionMm.x` (preserves on-sheet reading order).
3. Bottom-align (`LY = 0`); accumulate `LX += w + GAP` per view, `GAP = 20` mm.

**Emit:** `visibleEdges` → `VISIBLE` layer, `hiddenEdges` → `HIDDEN` layer, each as a `POLYLINE`
(skip edges with < 2 points). Holes are circular edges already tessellated into the projection — they
emit for free. No other entity types.

Builds natively in DXF Y-up — does **not** reuse the WYSIWYG `flipY`-against-sheet logic, and never reads
`source`.

### 2. `ExportDrawing1to1DxfCommand`
New file `packages/app/src/commands/ExportDrawing1to1DxfCommand.ts`. Mirrors `ExportDrawingDxfCommand` but
takes `{ drawing, sheetId }` (no `source`). Calls `renderDrawingDxf1to1`, downloads a `Blob` via
`triggerDownload` with `suggestedName: \`${drawing.name}-${sheet.name}-1to1.dxf\``. Non-undoable.

### 3. DrawingTab button
Add a second button **"Export DXF (1:1)"** immediately after the existing "Export DXF" button.
- `disabled={!hasProjectedView}` (not `!source` — 1:1 needs no source doc, so it works even when the
  source file is gone).
- `title`: `hasProjectedView ? 'Export geometry at 1:1 (machining size)' : 'No projected views to export'`.
- `onClick`: `bus.execute(new ExportDrawing1to1DxfCommand({ drawing, sheetId: drawing.activeSheetId }))`.

### Manifest

No bump (read-only export; v19 unchanged).

## Test plan (TDD slices)

### Unit — `renderDrawingDxf1to1.spec.ts`
1. **True size** [RED first]: one view of a 100×50 box stored at original scale 1:2 → output X-extent ≈ 100,
   Y-extent ≈ 50 (true size, **not** 50×25).
2. **Hidden layer**: hidden edges land on the `HIDDEN` layer; visible on `VISIBLE`.
3. **Y-up orientation**: a point at the model top maps to max Y (not min Y).
4. **No overlap + order**: two views → 2nd view's min-X ≥ 1st view's width + GAP; reading order preserved
   (sorted by original y then x).
5. **Skips**: views without a `projection` are skipped; empty sheet → valid DXF with empty ENTITIES.

### Command — `ExportDrawing1to1DxfCommand.spec.ts`
6. Produces a DXF string and calls `triggerDownload` with a `-1to1.dxf` suggested name; requires no `source`.

### e2e — `T-6-24` (real environment, CLAUDE.md §6)
Real part with a hole → create drawing → add base + projected views → click **"Export DXF (1:1)"** → parse the
downloaded DXF back → assert overall geometry extents equal the **true** part millimetres (not sheet-scaled) and
a hole circle edge is present. Read the browser console for silent errors. Store bridge: `window.__zilventorStore`.

### Perf — `T63l`
`renderDrawingDxf1to1` p95 < 50 ms on the standard drawing fixture.

## Risks / notes

- **bbox correctness:** layout depends on `projection.bbox` being the true model-space extent of the view's
  edges. Verify against the projector output; if `bbox` is in a different space than the edge points, derive the
  footprint from the edge points directly.
- **Mixed scales:** detail views (e.g. 2:1) become *smaller* at 1:1 and base views (1:5) *larger* — the single-row
  packing handles any mix because each footprint is computed independently.
- **Section views:** the cut outline is part of the section view's `visibleEdges`, so it exports as geometry with
  no special handling; the hatch is intentionally dropped (Q4).
