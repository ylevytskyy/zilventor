---
title: Drawer Banks
---
# Drawer Banks
> Builds a bank of 2–10 drawer boxes across a cabinet's opening, with side-mount or Tandem
> under-mount slides, and cuts the matching slide bores.

**Where:** Furniture ▸ Присадка ▸ **Add Drawers** · **Shortcut:** — · **Applies to:** assembly
(one cabinet)

## What it does

Add Drawers builds a stack of drawer box parts sized to a picked cabinet's opening, splitting
the opening height evenly across the drawer count (editable per drawer), and cuts the slide
bores for the chosen slide system into both the cabinet sides and the drawer boxes —
`AddDrawerBankCommand` does box creation and boring as one undoable step.

## Before you start

- Have an assembly open with a cabinet already placed. **Add Drawers** is disabled — tooltip
  *"Open or create an assembly first"* — until an assembly exists.

## Steps

1. Click **Add Drawers** in the Furniture ▸ Присадка ribbon panel — this arms a
   one-component pick cursor.
2. Click the cabinet you want to add drawers to in the 3D viewport. The dialog reads the
   cabinet's opening width and height from this pick.
3. The **Add Drawer Bank** dialog opens, drawer heights pre-split evenly across the opening.
   Set Count, Overlay, Thickness, Slide system, and adjust individual drawer heights if needed.
4. Click **OK**.

*Result: drawer box parts are placed in the cabinet, and slide bores are cut into the cabinet
sides and drawer boxes (side-mount) or drawer bottoms/backs and cabinet sides (Tandem).*

## Options

| Field | Meaning |
|---|---|
| Count | Number of drawers, 2–10. Default 3. |
| Overlay | Full / Half / Inset. Default Full. |
| Thickness (mm) | Drawer box material thickness. Default 18 mm. |
| Slide system | **Side mount** or **Tandem (under-mount)**. Default Side mount. |
| Cabinet-side machining preset | Optional, shown only for Tandem when matching presets exist. |
| Drawer-side machining preset | Optional, shown only for Tandem when matching presets exist. |
| Drawer heights (mm) | One row per drawer, pre-filled by splitting the opening height evenly (remainder absorbed into the last drawer); editable. A "Remaining: N mm" line must read 0 before OK is enabled. |

## Tips & gotchas

- Heights must sum exactly (within 0.5 mm) to the cabinet's opening height — OK stays
  disabled until "Remaining" reads 0 mm.
- The dialog's own label for the under-mount option is **"Tandem (under-mount)"**; internally
  it generates the connector-BOM line item **"Blum TANDEM slide"** (nominal Blum TANDEM 560H
  geometry) — see [Bill of Materials](../assemblies/bill-of-materials.md).
- Side-mount and Tandem bore **different faces**: side-mount cuts the cabinet's side inner
  faces and the drawer box sides; Tandem cuts the drawer box bottom/back and the cabinet
  sides. Switching slide systems after generating changes where the bores land.

![Add Drawer Bank dialog showing count, overlay, slide system, and per-drawer heights](/img/furniture/drawer-bank.png)

## See also

- [Cabinets](./cabinets.md)
- [Doors](./doors.md)
- [Face Frames](./face-frames.md)
- [Drilling / Присадка](../drilling-prisadka/index.md)
- [Bill of Materials](../assemblies/bill-of-materials.md)
