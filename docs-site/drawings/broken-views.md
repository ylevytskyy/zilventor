---
title: Broken Views
---
# Broken Views
> Adds a zigzag break to a view so a long, mostly-uniform part can be shown shortened, without
> changing its dimensions.

**Where:** Drawing ▸ Place Views ▸ **Add Break** · **Shortcut:** — · **Applies to:** drawing
(a breakable view on the active sheet)

## What it does

**Add Break** inserts a break line into a view you've selected, so a long run of geometry can
be drawn shorter on the sheet while the underlying dimensions stay correct. The break persists
with the view — it's saved and restored along with the sheet.

## Before you start

- Select a "breakable" view on the active sheet first: plain **Base**, **Projected**, or
  **Iso** views qualify.
- **Section views and detail views are not breakable** — Add Break stays disabled for them.

## Steps

1. Select the view you want to break in the canvas.
2. Click **Add Break** in the Drawing ▸ Place Views ribbon panel.
3. In the confirm dialog, choose **Horizontal Break** or **Vertical Break**.

*Result: a zigzag break line is added to the selected view.*

## Options

| Field | Meaning |
|---|---|
| Horizontal Break | Breaks the view along a horizontal line. |
| Vertical Break | Breaks the view along a vertical line. |

## Tips & gotchas

- The dialog offers **Horizontal Break** and **Vertical Break** as two buttons to pick between
  — it is not a toggle, and there are not two separate ribbon buttons for the two orientations.
- **Section views and detail views cannot be broken.** If **Add Break** stays disabled, check
  whether the selected view is actually a plain base/projected/iso view.

## See also

- [Drawings](./index.md)
- [Base and Projected Views](./base-and-projected-views.md)
- [Section Views](./section-views.md)

<!-- SCREENSHOT: the Add Break confirm dialog with Horizontal Break / Vertical Break buttons, and a base view with a break applied — TODO follow-up -->
