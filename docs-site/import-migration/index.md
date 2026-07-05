---
title: Import & Migration
---
# Import & Migration
> How external CAD data — STEP, DXF, ABF flatten DXF, and a whole Inventor 2012 library —
> gets into zilventor, and what's editable once it's there.

Zilventor never edits foreign file formats in place. Every import path either builds a
**read-only shell** around geometry it can't fully understand, or **translates** the data into
one of zilventor's own parametric feature types. Knowing which one you're getting is the single
most important thing on this page.

## The two outcomes

| Outcome | What it means | Import paths that produce it |
|---|---|---|
| **Read-only imported part** | The solid(s) arrive as an opaque `kind: 'imported'` feature. The Model tab's Add* buttons (Sketch, Extrusion, Revolve, Fillet, Hole, Shell, Sweep, patterns, work features) are all disabled with a tooltip. You can place it in assemblies, add constraints on top, and pick its faces — but you can't re-author its shape. | STEP files opened as a new part, `.zip` archives containing STEP, an entire migrated Inventor library |
| **Parametric zilventor feature** | The geometry is rebuilt as native zilventor data — a sketch, a `PanelFeature`, a set of `BoreOp` records. Fully editable, undoable, and regenerable like anything you modeled by hand. | DXF imported as a new part or into a sketch, ABF flatten DXF import, and an imported STEP body converted to a panel after the fact |

Two escape hatches bridge the gap between the two outcomes:

- **Explode** turns a multi-body imported STEP part into an assembly — one read-only part per
  solid, per-body colors kept — so you can position, hide, or delete bodies independently. It
  doesn't make the geometry editable, only separable.
- **Convert to panel** replaces a single-solid imported part's read-only feature with a real
  `PanelFeature`, in place, once you're ready to treat it as parametric stock.

## Ways external CAD comes in

| Page | Format | Produces |
|---|---|---|
| [STEP Files](./step-files.md) | `.step` / `.stp`, optionally zipped | Read-only imported part (new part, or inserted as an assembly component) |
| [DXF Files](./dxf-files.md) | `.dxf` | A new sketch-based part, entities added to an active sketch, or a non-geometric drawing underlay |
| [ABF Flatten Import](./abf-flatten-import.md) | `.dxf` (ABF nesting-software export) | One assembly with N parametric `PanelFeature` parts, plus real bores where recognizable |
| [Convert to Panel](./convert-to-panel.md) | (post-processing step, not a file format) | Turns an already-imported STEP body into a parametric `PanelFeature` |
| [Inventor Migration](./inventor-migration.md) | Autodesk Inventor 2012 `.ipt`/`.iam` library, via a VBA export macro | A batch of read-only parts/assemblies with geometry, poses, iProperties, and resolved parameter values |
| [SolidWorks Files](./solidworks-files.md) | `.sldprt` / `.sldasm` | Nothing directly — guidance to convert to STEP first |

## Size limits

STEP and DXF files opened through the **File** tab are capped at roughly 50 MB; anything
larger is rejected with a size warning before the browser tries to parse it (large STEP files
can freeze the tab). See each page for where the cap does and doesn't apply.

## See also

- [Documents and Kinds](../concepts/documents-and-kinds.md)
- [The Browser Tree](../concepts/the-browser-tree.md)
- [Panels](../furniture/panels.md)
- [File Formats](../reference/file-formats.md)
- [Known Limitations](../troubleshooting/known-limitations.md)
