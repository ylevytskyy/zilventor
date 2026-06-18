# ZilInventor — Furniture MVP Implementation Plan

**Date:** 2026-06-18
**Target market:** Production panel/cabinet shop (kitchens, wardrobes, CNC-driven, Система-32).
**CNC format priority:** Biesse CIX first.
**Source gap report:** `docs/2026-06-18-inventor-2012-furniture-mvp-gap-report.md`
**Method:** Fan-out — 6 gap analysts → 5 blocker verifiers → 5 milestone planners (all Sonnet+ultrathink, self-critiqued). This document consolidates their output.

> **How to read this:** Milestones are ordered by dependency. Every code task is a red→green→refactor TDD slice and names the test it owns. `- [ ]` checkboxes track progress. **Run the Stage-0 spikes before dispatching the tasks they gate** — three planners independently flagged unknowns that could reorder work.

---

## Milestone overview

| # | Milestone | Headline deliverables | Depends on | Planner confidence |
|---|-----------|----------------------|------------|-------------------|
| **1a** | Cabinet breadth + joinery | wall/tall/corner cabinets, dado/groove/rabbet cut, 32mm start-offset | none | 72 |
| **1b** | Production output & panel-shop fidelity | **Biesse CIX export**, kerf+oversize nesting, edge-band thickness, framed doors, hardware catalog | 1a (groove) | 72 |
| **2** | Parametric configurator | iLogic-style rule engine, iPart design-table families, feature suppression | Wave 1 | 72 |
| **3** | Shop-drawing documentation | balloon wiring + auto-balloon, live auto-regen, drawing templates, view alignment | none (parallel) | 74 |
| **4** | Interop & constraint completeness | DWG/SKP feasibility + proxy, tangent/coaxial + sketch constraints, unified BOM | none (parallel) | 72 |

**Sequencing.** 1a → 1b is a hard chain (framed doors reuse the groove cut). Milestone 2 wants Wave 1 done first (variants worth configuring). **Milestones 3 and 4 are independent and can run in parallel from day one** — good candidates to start immediately alongside 1a.

---

## Stage 0 — Pre-flight spikes — ✅ ALL RESOLVED (2026-06-18)

All six de-risking spikes ran (parallel Sonnet+ultrathink, confidence 88–96). **Net result: scope reduced — every major risk shrank or evaporated.** Verdicts below are now inputs to the gated tasks.

- [x] **S1 — Groove cutter injection → YES, no extra step (conf 93).** `cutShapes` (`BooleanOps.ts:101`) takes raw `OcctShape` (`{__brand,handle}`) wrappers — no FeatureTree registration. The exact `MakeBox_4(p1,p2)→wrap→cutShapes` pattern is already in production in the FeatureTree `hardware` branch (`FeatureTree.ts:880-894`). **Action:** 1a.3.3 stays; add a small `makeBoxFromCorners` helper (the existing `SolidOps.makeBox` is origin-only). Caveat: cutter-as-operand-`b` role is structurally proven but untested in isolation; a mispositioned groove returns `booleanFailed`, not a silent no-op.
- [x] **S2 — expr-eval conditionals → ALREADY NATIVE (conf 96).** expr-eval v2.0.2 has `if(c,a,b)`, ternary `? :`, comparisons, and `and/or/not` **built in**. **Action: 2.1.1 shrinks to a one-line change** — add `'if','and','or','not'` to `WHITELIST_FNS` in `ParameterRegistry.ts` (the regex identifier-scan rejects them otherwise; ternary already passes). No library fork, no custom operators. The pure evaluator (2.1.2) just wraps `parser.evaluate`.
- [x] **S3 — Feature suppression → 100% TS-gateable, NO WASM rebuild (conf 95).** The build loop is plain TS (`FeatureTree.ts` `executeTree`, line 153 `for (const feature of part.featureTree)`); opencascade.js is vendored (no local C++ build). **Action:** insert `if (suppressedFeatureIds?.has(feature.id)) continue;` at the loop top **AND the pre-scan loop at 134-151** (else a suppressed revolve orphans its sketch). Store `suppressedFeatureIds?: string[]` on `PartDocument` (mirror existing `suppressedConnectorIds`). 2.4.2 real-OCCT bake is feasible as-is. Open product decision: cascade-suppress children, or accept the soft "sketch not found" error (MVP-acceptable).
- [x] **S4 — planegcs probe → all cheap, NO rebuild (conf 88).** point-on-line (`point_on_line_pl`), point-on-circle (`point_on_circle`), point-on-arc (`point_on_arc`) all EXIST in planegcs but are UNWIRED → one `translateConstraint` case each. Fixed/ground = cheapest (flip `fixed:true` on the point primitive, already propagated). Collinear is ABSENT but trivial: two `point_on_line_pl` (line-B endpoints onto line-A). Sketch-mirror (4.4.5) is app-side coordinate math, no solver. **Action:** 4.4.2–4.4.4 stay as cheap bindings; 4.4 gains a "collinear via two point-on-line" note. Residual risk: WASM-binary method presence assumed from TS types (throws at runtime if absent), version-drift unchecked.
- [x] **S5 — Assembly solver located (conf 95).** `packages/kernel/src/assembly/AssemblyConstraintSolver.ts` — Levenberg-Marquardt iterative solver; dispatch in `buildSingleResidual` (lines 71-90) + `buildSingleJacobianBlock` (99-124); residual math in `Residuals.ts`; ref geometry in `AssemblyConstraintRefs.ts`. `insert` is **fully solved** (7 residuals = mate-axis-axis + mate-face-face). **Action for 4.3:** add union arm → residual+Jacobian builder → `constraintResidualCount` row count → dispatch case. **coaxial ≈ `mate` axis-axis with offset=0 — may need no new kind** (confirm semantic). **tangent** needs a new residual `|N·(Pc−Pp)|−r=0` and possibly a `sphere`/`cylinder` `PartLocalGeometry` kind (non-trivial — flag).
- [x] **S6 — Cut-list recursion REACHES nested members (conf 95).** `aggregateCutListRecursive.ts:37-64` recurses unconditionally into any `.ziasm`; proven by 2-level + 3-level tests + the `AddFaceFrameCommand.cutList.spec.ts` anti-regression guard. **Action: 1b.4.2 needs NO separate prove-task.** A shaker door's members reach the cut-list automatically **provided** its `.ziasm` is in `SubAssemblyCache` and each member `.zipt` has a `PanelFeature` — confirm those two preconditions during impl (not a new task).

---

## Milestone 1a — Cabinet breadth + joinery cuts

**Goal:** Wall & tall cabinet types (cheap variants), an L-corner cabinet (new panel geometry), a parametric dado/groove/rabbet cut, and a configurable System-32 start offset.
**Depends on:** none. **Verified:** only `template:'baseCabinet'` exists (`packages/shared/src/cabinets/baseCabinet.ts`, `types.ts`); kernel already has live, tested extrude-`cut` + `cutShapes` (`BooleanOps.ts`, `FeatureTree.ts`); `shelfPinGrid.columnPositions` is the 32mm ladder (no startOffset yet).

### 1a.1 Wall & tall cabinet types
**Definition of done:** `buildCabinet({type})` discriminator; wall omits toekick + adds hanging-rail; tall uses height preset; existing base tests unchanged.
- [ ] 1a.1.1 Add `cabinetType` discriminator (default `'base'`) + `WallCabinetParams`/`TallCabinetParams` aliases; add `'hangingRail'` to `PanelRole`. — _test:_ `baseCabinet.spec.ts` still green (additive).
- [ ] 1a.1.2 Extend generator: `wall` → `tkH=0` + emit one `hangingRail` panel; `tall` → height preset, no structural change. — _test:_ `'wall cabinet emits no toekick and emits hangingRail'` (RED→GREEN); `'tall default height ≥2000'`.
- [ ] 1a.1.3 Route `CreateCabinetCommand.template` to `'wallCabinet'|'tallCabinet'`; add `CabinetDialog` type selector. — _no-TDD (UI wiring); verify §6 browser:_ Wall shows Hanging Rail, no Toekick.

### 1a.2 Corner cabinet (L-corner, slice 1)
**Definition of done:** `buildCornerCabinet` returns valid L-shaped unit (two legs, shared corner post, top/bottom/backs); `template:'cornerCabinet'` accepted. Blind/diagonal deferred.
- [ ] 1a.2.1 Define `CornerCabinetParams` (`depth1`, `depth2`, height, materials) + validation kinds. — _test:_ tsc 0-new.
- [ ] 1a.2.2 Implement `buildCornerCabinet` in `cornerCabinet.ts` (L-floor panels, corner post, two backs, all zero-rotation). — _test:_ `'emits panels including cornerPost'` (RED→GREEN); L-floor area assertion.
- [ ] 1a.2.3 Wire `template:'cornerCabinet'` + dialog `depth1`/`depth2` fields. — _verify §6:_ two-leg footprint in top-down view.
- [ ] 1a.2.4 **Guard:** `GenerateCarcassBoresCommand`/`jointMath` assumes rectangular panels — add a guard so the corner post / non-rect panels don't mis-bore. _(flagged in self-critique)_ — _test:_ corner cabinet boring produces no bores on the corner post (or correct ones), no crash.

### 1a.3 Dado / groove / rabbet cut (slice 1)
**Definition of done:** `AddGrooveCommand` cuts a parametric channel into a panel via `cutShapes`; visible in 3D; undoable.
- [ ] 1a.3.1 Define `GrooveSpec` in `shared/src/groove.ts` (faceRole, axis u|v, position, width, depth, label?). — _test:_ tsc 0-new; imports in kernel.
- [ ] 1a.3.2 Pure `buildGrooveCutter(panelDims, spec)` math in `grooveMath.ts` (MakeBox corner points, panel-local). — _test:_ `grooveMath.spec.ts` axis-u/axis-v span (RED→GREEN).
- [ ] 1a.3.3 `kernelApi.addGroove(partPath, spec)`: build → cutter box → `cutShapes` → overwrite `.zipt`. **S1 resolved:** use the `MakeBox_4(p1,p2)→wrap as `{__brand:'OcctShape',handle}`→`cutShapes`` pattern from `FeatureTree.ts:880-894`; add a `makeBoxFromCorners` helper. — _test:_ `AddGroove.integration.spec.ts` real-OCCT volume-drop (RED→GREEN).
- [ ] 1a.3.4 `AddGrooveCommand` apply/revert (revert = restore original `.zipt` bytes — **byte-snapshot must preserve pre-existing bores**, see self-critique) + minimal `GrooveDialog`. — _verify §6:_ groove visible; undo restores.

### 1a.4 System-32 configurable start offset
**Definition of done:** `columnPositions(start,end,pitch,startOffset?)` (default 0 = current); UI exposes column start offset for shelf-pin bores.
- [ ] 1a.4.1 Extend `columnPositions` with `startOffset=0`; add `startOffset?` to `ShelfPinParams`. — _test:_ `'startOffset=16 shifts first hole'` (RED→GREEN); existing tests green.
- [ ] 1a.4.2 Thread `startOffset` through `shelfPinGrid()`. — _test:_ system32-grouped integration still green + offset case.
- [ ] 1a.4.3 `columnStartOffset` field in `BorePropertiesPanel` → `UpdateShelfPinStartOffsetCommand` re-runs carcass bores. **Note cross-command side-effect:** regen clobbers manual bore edits — guard or warn. — _verify §6:_ first-hole marker shifts 16mm.

**Risks/Deferred (1a):** blind/diagonal corner; groove as named DXF/CSV note (slice 2); groove-bottom drawer; multi-panel groove in one command; per-bore (vs per-grid) startOffset.

---

## Milestone 1b — Production output & panel-shop fidelity

**Goal:** Turn the rich internal model into shop-runnable output — CNC drilling, kerf-aware nesting, banded sizes, framed doors, full hardware catalog.
**Depends on:** 1a groove (framed-door rebate). **Verified:** `BoreOp` carries face/u/v/diameter/depth/role; `aggregateBoresRecursive` groups per panel; `buildBoringCsv`/`ExportBoringCsvCommand` are the export template; `packGuillotine` already takes `kerfMm`; `EdgeBand` is a material tag only; `builtinCatalog` has hinges/pins/pulls, no slides/levelers/soft-close.

### 1b.1 Biesse CIX CNC export
**Definition of done:** "Export CIX" button downloads valid `.cix`; golden-file test + coordinate-transform test pass.
- [ ] 1b.1.1 Pure `panelFaceRoleToSide(role): 1..6` (Biesse side numbering). — _test:_ `cixSideMapping.spec.ts` 6 assertions (RED→GREEN).
- [ ] 1b.1.2 `boreToXyd(bore, thicknessMm): {XD,YD,DP}` — panel-local u/v → Biesse datum-edge; `throughAll`→thickness. — _test:_ `cixTransform.spec.ts` (Top u=50 v=30 / 18mm → XD=50 YD=30 DP=18; per-face axes; throughAll).
- [ ] 1b.1.3 `buildCixXml(result): string` — `<BoreP>` for drills, `<RouteP>` for routing. — _test:_ `buildCixXml.spec.ts` golden-fixture snapshot `__fixtures__/golden.cix` (RED→GREEN).
- [ ] 1b.1.4 `ExportCixCommand` (mirror `ExportBoringCsvCommand`, `.cix`) + FileTab button. — _no-TDD (UI); test:_ stub picker, assert bytes start `<?xml`; §6 download check.

### 1b.2 Kerf + per-panel oversize
**Definition of done:** Cut-list rows carry raw (net+oversize) sizes; nesting packs on raw sizes; UI oversize field.
- [ ] 1b.2.1 Add `oversize?:{lengthMm,widthMm}` to `CutListRow`. — _test:_ `cutListRow.spec.ts` rawLength = length+oversize (RED→GREEN).
- [ ] 1b.2.2 `packGuillotine`/`packAllMaterials` pack on `rawLength`/`rawWidth` fallback to net. — _test:_ `packGuillotine.spec.ts` two oversized parts fit-or-not with kerf=3 (RED→GREEN).
- [ ] 1b.2.3 NestingTab oversize inputs → `GenerateNestCommand` opts. — _no-TDD (UI); test:_ opts oversize appears on rows.

### 1b.3 Edge-band thickness → net/gross sizes
**Definition of done:** Banded panels emit gross sizes = net + band thicknesses; CSV gets gross columns.
- [ ] 1b.3.1 Add `thickness` to `EdgeBand` + `bandThicknessMm` to material catalog; manifest **v26→v27** migration (default 0.4mm). — _test:_ `panel-feature.spec.ts` rejects band missing thickness (RED→GREEN).
- [ ] 1b.3.2 `buildCutListRows` computes grossLength/grossWidth from applied bands. — _test:_ `cutListRow.spec.ts` 600×400 + 0.4 bands → grossLength 600.8 (RED→GREEN).
- [ ] 1b.3.3 Add gross columns to `buildCutListCsv`. — _no-TDD (snapshot); update + confirm headers.

### 1b.4 Framed door styles (shaker + raised panel)
**Definition of done:** `AddDoorCommand` `style:'slab'|'shaker'|'raisedPanel'`; shaker builds rail+stile+panel sub-assembly; raised adds groove rebate.
- [ ] 1b.4.1 Pure `framedDoorMath.computeShakerParts(...)` (rails/stiles/centerPanel). — _test:_ `framedDoorMath.spec.ts` 600×900 70mm → panel 460×760 (RED→GREEN).
- [ ] 1b.4.2 Extend `AddDoorCommand` `style`; shaker builds nested `.ziasm` (model on `buildDrawerBox`). **Gated by S6 (recursion reaches frame members).** — _test:_ `AddDoorCommand.spec.ts` shaker → ≥4 components + cut-list reaches them (RED→GREEN).
- [ ] 1b.4.3 `raisedPanel` adds groove rebate on center panel via 1a groove API. **Blocked on 1a.3** — leave failing test red-and-held. — _test:_ raised-panel center has groove feature.
- [ ] 1b.4.4 Door style selector UI. — _no-TDD; verify §6:_ shaker sub-assembly nodes appear.

### 1b.5 Hardware catalog expansion
**Definition of done:** ≥2 drawer-slide SKUs, leg-leveler, ≥2 soft-close hinges; probes updated.
- [ ] 1b.5.1 Add drawer-slide SKUs (`category:'drawerSlides'`) + exhaustiveness guard. — _test:_ `builtinCatalog.test.ts` slides count == 3 (RED→GREEN).
- [ ] 1b.5.2 Add leg-leveler + soft-close hinge SKUs. — _test:_ categories present, total ≥16 (RED→GREEN).
- [ ] 1b.5.3 Hardware-BOM aggregation includes `drawerSlides`; link to `AddDrawerBankCommand` placement math. — _test:_ `AddDrawerSlidesCommand.spec.ts` `hardwarePartCount` (RED→GREEN).

**Risks/Deferred (1b):** full CIX routing variants (pocket/profile/groove); per-material oversize; external CSV-consumer break on new columns; true profiled raised-panel (router-bit) → Wave 1c; Biesse datum convention varies by machine — confirm with shop.

---

## Milestone 2 — Parametric configurator

**Goal:** iLogic-equivalent conditional rules + iPart design-table families so a shop defines variants and parameter changes cascade.
**Depends on:** Wave 1. **Verified:** `ParameterRegistry` is arithmetic-only, per-doc, singleton; `subscribe()` is the plug-in point; `PartDocument.parameters` flat, no `configurations`; format v26.

### 2.1 Rule-expression evaluator (pure, sandboxed) — **S2 resolved: nearly free**
- [ ] 2.1.1 Add `'if','and','or','not'` to `WHITELIST_FNS` in `ParameterRegistry.ts` (expr-eval v2.0.2 already evaluates them natively + comparisons + ternary; the regex scan is the only blocker). — _test:_ `evaluateRule('if(width>600,1,0)',{width:700})===1` (RED→GREEN).
- [ ] 2.1.2 `evaluateRule(expr, snapshot)` in `shared/src/rules/ruleEvaluator.ts`. — _test:_ suite over `< > == if` nested + unknown-var reject (RED→GREEN).
- [ ] 2.1.3 Depth guard (max 5 nested `if`) → `RuleDepthError`. — _test:_ deep nest throws (RED→GREEN).

### 2.2 Rule schema + PartDocument field
- [ ] 2.2.1 Add `Rule` type `{id,trigger[],condition,thenSet[]}`. — _test:_ tsc compiles with exactOptionalPropertyTypes.
- [ ] 2.2.2 Add `rules?: Rule[]` to `PartDocument`. — _test:_ serialise round-trip preserves rules (RED→GREEN).
- [ ] 2.2.3 Migration **v26→v27** inject `rules:[]`. — _test:_ migrate v26 fixture → v27 (no-TDD for the version constant).

### 2.3 Rule engine wiring
- [ ] 2.3.1 `RuleEngine` class registers one `subscribe` listener. — _test:_ spy: `setParameter` called on trigger change (RED→GREEN).
- [ ] 2.3.2 Wire into `App.tsx` before `execute`. — _test:_ integration: width=700 fires rule, downstream param set pre-execute (RED→GREEN).
- [ ] 2.3.3 Cycle detection at load (`thenSet` param in another `trigger`) → `RuleCycleError`. — _test:_ cyclic load throws (RED→GREEN).

### 2.4 Feature-suppression kernel API — **S3 resolved: TS-only, no WASM rebuild**
- [ ] 2.4.1 Add `suppressedFeatureIds?: string[]` to `PartDocument` (mirror `suppressedConnectorIds`). — _test:_ tsc.
- [ ] 2.4.2 Guard in `FeatureTree.executeTree`: `if (suppressedFeatureIds?.has(feature.id)) continue;` at the main loop (line ~153) **AND the pre-scan loop (134-151)**; `kernelClient.suppressFeature(id,bool)` set/clear + execute. — _test:_ real-OCCT bake: suppress feature B → volume == base-only (RED→GREEN).
- [ ] 2.4.3 Extend `Rule` with `thenSuppress?`. — _test:_ tsc (no-TDD additive).
- [ ] 2.4.4 Wire suppression in `RuleEngine`. — _test:_ spy: `suppressFeature` called (RED→GREEN).

### 2.5 iPart configurations + migration
- [ ] 2.5.1 `Configuration` type `{name, values:Record<string,string>}` + `configurations?` on `PartDocument`. — _test:_ tsc (type-only).
- [ ] 2.5.2 `activateConfiguration(name)` bulk-sets params, **batched into one subscriber burst** (avoid N executes — self-critique). — _test:_ activate sets all values in one notification (RED→GREEN).
- [ ] 2.5.3 Migration **v27→v28** inject `configurations:[]`. — _test:_ migration unit.

### 2.6 Row-picker UI (ConfigurationsPanel)
- [ ] 2.6.1 `ConfigurationsPanel` renders rows, highlights active. — _test:_ RTL row render + click fires onActivate (RED→GREEN).
- [ ] 2.6.2 "Add Row" clones current snapshot. — _test:_ RTL length+1 with current values (RED→GREEN).
- [ ] 2.6.3 CSV import (header = param names) → `Configuration[]`. — _test:_ 3-row CSV → 3 configs (RED→GREEN).
- [ ] 2.6.4 Wire into Properties/Parameters panel. — _no-TDD; verify §6:_ add+activate config changes width in 3D.

**Risks/Deferred (2):** feature suppression is riskiest (may need WASM rebuild — S3); cross-document/assembly rules; rule priority/ordering; on-open/on-save triggers; CSV export of design table.

---

## Milestone 3 — Shop-drawing documentation

**Goal:** Balloon callouts, live view associativity, drawing templates, enforced view alignment.
**Depends on:** none (parallel). **Verified:** balloon type/renderer/storage/undo-command all exist & tested — only placement is dead-wired (`DrawingCanvas.tsx` `addBalloon` stub); staleness auto-detected, regen manual; no template mechanism; no move-view command found.

### 3.1 Balloon callouts — wire placement + auto-balloon *(LEAN — mostly wiring)*
- [ ] 3.1.1 `DrawingCanvas` click handler for `addBalloon`: pick `itemNumber`, dispatch existing `AddDrawingAnnotationCommand`. — _test:_ `addBalloon-click.test.tsx` command dispatched (RED→GREEN).
- [ ] 3.1.2 `autoBalloonSheet(sheetId)`: one balloon per `computePartsListRows` row. — _test:_ `autoBalloon.test.ts` N rows → N annotations (RED→GREEN).
- [ ] 3.1.3 "Auto-balloon" toolbar button. — _verify §6 e2e:_ balloon count == parts-list rows.

### 3.2 Live associativity (auto-regen toggle)
- [ ] 3.2.1 `autoRegen` + `setAutoRegen` in store. — _test:_ `drawingSettings.test.ts` toggle persists (RED→GREEN).
- [ ] 3.2.2 `useEffect` on `staleViews`: auto-call `handleRegenerate(id)` (guarded by `clearStaleView`). — _test:_ `autoRegenEffect.test.tsx` regen called per stale id (RED→GREEN).
- [ ] 3.2.3 "Auto-update views" toggle in DrawingTab. — _verify §6 e2e:_ stale banner clears without click.

### 3.3 Drawing templates
- [ ] 3.3.1 `exportDrawingTemplate(sheet)` (keep titleBlock+underlay, strip views/annos/dims). — _test:_ `drawingTemplate.test.ts` no views, has titleBlock (RED→GREEN).
- [ ] 3.3.2 `importDrawingTemplate` + `applyTemplateToNewSheet`; OPFS `templates/`. — _test:_ round-trip preserves title block (RED→GREEN).
- [ ] 3.3.3 "Save as template" + "New from template" picker. — _verify §6 e2e:_ new sheet title block matches template.

### 3.4 Enforced projected-view alignment
- [ ] 3.4.1 `MoveDrawingViewCommand` apply/revert shifts `originMm`. — _test:_ `moveDrawingViewCommand.test.ts` (RED→GREEN).
- [ ] 3.4.2 Also shift every `ProjectedView` with `baseViewId===viewId`. — _test:_ `projectedViewAlignment.test.ts` dependents follow (RED→GREEN).
- [ ] 3.4.3 Wire drag-end to dispatch the command. — _verify §6 e2e:_ base+projected move together.

**Risks/Deferred (3):** balloon snap-to-edge hit-test; template versioning on schema change; `addLeader` stub (same fix as 3.1.1); section/detail-view alignment; continuous (vs drag-end) alignment.

---

## Milestone 4 — Interop & constraint completeness

**Goal:** DWG/SKP feasibility + pragmatic proxy, tangent/coaxial + sketch constraints, unified BOM.
**Depends on:** none (parallel). **Verified:** DXF-only; `insert` **already in** the assembly union (tangent/coaxial missing); sketch missing mirror/point-on-curve/fix/collinear; `BomRow` lacks purchased/phantom/revision/vendor/material/mass.

### 4.1 DWG import/export *(feasibility-bounded)*
- [ ] 4.1.1 Probe JS/WASM DWG libs (libredwg, ODA, dxf libs); document verdict. — _no-TDD (research)._ **Verdict: no production browser DWG-write exists → proxy.**
- [ ] 4.1.2 Export toast: "File is DXF (R2013-compatible); Save As DWG in AutoCAD/LibreCAD." — _no-TDD (string)._
- [ ] 4.1.3 Upgrade DXF output R12→R2013 (`AC1027`) for lossless DWG round-trip. — _test:_ `$ACADVER==AC1027` (RED→GREEN).
- [ ] 4.1.4 `.dwg` import → clean "export DXF instead" error. — _test:_ `parseDxfUnderlay('','plan.dwg')` → `{ok:false,reason:'dwg-not-supported'}` (RED→GREEN).

### 4.2 SketchUp import *(via Collada/OBJ)*
- [ ] 4.2.1 Import dialog SKP entry → guide to `.dae`/OBJ; wire three.js `ColladaLoader`. — _verify §6:_ `.dae` cube as underlay group. _(Confirm ColladaLoader is a dep first.)_
- [ ] 4.2.2 Collada mesh → `MeshUnderlay` type; wireframe in viewport. — _test:_ `parseColladaUnderlay.test.ts` vertex count (RED→GREEN).

### 4.3 Assembly constraints: tangent + coaxial — **S5 resolved: solver = `AssemblyConstraintSolver.ts` (LM)**
> `insert` is already fully solved. Per kind: add union arm → `buildXResiduals/Jacobian` in `Residuals.ts` → row count in `constraintResidualCount` → dispatch case in `buildSingleResidual` (71-90) + `buildSingleJacobianBlock` (99-124). Residuals must be differentiable with analytic Jacobians (no algebraic shortcut).
- [ ] 4.3.1 Confirm `coaxial` semantic: is it just `mate` axis-axis offset=0? If so, **skip a new kind** (document the equivalence). — _test:_ two cylinders mated axis-axis → coaxial after solve.
- [ ] 4.3.2 If coaxial needs its own kind: add union arm + residual reusing `buildMateAxisAxisResiduals` with offset=0. — _test:_ axes collinear (RED→GREEN).
- [ ] 4.3.3 Add `tangent` union arm. — _test:_ exhaustiveness switch (RED→GREEN).
- [ ] 4.3.4 Add `sphere`/`cylinder` to `PartLocalGeometry` if tangent needs radius (flagged non-trivial in S5). — _test:_ `resolveRef` returns the new geometry kind.
- [ ] 4.3.5 `buildTangentResiduals` = `|N·(Pc−Pp)|−r=0` + Jacobian + dispatch + row count. — _test:_ contact normals/distance satisfied after solve (RED→GREEN).

### 4.4 Sketch constraint completeness — **S4 resolved: all cheap, no WASM rebuild**
- [ ] 4.4.1 `point-on-line` → wire `point_on_line_pl` case in `translateConstraint` + union arm + snap gesture. — _test:_ point on line after solve (RED→GREEN).
- [ ] 4.4.2 `point-on-curve` → `point_on_circle` / `point_on_arc` cases (both exist in planegcs, unwired). — _test:_ point snaps to arc (RED→GREEN).
- [ ] 4.4.3 `fix`/`ground` — expose the already-propagated `fixed:true` point flag as a toolbar action + GCS rebuild (cheapest; no new constraint type). — _test:_ fixed point unmoved under drag (RED→GREEN).
- [ ] 4.4.4 `collinear` — **no native type;** implement as two `point_on_line_pl` (line-B endpoints onto line-A `l_id`). Reuses 4.4.1. — _test:_ two lines collinear after solve (RED→GREEN).
- [ ] 4.4.5 `MirrorSketchEntityCommand` (app-side coordinate math, no solver). — _test:_ mirror over Y negates X (RED→GREEN).
- [ ] 4.4.6 Toolbar icons + shortcuts. — _no-TDD; verify §6 screenshot._

### 4.5 Unified structured BOM
- [ ] 4.5.1 Extend `BomRow` with `purchased?/phantom?/revision?/vendor?/material?/massKg?`. — _test:_ shape compiles (RED→GREEN).
- [ ] 4.5.2 Hardware rows get `purchased:true` in `aggregateConnectorBomRecursive`. — _test:_ (RED→GREEN).
- [ ] 4.5.3 Merge hardware stream into `aggregateCutListRecursive` output. — _test:_ combined list has panels+hardware (RED→GREEN).
- [ ] 4.5.4 CSV renderer emits new columns when non-null. — _test:_ header contains Vendor/Material/Mass (RED→GREEN).
- [ ] 4.5.5 BOM table UI: new columns, phantom struck-through. — _no-TDD; verify §6 screenshot._

**Risks/Deferred (4):** server-side DWG converter out of scope; SKP only via re-export; planegcs may need WASM rebuild if primitives absent (S4); `massKg` population needs density lookup (ship field nullable).

---

## Confidence & caveats

- **Planner confidence was 72–74; Stage-0 spikes (88–96 conf) raised it materially by closing the unknowns** — and every spike reduced scope rather than expanding it.
- **Three former high-risk items are now de-risked:** feature suppression is TS-only (no WASM rebuild, S3); the rule conditional engine is ~1 line (expr-eval already supports it, S2); all four sketch constraints + the groove cut are cheap bindings with proven patterns (S4, S1). No spike surfaced a WASM rebuild requirement anywhere.
- **Residual risks (small):** tangent assembly constraint may need a new `sphere`/`cylinder` geometry kind (S5 — the one non-trivial item); planegcs WASM-binary method presence is assumed from TS types (throws at runtime if absent — caught by 4.4.1 test); Biesse CIX datum convention varies by machine (confirm with shop before shipping 1b.1).
- **Corrections to the gap report:** balloons are PARTIAL (wiring, not a build); assembly `insert` already exists and is fully solved. Both reduce scope.
- **Recommended start:** begin Milestones 3 and 4 (independent) immediately alongside 1a; gate 1b on 1a's groove cut; start Milestone 2 after Wave 1.
- **Deploy is tracked separately** — `docs/superpowers/plans/2026-06-12-production-readiness.md` (human-gated; GitHub billing must be fixed first). This plan is feature-scope only.
