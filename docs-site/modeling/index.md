---
title: Modeling
---
# Modeling
> The part-modeling toolset: sketch 2D profiles, constrain and dimension them, then turn them into 3D features.

**Applies to:** part

## How modeling works

Every tool under the **Sketch** and **Model** ribbon tabs operates on the active **part**
document — not an assembly. The typical flow is: draw a 2D profile in a sketch, fully define
it with constraints and dimensions, then feed it into a 3D feature (extrude, revolve, sweep)
to turn it into solid geometry. Later features (fillets, chamfers, patterns, work planes) build
on top of that solid, and every step is a regenerable feature on the part's feature tree —
nothing here is a one-off mesh edit.

If the active part was imported from Inventor or STEP (`isImportedPart(activePart)` is true),
every Create, Modify, Pattern, and Work Feature button is disabled. The tooltip explains why:
*"This part was imported from Inventor and is read-only. Re-author parametrically by creating
a new part."* Imported geometry has no feature history to build on, so none of these tools can
attach to it.

## Sketch phase

Start here: draw and fully define the 2D profile that later features will consume.

- [Sketching](./sketching.md) — enter/exit sketch mode and draw lines, rectangles, circles,
  arcs, and splines.
- [Constraints](./constraints.md) — pin down geometric relationships (horizontal, parallel,
  tangent, etc.) so the sketch behaves predictably when edited.
- [Dimensions](./dimensions.md) — add parametric, named-parameter-driven measurements to the
  sketch.

## Feature phase

Once a sketch is ready, turn it into 3D geometry and refine the result.

- [Extrude, Revolve & Sweep](./extrude-revolve-sweep.md) — the core 3D feature tools that
  consume a sketch profile.
- [Modify Features](./modify-features.md) — fillet, chamfer, shell, and other tools that
  refine existing solid geometry.
- [Work Features](./work-features.md) — construction planes, axes, and points used as
  references for later features.
- [Patterns and Mirror](./patterns-and-mirror.md) — repeat or mirror existing features across
  the part.
