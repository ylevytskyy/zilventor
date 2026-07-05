---
title: Cost Report
---
# Cost Report
> The priced Statistics report, read as a manufacturing artifact: what a job costs before you cut anything, ready to hand to a customer as a quote.

**Where:** Furniture ▸ Statistics panel ▸ **Statistics** / **Export CSV** / **Export XLSX** · **Shortcut:** — · **Applies to:** assembly

## What it does

This page is the manufacturing-facing view of the same **Statistics** report
documented in [Cost and Statistics](../furniture/cost-and-statistics.md) — it
is not a second report. There is exactly one priced report in the app,
grouped into five categories (**Hardware**, **Connectors**, **Edge Band**,
**Linear Material**, **Panels**), and it's reachable from the Furniture ▸
Statistics panel only — there's no separate Manufacturing- or
Production-branded report with different numbers.

What makes it a manufacturing artifact rather than just a design-time total:
it's the number you export and send out before cutting starts — a materials
and hardware quote for a customer, or a cost check before committing an
assembly to the shop floor. Because it's fed by the same [Cut
List](../furniture/cut-list.md) that drives [Nesting](./nesting.md) and
[Labels](./labels-and-qr.md), the priced total always matches what actually
gets cut and labeled — there's no separate estimate to keep in sync.

## Before you start

- Have an assembly open with panels, hardware, or присадка connectors in it —
  see [Cost and Statistics](../furniture/cost-and-statistics.md) for what
  populates each category.
- If you're quoting a job, generate the [Cut List](../furniture/cut-list.md)
  first so panel and edge-band quantities are current.

## Steps

1. In the Furniture tab, Statistics panel, click **Statistics** to open the
   report.
2. Review the five priced categories.
3. Click **Export CSV** or **Export XLSX** to hand the report off as a quote
   or a shop cost record.

*Result: the same download as [Cost and
Statistics](../furniture/cost-and-statistics.md) — a CSV or XLSX file with
all five categories and line totals.*

## Options

See [Cost and Statistics](../furniture/cost-and-statistics.md) for the full
field list per category — this page deliberately doesn't repeat it.

## Tips & gotchas

- **Don't look for a separate "manufacturing" cost report** — Furniture ▸
  Statistics is the only one. This page exists to cross-link the report from
  the Manufacturing section of the manual, not to describe a different
  surface.
- Re-run Statistics after regenerating the cut list or nest if quantities
  changed — like the nest, this report doesn't auto-refresh; open it again to
  see current numbers.
- XLSX is only available from this report — the [Bill of
  Materials](../assemblies/bill-of-materials.md) panel exports CSV only.

## See also

- [Cost and Statistics](../furniture/cost-and-statistics.md)
- [Cut List](../furniture/cut-list.md)
- [Nesting](./nesting.md)
- [Bill of Materials](../assemblies/bill-of-materials.md)

<!-- SCREENSHOT: Statistics report opened from the Furniture ribbon showing all five categories with a quote-style total — TODO follow-up -->
