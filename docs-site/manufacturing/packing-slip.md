---
title: Packing Slip
---
# Packing Slip
> A one-page-per-so-many-rows PDF listing every panel type, how many are done, and how many are left — for the box or pallet going out the door.

**Where:** Production sub-tab (Browser pane) ▸ **Export Packing Slip (PDF)** — also on the Furniture ▸ Production ribbon panel · **Shortcut:** — · **Applies to:** assembly with a populated cut list

## What it does

Export Packing Slip builds an A4 PDF with one row per [Cut
List](../furniture/cut-list.md) row: item number, part name, material and
size, total quantity, how many copies are marked **Produced** in [Production
Reconciliation](./production-reconciliation.md), and how many remain. A
totals line at the bottom sums quantity, produced, and remaining across the
whole job. The button is available in two places — the Furniture ▸
Production ribbon panel and again inside the Production sub-tab itself —
both produce the identical file.

The packing slip pulls panel identity and quantity from the cut list, and the
produced/remaining tally from whatever's been scanned or marked in
[Production Reconciliation](./production-reconciliation.md). It does not read
from the nest layout — nesting and packing are unrelated here despite the
similar name; a panel's position on a stock sheet has no bearing on this
document.

## Before you start

- Populate the [Cut List](../furniture/cut-list.md) — the packing slip has
  one row per cut-list row, so an empty cut list produces an empty slip.
- Mark panels produced in [Production
  Reconciliation](./production-reconciliation.md) first if you want the
  Produced/Remaining columns to reflect real progress; otherwise every row
  shows 0 produced.

## Steps

1. Open the Production sub-tab (or the Furniture ▸ Production ribbon panel).
2. Click **Export Packing Slip (PDF)**.

*Result: an A4 PDF downloads with one row per cut-list panel type, its
produced/remaining counts, and a totals footer.*

## Options

There is no dialog — a single click produces the file. Columns in the PDF:

| Column | Meaning |
|---|---|
| Item# | The panel's cut-list item number. |
| Part | Part name. |
| Material / Size | Material name and `L×W×T` in mm. |
| Qty | Total physical copies of this row. |
| Produced | Copies of this row currently marked Produced. |
| Remaining | Qty minus Produced. |

## Tips & gotchas

- **This is not the Bill of Materials.** The [BOM](../assemblies/bill-of-materials.md)
  aggregates every leaf part in the component tree by part+color; the packing
  slip aggregates cut-list rows and layers on production progress. They can
  show different quantities for the same part if the BOM's color grouping
  differs from the cut list's material grouping.
- **Produced/Remaining reflect the moment you export.** Re-export after
  marking more panels produced to get an updated slip — it's not a live
  document.
- If nothing has been scanned or marked yet in [Production
  Reconciliation](./production-reconciliation.md), every row's Produced
  column reads 0 and Remaining equals Qty — that's expected on a fresh job,
  not a bug.

## See also

- [Production Reconciliation](./production-reconciliation.md)
- [Bill of Materials](../assemblies/bill-of-materials.md)
- [Cut List](../furniture/cut-list.md)

<!-- SCREENSHOT: exported Packing Slip PDF showing several rows with Produced/Remaining columns and the totals footer — TODO follow-up -->
