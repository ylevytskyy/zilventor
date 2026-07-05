---
title: Face Frames
---
# Face Frames
> Builds an R×C grid of butt-jointed stile-and-rail members across a cabinet's front opening.

**Where:** Furniture ▸ Присадка ▸ **Add Face Frame** · **Shortcut:** — · **Applies to:**
assembly (one cabinet)

## What it does

Add Face Frame lays out a grid of frame members — continuous full-height stiles plus rails
that butt between adjacent stiles in each column — sized to a picked cabinet's front opening.
Joints are plain **butt joints**; there's no coping or cope-and-stick profile. `rows` and
`cols` control the grid; stile and rail widths and overall thickness are set independently.

## Before you start

- Have an assembly open with a cabinet already placed. **Add Face Frame** is disabled —
  tooltip *"Open or create an assembly first"* — until an assembly exists.

## Steps

1. Click **Add Face Frame** in the Furniture ▸ Присадка ribbon panel — this arms a
   one-component pick cursor.
2. Click the cabinet you want to frame in the 3D viewport.
3. The **Add Face Frame** dialog opens. Set Rows, Columns, Stile width, Rail width, and
   Thickness.
4. Click **OK**.

*Result: `rows + 1` continuous full-height stiles and `cols + 1` rails per column are placed
as new components on the cabinet.*

## Options

| Field | Meaning |
|---|---|
| Rows | Number of frame rows, 1–10. Default 1. |
| Columns | Number of frame columns, 1–10. Default 1. |
| Stile width (mm) | Width of the vertical members. Default 38 mm. |
| Rail width (mm) | Width of the horizontal members. Default 38 mm. |
| Thickness (mm) | Frame member thickness. Default 19 mm. |

## Tips & gotchas

- All sizes must be positive and Rows/Columns at least 1, or OK is blocked with *"Rows,
  columns, and sizes must be positive."*
- Stiles run continuous full height; rails butt between them per column — there's no
  mortise-and-tenon or cope option here. If you need actual joinery between two panels, see
  [Mortise and Tenon](../drilling-prisadka/mortise-and-tenon.md) instead.

<!-- SCREENSHOT: Add Face Frame dialog with a 2×3 grid, and the resulting frame on a cabinet — TODO follow-up -->

## See also

- [Cabinets](./cabinets.md)
- [Doors](./doors.md)
- [Drawer Banks](./drawer-banks.md)
- [Drilling / Присадка](../drilling-prisadka/index.md)
