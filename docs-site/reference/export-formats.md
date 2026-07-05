---
title: Export Formats
---
# Export Formats
> Every export the app can produce — what it contains, what format it lands in, and exactly where to click for it.

## File menu

| Export | Format | Where |
|---|---|---|
| Export Image | `.png` | File tab ▸ **Export Image** (has a "Transparent" background option). Screenshots the current viewport. |
| Export STEP | `.step` | File tab ▸ **Export STEP**. Part documents export directly; assemblies recursively resolve every nested component into one file. Disabled on drawings. |
| Export STL | `.stl` (binary) | File tab ▸ **Export STL**. Same part/assembly resolution as STEP. Disabled on drawings. |

## Drawing (.zidw) exports

Where: **Drawing tab ▸ Export** panel.

| Export | Format | Scope | Notes |
|---|---|---|---|
| Export PDF | `.pdf` | All sheets | One multi-page PDF for the whole drawing. |
| Export DXF | `.dxf` | Active sheet only | Scaled to the sheet's view scale; includes dimensions, hatch, hole tables, title block, and source geometry. |
| Export DXF (1:1) | `.dxf` (suffix `-1to1.dxf`) | Active sheet only | Geometry only, at true model millimetres — ignores the sheet's view scale. Views are re-laid-out edge to edge. No dimensions, hatch, hole tables, or title block. This is the "machining size" export, distinct from the regular DXF export above. |
| Export PNG | `.png` | Active sheet only | |
| Export SVG | `.svg` | Active sheet only | |
| Export All Sheets (DXF) | `.zip` (one `.dxf` per sheet) | All sheets | Only shown when the drawing has more than one sheet. |
| Export All Sheets (1:1) | `.zip` (suffix `-1to1.zip`) | All sheets with a projected view | Only shown when the drawing has more than one sheet. |

There is no "all sheets" batch export for PNG or SVG — only DXF has a multi-sheet zip variant, since PDF is already inherently all-sheets.

## Furniture ▸ Присадка (drilling) exports

Where: **Furniture tab ▸ Присадка** panel.

| Export | Format | Notes |
|---|---|---|
| Export CSV (Boring) | `.csv` | All bores aggregated recursively across the whole assembly. |
| Export DXF (Boring) | `.dxf` | Same aggregated bore set; surfaces any preflight problems as toasts before exporting. |
| Export DXF (Manufacturing) | `.zip`, or a single `.dxf` in combined mode | One DXF per panel, grouped into per-material subfolders inside the zip, plus a `machining.csv` sidecar at the zip root. Two toggles next to the button control it: **DXF Export Mode** ("Folders per material" vs. "Single combined file") and **Layer Scheme** ("Native" vs. "ABF"). Combined mode also emits a second `machining.csv` download when any bore/groove/tenon-mortise carries preset-derived tool data. |

## Cut List

Where: **Furniture tab ▸ Cut List** panel, or the **Cut List** tab in the browser pane.

| Export | Format | Notes |
|---|---|---|
| Export CSV | `.csv` | Same command from both locations. The browser-pane version additionally includes hardware and connector-BOM rows; the ribbon-panel version includes connector rows only, not hardware rows. |

## Nest (sheet layout)

Where: **Furniture tab ▸ Nesting** panel, plus a per-sheet PNG button in the **Nesting** browser-pane tab.

| Export | Format | Scope | Notes |
|---|---|---|
| Export PDF | `.pdf` | All nest sheets | One document. |
| Export DXF (Nest) | `.zip` per-material, or a single combined `.dxf` | All nest sheets | Shares the same "Folders per material / Single combined file" toggle as Manufacturing DXF above. |
| Export PNG | `.png` (`nest-{materialId}-{sheetIndex}.png`) | One sheet at a time | Button lives on each sheet's panel in the browser pane's Nesting tab, not on the Furniture ribbon. There is no batch "export all nest PNGs." |

## Labels

Where: **Furniture tab ▸ Nesting** panel ▸ **Export Labels (PDF)**.

| Export | Format | Notes |
|---|---|---|
| Export Labels (PDF) | `.pdf` | One shop label per physical panel copy from the cut list. Adjacent controls: a Rich/Compact template toggle, two free-text header lines, and a header-preset picker. |

## Packing Slip

Where: **Furniture tab ▸ Production** panel, or the **Production** browser-pane tab.

| Export | Format | Notes |
|---|---|---|
| Export Packing Slip (PDF) | `.pdf` | Same command from both locations. Reflects the live produced/not-produced status tracked by QR-scan reconciliation. |

## BOM

Where: **BOM** tab in the browser pane only — there is no BOM export button on the Furniture ribbon.

| Export | Format | Notes |
|---|---|---|
| Export CSV | `.csv` (`{assembly}-bom.csv`) | Aggregates recursively into any placed sub-assemblies. |

## Statistics / cost report

Where: **Furniture tab ▸ Statistics** panel, or the **Statistics** browser-pane tab.

| Export | Format | Notes |
|---|---|---|
| Export CSV | `.csv` | |
| Export XLSX | `.xlsx` | One worksheet per cost category (Hardware, Connectors, Edge Band, Linear Material, Panels), each with a Subtotal row, plus a Summary worksheet with each section's subtotal, the Grand Total, and an unpriced-line count. |

## See also

- [File Formats](./file-formats.md)
- [Exporting Drawings](../drawings/exporting-drawings.md)
- [Exporting Boring Data](../drilling-prisadka/exporting-boring-data.md)
- [Manufacturing DXF](../manufacturing/manufacturing-dxf.md)
- [Nesting](../manufacturing/nesting.md)
- [Labels and QR](../manufacturing/labels-and-qr.md)
- [Packing Slip](../manufacturing/packing-slip.md)
- [Cost and Statistics](../furniture/cost-and-statistics.md)
- [Bill of Materials](../assemblies/bill-of-materials.md)
