# P15 — Small ABF-parity close-outs (CSV tabs · hinge presets · label-preset import/export)

**Status:** planned 2026-07-03 · branch `feat/p15-parity-closeouts`
**Source:** 2026-07-03 parity audit items #4, #5, #7 — three S-sized gaps batched into one
cycle with three parallel workers on disjoint files.

## Goals (verifiable)

- **A — CSV per-tab rows:** `buildManufacturingCsv` emits one row per PHYSICAL tenon/mortise
  tab (count=3 → 3 rows), matching the DXF renderer which already draws one polyline per tab.
  Verified: feature carries a literal `count` (P11 resolves auto-layout to count/spacing on ONE
  feature, it does not explode), DXF `tenonMortiseRects` returns N rects, CSV loop pushes 1 row.
- **B — hinge creation presets:** AddDoorDialog gains two machining-preset dropdowns
  (hingeCup, hingePlate — both already first-class `MachiningPreset.opType` values); selected
  preset values snapshot onto the cup/plate bores AddDoorCommand creates, mirroring the P9
  shelf-pin/leg-leveler pattern (per-command `withPresetValues` helper, conditional spreads).
- **C — label-header-preset JSON import/export:** LabelHeaderPresetsDialog gains Import/Export
  mirroring MachiningPresetsDialog (pickFile/saveBlob from fsaFallback, atomic
  validate-then-merge, id-collision rejection); validate/serialize live app-local next to the
  LabelHeaderPreset type (it is not a shared type).

## Decisions / scope calls (autonomous, for user ratification)

- **S1 (B):** Target corrected from the audit's HardwareDialog to AddDoorDialog/AddDoorCommand —
  code trace shows HardwareDialog's hinges category creates ZERO bores (AddHardwareCommand only
  places a component); the hinge-cup/plate bores are created at door-creation time. (conf 85)
- **S2 (A):** Per-tab representation = duplicated identical rows (no new position column) — no
  other opType has a position column; header contract unchanged.
- **S3 (B):** Two separate dropdowns (cup/plate) filtered by opType; reuse existing
  `bore.machining_preset` + `common.none` keys — no new i18n for B.
- **S4 (C):** New i18n keys only under `dialog.labelHeaderPresets.import/export.*`, en+uk, owned
  exclusively by worker C.

## Ownership (disjoint)

- W-A: drawing/manufacturingCsv.ts + its spec.
- W-B: AddDoorDialog.tsx, AddDoorCommand.ts, FurnitureTab.tsx + specs. NO i18n edits.
- W-C: LabelHeaderPresetsDialog.tsx, store/labelHeaderPreset.ts, useAppStore.ts, en.json,
  uk.json + specs.

## Risks

- B: whether shaker/framed doors get cup bores is unverified (plate bores explicitly skipped) —
  worker must verify and not regress the skip.
- B: if a distinct cup-vs-plate label proves necessary for a11y, worker stops and reports
  (key would be handed to W-C or a follow-up) rather than editing locale files.
