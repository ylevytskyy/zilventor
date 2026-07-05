---
title: Section Views
---
# Section Views
> Cuts an existing view along a line you draw and replaces it with a new view showing the
> internal geometry at that cut, with material-colored hatch fill.

**Where:** Drawing ▸ Place Views ▸ **Section** / **Half Section** / **Stepped Section** ·
**Shortcut:** — · **Applies to:** drawing (an existing view on the active sheet)

## What it does

Section, Half Section, and Stepped Section all compute a real OCCT boolean cut of the source
model along a line you draw across an existing view, then render the result as a new section
view with hatch fill colored by material:

- **Section** cuts straight through along a single line.
- **Half Section** cuts the same way but lets you choose which side to keep versus cut, via a
  side-choice preview.
- **Stepped Section** cuts along a line with one or more steps (jogs), rather than a single
  straight line.

## Before you start

- Have at least one base, projected, or iso view already placed on the active sheet — the
  section tools cut an existing view, they don't start from nothing.

## Steps

1. Click **Section**, **Half Section**, or **Stepped Section** in the Drawing ▸ Place Views
   ribbon panel.
2. Draw the cut line across the view you want to section, in the canvas.
3. For **Half Section**, a side-choice preview appears — pick which side to keep.
4. Place the resulting section view on the sheet.

*Result: a new section view appears on the sheet, cut along the line you drew and filled with
material-colored hatch.*

## Options

| Field | Meaning |
|---|---|
| — | These tools are driven by drawing the cut line in the canvas rather than a settings dialog; Half Section additionally asks which side to keep. |

## Tips & gotchas

- There is **no ribbon button labeled "Regenerate."** If the source model changes after a
  section view is created, the section can go stale — it shows a small warning-glyph badge
  directly on the view; click that badge to recompute the cut. If **Auto-update views**
  (Drawing ▸ Reference) is on, this happens automatically instead. See
  [Base and Projected Views](./base-and-projected-views.md) for the toggle.
- Section views cannot themselves be broken — see [Broken Views](./broken-views.md).

## See also

- [Drawings](./index.md)
- [Base and Projected Views](./base-and-projected-views.md)
- [Detail Views](./detail-views.md)

<!-- SCREENSHOT: a Section view mid-cut-line-drawing on a base view, and the resulting section view with material hatch fill — TODO follow-up -->
