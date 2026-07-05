---
title: Grooves and Dados
---
# Grooves and Dados
> Cuts a straight groove (rabbet or dado) into one face of a panel — the standard way to seat
> a back panel or a drawer bottom.

**Where:** Furniture ▸ Присадка ▸ **Groove** · **Shortcut:** — · **Applies to:** assembly
(one panel)

## What it does

Groove cuts a single, straight channel into a panel: pick the face, the axis it runs along,
its position, width, and depth, and the tool cuts it as a regenerable `GrooveFeature` on that
panel's feature tree. This is the tool you reach for to cut a back-panel rabbet/dado into a
cabinet side, or a drawer-bottom groove into a drawer box's sides and front.

## Before you start

- Have an assembly open with the panel you want to groove already in place.
- Know which face the groove needs to sit on (see the face vocabulary in the
  [section overview](./index.md) — grooves usually go on a broad **Top**/**Bottom** face, not
  a narrow edge face).

## Steps

1. Click **Groove** in the Furniture ▸ Присадка ribbon panel — this arms a one-panel pick
   cursor.
2. Click the panel you want to groove in the 3D viewport.
3. The **Groove** dialog opens with the face pre-filled from the panel's role (right-side
   panels default to the right-side inner face, everything else defaults to the left-side
   inner face). Adjust face, axis, position, width, and depth as needed.
4. Click **OK**.

*Result: the groove is cut into the panel and appears in its feature tree as a `GrooveFeature`.*

## Options

| Field | Meaning |
|---|---|
| Face | Which of the panel's six faces the groove is cut into (Top, Bottom, Front, Back, Left, Right). Defaults from the panel's role. |
| Axis | `u` or `v` — which of the face's two local directions the groove runs along. |
| Position (mm) | Distance of the groove's centerline from the face's origin, along the axis perpendicular to the groove's run. Default 50 mm. |
| Width (mm) | Groove width. Default 6 mm. |
| Depth (mm) | Groove depth. Default 9 mm. |

## Tips & gotchas

- **The groove is editable in place after creation** — it does not need to be deleted and
  recreated. Select it to open the **Groove properties** panel and change face, axis,
  position, width, or depth; each change is a separate undoable edit and the kernel re-cuts
  the panel live. See [Editing and Clearing Bores](./editing-and-clearing-bores.md) for the
  general edit/undo workflow.
- The dialog does **not** validate your inputs — an out-of-range position, width, or depth
  will cut a degenerate (or through-cutting) groove without warning. Check the result in the
  viewport before moving on.
- Groove cuts the **full extent** of the panel along the groove's run — it's a channel, not a
  localized pocket. If you need a short, localized routed cutout instead, see
  [Keyhole Slots](./keyhole-slots.md).

<!-- SCREENSHOT: GrooveDialog with default values, and the resulting groove cut into a cabinet side panel's inner face — TODO follow-up -->

## See also

- [Keyhole Slots](./keyhole-slots.md)
- [Mortise and Tenon](./mortise-and-tenon.md)
- [Editing and Clearing Bores](./editing-and-clearing-bores.md)
- [Machining Presets](./machining-presets.md)
