---
title: Labels and QR
---
# Labels and QR
> One printable label per physical panel — item, size, material, and a QR code — for a saw operator or cutting service to sort and identify parts by hand.

**Where:** Furniture ▸ Nesting panel ▸ **Export Labels (PDF)** · **Shortcut:** — · **Applies to:** assembly with a populated cut list

## What it does

Export Labels (PDF) writes an A4 PDF of printable labels, ten per page (2
columns × 5 rows). Unlike the cut list or BOM, which show one row per unique
panel type with a quantity, this export expands every row into individual
labels — a cut-list row with qty 4 produces four separate labels, one per
physical copy, each marked "copy *k*/4". The idea is that each physical board
gets its own label to stick or tag onto it.

Each label carries the panel's item number and name, material, `L×W×T` in
mm, the copy index, and a QR code encoding the same identity so a scanner
(see [Production Reconciliation](./production-reconciliation.md)) can look it
up without retyping anything.

## Before you start

- Populate the [Cut List](../furniture/cut-list.md) — labels are generated
  from cut-list rows, one set of labels per row's quantity.
- Decide which template and header text you want before exporting; both are
  ribbon settings that apply to the whole run.

## Steps

1. In the Furniture tab, Nesting panel, choose **Rich** or **Compact** for the
   label template.
2. Optionally fill **Header line 1** and **Header line 2** — free text printed
   at the top of every page (job name, customer, date, etc.).
3. To reuse header text later, click **Manage Header Presets**, then in the
   **Label Header Presets** dialog give the current header a **Name** and add
   it; use **Import…** / **Export…** there to move presets between machines.
4. To reload saved header text, pick it from the **Load header preset**
   dropdown — it fills both header fields.
5. Click **Export Labels (PDF)**.

*Result: an A4 PDF downloads with one label per physical panel copy across
the whole cut list, in the chosen template, with the header text on every
page.*

## Options

| Field | Meaning |
|---|---|
| Rich | Label includes the text block, a small QR code, and a mini panel diagram (outline, grain arrow, banded-edge letters F/B/L/R). |
| Compact | Same text block, no mini diagram, and a larger QR code that fills more of the label — easier to scan from a distance or a lower-quality printer. |
| Header line 1 / Header line 2 | Two free-text lines printed at the top of every page. Leave both blank to omit the header entirely. |
| Load header preset | Dropdown of saved header presets; picking one fills both header fields. |
| Manage Header Presets | Opens a dialog to add, edit, delete, import, or export saved header-text presets (Name + both lines). |

## Tips & gotchas

- **The QR payload is a fixed pipe-delimited string**: `Z|item|copy/qty|LxWxT|materialName`
  — for example `Z|3|2/4|600x400x18|Birch 18mm`. This is exactly what
  [Production Reconciliation](./production-reconciliation.md)'s scanner and
  manual-entry field expect; don't hand-edit or regenerate QR codes outside
  this export.
- **Labels are per physical copy, not per cut-list row.** If you're expecting
  one label per row like the cut list table shows, you'll get more pages than
  that — one label per unit of quantity.
- **Header presets persist locally in the browser**, not inside the document
  file — they won't travel with the `.ziasm`/`.zicab` file to another machine.
  Use **Export…** in the presets dialog to hand them off.
- Choose **Compact** over **Rich** if labels will be scanned in poor lighting
  or printed on a low-DPI printer — the larger QR code is more forgiving.

## See also

- [Production Reconciliation](./production-reconciliation.md)
- [Nesting](./nesting.md)
- [Cut List](../furniture/cut-list.md)

<!-- SCREENSHOT: Furniture ribbon Nesting panel with Rich/Compact toggle, header line fields, and Export Labels (PDF) button — TODO follow-up -->
![Printed A4 page of shop labels in the Rich template, each with item number, dimensions, and a QR code](/img/manufacturing/labels.png)
