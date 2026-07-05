---
title: Generate Carcass Boring
---
# Generate Carcass Boring
> Auto-generates confirmat, minifix, and/or dowel joint bores across every detected
> panel-to-panel carcass joint in the active assembly.

**Where:** Furniture ▸ Присадка ▸ **Генерувати присадку** ("Generate Bores") · **Shortcut:** —
· **Applies to:** assembly (a cabinet built from a cabinet template)

## What it does

This is the "run once and bore the whole carcass" tool. It walks the active assembly (and
recurses into any nested cabinet sub-assemblies), finds every standard carcass joint —
side↔bottom, side↔top, side↔shelf — and generates connector bores for the joint types you
select. Bores are written in pairs: one set on the **face-drilled** panel (the one whose
broad face the connector passes through) and a matching set on the **end-drilled** panel (the
one the connector lands in end-grain). Left/right sides are boreholed independently, mirrored
correctly for each side.

Running it again on the same assembly merges with (rather than duplicating) any bores you've
already generated or manually added.

## Before you start

- Have an assembly open that contains at least one cabinet built from a **cabinet template**
  (Base Cabinet, corner cabinet, etc.). The auto-detection reads each panel's `role`
  (leftSide, rightSide, bottom, top, shelf), which cabinet templates set automatically.
- Hand-built or imported panels with no role are **silently skipped** — they simply get no
  bores, with no warning. If you need boring on a custom panel, this tool isn't it (there is
  currently no manual two-panel picker exposed in the UI for carcass joints).
- Back panels (grooved/rebated into the sides) and toekicks are intentionally excluded — they
  are not connector-drilled by this tool.

## Steps

1. With the assembly open, click **Генерувати присадку** in the Furniture ▸ Присадка ribbon
   panel.
2. In the dialog, check the connector type(s) you want: **Confirmat**, **Minifix**, and/or
   **Dowel**. At least one must be checked — the OK button stays disabled otherwise.
3. Click **OK**.

*Result: bore markers appear on every carcass joint the tool found, colored by connector
type; bore data is written to each involved panel's document.*

## Options

| Field | Meaning |
|---|---|
| Confirmat (7×50 eurofix) | Adds a through-hole on the face-drilled panel and a matching end-hole on the mating panel. Checked by default. |
| Minifix (Ø15 cam) | Adds a cam-housing bore on the face-drilled panel, a bolt bore in the mating panel's end, and a cross-bore connecting them. |
| Dowel (Ø8) | Adds a plain alignment dowel hole pair — often combined with confirmat. |

## Tips & gotchas

- **End setback ≈ 60 mm, max spacing ≈ 250 mm, minimum 2 bores per joint.** Along any given
  joint, the tool places bores starting 60 mm in from each panel end, never more than 250 mm
  apart, with at least 2 bores even on a short joint.
- You can check more than one connector type at once — the tool then generates all of them
  along the same joints (e.g. confirmat + dowel together, a common combination).
- Only a joint's panels *within the same cabinet group* are paired — the tool won't connect
  panels across two unrelated cabinets even if they happen to touch in the viewport.
- There's no live preview: the dialog just has three checkboxes. If the result looks wrong,
  undo and check that the panels involved actually carry a `role` (i.e. came from a cabinet
  template).
- To hand-place a connector pair between two arbitrary panels, or to override the auto result,
  use [Editing and Clearing Bores](./editing-and-clearing-bores.md).
- To get the drilling coordinates out to a machine, see
  [Exporting Boring Data](./exporting-boring-data.md).

![Boring dialog with all three connector-type checkboxes (Confirmat, Minifix, Dowel) checked](/img/drilling-prisadka/boring-dialog.png)

## See also

- [System-32 Shelf Pins](./system-32-shelf-pins.md)
- [Editing and Clearing Bores](./editing-and-clearing-bores.md)
- [Exporting Boring Data](./exporting-boring-data.md)
