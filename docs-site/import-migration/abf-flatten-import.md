---
title: ABF Flatten Import
---
# ABF Flatten Import
> Turn a "flattened" DXF export from ABF nesting/labeling software into a real zilventor
> assembly of parametric panels — with bores recovered as editable features, not flat lines.

**Where:** File tab ▸ **Import ABF flatten DXF…** · **Shortcut:** — · **Applies to:** assembly
(creates a new one)

## What it does

ABF-style flatten DXF exports pack every panel of a cabinet run onto one drawing, one outline
per panel, with drilling/routing marked as circles on specific layers and panel identity
encoded in block attributes. This importer reverse-engineers that convention: it groups the
DXF's records by material and thickness, lets you confirm the material/thickness mapping, and
then builds one real zilventor **assembly** containing one **`PanelFeature`** part per detected
panel — each a first-class, editable, origin-posed part, not a dumb outline.

Circles it can confidently place on a broad panel face become real `BoreOp` records (using
corner-based UV placement, with a best-effort match to a known hardware kind — shelf pin,
hinge cup, confirmat, dowel, minifix, leg leveler — based on diameter). Circles it can't
confidently resolve — edge-side (`DSIDE`) or face-with-unknown-depth (`DEPTHF`) records, or
diameters that don't match any known hardware — fall back to plain reference-geometry circles
on the panel, so nothing from the source file is silently dropped.

## Before you start

- Have the ABF flatten `.dxf` export ready (size cap ~50 MB, same as other DXF imports).
- Know roughly which material each detected group should map to — the confirmation dialog
  pre-fills thickness from the file but you choose the material.

## Steps

1. **File** tab ▸ **Import ABF flatten DXF…**.
2. Pick the `.dxf` file. Cyrillic panel names embedded in the file's block attributes are
   preserved as-is.
3. The **Import ABF flatten DXF** dialog opens with one row per detected material group (token
   format `<MATERIAL>_THICKNESS_<mm>`):
   - Pick a **Material** from the active material registry for each group.
   - Confirm or adjust the pre-filled **Thickness (mm)**.
4. Click **Import** (or **Cancel** to abort — nothing is created).
5. *Result: a new assembly becomes the active document, containing one `PanelFeature` part per
   detected panel, all placed at the assembly origin. The status bar reports panels imported,
   bores recovered as real `BoreOp`s, and how many circles landed as reference-only geometry;
   any non-rectangular outlines are called out in the same message.*

## Options

| Field | Meaning |
|---|---|
| Material group (row label) | Auto-detected `<MATERIAL>_THICKNESS_<mm>` token from the DXF — read-only |
| Material | Which zilventor material this group's panels are assigned |
| Thickness (mm) | Panel thickness for this group; pre-filled from the DXF token, editable |

## Tips & gotchas

- This is a **new assembly**, not an import into the currently active document — if you had a
  different assembly open, it's replaced as the active document (still reachable via undo).
- The whole operation is one undoable step: Ctrl+Z removes the assembly and deletes every part
  file it wrote.
- Panels land at the assembly origin, not at any layout position implied by the source DXF —
  reposition them afterward if you need a specific arrangement.
- Bore placement is best-effort for anything other than the Ø35 hinge cup (the only diameter
  that's unambiguous across zilventor's hardware kinds). Double-check imported bores against
  the source drawing before relying on them for production.
- See [ABF Layer Scheme](../manufacturing/abf-layer-scheme.md) for the underlying layer/naming
  convention this importer parses.

<!-- SCREENSHOT: the Import ABF flatten DXF dialog with several material-group rows filled in — TODO follow-up -->

## See also

- [Import & Migration overview](./index.md)
- [DXF Files](./dxf-files.md)
- [ABF Layer Scheme](../manufacturing/abf-layer-scheme.md)
- [Panels](../furniture/panels.md)
