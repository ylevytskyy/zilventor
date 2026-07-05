---
title: Exporting Drawings
---
# Exporting Drawings
> Exports the active sheet (or every sheet) as DXF, PDF, PNG, or SVG for downstream CAM,
> review, or documentation use.

**Where:** Drawing ▸ Export · **Shortcut:** — · **Applies to:** drawing

## What it does

The Export panel turns a drawing sheet into a file you can hand off outside Zilventor:
`Export DXF` and `Export DXF (1:1)` for machining-oriented vector output, `Export PDF` for
review/print, `Export PNG` and `Export SVG` for raster/vector images, and — once the drawing
has more than one sheet — `Export All Sheets (DXF)` and `Export All Sheets (1:1)` to export
everything at once as a zip.

## Before you start

- `Export DXF`, `Export DXF (1:1)`, `Export PNG`, and `Export SVG` all need a projected view on
  the **active** sheet — they're disabled otherwise.
- `Export PDF` only needs a projected view **somewhere in the document** — any sheet, not
  necessarily the one you're currently viewing.
- `Export All Sheets (DXF)` and `Export All Sheets (1:1)` only appear in the ribbon once the
  drawing has more than one sheet; a single-sheet drawing won't show these buttons at all.

## Steps

### Export DXF / Export DXF (1:1)

1. Click **Export DXF** for standard drawing-scale DXF, or **Export DXF (1:1)** for true
   machining-size geometry, in the Drawing ▸ Export panel.
2. Choose where to save the file in the browser's download prompt.

*Result: a `.dxf` file downloads containing the active sheet's geometry at the chosen scale.*

### Export PDF

1. Click **Export PDF** in the Drawing ▸ Export panel.
2. Choose where to save the file.

*Result: a `.pdf` file downloads containing the drawing sheet(s).*

### Export PNG / Export SVG

1. Click **Export PNG** or **Export SVG** in the Drawing ▸ Export panel.
2. Choose where to save the file.

*Result: a raster (`.png`) or vector (`.svg`) image of the active sheet downloads.*

### Export All Sheets (DXF) / Export All Sheets (1:1)

1. Click **Export All Sheets (DXF)** for standard scale, or **Export All Sheets (1:1)** for
   machining scale, in the Drawing ▸ Export panel (only visible once the drawing has more than
   one sheet).
2. Choose where to save the file.

*Result: a `.zip` downloads containing one DXF per sheet, at the chosen scale.*

## Options

| Field | Meaning |
|---|---|
| (none — one-click export) | None of the export buttons open a settings dialog; each exports immediately using the sheet's current scale and content. |

## Tips & gotchas

- **DXF dimension fidelity** — the DXF exporter writes drawing dimensions as native R12
  `DIMENSION` entities, not just lines and text, so dimension annotations carry over as real
  DXF dimension objects rather than flattened geometry. Exact round-trip behavior when opened
  in AutoCAD hasn't been independently verified — check the result if that matters for your
  workflow.
- **`Export PDF`'s guard is document-wide, not per-sheet** — it's available as soon as any
  sheet in the drawing has a view, even if the sheet you're currently looking at doesn't. The
  other single-sheet exports (`Export DXF`, `Export DXF (1:1)`, `Export PNG`, `Export SVG`)
  only check the active sheet.
- **The "All Sheets" buttons don't just disable on a single-sheet drawing — they don't render
  at all.** If you're expecting to batch-export and only see the single-sheet buttons, add a
  second sheet first (see [Sheets](./sheets.md)).
- DXF output from here is the same kind of file downstream nesting/CAM tooling consumes — see
  [Manufacturing DXF](../manufacturing/manufacturing-dxf.md) if you're feeding these exports
  into a nesting or CAM pipeline.

## See also

- [Drawings](./index.md)
- [Manufacturing DXF](../manufacturing/manufacturing-dxf.md)
- [Export Formats](../reference/export-formats.md)

<!-- SCREENSHOT: the Export panel ribbon with all buttons visible on a multi-sheet drawing, showing the two All Sheets buttons present — TODO follow-up -->
