---
title: Handles and Pulls
---
# Handles and Pulls
> Adds a bar pull and its Ø5 mounting-screw bores to every drawer front in a cabinet, in one pass.

**Where:** Furniture ▸ Присадка ▸ **Add Handles** · **Shortcut:** — · **Applies to:** assembly (a cabinet already containing drawer fronts)

## What it does

**Add Handles** walks the drawer fronts of a picked cabinet and, for each one, adds a
visible bar-pull hardware part standing proud of the front, plus two Ø5 mm
mounting-screw bores drilled through the front on its outward face. The pull rolls
into the hardware BOM (one row per pull); the two bores roll into the connector BOM,
the boring CSV/DXF exports, and the 3D bore markers — the same pipelines every other
bore kind uses.

The bar pull is a simple hardware box, not a modeled bar-and-post pull — it exists to
give you a correct hardware BOM row and screw bores, not photoreal geometry.

## Before you start

- The active assembly must already have a cabinet with drawer fronts — run
  [Generate Carcass Boring](./generate-carcass-boring.md) and add a drawer bank first
  (the ribbon's **Add Drawers** button). A cabinet with zero drawer fronts is skipped
  with no effect.
- Handles are drawer-front only in the current build — there is no door-handle path
  yet, so doors don't get a pull or bores from this command.

## Steps

1. In the Furniture tab, Присадка panel, click **Add Handles** (disabled until an
   assembly is active).
2. Click the target cabinet in the 3D viewport to pick it.
3. In the **Add Drawer Handles** dialog, choose **Center-to-center** (96 mm, 128 mm,
   or 160 mm).
4. Click **Apply**.

*Result: every drawer front in the cabinet gains one bar-pull hardware part and two
Ø5 mm through bores at the chosen center-to-center spacing; the pulls appear in the
Hardware BOM and the screw bores appear in the Connector BOM.*

## Options

| Field | Meaning |
|---|---|
| Center-to-center | Distance between the two mounting screws on the pull, in mm. Pick a value that matches the pull hardware you'll actually buy — the three offered spacings (96/128/160 mm) are the common bar-pull sizes. |

## Tips & gotchas

- If a drawer front is too narrow for the chosen center-to-center spacing (the
  screws would exit the front's edge), that front is skipped and you're warned —
  pick a smaller spacing or widen the front.
- The two screw bores per front use a shared broad face (the front's outward
  `'Top'` face) and are `throughAll` depth — they go all the way through the 18 mm
  front into the pull.
- Undo removes both the pull component and its bores for every front the command
  touched, in one step.
- To later re-target a bore to the opposite face, or clear it, see
  [Editing and Clearing Bores](./editing-and-clearing-bores.md).

## See also

- [Generate Carcass Boring](./generate-carcass-boring.md)
- [Leg Levelers](./leg-levelers.md)
- [Machining Presets](./machining-presets.md)
- [Editing and Clearing Bores](./editing-and-clearing-bores.md)

<!-- SCREENSHOT: Add Drawer Handles dialog with the Center-to-center dropdown open — TODO follow-up -->
<!-- SCREENSHOT: cabinet with drawer fronts showing bar pulls + bore markers in the 3D viewport — TODO follow-up -->
