---
title: Drilling / Присадка
---
# Drilling / Присадка

> The hole-drilling and panel-machining toolset that turns a modeled cabinet into a set of
> ready-to-bore panels: carcass joints, shelf pins, grooves, keyholes, and joinery.

**Присадка** is the Ukrainian cabinetmaking term for the hardware-boring / drilling map a
panel needs to assemble and mount: connector holes (confirmat, minifix, dowel), System-32
shelf-pin lines, hinge cups, and any other machined openings. Zilventor's Присадка tools live
together in one place — the **Furniture ▸ Присадка** ribbon panel — and every one of them
writes ordinary, regenerable features onto the panel(s) you pick. Nothing here is a one-off
edit to a mesh; every bore, groove, slot, or joint is data that survives undo/redo, re-export,
and (for grooves, keyholes, and joinery) in-place editing after the fact.

## The general pattern

Almost every tool in this section follows the same shape:

1. **Open an assembly that contains a cabinet.** Most tools are disabled (grayed out, with a
   tooltip) until `activeAssembly` exists — the ribbon shows *"Open or create an assembly
   first"* if you try before that. Carcass-joint boring specifically needs panels that were
   created by a **cabinet template** (Base Cabinet, corner cabinets, etc.) — those carry a
   `role` (leftSide, rightSide, bottom, top, shelf…) that the auto-detection reads. Hand-built
   custom panels with no role are silently skipped by the auto path.
2. **Click a panel (or a cabinet, or two panels) in the 3D viewport.** Tools that operate on a
   single panel (System-32 manual, Groove, Keyhole Slot) ask you to click one panel first —
   the ribbon button arms a pick cursor, and clicking a real part in the viewport resolves it.
   Mortise/Tenon asks for two panels, one after another.
3. **A dialog opens** with the operation's parameters, often pre-filled with sensible
   furniture defaults (System-32 pitch 32 mm, confirmat/minifix/dowel setbacks, etc.).
4. **Bores/features are generated** onto the panel's document as a regenerable feature (or, for
   carcass/System-32 connector bores, a lightweight `BoreOp` record) — not as a one-off mesh
   edit. Everything here is undoable through the normal undo/redo stack.

## Face vocabulary

This is the single most important convention to know before touching any tool in this
section, because every dialog's **Face** field uses it:

- **Top** and **Bottom** are the two LARGE faces of a panel — the broad faces whose normal
  points along the panel's thickness. For a cabinet side panel, one of these two is the
  face that points into the cabinet interior; that's where shelf-pin lines, hinge plates,
  and most grooves/dados live.
- **Front**, **Back**, **Left**, and **Right** are the narrow *edge* faces — thin strips no
  wider than the panel's board thickness. They have **no flat drawing representation** in
  2D output, which is why tools that need a broad face to route or drill into (Keyhole Slot,
  System-32) default to Top or Bottom, never to an edge face.

Mixing these up is the classic mistake: picking "Right" expecting a cabinet's visible inner
face will instead target a thin ~16–18 mm edge strip.

## Visibility and undo

- The ribbon carries a **Show Bores / Hide Bores** toggle that shows or hides the 3D markers
  for every bore on the active assembly — it's a display toggle only, it doesn't affect the
  underlying data.
- Every operation in this section — generate, add, edit, clear — goes through the app's
  command bus, so it's fully undoable/redoable like any other model edit.

## Pages in this section

| Page | What it covers |
|---|---|
| [Generate Carcass Boring](./generate-carcass-boring.md) | Auto-generate confirmat/minifix/dowel joint bores across a cabinet |
| [System-32 Shelf Pins](./system-32-shelf-pins.md) | Ø5 mm shelf-pin grid on side-panel inner faces, auto or manual |
| [Grooves and Dados](./grooves-and-dados.md) | Back-panel rabbets, drawer-bottom grooves, editable in place |
| [Keyhole Slots](./keyhole-slots.md) | Routed wall-hanger keyhole cutouts |
| [Mortise and Tenon](./mortise-and-tenon.md) | Paired tenon/mortise joinery between two panels |
| [Handles and Pulls](./handles-and-pulls.md) | Hardware handle placement |
| [Leg Levelers](./leg-levelers.md) | Toekick leg-leveler hardware |
| [Machining Presets](./machining-presets.md) | Reusable tool/speed/layer presets for machining operations |
| [Editing and Clearing Bores](./editing-and-clearing-bores.md) | Selecting, editing, and clearing existing bores/features |
| [Exporting Boring Data](./exporting-boring-data.md) | CSV and DXF boring-map export |

<!-- SCREENSHOT: the Furniture ▸ Присадка ribbon panel with all buttons visible, on an assembly containing a base cabinet — TODO follow-up -->
