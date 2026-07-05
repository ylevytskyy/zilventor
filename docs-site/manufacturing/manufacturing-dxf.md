---
title: Manufacturing DXF
---
# Manufacturing DXF
> Exports one DXF per unique panel, deduplicated and zipped, so a cutting service or CNC operator gets exactly the shapes they need to cut — not a sheet layout.

**Where:** Furniture ▸ Присадка ▸ **Export DXF (Manufacturing)** · **Shortcut:** — · **Applies to:** panel-based cabinet assembly with generated bores/grooves

## What it does

Export DXF (Manufacturing) walks every panel in the active assembly and groups
panels that are identical by a 5-part signature: `length x width x thickness |
materialId | grain | bores | grooves | tenonMortises | keyholeSlots`. Panels
that match on all five are merged into a single DXF with a summed quantity —
so a cabinet with twelve identical shelves produces one DXF file, not twelve.
Each DXF draws the panel outline plus every machining feature (bores, grooves,
tenons/mortises, keyhole slots) on its own layer.

This is a different export from [Nesting](./nesting.md)'s per-sheet DXF: that
one lays panels out on stock sheets for a guillotine cut plan; this one is
per-unique-panel, for a cutting service or CNC that takes individual part
files (or a combined file) rather than a sheet layout.

## Before you start

- The assembly needs a populated cut list with generated bores/grooves — see
  [Cut List](../furniture/cut-list.md) and
  [Generate Carcass Boring](../drilling-prisadka/generate-carcass-boring.md).
- Decide your **DXF Export Mode** and **Layer Scheme** before exporting (see
  Options) — both are set once and apply to the whole export.

## Steps

1. Open the assembly you want to export.
2. In the Furniture tab, Присадка panel, set **DXF Export Mode** to **Folders
   per material** or **Single combined file**.
3. Set **Layer Scheme** to **Native** or **ABF** (see
   [ABF Layer Scheme](./abf-layer-scheme.md) for what the ABF option changes).
4. Click **Export DXF (Manufacturing)**.
5. Save the resulting file: a ZIP of per-panel DXFs organized into per-material
   folders (**Folders per material**), or a single DXF containing every
   panel laid out on a grid (**Single combined file**).

*Result: every unique panel in the assembly is exported as its own DXF
(deduplicated by size, material, grain, and machining features), ready to
hand to a cutting service or CNC operator.*

## Options

| Field | Meaning |
|---|---|
| DXF Export Mode — Folders per material | ZIP output: one DXF per unique panel, grouped into a folder per material. |
| DXF Export Mode — Single combined file | One DXF containing every unique panel arranged on a grid layout, instead of separate files. |
| Layer Scheme — Native | zilventor's own layer names: `OUTLINE`, `GROOVES`, `TENONS`, `MORTISES`, `KEYHOLE-SLOTS`, `EDGEBAND`, `GRAIN`, `INFO`, `DIMENSIONS`, `BORE-INFO`, plus per-diameter bore layers `BORES-FRONT-<dia>MM` / `BORES-BACK-<dia>MM` (Top/Bottom face bores) and `BORES-EDGE-<Edge>-<dia>MM` (edge bores, `<Edge>` = Front/Back/Left/Right). |
| Layer Scheme — ABF | Layer names matching the third-party ABF cutting-service plugin's grammar — see [ABF Layer Scheme](./abf-layer-scheme.md). |

## Tips & gotchas

- **A preset's target layer name always wins.** If a bore, groove,
  tenon/mortise, or keyhole slot was created from a
  [machining preset](../drilling-prisadka/machining-presets.md) that specifies
  a target layer name, that name is used regardless of whether Layer Scheme is
  set to Native or ABF.
- **`machining.csv` only appears when there's CAM metadata to report.** In
  **Single combined file** mode, if at least one exported bore carries a tool
  number or spindle speed, a second file `machining.csv` is written alongside
  the DXF (columns: `partName,opType,diameter,depth,layer,toolNumber,speed`).
  If nothing carries CAM metadata, only the DXF is produced — see
  [CAM Metadata](./cam-metadata.md).
- **Layer Scheme doesn't change which panels export or how they're
  deduplicated** — only how each feature's layer is named. Switching schemes
  and re-exporting the same assembly produces the same set of panels with
  different layer names.

## See also

- [ABF Layer Scheme](./abf-layer-scheme.md)
- [CAM Metadata](./cam-metadata.md)
- [Nesting](./nesting.md)
- [Machining Presets](../drilling-prisadka/machining-presets.md)
- [Exporting Boring Data](../drilling-prisadka/exporting-boring-data.md)

<!-- SCREENSHOT: Furniture ribbon Присадка panel with DXF Export Mode and Layer Scheme toggles + Export DXF (Manufacturing) button — TODO follow-up -->
<!-- SCREENSHOT: unzipped Folders per material output showing per-material subfolders of per-panel DXF files — TODO follow-up -->
