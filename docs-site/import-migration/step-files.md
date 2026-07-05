---
title: STEP Files
---
# STEP Files
> Bring in a `.step`/`.stp` model as a read-only part, insert it straight into an assembly, or
> split a multi-body import into separate components.

**Where:** File tab ▸ **Open…** (new part) or Assembly tab ▸ Component ▸ **Insert From STEP…**
(as a component) · Model tab ▸ Create ▸ **Explode into Assembly** (split bodies) · **Shortcut:** —
· **Applies to:** part, assembly

## What it does

STEP (AP2xx) is zilventor's universal "geometry came from somewhere else" format. Opening one
always produces a **read-only imported part**: every solid in the file is loaded as a single
`kind: 'imported'` feature — a compound if the file has more than one body — and none of the
Model tab's Add* tools (Sketch, Extrusion, Revolve, Fillet, Hole, Shell, Sweep, patterns, work
features) will work on it. You can still place the part in assemblies, add mate/flush/angle
constraints against its faces, override its color, and — if it's a single solid — [convert it to
a parametric panel](./convert-to-panel.md) later.

## Before you start

- Have a `.step`/`.stp` file (or a `.zip` containing one) ready. Files over roughly 50 MB are
  rejected up front with a size warning — very large STEP files can freeze the browser tab, so
  simplify the geometry on the CAD side first if you hit the cap.
- To insert as an assembly **component** instead of a standalone part, open or create the target
  assembly first.

## Steps

### Open as a new part

1. **File** tab ▸ **Open…**.
2. Pick a `.step`, `.stp`, or `.zip` file. A `.zip` is scanned for the first STEP entry inside it
   and that entry is imported — everything else in the archive is ignored.
3. Wait for the import ticker in the status bar (large assemblies can take several minutes).
4. *Result: a new part opens with a single `Imported (<filename>.step)` feature in the browser
   tree; the viewport auto-fits to the model.*

### Insert into an active assembly

1. Open or create the assembly you want the geometry in.
2. **Assembly** tab ▸ Component ▸ **Insert From STEP…**.
3. Pick a `.step`/`.stp` file, or a `.zip` containing one.
4. *Result: a new component appears in the assembly, backed by a fresh read-only imported part.*

### Split a multi-body import into an assembly

1. Open a STEP file as a new part (above) whose compound contains more than one solid.
2. **Model** tab ▸ Create ▸ **Explode into Assembly**. Only enabled when the active part has an
   imported feature.
3. *Result: the active document becomes a new assembly with one read-only imported part per
   solid, each keeping its original per-body color; components sit at the STEP file's native
   coordinates (identity pose), not re-centered.*

## Options

| Field | Meaning |
|---|---|
| File picker filter | Accepts `.step`, `.stp`, and `.zip` (searched for a STEP entry) |
| Size cap | ~50 MB, enforced on **File ▸ Open** and its `.zip` extraction path before parsing |

## Tips & gotchas

- The read-only Model-tab tooltip reads *"This part was imported from Inventor and is
  read-only. Re-author parametrically by creating a new part."* — the wording is generic and
  applies to any imported geometry, not just Inventor-sourced files.
- **Insert From STEP…** (Assembly tab) currently has no enforced size cap in the codebase, unlike
  **File ▸ Open** and DXF import — very large files inserted this way won't get the same
  up-front warning.
- Explode only appears when the active document is a part with an imported feature; it's not
  available on assemblies or on parts you built natively.
- Exploding doesn't make the geometry parametric — each resulting body is still a read-only
  imported part. Use [Convert to Panel](./convert-to-panel.md) afterward on any single-solid
  body you want to edit.
- A STEP file that fails to parse (corrupted geometry, unsupported entities) surfaces as an
  "Open failed" error dialog with the underlying kernel message.

<!-- SCREENSHOT: File tab Open dialog with a .step file selected, then the resulting imported part in the browser tree — TODO follow-up -->

## See also

- [Import & Migration overview](./index.md)
- [Convert to Panel](./convert-to-panel.md)
- [SolidWorks Files](./solidworks-files.md)
- [Inventor Migration](./inventor-migration.md)
- [Documents and Kinds](../concepts/documents-and-kinds.md)
- [File Formats](../reference/file-formats.md)
