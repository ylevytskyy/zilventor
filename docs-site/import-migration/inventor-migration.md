---
title: Inventor Migration
---
# Inventor Migration
> A one-time, one-way path for pulling an entire Autodesk Inventor 2012 furniture library
> (`.ipt`/`.iam`) into zilventor as read-only parts and assemblies.

**Where:** Inventor: **Tools ▸ Macros…** (exports) · zilventor: File tab ▸ **Import from
Inventor** · **Shortcut:** — · **Applies to:** part, assembly · **Browser support:** Chromium
only (Chrome, Edge, Brave, Arc) — the button is disabled elsewhere because it needs
`showDirectoryPicker`

## What it does

Migration happens in two stages. First, a VBA macro running **inside Inventor 2012** walks your
`.ipt`/`.iam` library and exports each part as a STEP (AP214) file plus a JSON "sidecar"
carrying iProperties and parameter values; each assembly gets a JSON sidecar describing its
component tree and poses (no STEP — assemblies reference parts by relative path). Second,
zilventor's **Import from Inventor** command reads that folder and writes native
`.zipt`/`.ziasm` files into an OPFS target folder.

It is one-way and one-time: there's no incremental re-export, no two-way sync, and no formula
tracking. Imported parts are read-only in zilventor — the goal is a clean landing spot to keep
working from, not a live bridge back to Inventor.

### What migrates

- **Geometry**, as STEP. Each unique `.ipt` exports once even if it's referenced in twenty
  assemblies.
- **Assembly structure**, with components placed by `(translation, quaternion)` pose. Nested
  assemblies round-trip as nested `.ziasm` files.
- **iProperties** (Part Number, Description, Material, Mass, Vendor, Revision, and more) land
  under canonical keys in a `properties` bag; custom iProperties keep their original key
  verbatim, including Cyrillic.
- **Numeric user parameters** land as plain resolved values in the Parameters panel. The
  original expression string rides along as a comment but is not re-evaluated.
- **Per-occurrence color overrides** in assemblies.

### What does NOT migrate

- **Assembly constraints** (mate, flush, angle, insert) — these reference internal Inventor
  face/edge IDs that don't survive STEP transit. Imported assemblies have components positioned
  by pose only, with zero constraints; re-add zilventor constraints by hand.
- **Expressions and iLogic** — only the resolved numeric value survives.
- **Drawings** (`.idw`/`.dwg`) and **presentations** (`.ipn`).
- **Textured appearances** — flatten to a base RGB color.
- **Sheet metal / weldment / Frame Generator metadata** — the body geometry comes through as
  STEP, but bend tables, weldment symbols, and frame catalogs are lost.

The practical consequence: every imported part is read-only, same as any other
[STEP import](./step-files.md) — the Model tab's Add* buttons stay disabled with a tooltip
pointing you at creating a fresh native part if you need to re-author the shape.

## Before you start

- Load the export macro into Inventor **once per installation**: **Tools ▸ Macros ▸ Visual
  Basic Editor** (Alt+F11) ▸ right-click **Standard.ivb ▸ Import File…** ▸ pick
  `tools/inventor-export/ZilInventorExport.ivb` from the zilventor repo ▸ save the project.
- In Inventor, set **Tools ▸ Macros ▸ Security…** to **Disable with notification** — the
  "Disable without notification" setting silently kills the macro and the export appears to do
  nothing.
- Use a Chromium-based browser for the zilventor side (Chrome, Edge, Brave, Arc). Firefox and
  Safari can't run `showDirectoryPicker`, so **Import from Inventor** stays disabled there.

## Steps

### 1. Export from Inventor

1. **Tools ▸ Macros…** ▸ select **`ZilInventor_BatchExportFolder`** ▸ **Run**.
2. First dialog: pick your library root (e.g. `D:\Furniture\Library`) — the macro recurses into
   every subfolder.
3. Second dialog: pick an output folder **outside** the input root (e.g.
   `D:\Furniture\Library_export`) — the macro refuses to run if the output folder is nested
   inside the input.
4. The macro opens, exports, and closes each `.ipt`/`.iam` in turn (roughly 1–3 seconds per
   part; a 200-part library typically takes 8–12 minutes).
5. When it finishes, open the reported `_export-log.txt` and confirm every line reads `OK` (not
   `SKIP` or `ERR`).

*For a single file, run `ZilInventor_ExportActiveDocument` instead — same output shape, one
document.*

### 2. Import into zilventor

1. Switch to the **File** tab.
2. Click **Import from Inventor**.
3. In the dialog, pick a **conflict policy** (see Options below) — this is chosen up front,
   before either folder picker runs.
4. Click **Import**. The browser's native folder picker opens twice, in order:
   - first, pick the **input** folder — the macro's output folder from step 1 (read-only
     access);
   - then, pick or create the **target** OPFS folder — where the `.zipt`/`.ziasm` files land
     (read-write access).
5. The dialog shows live progress (`Importing N / M: <path>`), then a summary: *"Imported N
   parts, M assemblies, K skipped, J errors."*
6. *Result: the target OPFS folder contains a `.zipt` per part and a `.ziasm` per assembly, open
   any of them from **File ▸ Open** like a normal file.*

## Options

| Field | Meaning |
|---|---|
| Overwrite existing files | Clobbers anything already at the target path — use for a fresh import or a clean re-migration |
| Skip existing *(default)* | Leaves existing target files untouched — use when re-running the import after editing some already-imported parts |
| Cancel on conflict | Aborts the whole import on the first naming collision — the cautious choice for incremental re-runs |

## Tips & gotchas

- Imported parts show a single `Imported (<filename>.step)` row in the browser tree, and the
  BOM tab aggregates instances using the part's **Part Number** and **Description** — so
  iProperty hygiene in Inventor pays off directly in zilventor's BOM.
- Imported faces are still pickable for zilventor constraints (topology-index naming survives
  save/reload) — as long as you don't re-import the same part, which can shift face indices.
- If Cyrillic names show up as `???`, the macro's UTF-8 path (`ADODB.Stream`) likely didn't run
  — check that ActiveX Data Objects is available in Inventor's VBA references and re-run from a
  fresh Inventor session.
- STEP export failures on legacy thread features or broken sheet metal are logged per-file in
  `_export-log.txt`; the practical workaround is a manual **File ▸ Save Copy As ▸ STEP** in
  Inventor plus a hand-authored JSON sidecar copied from a working sibling part.
- The export output folder is throwaway — delete it once the OPFS-side files are written and
  verified; a 500-part library's export can run 100–300 MB.

<!-- SCREENSHOT: the Import from Inventor dialog with conflict-policy options, mid-import progress bar — TODO follow-up -->

## See also

- [Import & Migration overview](./index.md)
- [STEP Files](./step-files.md)
- [Browser Support](../getting-started/browser-support.md)
- [Documents and Kinds](../concepts/documents-and-kinds.md)
