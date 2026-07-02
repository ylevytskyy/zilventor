# P8 — Production reconciliation (in-app QR) — slice plan

Parent: `2026-07-02-abf-parity-milestones.md` (P8, LAST milestone). Decision D5 confirmed: camera scan via BarcodeDetector API + library fallback + manual code entry.

Goal: job-progress view over the existing label QR payload (`Z|item|copy/qty|LxWxT|material`, built in `buildPanelLabels.ts`); scan or manual entry → mark copy produced (persisted, undoable); packing-slip PDF (produced/remaining per cut-list row).

## Slices (red → green; disjoint file ownership)

- [x] **W1 (blocking, first)** — DONE commit `4507ecec`; shared 1450 ✓ (+11), tsc 0. — shared: `AssemblyDocument.producedPanels?: Record<string, boolean>` (absent-not-empty), `CURRENT_FORMAT_VERSION` 38→39 + additive migration + `normalizeKind` version list + `.toBe(38)` fixture sweep (~33 shared spec files), `parseQrPayload`/`producedPanelKey` in new `packages/shared/src/production/qrPayload.ts`.
- [x] **W2 (parallel)** — DONE commit `938f7658`; 5 tests ✓, tsc 0. — app: `SetProducedCommand` mirroring `SetUnitPriceCommand` revert contract (absent-map/absent-key/prior-value; undo restores field ABSENCE), invoked via `bus.execute` (undo-stack-wired, unlike SetUnitPrice's bare-apply gap).
- [x] **W3 (parallel)** — DONE commit `29cb9234`; jsQR 1.4.0 (CJS → vite optimizeDeps.include), 4 tests ✓, tsc 0. CAVEAT: BarcodeDetector + live-camera paths written-but-unverified in a real browser (jsdom can't drive them) — needs one manual mobile smoke test. — app: `packages/app/src/production/` scan module — pure `decodeQrFromImageData` (unit-tested via encode-with-`qrMatrix`→rasterize→decode round-trip) + `QrScanButton` (BarcodeDetector feature-detect → getUserMedia+canvas polling fallback via decode lib; inert, non-throwing when `navigator.mediaDevices` undefined). New decode dep (likely jsQR — worker verifies via Context7); check vite optimizeDeps need.
- [x] **W4 (parallel)** — DONE commit `2416ad59`; 7 tests ✓, tsc 0. PackingSlipRow includes dims+material. — app: packing slip — pure `buildPackingSlipRows(cutListResult, producedPanels)` + `renderPackingSlipPdfBytes` + `ExportPackingSlipPdfCommand`, mirroring `renderNestPdf.ts`/`ExportNestPdfCommand.ts` (incl. `__zilventorPackingSlipPdfBytes` e2e hook).
- [x] **W5 (last, integration)** — DONE; app 3504 ✓ (+7 ProductionTab tests), tsc 0, e2e production-manual-entry 1/1 + panel-labels 1/1 on fresh server (EXEC). S5 implemented as full-payload equality (`raw === match.qrPayload`). — app: Production tab (5th bottom tab; mutual exclusion across Open*TabCommands + BrowserPane), `ProductionTab.tsx` reusing `buildPanelLabels` for copy expansion, manual-entry + `QrScanButton` sharing one match handler, packing-slip ribbon button, i18n en/uk (sole owner), component tests + Playwright e2e on the manual-entry path (camera not driveable in CI).

## Gate (before merge)

typecheck 0 (5 pkgs) · per-package unit suites green (baseline: shared 1439 / app 3477 / kernel 306) · e2e: fresh dev server, parallel run, judge against known flaky list; new-entry count assertions fixed in tests not product. Evidence graded EXEC.

## Scope calls (user AFK — proceeded on recommendation, review later)

- **S1** (conf 80): single bidirectional `SetProducedCommand` (produced: boolean) instead of one-directional mark-only — usable UI needs unmark for mis-scans; mirrors SetUnitPriceCommand.
- **S2** (conf 85): produced-state key = `itemNumber:copyIndex` — same identity semantics the label PDF already relies on. Known limitation (pre-existing): renumbering/re-adding parts can shift copy identity between runs.
- **S3** (conf 65): jsQR (or equivalent smallest pure-JS decoder) as BarcodeDetector fallback; worker verifies current API/maintenance via Context7 before adding the dep.
- **S4** (conf 75): packing-slip PDF inherits the codebase-wide jsPDF no-Cyrillic gap (uk text garbles) — mirrors status quo of ALL existing PDF exports; fixing fonts is its own follow-up, not smuggled into P8.
- **S5** (conf 70): scan/manual-entry match requires FULL-field check — itemNumber+copyIndex AND L×W×T+material equality against the matched label; mismatch shows "code doesn't match this document" instead of silently marking. Guards wrong-document scans (orchestrator addition beyond builder brief).
- **S6** (conf 85): Production surface = 5th entry in the existing bottom tab-strip (Bom/CutList/Nesting/Statistics pattern from P4/P7), not a modal or ribbon tab.

## Out of scope

Persistent cross-session production journal/history; multi-user sync; camera e2e automation; Cyrillic PDF fonts (S4); re-print labels from Production tab.
