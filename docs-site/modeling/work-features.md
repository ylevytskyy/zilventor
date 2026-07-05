---
title: Work Features
---
# Work Features
> Creates reference planes, axes, and points that aren't part of the solid itself but give later sketches and features something precise to attach to.

**Where:** Model ▸ Work Features · **Shortcut:** Plane **Ctrl+Shift+P** · Axis **Ctrl+Shift+A** · Point **Ctrl+Shift+W** · **Applies to:** part

## What it does

Work Plane, Work Axis, and Work Point create non-solid reference geometry — planes, axes, and
points that don't add material but give you a precise place to sketch, revolve around, or
locate a hole. Each one supports several construction **modes** (origin-based, offset,
through-points, intersections, and so on); pick the mode that matches what you're trying to
locate, then supply the references it asks for.

Each tool opens a dialog docked at the top-right of the screen with the 3D viewport still
interactive underneath. For modes that need a reference, click the small **Pick…** button
next to a field, then click the corresponding element in the 3D viewport — an origin
plane/axis/point, an existing work feature, or a geometry face/edge/vertex, depending on the
mode. The reference then populates the field, which can also be hand-edited as plain text.

## Before you start

- The part needs the mode-appropriate reference geometry to exist already (e.g. two points
  for a Two Points axis, a face for a Cylindrical Face axis).
- Every button here is disabled with tooltip *"This part was imported from Inventor and is
  read-only. Re-author parametrically by creating a new part."* when the active part was
  imported (e.g. from STEP).

## Steps

### Work Plane

1. Click **Plane** (Work Plane, **Ctrl+Shift+P**).
2. Choose a **Mode** from the dropdown.
3. Click each **Pick…** button the mode requires and select the corresponding reference in
   the viewport, or type it in directly.
4. Fill in any numeric fields (Offset or Angle) the mode shows.
5. Click **OK**.

*Result: a new work plane appears in the 3D view and in the part's feature tree.*

### Work Axis

1. Click **Axis** (Work Axis, **Ctrl+Shift+A**).
2. Choose a **Mode** from the dropdown.
3. Click each **Pick…** button the mode requires and select the corresponding reference in
   the viewport, or type it in directly.
4. Click **OK**.

*Result: a new work axis appears in the 3D view and in the part's feature tree.*

### Work Point

1. Click **Point** (Work Point, **Ctrl+Shift+W**).
2. Choose a **Mode** from the dropdown.
3. Click each **Pick…** button the mode requires and select the corresponding reference in
   the viewport, or type it in directly.
4. Click **OK**.

*Result: a new work point appears in the 3D view and in the part's feature tree.*

## Options

### Work Plane modes

| Mode | Meaning | Default |
|---|---|---|
| Origin Plane | One of the three principal planes (dropdown **XY/YZ/XZ**) | XY |
| Offset from Plane | A plane reference plus an **Offset** distance | `10` mm |
| Three Points | Three point references define the plane | — |
| Midplane between Two | Two plane references; the result sits midway between them | — |
| Axis Perpendicular to Plane | An axis reference and a plane reference | — |
| Axis at Angle to Plane | An axis reference, a plane reference, and an **Angle** | `45` degrees |
| Tangent to Surface Parallel to Plane | A face reference and a plane reference | — |

### Work Axis modes

| Mode | Meaning | Default |
|---|---|---|
| Origin Axis | One of the three principal axes (dropdown **X/Y/Z**) | X |
| Two Points | Axis through two point references | — |
| Two Planes | Axis at the intersection of two plane references | — |
| Normal to Plane Through Point | Axis normal to a plane, passing through a point reference | — |
| Cylindrical Face | Axis along a picked cylindrical face's centerline | — |
| Edge | Axis along a picked edge (stub — see Tips & gotchas) | — |

### Work Point modes

| Mode | Meaning | Default |
|---|---|---|
| Origin | Fixed at (0, 0, 0) | — |
| Vertex | An edge reference plus a **Start/End** selector | — |
| Midpoint of Edge | An edge reference | — |
| Center of Arc | A face reference | — |
| Axis ∩ Plane | An axis reference and a plane reference | — |
| Three Planes (intersection) | Three plane references | — |

## Tips & gotchas

- **Work Point's shortcut is Ctrl+Shift+W, not a plainer binding**, because plain **W** is
  already taken by Sweep — this is a deliberate divergence from more Inventor-typical
  bindings, noted directly in the app's source comments.
- **Work Axis's Edge mode is a stub** pending an interactive edge picker — don't expect it to
  behave like the other modes yet.
- All three dialogs offer Cancel/OK only — there's no Apply/preview step, so double-check the
  picked references before confirming.
- Work planes are a common jumping-off point for a new sketch — see [Sketching](./sketching.md)
  for starting a sketch on a work plane instead of a body face.

<!-- SCREENSHOT: Work Plane dialog set to Offset from Plane with a plane picked and Offset set, and the resulting plane in the viewport — TODO follow-up -->
<!-- SCREENSHOT: Work Axis dialog set to Two Points, and the resulting axis in the viewport — TODO follow-up -->
<!-- SCREENSHOT: Work Point dialog set to Midpoint of Edge, and the resulting point in the viewport — TODO follow-up -->

## See also

- [Sketching](./sketching.md)
- [Extrude, Revolve & Sweep](./extrude-revolve-sweep.md)
- [Modify Features](./modify-features.md)
