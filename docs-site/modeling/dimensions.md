---
title: Dimensions
---
# Dimensions
> Adds parametric, named-parameter-driven measurements to a sketch, so lengths, radii, and angles can be edited or expression-driven later.

**Where:** Sketch tab ▸ Dimension panel ▸ **General Dimension** · **Shortcut:** **D** ·
**Applies to:** part (sketch)

This page covers **sketch** dimensioning — driving, parametric dimensions placed while editing
a 2D sketch. It's distinct from drawing dimensions used when annotating a 2D drawing sheet.

## What it does

**General Dimension** measures and drives a piece of sketch geometry: pick what to dimension,
and the tool creates a length, radius, diameter, or angle dimension that is a **named
parameter** from the moment it's created. Its value field accepts a plain number or a
parametric expression that can reference other named parameters, so dimensions can be linked
together instead of hardcoded independently. The button is only enabled in sketch mode.

## Before you start

- Have a sketch active with the geometry you want to dimension already drawn.

## Steps

### Placing a new dimension

1. Click **General Dimension** (or press **D**).
2. Select the geometry to dimension.
3. In the **Edit Dimension** dialog that appears near the cursor, fill in the fields (see
   Options below).
4. Click to confirm placement.

*Result: the dimension appears on the sketch, registered as a named parameter, and the
solver's DOF count updates accordingly.*

If the new dimension would over-constrain the sketch, a toast appears with a **Show conflict**
action; clicking it highlights the conflicting constraints for 3 seconds.

### Editing a placed dimension

1. Double-click the dimension's on-canvas label — an inline text editor opens directly over
   the label (no dialog).
2. Type the new value and confirm.

Behavior depends on what the dimension currently is:

- **Literal value:** only plain arithmetic is accepted (e.g. `100/2`, `2*30+5`). Typing a
  reference to a named parameter (e.g. `width-18`) is rejected with a toast: *"References a
  parameter — bind it via the dimension dialog."* Length, radius, and diameter dimensions must
  be greater than 0; angle dimensions are entered and stored in degrees.
- **Parameter-driven:** the typed text goes through the full parametric expression engine —
  it can reference other named parameters — and committing updates the parameter's expression.

*Result: the dimension's value (or driving expression) updates and the sketch re-solves.*

## Options

**Edit Dimension dialog** (shown when placing a new dimension):

| Field | Meaning |
|---|---|
| Name | Text field, prefilled with an auto-generated parameter name. |
| Value | Text field; accepts a number or a parametric expression. Shows a unit suffix (`mm` or `deg`) depending on the dimension type. |

## Tips & gotchas

- Placing a new dimension always goes through the full parametric expression engine, but
  editing an existing **literal-value** dimension inline only accepts plain arithmetic — typing
  a parameter reference into that inline editor is rejected. This asymmetry surprises people
  who expect any dimension field to accept an expression; if you need to bind a literal
  dimension to a parameter, re-open it through the dimension dialog rather than the inline
  editor.
- Angle dimensions are always in degrees, regardless of how other lengths are configured.

<!-- SCREENSHOT: Edit Dimension dialog on a newly placed length dimension, and the inline editor over an existing dimension label — TODO follow-up -->

## See also

- [Constraints](./constraints.md)
- [Extrude, Revolve & Sweep](./extrude-revolve-sweep.md)
