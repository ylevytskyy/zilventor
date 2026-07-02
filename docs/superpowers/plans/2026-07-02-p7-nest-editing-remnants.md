# P7 — Interactive nest editing + remnant labeling

Milestone P7 of the ABF parity plan (`2026-07-02-abf-parity-milestones.md`). Decisions D7 (free-form move/rotate/flip w/ overlap+bounds validation; guillotine-voiding flagged not blocked; no auto re-optimize) and D8 (last-cut remnant label on sheet output only; NO persistent remnant inventory), plus the R3.4 label-grain copy-index gap from P1.

## Scope calls (S-numbered — autonomous defaults, pending user review)

| # | Call | Choice | Conf |
|---|------|--------|------|
| S1 | Where manual edits live | Persisted in-document on `activeAssembly.nest.sheets[].panels[]` via full-replace Command (GenerateNestCommand pattern); `NestSheet.manuallyEdited` flag; manifest **v37→v38** (additive: `PlacedPanel.instanceIndex`, `PlacedPanel.mirrored?`, `NestSheet.remnant?`, `NestSheet.manuallyEdited?`) | 85 |
| S2 | Move interaction | Click-to-select + keyboard/button nudge (1mm, 10mm w/ Shift) — testable without drag simulation; not raw pointer-drag | 65 |
| S3 | Remnant semantics | Single largest leftover guillotine free-rect per sheet; ≥100×100 mm usability floor, else omitted | 60 |
| S4 | Flip semantics | **Cosmetic-only** `mirrored?: boolean` marker (PlacedPanel is an undirected rect — geometric flip ≡ rotate). Visible in editor UI; no effect on DXF/PDF geometry or grain | **45 — review** |
| S5 | Editor test bar | Unit + RTL component tests only, no new e2e (P6 two-pick precedent) | 65 |

## Slices (red → green)

- [ ] **W1 — shared schema + manifest v38** (sequential gate): `PlacedPanel.instanceIndex` (1-based per rowKey, assigned pre-sort in `packGuillotine`), `PlacedPanel.mirrored?`, `NestSheet.remnant?` (largest final free-rect ≥100×100mm), `NestSheet.manuallyEdited?`; CURRENT_FORMAT_VERSION 37→38 no-op migration + normalizeKind + fixture sweep (shared-package only — app has zero hardcoded version literals).
- [ ] **W2 — R3.4 label grain fix** (∥ after W1): `buildPanelLabels(result, nest?)` matches label copy → `PlacedPanel` by `rowKey + instanceIndex`; `PanelLabel.rotated`; `renderLabelsPdf` computes effective grain like `renderNestSheetDxf.drawGrain`; `ExportPanelLabelsCommand` + FurnitureTab thread `nest` through. No-nest path byte-identical (regression guard).
- [ ] **W3 — remnant on sheet outputs** (∥ after W1): `MANUFACTURING_LAYERS.remnant = 'REMNANT'`; dashed/labeled remnant rect + ASCII `REMNANT LxW` text in `renderNestSheetDxf` (+ combined), `renderNestPdf`, `renderNestSheetPng`; layer emitted only when a remnant exists.
- [ ] **W4 — interactive editor + i18n** (∥ after W1): `SheetSvg` editable mode (select/highlight, remnant rect, manuallyEdited warning badge); `NestingTab` edit toggle + rotate/flip/nudge toolbar; NEW `EditPlacedPanelCommand` (bounds + AABB-overlap validation, reject = no mutation; apply sets `manuallyEdited`; snapshot/revert per GenerateNestCommand); i18n en/uk (sole owner of locale files).

Edits survive re-export by construction (S1): all exporters read `nest.sheets` live.

## Gate

tsc 0 across packages · per-package unit suites green (shared/app/kernel) · e2e `pnpm test:e2e` fresh-server baseline (deliberate new-entity assertions fixed in tests, not product) · evidence EXEC. Then `--no-ff` merge to local master + memory update.

## Out of scope (explicit)

Persistent remnant-stock inventory; auto re-optimize after edits; cross-sheet panel moves; free-angle rotation (90° only); drag-gesture pointer editing (S2); CAM-native formats.
