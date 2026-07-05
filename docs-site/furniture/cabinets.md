---
title: Cabinets
---
# Cabinets
> Generates a complete cabinet carcass — sides, top, bottom, back, and (for most types) a
> toekick — as a set of role-tagged panels placed into the active assembly.

**Where:** Furniture ▸ Cabinets ▸ **Base Cabinet** / **Corner Cabinet** / **Blind Corner
Cabinet** / **Diagonal Corner Cabinet** · **Shortcut:** — · **Applies to:** assembly

## What it does

Each of the four buttons opens its own dialog and, on **OK**, builds a full multi-panel
carcass with `CreateCabinetCommand` and drops it into the active assembly as new components.
Every panel this generates carries a `role` (`leftSide`, `rightSide`, `top`, `bottom`, `back`,
`toekick`, `shelf`, `cornerPost`, `blindFiller`, `frontStile`, `door`, `hangingRail`) — that
tag is what lets [Generate Carcass Boring](../drilling-prisadka/generate-carcass-boring.md)
auto-detect joints later without you telling it what each panel is. Hand-built custom panels
(e.g. from [Panels](./panels.md)) have no role and are silently skipped by that auto path.

None of the four dialogs has a direct "thickness (mm)" field for the carcass — panel
thickness is always derived from the selected **Carcass material**'s (or **Back material**'s)
default thickness. To change a cabinet's panel thickness, pick a different material or edit
that material's default thickness in the registry.

## Before you start

- Have an assembly open. All four buttons are disabled — tooltip *"Open or create an assembly
  first"* — until `activeAssembly` exists.
- Have at least one material defined in the assembly's material registry. If none exist, the
  dialog shows *"No materials yet — close this dialog, click Manage materials, then re-open
  Base Cabinet."*

## Steps

1. Click the cabinet type you want in the Furniture ▸ Cabinets ribbon panel.
2. The dialog opens with sensible defaults already filled in.
3. Set dimensions, toekick (where applicable), and pick Carcass, Back, and (optionally) Edge
   band materials.
4. Click **OK**.

*Result: the cabinet's panels appear as new components in the active assembly, in the browser
tree.*

## Options

### Base Cabinet

| Field | Meaning |
|---|---|
| Name | Cabinet label. |
| Type | Base (floor) / Wall (upper) / Tall — applying a preset: Wall zeroes the toekick and sets depth to 320 mm; Tall sets height to 2100 mm. |
| Width / Depth / Height (mm) | Overall carcass dimensions. Defaults 600 / 560 / 720 mm. |
| Toekick height / setback (mm) | Defaults 100 / 50 mm. Zeroed by the Wall type preset. |
| Shelf count | Number of adjustable shelves, default 1, minimum 0. |
| Carcass material | Also fixes side/top/bottom/back panel thickness. |
| Back material | Fixes back-panel thickness. |
| Edge band material | Optional (default None) — bands the front edges of sides, top, bottom, and shelves. |

Panels created: `leftSide`, `rightSide`, `bottom`, `top`, `back`, `toekick` (if height > 0),
`hangingRail` (Wall type only), `shelf` × shelf count.

### Corner Cabinet (L)

| Field | Meaning |
|---|---|
| Width 1 / Depth 1 (mm) | Leg 1 dimensions. Default 900 / 600 mm. |
| Width 2 / Depth 2 (mm) | Leg 2 dimensions. Default 900 / 600 mm. |
| Height (mm) | Default 720 mm. |
| Carcass / Back / Edge band material | Same as Base Cabinet. |

Width 1 must exceed Depth 2 and Width 2 must exceed Depth 1 ("Leg must extend past the
corner"), or the dialog blocks OK. **No toekick and no shelf-count field** — this is the one
cabinet template without a toekick option.

Panels created: `rightSide` ("Leg 1 End"), `leftSide` ("Leg 2 End"), `back` × 2, `bottom` × 2,
`top` × 2, `cornerPost`.

### Blind Corner Cabinet

| Field | Meaning |
|---|---|
| Width / Depth / Height (mm) | Default 900 / 600 / 720 mm. |
| Toekick height / setback (mm) | Default 100 / 50 mm. |
| Blind side | Left / Right — which side the blind (inaccessible) bay sits on. Default Left. |
| Opening width (mm) | Width of the accessible opening; must be between 0 and Width. Default 450 mm. |
| Shelf count | 0–8, default 1. |
| Carcass / Back / Edge band material | Same as Base Cabinet. |

Panels created: `leftSide`, `rightSide`, `bottom`, `top`, `back`, `toekick`, `blindFiller`,
`shelf` × shelf count, and — unlike Base/Corner — a `door` panel plus hinge-cup/hinge-plate
hardware (`hinge-35mm-cup-full`) generated automatically as part of cabinet creation.

### Diagonal Corner Cabinet

| Field | Meaning |
|---|---|
| Wall width 1 / Wall width 2 (mm) | Default 900 / 900 mm. |
| Return depth 1 / Return depth 2 (mm) | Default 560 / 560 mm. Return depth 2 must not exceed Wall width 1. |
| Height (mm) | Default 720 mm. |
| Toekick height / setback (mm) | Default 100 / 50 mm. |
| Stile width (mm) | Door-stile width, default 50 mm; must be positive and leave a resulting door width of at least 100 mm. |
| Carcass / Back / Edge band material | Same as Base Cabinet. |

Panels created: `bottom` (pentagon outline), `top`, `back` × 2, `leftSide` ("Return Side 1"),
`rightSide` ("Return Side 2"), `toekick` × 2, `frontStile` × 2, and — like Blind Corner — a
`door` panel plus hinge bores/hardware generated automatically.

## Tips & gotchas

- **Only Corner Cabinet has no toekick.** Base, Blind Corner, and Diagonal Corner all expose
  toekick height/setback fields.
- **Blind Corner and Diagonal Corner auto-generate a door** (plus hinge-cup/plate bores) as
  part of cabinet creation — Base Cabinet and Corner Cabinet do not; you add doors to those
  separately with [Add Door](./doors.md).
- Panel thickness always comes from the selected material's default thickness, never a raw
  number typed into this dialog — if you need a different thickness, add/edit a material
  first.
- The `role` values these dialogs write are load-bearing for later tools: renaming or
  hand-editing a generated panel doesn't strip its role, but building a lookalike panel from
  scratch with [Panels](./panels.md) leaves it role-less and invisible to carcass-boring
  auto-detection.

<!-- SCREENSHOT: the four Cabinets ribbon buttons, and a Base Cabinet dialog with default values — TODO follow-up -->

## See also

- [Panels](./panels.md)
- [Doors](./doors.md)
- [Drawer Banks](./drawer-banks.md)
- [Generate Carcass Boring](../drilling-prisadka/generate-carcass-boring.md)
- [Materials](../concepts/materials.md)
