---
title: Extrude, Revolve & Sweep
---
# Extrude, Revolve & Sweep
> Turns a closed 2D sketch profile into a 3D solid by pushing it straight (Extrude), spinning it around an axis (Revolve), or dragging it along a path (Sweep).

**Where:** Model ▸ Create · **Shortcut:** Extrude — · Revolve **R** · Sweep **W** · **Applies to:** part

## What it does

Extrude, Revolve, and Sweep are the three profile-based solid-creation tools. Each takes a
closed sketch profile and turns it into a solid: Extrude pushes it a fixed distance in a
single direction, Revolve spins it around a work axis or sketch line by an angle, and Sweep
drags it along a separate path curve. All three can create a brand-new body or combine with
an existing one (Join/Cut).

Each tool opens a dialog. Extrude opens as a centered modal overlay; Revolve and Sweep dock
at the top-right of the screen with the 3D viewport still interactive underneath. Where a
dialog has a **Pick** button, click it first to arm a viewport pick-mode, then click the
edge, face, or reference in the 3D view — the dialog's field updates live.

## Before you start

- The part needs at least one sketch with a single closed profile loop.
- The tool is disabled if the part has no sketch, or if the part was imported (e.g. from
  STEP) and is read-only — the tooltip reads *"This part was imported from Inventor and is
  read-only. Re-author parametrically by creating a new part."*

## Steps

### Extrude

1. Draw and close a sketch profile.
2. Click **Extrude** in the Model ▸ Create panel.
3. Set **Distance** and choose **Operation**.
4. Click **OK**.

*Result: a new solid (or a body merged/cut into the existing one) appears, and an Extrude
feature is added to the part's feature tree.*

### Revolve

1. Click **Revolve (R)** or press **R**.
2. Click **Pick** next to **Profile**, then click the closed sketch profile in the viewport.
3. Click **Pick** next to **Axis**, then click a work axis or sketch line to revolve around.
4. Set **Angle** and **Direction**, and choose **Operation**.
5. Optionally click **Apply** to see the result without closing the dialog.
6. Click **OK**.

*Result: a revolved solid is added to the part, and a Revolve feature appears in the feature
tree.*

### Sweep

1. Click **Sweep** or press **W**.
2. Click **Pick profile**, then click the closed sketch profile to sweep.
3. Click **Pick path**, then click the path curve to sweep along.
4. Choose **Orientation**; if **Guide Rail**, click **Pick guide rail** and select the rail
   curve.
5. Choose **Operation**.
6. Click **OK**.

*Result: a swept solid is added to the part, and a Sweep feature appears in the feature
tree.*

## Options

### Extrude

| Field | Meaning | Default |
|---|---|---|
| Distance | Extrusion distance; must be a positive number | `18` |
| Operation | **New / Join / Cut** toggle (Join/Cut disabled unless the part already has a body) | Join if a body exists, else New |

### Revolve

| Field | Meaning | Default |
|---|---|---|
| Profile | Pick/Change button; shows sketch id + closed-loop count once picked | none |
| Axis | Pick/Change button | none |
| Name | Parameter name generated for the angle | `angle0` |
| Angle | Expression field (degrees); validated live, invalid expressions block Apply/OK | `360` |
| Direction | **Flipped / Symmetric / Normal** toggle | Normal |
| Operation | **New / Join / Cut** toggle (Join/Cut gated on an existing body) | Join/New per body presence |

### Sweep

| Field | Meaning | Default |
|---|---|---|
| Profile | "Pick profile" button | none |
| Path | "Pick path" button | none |
| Orientation | **Path / Parallel / Guide Rail** radio | Path |
| Guide Rail | "Pick guide rail" button, shown only when Orientation = Guide Rail | none |
| Operation | **New / Join / Cut** radio (Join/Cut gated on existing body) | New |

## Tips & gotchas

- **Extrude has no profile picker.** It always targets the most recently added sketch feature
  in the part's feature tree — not whichever sketch you last clicked. If a part has multiple
  sketches, double-check which one is newest before extruding, or you'll extrude the wrong
  profile.
- Extrude has no **Direction** option — it always extrudes in a single fixed forward
  direction. If you need the other direction, sketch on the opposite face or flip the sketch
  plane.
- Extrude's **Operation** choices are New / Join / Cut only — there is no Intersect option.
- Revolve is the only one of the three with a live **Apply** button, so you can preview a
  revolve without closing the dialog; Extrude and Sweep only offer Cancel/OK.
- The kernel validates the sketch before any of these tools will run, and reports specific
  errors: an empty sketch says *"Sketch is empty — cannot extrude. Draw a closed profile
  first."*; an open profile says *"Sketch is not closed — cannot extrude. Check that all
  endpoints connect."*; a sketch with more than one closed loop says *"Sketch has multiple
  closed loops — cannot extrude. Merge or delete loops so exactly one remains."* Revolve adds
  its own axis-aware message: *"No closed profile found in sketch (excluding axis)."*

<!-- SCREENSHOT: Extrude modal dialog with Distance/Operation fields, and the resulting extruded solid — TODO follow-up -->
<!-- SCREENSHOT: Revolve docked dialog with Profile/Axis picked and Angle set, and the resulting revolved solid — TODO follow-up -->
<!-- SCREENSHOT: Sweep docked dialog with Profile/Path picked, and the resulting swept solid — TODO follow-up -->

## See also

- [Sketching](./sketching.md)
- [Modify Features](./modify-features.md)
- [Work Features](./work-features.md)
