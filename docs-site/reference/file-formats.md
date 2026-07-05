---
title: File Formats
---
# File Formats
> The four native file types Zilventor reads and writes, their current format version, and what happens when you open an older file.

Every document lives in the browser's [OPFS](./glossary.md#opfs) storage during a session and is saved to one of four native extensions. Three of them (part, assembly, drawing) share one manifest schema and one version counter; the sheet-template format is a separate, self-versioned envelope.

## Native formats

| Extension | Document kind | Manifest `kind` | Save/Export accept type |
|---|---|---|---|
| `.zipt` | Part | `'part'` | `application/zilinventor-part` |
| `.ziasm` | Assembly | `'assembly'` | `application/zilinventor-assembly` |
| `.zidw` | Drawing | `'drawing'` | `application/zilinventor-drawing` |
| `.zitpl` | Sheet template (drawing title-block/border template) | — (not part of the manifest system, see below) | — |

`.zipt`, `.ziasm`, and `.zidw` files are tar.gz archives containing a `manifest.json` (with `formatVersion`, `kind`, `createdAt`, `appVersion`, and a `document` payload) plus any embedded geometry/assets. `.zitpl` is a plain UTF-8 JSON file with its own `formatVersion` field (currently `1`) — it is not migrated by the mechanism described below and is round-tripped only within this app.

## Current format version

**`CURRENT_FORMAT_VERSION = 41`** for the part/assembly/drawing manifest schema.

## Migration on open

Opening any `.zipt`, `.ziasm`, or `.zidw` file **automatically and silently migrates it in memory** to the current version — there is no dialog, no prompt, and no way to opt out. Each version step in the table below is applied in order between the file's stored `formatVersion` and 41. The migration only exists in memory: the file on disk is **not** rewritten until you next explicitly save it. Opening a file whose `formatVersion` is *newer* than the app's `CURRENT_FORMAT_VERSION` fails with an error instead of silently downgrading it — this happens if you open a file saved by a newer build of the app.

Most steps are additive no-ops (a new optional field appears, existing documents just don't have it yet); a handful actively rewrite data. Full version history:

| Version | What changed |
|---|---|
| 1→2 | Synthesize primitive IDs on sketch features. |
| 2→3 | Add constraints to sketch features, inferred from existing geometry. |
| 3→4 | Ensure `document.parameters` exists. |
| 4→5 | Add an `operation` field (new/join) to extrude features. |
| 5→6 | Additive — Fillet feature. |
| 6→7 | Additive — Sweep feature. |
| 7→8 | Assembly schema: component paths replace bare component IDs on constraints; grounded-components rename. |
| 8→9 | Additive — iProperty bag on part/assembly documents. |
| 9→10 | Additive — materials list. |
| 10→11 | Additive — cut-list item numbers. |
| 11→12 | Additive — hardware catalog list; seeds built-in hardware entries. |
| 12→13 | Additive — nest/sheet-size fields (write-only until then). |
| 13→14 | Additive — drawing document kind. |
| 14→15 | Additive — Section View. |
| 15→16 | Additive — Detail View. |
| 16→17 | Additive — broken-view breaks. |
| 17→18 | Back-fill a `mode` on existing section views. |
| 18→19 | Back-fill a `kind` on existing detail-view regions. |
| 19→20 | Additive — custom textures (PBR materials). |
| 20→21 | Additive — panel bores, optional component role. |
| 21→22 | Additive — door spec on component instances. |
| 22→23 | Additive — bore edit/joint-direction fields, suppressed connector list. |
| 23→24 | Additive — drawer spec, drawer-slide bores. |
| 24→25 | Additive — handle-screw bores, drawer-handle role. |
| 25→26 | Additive — face-frame stile/rail panel roles. |
| 26→27 | Edge bands gain a required thickness; existing bands back-filled to 0.4mm. |
| 27→28 | Additive — empty rule list (parametric configurator). |
| 28→29 | Additive — empty suppressed-feature list. |
| 29→30 | Additive — empty configuration (iPart) list. |
| 30→31 | Additive — ellipse sketch primitive; spline degree widened. |
| 31→32 | Additive — point sketch primitive, sketch annotations. |
| 32→33 | Additive — custom hardware catalog field. |
| 33→34 | Additive — panel feature outline (corner cabinets). |
| 34→35 | Additive — CAM metadata on bores/grooves. |
| 35→36 | Additive — material kind, assembly unit prices. |
| 36→37 | Additive — mortise/tenon feature kind. |
| 37→38 | Additive — nest instance index/mirrored flags, sheet remnant/manually-edited flags. |
| 38→39 | Additive — produced-panels tracking (production reconciliation). |
| 39→40 | Additive — keyhole-slot feature kind. |
| 40→41 | Additive — `BoreOp.sku` field. |

## External formats

The native formats above are round-tripped exclusively through this app. For everything you can import from or export to other CAD/CAM tools (STEP, DXF, and the app's various manufacturing/report exports), see [Export Formats](./export-formats.md) and [Import & Migration](../import-migration/index.md).

## See also

- [Documents and Kinds](../concepts/documents-and-kinds.md)
- [Saving and Sessions](../concepts/saving-and-sessions.md)
- [Export Formats](./export-formats.md)
- [Import & Migration](../import-migration/index.md)
