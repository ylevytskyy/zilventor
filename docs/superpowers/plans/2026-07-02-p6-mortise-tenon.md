# P6 — Mortise/tenon joinery (D6)

Branch: `feat/p6-mortise-tenon`. Parent plan: `2026-07-02-abf-parity-milestones.md` (P6). The only kernel-level milestone of the ABF parity program.

## Requirement

D6 (user-confirmed): "Parametric feature: rectangular tenon(s) on a panel edge + auto-matching mortise on the mating panel (width, depth, count, spacing, fit clearance) — mirrors carcass-bore pairing pattern." Milestone line: "regenerable TenonMortiseFeature per D6, suppression-aware, in BOM/DXF like grooves."

## Design

- One feature kind `'tenonMortise'` with `role: 'tenon' | 'mortise'` discriminant + `pairId` linking the two sides (mirrors `BoreOp.role`). Spec: `faceRole`, `axis: 'u'|'v'`, `position`, `width`, `depth`, `count`, `spacing`, `fitClearance`, optional `label` + CAM fields (`toolNumber`/`speed`/`presetLayerName`, mirrors GrooveSpec).
- **Tenon = boolean FUSE** of N full-thickness box tabs (`fuseShapes`, existing kernel primitive); **mortise = boolean CUT** of N pockets enlarged by `fitClearance`. `PanelFeature.outline` cannot be retroactively extended by later tree features (verified: consumed only at panel creation in FeatureTree) — fuse is the correct mechanism. Math in `tenonMortiseMath.ts` mirrors `grooveMath.ts`/`buildGrooveCutter` face2DFrame math.
- Pairing mirrors `AddManualJointBoresCommand`: user picks two panels, `inferManualJoint` decides END-presenting panel (tenon host) vs FACE-presenting panel (mortise host); `generateTenonMortisePair(joint, params)` computes the mortise's correctly-mapped face/axis/position (per-face u/v mapping à la `endFaceUsesZforU`/`crossCoord` — NOT a 1:1 value transfer). **Pinned contract: `id`s and `pairId` are caller-supplied params** (deterministic, testable; avoids W1/W3 API mismatch).
- Suppression: free via kind-agnostic `suppressedFeatureIds`; one kernel test asserts a suppressed tenonMortise id is skipped.
- BOM/DXF/CSV mirrors groove plumbing file-for-file: `MANUFACTURING_LAYERS.tenons`/`.mortises`, `PanelManufacturingInput.tenonMortises`, `tenonMortiseRects` (N discrete rects), `drawTenonMortises`, CSV `opType:'tenon'|'mortise'` rows, `machiningSignature` fold, `partTenonMortisesCacheRef` end-to-end.
- `AddTenonMortiseCommand`: appends features to featureTree on BOTH files; revert via prior full-manifest bytes per file. UI: `TenonMortiseDialog` (mirrors GrooveDialog + 3 fields) + two chained `beginOneComponentPick` calls in FurnitureTab.
- Manifest **v36→v37**, no-op migration (new `MachiningPreset.opType` values `'tenon'/'mortise'`, faceFrame v25→v26 precedent) + normalizeKind list + fixture sweep.

## Scope calls (user AFK — proceeding on context-builder recommendation; veto = revisit)

- **S1**: ONE feature kind with `role` discriminant (not two kinds). Conf 65.
- **S2**: Tenon = full-panel-thickness tabs (finger/box-joint style); D6's param list has no tenon-thickness field, so a shouldered tenon isn't representable without an unconfirmed 6th param. Conf 70.
- **S3**: "Auto-matching" = manual tenon params, auto-derived mortise face/position/axis. NOT full auto-layout along the joint line (stretch, later). Conf 65.
- **S4**: Manifest bump 36→37 with no-op migration, adding tenon/mortise to `MachiningPreset.opType`. Conf 70.
- **S5**: Two-panel pick UI = chain two one-shot `beginOneComponentPick` calls (no existing two-pick primitive; `AddManualJointBoresCommand` has no UI today). Conf 75.
- **S6**: Ukrainian terms — W5 picks standard carpentry terms (шип/гніздо or шип/паз), FLAGGED for user confirmation, not silently buried. Conf 50 — **user should weigh in**.
- **S7** (orchestrator): `generateTenonMortisePair` takes caller-supplied `id`/`pairId` params.

## Slices

- [x] **W1 — shared types + math + pairing**: `TenonMortiseFeature`, `tenonMortiseMath.ts`, `generateTenonMortisePair` w/ per-face mapping. Lands first. 16/16 specs; second pass REQUIRED+done: mortise cross-axis bounded via `crossPosition`/`crossSpan` from `crossCoord` + mating thickness (first pass produced a through-dado).
- [x] **W2 — kernel FeatureTree branch** for `kind:'tenonMortise'` (fuse tabs / cut pockets), suppression test, position-asserting integration tests. (Parallel after W1.) 8/8 integration incl. Phase-0 verify + through-dado guard.
- [x] **W3 — AddTenonMortiseCommand** two-file append + revert restores prior manifests. (Parallel after W1.) 6/6 specs; byte-identical revert both files.
- [x] **W4 — BOM/DXF/CSV/cache plumbing** + manifest v37 bump + migration + fixture sweep (bump landed in W1). (Parallel after W1.) 52/52 specs; `tenonMortiseRects` covers all 6 face roles (deliberate extension beyond grooveRect).
- [x] **W5 — UI dialog + ribbon + chained picks + i18n en/uk** (sole i18n owner, lands last). 9/9 specs; no-joint toast via featureTree-length diff; UA terms Шип/Гніздо (S6 — pending user confirmation).

Full worker briefs: context-builder output (session scratchpad `p6-context.md`); orientation map §1, design §2 therein.

## Gate (before `--no-ff` merge to local master)

typecheck 0 ×5 · app/shared/kernel unit suites at baseline+new (app 3408 / shared 1414 / kernel 306 at P5) · fresh-server e2e; deliberate new ribbon/dialog/layer/CSV entries may break "exactly N"-style assertions — fix tests, not product · Phase-0 verify tests mandatory in kernel slice (M4-E lesson) · positions asserted, not counts (M4-B lesson).

**Gate results (2026-07-02, EXEC): READY after one debug-loop.** typecheck 0 ×5 · shared 1430 / app 3439 / kernel 306 unit + 372(+8 new) integration · manifest 37 + migration-from-36 verified · i18n 12/12 keys both locales. First gate NOT-READY: `step-full-model-on-open.spec.ts` failed 4/5 branch vs 0/4 master. Debug-loop root cause: PRE-EXISTING App.tsx race — re-execute effect's unconditional success-path `setStatus('')` clobbers the `'Imported'` status set by file open; P6's heavier load flipped the race winner. Fixed `dfa5095a` (`lastExecuteErrorRef` gating + deterministic 500ms settle in spec); post-fix 6/6 incl. under CPU contention + full parallel suite. Re-gate: 224/231 parallel, all 7 failures pass solo (load flakes; newly observed: material-hatch-pattern, pbr-textures-panel, m4-leg-levelers — add to flaky watchlist).
