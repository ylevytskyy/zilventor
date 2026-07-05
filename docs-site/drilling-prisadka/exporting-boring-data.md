---
title: Exporting Boring Data
---
# Exporting Boring Data
> Two quick, whole-assembly boring reports — a flat CSV and a 2D DXF layout — for a fast look at every bore without running the full manufacturing export.

**Where:** Furniture ▸ Присадка ▸ **Export CSV (Boring)** / **Export DXF (Boring)** · **Shortcut:** — · **Applies to:** assembly

## What it does

These two buttons export **every bore in the active assembly** (recursing into
nested sub-assemblies) in two different shapes:

- **Export CSV (Boring)** writes one row per bore — a flat machining report you can
  open in a spreadsheet or feed into your own tooling.
- **Export DXF (Boring)** draws one rectangle per panel (using its real length ×
  width when known) with a text label and a circle for each of its bores, laid out
  side by side in a single DXF — a quick visual boring map, not a production
  drawing.

Both read from the same aggregated boring result, so the bore counts always match
between them.

## Before you start

- The active assembly should already have bores — see
  [Generate Carcass Boring](./generate-carcass-boring.md),
  [Handles and Pulls](./handles-and-pulls.md), or [Leg Levelers](./leg-levelers.md).
- Both buttons are disabled until an assembly is active.

## Steps

1. In the Furniture tab, Присадка panel, click **Export CSV (Boring)** or
   **Export DXF (Boring)**.
2. If your browser supports the native save-file picker, choose where to save;
   otherwise the file downloads automatically as `<assembly-name>-boring.csv` or
   `<assembly-name>-boring.dxf`.

*Result: a single file covering every bore in the assembly, ready to open or hand
off.*

## Options

There is no dialog for either export — each is a single click. The CSV columns are:

| Column | Meaning |
|---|---|
| Panel | The panel's part name. |
| Length / Width / Thickness | The panel's real dimensions in mm (blank if unavailable). |
| Tag | The bore's internal id. |
| Face | Which face the bore is drilled from (`Top`, `Bottom`, `Front`, `Back`, `Left`, `Right`). |
| X / Y | The bore's U/V position within the panel's face frame, in mm. |
| Ø | Bore diameter in mm. |
| Depth | Cut depth in mm, or `THROUGH` for a through bore. |
| Type | The connector kind (e.g. `handleScrew`, `legLeveler`, `shelfPin`, …). |

The DXF groups bores onto layers named `D<diameter>_<depth or THROUGH>` — purely by
size, so all Ø5 through bores land on one layer regardless of what they're for.

## Tips & gotchas

- **These two exports do not carry machining-preset CAM metadata.** A
  [machining preset](./machining-presets.md)'s tool number, spindle speed, and custom
  target layer name do **not** appear in the boring CSV or the boring DXF — the CSV's
  `Type` column shows the connector kind, and the DXF layer is always the
  size-derived `D<dia>_<depth>` name. If you need tool number/speed recoverable from
  the file, or bores routed onto a preset's named layer, use
  **Export DXF (Manufacturing)** instead — see
  [Manufacturing DXF](../manufacturing/manufacturing-dxf.md) and
  [CAM Metadata](../manufacturing/cam-metadata.md). That per-panel export also
  supports the [ABF layer scheme](../manufacturing/abf-layer-scheme.md), nesting, and
  shop labels — a bigger workflow than these two quick reports.
- **Export DXF (Boring)** surfaces any preflight problems (a panel missing a name,
  material, or resolvable geometry) as on-screen toasts before it writes the file —
  read them; the affected panel is still included, just possibly with fallback
  dimensions.
- If the panel's real length/width isn't known, the DXF falls back to a rectangle
  sized from the bore positions themselves plus a small pad, so the outline may not
  exactly match the physical panel.

## See also

- [Generate Carcass Boring](./generate-carcass-boring.md)
- [Machining Presets](./machining-presets.md)
- [Editing and Clearing Bores](./editing-and-clearing-bores.md)
- [Manufacturing DXF](../manufacturing/manufacturing-dxf.md)
- [ABF Layer Scheme](../manufacturing/abf-layer-scheme.md)
- [CAM Metadata](../manufacturing/cam-metadata.md)

<!-- SCREENSHOT: Furniture ribbon Присадка panel with Export CSV (Boring) / Export DXF (Boring) buttons — TODO follow-up -->
<!-- SCREENSHOT: opened boring.csv in a spreadsheet showing the Panel/Face/X/Y/Ø/Depth/Type columns — TODO follow-up -->
