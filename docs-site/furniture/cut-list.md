---
title: Cut List
---
# Cut List
> A live table of every panel in the active assembly — material, size, edge-banding, and
> item number — with renumbering and CSV export.

**Where:** Furniture ▸ Cut List ▸ **Cut List** / **Renumber** / **Export CSV** ·
**Shortcut:** — · **Applies to:** assembly

## What it does

Cut List opens a table listing every panel in the active assembly: item number, quantity,
material, size, edge-band material per side, and part identity. Below it, an Edge Band
Totals table rolls up banding tape length per material. **Renumber** resequences item numbers
1..N in a deterministic sort order. **Export CSV** writes the full report — including columns
not shown on screen — to a downloadable file.

## Before you start

- Have an assembly open. The Cut List buttons have no explicit enable/disable gating, but
  they're only useful once the assembly has panels in it.

## Steps

1. Click **Cut List** in the Furniture ▸ Cut List ribbon panel to open the table.
2. Review the panel rows and the Edge Band Totals sub-table.
3. Click **Renumber** to resequence the Item# column to 1..N.
4. Click **Export CSV** to download the full report.

*Result: the cut-list table opens (or refreshes); Renumber updates Item# in place; Export CSV
downloads a `.csv` file.*

## Options

| Field / Button | Meaning |
|---|---|
| Item#, QTY, Material, L, W, T, Grain, Front/Back/Left/Right, Part Name, Part Path | On-screen table columns. |
| Edge Band Totals | Sub-table: total banding length per material, in mm and m. |
| Renumber | Resequences Item# to 1..N in the table's deterministic sort order. Undoable. |
| Export CSV | Writes a CSV with Item#, QTY, Material, L (mm), W (mm), **Gross L (mm)**, **Gross W (mm)**, T (mm), Grain, Front/Back/Left/Right, Part Name, Part Path, followed by Edge Band Material totals, a Hardware section (SKU, Name, Category, Qty, Notes), a присадка/Connectors section (Type, Name, Qty, Notes), and an "Excluded from cut list" summary line. |

## Tips & gotchas

- The on-screen table does **not** show Gross L/W (nesting oversize) or hardware/connector
  columns — those only appear in the exported CSV, plus separate Hardware and Connector BOM
  tables rendered below the cut list in the browser pane.
- Renumber is an ordinary undoable command — undo restores the previous item numbers if you
  renumber before finishing edits.
- Gross sizes (with kerf/oversize allowance for nesting) come from the nesting settings, not
  from the cut list itself.

<!-- SCREENSHOT: Cut List table with several panels, the Edge Band Totals sub-table, and an exported CSV opened in a spreadsheet — TODO follow-up -->

## See also

- [Nesting](../manufacturing/nesting.md)
- [Labels and QR](../manufacturing/labels-and-qr.md)
- [Cost and Statistics](./cost-and-statistics.md)
- [Bill of Materials](../assemblies/bill-of-materials.md)
