---
title: Detail Views
---
# Detail Views
> Zooms in on a small region of an existing view and places it as its own, larger-scale view on
> the sheet.

**Where:** Drawing ▸ Place Views ▸ **Detail** / **Detail (Rect)** · **Shortcut:** — ·
**Applies to:** drawing (an existing view on the active sheet)

## What it does

**Detail** and **Detail (Rect)** both create a new, zoomed-in view of a region you mark on an
existing view — Detail uses a circular region, Detail (Rect) a rectangular one. Once a detail
view exists, **Edit Detail Region** lets you resize or reposition the region it's showing
without recreating the detail view from scratch.

## Before you start

- Have at least one view with a projection already placed on the active sheet — Detail,
  Detail (Rect), and Edit Detail Region are all disabled until one exists.
- For **Edit Detail Region**, have at least one detail view already on the sheet.

## Steps

### Create a detail view

1. Click **Detail** (circular) or **Detail (Rect)** (rectangular) in the Drawing ▸ Place Views
   ribbon panel.
2. Draw the region — a circle or a rectangle — over the area of an existing view you want to
   zoom in on.

*Result: a new, larger-scale detail view of that region is placed on the sheet.*

### Edit a detail view's region

1. Click **Edit Detail Region**.
2. Drag the handles on the detail's region outline, in the canvas, to resize or reposition it.

*Result: the detail view updates to reflect the new region.*

## Options

| Field | Meaning |
|---|---|
| — | Detail, Detail (Rect), and Edit Detail Region are all driven by drawing/dragging directly in the canvas — there is no settings dialog. |

## Tips & gotchas

- **Edit Detail Region** is a drag interaction on the region outline's handles, not a dialog —
  don't go looking for numeric fields to type a new region into.
- Both Detail and Detail (Rect) need an existing projected view to draw from — they're
  disabled on an empty sheet.

## See also

- [Drawings](./index.md)
- [Base and Projected Views](./base-and-projected-views.md)
- [Section Views](./section-views.md)

<!-- SCREENSHOT: a Detail (Rect) region being drawn over a base view, and the Edit Detail Region handles on an existing detail view — TODO follow-up -->
