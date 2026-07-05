---
title: Dimensions
---
# Dimensions
> Places 2D dimension annotations (linear, radial, angular, and datum-based) on a drawing
> sheet, reading real measurements off the geometry a placed view projects.

**Where:** Drawing ▸ Dimension · **Shortcut:** — · **Applies to:** drawing (a placed view on
the active sheet)

## What it does

The Dimension panel is a group of tools for annotating a drawing sheet with dimensions:
pick two points or an edge on a placed view, and the tool drops a dimension line with the
measured value. This is a different feature from sketch dimensions — the parametric
constraints you add while sketching in the 3D modeler (see
[Dimensions](../modeling/dimensions.md)). Sketch dimensions drive the model's geometry;
drawing dimensions here are read-only annotations for documentation and manufacturing, and
changing one doesn't change the model.

Nine tools live in this panel: `Linear (H)`, `Linear (V)`, `Aligned`, `Radial`, `Diametric`,
`Angular` for picking dimensions manually, `Auto-Dim` for pulling dimensions straight from the
source sketch, and `Baseline` / `Ordinate` for datum-style dimension groups.

## Before you start

- Have a drawing sheet open with at least one view placed (see
  [Base and Projected Views](./base-and-projected-views.md)).
- Know which geometry you want to dimension — the tools work by clicking points, edges, or
  circles/arcs on a placed view.

## Steps

### Linear, aligned, radial, diametric, angular

1. Click the tool you need in the Drawing ▸ Dimension panel — `Linear (H)` for a horizontal
   distance, `Linear (V)` for vertical, `Aligned` for a distance along an edge at any angle,
   `Radial` for a circle/arc radius, `Diametric` for a circle/arc diameter, or `Angular` for
   the angle between two edges.
2. Click the geometry the tool expects — two points or an edge for the linear/aligned tools, a
   circle or arc for `Radial`/`Diametric`, two edges for `Angular`.
3. Move the mouse to place the dimension line at the offset you want, then click to drop it.

*Result: a dimension annotation appears on the sheet with the measured value, and stays
attached to the view's geometry.*

### Auto-Dim

1. Click **Auto-Dim** in the Drawing ▸ Dimension panel.
2. Click the view you want to dimension.

*Result: dimensions are generated automatically from the source sketch's own parametric
dimensions and parameters, without picking points by hand.*

### Baseline

1. Click **Baseline** in the Drawing ▸ Dimension panel.
2. Pick the baseline (origin) edge on the view.
3. Pick each feature you want dimensioned from that baseline, one after another.

*Result: a series of dimensions appears, each measured from the same shared origin edge.*

### Ordinate

1. Click **Ordinate** in the Drawing ▸ Dimension panel.
2. Pick the origin point or edge that establishes the datum.
3. Pick each feature you want an ordinate value for.

*Result: a single running datum appears, with a leader and value for each picked feature
measured from the shared origin.*

## Options

| Field | Meaning |
|---|---|
| (none — pick-driven) | These tools have no settings dialog; the dimension type, value, and placement are all determined by what you click and where you drop the line. |

## Tips & gotchas

- **Drawing dimensions vs. sketch dimensions** — don't confuse the two. Sketch dimensions
  (parametric, set while modeling) live in [Dimensions](../modeling/dimensions.md) and drive
  the model. Drawing dimensions here are annotations on a 2D sheet and don't feed back into
  the model.
- `Auto-Dim` only surfaces what the source sketch already has as dimensions/parameters — if the
  sketch itself is under-dimensioned, `Auto-Dim` won't invent values for you.
- `Baseline` and `Ordinate` are separate workflows from the six manual tools above — treat each
  click sequence as its own small flow rather than expecting the same two-point pattern.

## See also

- [Drawings](./index.md)
- [Annotations](./annotations.md)
- [Dimensions](../modeling/dimensions.md)

<!-- SCREENSHOT: the Dimension panel with all nine tools visible, and a placed view showing a mix of Linear, Radial, and Baseline dimensions — TODO follow-up -->
