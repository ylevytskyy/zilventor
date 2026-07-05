---
title: Assemblies
---
# Assemblies

> The document type that puts parts together: an assembly (`.ziasm`) places instances of other
> files — leaf parts and nested sub-assemblies — and positions, constrains, and patterns them
> into a cabinet, carcass, or larger structure.

An assembly file's `components` array is a list of placed instances. Each instance points at
another file — a leaf part (`.zipt`) or another assembly (`.ziasm`) — and carries its own
position and rotation (or an additive `pose` on top of a template's stored transform), its own
visibility and color, and an optional `flexible` flag. Because an assembly can place another
assembly, nesting is recursive: a sub-assembly inside an assembly shows up in the Browser pane
as an expandable tree row, and opening it reveals its own placed components underneath.

## The Assembly ribbon tab

Zilventor shows an **Assembly** ribbon tab only while the open document is an assembly — switch
to a part or a drawing and the tab disappears. It groups its tools into four clusters, and each
cluster maps to one of the pages in this section:

- **Component** — Place, Insert From STEP, Edit, Delete. Covered in
  [Placing Components](./placing-components.md).
- **Constraint** — Mate, Flush, Angle, Insert, Edit, Delete, Suppress. Covered in
  [Constraints](./constraints.md).
- **Pattern** — Rectangular, Mirror, Circular. Covered in
  [Patterns and Mirror](./patterns-and-mirror.md).
- **BOM** — BOM, Renumber. Covered in [Bill of Materials](./bill-of-materials.md).

Interference checking is *not* on this tab — it lives on a separate **Inspect** ribbon tab.
See [Interference Check](./interference-check.md).

## The Browser pane doubles as a view switcher

The left-hand Browser pane isn't just the component tree: it's also a tab strip with Assembly,
BOM, Cut List, Nesting, Statistics, and Production views. Clicking the ribbon's **BOM** button,
for example, switches this strip over to the BOM tab rather than opening a separate window —
the same pane keeps showing whichever view you last selected until you switch again.

## Pages in this section

| Page | What it covers |
|---|---|
| [Placing Components](./placing-components.md) | Adding part/assembly instances, inserting from STEP, editing and deleting placements |
| [Constraints](./constraints.md) | Mate, Flush, Angle, and Insert constraints that position components relative to each other |
| [Patterns and Mirror](./patterns-and-mirror.md) | Rectangular, mirror, and circular component patterns |
| [Bill of Materials](./bill-of-materials.md) | Generating and renumbering the assembly's BOM |
| [Interference Check](./interference-check.md) | Detecting clashes between components, from the Inspect tab |

<!-- SCREENSHOT: the Assembly ribbon tab with all 4 groups visible — TODO follow-up -->
