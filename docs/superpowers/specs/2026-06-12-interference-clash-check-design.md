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

## 8. Deferred

Interference-volume overlay mesh; live/continuous checking; hardware-path exclusion toggle; camera-fit-to-pair on row click; clearance-only-between-selected-components mode; persisting/exporting the clash report; auto-suggest fixes; per-pair "ignore/acknowledge" state.
