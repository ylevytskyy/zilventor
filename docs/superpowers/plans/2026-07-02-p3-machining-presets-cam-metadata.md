# P3 — Machining presets + CAM metadata (R2)

Parent plan: `docs/superpowers/plans/2026-07-02-abf-parity-milestones.md` (P3). ADR: `docs/adr/0001-machining-presets-global-with-snapshot.md` (move to **Accepted** when this ships). Decision **D2**: CAM metadata = DXF XDATA + sidecar CSV.

## Requirements (docs/abf-plugin/05-parity/03-processing-parity-requirements.md R2.1–R2.4)

- **R2.1** editable dia/depth/offset + editable target DXF layer name per operation type, savable/loadable as named presets
- **R2.2** bores + grooves carry optional `toolNumber` / `speed` that flow to DXF output
- **R2.3** per-op-type named layers; layer-naming user-configurable per preset (fallback: existing `MANUFACTURING_LAYERS` scheme)
- **R2.4** presets export/import as JSON (mirror custom-hardware SKU import pattern)
- Acceptance: preset applied to bore → manufacturing DXF puts geometry on the named layer with TOOL_NUMBER/SPEED recoverable via XDATA; values survive doc reload.

## Scope decisions (made autonomously, user AFK — flagged for review)

| # | Decision | Why | Conf |
|---|----------|-----|------|
| S1 | Combined single-DXF export mode stays a **single .dxf** — XDATA only, **no CSV**. Sidecar CSV ships only in the per-material-folders ZIP mode. | P2 shipped "combined = one file" as a user-confirmed contract; zip-wrapping it would silently revert that. ZIP mode is the canonical CNC hand-off. | 70 |
| S2 | Apply-preset MVP = existing selected **bores** via BorePropertiesPanel (+ model-level fields on grooves that flow through export). Preset-prefilled creation commands (hinge/shelfpin/tandem/…) = follow-up. | Matches R2 acceptance text literally; creation-command wiring multiplies scope ~4×. | 75 |
| S3 | Manifest v34→v35 additive migration (toolNumber/speed/presetLayerName optional fields on BoreOp/GrooveFeature). | Project convention bumps even for additive no-op fields (see migrateManifest-v33-to-v34.spec.ts). | 90 |
| S4 | Presets persist app-global in `localStorage` (pattern: `useAppStore.ts:793-833` showEdgeBands et al.), NOT in the document manifest. | ADR 0001: presets describe the shop, not the model. | 90 |

## Slices (TDD each; red→green; per-package vitest)

- [x] **W1 — shared data model** `MachiningPreset` type (`opType`, dia, depth, offset, `layerName`, `toolNumber?`, `speed?`) + optional `toolNumber?/speed?/presetLayerName?` on `BoreOp` (shared/src/bore.ts:26) + `GrooveFeature` (shared/src/groove.ts:15,30); v34→v35 bump + migration + spec. Absent-not-zero optional-field contract (exactOptionalPropertyTypes).
- [x] **W5 — DXF writer XDATA** (parallel with W1): register `ZILVENTOR` APPID (dxfWriter.ts:138-141), XDATA emitter (1001/1000/1070) on entity options; existing golden-output specs stay green.
- [x] **W2 — app-global preset store**: localStorage-backed CRUD slice in useAppStore + `validateMachiningPresetImport` (mirror shared/src/hardware/customHardware.ts validation style) + JSON import/export helpers.
- [x] **W3 — preset CRUD dialog**: `MachiningPresetsDialog.tsx` (mirror HardwareDialog.tsx) + FurnitureTab ribbon entry + dialog-open store slice + i18n en/uk.
- [x] **W4 — snapshot-on-apply**: `ApplyMachiningPresetCommand` (undo-safe apply/revert; mirrors EditBoreCommand) wired into BorePropertiesPanel preset picker. Locking test: later preset edit does NOT change the already-applied BoreOp (ADR core guarantee).
- [x] **W6 — export wiring** (parallel with W4): drawBores/drawGrooves (renderPanelManufacturingDxf.ts:32,95) emit TOOL_NUMBER/SPEED XDATA + route to `presetLayerName` when set; combined renderer too; extend tests/e2e/drawing/manufacturing-dxf.spec.ts (no new e2e file — P2 precedent).
- [x] **W7 — sidecar CSV**: `buildManufacturingCsv` (partName, opType, dia, depth, layer, toolNumber, speed) added to zip entries in ExportPanelManufacturingDxfCommand.ts:40 — **folders mode only** (S1).

Dispatch order: {W1, W5} → W2 → W3 → {W4, W6} → W7.

## Gates (all EXEC before merge)

typecheck 0 ×3 · app/shared/kernel unit baselines (3279/1369+/306) · e2e 230/230 + new cases (fresh dev server; stragglers `--workers=1`) · ADR 0001 → Accepted.

## Known risks

- dxfWriter golden tests may assert exact APPID-table row counts → W5 must check before claiming green.
- No GroovePropertiesPanel exists — groove preset-apply has no UI surface in MVP (fields still flow through export if set programmatically).
