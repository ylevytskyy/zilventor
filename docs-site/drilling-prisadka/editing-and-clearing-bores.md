---
title: Editing and Clearing Bores
---
# Editing and Clearing Bores
> Show or hide bore markers, inspect and tweak a single bore, flip it to the opposite face, or wipe every bore in the assembly.

**Where:** Furniture ▸ Присадка ▸ **Show Bores** / **Hide Bores** / **Clear Присадку**, plus the bore properties panel on selection · **Shortcut:** — · **Applies to:** part / assembly

## What it does

Once bores exist (from [Generate Carcass Boring](./generate-carcass-boring.md),
[Handles and Pulls](./handles-and-pulls.md), [Leg Levelers](./leg-levelers.md), the
System-32 tools, or manual placement), this page covers everything you do with them
afterwards: toggling their visibility, selecting one to edit its numbers, flipping
which face it's drilled from, and clearing all of them out of an assembly at once.

## Before you start

- An assembly with at least one bore already placed.

## Steps

### Toggle bore visibility

1. In the Furniture tab, Присадка panel, click **Show Bores** / **Hide Bores** — the
   label reflects the current state and just toggles bore-marker rendering in the 3D
   viewport. It doesn't add or remove anything.

### Inspect and edit a single bore

1. Click a bore marker in the 3D viewport to select it.
2. The **Bore properties** panel opens, showing that bore's **U (mm)**, **V (mm)**,
   **Ø (mm)**, and **Depth** fields, plus any role-specific fields (see Options).
3. Edit a field directly to move, resize, or re-depth that one bore.
4. Click **Delete** in the panel to remove just that bore/connector.

### Flip a bore to the opposite face

1. Select a bore that sits on a broad face — `Top` or `Bottom`, the two large
   thickness-normal faces of the panel (as opposed to the narrow `Front`/`Back`/
   `Left`/`Right` edge faces) — its properties panel shows a **Flip face** button.
2. Click **Flip face**. The bore is re-targeted to the opposite broad face with its
   U/V recomputed to the mirrored position, and marked as edited.

*Result: the bore moves to the other side of the panel without you re-entering
coordinates by hand.*

### Clear all bores in the assembly

1. In the Furniture tab, Присадка panel, click **Clear Присадку** (enabled when an
   assembly is active).

*Result: every `BoreOp` on every panel in the active assembly is removed, including
panels nested inside sub-assemblies — each panel's bores are cleared by its own
command, so you can undo any one panel's clear independently and leave the rest
cleared.*

## Options

| Field | Meaning |
|---|---|
| U (mm) / V (mm) | The bore's position within the panel's local 2D face frame. |
| Ø (mm) | Bore diameter. |
| Depth | Cut depth in mm, or `throughAll` for a bore that goes all the way through the panel. |
| Along joint | Only shown for joint bores after Regenerate Bores has enabled movement; nudges the bore along the joint direction. |
| Height | Only shown for hinge bores; adjusts vertical placement. |
| Column start offset (mm) | Only shown for System-32 shelf-pin bores; shifts where the pin column starts. |
| Machining preset | Only shown when a saved [machining preset](./machining-presets.md)'s operation type matches this bore's role — pick one and click **Apply** to snapshot its diameter/depth/layer/tool/speed onto this bore. |
| Flip face | Only shown for `Top`/`Bottom` (broad-face) bores — re-targets to the opposite broad face. |

## Tips & gotchas

- **Flip face only works on broad faces.** A bore on a `Front`/`Back`/`Left`/`Right`
  narrow edge face has no opposite-face concept, so it has no Flip button.
- **Clear Присадку only removes bores** (`BoreOp` entries) — it does not touch
  grooves, keyhole slots, or mortise/tenon features. Those are edited in place on
  their own panels: see [Grooves and Dados](./grooves-and-dados.md),
  [Keyhole Slots](./keyhole-slots.md), and
  [Mortise and Tenon](./mortise-and-tenon.md).
- Because Clear Присадку dispatches one command per affected panel, undoing
  immediately after only reverses the last panel's clear — keep undoing to restore
  more panels, or don't run it until you're sure.

## See also

- [Generate Carcass Boring](./generate-carcass-boring.md)
- [Machining Presets](./machining-presets.md)
- [Exporting Boring Data](./exporting-boring-data.md)
- [Grooves and Dados](./grooves-and-dados.md)
- [Keyhole Slots](./keyhole-slots.md)
- [Mortise and Tenon](./mortise-and-tenon.md)

<!-- SCREENSHOT: Bore properties panel showing U/V/Ø/Depth fields + Flip face button — TODO follow-up -->
<!-- SCREENSHOT: Furniture ribbon Присадка panel with Show/Hide Bores and Clear Присадку buttons — TODO follow-up -->
