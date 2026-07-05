---
title: System-32 Shelf Pins
---
# System-32 Shelf Pins
> Drills the Ø5 mm, 32 mm-pitch vertical hole columns on a side panel's inner face that
> adjustable shelf pins seat into.

**Where:** Furniture ▸ Присадка ▸ **Система-32** (auto) or **Система-32 (pick)** (manual) ·
**Shortcut:** — · **Applies to:** assembly (cabinet side panels)

## What it does

System-32 is the shop-standard line-boring layout: Ø5 mm holes on a 32 mm vertical pitch,
drilled into the **inner broad face** of a cabinet's side panels, so shelf-support pins (or
any other System-32-compatible hardware) can seat at any 32 mm increment. Zilventor gives you
two ways to apply it:

- **Система-32 (auto)** — recurses through the active assembly and generates the pin grid on
  **both** side panels of every cabinet it finds (mirrored correctly left/right), using the
  role tagging cabinet templates set.
- **Система-32 (pick)** — you click one panel yourself; the tool defaults the drilling face
  to that panel's correct inner face (derived from its `role`: right-side panels use the
  right-side inner face, everything else defaults to the left-side inner face) and applies
  the same grid to just that one panel.

Both write ordinary `BoreOp` records — same as carcass boring — so they show up as markers,
export the same way, and merge with existing bores rather than duplicating.

## Before you start

- Have an assembly open with at least one cabinet.
- For **auto**, the side panels need a `role` (set automatically by cabinet templates) — a
  hand-built panel with no role won't be picked up by the auto path.
- For **manual**, you don't need a role-tagged panel to click it, but the dialog has **no face
  selector** — the drilling face is fixed to whatever the tool inferred before the dialog
  opened (left-side inner face, unless the picked panel's role is `rightSide`). If you pick a
  custom panel and the inferred face is wrong, there's no way to override it in this dialog.

## Steps

### Auto (whole assembly)

1. Click **Система-32** in the Furniture ▸ Присадка ribbon panel.
2. Fill in the dialog fields (defaults are shop-standard, see Options below).
3. Click **OK**.

*Result: a pin grid appears on both inner faces of every side panel in the assembly.*

### Manual (one panel)

1. Click **Система-32 (pick)**.
2. Click the side panel you want to drill in the 3D viewport.
3. The dialog opens with the face already resolved from the panel's role. Adjust the
   parameters if needed.
4. Click **OK**.

*Result: a pin grid appears on the picked panel's inner face only.*

## Options

| Field | Meaning |
|---|---|
| Pitch (mm) | Vertical spacing between holes. Default 32 mm — the System-32 standard. |
| Diameter (mm) | Hole diameter. Default 5 mm. |
| Depth (mm) | Blind-hole depth. Default 13 mm — never drills through the panel. |
| Front setback (mm) | Distance of the front hole column from the panel's front edge. Default 37 mm. |
| Back setback (mm) | Distance of the back hole column from the panel's back edge. Default 37 mm. |
| Top margin (mm) | Clearance from the panel's top end to the first hole. Default 64 mm. |
| Bottom margin (mm) | Clearance from the panel's bottom end to the last hole. Default 64 mm. |
| Start offset (mm) | Shifts the whole hole run up or down from its default starting position — use this to align a shorter panel's grid with a neighboring full-height one. |
| Columns | **1 (front)** or **2 (front + back)** — most cabinets use 2. |
| Machining preset | If a saved [machining preset](./machining-presets.md) exists for System-32, pick it here to override diameter/depth/tooling from the preset instead of typing them by hand. |

## Tips & gotchas

- The **start offset** is what lets you line up System-32 columns across cabinets of
  different heights — it shifts the hole run's origin without changing pitch, so pin
  positions stay consistent from one cabinet to the next.
- Holes are always **blind** — the tool never generates a through-hole, so there's no
  through-diameter field to worry about.
- Manual mode's face is decided the instant you click the panel, before the dialog even
  opens, and it's not shown or editable in the dialog itself — if you need a face the role
  inference doesn't produce, this tool can't do it.
- To bore both sides consistently in one action, prefer **auto** over picking each side
  manually — auto also mirrors correctly, which manual (picking each side separately) leaves
  up to you to get right.

![Система-32 (shelf pins) dialog showing pitch, diameter, depth, setbacks, margins, and column defaults](/img/drilling-prisadka/system-32.png)

## See also

- [Generate Carcass Boring](./generate-carcass-boring.md)
- [Machining Presets](./machining-presets.md)
- [Editing and Clearing Bores](./editing-and-clearing-bores.md)
