---
title: Furniture
---
# Furniture

> The cabinetmaking workflow: generate a cabinet carcass into an assembly, then add doors,
> drawers, face frames, and hardware, and machine it for production.

The **Furniture** ribbon tab is where a cabinet assembly is built up, panel by panel. The
pattern across the whole tab is the same: a **Cabinets** template generates a multi-panel
carcass (sides, top, bottom, back, toekick, shelves) into the active assembly, and every
tool after that — doors, drawer banks, face frames, hardware, cut list, statistics — works
against that assembly and the panels inside it.

## The general pattern

1. **Open or create an assembly first.** Almost every button on this tab is disabled (grayed
   out, with the tooltip *"Open or create an assembly first"*) until `activeAssembly` exists.
   The one exception is **Panel** (see [Panels](./panels.md)), which also works against an
   empty active part.
2. **Generate a cabinet.** Pick one of the four templates under [Cabinets](./cabinets.md) —
   Base Cabinet, Corner Cabinet, Blind Corner Cabinet, or Diagonal Corner Cabinet. Each opens
   its own dialog and, on **OK**, drops a full set of panels into the assembly. Every panel
   created this way carries a `role` (leftSide, rightSide, top, bottom, back, toekick, shelf,
   …) — that tag is what lets later tools (carcass boring, cut list, BOM) know what each panel
   is without you telling them again.
3. **Add doors, drawers, and face frames.** These tools live in the **Присадка** ribbon
   panel — [Add Door](./doors.md), [Add Drawers](./drawer-banks.md), and
   [Add Face Frame](./face-frames.md) all ask you to click a cabinet in the 3D viewport before
   their dialog opens, since they size themselves to that cabinet's opening.
4. **Add hardware.** [Hardware](./hardware.md) lets you drop a SKU from the built-in catalog
   (or an imported custom one) onto the assembly and into its bill of materials.
5. **Machine it.** The rest of the Присадка panel — carcass-joint boring, System-32 shelf
   pins, grooves, keyhole slots, mortise/tenon — is covered in its own section, since it
   applies to any panel, not just furniture-generated ones. See
   [Drilling / Присадка](../drilling-prisadka/index.md).
6. **Read off cut list, cost, and production output.** [Cut List](./cut-list.md) and
   [Cost and Statistics](./cost-and-statistics.md) summarize everything above; nesting,
   labeling, and packing-slip export live one section over in
   [Manufacturing](../manufacturing/index.md) — they share the same Furniture ribbon tab in
   the app (the **Nesting** and **Production** ribbon panels), just documented separately here.

## Pages in this section

| Page | What it covers |
|---|---|
| [Panels](./panels.md) | Freeform sheet-good panel — dimensions, material, edge-banding |
| [Cabinets](./cabinets.md) | The four cabinet templates: Base, Corner, Blind Corner, Diagonal Corner |
| [Doors](./doors.md) | Slab/shaker/raised-panel doors sized to a cabinet opening, with hinge boring |
| [Drawer Banks](./drawer-banks.md) | Drawer boxes with side-mount or Tandem under-mount slides |
| [Face Frames](./face-frames.md) | Butt-jointed R×C face-frame grids |
| [Hardware](./hardware.md) | Built-in and custom hardware catalog, added to the BOM |
| [Cut List](./cut-list.md) | Panel cut list, renumbering, and CSV export |
| [Cost and Statistics](./cost-and-statistics.md) | 5-category priced report, CSV/XLSX export |

## See also

- [Drilling / Присадка](../drilling-prisadka/index.md) — carcass boring, shelf pins, grooves,
  keyholes, joinery
- [Manufacturing](../manufacturing/index.md) — nesting, labels, packing slips
- [Bill of Materials](../assemblies/bill-of-materials.md)

<!-- SCREENSHOT: the Furniture ribbon tab with Create, Cabinets, Hardware, Cut List, Statistics, and Присадка panels visible, on a freshly-created assembly — TODO follow-up -->
