---
title: DXF Files
---
# DXF Files
> Three different ways to pull a `.dxf` file into zilventor, depending on whether you want a
> new sketch-based part, geometry added to a sketch you're already editing, or a trace-over
> reference on a drawing sheet.

**Where:** File tab ▸ **Import DXF…** · Sketch tab ▸ Import ▸ **Import DXF…** · Drawing tab ▸
**Import DXF Underlay…** / **Remove Underlay** · **Shortcut:** — · **Applies to:** part, drawing

## What it does

DXF entities (lines, arcs, circles, polylines, text) convert into zilventor **sketch
primitives** — real, editable 2D geometry — in two of the three entry points. The third entry
point (drawing underlay) is different: it doesn't create geometry at all, it just displays the
DXF as a static trace-over image on a drawing sheet.

Entities zilventor can't represent as a sketch primitive (some annotation types, unsupported
entity kinds) are silently skipped; the post-import status message reports how many entities
were imported versus skipped so you can sanity-check the result.

## Before you start

- File size cap is ~50 MB for all three DXF entry points; larger files are rejected up front
  with a size warning.
- **Import DXF into active sketch** requires an active part with a sketch currently open for
  editing — the button is disabled otherwise.
- **Import DXF Underlay** requires an open drawing document with an active sheet.

## Steps

### Import DXF as a new part

1. **File** tab ▸ **Import DXF…**.
2. Pick a `.dxf` file.
3. *Result: a new part opens containing a sketch built from the file's entities; the status bar
   reports how many entities were imported and how many were skipped.*

### Import DXF into the active sketch

1. Open a part and enter sketch edit mode (create or edit a sketch).
2. **Sketch** tab ▸ Import panel ▸ **Import DXF…**.
3. Pick a `.dxf` file.
4. *Result: the DXF's entities are added as new primitives inside the currently-open sketch,
   alongside anything already drawn there. Undo removes exactly the primitives this import
   added.*

### Import DXF as a drawing underlay

1. Open a drawing document and make sure the sheet you want the underlay on is active.
2. **Drawing** tab ▸ **Import DXF Underlay…**.
3. Pick a `.dxf` file.
4. *Result: the DXF is rendered as a static, non-geometric underlay on the active sheet, scaled
   and centered to fit within the sheet's margins.*
5. To remove it, **Drawing** tab ▸ **Remove Underlay** (disabled when the active sheet has no
   underlay).

## Options

| Field | Meaning |
|---|---|
| File picker filter | `.dxf` only |
| Size cap | ~50 MB across all three entry points |

## Tips & gotchas

- The underlay is per-sheet: switching to a different sheet in a multi-sheet drawing and
  importing again gives that sheet its own independent underlay.
- Underlay import and removal both go through the undo stack, so **Remove Underlay** followed
  by Ctrl+Z brings the same underlay back.
- "Import DXF into active sketch" only appears usable while you're actively editing a sketch —
  if the button is grayed out, open or create a sketch first.
- A DXF whose units or scale look wrong on import usually means the source file's drawing units
  don't match zilventor's assumption of millimeters — check the source CAD tool's export
  settings.

<!-- SCREENSHOT: the three Import DXF buttons in their respective tabs (File, Sketch, Drawing), side by side — TODO follow-up -->

## See also

- [Import & Migration overview](./index.md)
- [ABF Flatten Import](./abf-flatten-import.md)
- [File Formats](../reference/file-formats.md)
