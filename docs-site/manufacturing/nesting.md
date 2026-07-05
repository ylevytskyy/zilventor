---
title: Nesting
---
# Nesting
> Packs every panel in the cut list onto stock sheets, one layout per material, and exports the result as a cutting plan (PDF), per-sheet DXFs, or PNGs.

**Where:** Furniture ▸ Nesting panel ▸ **Generate Nest** (viewed on the **Nesting** sub-tab of the Browser pane) · **Shortcut:** — · **Applies to:** assembly

## What it does

Generate Nest takes every row in the [Cut List](../furniture/cut-list.md), expands
quantities into individual panel instances, and packs them onto stock sheets
using a **guillotine-cut** algorithm: every cut line runs edge-to-edge across
the remaining stock, the way a panel saw actually cuts. Panels are bucketed by
**material** first, so each material gets its own independent sequence of
sheets — a nest for birch 18mm and a nest for MDF 16mm don't share a sheet.

Two settings shape the packed layout:

- **Kerf** — the saw-blade width, consumed as the gap left between adjacent
  placed panels. It does not change any panel's own size.
- **Oversize L / W** — extra material added to each panel's own length and
  width before packing (independently), so the panel is cut slightly larger
  than its finished size. This does change how much stock a panel occupies.

Grain direction (set per panel from the [Cut List](../furniture/cut-list.md))
also constrains the packer: a panel with grain locked to Length or Width is
only tried in the orientation that respects its grain, never rotated against
it. If a grain-locked panel would only fit rotated, it's excluded from the
nest rather than rotated silently.

## Before you start

- Populate the [Cut List](../furniture/cut-list.md) first — Generate Nest packs
  whatever is in the cut list at the moment you click it.
- Decide grain direction per panel before nesting if grain matters for any
  material — the nest respects grain, it doesn't ask you to fix it after.

## Steps

1. Open the assembly whose cut list you want to nest.
2. In the Furniture tab, Nesting panel, click **Generate Nest**.
3. In the **Generate Nest** dialog, set **Kerf (mm)**, **Oversize L (mm)**, and
   **Oversize W (mm)**.
4. Review the summary line ("*N* panels across *M* materials will be nested")
   and click **OK**.
5. Switch to the **Nesting** sub-tab in the Browser pane to review the packed
   sheets, grouped in one section per material.
6. Export the result: **Export PDF** (whole nest, one file), **Export DXF
   (Nest)** (per-sheet DXFs, zipped by material), or the per-sheet **Export
   PNG** button on each sheet.

*Result: the Nesting sub-tab shows one section per material, each listing its
sheets with a utilization percentage; any panel that couldn't be placed
appears under an "Excluded" list with a reason.*

## Options

| Field | Meaning |
|---|---|
| Kerf (mm) | Saw-blade width, added as the gap between adjacent panels on a sheet. Must be a positive number. |
| Oversize L (mm) | Extra length added to every panel's own footprint before packing. Zero or positive. |
| Oversize W (mm) | Extra width added to every panel's own footprint before packing. Zero or positive. Set independently from Oversize L. |
| Export PDF | One PDF for the whole nest — every sheet across every material, one page each. |
| Export DXF (Nest) | Per-sheet DXFs zipped into per-material folders (default), or a single combined DXF if the shared **DXF Export Mode** toggle is set to "Single combined file" — see Tips below. |
| Export PNG | Per-sheet button (on each sheet in the Nesting tab, not in the ribbon) — exports that one sheet as a PNG. |

## Tips & gotchas

- **A stale nest doesn't update itself.** If you change the cut list, kerf, or
  oversize after generating a nest, the Nesting tab shows a banner: "Cut list
  changed since last nest." with an inline **Regenerate** button. The old
  layout keeps rendering underneath until you click it — nothing is blocked or
  auto-refreshed.
- **A panel that doesn't fit is excluded, not shrunk or forced.** Panels too
  large for the sheet, or grain-locked panels that would only fit rotated,
  show up under an **Excluded** section with a reason instead of silently
  disappearing.
- **Remnant labeling is cosmetic and does not persist.** After packing a
  sheet, the largest leftover rectangle of at least 100×100mm is labeled
  "REMNANT" on the sheet output (PDF/DXF/PNG). This is recomputed from
  scratch every time you click Generate Nest — there is no remnant-stock
  inventory that carries real offcuts from one job to the next. Treat the
  label as "here's the biggest scrap on this sheet," not tracked stock.
- **The DXF Export Mode toggle is shared with Manufacturing DXF.** If you (or
  a teammate) switched **DXF Export Mode** to "Single combined file" for
  [Manufacturing DXF](./manufacturing-dxf.md) or boring exports, **Export DXF
  (Nest)** will also emit one combined file instead of the default zip of
  per-sheet, per-material folders. Check the toggle before exporting if you
  expect the zip.
- **Grain arrows on the sheet are a visual read of an enforced rule**, not
  decoration — the arrow direction reflects the grain setting the packer
  actually respected when it chose (or rejected) an orientation.
- Manual adjustments to a generated layout are a separate workflow — see
  [Editing the Nest](./editing-the-nest.md).

## See also

- [Cut List](../furniture/cut-list.md)
- [Editing the Nest](./editing-the-nest.md)
- [Labels and QR](./labels-and-qr.md)
- [Manufacturing DXF](./manufacturing-dxf.md)

<!-- SCREENSHOT: Furniture ribbon Nesting panel with Generate Nest, Export DXF (Nest), Export Labels (PDF) buttons — TODO follow-up -->
![Nesting sub-tab showing one material section with a sheet layout, utilization %, and a remnant label](/img/manufacturing/nesting.png)
