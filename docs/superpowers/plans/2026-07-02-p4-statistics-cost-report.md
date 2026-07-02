# P4 — Statistics & cost report (xlsx + CSV)

**Branch:** `feat/p4-cost-report` · **Parent plan:** `2026-07-02-abf-parity-milestones.md` (P4, R5.3–R5.5, decisions D3/D4)

## Requirements (verbatim from docs/abf-plugin/05-parity/03-processing-parity-requirements.md)

- **R5.3** — BOM/report output organized into five sections matching ABF: hardware/fittings, joints/connectors, edge-band tape length, linear-material cut-length breakdown, panel/sheet data.
- **R5.4** — Each report line supports a user-entered unit price, auto-computed section totals + grand total, exportable in the existing CSV path (Excel-compatible).
- **R5.5** — Linear-material items report as individual cut-piece lengths ("3 rods: 1×958mm, 2×466mm"), not just a running total.
- **D3** — True `.xlsx` (multi-sheet, one per category) + keep CSV. **D4** — per-document price map + optional app-global default price book.

## Controller scope calls (user AFK — proceeded on recommendation, review welcome)

- **S1** (conf 65): Linear materials modeled as `MaterialEntry.kind?: 'sheet' | 'linear'` (absent = sheet); linear-flagged panels partition out of the panel/sheet category into the cut-piece breakdown, reusing existing CutListRow grouping. No new kernel feature. Alternative (dedicated LinearMaterialFeature) rejected as heavy/irreversible.
- **S2** (conf 70): `exceljs` (not SheetJS) for xlsx — MIT, native multi-sheet, avoids SheetJS npm-registry friction. Bundle weight acceptable for a wasm-heavy CAD app.
- **S3** (conf 75): New top-level Statistics tab, sibling of BOM/CutList/Nesting (`statisticsTabActive` pattern).
- **S4** (conf 70): `buildStatisticsReport` stays pure/i18n-free; the UI hook resolves connector nameKeys via `t()` so exports receive human-readable labels.
- Price-key convention: `material:<id>` · `hardware:<skuId>` · `connector:<kind>` · `edgeband:<materialId>` · `linear:<materialId>`; effective price = `doc.unitPrices[key] ?? defaultPriceBook[key]`; unpriced lines contribute 0 and are counted in `unpricedLineCount`.

## Slices

- [x] **W1** — Data model: `MaterialEntry.kind`, `AssemblyDocument.unitPrices?`, `defaultPriceBook` store slice (localStorage), manifest v35→v36 + fixture sweep.
- [x] **W2** — `partitionLinearMaterial(rows, materials)` pure fn in `packages/shared/src/linearMaterial.ts` (panelRows + per-material piece breakdowns, desc length order).
- [x] **W3** — `buildStatisticsReport(...)` pure builder: five sections, per-line effective price, section subtotals, grand total, unpricedLineCount. `packages/app/src/commands/buildStatisticsReport.ts`.
- [x] **W4** (∥ W5) — Exports: `buildStatisticsCsv` (multi-section, buildCutListCsv pattern) + `buildStatisticsXlsx` (exceljs, sheet per category + Summary) + export commands (ExportBomCsvCommand save pattern); xlsx test = round-trip re-parse via exceljs; dev-server smoke for optimizeDeps gotcha.
- [x] **W5** (∥ W4) — UI: `StatisticsReportTable`, `useStatisticsReport` hook, `OpenStatisticsReportTabCommand`, `SetUnitPriceCommand` (undo restores field ABSENCE), ribbon panel, i18n en/uk (i18n files owned by W5 only).

Order: W1 → W2 → W3 → (W4 ∥ W5, disjoint files). **ALL DONE 2026-07-02; gate MERGE-READY (typecheck 0×5, units 1414/306/3376, e2e 224+7-serial green).** Gate before merge: typecheck 0, per-package vitest green, e2e green (fresh dev server), then `--no-ff` to local master.

## Known follow-ups / risks

- Linear-material design (S1) is inferred, not user-confirmed — flag at milestone summary.
- New export entries may break "exactly N entries" e2e assertions — fix tests, not product.
- exceljs may need `optimizeDeps.include` (qrcode precedent) — verify empirically.
