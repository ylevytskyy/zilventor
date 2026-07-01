# ZilInventor's Existing Manufacturing-Processing Capabilities

This is a snapshot of what ZilInventor's codebase already does today, taken directly from source files and git history rather than from feature descriptions. It is the baseline for the [gap analysis](02-gap-analysis.md) against [ABF](../01-overview/01-what-is-abf.md).

**Repo state checked:** local `master` @ `133271ad`, unpushed to `origin/master` (~90+ commits ahead). Everything below is merged to this local master unless explicitly marked "unmerged branch". Verified against `git log --all` ancestry and the actual source tree, cross-checked with point-in-time memory notes.

**Confidence: 82.** High confidence on the presence and architecture of each capability — checked against real source files and git ancestry, not memory text alone. Moderate uncertainty on exact current runtime behavior and edge-case completeness: memory notes are 5–21 days old and point-in-time, and none of this was re-executed or re-tested for this snapshot.

## Drilling/boring pipeline: carcass joints, system-32 shelf pins, hinge boring, drawer-slide bores, bake/unbake, live editing, 3D markers

ZilInventor has a full hardware-boring (присадка — "drilling/boring") pipeline. Bores are stored as `PartDocument.bores[]` metadata and can optionally be "baked" into real OCCT hole geometry. This is the same domain covered by [ABF's hardware boring and joinery doc](../03-machining/02-hardware-boring-and-joinery.md).

| Capability | Where it lives | Notes |
|---|---|---|
| Carcass joints (confirmat/minifix/dowel), auto | `packages/app/src/commands/GenerateCarcassBoresCommand.ts` | Walks a `.ziasm` sub-assembly, uses `jointMath.enumerateAutoJoints` + `connectorCatalog` |
| Carcass joints, manual two-panel pick | `packages/app/src/commands/AddManualJointBoresCommand.ts` | User picks the two panels directly |
| System-32 shelf-pin boring | `GenerateShelfPinBoresCommand`, `AddManualShelfPinBoresCommand`, `shelfPinGrid` | Ø5 line-boring grid, 32mm pitch, configurable start offset; auto and manual |
| Hinge boring | — | Ø35 cup on the door face + Ø5 2-hole mounting plate on the side panel; setbacks depend on overlay; hinge count depends on door height |
| Drawer-slide bores | — | Under-mount bores for Blum TANDEM, plus side-mount slide bores |
| Bake/unbake | `BakeBoresCommand` / `UnbakeBoresCommand` | Groups bores into an additive `atFace` HolePlacement → real cut geometry, visible in 3D and in `.zidw` drawings |
| Live editing | `BorePropertiesPanel`, `connectorCoupling.ts` | Click a bore marker to edit Ø/depth/delete; a coupled world-space "move along joint / height" primitive works convention-free across carcass and hinge bores |
| 3D markers | `SceneManager.setBoreMarkers` | Viewport markers for every bore |

**Known limits:**
- Minifix cam-offset boring is geometrically valid but not furniture-exact.
- Back/toekick joints (groove-seated) are not connector-drilled.
- Multi-instance same-part-at-multiple-poses coupled-move uses the first pose only.
- A numeric edit panel (slice 3) and a 3D drag-gizmo (slice 5, `08722eee`) both exist; there is no drag beyond that gizmo.

## DXF export of boring maps and machining data

Boring data exports as both CSV and DXF:

- **CSV**: `buildBoringCsv`.
- **DXF**: `renderBoringDxf` — circles placed on `D{Ø}_T{depth}` layers (e.g. `D5_T13`), one layer per hole diameter/depth combination.

This boring-specific export sits alongside a broader, separately-scoped **per-panel manufacturing DXF** (Milestone 2.1): "Export DXF (Manufacturing)" produces a ZIP with one DXF per unique panel, deduplicated by size + material + grain + boring + groove signature. Layers: `OUTLINE`, `BORES-FRONT`/`BORES-BACK`/`BORES-EDGE-<dia>MM`, `GROOVES`, `EDGEBAND`, `GRAIN`, `INFO`, `DIMENSIONS`, `BORE-INFO`. Geometry is true mm, 1:1, with panel length mapped to +X and width to +Y. Source: `renderPanelManufacturingDxf.ts`, `manufacturingLayers.ts`. See [ABF's CNC/DXF export doc](../04-production-output/02-cnc-dxf-export.md) for the format this is being compared against.

**Known limits:**
- ASCII-only text in machining/nesting DXFs — no Cyrillic in these labels (Cyrillic does work elsewhere in the app via i18n).
- Full 256-color ACI palette is not implemented; only a sparse common palette.
- ATTRIB/ATTDEF block-attributes are not imported (relevant to the separate general-purpose DXF import/export pipeline, see below).

## Grooves/dado joinery (adjacent to boring)

`GrooveFeature`/`GrooveSpec` (`packages/shared/src/groove.ts`, `grooveMath.ts`) is a parametric, **regenerable** feature-tree feature — not a one-shot cut. It specifies face role, axis (u/v), position, width, and depth, and the kernel executes it via a `BRepPrimAPI_MakeBox` boolean cut on every rebuild. UI is `GrooveDialog.tsx` under the Присадка ribbon panel. Used for back-panel rebates and raised-panel door center-panel rebates (`raisedPanelRebateGrooves`).

**Known limits:** no multi-groove UX polish, no in-place groove edit/delete, no groove markers/overlay, no 32mm snap. Grooves appear in the manufacturing DXF (M2.1) but are not yet a distinct cut-list "operation" line.

## Edge banding (adjacent to boring/machining)

`EdgeBand.thickness` (mm) is tracked per band, with a `MaterialEntry.bandThicknessMm` catalog default (0.4mm). Net→gross cut-list conversion (Milestone 1b.3) adds band thickness per banded edge via `grossLength`/`grossWidth` helpers; the cut-list CSV carries Gross L/Gross W columns. The manufacturing DXF emits an `EDGEBAND` layer (one `LINE` per banded edge), and per-panel shop labels show thickened banded sides with F/B/L/R letters. `ToggleShowEdgeBandsCommand` controls viewport display.

**Known limit:** there is no true edge-band machining program (router/edgebander G-code) — banding is metadata plus gross-size math plus visual/DXF annotation only.

## Nesting: packGuillotine, kerf/oversize handling, per-sheet DXF export, PDF/PNG export

`packGuillotine` (`packages/shared/src/nesting`) is a guillotine-cut packer with kerf and per-job oversize allowance (Milestone 1b.2), and `packAllMaterials` handles multiple materials in one nest. Staleness detection (`computeNestFingerprint`) re-flags a nest when the cut-list, kerf, or oversize allowance changes. UI: `NestingTab.tsx`, `NestDialog.tsx`. See [ABF's nesting doc](../04-production-output/01-nesting.md) for the comparison target.

Export formats, all zip/multi-sheet capable:

| Format | Command | Notes |
|---|---|---|
| PNG | `ExportNestPngCommand` | — |
| PDF | `ExportNestPdfCommand` / `renderNestPdf.ts` | — |
| DXF | `ExportNestDxfCommand` (Milestone 2.2) | One DXF per sheet: `SHEET` boundary + panel `OUTLINE` cut paths + `INFO` labels, `renderNestSheetDxf.ts` |

**Known limits:** guillotine-only packing — no true irregular/rotational nesting optimizer. Oversize allowance is global (per-job), not per-panel, in the current MVP.

## Labels/reports: per-panel shop labels PDF (grain/edges/QR), CSV/BOM outputs

**Shop labels (Milestone 2.3):** "Export Labels (PDF)" produces an A4 PDF with one label per physical panel copy: item number, part name, material, L×W×T, copy `i/N`, a mini panel diagram (aspect-correct rectangle, grain arrow, banded-edge thickening with F/B/L/R letters), and a QR code encoding `Z|item|copy/qty|LxWxT|materialName`. Source: `buildPanelLabels.ts`, `renderLabelsPdf.ts`, `qr.ts`. Compare against [ABF's labels/reports doc](../04-production-output/03-labels-and-reports.md).

**Known limits:** QR only, no barcode. Fixed 2×5 grid A4 layout. Long material names can overflow the label cell (known, deliberately deferred).

**BOM/reports:**

- Recursive part/assembly BOM aggregation (`aggregateBomRecursive`), CSV export (`buildBomCsv`, `ExportBomCsvCommand`), item-number assignment/renumbering (`RenumberBomCommand`, `SetBomItemNumberCommand`), color-split BOM rows.
- Separate connector/hardware BOM (`ConnectorBomTable`, `connectorBomCatalog.ts`) with cabinet-scoped dedup to avoid double-counting shared fasteners (e.g. shelf pins counted per hole).
- Cut-list CSV includes gross sizes, edge-band info, and a "присадка/Connectors" section.

**Known limit:** BOM output is UI table + CSV only. No native PDF cut-list or purchase-order report format exists; the labels PDF and the manufacturing DXF `INFO` layer are the closest things to printed shop paperwork.

## Drawings: .zidw drawing kind, section/detail views, DXF export pipeline (AC1015, native DIMENSION)

ZilInventor has a full 2D engineering-drawing subsystem (`.zidw` documents, Sub-project 6 + the F-series milestones): orthographic, section, detail, and broken views; auto-dimensioning; baseline/ordinate/angular dimensions; hole tables; center marks; material-colored section hatch; a view-projection pipeline with live regen; drawing templates; and PDF/SVG/PNG/DXF export. Both part- and assembly-sourced projections are supported. This is a general engineering-drawing layer, distinct from the manufacturing/shop outputs above, and is comparably mature to Inventor's drawing module. Compare against [ABF's working-drawings doc](../04-production-output/04-drawings-and-exploded-views.md).

**DXF export/import** is a hand-rolled, dependency-free codec (`packages/shared/src/dxf/` + `packages/app/src/drawing/dxfWriter.ts`), targeting strict AC1015 (AutoCAD 2000+):

- **Milestone 1 — full bidirectional 2D drawing DXF**: import (flat entities, blocks/inserts, layers/color/linetype, hatch, dimension/leader/mleader, 3DFACE, RAY/XLINE) and export from the `.zidw` system, including native `DIMENSION` entities. Import lands as editable 2D sketch primitives. Round-trips; the parser is profiled at roughly linear time (~1.25s at a 50MB cap).
- Native `DIMENSION` support adds a `*D##` anonymous block per dimension (Milestone: native R12 DIMENSION in DXF).

**Known limit:** real-AutoCAD/ODA open-verification for the DXF pipeline is still human-gated — it has never been independently confirmed inside an actual CAD application.

**Unmerged branches (shipped, not on master):** part/edge tagging + balloons (M3.1), live-view autoregen (M3.2), drawing templates (M3.3), view alignment (M3.4) — all present as feature-branch commits per memory notes, not yet integrated into local master.

## Hardware catalog (supporting boring/BOM)

`BUILTIN_CATALOG` has 16 SKUs (as of Milestone 1b.5): carcass connectors (confirmat/minifix/dowel), 3 drawer-slide SKUs, leg-levelers, soft-close hinges, standard hinges, shelf pins, drawer handles/pulls. Custom hardware SKU import (M4 Slice D) adds per-document `customHardware` via JSON import, routed through all consumers by `resolveHardwareCatalog`. BOM rollup uses `aggregateHardwareRecursive`/`aggregateConnectorBomRecursive`, cabinet-scoped and deduplicated by `(scope, kind, connectorId)`.

**Known limit:** drawer slides are modeled as a centroid placeholder box, not true rail-pair geometry.

## Repo state and commit references for traceability

| Area | Local master commit(s) | Status |
|---|---|---|
| Boring — Присадка slice 1 (carcass-joint boring) | `bdfe322` | merged |
| Boring — Присадка slice 2 (doors + hinge cup + система-32) | `a57b1f7` | merged |
| Boring — Присадка slice 3 (live-edit + hardware BOM) | `d4e17b8` | merged |
| Boring — Присадка slice 4 (drawer banks) | `9574d3f3` | merged |
| Boring — Присадка slice 5 (3D drag-gizmo) | `08722eee` | merged |
| Boring — Присадка slice 6 (drawer handles/pulls) | `d33b094e` | merged |
| Groove/dado cut (M1a.3) | `d1045951` | merged |
| Kerf + oversize nesting (M1b.2) | `1ce5b56c` + `36bf5c35` | merged |
| Edge-band gross sizes (M1b.3) | `0784c08b` | merged (v26→v27) |
| Hardware catalog + drawer-slide BOM (M1b.5) | `30fc53b6` | merged |
| Per-panel manufacturing DXF (M2.1) | `6ea0c384` | merged |
| Nesting/sheet-layout DXF (M2.2) | `8d46bdd1` | merged |
| Per-panel shop labels PDF (M2.3) | `4f79324d` | merged, completes M2 |
| DXF full bidirectional drawing import/export (M1) | `7c8684cb` | merged, unpushed |
| Custom hardware SKU import (M4 Slice D) | `3342cab5` | merged (v32→v33) |
| Blind + diagonal corner cabinets (M4 Slice E) | `a9d506c1` | merged, completes M4 (v33→v34) |
| Part/edge tagging + balloons (M3.1) | `5e3063b8`..`ee6ad861` | **unmerged branch** |
| Live-view autoregen (M3.2) | `822b4126`..`b274126a` | **unmerged branch** |
| Drawing templates (M3.3) | `b1f03400` | **unmerged branch** |
| View alignment (M3.4) | `d50d0e58` | **unmerged branch**, completes M3 |
| Native R12 DIMENSION in DXF | `ab731bd` | merged |
| STEP per-body color open fix | `133271ad` | merged, current HEAD |

## Cross-cutting caveats

- Everything above is **local-master-only and unpushed** — `origin/master` is far behind. This must be pushed before any deployed or shared evaluation is meaningful.
- A recurring documented failure class across nearly every feature slice is the "geometry-convention false-green" — face/axis sign errors that unit tests didn't catch. Each instance was caught and fixed, but it signals the domain is genuinely tricky and there is ongoing regression risk on future edits.
- **No CNC post-processor exists.** There is no G-code, Biesse CIX, or Homag MPR output. CIX support is explicitly deferred pending a real sample file. DXF is currently the only machine-readable manufacturing format ZilInventor produces — this is the most direct gap against an ABF-style CNC-ready output if ABF emits CIX/MPR natively (see the [gap analysis](02-gap-analysis.md) for the resolved comparison).
- Frameless-cabinet corner cases — blind and diagonal corner cabinets, variable-height drawer banks, toekick leg-levelers, Blum TANDEM slides — are all present and merged (Milestone 4).

Continue to the [gap analysis](02-gap-analysis.md) for how this inventory compares against ABF's demonstrated capabilities.
