---
title: Keyhole Slots
---
# Keyhole Slots
> Routs a localized keyhole-shaped cutout — a wide entry hole with a narrow slot leading off
> it — for French-cleat-style wall-hanging hardware.

**Where:** Furniture ▸ Присадка ▸ **Keyhole Slot** · **Shortcut:** — · **Applies to:**
assembly (one panel)

## What it does

A keyhole slot is the classic wall-hanging cutout: a round entry hole sized for a screw head,
with a narrower slot running off it so the panel can be dropped over the screw and slid down
to lock in place. Unlike Groove, this is a **localized** cutout — a hole plus a short slot,
not a channel running the full width of the panel — so you place it exactly where you want
the hanger.

## Before you start

- Have an assembly open with the panel you want to hang already in place.
- Decide where on the panel (which face, and the `u`/`v` position on that face) the hanger
  should sit.

## Steps

1. Click **Keyhole Slot** in the Furniture ▸ Присадка ribbon panel — this arms a one-panel
   pick cursor.
2. Click the panel you want to rout in the 3D viewport.
3. The **Keyhole Slot** dialog opens with **Face** defaulted to **Bottom** (one of the two
   broad faces — see the face vocabulary in the [section overview](./index.md)). Change the
   face, axis, direction, and position to place the slot where you need it, and adjust the
   entry diameter, slot width, slot length, and depth.
4. Click **OK**.

*Result: the routed keyhole cutout appears on the panel and is added to its feature tree as a
`KeyholeSlotFeature`.*

## Options

| Field | Meaning |
|---|---|
| Face | Which of the panel's six faces the slot is cut into. Defaults to **Bottom** — you can change it to any of the six, but edge faces (Front/Back/Left/Right) have no flat drawing representation in the exported DXF. |
| Axis | `u` or `v` — which local direction of the face the slot's length runs along. |
| Direction | `+1` or `-1` — which way along the axis the slot runs from the entry hole. |
| U (mm) / V (mm) | The entry hole's center position on the face, in that face's local 2D coordinates. |
| Entry Diameter (mm) | Diameter of the round entry hole (where the screw head passes through). Default 15 mm. |
| Slot Width (mm) | Width of the narrow slot leading off the entry hole. Default 8 mm. |
| Slot Length (mm) | Length of the slot, measured from the entry hole's center outward. Default 25 mm. |
| Depth (mm) | Cut depth (blind). Default 6 mm. |

## Tips & gotchas

- The **routed cutout is editable after placement** — select it to open the **Keyhole slot
  properties** panel and adjust any field; the kernel re-cuts live and the edit is undoable,
  same as Groove. See [Editing and Clearing Bores](./editing-and-clearing-bores.md).
- The dialog does **not** validate parameters — a slot width equal to or larger than the entry
  diameter will still cut, it just won't function as a real keyhole. Check the shape in the
  viewport.
- Because edge faces (Front/Back/Left/Right) have no flat drawing representation, keep the
  slot on a broad **Top** or **Bottom** face if you need it to show up correctly in DXF/CSV
  output.

<!-- SCREENSHOT: KeyholeSlotDialog with default values, and the resulting keyhole cutout on a panel's back face in the 3D viewport — TODO follow-up -->

## See also

- [Grooves and Dados](./grooves-and-dados.md)
- [Editing and Clearing Bores](./editing-and-clearing-bores.md)
- [Exporting Boring Data](./exporting-boring-data.md)
