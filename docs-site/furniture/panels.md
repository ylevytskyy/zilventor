---
title: Panels
---
# Panels
> Defines a freeform sheet-good panel — length, width, thickness, material, grain, and
> edge-banding — the building block underneath every cabinet, door, and drawer part.

**Where:** Furniture ▸ Create ▸ **Panel** · **Shortcut:** — · **Applies to:** part or assembly

## What it does

Panel opens a dialog for a single rectangular sheet-good part: its dimensions, material,
grain direction, and which of its four edges get banded. What happens on **OK** depends on
where you are:

- **In an empty part**, the panel becomes that part's first feature (`AddPanelFeatureCommand`).
  The part must have no existing user features — Panel is meant to be the starting shape, not
  an addition.
- **In an assembly** (no active part), Panel auto-creates a brand-new part file (`.zipt`),
  inserts the panel as its first feature, and places it into the assembly as a component at
  the origin — all as one undoable step (`CreateAndPlacePanelCommand`).

This is the generic, freeform version of what the [Cabinets](./cabinets.md) templates do in
bulk — reach for it when you need a one-off shelf, filler, or custom panel that isn't part of
a cabinet template.

## Before you start

- Have either an empty active part, or an active assembly, open. The **Panel** button is
  disabled if neither exists.
- If targeting a part: the part must not already have a feature on it — Panel dialog throws
  if you try to add a panel to a part that already has a shape.

## Steps

1. Click **Panel** in the Furniture ▸ Create ribbon panel.
2. The **Panel** dialog opens, pre-filled with Length 600 mm, Width 400 mm, Thickness 18 mm
   (tagged `(from material)` until you type over it), and the first material in the registry.
3. Set Length, Width, Thickness, Material, Grain, and any Edge bands you want.
4. Click **OK**.

*Result: in a part, the panel becomes the part's shape; in an assembly, a new part is created,
placed at the origin, and appears as a component in the browser tree.*

## Options

| Field | Meaning |
|---|---|
| Length / Width (mm) | Panel plan dimensions. Accepts a literal number or `=paramName` to bind to a parameter. |
| Thickness (mm) | Panel thickness. Shows a `(from material)` badge and auto-fills from the selected material's default thickness until you type a value yourself, which clears the badge. |
| Material | Picked from the active material registry; **Manage…** opens the registry editor inline without leaving the dialog. |
| Grain | Length / Width / None — which local direction the panel's grain runs, shown with a direction arrow. |
| Edge bands (Front/Back/Left/Right) | Per-edge material pick, default `<None>`. Band thickness comes from the chosen material's band thickness (0.4 mm if unset), not user-editable here. |

## Tips & gotchas

- Panel must be the **first** feature in a part — you can't use it to add a second shape to an
  existing part.
- In assembly mode the new component always lands at position (0, 0, 0) with zero rotation —
  move or rotate it afterward via Edit Component.
- If the panel's material or edge-band material doesn't resolve against the active registry
  (a broken reference), the dialog shows an inline error and disables OK until you pick a
  valid material.

<!-- SCREENSHOT: Panel dialog with default values, and the resulting placed panel component in an assembly browser tree — TODO follow-up -->

## See also

- [Cabinets](./cabinets.md)
- [Hardware](./hardware.md)
- [Cut List](./cut-list.md)
- [Materials](../concepts/materials.md)
