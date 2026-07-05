---
title: Base and Projected Views
---
# Base and Projected Views
> Places a live 2D projection of a part or assembly onto a sheet — the starting point for every
> other view type in a drawing.

**Where:** Drawing ▸ Place Views ▸ **Base View** / **Projected View** / **Iso View** ·
**Shortcut:** — · **Applies to:** drawing (sheet must be active)

## What it does

**Base View**, **Projected View**, and **Iso View** all place a view of the source model onto
the active sheet, and all three open the same **Add View** dialog after you pick what to
project:

- **Base View** projects a straight orthographic view (front, top, right, ...) of the source
  part or assembly. It's the first view you place on a sheet — every projected view derives
  from a base view.
- **Projected View** derives a new view by projecting off an existing view on the sheet
  (top/bottom/left/right of it), and stays aligned with it.
- **Iso View** places an isometric view of the source model from one of its four top corners.

Every view is a **live projection**: if the source part or assembly changes after the view is
placed, the view can go stale and needs to be brought up to date (see Tips & gotchas below).

## Before you start

- Have a drawing sheet active.
- Have the source part or assembly you want to draw available to pick.
- For **Projected View**, have at least one base view already placed on the sheet.

## Steps

### Base View

1. Click **Base View** in the Drawing ▸ Place Views ribbon panel.
2. Click the source part or assembly.
3. In the **Add View** dialog, set **Orientation** and **Scale**, then confirm.

*Result: a new base view of the model appears on the sheet.*

### Projected View

1. Click **Projected View**.
2. Click the existing view on the sheet you want to project from.
3. In the **Add View** dialog, confirm the **Parent view** and pick a **Direction**, then
   confirm.

*Result: a new view, aligned to its parent, appears on the sheet.*

### Iso View

1. Click **Iso View**.
2. Click the source part or assembly.
3. In the **Add View** dialog, set **Corner** and **Scale**, then confirm.

*Result: a new isometric view of the model appears on the sheet.*

## Options

| Field | Meaning | Applies to |
|---|---|---|
| Orientation | Which orthographic face to view from: front, top, right, back, bottom, left. | Base View |
| Parent view | Which existing view on the sheet to project from. | Projected View |
| Direction | Which side of the parent view to project toward: Top, Bottom, Left, Right. | Projected View |
| Corner | Which top corner to view the isometric from: NE, NW, SE, SW. | Iso View |
| Scale | Numerator/denominator scale ratio for the view. | Base View, Iso View |

## Tips & gotchas

- **Auto-update views** (Drawing ▸ Reference ▸ **Auto-update views**) is a toggle that
  automatically regenerates stale views whenever their source model changes. When it's off, a
  stale view instead shows a small warning-glyph badge directly on the view in the canvas —
  click that badge to regenerate the view manually. This same manual-regenerate mechanism
  applies to section and detail views too.
- **Dragging a base view in the canvas cascades to its projected views** — every projected
  view that derives from it moves along with it, so alignment is preserved automatically. You
  don't need to reposition projections by hand after moving their base view.

## See also

- [Drawings](./index.md)
- [Section Views](./section-views.md)
- [Detail Views](./detail-views.md)
- [Sheets](./sheets.md)

<!-- SCREENSHOT: the Add View dialog for a Base View (Orientation + Scale fields) and for a Projected View (Parent view + Direction fields) — TODO follow-up -->
