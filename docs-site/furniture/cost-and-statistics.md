---
title: Cost and Statistics
---
# Cost and Statistics
> A 5-category priced report — hardware, connectors, edge band, linear material, and panels —
> for the active assembly, exportable to CSV or XLSX.

**Where:** Furniture ▸ Statistics ▸ **Statistics** / **Export CSV** / **Export XLSX** ·
**Shortcut:** — · **Applies to:** assembly

## What it does

Statistics builds a priced report over everything in the active assembly, grouped into five
categories: **Hardware** (SKUs added via [Add Hardware](./hardware.md)), **Connectors**
(присадка joinery — confirmat/minifix/dowel/Tandem, etc.), **Edge Band** (banding tape),
**Linear Material** (face-frame/stile-rail stock), and **Panels** (sheet goods). Each line
shows quantity × unit price = line total. This is the single cost-report surface in the app.

## Before you start

- Have an assembly open with panels, hardware, or присадка features in it — an empty
  assembly produces an empty report.

## Steps

1. Click **Statistics** in the Furniture ▸ Statistics ribbon panel to open the report.
2. Review the five category sections.
3. Click **Export CSV** or **Export XLSX** — available both in the ribbon and again inside
   the report table — to download the report.

*Result: the Statistics report table opens; Export CSV/XLSX downloads the corresponding file.*

## Options

| Category | Contents |
|---|---|
| Hardware | Hardware SKUs added via [Add Hardware](./hardware.md). |
| Connectors | Присадка connector/joinery hardware (confirmat, minifix, dowel, Tandem slides, etc.). |
| Edge Band | Banding tape, by material, with total length. |
| Linear Material | Face-frame/stile-rail stock, by material, with total length. |
| Panels | Sheet-good panels, by material, with area or count. |
| Export CSV / Export XLSX | Downloads the full report in the chosen format. |

## Tips & gotchas

- This report is the app's only cost surface — there's no separate report on a "Manufacturing"
  tab; [Nesting](../manufacturing/nesting.md) and [Labels and QR](../manufacturing/labels-and-qr.md)
  cover the other manufacturing-facing tools that share this ribbon tab, but pricing lives
  only here. See [Cost Report](../manufacturing/cost-report.md) for that page's framing of the
  same underlying report — this page and that one describe the same data, not two different
  ones.
- Category labels are exactly **Hardware**, **Connectors**, **Edge Band**, **Linear
  Material**, **Panels** — not "joints" or "sheet goods" wording.

<!-- SCREENSHOT: Statistics report table showing all five categories with sample line items — TODO follow-up -->

## See also

- [Cut List](./cut-list.md)
- [Hardware](./hardware.md)
- [Cost Report](../manufacturing/cost-report.md)
- [Bill of Materials](../assemblies/bill-of-materials.md)
