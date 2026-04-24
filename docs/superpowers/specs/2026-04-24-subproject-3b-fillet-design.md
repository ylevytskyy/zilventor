# Sub-project 3b — Parametric Fillet Design Spec

**Date:** 2026-04-24
**Status:** Draft, awaiting implementation plan.
**Precedent:** Sub-project 3a (parametric revolve) established the feature-tree + previewFeature + parametric-parameter patterns. 3b follows the same shape and builds the topological-naming infrastructure needed for all future edge/face-selecting features (chamfer, shell, hole, sweep).

## Goal

Add a parametric Inventor-parity **fillet** feature to ZilInventor. User selects edges on the running body, supplies a parametric radius (constant or variable), optionally tunes setbacks where 3+ fillet edges converge at a vertex, and sees a debounced live preview before committing. Fillets survive parametric edits to upstream features via a **topological naming** layer that identifies each edge by the pair of faces it borders, not by its OCCT index.

## Scope

**In scope:**
- All four Inventor-2012 edge-selection modes: Edge, Loop (tangent-continuous chain), Feature (all edges of a given feature), All Fillets (concave-dihedral auto-filter), All Rounds (convex-dihedral auto-filter).
- Constant-radius and variable-radius (per-edge with linear radius transition between startRadius and endRadius at the edge's two vertices).
- Full editable setbacks at vertices where ≥3 fillet edges converge.
- Parametric radii and setbacks backed by `ParameterRegistry` (literals OR expressions like `r_fillet + 1`).
- 200 ms debounced live preview via `kernel.previewFeature`.
- Inline parse errors under every parameter field; preview-error badge in dialog footer (mirrors 3a F1/F2 pattern).
- Feature-tree badge + re-open-in-edit-mode UX when a committed fillet fails to re-resolve on regenerate (e.g. because a parametric edit removed an edge).
- Topological naming layer retrofitted onto `SketchFeature` / `ExtrudeFeature` / `RevolveFeature` so every face produced by the kernel carries a stable `FaceName`.
- File format bumps v5 → v6.

**Out of scope (deferred):**
- Chamfer, shell, hole, sweep — each a separate sub-project (3c / 3d / 3e / 3f).
- Edge selection in sketch mode (this is Model-mode only).
- Hole wizard-style templates (separate sub-project).
- XZ / YZ sketch planes (3a's F5 deferral still applies — 3b's fillet works only on bodies generated from XY-plane sketches).

## Architecture

### Layer decomposition

Follows the 2a/2b/2c/3a pattern (shared → kernel → app).

- **`packages/shared/src/types.ts`** — new `FilletFeature` variant on the `Feature` union, plus supporting types `FaceName`, `EdgeName`, `FilletEdgeSpec`, `VertexSetback`, `FilletSelectionMode`, `ParamOrLiteral`. File format constant `CURRENT_FORMAT_VERSION = 6`.
- **`packages/shared/src/fileFormat.ts`** — v5→v6 migration (no-op; v5 files load without fillet features).
- **`packages/kernel/src/occt/FaceNaming.ts`** (new) — the topological-naming layer. Exports `NamedShape`, `attachName`, `canonicalEdgeName`, `resolveEdge`, `resolveVertex`.
- **`packages/kernel/src/occt/FilletOps.ts`** (new) — thin OCCT wrapper over `BRepFilletAPI_MakeFillet`. Accepts a resolved `FilletRequest` (OCCT edge handles, not names) and returns `Result<OcctShape, KernelError>`.
- **`packages/kernel/src/adapter/features/SketchFeature.ts`** — retrofit to produce `NamedShape` instead of bare `OcctShape`. Sketch is 2D so faces map is degenerate (the wire carries the sketch id forward for downstream consumers).
- **`packages/kernel/src/adapter/features/ExtrudeFeature.ts`** — retrofit to emit `NamedShape` with faces labelled `E{id}/top`, `E{id}/bottom`, `E{id}/side/{n}` where `n` is a 0-based index over the profile's wire edges.
- **`packages/kernel/src/adapter/features/RevolveFeature.ts`** — retrofit to emit `NamedShape` with faces labelled `R{id}/lateral` plus `R{id}/cap_start` / `R{id}/cap_end` for partial (non-360°) sweeps.
- **`packages/kernel/src/adapter/features/FilletFeature.ts`** (new) — adapter. Given the current `NamedShape` + a `FilletFeature`, resolves each stored `EdgeName` to an OCCT edge via `resolveEdge`, assembles a `FilletRequest`, calls `makeFillet`, and returns a new `NamedShape` preserving surviving face names and labelling newly-created blend faces as `F{id}/blend/{n}`.
- **`packages/kernel/src/adapter/FeatureTree.ts`** — extended with a `'fillet'` branch and an optional `featureErrors: Map<featureId, KernelError>` on `ExecutionResult` so a downstream fillet that fails doesn't abort the whole execute — it merely surfaces the error while preserving the last-successful body.
- **`packages/kernel/src/api.ts`** — no new RPC shape; `previewFeature` and `execute` already carry the required types once `ExecutionResult` extends with `featureErrors`.
- **`packages/app/src/commands/AddFilletFeatureCommand.ts`** (new) — mirrors `AddRevolveFeatureCommand`: writes radius / setback / variable-radius parameters to `ParameterRegistry` + kernel, adds the feature, executes, mirrors the updated part into the store, and implements the F6-compensation-on-throw + F7-cancel-cleanup patterns from 3a.
- **`packages/app/src/shell/FilletDialog.tsx`** (new) — Inventor-parity three-tab panel (Edges / Variable / Setbacks) + a 5-way selection-mode toggle. Follows the persistent-panel styling of `DimensionDialog` / `RevolveDialog`.
- **`packages/app/src/model/EdgePickController.ts`** (new) — 3D edge hit-test against the running body's tessellated edges, with the 5 selection modes. Augments the existing `AxisPickController` pattern.
- **`packages/app/src/App.tsx`** — wires Fillet ribbon button + `F` shortcut, renders the dialog, routes pointer events to `EdgePickController` when in fillet-edge-pick mode, schedules debounced previews, cleans up scratch parameters on cancel.
- **`packages/app/src/shell/BrowserPane.tsx`** — extended with a per-feature warning badge when the feature's id is present in the store's `featureErrors` map. Click → re-open dialog in edit mode with the offending edge highlighted.

### Feature-tree integration

`FilletFeature` is a modifier on the running body (unlike extrude / revolve which are body-generators under a `BooleanOperation`). In `executeTree`:

```ts
} else if (feature.kind === 'fillet') {
  if (!finalSolid) {
    featureErrors.set(feature.id, err('Fillet has no body to modify'));
    continue;
  }
  const result = executeFilletFeature(oc, finalSolid, feature, paramResolver);
  if (!result.ok) {
    featureErrors.set(feature.id, result.error);
    continue;  // preserve pre-fillet body; don't abort
  }
  disposeShape(finalSolid.shape);
  finalSolid = result.value;  // NamedShape
}
```

No `BooleanOperation` on `FilletFeature` — always in-place.

### Running-body type change

`finalSolid` in `FeatureTree` becomes `NamedShape | null` (was `OcctShape | null`). All call sites that reach into `.handle` adjust to `.shape.handle`. The mesh-tessellation step unwraps `.shape`. Preview and execute both return `NamedShape`-based results; `previewFeature` discards the naming map after tessellation.

### ExecutionResult extension

```ts
export type ExecutionResult = {
  mesh: Mesh;
  finalSolid: OcctShape;
  featureErrors?: Map<string, KernelError>;  // NEW — populated on partial failure
};
```

Callers (App.tsx's execute `useEffect`) read `featureErrors` and mirror into `useAppStore`'s `featureErrors` slice so `BrowserPane` can render badges.

## Components & data types

### Shared types

```ts
export type FaceName = {
  featureId: string;            // the feature that produced the face
  role: string;                 // 'top' | 'bottom' | 'side' | 'lateral' | 'cap_start' | ...
  instance?: number;            // 0-based, for roles with multiple faces (e.g. extrude side faces)
};

export type EdgeName = {
  faceA: FaceName;
  faceB: FaceName;
};
// canonicalEdgeName(A, B) sorts faceA/faceB so {A,B} === {B,A} structurally.

export type FilletSelectionMode = 'edge' | 'loop' | 'feature' | 'all-fillets' | 'all-rounds';

export type ParamOrLiteral =
  | { kind: 'param'; paramName: string }
  | { kind: 'literal'; value: number };

export type FilletEdgeSpec = {
  edgeId: EdgeName;                         // topological identity
  selectionMode: FilletSelectionMode;        // how the edge entered the set (for UI re-hydration)
  radius: ParamOrLiteral;                    // constant-mode radius
  variableRadii?: {                          // variable-mode override
    startRadius: ParamOrLiteral;
    endRadius: ParamOrLiteral;
  };
};

export type VertexSetback = {
  vertexId: { edges: EdgeName[] };           // vertex identified by its ≥3 converging edges
  perEdgeSetbacks: Array<{ edgeId: EdgeName; setback: ParamOrLiteral }>;
};

export type FilletFeature = {
  kind: 'fillet';
  id: string;
  mode: 'constant' | 'variable';
  edges: FilletEdgeSpec[];
  setbacks: VertexSetback[];                 // empty array if user didn't touch Setbacks tab
};
```

### Kernel — NamedShape + resolver

```ts
// packages/kernel/src/occt/FaceNaming.ts

export type NamedShape = {
  shape: OcctShape;
  faceNames: Array<{ name: FaceName; face: unknown }>;  // parallel arrays avoid Map equality issues
};

export function namedFace(featureId: string, role: string, instance?: number): FaceName;
export function attachName(nm: NamedShape, face: unknown, name: FaceName): void;
export function canonicalEdgeName(a: FaceName, b: FaceName): EdgeName;
export function resolveEdge(nm: NamedShape, edgeName: EdgeName): unknown | null;
// resolveEdge finds the two faces by deep-equal name comparison, then uses
// TopExp_Explorer over the shape to find the unique edge shared by both faces.

export function resolveVertex(nm: NamedShape, vertexId: { edges: EdgeName[] }): unknown | null;
// resolveVertex: resolve all edges, then find their common vertex via TopExp.
```

### Kernel — FilletOps wrapper

```ts
// packages/kernel/src/occt/FilletOps.ts

export type FilletRequest = {
  edges: Array<{
    edge: unknown;                            // resolved TopoDS_Edge
    radius: number;                           // constant mode
    variable?: { startRadius: number; endRadius: number };
  }>;
  setbacks: Array<{ vertex: unknown; edge: unknown; setback: number }>;
};

export function makeFillet(
  oc: OcctInstance,
  solid: OcctShape,
  req: FilletRequest
): Result<OcctShape, KernelError>;
// BRepFilletAPI_MakeFillet_2, per-edge .Add(radius, edge) or .Add(startR, endR, edge)
// for variable (uses a 2-point TColgp_Array1OfPnt2d internally). SetFilletShape /
// per-vertex setback API for the setbacks.
```

### FilletFeature adapter

```ts
// packages/kernel/src/adapter/features/FilletFeature.ts

export function executeFilletFeature(
  oc: OcctInstance,
  runningBody: NamedShape,
  feature: FilletFeature,
  resolveParam: (p: ParamOrLiteral) => Result<number, KernelError>
): Result<NamedShape, KernelError>;
```

Flow:
1. Resolve each `FilletEdgeSpec.edgeId` via `resolveEdge(runningBody, spec.edgeId)`. Null → `err({ kind: 'edgeNotFound', ... })`.
2. Resolve each `radius` / `startRadius` / `endRadius` via `resolveParam`.
3. Build `FilletRequest`, call `makeFillet`.
4. On success: walk the result's faces. For each face, look up in `runningBody.faceNames` by OCCT `TopoDS_Shape.IsSame` — surviving faces keep their name. For each newly-created face (not IsSame to any input face), assign `F{feature.id}/blend/{n}` where `n` is a running counter.
5. Dispose original shape; return new `NamedShape`.

Lifecycle discipline matches 3a's T4/T5/T6 standard: every `new oc.X_N()` disposed on every exit path (happy, `!IsDone`, guarded error, thrown). Blend-face name assignment uses the OCCT `GeneratedFromEdge` / `Modified` APIs to trace provenance where available.

### App — FilletDialog

Persistent panel (fixed position, top-right, ~400 px wide — wider than RevolveDialog because of the edge list). Three tabs:

- **Edges tab** (default):
  - Mode toggle at top: Constant / Variable.
  - Constant-radius field (parametric expression, same affordances as revolve's Angle field — inline error under field).
  - Selection-mode toggle: 5-way button row (Edge / Loop / Feature / All Fillets / All Rounds).
  - "Add" button: puts app in edge-pick mode using the selected selection-mode.
  - Edge-list table: rows of `[mode icon] [edge label: faceA.role–faceB.role] [× remove]`.
  - "Clear All" button.
- **Variable tab** (enabled only when `mode === 'variable'`):
  - Per-edge row: `[edge label] [startRadius field] [endRadius field]` + a small gradient-bar preview showing the linear transition.
  - Inline errors under each field.
- **Setbacks tab**:
  - Auto-populated list of vertices where ≥3 fillet edges converge (derived from the current `FilletEdgeSpec[]`).
  - Per-vertex row: a nested list of `[edge-at-this-vertex] [setback field]` + default values auto-computed.
  - Edit → stores in `VertexSetback[]`. Unedited vertices stay at auto-computed defaults.

Bottom action row: preview-error badge (mirrors 3a F2), OK / Cancel / Apply. OK/Apply disabled when any parameter field has a parse error or when the edge list is empty.

### App — EdgePickController

```ts
// packages/app/src/model/EdgePickController.ts

export class EdgePickController {
  setNamedShape(shape: NamedShape, tessellatedEdges: TessellatedEdge[]): void;
  setMode(mode: FilletSelectionMode): void;
  highlight(screenPoint: { x: number; y: number }): EdgeName[] | null;
  pick(screenPoint: { x: number; y: number }): EdgeName[] | null;
}

type TessellatedEdge = {
  edgeName: EdgeName;
  segments: Array<[Vec3, Vec3]>;           // world-space line segments for hit-testing
  faceNames: [FaceName, FaceName];         // the two adjacent faces
  dihedralAngle?: number;                  // for all-fillets / all-rounds filtering
};
```

- `highlight(point)` is called on every pointer-move (debounced to 16 ms) while the dialog is in pick mode, returning the edge(s) the picker would select. App.tsx renders the returned set as a hover-overlay three.js line.
- `pick(point)` commits. Returns the same set; App.tsx adds them to the dialog's working list.
- Mode `'loop'`: starting from the hit edge, walk the edge-face graph via G1-continuity (dihedral change ≤ 5° at shared vertex) until termination.
- Mode `'feature'`: collect all edges whose both adjacent faces reference the hit edge's primary face's `featureId`.
- Mode `'all-fillets'`: filter all body edges where dihedralAngle > 180° (concave / inside corner).
- Mode `'all-rounds'`: filter where dihedralAngle < 180° (convex / outside corner).

Tessellated edges are built from the `NamedShape` once per execute cycle (tessellation already happens for rendering; we piggyback on it to emit per-edge segment lists keyed by `EdgeName`).

### App — AddFilletFeatureCommand

Mirrors `AddRevolveFeatureCommand`:
- Constructor: `(partId, feature, radiusExpression, variableExpressions, setbackExpressions, kernel, registry, store)`.
- `apply`: writes every parametric expression (radius, variable startR/endR, setbacks) to `ParameterRegistry` with F6-compensation-on-throw: wrap kernel calls in try/catch; on throw, `registry.removeParameter` for every parameter it wrote, then rethrow.
- `revert`: remove the feature, remove all parameters the command created.

## Data flow

### 1. Place a fillet (happy path)

1. User presses `F` in Model mode; `FilletDialog` opens.
2. Default tab is Edges. Default mode is Constant. Default selection-mode is Edge. Default radius `r_fillet` (literal value 2 for the first fillet; subsequent fillets increment `r_fillet_2` etc.).
3. User clicks "Add" → App enters edge-pick mode.
4. Pointer-move: `EdgePickController.highlight(p)` returns the candidate edge set; App renders hover-overlay in three.js.
5. Click: `EdgePickController.pick(p)` returns the committed edge set; App appends to dialog's working list with `selectionMode` = current mode.
6. User tweaks radius; `onDraftChange` fires.
7. Debounced 200 ms → `schedulePreview` assembles a scratch `FilletFeature` + calls `kernel.previewFeature(partId, scratch)`. Kernel runs the virtual tree, resolves edges via `resolveEdge`, calls `makeFillet`, returns tessellated mesh. App renders preview at 50% opacity.
8. OK → `AddFilletFeatureCommand.apply()` writes parameters + feature + executes + mirrors to store. Clears preview + closes dialog.

### 2. Parametric cascade

User edits `r_fillet` in the Parameters panel:
1. `ParameterRegistry.setParameter(...)` fires subscribers.
2. App.tsx subscriber pushes to kernel's parts map (3a's T18 fix).
3. Store's `activePart` changes → App's execute effect runs `kernel.execute(partId)`.
4. `executeTree` replays; at the fillet step, `resolveEdge` re-finds edges by face-name in the regenerated body.
5. New mesh lands.

If an upstream parameter edit destroys a face that a downstream fillet edge references, `resolveEdge` returns null → `executeFilletFeature` returns `err({ kind: 'edgeNotFound', ... })` → `executeTree` records the error in `featureErrors` and continues with the pre-fillet body. App.tsx renders a toast + `BrowserPane` shows a warning badge on the feature.

### 3. Selection-mode resolution

- **Edge**: picker returns `[hitEdge]`.
- **Loop**: picker walks the edge graph from `hitEdge` via tangency.
- **Feature**: picker returns all edges whose adjacent faces both reference `hitEdge.primaryFace.featureId`.
- **All Fillets**: picker returns all body edges with concave dihedral.
- **All Rounds**: picker returns all body edges with convex dihedral.

Dialog displays: `5 edges (Loop)`.

### 4. Variable-radius preview

OCCT's `BRepFilletAPI_MakeFillet.Add(TColgp_Array1OfPnt2d)` takes `(parameter, radius)` pairs. For MVP: two points — `(0, startRadius)` and `(1, endRadius)`. OCCT interpolates linearly. (The 2d in `Pnt2d` is (parameter, radius), not xy.)

### 5. Setback auto-compute

After the user adds edges, a synchronous pass on the main thread finds vertices where ≥3 fillet edges converge. For each, queries OCCT for the auto-computed setback if the binding exposes it (`BRepFilletAPI_MakeFillet.DefaultSetback` is not guaranteed on opencascade.js 2.0.0-beta; if missing, default to `min(adjacent_edge_lengths) / 2`). Dialog displays defaults; user-edited values override in `VertexSetback[]`.

### 6. Partial failure recovery

`executeTree` change: errors from fillet (or any future modifier) do not abort the tree. Failed feature's error goes into `featureErrors`; body stays at pre-feature state. UI surfaces errors via `BrowserPane` badge + dialog re-open flow.

## Error handling

### KernelError variants added

- `filletFailed` — OCCT's `MakeFillet` threw or `IsDone()` returned false.
- `edgeNotFound` — `resolveEdge` returned null for at least one stored `EdgeName`. Error payload includes the offending `edgeName`.
- `filletSelfIntersection` — OCCT reports self-intersection (radius exceeds local surface curvature).

All errors carry `featureId` + `correlationId` via the existing `KernelError` envelope.

### User-facing surfaces

1. **Inline parameter-field errors** — mirrors 3a F1. Validation via `ParameterRegistry.dryRun()`. Radius / startR / endR / setback fields each have their own error slot.
2. **Preview-error badge** — mirrors 3a F2. Dialog-footer badge populated when `previewFeature` returns an err.
3. **Feature-tree warning badge** — new infrastructure. When `executeTree` returns `featureErrors`, App.tsx mirrors into store's `featureErrors` slice. `BrowserPane` renders a small `⚠` indicator next to any feature whose id is in the map. Click → opens the Fillet dialog in edit mode with the offending edge highlighted in red and a banner "Edge {name} no longer exists. Re-pick or remove."
4. **Toast** — for save/load errors and uncaught command failures (unchanged).

### Degenerate-input guards (kernel side)

Before calling OCCT:
- `radius <= 0` → `invalidParameter`.
- `feature.edges.length === 0` → `invalidParameter("Fillet has no edges; pick at least one")`.
- Variable-mode `startRadius` / `endRadius` ≤ 0 → `invalidParameter`.
- `setback <= 0` → `invalidParameter`.
- `setback > edgeLength(edge)` → `filletFailed` with guidance.

### F6/F7 patterns carried forward from 3a

- `AddFilletFeatureCommand.apply()` wraps kernel calls in try/catch; on throw, compensates by removing any parameter it wrote before rethrowing.
- `onFilletCancel()` deletes scratch parameters written during preview (tracked in a ref like `scratchParamNamesRef`).

## Testing

### Shared package

- `types.spec.ts` — typechecks every `FilletFeature` shape; discriminated-union narrowing works.
- `fileFormat.spec.ts` — v5 manifests load; v6 round-trips with fillet features.
- `canonicalEdgeName.spec.ts` — order invariance; deep-equal matching.

### Kernel OCCT

- `FilletOps.integration.spec.ts`:
  - Constant 2 mm fillet on all 12 edges of a 10×10×10 cube → bbox ≈ cube; 12 blend faces; volume < cube.
  - Variable 1→3 mm fillet on one edge → converges; non-zero tris.
  - 2 mm setback on a shared-vertex edge → blend terminates before vertex.
  - 6 mm fillet on 10 mm cube → `filletFailed` (self-intersection).
  - Handle leak check via `oc._numObjects()` delta.
- `FaceNaming.spec.ts` — unit tests: attach/resolve/canonicalEdge deep equality.

### Kernel adapter

- `SketchFeature.integration.spec.ts` — extended: return value is `NamedShape`.
- `ExtrudeFeature.integration.spec.ts` — extended: rectangle extrude produces 6 named faces (`top`, `bottom`, `side/0..3`); bbox unchanged.
- `RevolveFeature.integration.spec.ts` — extended: 360° revolve produces `lateral` + optional `cap`; partial produces `lateral` + `cap_start` + `cap_end`.
- `FilletFeature.integration.spec.ts` (new):
  - Cube + top-4-edge fillet at 2 mm → tris > cube tris; bbox ≈ cube.
  - Fillet + upstream param change → fillet re-resolves via face-names.
  - Edge removed by upstream edit → `featureErrors` populated; finalSolid = pre-fillet.

### Kernel FeatureTree

- Extensions to existing suite:
  - "extrude new + fillet top edges" — body modified in place; surface area larger than cube.
  - "Fillet before any extrude/revolve" → `invalidParameter`.
  - Partial-failure: commit fillet + edit upstream to break it → `executeTree` returns with `featureErrors` non-empty + finalSolid preserved.

### App package

- `AddFilletFeatureCommand.spec.ts` — mirrors `AddRevolveFeatureCommand` tests.
- `FilletDialog.spec.tsx` — all 3 tabs render; mode toggle switches enable state; inline errors; preview-error badge; selection-mode toggle; add/remove.
- `EdgePickController.spec.ts` — hit-test on mocked edge set; loop via tangency graph; feature-filter by `featureId`; all-fillets / all-rounds by dihedral.
- `ParameterRegistry.spec.ts` — extended: `dryRun` for fillet parameters.

### E2E (`tests/e2e/model/`)

Uses `seedKernelPart` helper from 3a F8.

- `place-fillet-box.spec.ts` — seed cube; open dialog via `F`; Add, click top edge, radius 2, OK; assert `Fillet1` in tree; triangle count grows.
- `fillet-loop-selection.spec.ts` — seed cube; Loop mode; click one top edge → 4 edges picked; OK; 4 blend faces.
- `fillet-parametric-cascade.spec.ts` — seed cube with `d1 = 10`; fillet top edges at `r_fillet = 2`; edit `d1 → 20`; assert cube grows AND fillet edges still rounded.
- `fillet-edge-lost.spec.ts` — seed cube + fillet; edit sketch to remove the filleted edge's face; assert tree badge + toast; click badge → dialog opens in edit mode with bad edge highlighted.

### Perf (`tests/perf/`)

- `fillet-preview-debounce.spec.ts` — 10 radius changes in ~1 s; assert ≤3 `previewFeature` RPCs and wall time ≤ 2 s (same thresholds as revolve's F10).

### Manual checklist

`docs/superpowers/manual-tests/subproject-3b.md` — golden path, loop/feature/all-modes selection, variable radius, setbacks, parametric cascade, edge-lost UX, save/reopen, error paths.

## File format change

`CURRENT_FORMAT_VERSION: 5 → 6`. Migration is additive and no-op for v5 files. v6 manifests include fillet features; older app versions cannot load v6 (file version rejects with a "this file was saved by a newer version" error — matches existing semantics).

## Out of scope / deferred

- **Chamfer** — sub-project 3c. Will reuse `EdgePickController` and the naming layer.
- **Shell** — sub-project 3d. Needs `FacePickController` (new).
- **Hole** — sub-project 3e. Hole-wizard template (countersink, counterbore, drill-through-tap, etc.) is a substantial separate design.
- **Sweep** — sub-project 3f. Profile + path dual-selection.
- **Non-XY sketch planes** — 3a's F5 deferral still applies. Fillets work on bodies derived from XY sketches only.
- **Fillet undo/redo semantics for partial failures** — when a committed fillet fails on regenerate, the current design surfaces the error and preserves pre-fillet body. If the user hits undo, the fillet feature is removed entirely. There is no "temporary pause" state for the fillet. Re-picking is the recovery path.

## Risk register

1. **Topological naming correctness across all feature types.** The naming retrofit for `SketchFeature` / `ExtrudeFeature` / `RevolveFeature` is the biggest single piece of new infrastructure. Extrude labels are straightforward (top/bottom/side); revolve's lateral / cap naming is straightforward for 360° and partial; sketch is degenerate. Risk: the `TopoDS_Shape.IsSame` comparison used to identify surviving faces after OCCT operations may miss faces that were modified but not re-created. Mitigation: integration tests exercise the full sketch → extrude → fillet → parameter-edit cascade.
2. **OCCT self-intersection errors.** `MakeFillet` reports `IsDone() = false` but doesn't always tell you *which* edge caused the failure. The spec's error message for `filletFailed` lists the offending radius and the first-listed edge as a heuristic; if users find this confusing we can invest in narrowing.
3. **Variable-radius binding.** `BRepFilletAPI_MakeFillet.Add(TColgp_Array1OfPnt2d)` overload may have a different numbered suffix in opencascade.js 2.0.0-beta. Following the 3a T4 / T5 pattern: first implementation pass tries the most likely suffix; integration test failure with "is not a constructor" is the signal to check `opencascade.full.d.ts`.
4. **Setback binding availability.** `SetFilletShape` / per-vertex setback APIs may not be fully exposed. If missing, the Setbacks tab degrades to read-only auto-computed values; users can still adjust radius transitions at edge endpoints to approximate a setback.
5. **EdgePickController hit-test performance** on large bodies. At MVP scale (a few hundred edges on a single-extrude body), linear scan is fine. If perf regresses for fancier parts, a spatial index can be added later.
6. **`featureErrors` backward compatibility.** Existing callers of `executeTree` who don't read `featureErrors` will not notice the field. Type-level additive change. `previewFeature` propagates `featureErrors` through unchanged.

## Implementation sequencing (high-level, for the plan)

The plan will decompose these phases into tasks:

1. **Phase 1 — Shared layer.** Types + v5→v6 migration.
2. **Phase 2 — Topological naming.** `FaceNaming.ts` (types + helpers + resolver) with unit tests.
3. **Phase 3 — Feature retrofits.** `SketchFeature` / `ExtrudeFeature` / `RevolveFeature` emit `NamedShape`. Integration tests verify face naming.
4. **Phase 4 — FilletOps.** `makeFillet` + integration tests (constant, variable, setback, error paths).
5. **Phase 5 — FilletFeature adapter + FeatureTree branch.** Integration tests covering happy path + parametric cascade + partial-failure.
6. **Phase 6 — ExecutionResult.featureErrors.** API extension + propagation.
7. **Phase 7 — App command.** `AddFilletFeatureCommand` with F6/F7 patterns. Unit tests.
8. **Phase 8 — Dialog.** `FilletDialog` (Edges / Variable / Setbacks tabs, mode toggle, selection-mode toggle). Unit tests.
9. **Phase 9 — EdgePickController.** Hit-test + 5 modes + unit tests.
10. **Phase 10 — App wiring.** Ribbon button, `F` shortcut, pick routing, schedulePreview, BrowserPane badge + re-open handler.
11. **Phase 11 — E2E.** Four Playwright specs + the perf debounce spec.
12. **Phase 12 — Docs + ship.** Manual checklist, memory update, final review, push.

Rough estimate: 30-35 tasks. Comparable to 3a.
