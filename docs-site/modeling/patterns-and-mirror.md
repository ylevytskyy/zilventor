---
title: Patterns and Mirror
---
# Patterns and Mirror
> Repeats a feature along a line (Linear Pattern) or reflects it across a plane (Mirror) within a single part.

**Where:** Model ▸ Pattern · **Shortcut:** Linear Pattern **L** · Mirror **M** · **Applies to:** part

## What it does

Linear Pattern and Mirror repeat an existing feature on the current part — Linear Pattern
copies it a set number of times at a fixed spacing along an X/Y/Z axis, and Mirror reflects it
across one of the three principal planes. Both work at the **part-feature level**, repeating a
feature within a single part's own feature tree.

This is distinct from the assembly-level equivalents, which pattern or mirror whole
**component instances** inside an assembly rather than features inside one part — see
[Assembly Patterns and Mirror](../assemblies/patterns-and-mirror.md) if you're trying to
repeat a component, not a feature.

Mirror opens as a centered modal overlay; Linear Pattern docks at the top-right of the screen
with the 3D viewport still interactive underneath.

## Before you start

- The part needs an existing solid body with at least one patternable feature.
- Every button here is disabled with tooltip *"This part was imported from Inventor and is
  read-only. Re-author parametrically by creating a new part."* when the active part was
  imported (e.g. from STEP).

## Steps

### Linear Pattern

1. Click **Linear Pattern (L)** or press **L**.
2. Choose **Source** from the dropdown of patternable features.
3. Choose **Axis** (**X / Y / Z**).
4. Set **Spacing** and **Count**.
5. Click **OK**.

*Result: the source feature is repeated along the chosen axis, and a Linear Pattern feature
is added to the part's feature tree.*

### Mirror

1. Click **Mirror (M)** or press **M**.
2. Choose **Source** from the dropdown of patternable features.
3. Choose **Plane** (**YZ / XZ / XY**).
4. Click **OK**.

*Result: a mirrored copy of the source feature is added across the chosen plane, and a Mirror
feature is added to the part's feature tree.*

## Options

### Linear Pattern

| Field | Meaning | Default |
|---|---|---|
| Source | Dropdown of patternable features on the part | first patternable feature |
| Axis | **X / Y / Z** toggle | X |
| Spacing | Distance between instances; accepts expressions | `20` |
| Count | Integer, must be 2–200 | `3` |

### Mirror

| Field | Meaning | Default |
|---|---|---|
| Source | Dropdown of patternable features on the part | first feature |
| Plane | **YZ / XZ / XY** toggle | YZ |

## Tips & gotchas

- Mirror's dialog spells out the plane math directly: "YZ mirrors across x=0; XZ across y=0;
  XY across z=0" — use that as the quick reference instead of guessing which plane number
  matches which axis.
- **Count** is clamped to 2–200 — you can't create a single-instance pattern (that would just
  be the source feature) or an unbounded one.
- Neither dialog has an Apply/preview button — Cancel/OK only — so check Source and
  Axis/Plane carefully before confirming.
- Don't confuse this page's tools with the assembly-level Pattern/Mirror, which repeats whole
  components across an assembly rather than a feature within one part — see
  [Assembly Patterns and Mirror](../assemblies/patterns-and-mirror.md).

<!-- SCREENSHOT: Linear Pattern dialog with Source/Axis/Spacing/Count set, and the resulting repeated feature — TODO follow-up -->
<!-- SCREENSHOT: Mirror modal dialog with Source/Plane set, and the resulting mirrored feature — TODO follow-up -->

## See also

- [Modify Features](./modify-features.md)
- [Work Features](./work-features.md)
- [Assembly Patterns and Mirror](../assemblies/patterns-and-mirror.md)
