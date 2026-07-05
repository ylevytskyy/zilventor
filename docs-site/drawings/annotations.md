---
title: Annotations
---
# Annotations
> Places non-dimension callouts on a drawing sheet — center marks, centerlines, leader text,
> and BOM-reference balloons.

**Where:** Drawing ▸ Annotate · **Shortcut:** — · **Applies to:** drawing (a placed view on
the active sheet)

## What it does

The Annotate panel holds the drawing markup tools that aren't dimensions: `Center Mark` and
`Centerline` for standard drafting symbols, `Leader Text` for free-form notes, and `Balloon` /
`Auto-balloon` for BOM item-number callouts on assembly drawings.

## Before you start

- Have a drawing sheet open with at least one view placed (see
  [Base and Projected Views](./base-and-projected-views.md)).
- For `Balloon` and `Auto-balloon`: the drawing must be sourced from an **assembly**, not a
  single part — a part-sourced drawing has no Bill of Materials to reference, so both tools
  stay disabled for it.

## Steps

### Center Mark

1. Click **Center Mark** in the Drawing ▸ Annotate panel.
2. Click the circular hole or feature you want to mark.

*Result: a center-mark cross annotation appears at the feature's center.*

### Centerline

1. Click **Centerline** in the Drawing ▸ Annotate panel.
2. Click the symmetric feature (or its two bounding edges) the centerline should run along.

*Result: a centerline annotation appears along the picked feature.*

### Leader Text

1. Click **Leader Text** in the Drawing ▸ Annotate panel.
2. Click the geometry you want the leader to point at.
3. Click again to place the text box, then type your note.

*Result: a text note with a leader line pointing at the geometry appears on the sheet.*

### Balloon

1. Click **Balloon** in the Drawing ▸ Annotate panel (only enabled on an assembly-sourced
   drawing).
2. Click the component in the view you want to call out.

*Result: a single balloon (a circle with an item number) appears, pointing at that component,
using the same item number as the Bill of Materials.*

### Auto-balloon

1. Click **Auto-balloon** in the Drawing ▸ Annotate panel (only enabled on an assembly-sourced
   drawing).
2. Click the view you want balloons placed on.

*Result: one balloon per Bill of Materials row appears automatically, anchored to each
component's bounding-box center in the view, with the same item numbers as the BOM.*

## Options

| Field | Meaning |
|---|---|
| (none — pick-driven) | These tools have no settings dialog; placement follows what you click. |

## Tips & gotchas

- **`Balloon` and `Auto-balloon` require an assembly drawing.** On a part-sourced drawing both
  buttons stay disabled, with a tooltip reading *"Balloon annotations require an assembly
  drawing"*.
- `Auto-balloon` is the one-click bulk version of placing `Balloon`s one at a time — use it
  first, then clean up or add individual `Balloon`s by hand if a component needs a different
  anchor point.
- Balloon item numbers are the same numbers used in the [Parts List](./hole-tables-and-parts-lists.md)
  table — the two are meant to be read together on an assembly drawing.

## See also

- [Drawings](./index.md)
- [Hole Tables and Parts Lists](./hole-tables-and-parts-lists.md)
- [Dimensions](./dimensions.md)

<!-- SCREENSHOT: an assembly drawing view with Center Mark, Centerline, and a set of Auto-balloon balloons placed, alongside a Leader Text note — TODO follow-up -->
