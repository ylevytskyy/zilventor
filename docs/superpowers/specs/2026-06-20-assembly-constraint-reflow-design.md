# Parametric Reflow + Constraint-Authoring Completion for Assembly Constraints

**Date:** 2026-06-20
**Status:** Design — awaiting ratification
**Milestone:** Tier-1 assembly parity (reframed)

## 1. Background & Current State

A parallel-subagent audit (vs Autodesk Inventor 2012, furniture focus) initially flagged the
assembly constraint solver as "dead-wired." **Verification refuted this (confidence 92).** The
solver is live and substantially complete:

- `solveAssembly(input)` runs synchronously on the app thread, fired by a `useEffect` on a
  `solverDirty` flag — `packages/app/src/App.tsx:1828` (import at `:116`).
- Full Levenberg–Marquardt with analytic Jacobian, Cholesky solve, quaternion renormalization,
  per-constraint residual breakdown, and SVD-based DOF analysis — `packages/kernel/src/assembly/AssemblyConstraintSolver.ts`, `Residuals.ts`.
- Constraint types implemented: `mate`, `flush`, `angle`, `insert` — `packages/shared/src/types.ts:216-223`.
- Authoring UI exists: ribbon (Mate/Flush/Angle/Insert + M/F/N/I shortcuts) and
  `PlaceConstraintDialog` (`packages/app/src/shell/PlaceConstraintDialog.tsx`) with "Pick…" buttons.
  **Face pick is fully wired** (`raycastAssemblyRef('face')` → `FaceName` → ref).
- Nested rigid sub-assemblies pre-solve their internals (`flattenForSolver` `innerStaticPoses`);
  edge-to-edge mates **between** cabinet sub-assemblies solve correctly.

The `null` `SolverBridge` at `loadAssemblyForProjection.ts:84` that triggered the false alarm is the
**drawing-projection** path, which intentionally renders static initial poses for shop drawings.

### What is actually missing (evidence-backed)

1. **Parameter changes do not trigger a re-solve.** `solverDirty` is set only on constraint
   add/edit/remove/suppress, grounded toggle, flexible toggle, and component drag
   (`packages/app/src/store/useAppStore.ts:825–1145`). Editing a part dimension does not mark the
   assembly dirty, so constrained dependents never reflow. **This is the crux of the user's goal.**
2. **`axis` / `point` / `circularEdge` viewport pick is stubbed** — `Viewport.tsx:81` TODO.
   Face pick works (so Mate/Flush are authorable), but Insert/Angle (and the new Tangent type)
   cannot be authored from real viewport clicks.
3. **No `tangent` or `coincident` constraint types** (sketch solver has its own; assembly does not).

## 2. Goal & Success Criteria

**Goal:** Resize/edit one component's parameters → components constrained to it automatically
re-position via a re-solve ("reflow"), and complete constraint authoring so the relevant
furniture relationships can be built from the viewport.

**Success = two real furniture e2e scenarios pass in a real browser (§6 verification):**

- **S-A — Cabinet run (mate/flush):** place 3 base cabinets, mate them edge-to-edge, change
  cabinet #2's width parameter → cabinets #3…#n shift and stay mated. DOF readout reflects the
  constrained state.
- **S-B — Hardware-to-bore (insert):** insert-mate a handle/hardware part to a panel's bore axis
  (authored via the **new axis/circularEdge pick**), change the panel's size parameter → the
  hardware follows and stays mated.

Both scenarios must reflow using **fresh** geometry (the moved face/axis), not cached stale refs.

## 3. Scope

### In scope
- **R — Reflow trigger:** a part-parameter re-execute that affects a part used in the active
  assembly results in (a) ref-cache invalidation for that part and (b) `solverDirty = true`,
  **after the WASM re-bake completes**, so the next solve reads fresh geometry.
- **P — Pick completion:** implement `axis` and `circularEdge` pick modes in `raycastAssemblyRef`
  (`Viewport.tsx:81`), unblocking Insert/Angle/Tangent authoring from the viewport.
- **C — Coincident type:** a selectable `coincident` constraint, implemented as a **mate preset at
  offset 0** (see §4.3 — no new residual math), exposed in `PlaceConstraintDialog`.
- **T — Tangent type:** a new `tangent` constraint with real residual + analytic Jacobian.
  Core: **cylinder↔plane** (`dist(axis, plane) = radius`, 1 scalar residual, S). Stretch within the
  same milestone: **cylinder↔cylinder** external tangency (skew-line distance = r1+r2, M).
- Two real-browser e2e scenarios (S-A, S-B) as the completion gate.

### Out of scope
- Nested **flexible** sub-assembly internal-constraint reflow (rigid composition already reflows;
  flexible lift-to-root works but is not a target scenario).
- New constraint types beyond tangent/coincident (parallel, concentric, symmetric).
- Reflow on external sub-assembly file reload (separate minor follow-up).
- Drawing-projection path changes (`loadAssemblyForProjection` stays static by design).

## 4. Architecture

### 4.1 Reflow trigger (the crux)

The solver **caches** each constraint's resolved ref geometry keyed by `partPath` and **skips
re-extraction on a cache hit** (`App.tsx:1732–1733`; cache `AssemblyRefCache` in
`packages/kernel/src/assembly/AssemblyConstraintRefs.ts`). Therefore reflow is correct **only if**
the changed part's ref cache is invalidated before the re-solve.

`invalidatePartPaths` (`App.tsx:5224`) is the canonical seam. It **already**:
- invalidates `assemblyRefCacheRef` for each path (`:5229`),
- clears geometry/bore/tessellation caches,
- bumps active-assembly document identity to re-trigger mesh-sync effects (`:5243–5244`).

It does **not** set `solverDirty`. **The fix:** inside `invalidatePartPaths`, when the active
document is an assembly, also call `setSolverDirty(true)` (mirroring the proven e2e-hook pattern at
`App.tsx:3272/3283`). The existing solver `useEffect` then re-solves with freshly re-extracted refs.

**Required wiring verification (first TDD slice):** confirm a part-parameter edit that re-executes a
part used in the active assembly routes through `invalidatePartPaths` (or an equivalent seam). If it
does not, add the routing so the re-execute completion path invalidates the affected part path.
Timing is load-bearing: `solverDirty` must fire **after** the kernel re-bake resolves, never
synchronously on the raw param edit. Coalesce rapid edits (the existing dirty flag + effect already
debounces to one solve per render).

### 4.2 axis / circularEdge pick

`raycastAssemblyRef` returns `null` for `axis`/`point`/`circularEdge` (`Viewport.tsx:81`). Existing
pick infra is rich: face pick via `FacePickController.pickByTriangleIndex`, edge pick via
`EdgePickController` (used by fillet/chamfer in single-part mode), work-feature pick, bore-marker
pick. Implement `axis`/`circularEdge` by intersecting the pointer ray with the named cylindrical
geometry — preferred path is a kernel query (ray-vs-cylinder against OCCT named geometry) for
precision; mesh-triangle approximation is the fallback. Populate `pickedRefA/B` exactly as the face
path does. `point` pick may remain stubbed unless a target scenario needs it (none do).

### 4.3 Coincident (mate preset, no new residual)

The solver already routes a `(point, plane)` ref pair to `buildMatePointFaceResiduals` with offset 0
(`AssemblyConstraintSolver.ts:78–82`), and mate handles point↔point / point↔axis. **Coincident is
therefore mate at offset 0.** Implement `coincident` as a UI type that constructs a `mate` constraint
with `offset: 0` locked (offset field hidden/disabled). No residual or Jacobian changes.

> **Design decision (flagged for review):** the user requested coincident as a distinct *type*.
> We honor that in the authoring UI while avoiding redundant residual math by mapping it to mate.
> If the user wants coincident persisted as its own `kind` in the document model (not aliased),
> that is a small additive change but adds a manifest-version bump and migration; default is the
> alias approach (no migration).

### 4.4 Tangent (new residual)

Add `tangent` to the `AssemblyConstraint` union (`types.ts:216`), a case in the `buildSingleResidual`
switch (`AssemblyConstraintSolver.ts:65`), and `buildTangentResiduals` in `Residuals.ts`:
- **cylinder↔plane:** `r = Nplane · (Paxis_origin − Pplane) − radius` (1 scalar). Jacobian is a new
  derivation but borrows the normal-dot structure from `buildMatePointFaceResiduals`. Effort S.
- **cylinder↔cylinder (external):** `r = closestDist(axis1, axis2) − (r1 + r2)`. Requires skew-line
  closest-distance; genuinely new analytic Jacobian. Effort M. May ship behind the same milestone or
  defer if the slice runs long (cylinder↔plane alone satisfies a furniture tangent use).

Expose `tangent` in `PlaceConstraintDialog` (`:44–49`), reusing the axis/circularEdge pick from §4.2.

## 5. Data Flow (reflow)

```
param edit (ParameterRegistry / dialog)
  → part re-execute (WASM kernel re-bake)            [async; must complete first]
  → invalidatePartPaths([partPath])  (App.tsx:5224)
       ├─ assemblyRefCacheRef.invalidate(partPath)   [fresh geometry next solve]
       ├─ cache clears + assembly identity bump
       └─ setSolverDirty(true)                        [NEW]
  → solver useEffect fires (App.tsx:1828)
       → re-extract refs (cache miss → fresh faces/axes)
       → solveAssembly → Map<pathKey, Pose>
       → apply poses → dependents reflow + DOF readout updates
```

## 6. Testing Strategy (TDD, red→green per slice)

Each slice owns a named failing test before implementation:

1. **Reflow trigger (unit + integration):** a test that mutates a part param used by a mated
   assembly and asserts `solverDirty` becomes true *and* the dependent component's solved pose
   changes. Red first (currently no trigger).
2. **Ref freshness (regression):** assert that after a param change moves a referenced face, the
   solve uses the **new** face position (guards the cache-invalidation pairing).
3. **axis/circularEdge pick (unit):** ray-vs-cylinder returns the expected `EdgeName`/axis ref for a
   known geometry; `pickedRef` populated.
4. **Coincident (unit):** selecting coincident produces a `mate` constraint with offset 0; solve
   drives point onto plane.
5. **Tangent cyl↔plane (unit, real residual):** solver converges so `dist(axis, plane) == radius`
   within tolerance; assert against analytic expectation (anti-tautology: independent oracle).
6. **Tangent cyl↔cyl (unit)** *(if in slice budget)*: converges to `dist == r1+r2`.
7. **§6 real-browser e2e — S-A cabinet run** and **S-B hardware-to-bore:** drive the actual UI
   (place → constrain via real pick → edit param → assert reflow), capture proof. Command-path-only
   tests are insufficient (the codebase has a documented "green command-e2e ≠ working UI" trap).

**Gate:** all package suites green, `tsc` 0-new, both e2e scenarios pass in a real browser with
captured proof read back.

## 7. Risks & Mitigations

- **R1 — Re-bake timing race:** `solverDirty` firing before the kernel finishes re-baking would
  solve against stale geometry. *Mitigation:* fire only from `invalidatePartPaths`, which runs on the
  post-re-execute path; assert ordering in slice 1/2.
- **R2 — Param edit doesn't route through `invalidatePartPaths`:** if the param→re-execute pipeline
  bypasses it, the one-line fix is inert. *Mitigation:* slice 1 explicitly verifies/establishes the
  routing before relying on it.
- **R3 — Secondary ref-cache clear via `setActiveDocument`:** an existing identity-bump path could
  already partially invalidate, masking bugs. *Mitigation:* slice 2 asserts freshness directly.
- **R4 — Tangent cyl↔cyl Jacobian error:** skew-line distance derivative is error-prone.
  *Mitigation:* finite-difference Jacobian check in the unit test; keep cyl↔plane as the must-ship.
- **R5 — Pick precision:** mesh-approximate axis pick may misfire on coarse tessellation.
  *Mitigation:* prefer kernel ray-vs-cylinder query; fall back only if unavailable.

## 8. Slice Order (for writing-plans)

R (reflow trigger + freshness) → P (axis/circularEdge pick) → C (coincident alias) →
T (tangent cyl↔plane, then cyl↔cyl) → E2E (S-A, S-B). R is the highest-value, lowest-effort core and
is independently shippable; P unblocks T and S-B; C is cheap; T is the largest new math.

## 9. Open Questions for Ratification

1. Coincident as **mate-alias** (no migration, recommended) vs distinct persisted `kind` (manifest
   bump + migration)?
2. Is **cylinder↔cylinder tangent** required this milestone, or is cylinder↔plane sufficient with
   cyl↔cyl deferred?
3. Target **branch**: continue on `feat/wall-tall-cabinets` (where milestones 1–3 live, unmerged) or
   branch fresh from `master`?
