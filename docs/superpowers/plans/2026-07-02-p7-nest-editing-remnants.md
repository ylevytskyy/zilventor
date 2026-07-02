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

- [x] **W1 — shared schema + manifest v38** — DONE `95bd365d`: `PlacedPanel.instanceIndex` (1-based per rowKey, assigned pre-sort in `packGuillotine`), `PlacedPanel.mirrored?`, `NestSheet.remnant?` (largest free-rect with BOTH dims ≥100mm — amended from area-only after worker self-critique caught the sliver hole, locking tests red-first), `NestSheet.manuallyEdited?`; v37→v38 no-op migration + fixture sweep. Shared 1439 ✓.
- [x] **W2 — R3.4 label grain fix** — DONE `3278c6a3`: `buildPanelLabels(result, nest?)` matches copy → placement by `rowKey + instanceIndex`; `PanelLabel.rotated`; effective grain in label diagram (worker correctly guarded `grain='none'` instead of copying the DXF ternary verbatim — literal copy would draw a phantom arrow on rotated no-grain panels); nest threaded via `ExportPanelLabelsCommand` + FurnitureTab. No-nest path regression-guarded.
- [x] **W3 — remnant on sheet outputs** — DONE `4c543677`: conditional `REMNANT` DXF layer + ASCII `REMNANT LxW` text; dashed red rect + `×` label in nest PDF (`setLineDashPattern`) and PNG (`setLineDash`). No-remnant sheets emit no layer/entities.
- [x] **W4 — interactive editor + i18n** — DONE `3af32c69`: `SheetSvg` editable mode (select/highlight, on-screen remnant, manuallyEdited warning badge, mirrored marker); `NestingTab` tab-level edit toggle + rotate/flip/nudge toolbar (1mm / 10mm+Shift); `EditPlacedPanelCommand` (bounds + AABB-overlap, `EditRejectedError`, reject = zero mutation; sets `manuallyEdited`; undo restores mirrored-key ABSENCE); 17 i18n keys en/uk, parity test green.

## Gate results (2026-07-02, EXEC)

typecheck 0 × 5 pkgs · shared 1439 · kernel 306 unit + 372/373 integration (1 expected skip) · app 3477 · e2e 226/231 parallel, all 5 failures on the pre-existing flaky-parallel watchlist (drag-gizmo, auto-regen, T-6-20-autosave, pbr-textures-panel ×2) and 6/6 green solo `--workers=1`. No stale assertions broken by REMNANT output; no P7 regressions. Merged `--no-ff` to local master.

Edits survive re-export by construction (S1): all exporters read `nest.sheets` live.

## Gate

tsc 0 across packages · per-package unit suites green (shared/app/kernel) · e2e `pnpm test:e2e` fresh-server baseline (deliberate new-entity assertions fixed in tests, not product) · evidence EXEC. Then `--no-ff` merge to local master + memory update.

## Out of scope (explicit)

Persistent remnant-stock inventory; auto re-optimize after edits; cross-sheet panel moves; free-angle rotation (90° only); drag-gesture pointer editing (S2); CAM-native formats.
