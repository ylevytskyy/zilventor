---
title: Bill of Materials
---
# Bill of Materials
> Every leaf part in the assembly tree, rolled up into one flat table with automatic quantity counting.

**Where:** Assembly tab ▸ BOM group ▸ BOM · **Shortcut:** none · **Applies to:** assembly

## What it does

The **BOM** ribbon button switches the left Browser pane's tab strip to its BOM tab. The
Browser pane holds several sibling tabs — Assembly / BOM / Cut List / Nesting / Statistics /
Production — and BOM is one of them; see [Cut List](../furniture/cut-list.md),
[Nesting](../manufacturing/nesting.md), [Statistics](../furniture/cost-and-statistics.md), and
[Production](../manufacturing/production-reconciliation.md) for the others.

The BOM walks the whole component tree recursively, descending into every nested
sub-assembly. Leaf parts are grouped by (part, effective color) — every occurrence of the
identical part and color anywhere in the tree, at any nesting depth, counts toward one row's
Qty. Multiplication is implicit and automatic: if a sub-assembly containing 2 of some panel is
itself placed 3 times in the top assembly, the BOM row for that panel shows Qty 6. There is no
manual multiplier field to set — it just works from placement counts.

## Before you start

- An assembly must be open with at least one component placed — see
  [Placing Components](./placing-components.md).
- If the assembly uses patterns or mirrored copies, confirm those are generated first (see
  [Patterns and Mirror](./patterns-and-mirror.md)) so their instances are counted.

## Steps

1. Open the assembly whose materials you want to total.
2. On the **Assembly** tab, in the **BOM** group, click **BOM**.
   *Result: the Browser pane's tab strip switches to the BOM tab, showing one row per unique
   part+color combination found anywhere in the tree.*
3. Click a row (outside the Item # and Color cells) to select every component instance of that
   row's part+color, anywhere in the tree, in the browser tree and the 3D view.
4. Double-click the **Item #** cell to edit it inline (1–9999); double-click the **Color** cell
   to open a color picker and reassign the effective color for that row.
5. Click **Renumber** to resequence every row's Item # to 1..N in row order.
   *Result: item numbers reset to a clean sequence; the action is fully undoable.*
6. Click **Export CSV** (inside the BOM panel, not the ribbon) to save the table as a `.csv`
   file.

## Options

| Field / Control | Meaning |
|---|---|
| Item # | Click-to-edit label, 1–9999. Feeds drawing Auto-Balloon numbering — see Tips below. |
| Part # | The part's catalog/part number. |
| Description | The part's description text. |
| QTY | Aggregated count of this part+color across the whole tree, computed automatically. |
| Part Name | The part's display name. |
| Color | Click-to-edit via a color picker; sets the effective color the row is grouped by. |
| Part Path | The part's location in the assembly tree. |
| Renumber (ribbon) | Resequences every row's Item # to 1..N in row order; undoable. |
| Export CSV (panel) | Exports the table as CSV. |

## Tips & gotchas

- **CSV only.** The BOM panel exports CSV, not XLSX. An XLSX export exists, but only on the
  separate [Statistics](../furniture/cost-and-statistics.md) tab.
- The CSV header is exactly `Item#,Part #,Description,QTY,Part Name,Color,Part Path`. A
  suggested filename pattern is `<assembly-name>-bom.csv`.
- **Item # drives drawing balloons.** Every balloon number placed on a drawing sheet via
  Auto-Balloon (see [Annotations](../drawings/annotations.md) and
  [Hole Tables and Parts Lists](../drawings/hole-tables-and-parts-lists.md)) is the
  component's BOM Item #. Clicking **Renumber** will also change balloon numbers on any
  drawings that reference this assembly.
- The BOM is not the source for the packing slip — that document is built from the separate
  Cut List aggregation, not straight from BOM rows. See
  [Packing Slip](../manufacturing/packing-slip.md).

## See also

- [Placing Components](./placing-components.md)
- [Patterns and Mirror](./patterns-and-mirror.md)
- [Cut List](../furniture/cut-list.md)
- [Statistics and Cost](../furniture/cost-and-statistics.md)
- [Annotations](../drawings/annotations.md)
- [Hole Tables and Parts Lists](../drawings/hole-tables-and-parts-lists.md)
- [Packing Slip](../manufacturing/packing-slip.md)

<!-- SCREENSHOT: BOM tab in the Browser pane showing a populated table with a few rows across all columns — TODO follow-up -->
<!-- SCREENSHOT: BOM table with the Item # cell in inline-edit state — TODO follow-up -->
