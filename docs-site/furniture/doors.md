---
title: Doors
---
# Doors
> Generates one or two doors sized to a cabinet's opening, with overlay, hinge side, and
> style — and, for slab doors, the matching hinge-cup and hinge-plate bores.

**Where:** Furniture ▸ Присадка ▸ **Add Door** · **Shortcut:** — · **Applies to:** assembly
(one cabinet)

## What it does

Add Door builds a single door or a pair of doors sized to a picked cabinet's opening. Set the
overlay, hinge side, thickness, reveal, and clearance, and pick a **Style** — Slab, Shaker, or
Raised panel. For **Slab** doors, `AddDoorCommand` also writes hinge-cup bores onto the door
and hinge-plate bores onto the cabinet's hinge-side panel as part of the same undoable
operation.

## Before you start

- Have an assembly open with a cabinet already placed. **Add Door** is disabled — tooltip
  *"Open or create an assembly first"* — until an assembly exists.

## Steps

1. Click **Add Door** in the Furniture ▸ Присадка ribbon panel — this arms a one-component
   pick cursor.
2. Click the cabinet you want to add a door to in the 3D viewport.
3. The **Add Door** dialog opens. Set Count, Overlay, Hinge side, Style, and the remaining
   fields.
4. Click **OK**.

*Result: the door part(s) are created and placed on the cabinet's opening; for Slab doors,
hinge-cup bores appear on the door and hinge-plate bores on the cabinet's hinge-side panel.*

## Options

| Field | Meaning |
|---|---|
| Count | Single / Double. Default Single. |
| Hinge side | Left / Right. Default Left. Disabled when Count is Double (a double door hinges on both outer edges automatically). |
| Overlay | Full / Half / Inset. Default Full. |
| Style | **Slab**, **Shaker**, or **Raised panel**. Default Slab. There is no separate "framed" option — Shaker and Raised panel are the two framed constructions; Slab is a single flat panel. |
| Frame width (mm) | Stile/rail width for framed styles. Default 70 mm. Disabled when Style is Slab. |
| Thickness (mm) | Door thickness. Default 18 mm. |
| Reveal (mm) | Gap around the door's outer edge. Default 2 mm. |
| Clearance (mm) | Working clearance. Default 2 mm. |
| Center reveal (mm) | Gap between the two doors of a double set. Default 3 mm. Only relevant when Count is Double. |
| Hinges (auto) | Read-only — hinge count computed from door height. Not user-editable. |
| Machining preset (hinge-cup) | Optional select, shown only if hinge-cup machining presets exist in the assembly. |
| Machining preset (hinge-plate) | Optional select, shown only if hinge-plate machining presets exist in the assembly. |

## Tips & gotchas

- **Style has exactly three options** — Slab, Shaker, Raised panel — not four. If you're
  looking for a plain framed door with no raised center panel, that's **Shaker**; there's no
  separate "Framed" choice.
- **Hinge-cup and hinge-plate bores are only generated for Slab doors.** Framed doors (Shaker,
  Raised panel) defer hinge boring — the cups belong in the stile, and this isn't wired up yet
  — so switching a door to Shaker or Raised panel after generating won't add hinge bores
  automatically.
- "Hinges (auto)" can't be overridden in this dialog; it's purely informational.

![Add Door dialog showing count, hinge side, overlay, style, and reveal defaults](/img/furniture/add-door.png)

## See also

- [Cabinets](./cabinets.md)
- [Drawer Banks](./drawer-banks.md)
- [Drilling / Присадка](../drilling-prisadka/index.md)
- [Hardware](./hardware.md)
