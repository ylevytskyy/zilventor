---
title: Patterns and Mirror
---
# Patterns and Mirror

> Multiply or mirror a whole placed component across an assembly — rectangular grid, circular
> array, or mirrored copy — without re-placing it by hand.

**Where:** Assembly tab ▸ Pattern group · **Shortcut:** none — ribbon-button-only (the letters
you might expect, like L or M, are already claimed by the separate part-feature Linear
Pattern/Mirror dialogs) · **Applies to:** assembly

> **Scope note:** this page covers **component-level** patterning — multiplying or mirroring a
> whole *placed component* inside an assembly. It is entirely separate from **part-feature-level**
> patterning, which repeats or mirrors *geometry inside a single part* (holes, pockets, ribs, and
> so on). For that, see [Patterns and Mirror (part features)](../modeling/patterns-and-mirror.md).
> If you picked a component in the browser tree or viewport and want copies of the whole thing,
> you're in the right place; if you're inside a part editing a feature, you want the other page.

## What it does

The Pattern group holds three tools that generate additional instances of an existing
component in the assembly: **Rectangular Pattern** (a grid along one or two axes), **Mirror**
(a single reflected copy across a coordinate plane), and **Circular Pattern** (copies spaced
around an axis). Each tool reads the source component's current position and produces new
top-level components positioned relative to it — useful for repeating hardware, shelves, legs,
or any part that shows up more than once in a design.

## Before you start

- Have an assembly open with at least one top-level component already placed — the **Source**
  dropdown in every dialog lists top-level components, so the part you want to multiply or
  mirror must exist first.
- Know which axis and origin your assembly is built around; all three dialogs work in assembly
  coordinates (X/Y/Z), not screen space.

## Steps

### Rectangular Pattern

1. Click **Rectangular Pattern** in the ribbon. *A floating "Rectangular Pattern" panel opens
   near the top-right of the viewport — it's not a full-screen modal, so the model stays visible
   behind it.*
2. Pick the component to multiply from **Source**.
3. Under **Direction 1**, choose an **Axis** (X, Y, or Z), a **Count 1**, and a **Spacing 1**.
4. Optionally check **Second direction** to reveal a **Direction 2** block with its own Axis,
   Count 2, and Spacing 2 — Direction 2's axis must differ from Direction 1's.
5. Click **OK**. *Result: the browser tree gains one new component instance per grid cell
   (Count 1 × Count 2, or just Count 1 if only one direction is used).*

### Mirror

1. Click **Mirror** in the ribbon. *The "Mirror Component" panel opens near the top-right.*
2. Pick the component to mirror from **Source**.
3. Choose a **Plane** — YZ, XZ, or XY — using the toggle buttons. An inline hint clarifies each
   one: "YZ mirrors across x=0; XZ across y=0; XY across z=0."
4. Click **OK**. *Result: a new component appears as a true mirror image of the source, backed
   by its own new part file.*

### Circular Pattern

1. Click **Circular Pattern** in the ribbon. *The "Circular Pattern" panel opens near the
   top-right.*
2. Pick the component to multiply from **Source**.
3. Choose the rotation **Axis** (X, Y, or Z) and, if needed, adjust **Center** (defaults to
   0/0/0).
4. Set **Count (incl. source)** — the source counts as the first instance, so 4 means the
   source plus 3 copies — and **Total angle** in degrees (defaults to 360, full circle).
5. Leave **Rotate instances** checked to have each copy follow the circle's rotation, or
   uncheck it to keep every copy at the source's original orientation.
6. Click **OK**. *Result: the browser tree gains Count − 1 new components arranged around the
   axis.*

## Options

### Rectangular Pattern

| Field | Meaning |
|---|---|
| Source | Dropdown of every top-level component in the assembly |
| Direction 1 ▸ Axis | X / Y / Z toggle for the first patterning direction |
| Count 1 | Integer, 2–200 |
| Spacing 1 | Non-zero number, mm |
| Second direction | Checkbox; enables a Direction 2 block with its own Axis / Count 2 / Spacing 2 |

Inline validation: "Count 1 must be an integer 2–200.", "Spacing 1 must be a non-zero
number.", "Direction 2 must differ from Direction 1."

### Mirror

| Field | Meaning |
|---|---|
| Source | Dropdown of every top-level component in the assembly |
| Plane | YZ / XZ / XY toggle — the mirror plane, with a hint showing which coordinate it reflects across |

### Circular Pattern

| Field | Meaning |
|---|---|
| Source | Dropdown of every top-level component in the assembly |
| Axis | X / Y / Z toggle for the rotation axis |
| Center | X/Y/Z number inputs for the rotation center, default 0/0/0 |
| Count (incl. source) | Integer, 2–200; e.g. 4 = source + 3 copies |
| Total angle | Degrees, >0 and ≤360, default 360 |
| Rotate instances | Checkbox, checked by default; rotates each copy to follow the circle instead of keeping the source's original orientation |

## Tips & gotchas

- All three dialogs are floating panels pinned near the top-right of the viewport, not
  full-screen modals — you can still see and orbit the model while one is open.
- A **Mirror** copy is backed by its own new part file, not just a transform of the original —
  editing the mirrored part does not change the source, and vice versa.
- **Circular Pattern** disables OK with the error "Source lies on the rotation axis — copies
  would overlap; move the center." if the source is within 0.1 mm of the rotation axis.
- Every patterned or mirrored copy is a full component instance, so each one adds its own row
  and quantity to the [bill of materials](./bill-of-materials.md).
- If you need to repeat a *feature* inside one part (a hole grid on a single panel, say) rather
  than a whole placed component, use the part-feature
  [Patterns and Mirror](../modeling/patterns-and-mirror.md) tools instead.

## See also

- [Patterns and Mirror (part features)](../modeling/patterns-and-mirror.md)
- [Placing Components](./placing-components.md)
- [Bill of Materials](./bill-of-materials.md)
- [Glossary](../reference/glossary.md)

<!-- SCREENSHOT: the Rectangular Pattern dialog with Direction 1 filled in and Second direction expanded — TODO follow-up -->
<!-- SCREENSHOT: the Mirror Component dialog with the YZ plane selected and its hint text visible — TODO follow-up -->
<!-- SCREENSHOT: the Circular Pattern dialog with Count, Total angle, and Rotate instances visible — TODO follow-up -->
