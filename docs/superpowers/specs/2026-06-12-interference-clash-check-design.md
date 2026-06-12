# Interference / Clash Check — Design Spec

**Date:** 2026-06-12
**Status:** Draft (pre spec-verify)
**Track:** Tier-2 (first Tier-2 feature; prior 13 features were Tier-1 furniture-parity)
**Manifest impact:** NONE — read-only analysis, nothing persisted.

## 1. Goal

An on-demand **Interference Check** over the active assembly that surfaces two categories of problem and lets the user locate each in 3D:

1. **Interference** — two part solids whose overlap volume exceeds a small threshold (real penetration).
2. **Clearance** — two parts not touching but closer than a user-set minimum distance.

This mirrors Inventor's *Inspect → Interference* (on-demand, report + highlight), adapted to furniture, where adjacent panels deliberately touch (butt joints, shared faces, embedded hardware).

**Non-goals (this slice):** live/continuous checking; drawing the interference-volume solid as an overlay mesh; excluding hardware paths; persisting results; resolving/fixing clashes automatically.

## 2. User-facing behavior

- An **"Interference Check"** button in the Inspect/analysis area (alongside the BOM / measure affordances).
- The button opens a minimal dialog with a single numeric input — **Minimum clearance (mm)**, default `1.0`. (The overlap volume threshold is an internal constant, not user-facing.)
- On run, the active assembly is analyzed; a **report panel** lists each problem pair; clicking a row selects both components (existing selection path) **and** highlights them red in the 3D viewport.
- Empty result → "No interferences found."
- Re-running clears prior highlights and replaces the report.

## 3. Architecture

Read-only analysis. **Not** a bus `Command` (no mutation, no undo) — modeled like the BOM hook (`useConnectorBomResult`): a button triggers an async orchestration function that populates a store slice consumed by a panel.

```
Button → dialog (clearance mm)
      → runInterferenceCheck(assembly, opfs, kernel, subAsmCache)
            → flatten leaves (visibleLeaves + composedPoses)
            → kernel.checkInterference(leaves, {volumeThreshold, clearanceThreshold})
            → buildClashReport(pairs, leafMeta)  → rows
      → useAppStore clash slice  → ClashReportPanel
                                 → row click → select pair + SceneManager.setClashHighlight
```

### 3.1 Kernel — `checkInterference(leaves, opts)` *(packages/kernel, new KernelApi method)*

- **Input:** `leaves: { partId: string; pose: Pose }[]`, `opts: { volumeThreshold: number; clearanceThreshold: number }`.
- **Algorithm:**
  1. **Per leaf:** `warmShapeForExport(partId)` → pose the shape with the existing `transformShapeByPose(occt, shape, pose)` → compute its world AABB via `Bnd_Box` (`BRepBndLib::Add`). Cache `{ shape, aabb }`.
  2. **Broad-phase:** for every `i < j`, test AABB overlap with each box expanded by `clearanceThreshold` (so near-miss pairs survive). Disjoint → skip. Bounds the O(n²) boolean work on a 20–50-leaf cabinet.
  3. **Narrow-phase** per surviving pair:
     - `BRepAlgoAPI_Common(shapeI, shapeJ)`; if `Build` succeeded and the result solid's volume (`BRepGProp.VolumeProperties_1`) `> volumeThreshold` ⇒ **interference**, record `volume`.
     - Else `BRepExtrema_DistShapeShape(shapeI, shapeJ)`; if `0 < dist ≤ clearanceThreshold` ⇒ **clearance**, record `distance`.
  4. Each pair's narrow-phase wrapped in try/catch — a degenerate-shape failure skips that pair and is logged; it never aborts the whole run.
- **Returns:** `ClashPair[] = { aIndex, bIndex, kind: 'interference' | 'clearance', volume?: number, distance?: number }` (indices into `leaves`).

**Why the volume threshold is load-bearing:** two face-touching panels yield a ~zero-volume `Common` result and `dist = 0`, so they fall out of *both* categories. Real penetration (even 1 mm across an 18×100 mm face = 1800 mm³) sits far above the threshold. Without this filter the report is unusable on real furniture.

### 3.2 Shared — types + defaults + mapper *(packages/shared)*

- `ClashKind = 'interference' | 'clearance'`.
- `ClashPair = { aIndex; bIndex; kind: ClashKind; volume?: number; distance?: number }`.
- Defaults: `VOLUME_THRESHOLD_MM3 = 1.0`, `CLEARANCE_DEFAULT_MM = 1.0` (the volume value is a starting guess; tuned against a real cabinet in the kernel integration test — see §6).
- Pure mapper `buildClashReport(pairs, leafMeta)` → `ClashReportRow[] = { aPathKey; bPathKey; aName; bName; kind; volume?; distance? }`, where `leafMeta[i] = { componentPathKey; partName }`.
- **No `fileFormat` / manifest change** — nothing is persisted.

### 3.3 App — orchestration *(packages/app)*

`runInterferenceCheck(assembly, opfs, kernel, subAsmCache)`:
1. Flatten the active assembly with existing `visibleLeaves()` + `composedPoses()` → for each leaf produce `{ partPath, worldPose, componentPathKey }` and the part display name.
2. Load each **unique** `partPath` once via `kernel.loadFromBytes(opfs.read(partPath))` → kernel `partId`; reuse the id for repeated instances (same shape, different pose).
3. Build `leaves = [{ partId, pose: worldPose }]` and parallel `leafMeta = [{ componentPathKey, partName }]`.
4. `const pairs = await kernel.checkInterference(leaves, { volumeThreshold: VOLUME_THRESHOLD_MM3, clearanceThreshold })`.
5. `const rows = buildClashReport(pairs, leafMeta)`; store `rows` + a `ran: true` flag in the new `useAppStore` clash slice.

### 3.4 App — UI

- Button **"Interference Check"** in the Inspect/analysis area; opens the clearance dialog; on submit runs the orchestration.
- **`ClashReportPanel`** (mirrors `ConnectorBomTable`): one row per pair — kind badge (Interference / Clearance), both part names, and overlap volume (mm³) or gap distance (mm). i18n keys for labels. Empty state row. Row click → `setSelectedComponentPaths([aPath, bPath])` + `setClashHighlight([aPathKey, bPathKey])`.

### 3.5 App — viewport highlight *(SceneManager)*

`setClashHighlight(pathKeys: ComponentPathKey[])`: for each, `getComponentMesh(key)` → swap to a red material, stashing the original material to restore. Clearing (re-run / panel close / empty `pathKeys`) restores originals. Probes registered in `App.tsx` DEV block: `__zilventorClashCount()` and `__zilventorClashResults()` (returns the report rows) — required because headless Chrome renders the viewport black, so e2e/§6 verify via probes, not pixels.

## 4. Data flow summary

`assembly docs (OPFS) → leaves+poses (app walkers) → kernel shapes (warm+pose) → AABB broad-phase → Common/Distance narrow-phase → ClashPair[] → ClashReportRow[] (store) → panel + red highlight`.

## 5. Error handling & edge cases

- Empty assembly / single leaf → no pairs → empty report ("No interferences found").
- Degenerate shape in a pair → that pair's narrow-phase try/catch skips it (logged), run continues.
- A part that fails to load → skip that leaf, continue (logged); do not abort.
- Re-run clears the prior highlight set before applying the new one (no stale red).
- Clearance is only evaluated for pairs that are NOT interfering (interference takes precedence; a pair is reported once, in one category).

## 6. Testing (TDD slices)

- **Kernel real-OCCT integration (ground truth, `*.integration.spec.ts`):**
  - Two boxes overlapping by a known volume → `interference` with the correct `volume` (assert the number, not just a boolean — anti-false-green).
  - Two boxes 0.5 mm apart, `clearanceThreshold = 1.0` → `clearance` with `distance ≈ 0.5`.
  - **Two face-touching boxes → neither category** (touching-faces guard; this is where the volume threshold earns its place — tune `VOLUME_THRESHOLD_MM3` here if a touching pair leaks through as a sliver).
  - A clearly-separated pair (gap > threshold) → nothing.
- **App units:** `buildClashReport` index→path-key/name mapping; clearance-vs-interference classification surfaced correctly; threshold defaults wired.
- **e2e (real browser, probe-verified):** seed a cabinet, inject a deliberately-overlapping component, run the check, assert `__zilventorClashCount()` > 0 and that the expected components are in `__zilventorClashResults()`; a **clean cabinet → zero clashes** (proves butt joints / shared faces are not false-flagged end-to-end).
- §6 browser verification through the probes (viewport black in headless).

## 7. Open decisions (resolved in brainstorm)

- Detection = **overlap volume + clearance** (both). ✓
- Trigger = **on-demand button**. ✓
- Intentional contact = **volume threshold filter** (no hardware exclusion). ✓
- Result = **report panel + red highlight** (no interference-volume overlay mesh this slice). ✓
- Clearance is **tunable** via a single dialog input (default 1.0 mm); volume threshold is an internal constant. ✓

## 9. Corrections v1 — AUTHORITATIVE (post 4-lens spec-verify)

These override §1–§6 wherever they conflict. Stable IDs (SC-N); the plan must reference them. Each is grounded in real-code evidence from the four parallel verifiers.

### Geometry / OCCT (verifier confidence 87)

- **SC-1 [BLOCKER] `BRepAlgoAPI_Common` constructor + explicit Build.** There is NO bare 2-arg `Common(s1,s2)`. Use `new oc.BRepAlgoAPI_Common_3(s1, s2, new oc.Message_ProgressRange_1())`, then call `common.Build(new oc.Message_ProgressRange_1())` explicitly (it does NOT auto-build — mirror `packages/kernel/src/occt/BooleanOps.ts:106-114`, which allocates two `Message_ProgressRange` objects for `Cut_3`). Read result via `common.Shape()`.
- **SC-2 [BLOCKER] `BRepExtrema_DistShapeShape` has no 2-arg constructor.** Use `_1()` default ctor + `LoadS1(s1)` + `LoadS2(s2)` + `Perform(new oc.Message_ProgressRange_1())`, then `Value()`. (Alt: `_2(s1,s2,extFlag,extAlgo,range)` — but `_1`+Load+Perform is simpler; look up `Extrema_ExtFlag`/`Extrema_ExtAlgo` enum member names in the .d.ts if using `_2`.) `Value()` returns 0 for BOTH touching and overlapping — so clearance is only computed for pairs NOT already classified as interference (already in §5; keep).
- **SC-3 [RISK] Guard the Common result before measuring.** Before `VolumeProperties_1`, check `!common.HasErrors()`; the touching-face case yields a degenerate (non-solid) result. `BRepGProp.VolumeProperties_1(shape, props, OnlyClosed=true, …)` returns ~0 for a non-solid result (good — falls below threshold). Mirror the defensive `IsNull` / `TopExp_Explorer`-for-solid checks in `BooleanOps.ts:126-137`. The per-pair try/catch (§3.1.4) also covers throws.
- **SC-4 AABB.** Reuse `computeBoundingBox` in `packages/kernel/src/occt/SolidOps.ts:50-70` (`Bnd_Box_1` + `BRepBndLib.Add`; `CornerMin/CornerMax`). For the clearance-expanded broad-phase, call `Bnd_Box.Enlarge(clearanceThreshold)` before reading corners (cleaner than manual ±). `Bnd_Box`/`BRepBndLib` confirmed present (already used in `FeatureTree.ts:812`, `PanelOps.ts:139`).
- **SC-5 Dispose posed copies.** `transformShapeByPose` returns a fresh `BRepBuilderAPI_Transform` copy; dispose posed shapes (and Common results) after each pair to avoid WASM heap growth across O(n²) pairs.

### Assembly walk / persistence (verifier confidence 78)

- **SC-6 [REUSE — do NOT re-walk] Use `resolveExportLeaves`.** `packages/app/src/assembly/resolveExportLeaves.ts` ALREADY does: `visibleLeaves()` → placeholder guard → pose resolution (prefer store `componentPoses` Map, fall back to `flattenForSolver`+`composedPoses` — see `resolveExportLeaves.ts:84-97`) → unique-`partPath` `loadFromBytes` dedup (`partIdByPath`) → returns `{ partId, pose, name }` per instance. `runInterferenceCheck` MUST call `resolveExportLeaves` for the `leaves`, then build `leafMeta[i] = { componentPathKey: pathKey(leaf.componentPath), partName }` from the same pre-walk leaf list. The spec's "`visibleLeaves()` + `composedPoses()`" (§3.3) understated this — `composedPoses` needs `flattenForSolver` output; following `resolveExportLeaves` is the only correct path. This also revises the §3.3 signature: `runInterferenceCheck` takes the same deps `resolveExportLeaves` needs (kernel, opfs/part-info reader, the `ExportSubAsmCache`, and the store `componentPoses`).
- **SC-7 [RISK] path-key vs path-array for selection.** `setSelectedComponentPaths` takes `ComponentPath[]` (string arrays), NOT `ComponentPathKey[]` (joined strings). `SceneManager.getComponentMesh(key)` and the highlight map ARE keyed by the string. So `ClashReportRow` should carry BOTH the `ComponentPath` (for `setSelectedComponentPaths`) and the `ComponentPathKey` (for `getComponentMesh`/`setClashHighlight`), or the row handler calls `parsePathKey()`. Carry both in the row.
- **SC-8 Read-only confirmed.** `loadFromBytes`/`warmShapeForExport` write only in-memory maps (`parts`, `namedShapeCache`) — no OPFS write, no `setSolverDirty`, no document mutation. `CURRENT_FORMAT_VERSION = 25` (`fileFormat.ts:4`) — NO manifest bump, NO migration. Keep it that way; the analysis must not dirty the assembly.

### Test design / false-green (verifier confidence 72)

- **SC-9 [BLOCKER] Overlap-volume test uses an INDEPENDENT oracle.** Pin exact box geometries in the integration test and hand-compute the intersection volume; assert `checkInterference`'s reported volume against that constant (NOT against the producer's own output). Canonical case: a 50×50×50 box and a 40×40×40 box offset +30 on X ⇒ overlap region 20×40×40 = **32000 mm³**; assert `|volume − 32000| < 5`.
- **SC-10 [BLOCKER] Touching-faces test measures real OCCT, then tunes the threshold.** Use two boxes sharing an exact coincident face (no epsilon gap). Assert the pair is classified as NEITHER, AND log/expose the raw Common volume so `VOLUME_THRESHOLD_MM3` is set from REAL OCCT output, not the 1.0 guess. If the real sliver volume is > ~0.5 mm³, raise the threshold and document that a genuine sub-threshold interference is undetectable (acceptable trade vs. false-flagging every joint). This measurement gates finalizing the constant.
- **SC-11 [BLOCKER] e2e exercises recursion + exact identities.** The e2e seed must (a) place one of the two clashing parts INSIDE a nested `.ziasm` (so the flatten→compose chain is tested at real depth), (b) assert the exact `aPathKey`/`bPathKey` of the injected pair appear in `__zilventorClashResults()` (not just `count > 0`), and (c) the "clean cabinet → 0 clashes" case must contain real face-touching butt joints, so a green proves the threshold filter end-to-end rather than running on an empty scene.
- **SC-12 [RISK] Real UI-wiring test (no self-injected handler).** Render the real `InspectTab`, `userEvent.click` the "Interference Check" button, fill the clearance input, submit, and assert the store `clashRows` populates — with `kernel.checkInterference` MOCKED to return a known `ClashPair[]`. Must NOT inject its own `onSubmit` (the slice-6 false-green class). Separately test row-click on the real `ClashReportPanel` calls `setSelectedComponentPaths` + `setClashHighlight` with the correct identities.
- **SC-13 [RISK] Logic-edge unit tests.** (a) Precedence: a pair that both overlaps AND is within clearance is reported ONCE, as `interference`. (b) Degenerate/invalid shape in one pair is skipped (try/catch) while a valid pair still returns. (c) `leaves.length < 2` → empty report. (d) Re-run clears stale highlights: run twice with different results, assert the highlighted set equals only the second run's pairs (not additive).

### Reuse / API-fit (verifier confidence 87)

- **SC-14 KernelApi wiring.** Declare `checkInterference` in the `KernelApi` type (`packages/kernel/src/api.ts:72-210`) and implement it INSIDE the `createKernelApi()` return object (so it can call the closure-private `warmShapeForExport`/`namedShapeCache`/`transformShapeByPose`). `Comlink.expose(api,self)` (`worker.ts:5`) exposes it automatically — NO edit to `worker.ts` or `kernel-client/KernelClient.ts`. Args/return are plain objects/arrays (`ClashPair[]`) → structured-clone-safe. Use the `oc as any`/`ocAny` cast convention for un-typed OCCT classes.
- **SC-15 [PLACEMENT] Button + panel live in `InspectTab.tsx`.** `packages/app/src/.../InspectTab.tsx` is currently a STUB (`<StubTab subProject={3} …/>`) and is already wired into the Ribbon for both part and assembly contexts (`Ribbon.tsx`). The "Interference Check" button, clearance dialog trigger, and `ClashReportPanel` belong in `InspectTab` — NOT next to `ConnectorBomTable` in `BrowserPane.tsx`. The §2/§3.4 "Inspect/analysis area" resolves to `InspectTab`.
- **SC-16 Store slice.** Add `clashRows: ClashReportRow[] | null` (init `null`) and `clashRan: boolean` (init `false`) to `AppState` with a `setClashResult(rows)` setter, following the `AddDrawerHandleDialogState` slice pattern (`useAppStore.ts:113`).
- **SC-17 [RISK] `setClashHighlight` is NEW — choose the approach explicitly.** It does NOT exist. Selection currently uses an EDGE-OVERLAY (`LineSegments` child) in `SceneManager.setSelectedComponentPaths` (`SceneManager.ts:555`), NOT a material swap. The plan must pick ONE: (a) material swap with stash+restore of the original `mesh.material`, or (b) reuse the edge-overlay pattern with a red material. Whichever is chosen, ensure it composes cleanly with the selection edge-overlay (both attach children to the same mesh) and is fully cleared on re-run/close. Add `__zilventorClashCount()` / `__zilventorClashResults()` in the `App.tsx` `import.meta.env.DEV` probe block (`App.tsx:436`).
- **SC-18 [BLOCKER] i18n parity.** `parity.test.ts` enforces IDENTICAL key sets in `packages/app/src/i18n/locales/en.json` and `uk.json` (no empty uk values). EVERY new label (button, dialog, panel headers, kind badges, empty-state) must be added to BOTH bundles in the same change, or the parity test fails. Lead reviews uk wording later (deferred).

## 10. Known limitation — carcass-overlap noise (SHIPPED as-is; filter is the next slice)

Discovered during the final §6/e2e verification (empirically confirmed, conf 96): this app models a cabinet's carcass panels as **flat slabs with no rotation** (`buildPanelBox` always emits thickness on local-Z; `baseCabinet.pushPanel` sets `rotation:{0,0,0}` for every panel and varies only `position`). As a result the Left Side / Right Side / Back panels of a standard cabinet genuinely **overlap volumetrically** near Z≈0 — e.g. Left Side × Back ≈ 2,016,000 mm³ — and the renderer and the clash path use the identical pose chain, so this is REAL geometry in the model, not a bug and not a pose artifact.

Consequence: running the check on any normal cabinet reports **≈2–3 internal interference rows from the cabinet's own structural panels**. The SC-10 brainstorm premise (intentional joints produce ~zero volume → absorbed by `VOLUME_THRESHOLD_MM3`) does NOT hold here — these overlaps are 200K–2M mm³, far above any usable threshold.

Decision (user, 2026-06-12): **ship the correct, green core now**; the geometry is right and the feature catches all real overlaps (incl. cross-cabinet and part-vs-cabinet). The carcass-noise filter is a **dedicated follow-up slice** designed with furniture-domain input — because the blunt "suppress all same-cabinet pairs" filter would also hide the drawer-vs-shelf / door-vs-shelf cases this feature was meant to catch. The follow-up should distinguish structural-carcass-vs-carcass pairs (suppress) from drawer/door/movable-vs-anything pairs (keep), likely via `ComponentInstance.role`.

## 8. Deferred

Interference-volume overlay mesh; live/continuous checking; hardware-path exclusion toggle; camera-fit-to-pair on row click; clearance-only-between-selected-components mode; persisting/exporting the clash report; auto-suggest fixes; per-pair "ignore/acknowledge" state. **Carcass-overlap noise filter (see §10) — the immediate next slice.**
