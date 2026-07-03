# Processing Parity Requirements

This document turns the [gap analysis](./02-gap-analysis.md) into a requirements list. Each requirement (R1–R7) is something a ZilInventor engineer can pick up, implement, and verify without re-reading the ABF research. Requirements are ordered by pipeline stage, matching the [end-to-end workflow](../01-overview/03-end-to-end-workflow.md).

Status tags (`done` / `partial` / `missing`) reflect the current local `master` state described in the [capability inventory](./01-zilinventor-capability-inventory.md), as of 2026-07-03 (R7 re-sync). They will drift — re-check against that doc before trusting a tag blindly.

---

## R1 — Input contract: normalize any part representation into a single-solid panel model

**Requirement.** ZilInventor must accept a part (however it was authored — sketch-extruded solid, imported STEP body, boxed primitive) and resolve it into a single, unambiguous "panel" record equivalent to ABF's Group contract: one true solid, one name, one material assignment, one thickness. If a part cannot resolve to that shape, the system must say so with a specific, actionable diagnostic (not a silent skip or a generic error).

**Why.** ABF's entire toolchain — labeling, boring, grooving, nesting, DXF, BOM — refuses to operate on anything that isn't a "Solid Group": one true solid per part, named, material-coded. ABF explodes nested Components down to this shape automatically and diagnoses failures by exclusion (unlabeled panel ⇒ not-a-solid or asymmetric geometry). ZilInventor's kernel already enforces true-solid parametric parts by construction (feature tree → OCCT solid), so the "make it a solid" half of this problem is structurally solved. What ABF has that we should make explicit is the **diagnostic path**: a clear, named failure reason when a part doesn't qualify for downstream processing (imported STEP body that's still a multi-solid compound, non-manifold geometry, missing material assignment, missing name).

**Requirements detail:**

| Sub-requirement | Detail |
|---|---|
| R1.1 | Every panel entering boring/machining/nesting/export must resolve to exactly one solid. Multi-solid imports (e.g. STEP compounds) must be explicitly split or explicitly explode-selected — never silently processed as one unit. |
| R1.2 | Every panel must carry a name and a material assignment before it can be bored, nested, or exported. Missing either blocks the operation with a named error (e.g. `"Panel <id> has no material assigned"`), not a crash or silent default. |
| R1.3 | Thickness must be read from the panel's solid geometry (bounding-box thickness along its declared machining axis), not inferred from material name text — this avoids the material-thickness-encoding ambiguity ABF's own ecosystem shows conflicting evidence about. |
| R1.4 | Changing a panel's material or thickness and re-running nesting/BOM must correctly re-bucket it (matches ABF's auto-split-by-material/thickness behavior on re-breakdown). |
| R1.5 | A geometry-validity check (closed manifold, non-self-intersecting) must run before labeling/boring, with a diagnostic distinguishing "not a solid" from "asymmetric/deformed face" — ABF uses label-placement failure as an implicit proxy for this; ZilInventor should make the check explicit and named rather than inferred from a downstream failure. |

**Status:** `done` (P10, 2026-07-03). `panelPreflight(part)` in `@zilventor/shared` implements the check as a typed `pass | split-required | fail-with-reason` result (covering manifold/name/material; 5 acceptance fixtures green), and it is wired live into all three real entry points: boring (`aggregateBoresRecursive` → `ExportBoringDxfCommand`), manufacturing DXF (`resolvePanelSpec` → `loadCutListInputs` → `aggregateCutListRecursive` → `ExportPanelManufacturingDxfCommand`), and nesting (`OpenNestingTabCommand`) — with i18n-surfaced diagnostics (en/uk, `panel.preflight.*`) toasted in `FurnitureTab`/`BrowserPane`/`App`. Commit `eac95e4d`. P10 (branch `feat/p10-r1-hardening`, plan `docs/superpowers/plans/2026-07-03-p10-r1-hardening.md`) closed both remaining caveats: (a) `resolvePanelSpec` now runs preflight for imported (non-`PanelFeature`) parts with a real `solidCount` (from per-solid import metadata) — the `split-required` diagnostic is reachable and surfaced through the shared diagnostics path consumed by boring, manufacturing-DXF and nesting; (b) `isManifold` is computed by the kernel (`checkManifold`, `ShapeAnalysis_Shell` free-edge check, ~16ms on a 753KB STEP — ≈0.6% of import time) at STEP-import/split time, per solid, and persisted on `ImportedFeature.isManifold` across all import paths (STEP part/parts/component, explode, Inventor import, File-tab part mode), with `isManifold: false` preserved through persist/reload and redo. See [capability inventory §1, §5](./01-zilinventor-capability-inventory.md).

**Acceptance criteria:** Given (a) a normally-authored parametric part, (b) a multi-solid STEP import, and (c) a deliberately non-manifold/self-intersecting solid, running the pre-flight check on each returns: pass / pass-with-explicit-split-required / fail-with-named-reason respectively. A test suite covers all three cases plus missing-name and missing-material cases.

---

## R2 — Machining: user-configurable hardware presets with tool metadata, exportable per named CNC layer

**Requirement.** Every hardware-boring and machining operation type (confirmat, cam/eccentric, dowel, hinge cup, shelf pin, drawer slide, groove, etc.) must have user-editable parameters (diameter, depth, offset) **and** CAM metadata (tool number, spindle speed, target DXF layer name), savable as a reusable named preset, and each operation must export to its own named CNC layer.

**Why.** ABF's forum-confirmed design: "You can change the parameters, and the layer name in the settings" — every hardware type's hole parameters and DXF layer target are user-configurable, not hardcoded, and savable as presets. A separate ABF tutorial establishes that each machining tool carries a `toolNumber` (physical tool-holder slot) and a machining speed, and that Profile Toolpath depth must be set to match the physical bit loaded in that slot — i.e. the DXF layer is not just a drawing convention, it's a CAM tool-assignment contract with the real CNC. See [hardware boring and joinery](../03-machining/02-hardware-boring-and-joinery.md).

**Requirements detail:**

| Sub-requirement | Detail |
|---|---|
| R2.1 | Each hardware type in the catalog has editable diameter/depth/offset, editable target DXF layer name, and is savable/loadable as a named preset (not just a fixed built-in SKU). |
| R2.2 | Each machining operation (bore, groove) carries optional `toolNumber` and `speed` metadata fields that flow through to DXF layer output — even if ZilInventor doesn't drive a live CNC connection, this metadata is what a shop's CAM software (Aspire/Mastercam/AlphaCAM-equivalent) needs to map layers to physical tools. |
| R2.3 | DXF/manufacturing export writes each operation type to its own named layer, and the layer-naming scheme itself is user-configurable per preset (not a single fixed taxonomy). |
| R2.4 | Presets are exportable/importable (JSON), matching the pattern already used for custom hardware SKU import. |

**Status:** `partial`, in progress (P9). P3 (merge commit `c56e1b8f`, 2026-07-02) closed the model/CRUD/export core of this requirement: the `MachiningPreset` type (`opType`, diameter, depth, offset, `layerName`, `toolNumber?`, `speed?` — `packages/shared/src/machiningPreset.ts`), an app-global localStorage-backed preset CRUD dialog with JSON import/export (`MachiningPresetsDialog`; ADR 0001 accepted — presets are app-global and snapshot-on-apply via `ApplyMachiningPresetCommand`, never live-linked to an already-applied bore), `toolNumber`/`speed` XDATA emission plus per-preset `presetLayerName` routing on manufacturing DXF entities, and a `machining.csv` sidecar in the per-material-folders ZIP export. R2.1/R2.2/R2.3 and most of R2.4 are shipped — the earlier "no toolNumber/speed anywhere / no configurable layer naming / no preset concept at all" language is now obsolete. **Three trailing gaps remain, being closed by milestone P9** (`docs/superpowers/plans/2026-07-03-p9-preset-coverage.md`, branch `feat/p9-preset-coverage`): (a) presets can only be applied to a bore that already exists, one at a time, via `BorePropertiesPanel` — no hardware-creation command (drawer bank, leg levelers, shelf pin) lets a user pick a preset while creating the hardware; (b) grooves have zero properties-panel UI — `GrooveSpec` already carries `toolNumber`/`speed`/`presetLayerName` (added in P3) but nothing in the app lets a user set them; (c) the `machining.csv` sidecar ships only in the folders/ZIP export mode, not the combined single-DXF mode. See the P9 plan's Context section for verified code-level detail, and [capability inventory §1, §5](./01-zilinventor-capability-inventory.md).

**Acceptance criteria:** A user can define a new hardware preset with custom diameter/depth/layer name/toolNumber/speed, save it, apply it to a bore, and see the resulting manufacturing DXF place that bore's geometry on the exact named layer with a `TOOL_NUMBER`/`SPEED` value recoverable from the DXF (e.g. as an XDATA/text annotation on the layer, since raw DXF has no native tool-number entity). Round-trip test: save preset → reload document → preset values persist.

---

## R3 — Nesting: preserve guillotine/kerf lead; add grain-direction propagation into export

**Requirement.** Keep ZilInventor's existing guillotine-cut nesting engine with kerf and oversize allowance (already ahead of ABF's shipped nesting). Add: each panel's grain direction (set once by the modeler, independent of visual material UV) must propagate correctly through nesting rotation/flip into the exported nest DXF and labels, so a 90°-rotated panel in the nest still reports its true material grain axis.

**Why.** ABF's "Quick — Nesting" is explicitly a first-pass-only, non-optimizing placement tool ("shows the result of the first calculation pass... a PRO version is under development") with no kerf/oversize model documented anywhere in vendor material — ZilInventor's `packGuillotine` with kerf + oversize allowance (Milestone 1b.2) is already a stronger nesting core and should not be re-architected to match ABF. What ABF does have that matters is **grain-direction as a first-class, label-driven attribute**: grain is not read from the material's UV mapping but from a rotatable label object (`ABF_label`) attached to each panel, with the label's rotation angle as the source of truth, independent of how the part is visually textured or how it gets rotated during nesting. See [nesting](../04-production-output/01-nesting.md).

**Requirements detail:**

| Sub-requirement | Detail |
|---|---|
| R3.1 | Grain direction is a per-panel attribute distinct from material UV/texture orientation — set once at modeling time (e.g. "long grain runs along local X"), independent of visual appearance. |
| R3.2 | When a panel is rotated or flipped during nesting (guillotine placement), the exported nest DXF and any grain-arrow annotation reflect the *rotated* true grain axis, not the panel's original modeling-time orientation. |
| R3.3 | Nesting must reject or flag placements that violate a "grain must run along sheet length" constraint if the user has marked a panel grain-locked (ABF doesn't document a hard constraint mode; this sub-requirement is a ZilInventor-specific enhancement, not a strict parity item — mark low priority). |
| R3.4 | Per-panel shop labels (already shipping, M2.3) include a grain-direction arrow reflecting the post-nest rotation, matching the label's diagram convention. |

**Status:** `partial`. Guillotine nesting with kerf + per-job oversize allowance and multi-material packing remains shipped and ahead of ABF's documented nesting maturity (R3.1). **R3.2 is now `done`**: `PlacedPanel` carries a `grain` field, `packGuillotine` propagates it through placement, and `renderNestSheetDxf` draws a `GRAIN`-layer arrow per grain-marked panel, flipped 90° when the placement itself is rotated — the same convention already used by `SheetSvg`. Commit `eb13a307`. **R3.4 is now `done`** (P7, commit `3278c6a3`, 2026-07-02): `PlacedPanel.instanceIndex` (P7 W1, commit `95bd365d`, manifest v37→v38, 1-based per `rowKey` assigned pre-sort in `packGuillotine`) lets `buildPanelLabels(result, nest?)` match a qty-expanded copy to its specific placed (possibly rotated) instance by `rowKey + instanceIndex`; the label diagram now draws the effective, post-nest-rotation grain arrow (guarding `grain='none'` panels from a phantom arrow rather than copying the DXF ternary verbatim). The no-nest path is regression-guarded to keep today's modeling-time-orientation behavior when no nest exists. **R3.3 remains `missing`/open** — it was scoped from the start as a ZilInventor-specific enhancement, not a strict ABF-parity item (ABF documents no hard grain-lock constraint mode); explicit low-priority stretch, not scheduled on any milestone. See [capability inventory §6, §7](./01-zilinventor-capability-inventory.md).

**Acceptance criteria:** Nest a panel with an intentionally strong asymmetric grain marker at two different rotations (0° and 90°) in the same sheet. Export the nest DXF and the shop label PDF for both instances. Confirm the grain arrow direction differs by exactly the applied rotation in both output artifacts.

---

## R4 — CNC/DXF export: per-material-folder and combined-file modes; true arc/circle fidelity

**Requirement.** Manufacturing DXF export must support two organization modes — one file per material (in a per-material folder), or one combined file for the whole job — selectable by the user. Circular geometry (bore holes, arcs) must export as true DXF ARC/CIRCLE entities, not polyline-tessellated approximations.

**Why.** ABF's vendor site states current DXF export is "split into separate folders by material, or exported together as 1 file" — both modes, user-selectable. Separately, the ABF developer states on the forum that ABF's DXF "has been circularly interpolated," which a CAM operator reads as a fidelity claim: circles/arcs are real DXF ARC/CIRCLE entities, not a polygon approximation — this matters because polyline-tessellated circles produce visibly faceted holes in CAM preview and can mis-drive router toolpaths expecting true arc geometry. See [CNC/DXF export](../04-production-output/02-cnc-dxf-export.md).

**Requirements detail:**

| Sub-requirement | Detail |
|---|---|
| R4.1 | Export offers (a) one-file-per-material split into per-material subfolders, and (b) a single combined file, both zippable — matching ABF's two documented modes. |
| R4.2 | All bore holes and any curved groove/profile geometry are emitted as DXF `CIRCLE`/`ARC` entities with true center+radius (or center+radius+start/end angle), never as `LWPOLYLINE` chains approximating a circle. |
| R4.3 | A verification pass (automated, not visual) parses the exported DXF and asserts entity type == `CIRCLE`/`ARC` for every hole/curved feature — not just "the DXF opens in a viewer and looks round." |
| R4.4 | Both export modes preserve the existing named-layer scheme (R2.3) so a CAM operator's tool-layer mapping doesn't need to change based on which export mode was used. |

**Status:** `done, regression-locked` (fidelity — R4.3; organization modes — R4.1/R4.4, P2). ZilInventor's hand-rolled DXF codec already writes true `CIRCLE` entities for bores (per manufacturing DXF layer scheme: `BORES-FRONT/BACK/EDGE-<dia>MM`), and R4.3's verification pass is no longer just structurally true by code-reading — a parse-based regression test now asserts it directly: every `BORES-*` entity in both manufacturing DXF (M2.1) and nest DXF (M2.2) parses as a true `CIRCLE`, and there is no closed `LWPOLYLINE` with >4 vertices anywhere in either export. Commit `f96e32b8`. (The underlying claim was already true; this locks it against regression.) Per-panel manufacturing DXF already zips one file per unique panel; nesting DXF already produces one file per sheet. **R4.1/R4.4 closed (P2, 2026-07-02)**: both CNC exports (manufacturing per-panel and nest per-sheet) now offer (a) per-material-subfolder ZIP (entries keyed `sanitize(materialName)/…`, fallback chain for empty/collision names) and (b) a single combined DXF (all units on a row-wrapped grid, 50mm gutter, via `layoutCombinedGrid` + `renderCombinedManufacturingDxf`/`renderCombinedNestDxf`; one header, union layer table), selected by a session-level ribbon toggle (`dxfExportMode`). Both modes reuse the shared `manufacturingLayers.ts` scheme unmodified (R4.4) and leave per-unit geometry emission untouched (R4.3 tests unchanged, green). Note: ABF's combined-file *layout* is undocumented in every primary source (vendor's entire statement: "split by material folder, or exported combined into 1 file"), so the grid layout is ZilInventor's own deterministic choice, not verified parity; ABF also modes only its nesting output — per-panel modes are a ZilInventor extension. See [capability inventory §5](./01-zilinventor-capability-inventory.md).

**Acceptance criteria:** Export a multi-material job in both modes. In per-material mode, confirm the ZIP contains one subfolder per distinct material, each holding only that material's panels/sheets. In combined mode, confirm a single DXF contains all panels/sheets with layer names still resolving correctly. An automated DXF-entity-type check on both outputs confirms zero `LWPOLYLINE`-approximated circles among the hole/arc geometry.

---

## R5 — Labels/reports: preset-driven print templates with QR support and a five-category Statistics/BOM report

**Requirement.** Panel labels must support multiple selectable print templates (not one fixed layout), with a QR-code template variant, and header/free-text fields savable as named presets. The BOM/report system must cover, as distinct sections/tabs, the same five categories ABF's "Thống Kê" (Statistics) report covers: hardware/fitting counts, joints/connectors, edge-banding tape consumption, linear-material cut-length breakdown, and general panel/sheet data — with per-item unit pricing rolling up to a total cost.

**Why.** ABF's "In tem nhãn" (print label) function offers multiple label templates (template #3 = QR), with the header's two free-text lines saved/edited/filtered/deleted as named, reusable Presets. ABF's "Thống Kê" report is explicitly a five-category rollup — hardware, joints/connectors, edge-band tape, linear-material lengths (broken into individual cut pieces, e.g. "3 rods — 1×958mm, 2×466mm"), and panel/sheet data — with per-item unit-price entry driving an auto-computed total cost / quote, exported to Excel. See [labels and reports](../04-production-output/03-labels-and-reports.md).

**Requirements detail:**

| Sub-requirement | Detail |
|---|---|
| R5.1 | Label print supports at least two selectable templates: a standard shop tag and a QR-enabled variant (ZilInventor already ships QR — this sub-requirement is about template *selection*, not adding QR from scratch). |
| R5.2 | Label header/free-text fields (e.g. job name, company name) are savable as named, reusable presets, editable and deletable independent of any single job. |
| R5.3 | BOM/report output is organized into five distinct sections matching ABF's categories: hardware/fittings, joints/connectors, edge-band tape length, linear-material cut-length breakdown, panel/sheet data. |
| R5.4 | Each report line supports a user-entered unit price, with an auto-computed total per section and grand total, exportable in the existing CSV path (Excel-compatible). |
| R5.5 | Linear-material items (e.g. hanging rods, aluminum profile) report as individual cut-piece lengths, not just a total running length — matching ABF's "3 rods: 1×958mm, 2×466mm" style breakdown. |

**Status:** mostly `done`. Per-panel shop labels (M2.3) already ship with QR (`Z|item|copy/qty|LxWxT|materialName` payload) and a mini panel diagram with grain arrow and banded-edge annotation. P5 (merge commit `b6edfa0c`, 2026-07-02) closed R5.1/R5.2: a `LabelTemplateId = 'rich' | 'compact'` template selector plus a page header band, with header/free-text fields (job name, company name) savable/editable/deletable as named `LabelHeaderPresetsDialog` presets that survive a document reload — template choice and the live header-line text itself stay session-only (matching the `dxfExportMode` precedent; only the *named presets* persist, per P5 scope call S2). P4 (merge commit `05a7fac0`, 2026-07-02) separately closed R5.3–R5.5: `buildStatisticsReport` produces the five ABF-matching sections (hardware/fittings, joints/connectors, edge-band tape, linear-material cut-length breakdown via `partitionLinearMaterial`, panel/sheet data), each with editable unit pricing, section subtotals and a grand total, exported via exceljs xlsx and CSV. **Deliberately out of scope**: header-preset JSON import/export (P5 scope call S1) — R5.2's acceptance text asks only for save/edit/delete, not the cross-shop portability machining presets needed; cheap to add later if requested. See [capability inventory §7, §8](./01-zilinventor-capability-inventory.md).

**Acceptance criteria:** A test job with hardware, edge banding, and at least one linear-material part (e.g. a closet rod split into 3 cut pieces) produces a report with five clearly separated sections, each item priced, section subtotals and a grand total all computed correctly and independently verifiable by hand-summing the CSV. Label export offers a template dropdown/selector with at least two options, and a saved header preset survives a document reload.

---

## R6 — Drawings: exploded/working-drawing generation must never mutate the live parametric model

**Requirement (explicit non-goal, inherited as a guardrail).** Generating an exploded view or working drawing from a part/assembly must be a pure, read-only projection. It must never convert, detach, re-group, or otherwise permanently alter the source parametric model. This is a correctness invariant to protect, not a feature to build — call it out explicitly in code review and tests for any exploded-view or drawing-generation code path.

**Why.** ABF's own free "Exploded View" tool has a documented, serious flaw: invoking it converts the selected parts into a new separate Group and physically detaches them from the live parametric model — it "breaks" the module. The Ukrainian tutorial source's own recommended workaround is to run it only on a duplicated scene or model copy, never on the production file; the same presenter reports not using ABF's exploded view for real documentation at all, building working drawings in SketchUp LayOut instead. A separate SketchUp-forum thread of experienced furniture designers independently confirms the community treats ABF as unsuitable for true dimensioned working drawings for this reason. See [drawings and exploded views](../04-production-output/04-drawings-and-exploded-views.md).

**Requirements detail:**

| Sub-requirement | Detail |
|---|---|
| R6.1 | Exploded/working-drawing view generation reads from the parametric model and writes only to the drawing document (`.zidw`) or a view-state overlay — it never edits, re-parents, or converts the source `PartDocument`/`.ziasm`. |
| R6.2 | Regenerating a drawing after the source model changes (live regen) must be idempotent and non-destructive — running it twice produces the same drawing state, and the source model is bit-for-bit unchanged before/after. |
| R6.3 | A regression test asserts source-model checksum/hash equality before and after every drawing-generation operation, specifically for exploded/assembly views (the highest-risk case, since ABF's own flaw is exactly in this feature). |
| R6.4 | Code review checklist item: any PR touching exploded-view or drawing-projection code must show the non-mutation test passing, not just a visual screenshot. |

**Status:** `done`, verified. ZilInventor's drawing subsystem (`.zidw`) is architected as a separate, kind-typed document (`kind: 'assembly' | 'part'`) that *projects* from source models rather than editing them — this is structurally the opposite of ABF's flaw by design (view-projection pipeline with live regen, per capability inventory §9). The R6.3 non-mutation regression test now exists: `packages/app/src/drawing/__tests__/loadAssemblyForProjection.nonMutation.spec.ts` hashes source `.ziasm` bytes before/after assembly-sourced drawing projection and asserts equality, plus a second assertion that regeneration is not a no-op (drawing reflects source changes while the source itself stays untouched). Commit `3bfe9b33`. This closes the loop from "architecturally safe" to "provably safe."

**Acceptance criteria:** A test creates an assembly, generates an exploded working drawing from it, hashes the source `.ziasm`/`.zip` bytes before and after generation, and asserts equality. A second test mutates the source assembly, regenerates the drawing, and asserts the drawing reflects the change (proving regen isn't a no-op) while the source model is still unchanged by the *regeneration* itself.

---

## R7 — Traceability: cross-reference each requirement's status to the capability inventory

**Requirement.** Every requirement above (R1–R6) must carry a status tag (`done` / `partial` / `missing`) that is directly traceable to a specific section of the [capability inventory](./01-zilinventor-capability-inventory.md), not asserted from memory. This document (R1–R7) is the traceability artifact; keep it in sync as the inventory changes.

**Traceability table:**

| Req | Status | Capability inventory section | Notes |
|---|---|---|---|
| R1 — Input contract | done | §1 (Drilling/Boring), §5 (DXF Export) | `panelPreflight` wired into boring/manufacturing-DXF/nesting entry points with i18n toasts (`eac95e4d`); P10 (2026-07-03) made `split-required` reachable for imported parts and wired `isManifold` to a real kernel `ShapeAnalysis_Shell` check. |
| R2 — Machining presets | partial, in progress (P9) | §1 (Drilling/Boring), §5 (DXF Export) | Preset CRUD/XDATA/machining.csv (ZIP mode) shipped P3 (`c56e1b8f`); remaining gaps (creation-time preset apply, groove preset UI, combined-mode CSV) tracked in P9 (`docs/superpowers/plans/2026-07-03-p9-preset-coverage.md`). |
| R3 — Nesting + grain | partial | §6 (Nesting/Cut Maps), §7 (Labels) | R3.2 done — grain propagates into nest DXF (`eb13a307`); R3.4 done — per-copy `instanceIndex` matches qty-expanded labels to rotated placement (P7, `3278c6a3`/`95bd365d`); R3.3 remains open, explicit low-priority stretch (not strict parity). |
| R4 — CNC/DXF export | done, regression-locked | §5 (DXF Export) | R4.3 parse-tested (`f96e32b8`): true CIRCLE/ARC, zero polyline-approximated circles; R4.1/R4.4 shipped in P2 (2026-07-02): per-material-folder ZIP + combined single DXF, both exports, shared layer scheme. |
| R5 — Labels/reports | mostly done | §7 (Labels), §8 (BOM/Reports) | Template selection + named header presets shipped P5 (`b6edfa0c`); five-category statistics report with pricing/subtotals/grand total + linear-material cut-length breakdown shipped P4 (`05a7fac0`). Header-preset JSON portability deliberately out of scope (P5 S1). |
| R6 — Drawings non-mutation | done, verified | §9 (Drawings) | Non-mutation regression test lands (`3bfe9b33`): source `.ziasm` hash-identical before/after projection; regen proven non-no-op. |

**Status:** `done` as a process — this table was re-synced 2026-07-03 (P9 W0) against everything shipped through P8 plus the P9-in-progress R2 gap and the Cyrillic-in-PDF-exports fix (`5edc7f3c`, unrelated to any R1–R6 status here — it closed a jsPDF font-embedding gap in the packing-slip/nesting/drawing/panel-labels PDF exporters, not a requirement tracked in this table). It will go stale the moment either document changes without the other being updated; treat re-syncing this table as part of the definition of done for any future work item that changes a status above.

**Acceptance criteria:** Before closing any R1–R6 work item, the implementer updates this table's status column and, if the underlying capability materially changed, updates the corresponding capability-inventory section too. A stale traceability table (status here disagreeing with the inventory doc) is itself a bug to file.

---

## Acceptance criteria format (for future requirements)

Every requirement in this document — and any new one added later — must state acceptance criteria in this shape, so a future implementer (human or agent) can verify parity without re-deriving the requirement from prose:

1. **Setup**: the concrete test fixture (a specific panel, job, or model configuration) needed to exercise the requirement.
2. **Action**: the exact operation to run (export, nest, label-print, regenerate) — named against the real command/tool in the codebase where one already exists.
3. **Observable**: what artifact gets inspected (a DXF file's parsed entity list, a CSV's computed totals, a document hash, a rendered label image) — never "looks correct," always something a script or a diff can check.
4. **Pass/fail rule**: an unambiguous condition (e.g. "zero `LWPOLYLINE` entities among hole geometry," "source model hash unchanged," "grand total equals hand-summed section subtotals").

This mirrors the evidence-grading discipline already used elsewhere in this codebase: a claim of "matches ABF" is only as good as the typed, re-runnable check backing it — narrative confidence ("it looks right") does not close out a requirement.
