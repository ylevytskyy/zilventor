---
title: Leg Levelers
---
# Leg Levelers
> Fits adjustable leg-levelers under a base cabinet: baseplate screw bores, 3D legs, and a hardware BOM row, in one pass.

**Where:** Furniture ▸ Присадка ▸ **Add Leg Levelers** · **Shortcut:** — · **Applies to:** assembly (a base cabinet with a toekick)

## What it does

**Add Leg Levelers** drills the baseplate screw bores into the underside of a base
cabinet's bottom panel, places the leg components in 3D (hidden behind the toekick
once one is fitted), and adds them to the hardware BOM. You choose how many legs go
in each row (front and back); the total leg count is always twice that.

Each leg gets 4 screw bores in a square pattern (dimensions and screw size come from
the leg SKU's catalog entry, not typed in by hand), so the bore count is
`4 × 2 × legsPerRow`.

## Before you start

- The active assembly must be a **base cabinet with a toekick** (`toekickHeight > 0`)
  — legs are a base-cabinet concern and have nowhere to hide without a toekick panel.
  A cabinet with no toekick is rejected with an error.
- The bottom panel must exist (any normal base cabinet has one).

## Steps

1. In the Furniture tab, Присадка panel, click **Add Leg Levelers** (disabled until
   an assembly is active).
2. Click the target base cabinet in the 3D viewport to pick it.
3. In the **Add Leg Levelers** dialog, set **Legs per row** (minimum 2) and pick a
   **Leg model** from the SKU dropdown.
4. If a [machining preset](./machining-presets.md) exists for operation type
   `legLeveler`, an extra **Machining preset** dropdown appears — pick one to seed
   the bore diameter/depth/layer (and tool number/speed, if set) for every screw bore
   this command creates.
5. Click **OK**.

*Result: `2 × legsPerRow` leg components appear under the cabinet, each anchored by 4
screw bores on the bottom panel's underside; the legs appear in the Hardware BOM with
quantity `2 × legsPerRow`.*

## Options

| Field | Meaning |
|---|---|
| Legs per row | Number of legs along one row (front or back), minimum 2. Total legs placed = `2 × legsPerRow`. |
| Leg model | Which leg-leveler SKU to place (filtered to the `legLevelers` hardware category; default `leg-leveler-100`). |
| Machining preset (optional) | Only shown when a saved preset's operation type is `legLeveler`. Applying one seeds the screw-bore diameter, depth, target layer, and (if set) tool number/speed for this run — it does not create a live link back to the preset. |
| *(helper text)* Total legs | Read-only confirmation of `2 × legsPerRow`, shown once the leg count is valid. |

## Tips & gotchas

- The dialog stays open and shows an error instead of closing if: the cabinet has no
  toekick, legs-per-row is below 2, the leg SKU has no bore spec, or the leg's screw
  pattern doesn't fit the bottom panel at the chosen leg count — fix the input and
  retry.
- **Known limitation:** the 3D leg model is always the catalog's nominal height
  (120 mm for `leg-leveler-100`), top-aligned to the panel underside — if your
  cabinet's actual toekick height differs, the leg model will visually float or
  penetrate the floor slightly. The screw bores themselves are correct regardless;
  real leg-levelers are height-adjustable, so this is a display-only placeholder.
- Undo removes both the baseplate bores and the leg components together.

## See also

- [Generate Carcass Boring](./generate-carcass-boring.md)
- [Handles and Pulls](./handles-and-pulls.md)
- [Machining Presets](./machining-presets.md)
- [Editing and Clearing Bores](./editing-and-clearing-bores.md)

<!-- SCREENSHOT: Add Leg Levelers dialog with legs-per-row, leg model, and machining-preset fields — TODO follow-up -->
<!-- SCREENSHOT: base cabinet underside showing leg components + baseplate bore markers — TODO follow-up -->
