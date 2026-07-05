---
title: Sketching
---
# Sketching
> Draws the 2D profile — lines, rectangles, circles, arcs, and splines — that constraints, dimensions, and 3D features are built on.

**Where:** Sketch tab ▸ Sketch panel ▸ **2D Sketch** (to enter) / **Finish Sketch** (to exit) ·
**Shortcut:** — · **Applies to:** part

## What it does

A sketch is a flat 2D drawing that later becomes the input to a 3D feature such as Extrude or
Revolve. Zilventor's Sketch tab gives you a small set of draw tools (line, rectangle, circle,
arc, spline), a construction-geometry toggle for reference-only entities, and two side doors
for getting geometry in without freehand drawing: a numeric rectangle dialog and DXF import.

## Before you start

- Have a part open. Sketching is disabled on [imported parts](./index.md) — they're read-only.

## Steps

### Enter and exit sketch mode

1. Click **2D Sketch**. If the part already has a sketch feature, this reuses the most recent
   one; otherwise it creates a new sketch on the XY origin plane.
2. Draw and edit geometry using the tools below.
3. Click **Finish Sketch** to leave sketch mode and return to Ready status.

*Result: the sketch feature is added to (or updated on) the part's feature tree.*

### Draw tools

1. Click **Select** to pick and move existing geometry without drawing.
2. Click **Line** (shortcut **L**) and click to place each segment's endpoints.
3. Click **Rectangle** (shortcut **R**) and click two opposite corners.
4. Click **Circle** (shortcut **C**) and click a center point, then a radius point.
5. Click **Arc** (shortcut **A**) and click the arc's defining points.
6. Click **Spline** (shortcut **S**) and click each control point in sequence.

*Result: the new entities appear in the active sketch, ready to be constrained and dimensioned.*

### Construction geometry

1. Click **Construction** to toggle construction mode on.
2. Draw with any of the tools above — entities drawn while the toggle is on are marked as
   construction geometry (reference-only, not part of the profile a feature will consume).
3. Click **Construction** again to go back to drawing normal (profile) geometry.

*Result: subsequently drawn entities are flagged as construction geometry until you toggle it off.*

### Numeric rectangle

Use this when you want an exact rectangle without dragging corners on screen.

1. Click **Numeric rectangle…** — this is always available, even outside sketch mode.
2. Fill in the dialog fields (see Options below).
3. Click **OK**.

*Result: a brand-new sketch feature is created containing one rectangle sized from your inputs.*

### Import DXF

1. With a sketch active, open the Import panel and click **Import DXF…**.
2. Pick a `.dxf` file in the file picker.

*Result: the DXF geometry is added directly into the currently active sketch.*

## Options

**Numeric rectangle dialog** ("Rectangle (two corner points)"):

| Field | Meaning | Default |
|---|---|---|
| x1 | X coordinate of the first corner | 0 |
| y1 | Y coordinate of the first corner | 0 |
| x2 | X coordinate of the opposite corner | 100 |
| y2 | Y coordinate of the opposite corner | 200 |

On **OK**, the two corner points are normalized into a width/height rectangle.

## Tips & gotchas

- The **Construction** button's label carries a hardcoded "(X)" hint, but no `X` keyboard
  shortcut is actually wired up anywhere in the app — click the button, don't reach for a key.
- **Numeric rectangle…** does not add to whatever sketch you currently have open — it always
  creates a separate, brand-new sketch feature containing just that one rectangle.
- **Import DXF…** is only enabled while a sketch is active, and it imports directly into that
  sketch — unlike Numeric rectangle, it does not spin up a new sketch feature of its own.
- Don't confuse the Sketch tab's 2D **Offset**, **Fillet**, **Chamfer**, **Trim**, **Extend**,
  and **Project** tools with the 3D **Fillet**/**Chamfer** tools under the Model tab
  ([Modify Features](./modify-features.md)) — the names overlap on purpose (they do
  analogous things), but the sketch-tab versions only ever touch 2D sketch geometry.

<!-- SCREENSHOT: Sketch tab ribbon with draw tools, Construction toggle, and the Numeric rectangle dialog open — TODO follow-up -->

## See also

- [Constraints](./constraints.md)
- [Dimensions](./dimensions.md)
- [DXF import/export](../import-migration/dxf-files.md)
