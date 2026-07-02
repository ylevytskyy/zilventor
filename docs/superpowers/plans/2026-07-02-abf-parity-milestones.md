# ABF Parity — Milestone Plan

Goal: close every confirmed "behind" gap from [docs/abf-plugin/05-parity/02-gap-analysis.md](../../abf-plugin/05-parity/02-gap-analysis.md) so ZilInventor processes models/drawings the same way ABF does. Requirements source: [03-processing-parity-requirements.md](../../abf-plugin/05-parity/03-processing-parity-requirements.md) (R1–R7). Areas where ZilInventor is already ahead (nesting core, drawings, embedded bore positions in DXF) are explicitly out of scope — do not re-architect them to match ABF.

Per lazy-planning rule (§5b): only the active milestone gets a task breakdown. Amend this doc when execution exposes a flaw; tick milestones as they merge.

## Decision log (from grill session 2026-07-02)

User-confirmed: scope = all 8 behind gaps; QR reconciliation built **in-app**, not as hosted web apps.

Assumed defaults (user was AFK — each overridable; confidence per §1b):

| # | Decision | Pick | Confidence |
|---|---|---|---|
| D1 | Preset storage | App-global library + snapshot-on-apply ([ADR-0001](../../adr/0001-machining-presets-global-with-snapshot.md)) | 75 |
| D2 | CAM metadata in DXF | XDATA on entities **plus** a human-readable sidecar CSV in the export zip | 70 |
| D3 | Statistics export format | True `.xlsx` (multi-sheet, one per category) via SheetJS/exceljs, keeping existing CSV | 65 |
| D4 | Unit-price storage | Per-document price map keyed by material/SKU, with optional app-global default price book | 65 |
| D5 | QR scan input | Camera via BarcodeDetector API (library fallback) + manual code entry | 70 |
| D6 | Mortise/tenon scope | Parametric feature: rectangular tenon(s) on a panel edge + auto-matching mortise on the mating panel (width, depth, count, spacing, fit clearance) — mirrors carcass-bore pairing pattern | 70 |
| D7 | Nest editing semantics | Free-form move/rotate/flip with overlap/bounds validation; may void guillotine property (flagged, not blocked); no auto re-optimize — matches ABF MORO | 75 |
| D8 | Remnant scope | Last-cut trim line + labeled remnant on sheet output only; **no** persistent remnant-stock inventory (ABF parity, nothing more) | 80 |
| D9 | Milestone order | Value-first: guardrails → CNC handoff completeness → pricing → cosmetics → new features | 70 |

## Milestones

- [x] **P1 — Guardrails & verification quick wins** (R6, R1, R3-verify, R4.3) — done, see P1 tasks below
- [x] **P2 — DXF export modes** (R4.1, R4.4) — done 2026-07-02, plan `2026-07-02-p2-dxf-export-modes.md`: both CNC exports, per-material-folder ZIP + combined single DXF (grid layout is ZilInventor's own choice — ABF's combined layout is undocumented), session ribbon toggle
- [x] **P3 — Machining presets + CAM metadata** (R2) — DONE 2026-07-02 (docs/superpowers/plans/2026-07-02-p3-machining-presets-cam-metadata.md): app-global preset CRUD UI for every operation type (editable dia/depth/offset + DXF layer name + toolNumber + speed), snapshot-on-apply, JSON preset import/export, XDATA + sidecar CSV in manufacturing DXF
- [ ] **P4 — Statistics & cost report** (R5.3–R5.5): five-category report incl. linear-material cut-piece breakdown, per-line unit price → section subtotals → grand total (quote), xlsx + CSV export
- [ ] **P5 — Label templates + header presets** (R5.1, R5.2): template selector (current rich label + a compact/QR variant minimum), header free-text lines savable as named presets surviving reload
- [ ] **P6 — Mortise/tenon joinery**: regenerable TenonMortiseFeature per D6, suppression-aware, in BOM/DXF like grooves
- [ ] **P7 — Interactive nest editing + remnant labeling**: MORO-style manual placement editor per D7, last-cut remnant label per D8, edits survive re-export (DXF/PDF/labels reflect overrides)
- [ ] **P8 — Production reconciliation (in-app)**: job progress view consuming existing QR payload (`Z|item|copy/qty|LxWxT|material`), scan/enter → mark produced → packing-slip PDF

Ordering rationale (D9): P1 is cheap and converts three "done — verify explicitly / unconfirmed" statuses into proven ones before new code lands on top. P2+P3 complete the CNC hand-off — the core of "process models the same way ABF does." P4 is the biggest business-value gap (cost/quote is entirely absent today). P5 is cosmetic. P6 is the only kernel-level feature (heaviest risk, self-contained). P7–P8 are new UI surfaces, valuable but not blocking CNC parity.

## P1 tasks (red → green)

1. **R6 non-mutation regression test** — hash source `.ziasm`/part bytes before/after drawing generation (assembly-sourced view = highest-risk path); second test proves regen isn't a no-op (mutate source → drawing reflects change, source untouched by regen). Red must fail via a deliberately-broken fixture, not import errors. **DONE** — `packages/app/src/drawing/__tests__/loadAssemblyForProjection.nonMutation.spec.ts`; commit `3bfe9b33`.
2. **R4.3 arc-fidelity assertion** — automated parser test over per-panel manufacturing DXF (M2.1) and nest DXF (M2.2): every hole/curved feature is `CIRCLE`/`ARC`, zero polyline-approximated circles. Expected green already (codec writes true CIRCLE) — the test locks it. **DONE** — commit `f96e32b8`.
3. **R3 grain-propagation check** — test nesting one grain-marked panel at 0° and 90°: label PDF grain arrow and nest DXF grain annotation differ by exactly the rotation. Code-inspect first (`renderNestSheetDxf.ts`, M2.3 label diagram); fix whatever fails, add `GRAIN` annotation to nest DXF if absent. **R3.2 DONE** — `PlacedPanel` carries grain, `packGuillotine` propagates it, `renderNestSheetDxf` draws a `GRAIN`-layer arrow flipped 90° on rotated placements; commit `eb13a307`. **R3.4 still open** — neither `CutListRow` nor `PlacedPanel` carries a per-copy instance index, so a qty-expanded label can't be matched to its specific placed (possibly rotated) instance; label grain arrow still reflects modeling-time orientation. Candidate for P7 or its own slice.
4. **R1 pre-flight check** — extract a named `panelPreflight(part)` (single closed manifold solid, name present, material present) returning typed pass / split-required / fail-with-reason; wire into boring, nesting, manufacturing-DXF entry points; i18n en/uk for the diagnostics. Acceptance = R1's three-fixture criteria (parametric part / multi-solid STEP / non-manifold solid) + missing-name/material cases. **DONE** — commit `eac95e4d`. Two caveats: (a) split-required path unreachable in practice — call sites pass `solidCount: 1` since parametric parts are single-solid by construction and STEP imports don't carry a `PanelFeature`; (b) `isManifold` is a caller-supplied extension point, not wired to a live geometry check.
5. **Traceability sync (R7)** — update status tags in `03-processing-parity-requirements.md` for everything P1 proved or changed. **DONE** — this sync.

Verification gate per project rules: tsc 0, lint 0, unit+e2e green, evidence graded EXEC before ticking.

## Out of scope (explicit)

- Re-architecting `packGuillotine` toward ABF's weaker nesting; CAM-native formats (MPR/XNC/CIX — still deferred pending sample files); persistent remnant inventory; hosted/standalone web apps; R3.3 hard grain-lock constraint (stretch item, low priority per requirements doc).
