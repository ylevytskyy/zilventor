# ZilInventor Sub-project 4b — Assembly constraints design spec (2026-04-26)

Second piece of Sub-project 4 (Assemblies + BOM). Adds **mate / flush / angle / insert** constraints between component faces / edges / axes, an **LM nonlinear least-squares solver** that re-poses components on the main thread, **viewport drag along free DOFs**, and an **Inventor-style constraint browser** under each component leaf. Builds on 4a's `AssemblyDocument` + `ComponentInstance` + `ComponentPickController`.

## Decomposition

Sub-project 4 split (recap):

| Piece | Scope |
|---|---|
| 4a | Multi-part document + component placement (shipped) |
| **4b (this spec)** | **Mate constraints + 3D solver** |
| 4c | Bill of Materials |
| 4d | Sub-assemblies |

## Scope summary

| Axis | In scope | Deferred |
|---|---|---|
| Constraint kinds | mate, flush, angle, insert | tangent, symmetric, transitional, drive-constraint |
| Mate sub-types | face↔face, axis↔axis, point↔point, point↔face, point↔axis | face↔axis (use Tangent — deferred) |
| Angle | undirected (`N · M = cos(angle)`) | directed (with explicit rotation-axis ref) |
| Insert pick | circular edge on each side | other axis-anchored composite picks |
| Reference targets | planar face, cylindrical face, edge, vertex, work axis, work plane, work point | spline edges, conical / spherical / B-spline faces |
| Solver | custom Levenberg-Marquardt on 6 DOF / component (translation + quaternion) | sequential reduction; per-frame drag-solve |
| Grounding | first component auto-grounded; user toggle via right-click | multiple anchor groups, weld groups |
| Drag interaction | viewport drag along free DOFs (translation only) after solve | rotation drag along free DOFs |
| Parametric values | mate/flush/insert offset + angle accept `=paramName` | parametric grounded toggle |
| Diagnostics | DOF status segment + per-constraint over-tolerance badge + broken-ref badge | global per-constraint visualization (e.g., highlight conflicting set) |
| Suppress | per-constraint right-click toggle, ghosted in browser | named suppression sets |
| Sub-assemblies | none | entire 4d |
| BOM | none | entire 4c |

## Decisions (from brainstorm 2026-04-26)

1. **Q1 — Interaction model: A.** Inventor 2012 classic. Dialog-driven constraint creation; one-shot solve on OK / Apply; under-constrained components draggable in viewport along remaining free DOFs (drag pose is the next solve's initial guess). Not real-time per-frame solving.
2. **Q2 — Grounding: A.** Inventor classic. First component placed auto-grounds. User-toggleable per component via right-click → Grounded. At least one grounded component required for a well-posed problem; if user un-grounds the last one, solver auto-anchors the first component for that solve only and records a diagnostic.
3. **Q3 — Solver: A.** Custom Levenberg-Marquardt, ~400 lines: LM core + per-constraint analytic residuals + analytic Jacobian + quaternion soft-norm gauge. Handles loops + redundancy. Free DOFs surface as null-space of `J` via SVD.
4. **Q4 — Browser layout: A.** Inventor classic. Component leaves expand to show their constraints; each constraint is duplicated as a leaf under both endpoints' components (single backing object, two view-model leaves).
5. **Q5 — v1 scope: A.** Inventor parity v1 = suppress + DOF status segment + per-constraint over-tolerance badge.
6. **Q6 — Parametric values: A.** Constraint values use `ParamOrLiteral`. Editing a referenced parameter cascades to a re-solve.
7. **Q7 — Perf budget: A.** Strict for typical (≤20 components, ≤30 constraints): solve <150ms p95, drag-along-free-DOFs <16ms p95. Larger assemblies best-effort.

## Architecture

### Layering

| Package | Adds |
|---|---|
| `packages/shared` | `AssemblyConstraint` + `AssemblyConstraintRef` + DOF / diagnostics types. No solver code. |
| `packages/kernel` | `assembly/AssemblyConstraintSolver.ts` (LM core + per-constraint residuals + analytic Jacobians); `assembly/AssemblyConstraintRefs.ts` (resolves a `ref` to a part-local plane / axis / point via existing `extractFacePlane` / `extractCylinderAxis` / `extractEdgeLine` / `extractEdgeEndpoint` and 3c work-feature evaluators); `assembly/linalg.ts` (vendored Cholesky + Jacobi-SVD). |
| `packages/app` | `PlaceConstraintDialog.tsx`, `AssemblyRefPickController`, browser-pane component expansion + constraint leaves, ribbon Assembly tab Constraint panel, M/F/N/I/G/Ctrl+Shift+S hotkeys, viewport drag-along-free-DOFs handler. |

### Threading

Solver runs on the **main thread**. LM iterations are pure JS arithmetic on cached part-local extracts — no OCCT calls in the inner loop. OCCT extraction happens once per `(partPath, refKey)` at part-load via the existing kernel worker; results cached in `assemblyRefCache`. Same shape as 3c work-feature evaluators.

## Data model

`packages/shared/src/types.ts` extensions:

```ts
export type AssemblyConstraintRef =
  | { kind: 'face';  componentId: string; face: FaceName }
  | { kind: 'axis';  componentId: string; axis:
        | { source: 'cylindricalFace'; face: FaceName }
        | { source: 'edge'; edge: EdgeName }
        | { source: 'workAxis'; featureId: string } }
  | { kind: 'point'; componentId: string; point:
        | { source: 'vertex'; edge: EdgeName; end: 'start' | 'end' }
        | { source: 'workPoint'; featureId: string } };

export type AssemblyConstraint =
  | { id: string; kind: 'mate';   refA: AssemblyConstraintRef; refB: AssemblyConstraintRef; offset: ParamOrLiteral; suppressed: boolean }
  | { id: string; kind: 'flush';  refA: AssemblyConstraintRef; refB: AssemblyConstraintRef; offset: ParamOrLiteral; suppressed: boolean }
  | { id: string; kind: 'angle';  refA: AssemblyConstraintRef; refB: AssemblyConstraintRef; angle:  ParamOrLiteral; suppressed: boolean }
  | { id: string; kind: 'insert';
      refA: { componentId: string; circularEdge: EdgeName };
      refB: { componentId: string; circularEdge: EdgeName };
      offset: ParamOrLiteral; suppressed: boolean };

export type AssemblyDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  components: ComponentInstance[];
  constraints: AssemblyConstraint[];        // NEW — [] for legacy v7
  groundedComponentIds: string[];           // NEW — [] for legacy v7; auto-populated on first place
};

export type ComponentInstance = {
  // … 4a fields (id / partPath / position / rotation / visible) …
  pose?: { translation: Vec3; quaternion: [number, number, number, number] };
  // ↑ solver-output. When present, viewport composes `pose`; the Euler position/rotation
  //   become the pre-constraint initial guess (drag-along-free-DOFs writes back here).
};
```

Allowed `kind` per constraint type (validated at edit time + at solve time, surfaced as a diagnostic on mismatch):

| Constraint | `refA.kind` × `refB.kind` allowed |
|---|---|
| mate | face×face / axis×axis / point×point / point×face / point×axis (and the swapped pair) |
| flush | face×face only |
| angle | face×face / axis×axis / face×axis (or swapped) |
| insert | circularEdge×circularEdge (own ref shape, not `AssemblyConstraintRef`) |

## Storage / format

`formatVersion` stays at **7** — additions are pure-additive on the assembly branch and don't touch the part branch.

`migrateManifest` (already exists from 4a) extends to:
- Default `constraints: []` and `groundedComponentIds: []` on legacy v7 assemblies.
- Back-fill `pose` on each `ComponentInstance` from its Euler `position` + `rotation` so a freshly-loaded legacy assembly is solver-ready without re-solving.

## Storage / runtime cache

Per-part-load cache keyed by `(partPath, refKey)`:

```ts
type PartLocalGeometry =
  | { kind: 'plane'; P: Vec3; N: Vec3 }
  | { kind: 'axis';  P: Vec3; D: Vec3 }
  | { kind: 'point'; P: Vec3 }
  | { kind: 'circularEdge'; axisP: Vec3; axisD: Vec3; planeP: Vec3; planeN: Vec3 }; // for insert

const assemblyRefCache: Map<string /* partPath#refKey */, PartLocalGeometry>;
```

`refKey` deterministically encodes the ref's `kind` + identifying fields (e.g., `FaceName` → `featureId|role|instance`). Built lazily on first reference; invalidated when its part is reloaded (assembly close → reopen rebuilds the cache).

## Constraint catalog — per-type residuals

For each constraint, both refs' `PartLocalGeometry` is transformed to **world coordinates** using the component's current pose (rotation `R` from quaternion + translation `T`). Direction vectors get only `R`; points get both. Residuals below are signed scalars; the solver minimizes `Σ rᵢ²`.

### Mate

- **face↔face.** Faces touch with normals **opposing** + offset along `N_A`.
  - `r₁ = N_A · (P_B − P_A) − offset`
  - `r₂ = (N_A + N_B) · u`, `r₃ = (N_A + N_B) · v` for orthonormal `(u, v) ⊥ N_A`
  - **3 scalars**
- **axis↔axis.** Collinear (with offset = 0) or parallel at perpendicular offset. One DOF (rotation around the shared axis) intentionally free.
  - Let `Δ = P_B − P_A`; `Δ_⊥ = Δ − (Δ · D_A) D_A`
  - `r₁, r₂` = components of `Δ_⊥` in basis `⊥ D_A` (with `||Δ_⊥|| = offset` when offset ≠ 0)
  - `r₃, r₄` = two components of `D_A × D_B` (parallel directions)
  - **4 scalars**
- **point↔point.** `r = P_B − P_A`. **3 scalars.**
- **point↔face.** `r = N · (P − P_face)`. **1 scalar.** Offset = 0 in v1.
- **point↔axis.** Perpendicular components of `P − P_axis` in basis `⊥ D_axis`. **2 scalars.**

### Flush (face↔face only)

Faces parallel, normals **same direction**, offset along `N_A`.
- `r₁ = N_A · (P_B − P_A) − offset`
- `r₂ = (N_A − N_B) · u`, `r₃ = (N_A − N_B) · v` for orthonormal `(u, v) ⊥ N_A`
- **3 scalars**

### Angle

Undirected angle between two directions (`N` for face, `D` for axis). For face↔axis, mix `N_A` with `D_B`.
- `r = (direction_A) · (direction_B) − cos(angle)`
- **1 scalar**

Sign ambiguity (the constraint is satisfied at both `+angle` and `−angle`) is resolved by initial-guess proximity — the solver converges to whichever side is closer to the current pose. **Directed angle** (with explicit rotation-axis ref) is deferred.

### Insert

Composite: axis-axis collinear + face-face mate (with offset along the shared axis), built from each side's circular edge.
- Each `circularEdge` ref resolves to `{ axisP, axisD, planeP, planeN }` (axis through edge center perpendicular to its plane + the planar face containing the edge).
- Solver expands at residual-build time:
  - 4 axis-axis residuals (collinearity + parallel directions)
  - 3 face-face mate residuals (offset + opposing normals)
- **7 scalars per insert constraint**
- One free DOF (rotation around the shared axis) by construction.

### Reference resolution (`AssemblyConstraintRefs.ts`)

| Ref kind / source | Extractor (existing) |
|---|---|
| `face` | `extractFacePlane` |
| `axis.cylindricalFace` | `extractCylinderAxis` |
| `axis.edge` | `extractEdgeLine` |
| `axis.workAxis` | `evaluateWorkAxis` (3c) |
| `point.vertex` | `extractEdgeEndpoint` |
| `point.workPoint` | `evaluateWorkPoint` (3c) |
| `circularEdge` (insert) | `extractCylinderInfo` + `extractFacePlane` on the edge's planar enclosing face |

Cached per `(partPath, refKey)`. World transform applied per solver iteration.

### Constraint validation

Each ref is validated at constraint-add time + at solve time. Failure modes (per-ref):
- Ref points at a deleted feature → broken-ref badge (3c pattern); constraint excluded from solve.
- Ref's part-local extract fails (e.g., `face` ref on a non-planar face, `axis` ref on a non-cylindrical face) → per-constraint diagnostic; constraint excluded from solve.

## Solver

### Unknowns

Per non-grounded component: 7 scalars — translation `T ∈ ℝ³` + quaternion `q ∈ ℝ⁴`. Stacked as `x ∈ ℝ^{7N}` where `N` = non-grounded count. Grounded components contribute zero unknowns; their poses are constants in residual evaluation.

### Quaternion gauge

Soft norm constraint per quaternion: `r_norm = ||q||² − 1`, weight `w_norm = 10`. After each accepted LM step, **hard-renormalize** each `q ← q / ||q||` to prevent drift. Calibrated so the norm penalty doesn't dominate but keeps `||q||` close to 1 between iterations.

### LM core

```
x ← initial pose (current ComponentInstance.pose, or Euler-derived if no pose)
λ ← λ₀
loop k = 0 .. max_iters:
  r = build_residuals(x)              // (M scalars: constraints + soft-norm rows)
  J = build_jacobian(x)               // (M × 7N), analytic per constraint
  H = JᵀJ + λ · diag(JᵀJ)             // Marquardt diagonal scaling
  g = Jᵀr
  Δx = solve(H · Δx = −g)             // dense Cholesky
  if ||r(x + Δx)|| < ||r(x)||:
    x ← x + Δx
    renormalize(q_*)
    λ ← λ / 2
    if ||r|| < ε_abs or ||Δx|| < ε_step: break
  else:
    λ ← λ · 2
    if λ > λ_max: break
return { x, finalResiduals: r, J_at_solution: J }
```

The higher-level `solveAssembly(doc, parameterValues, currentPoses)` wraps the LM core: it builds initial `x` from `currentPoses`, runs LM, computes the SVD of `J_at_solution`, decomposes `x` back into per-component `{ translation, quaternion }`, and returns `{ poses, J, svd, perConstraintResiduals, diagnostics }`. Free-DOF drag and the StatusBar segment consume this higher-level shape; the LM core is private to `AssemblyConstraintSolver.ts`.


Defaults:
- `λ₀ = 1e-3`, `λ_max = 1e8`
- `ε_abs = 1e-6` (mm-scale, well below any CAD tolerance)
- `ε_step = 1e-9`
- `max_iters = 50`
- `w_norm = 10` (soft-norm weight)
- `ε_resid = 1e-3` (mm) — per-constraint over-tolerance threshold for diagnostics
- `ε_rank = 1e-6` (relative to `σ_max`) — singular-value threshold for free-DOF detection

With ≤30 components → ≤210 unknowns; dense Cholesky on 210×210 ≈ 5 ms; 10–20 LM iters typical → comfortably under the 150 ms p95 budget.

### Jacobian construction

Each constraint contributes a `(rows × 14)` block (or `(rows × 7)` if one of its components is grounded; or skipped entirely if both are grounded). Rows = the constraint's residual count. Columns = the 7 unknowns of refA's component followed by the 7 of refB's.

Jacobians are **analytic** per constraint type:
- ∂(world point)/∂T = I₃; ∂(world point)/∂q = chain through quaternion-rotation derivative.
- ∂(world direction)/∂T = 0; ∂(world direction)/∂q = quaternion-rotation derivative on the local direction.

A `linalg.spec.ts` test compares each analytic Jacobian to a numerical (finite-difference) Jacobian on randomized inputs to 1e-6 relative tolerance.

### Rank / DOF / overconstrained detection

After convergence, SVD of `J`:
- σ < `ε_rank · σ_max` → free DOF; the column of `V` is the basis vector in 7N space.
- After solve, any residual `|rᵢ| > ε_resid` indicates that constraint conflicts / is redundant — its leaf gets a red over-tolerance badge.
- DOF status segment (`StatusBar`):
  - `0` free DOFs + no over-tolerance → "Assembly: fully constrained"
  - `>0` free DOFs → "Assembly: N DOF"
  - any `|rᵢ| > ε_resid` after max-iter exit → "Assembly: over-constrained"
  - max-iter exit with `||r|| > ε_abs` → "Assembly: solver did not converge"
  - segment hidden when no constraints exist

### Grounding semantics

- `groundedComponentIds[]` is the source of truth.
- **Auto-population:** `PlaceComponentCommand` on an `AssemblyDocument` with empty `groundedComponentIds` adds the new component's id. Subsequent placements don't auto-ground.
- **Toggle UX:** right-click on a component browser leaf → Grounded ☑ → adds / removes via `ToggleGroundedCommand`.
- If the user un-grounds the last grounded component while constraints exist:
  - solver records a "no grounded component — auto-anchored component X for this solve" diagnostic
  - solver auto-anchors `components[0]` for that solve only (does NOT mutate `groundedComponentIds`)
  - on the next user-driven re-grounding, the diagnostic clears

### Free-DOF drag projection

After every successful solve, the kernel returns `{ poses, J, svd }` to the main thread. The viewport caches the SVD's null-space basis `V_null` (columns of `V` with σ < `ε_rank · σ_max`).

When the user grabs an under-constrained component and drags:
1. Pointer-move handler computes a desired world-frame `Δpose` for the dragged component (translation in the screen-parallel plane; **rotation deferred** — drag in v1 is translation-only).
2. Embed `Δpose` into the 7N drag direction `d ∈ ℝ^{7N}` (zeros for non-dragged components).
3. Project: `d_proj = V_null · V_nullᵀ · d`. This is the closest-to-`d` motion that keeps every constraint satisfied.
4. Update `x_drag ← x + d_proj`. Renormalize quaternions. Apply to scene meshes immediately. **No LM iteration.**
5. Per-frame cost is one matrix-vector product on `V_null` (typically `7N × n_free` with `n_free ≤ 6`) — well under 1 ms.
6. On pointer-up, write back the dragged poses into `ComponentInstance.pose` and back-derive Euler `position` + `rotation` (decompose the quaternion). The next constraint add/edit will re-solve from this initial guess.

If the dragged component is fully constrained (no contribution to any null-space column), drag is a no-op with a brief flash of a locked-cursor visual.

### Numerical lib footprint

Vendor a minimal:
- **Dense SVD** — Jacobi-SVD, ~150 lines, deterministic. (Numeric.js's `svd` is a clean reference implementation, MIT-licensed; copy + retest in `linalg.spec.ts`.)
- **Cholesky solver** for symmetric positive-definite systems, ~50 lines.

Both go in `packages/kernel/src/assembly/linalg.ts` with their own unit tests. **No external numerical-library dependency.**

### Failure modes (all surface as diagnostics, never throw)

| Condition | Surface |
|---|---|
| Max-iter exit, `||r||_∞ > ε_resid` | "Solver did not converge" diagnostic + per-constraint red over-tolerance badges on offenders. Poses snap to last LM iterate. |
| Constraint references deleted component | Broken-ref red badge (3c pattern). Constraint excluded from solve. |
| Constraint ref's part-local extract fails (non-planar face on `face` ref, etc.) | Per-constraint diagnostic + excluded from solve. |
| All components grounded | No unknowns; trivially converged. |
| `groundedComponentIds` empty + constraints non-empty | Auto-anchor `components[0]` for this solve only + diagnostic. |

## UX

### Place Constraint dialog

```
┌─ Place Constraint ──────────────────────────────────┐
│ Type:  [ Mate ▾ ]                                    │
│        ─ Mate / Flush / Angle / Insert ─             │
│                                                      │
│ Selection 1:  [ Pick… ]  ⓘ Component2 / Face_3      │
│ Selection 2:  [ Pick… ]  ⓘ Component5 / Face_1      │
│                                                      │
│ Offset:  [ 0      ] mm   (or  =shelf_height)         │
│ ─ angle constraint shows "Angle: [..] °" instead ─   │
│                                                      │
│ [ Apply ]              [ Cancel ]   [ OK ]           │
└──────────────────────────────────────────────────────┘
```

- **Mode dropdown** swaps allowed pick targets per row + swaps the value field label.
- Each **Pick…** button hands the dialog over to `AssemblyRefPickController` (one controller, mode-driven, like 3c's `WorkPlanePickController`). Picked refs auto-fill the readout. Re-clicking Pick… replaces the prior pick.
- **Apply** persists + re-solves but keeps the dialog open (lay down many constraints back-to-back, Inventor-style). **OK** persists + re-solves + closes. **Cancel** discards and closes.
- Mode-specific allowed picks:
  - **Mate**: face / axis / point on each side (mixed pairings allowed per the catalog)
  - **Flush**: face on both sides
  - **Angle**: face / axis on each side
  - **Insert**: circular edge on each side (`AssemblyCircularEdgePickController` mode)
- **Live preview**: as Pick 2 lands, run the solver and show the resulting poses immediately. Cancel reverts to the pre-dialog state. Mirrors Hole / Sweep preview behavior.

### Pick controllers

`packages/app/src/model/AssemblyRefPickController.ts` — single controller, modes:

| Mode | Hit detection |
|---|---|
| `face` | Tessellated-triangle raycast → `TessellatedFace` lookup → `(componentId, FaceName)` (existing 3b/3c machinery, multi-mesh-aware) |
| `edge` | Tessellated-edge picker (3b pattern) → `(componentId, EdgeName)` |
| `axis` | Edge OR cylindrical face (auto-detect from hit), or work-axis browser pick |
| `point` | Vertex (edge endpoint within snap radius) or work-point browser pick |
| `circularEdge` | Edge picker filtered to circular edges (`isCircular` from the BRep adaptor) |

Hits carry `(componentId, refOnPart)`.

### Browser pane (extends 4a's structure)

```
Assembly: <name>
├── Components (N)
│   ├── ▾ ⛓ <componentName>                                ← ⛓ = grounded badge
│   │   ├── 🔗 Mate ↔ <otherComponent>.faceA
│   │   ├── ⟶ Insert ↔ <otherComponent>.boltEdge
│   │   └── ⊘ Mate ↔ <otherComponent>.faceB                ← ⊘ = suppressed, ghosted
│   ├── ▾ <componentName>                                   ← duplicate constraint leaves under both endpoints
│   │   └── 🔗 Mate ↔ <thisComponent>.faceA  🔴            ← 🔴 = residual exceeded tolerance
│   └── …
└── Origin                                                  ← 4d adds assembly work features here
```

- Constraint leaves are **view-model only** — both leaves under endpoints A and B point to one underlying constraint object. Edit / Delete on either touches the single backing object.
- Component leaf icons: ⛓ grounded; (none) free; 🔒 fully constrained by solver (no remaining free DOFs).
- Constraint leaf icons: 🔗 mate / ↔ flush / ∠ angle / ⟶ insert. Overlay badges: ⊘ suppressed, 🔴 over-tolerance, ⚠ broken-ref.
- Selecting a constraint leaf → glow both referenced components in the viewport.
- Component leaf right-click: Grounded ☑, Edit Position, Toggle Visibility, Delete.
- Constraint leaf right-click: Edit, Suppress / Unsuppress, Delete.
- Constraint leaf double-click: opens Edit dialog (= Place dialog populated with that constraint's values).

### Ribbon Assembly tab (extends 4a)

| Panel | Buttons |
|---|---|
| Component (existing) | Place / Edit / Delete |
| **Constraint (new)** | **Mate** / **Flush** / **Angle** / **Insert** (each opens Place Constraint dialog with mode pre-selected) / **Edit Constraint** / **Delete Constraint** / **Suppress** ⇄ **Unsuppress** |
| Manage (existing) | Save / Save As / Open Part — unchanged |

### Hotkeys

Assembly mode only, guarded against input focus, same dispatch pattern as 3c's `Ctrl+Shift+P`:

- `M` — Mate
- `F` — Flush
- `N` — Angle (avoids `A` collision with browser select-all)
- `I` — Insert
- `G` — Toggle Grounded on selected component
- `Ctrl+Shift+S` — Toggle Suppress on selected constraint

### StatusBar DOF segment

Extends the 2b sketch DOF widget with an assembly-mode branch:

| State | Text |
|---|---|
| n_free = 0, no over-tolerance residuals | "Assembly: fully constrained" |
| n_free > 0 | "Assembly: N DOF" |
| any post-solve residual > ε_resid | "Assembly: over-constrained" |
| max-iter exit with `||r|| > ε_abs` | "Assembly: solver did not converge" |
| no constraints | (segment hidden) |

## Commands

`Add*FeatureCommand` class pattern from 3c / 4a. `apply()` mutates store + persists via 4a's autosave + sets `solverDirty: true`. `revert()` restores prior state.

| Command | Type | Trigger |
|---|---|---|
| `OpenPlaceConstraintDialogCommand` | function | M / F / N / I hotkeys, ribbon Mate / Flush / Angle / Insert buttons |
| `AddAssemblyConstraintCommand` | class | Place dialog OK / Apply |
| `OpenEditAssemblyConstraintDialogCommand` | function | browser dbl-click on constraint leaf, ribbon Edit Constraint |
| `EditAssemblyConstraintCommand` | class | Edit dialog OK / Apply |
| `DeleteAssemblyConstraintCommand` | class | ribbon Delete Constraint, ctx-menu Delete, Delete key with constraint selected |
| `ToggleConstraintSuppressionCommand` | class | ctx-menu Suppress / Unsuppress, `Ctrl+Shift+S` |
| `ToggleGroundedCommand` | class | component ctx-menu Grounded ☑, `G` hotkey |

## Solver dispatch / cascade

Store extensions (`packages/app/src/store/useAppStore.ts`):

```ts
solverDirty: boolean
componentPoses: Map<string /* componentId */, { translation: Vec3; quaternion: [number, number, number, number] }>
solverDiagnostics: {
  dofCount: number;
  status: 'fully-constrained' | 'underconstrained' | 'over-constrained' | 'did-not-converge';
  perConstraint: Map<string /* constraintId */, { residual: number; conflict: boolean; brokenRef: boolean }>;
  message?: string;  // e.g., auto-anchor diagnostic
}
freeDofBasis: Float64Array | null  // V_null, n_free × 7N

placeConstraintDialogOpen: boolean
placeConstraintMode: 'mate' | 'flush' | 'angle' | 'insert'
editConstraintDialogOpen: boolean
editingConstraintId: string | null
editConstraintInitialValues: AssemblyConstraint | null
selectedConstraintId: string | null
```

Any of these set `solverDirty = true`:
- constraint add / edit / delete / suppress-toggle
- grounded-set change
- component add / delete (4a flows)
- parameter value change for any parameter referenced by a constraint
- component pose write-back from drag-along-free-DOFs (sets dirty, but at low priority — only triggers re-solve on the next mutation, not immediately)

A 50 ms-debounced effect in `App.tsx` consumes `solverDirty`, calls `solveAssembly(doc, parameterValues, currentPoses)`, writes back results.

**Parameter cascade.** On assembly load, register each constraint's parameter dependencies in `ParameterRegistry` (existing). On parameter value change, registry signals → store sets `solverDirty` → debounced solver runs. Same plumbing as 3b / 3c parametric cascade.

## Testing

### `packages/shared` unit
- `__tests__/assembly-constraints.spec.ts` — discriminator narrowing for `AssemblyConstraint` + `AssemblyConstraintRef`; `migrateManifest` defaults `constraints: []`, `groundedComponentIds: []`, and back-fills `pose` from Euler on legacy v7 assemblies.

### `packages/kernel` unit
- `assembly/__tests__/linalg.spec.ts` — SVD round-trip on random PD matrices to 1e-9; Cholesky solve on 1-50 dim PD systems; deterministic (same seed → identical output).
- `assembly/__tests__/residuals.spec.ts` — for each constraint type: random poses, analytic Jacobian vs. finite-difference Jacobian to 1e-6 relative tolerance.
- `assembly/__tests__/solver.spec.ts` — LM convergence on toy problems:
  - 2-component face-face mate (1 grounded), trivial.
  - 3-component cycle (mate A↔B, mate B↔C, mate C↔A), cycle closure.
  - Redundant set (two parallel mates that imply a third), residuals stay small + redundancy flag set.
  - No-grounded fallback: solver auto-anchors `components[0]`, records diagnostic.
- `assembly/__tests__/refs.spec.ts` — each ref kind resolves correctly given a stub BREP (use real OCCT but trivial parts).

### `packages/kernel` integration (real OCCT)
- `assembly/__tests__/AssemblyConstraintSolver.integration.spec.ts` — round-trip with real OCCT: seed two box parts, mate face-face via real `extractFacePlane`, verify world poses; insert bolt-in-hole on real cylindrical edges; angle between two cylindrical-face axes.

### `packages/app` unit
- `shell/__tests__/PlaceConstraintDialog.spec.tsx` — mode swap, pick-button dispatch, value field swap (offset ↔ angle), parametric input via `parseParamOrLiteral`.
- `shell/__tests__/BrowserPane.spec.tsx` (extend) — assembly view: component expansion, constraint leaves under both endpoints, suppress visual (⊘ + struck-through), broken-ref badge (⚠), over-tolerance badge (🔴), grounded badge (⛓).
- `shell/__tests__/StatusBar.spec.tsx` (extend) — assembly DOF segment all four states.
- `model/__tests__/AssemblyRefPickController.spec.ts` — mode routing for face / axis / point / circularEdge; correct `(componentId, refOnPart)` payload.
- `commands/__tests__/{Add,Edit,Delete}AssemblyConstraintCommand.spec.ts`, `commands/__tests__/{ToggleConstraintSuppression,ToggleGrounded}Command.spec.ts` — apply / revert.

### E2E (`tests/e2e/assembly/`)
- `create-mate-constraint.spec.ts` — seed 2 cube parts, place both, mate face-face, assert geometry hash reflects updated pose, browser leaf appears under both components.
- `insert-bolt-into-hole.spec.ts` — seed bolt + plate, insert via circular edges, assert axis collinear + face mate (within ε_resid).
- `angle-constraint.spec.ts` — two axes at 45°, assert pose.
- `suppress-constraint.spec.ts` — place mate, suppress, drag → free movement; unsuppress → snap back on next mutation.
- `ground-toggle.spec.ts` — change grounded component, assert solve repins to new ground.
- `parametric-angle-cascade.spec.ts` — angle = `=hinge_open`; edit param, assert pose updates (cascade through ParameterRegistry → solver).
- `broken-ref-after-part-edit.spec.ts` — create constraint, edit part to remove the referenced face, reload assembly, assert broken-ref badge.
- `drag-along-free-dof.spec.ts` — fully-constrained component except one rotational DOF; drag along that DOF; assert constraint residuals stay below ε_resid.

### Perf (`tests/perf/`)
- `assembly-solve.spec.ts` — synthetic 20-component / 30-constraint scenario, p95 < 150 ms over 50 trials.
- `assembly-drag-free-dof.spec.ts` — 20 drag frames on a 20-component scenario, p95 < 16 ms.

E2E uses 4a's `seedAssemblyPart` + `__zilventorPackProject` + `__zilventorGetOpfs` dev hooks. New dev hooks added in 4b:
- `__zilventorAssemblySolverResult` — last-solve `{ diagnostics, componentPoses, freeDofBasis }`.
- `__zilventorTriggerAssemblySolve` — force-solve, bypass debounce.

## Deferred / not in this release

- **Tangent** constraint (cylinder-plane, cylinder-cylinder).
- **Symmetric** constraint.
- **Transitional** constraint (cam follower).
- **Directed angle** (with explicit rotation-axis ref) — v1 is undirected only.
- **Drive Constraint** (animate by sweeping a value).
- **Solution flip** UI for axis-axis at non-zero offset (two valid sides — v1 picks closest to current pose, no flip button).
- **Drag with rotation** along free DOFs — v1 drag is translation-only.
- **Constraint inference on placement** (auto-mate on drop).
- **Sub-assemblies** — entire 4d.
- **BOM** — entire 4c.
- **Section / exploded views, animation.**
- **Update button** for stale part refs — single-document model means a part is reloaded on assembly open; cache rebuilds; not needed.
- **Multi-anchor groups / weld groups.**
- **Per-constraint visualization** (e.g., highlight the conflicting constraint set in the viewport beyond the badge).

## Explicitly not refactored

- `formatVersion` stays at **7** — additive changes, migration shim handles defaults.
- 4a's Edit Component dialog stays literal-only X/Y/Z/RX/RY/RZ; semantics shift to "initial guess for the next solve" without UI changes.
- Single-document model unchanged.
- Sketch-mode planegcs solver and assembly LM solver are independent — no shared abstraction.
- The Model ribbon tab keeps its current shape; remains hidden in assembly mode.

## File references

| Layer | Files |
|---|---|
| Spec (this file) | `docs/superpowers/specs/2026-04-26-subproject-4b-assembly-constraints-design.md` |
| Shared types | `packages/shared/src/types.ts` (extend) |
| Shared tests | `packages/shared/src/__tests__/assembly-constraints.spec.ts` |
| Kernel solver | `packages/kernel/src/assembly/{AssemblyConstraintSolver,AssemblyConstraintRefs,linalg}.ts` |
| Kernel tests | `packages/kernel/src/assembly/__tests__/{solver,residuals,refs,linalg}.spec.ts` + `__tests__/AssemblyConstraintSolver.integration.spec.ts` |
| App pick controller | `packages/app/src/model/AssemblyRefPickController.ts` (+ spec) |
| App commands | `packages/app/src/commands/{OpenPlaceConstraintDialog,AddAssemblyConstraint,OpenEditAssemblyConstraintDialog,EditAssemblyConstraint,DeleteAssemblyConstraint,ToggleConstraintSuppression,ToggleGrounded}Command.ts` (+ specs) |
| App dialog | `packages/app/src/shell/PlaceConstraintDialog.tsx` (+ spec) |
| App browser pane | `packages/app/src/shell/BrowserPane.tsx` (extend assembly branch) |
| App ribbon | `packages/app/src/shell/tabs/AssemblyTab.tsx` (extend with Constraint panel) |
| App status bar | `packages/app/src/shell/StatusBar.tsx` (extend DOF segment for assembly) |
| App store | `packages/app/src/store/useAppStore.ts` (constraint dialog slice + grounded set + componentPoses + solverDiagnostics + freeDofBasis + solverDirty) |
| App glue | `packages/app/src/App.tsx` (constraint dialog wiring, M/F/N/I/G/Ctrl+Shift+S hotkeys, solver-debounce effect, drag-along-free-DOFs handler) |
| Viewport | `packages/app/src/viewport/SceneManager.ts` (apply `pose` over Euler in `setComponentMeshes`; expose null-space drag method) |
| E2E | `tests/e2e/assembly/{create-mate-constraint,insert-bolt-into-hole,angle-constraint,suppress-constraint,ground-toggle,parametric-angle-cascade,broken-ref-after-part-edit,drag-along-free-dof}.spec.ts` |
| Perf | `tests/perf/{assembly-solve,assembly-drag-free-dof}.spec.ts` |
