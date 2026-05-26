# F10 — DXF Export · Design

**Date:** 2026-05-26
**Status:** Approved (brainstorming) — ready for implementation plan
**Feature:** Export a ZilInventor drawing sheet to DXF for downstream CNC / laser / CAM.

## Goal

Add a fourth drawing exporter (alongside PDF / SVG / PNG) that writes the **active sheet**
to an AutoCAD R12 (`AC1009`) ASCII DXF file. The DXF must carry the full richness of a
ZilInventor drawing sheet: projected view edges (visible + hidden), section hatch, stepped /
section cut lines, detail-region borders, hole-table geometry, dimensions, and annotations.

## Locked decisions (brainstorming Q&A)

1. **Generation:** hand-rolled minimal R12 (`AC1009`) ASCII writer. No new dependency; matches
   the existing pure-function renderer pattern.
2. **Coordinate space:** WYSIWYG sheet-scaled — export the sheet exactly as drawn (each view
   positioned by `positionMm` and scaled by its `ViewScale`), `1mm = 1 DXF unit`. Faithfully
   mirrors the SVG / PDF / PNG export path. (True-1:1 export is a deferred follow-up.)
3. **Content scope:** full fidelity with **simple entities** — all geometry PLUS dimensions and
   text annotations rendered as plain `TEXT` + `POLYLINE`/`LINE`, **not** native DXF
   `DIMENSION` / `HATCH` entities.
4. **Sheet scope:** active sheet → one `.dxf`, mirroring the SVG / PNG per-sheet exporters.
   (All-sheets / zip is a deferred follow-up.)

### Secondary decisions (defaulted, not separately asked)

- **Layers:** content-kind layers (table below).
- **Y-axis flip:** DXF is Y-up, our sheet/SVG space is Y-down → every coordinate is emitted as
  `dxfY = sheetHeightMm − svgY`. Applied uniformly so the drawing renders upright in DXF.
- **Curves:** all curved geometry (tessellated edges, angular-dimension arcs) is emitted as
  `POLYLINE`. Only **full circles** (detail-circle borders, balloons) use the `CIRCLE` entity —
  this sidesteps the DXF CCW arc start/end-angle pitfalls under the Y-flip.
- **Polyline entity:** R12 `POLYLINE` / `VERTEX` / `SEQEND` (not R13+ `LWPOLYLINE`) to preserve
  contour connectivity for CAM toolpathing and stay strictly R12-conformant.
- **Hidden edges:** `HIDDEN` layer + a minimal `DASHED` linetype defined in the `TABLES` section.

## Architecture

Three new files plus one wiring point, parallel to the existing exporters.

### 1. `packages/app/src/drawing/dxfWriter.ts` — low-level DXF builder (pure)

A small accumulator (builder object or array of group-code lines) with:

- **Document scaffolding:** `HEADER`, `TABLES` (LAYER table + minimal `DASHED` LTYPE),
  `ENTITIES`, `EOF` — matching `SECTION` / `ENDSEC` pairs.
- **Entity emitters:**
  - `line(layer, x1, y1, x2, y2)` → `LINE`
  - `polyline(layer, points)` → `POLYLINE` + `VERTEX[]` + `SEQEND`
  - `circle(layer, cx, cy, r)` → `CIRCLE`
  - `text(layer, x, y, height, value, rotation?)` → `TEXT`

All emitters take **already-transformed** (scaled + Y-flipped) coordinates — the writer is
coordinate-agnostic; the renderer owns the transform.

### 2. `packages/app/src/drawing/renderDrawingDxf.ts` — renderer (pure)

Signature mirrors SVG: `renderDrawingDxf(drawing: DrawingDocument, sheet: DrawingSheet, source: PartDocument | AssemblyDocument): string`.

Walks `sheet.views[]`, dispatches by view kind exactly as `renderDrawingSvg` does, applies each
view's `positionMm + ViewScale` transform (WYSIWYG) then the global `dxfY = H − y` flip, and
routes each content kind to its layer:

| Drawing content | DXF entity | Layer |
|---|---|---|
| Projected visible edges | `POLYLINE` | `VISIBLE` |
| Projected hidden edges | `POLYLINE` (DASHED) | `HIDDEN` |
| Section hatch segments | `LINE` | `SECTION-HATCH` |
| Stepped / section cut lines + arrows | `POLYLINE` | `SECTION-LINE` |
| Detail rect / circle border + callout | `POLYLINE` / `CIRCLE` | `DETAIL` |
| Dimensions (lines + value text) | `POLYLINE` + `TEXT` | `DIMENSIONS` |
| Annotations (leader / balloon / centerline) | `POLYLINE` / `CIRCLE` + `TEXT` | `ANNOTATIONS` |
| Hole-table grid + balloons + text | `POLYLINE` / `CIRCLE` + `TEXT` | `HOLE-TABLE` |
| Title-block border + text | `POLYLINE` + `TEXT` | `TITLE` |

Notes:
- **Section hatch:** SVG export currently *skips* hatch (a TODO). DXF emits it — `hatchSegments`
  are already `p0 → p1` line segments, so each becomes one `LINE` on `SECTION-HATCH`.
- **Dimension point-refs** (`edge-endpoint` / `edge-midpoint` / `arc-center`) are resolved from
  view edge geometry the same way the SVG renderer resolves them.
- Reuse helper logic from `renderDrawingSvg` where it is already extracted; otherwise re-derive
  the small transform / point-ref math in the DXF renderer rather than refactoring the working
  SVG renderer (surgical-change rule — DXF is a parallel path, not a refactor of SVG).

### 3. `packages/app/src/commands/ExportDrawingDxfCommand.ts`

Mirrors `ExportDrawingSvgCommand`: input `{ drawing, sheetId, source }` →
`renderDrawingDxf(drawing, sheet, source)` → `new Blob([dxf], { type: 'application/dxf' })` →
`triggerDownload(blob, { suggestedName: '${drawing.name}-${sheet.name}.dxf', mimeType: 'application/dxf', extension: 'dxf', description: 'DXF drawing' })`.

### 4. Wiring — `packages/app/src/shell/tabs/DrawingTab.tsx`

Add an "Export DXF" action next to the existing SVG / PNG / PDF export buttons, constructing and
dispatching `ExportDrawingDxfCommand` with the active sheet.

## Data flow

`DrawingTab` button → `ExportDrawingDxfCommand` → `renderDrawingDxf(drawing, activeSheet, source)`
→ DXF string → `Blob` → `triggerDownload`. Pure, synchronous, **no kernel call** — all geometry
already lives on the sheet (projection / hatchSegments / stepSegments / regionParent / dimensions
/ annotations).

## Error handling

- Renderer is total over a well-formed sheet. Views lacking `projection` (not yet regenerated)
  are **skipped**, exactly as the SVG renderer skips them.
- The command surfaces any throw via the existing command-error path.
- **No manifest change** — export is read-only; manifest stays **v19**.

## Testing (TDD red → green per slice)

- **`dxfWriter` unit tests** — each emitter produces the correct group-code pairs
  (`0/LINE`, `8/<layer>`, `10/20/11/21` coords, etc.); document scaffolding has matching
  `SECTION`/`ENDSEC` pairs and a terminating `EOF`; LTYPE/LAYER tables well-formed.
- **`renderDrawingDxf` unit tests** — fixture drawing (base + section + detail + dimensions +
  hole table) → assert per-layer entity counts, Y-flip correctness, WYSIWYG scale applied, hatch
  lines present on `SECTION-HATCH`, hidden edges on `HIDDEN`.
- **e2e `T-6-22`** (real-environment, CLAUDE.md §6) — in-app: open/create a drawing with a
  section + detail + dimensions, click **Export DXF**, capture the downloaded bytes, **parse the
  DXF back**, and assert structure: sections present, expected layers, entity counts, valid
  group-code pairing, coordinates Y-up. **This is the gate.**
- **perf `T63k`** — render DXF for a large fixture; assert p95 well under a generous budget
  (string-building is cheap).

## Out of v1 scope (clean follow-ups)

- Native DXF `DIMENSION` / `HATCH` entities (v1 uses `TEXT` + `LINE`/`POLYLINE`).
- True-1:1-size export (each view's real part-mm geometry, unscaled, for direct cutting).
- All-sheets-in-one-file or zip-of-sheets export.
- Paper-space layouts / block definitions.
- Per-entity color overrides (v1 colors are per-layer ACI defaults).
