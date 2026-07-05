---
title: Constraints
---
# Constraints
> Pins down geometric relationships between sketch entities — horizontal, parallel, tangent, and more — so the sketch holds its shape when edited.

**Where:** Sketch tab ▸ Constrain panel · **Shortcut:** see table below · **Applies to:** part
(sketch mode only)

## What it does

Constraints tell the sketch solver how entities relate to each other — that two lines must
stay parallel, that a point must sit on top of another, that two circles must stay the same
size. Zilventor's sketch geometry is solved by **planegcs**, a constraint solver running in a
worker thread, which re-solves the whole sketch every time a constraint is added, removed, or
edited. Every constraint button in the Constrain panel is disabled unless a sketch is
currently active.

## Constraint status

While a sketch is open, the status bar shows the sketch's current constraint state live,
updated after every solve:

| State | Display |
|---|---|
| Fully constrained | Green text: **"Fully constrained"** |
| Over-constrained | Red text: **"Over constrained: {n}"** |
| Under-constrained | Amber text: **"{n} DOF"** |

Because planegcs re-runs after every single constraint change, this indicator is always
current — there's no separate "recalculate" step.

## Before you start

- Have a sketch active (**2D Sketch**) with at least the geometry you want to constrain
  already drawn.

## Steps

Every constraint follows the same pattern: select the applicable geometry, then click (or
press the shortcut for) the constraint.

1. **Coincident (N)** — select two points, then apply. Snaps them to the same location.
2. **Horizontal (H)** — select a line (or two points), then apply. Forces it horizontal.
3. **Vertical (V)** — select a line (or two points), then apply. Forces it vertical.
4. **Parallel (P)** — select two lines, then apply. Forces them parallel to each other.
5. **Perpendicular (E)** — select two lines, then apply. Forces a 90° relationship between them.
6. **Tangent (T)** — select a line/arc/circle pair, then apply. Forces them to touch tangentially.
7. **Equal (Q)** — select two entities of the same type (e.g. two lines, or two circles), then
   apply. Forces them to the same length or radius.
8. **Symmetric (Y)** — select two entities and a symmetry line/point, then apply. Mirrors one
   entity's position relative to the other about that reference.

*Result: the solver re-runs immediately and the status-bar DOF indicator updates to reflect
the new constraint.*

## Tips & gotchas

- Watch the status-bar indicator as you constrain — an over-constrained sketch is a sign you
  added a redundant or conflicting constraint; remove the most recent one first.
- Constraints and [dimensions](./dimensions.md) both consume degrees of freedom — a sketch
  can reach "Fully constrained" through either, and most real sketches use a mix of both.
- Because planegcs re-solves on every single change, adding several constraints in quick
  succession is a series of individual solves, not a single batch — a constraint that leaves
  the sketch briefly over-constrained mid-sequence will show that state immediately.

<!-- SCREENSHOT: Sketch tab Constrain panel with all 8 constraint buttons, and the status bar showing "Fully constrained" vs "3 DOF" vs "Over constrained: 1" — TODO follow-up -->

## See also

- [Sketching](./sketching.md)
- [Dimensions](./dimensions.md)
