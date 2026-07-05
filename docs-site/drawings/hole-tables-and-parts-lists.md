---
title: Hole Tables and Parts Lists
---
# Hole Tables and Parts Lists
> Inserts a table onto the drawing sheet: a Hole Table reading hole positions/sizes off a
> view, or a Parts List snapshotting the assembly's Bill of Materials.

**Where:** Drawing ▸ Annotate ▸ **Hole Table** / **Parts List** · **Shortcut:** — ·
**Applies to:** drawing

## What it does

`Hole Table` inserts a table listing the hole positions, sizes, and counts read from the
model's hole features, for a view you pick on the active sheet. `Parts List` inserts a table
that's a snapshot of the assembly's Bill of Materials — item number, description, quantity,
and so on — as of the moment you place it.

## Before you start

- **Hole Table** needs at least one view already placed on the active sheet (any placed
  Base, Projected, Iso, Section, or Detail view — it doesn't need to be selected first, just
  present). It's disabled otherwise.
- **Parts List** has no such requirement — it's always available.
- For a meaningful Parts List, the source assembly should already have its
  [Bill of Materials](../assemblies/bill-of-materials.md) built up.

## Steps

### Hole Table

1. Click **Hole Table** in the Drawing ▸ Annotate panel.
2. Click the view on the sheet you want the table to read holes from.

*Result: a table appears on the sheet listing hole positions, sizes, and counts from that
view's model.*

### Parts List

1. Click **Parts List** in the Drawing ▸ Annotate panel.
2. Click the sheet location where you want the table placed.

*Result: a Parts List table appears, listing item number, description, and quantity for every
row in the assembly's Bill of Materials as of when you placed it.*

## Options

| Field | Meaning |
|---|---|
| (none — pick-driven) | Neither tool has a settings dialog; `Hole Table` reads from the view you click, `Parts List` reads from the current BOM. |

## Tips & gotchas

- **`Hole Table` needs a view on the sheet, not a selected one** — as long as any projected
  view is present on the active sheet, the button is enabled; it doesn't matter which view is
  currently selected.
- **`Parts List` is a snapshot** — it reflects the [Bill of Materials](../assemblies/bill-of-materials.md)
  as of when it was placed. If you change the assembly's BOM afterward, don't assume the table
  updates on its own — check it against the current BOM before relying on it for production.
- Balloon item numbers on the drawing (see [Annotations](./annotations.md)) match the Parts
  List's item numbers, so the two are meant to be cross-referenced on the same sheet.

## See also

- [Drawings](./index.md)
- [Annotations](./annotations.md)
- [Bill of Materials](../assemblies/bill-of-materials.md)

<!-- SCREENSHOT: a drawing sheet with a Hole Table over a projected view and a Parts List table with matching balloon callouts — TODO follow-up -->
