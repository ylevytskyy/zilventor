# Sub-project 3a — Parametric Revolve Design Spec

**Status:** Design approved 2026-04-24. Implementation complete 2026-04-24 (T1-T21 shipped; T22 pending final review + push).

**Post-implementation clarifications:** see the "Implementation deltas (post-T21 clarifications)" appendix at the bottom for items that shifted during build.

**Scope:** Single new solid-producing feature — `revolve`. Along the way, retrofit `extrude` with a boolean-operation field and migrate the feature-tree executor to a single-body-per-part model.

**Position in roadmap:** Sub-project 3 was planned as the 3D-part-modeling phase covering fillet, chamfer, shell, hole, revolve, sweep. During brainstorming we decomposed:

- **3a (this spec):** revolve only. Ships the single-body model + boolean ops infrastructure.
- **3b (future):** fillet, chamfer, shell, hole. Requires face/edge picking + topological-ID persistence — a separate hard problem.
- **3c (future):** sweep. Requires profile-orientation-along-path decisions.

3a's infrastructure (single-body execution, boolean ops, the `operation` field on features) unblocks all of 3b and 3c.

---

## Goal

Let a furniture designer draw a closed profile and an axis line in one sketch, click **Revolve**, enter an angle, and produce a revolved solid that merges (Join), subtracts from (Cut), or replaces (New) the part's running body. Angle is parametric — editing the expression in the Parameters panel regenerates geometry end-to-end.

## Non-goals

- Sweep. Deferred to 3c.
- Fillet / chamfer / shell / hole. Deferred to 3b.
- Multi-body parts. One body per `PartDocument`. Users wanting multiple bodies use multiple parts in an assembly (sub-project 4).
- Face / edge selection for revolve extents ("To Next" / "To Face" / "Between"). Deferred until face picking arrives in 3b.
- Intersect boolean operation. Ships Join / Cut / New. Intersect is rarely used in furniture; trivial to add later.
- Live preview below 200 ms latency. Preview is debounced 200 ms; faster is future polish.

## Locked foundational decisions

| Decision | Choice | Rationale |
|---|---|---|
| Axis source | Any line primitive in the **same sketch** as the profile | Matches Inventor; no cross-sketch references to track. |
| Boolean ops | Join + Cut + New. Intersect deferred. | Join/Cut cover ~all furniture revolve use cases. |
| Body model | **Single-body part.** Running body accumulates through the feature tree. | Matches Inventor default, simpler execution semantics, sufficient for furniture. |
| Dialog UX | Inventor-faithful: persistent panel, auto-armed pick fields, Extents dropdown, direction icons, operation icons, OK / Cancel / Apply. | User asked explicitly for Inventor fidelity. |
| Live preview | Yes, debounced 200 ms. | Inventor shows preview; UX affordance is part of the point. |
| Angle unit | Degrees, stored as a `SketchParameter` (`unit: 'deg'`). Converted to radians at the OCCT boundary. | Reuses 2c's ParameterRegistry + ParameterUnit. |
| File format | v4 → v5 migration. Extrudes gain `operation` field (first extrude → `new`, subsequent → `join`). | Transparent to user. |

---

## Data model

### Shared types (`packages/shared/src/types.ts`)

```ts
export type BooleanOperation = 'new' | 'join' | 'cut';

export type RevolveFeature = {
  kind: 'revolve';
  id: string;
  sketchRef: string;            // sketch id whose closed wires form the profile
  axisPrimitiveId: string;      // id of a line primitive in that sketch
  angleParam: string;           // ParameterRegistry parameter name
  direction: 'normal' | 'symmetric' | 'flipped';
  operation: BooleanOperation;
};

export type ExtrudeFeature = {
  kind: 'extrude';
  id: string;
  sketchRef: string;
  distanceParam: string;
  direction: 'forward' | 'symmetric';
  operation: BooleanOperation;   // NEW in 3a
};

export type Feature =
  | { kind: 'sketch'; ... }       // unchanged
  | ExtrudeFeature
  | RevolveFeature;               // NEW
```

`PartDocument` shape is unchanged — no `bodies` array. The single running body is execution-time state, not persisted.

### File format migration (v4 → v5)

`packages/shared/src/fileFormat.ts`:

```ts
export const CURRENT_FORMAT_VERSION = 5 as const;

// New migration:
4: (mIn) => {
  const m = deepClone(mIn);
  const doc = m.document as { featureTree?: Array<Record<string, unknown>> } | undefined;
  if (doc?.featureTree) {
    let seenNew = false;
    for (const f of doc.featureTree) {
      if (f.kind === 'extrude') {
        if (!seenNew) { f.operation = 'new'; seenNew = true; }
        else f.operation = 'join';
      }
    }
  }
  return { ...m, formatVersion: 5 };
}
```

`ProjectFile.formatVersion: 5` literal update.

---

## Feature-tree execution (single-body model)

### Current state (pre-3a)

Each solid-producing feature returns an independent `OcctShape`. Main thread uses the last one. No boolean merging.

### New state

`packages/kernel/src/adapter/FeatureTree.ts` maintains a `running: OcctShape | null` variable. For each feature:

```ts
for (const f of part.featureTree) {
  if (f.kind === 'sketch') continue;
  const out = executeFeature(oc, f, context);       // Result<OcctShape, KernelError>
  if (!out.ok) { warnings.push(out.error); continue; }
  const applied = applyBooleanOp(oc, running, out.value, f.operation);
  if (!applied.ok) { warnings.push(applied.error); continue; }
  running = applied.value;
}
return running;
```

`applyBooleanOp`:

- `new` → dispose previous running (if any), return `out`.
- `join` with running → `fuseShapes(running, out)`. With no running → promote `out` as running.
- `cut` with running → `cutShapes(running, out)`. With no running → `err({ kind: 'no-target-body' })`.

### Boolean ops module (`packages/kernel/src/occt/BooleanOps.ts`)

```ts
export function fuseShapes(oc: OcctInstance, a: OcctShape, b: OcctShape):
  Result<OcctShape, KernelError>;

export function cutShapes(oc: OcctInstance, a: OcctShape, b: OcctShape):
  Result<OcctShape, KernelError>;
```

Wrap `BRepAlgoAPI_Fuse` and `BRepAlgoAPI_Cut`. On failure (non-manifold result, empty intersection on Cut), return `err({ kind: 'boolean-failed', op: 'fuse' | 'cut', reason })`. Worker catches OCCT exceptions and packs into the Result.

### Revolve module (extends `packages/kernel/src/occt/SolidOps.ts`)

```ts
export type RevolveSpec = {
  profile: OcctShape;              // face, built from a closed wire
  axisOrigin: [number, number, number];
  axisDir: [number, number, number];
  angleRad: number;                // signed
};

export function makeRevolve(oc: OcctInstance, s: RevolveSpec):
  Result<OcctShape, KernelError>;
```

Implementation: `BRepPrimAPI_MakeRevol(face, gp_Ax1(origin, dir), angle)`. Returns `err({ kind: 'revolve-failed', reason })` on degenerate axis, profile-crosses-axis, or OCCT exception.

### RevolveFeature executor (`packages/kernel/src/adapter/features/RevolveFeature.ts`)

Given a `RevolveFeature` + the current `PartDocument`:

1. Look up the referenced sketch; run the existing `executeSketchFeature` (or equivalent) to produce closed wires.
2. Pick the axis: find the line primitive by `axisPrimitiveId` in the sketch's primitives list. Reject with `err({ kind: 'axis-not-found' })` if absent or wrong kind.
3. Build the `gp_Ax1`: origin = transformed `(line.x1, line.y1)` to world coords via sketch plane. Direction = transformed `(line.x2 - line.x1, line.y2 - line.y1)`, normalized.
4. Build the profile face: run `combineEdgesIntoWires` on the sketch's edges excluding the axis line primitive (look up by `axisPrimitiveId`, skip its edge when feeding the combiner). Take the resulting closed wires and feed them to `BRepBuilderAPI_MakeFace`. If multiple closed wires exist, the one bounding the largest area becomes outer; the rest become inner (holes). If zero closed wires remain, return `err({ kind: 'revolve-failed', reason: 'no-closed-profile' })`.
5. Apply direction:
   - `normal`: angleRad = `+angle`.
   - `flipped`: angleRad = `-angle`.
   - `symmetric`: rotate the profile face by `-angle/2` around the axis via `BRepBuilderAPI_Transform`, then revolve by `+angle`.
6. Call `makeRevolve(oc, spec)`.
7. Resolve `angleParam` via the main thread before calling into the kernel — same pattern as `dim-length`'s `resolvedValue` argument in 2c.

Angle resolution: the worker doesn't know the ParameterRegistry. The main thread (App.tsx's parameter cascade effect) resolves `angleParam` to a number before calling `kernel.execute`. When the parameter value changes, the effect re-executes the part (same flow as extrude today).

---

## UI flow (Inventor-faithful)

### Dialog layout (`packages/app/src/shell/RevolveDialog.tsx`)

Persistent panel, top-right of the viewport:

```
┌─────────────── Revolve ────────────────┐
│ [Shape] More                           │   (tabs — only Shape in 3a)
│ ────────────────────────────────────── │
│ [↑ Profile]   Sketch1 / 1 profile      │   auto-filled when sketch has exactly one closed wire
│ [↑ Axis   ]   ── (pick a line)         │
│                                        │
│ Extents:   [Angle      ▾]              │   Full | Angle (others deferred to 3b)
│ Angle:     [ 360    ] °                │   expression field
│                                        │
│ Direction: [◁] [◁▷] [▷]                │   Flipped | Symmetric | Normal
│                                        │
│ Operation: [+] [∪] [−]                 │   New | Join | Cut (icon row)
│                                        │
│ [ OK ]   [ Cancel ]   [ Apply ]        │
└────────────────────────────────────────┘
```

### Interaction model

**Opening the dialog** (Model tab ribbon → Revolve button, or `R` shortcut in Model mode):

- Profile field auto-arms for picking.
- If the active sketch has exactly one closed profile, the Profile field auto-fills, and the Axis field auto-arms next.
- Otherwise the user clicks a closed wire in the viewport to pick the profile.

**Axis picking:** user clicks a line primitive. The primitive highlights cyan while in pick mode. The Axis field updates to show the primitive's id.

**Re-picking:** clicking the `[↑ Profile]` or `[↑ Axis]` header re-arms that field.

**Angle expression:** ParameterRegistry-backed. Accepts literals (`360`), names (`theta0`), or expressions (`2 * theta0`). Uses the same `formatExpressionError` helper from 2c to show inline errors below the field (not as a toast — dialog stays open).

**Operation row:**
- Empty part (no running body): New enabled; Join / Cut disabled with tooltip "No body to combine with".
- Populated part: Join is default; all three enabled.

**Apply button:** commits the revolve, keeps dialog open for another. OK: commit + close. Cancel: abort + close.

### Live preview

- Dialog maintains a local `scratch: RevolveFeature` built from the current inputs.
- On any input change: debounce 200 ms → call new `kernel.previewFeature(partId, scratchFeature)` RPC.
- Worker executes a virtual tree `existingFeatures + scratch` without mutating the stored part; returns a tessellated `Mesh`.
- Main thread renders the mesh on a dedicated `THREE.Mesh` at 50% opacity. Disposed on dialog close or next preview.
- Preview errors (axis crosses profile, boolean fails): dim the preview mesh, show a small error badge in the dialog footer. Don't block OK — user may want to commit and fix the expression later.

### Parameter creation flow

The Angle expression field behaves like the Dimension dialog:

- User types `width * 2`. Field is parsed on blur or OK.
- Dialog has a Name field (like `DimensionDialog`) pre-filled with an auto-generated name (`angle0`, `angle1`, ...). On OK: `parameterRegistry.setParameter({ name: angleParamName, expression, unit: 'deg' })`. The user can override the name to reference an existing parameter (e.g., `theta0`) or to create a shared one used by multiple features.
- Dispatch `new AddRevolveFeatureCommand(revolveFeature)` through the bus.

### Ribbon / browser pane

- Model tab gains a **Revolve** button next to Extrude.
- Shortcut: `R`. Sketch tab's Rectangle already binds to `R`, but sketch-mode tool shortcuts only fire in sketch mode — no collision.
- Browser pane displays revolve features as `Revolve1 [Join]` (operation in brackets), mirroring how extrude will gain the same suffix in this sub-project.

---

## Commands

### `AddRevolveFeatureCommand`

Same pattern as `AddDimensionCommand` in 2c (post-cascade-fix).

```ts
class AddRevolveFeatureCommand implements Command {
  constructor(
    private feature: RevolveFeature,
    private kernel: KernelClient,
    private registry: ParameterRegistry,
    private angleExpression: string
  ) {}

  async apply(): Promise<void> {
    this.registry.setParameter({
      name: this.feature.angleParam,
      expression: this.angleExpression,
      unit: 'deg'
    });
    await this.kernel.addFeature(partId, this.feature);
    await this.kernel.execute(partId);    // triggers main-thread re-mesh
  }

  async revert(): Promise<void> {
    await this.kernel.removeFeature(partId, this.feature.id);
    this.registry.removeParameter(this.feature.angleParam);
    await this.kernel.execute(partId);
  }
}
```

Conflict / error handling: if `kernel.execute` returns warnings (revolve failed, boolean failed), apply() still succeeds — the feature is in the tree, the tree just doesn't produce geometry for that step. Toast shown; user edits the feature or deletes it.

---

## Error handling

Three layers:

### Dialog validation (pre-OK)

Blocks OK (button disabled):
- Profile not selected.
- Axis not picked.
- Angle expression is syntactically invalid or evaluates to non-finite.

Inline errors (below the relevant field, red text):
- Unknown variable in angle expression.
- Parameter name collision.

### Execution errors (post-OK, surface via toast)

- `revolve-failed { reason: 'degenerate-axis' | 'profile-crosses-axis' | 'occt-exception' }` → "Revolve failed: ...".
- `boolean-failed { op, reason: 'no-overlap' | 'non-manifold' | 'occt-exception' }` → "Cut produced no change" / "Join failed: ...".
- `no-target-body` (Join/Cut on empty part) → "Join/Cut needs an existing body — switching to New" + auto-toggle operation.

Feature persists in the tree in all error cases. The user can open the feature dialog again, edit, retry.

### Preview errors (dialog-local, non-blocking)

Preview mesh dims + small error badge in dialog footer ("Preview: axis crosses profile"). OK remains enabled; user can commit and fix later.

---

## Testing strategy

### Unit (shared)

- `fileFormat.spec.ts` — v4 → v5 migration: empty tree, single-extrude, multi-extrude.
- `types.spec.ts` — structural shape tests for `RevolveFeature`, `BooleanOperation`, the updated `Feature` union.

### Integration (real OCCT, kernel package)

- `SolidOps.revolve.integration.spec.ts` — `makeRevolve` over a 10x20 rectangle profile around a collinear axis:
  - Full 360° → solid with bounding box ~Ø40×20.
  - Partial 90° → arc-shaped solid; check bounding box.
  - Symmetric 180° → pre-rotate check works.
  - Flipped → negative angle produces mirrored bounding box.
- `BooleanOps.integration.spec.ts` — fuse / cut between two 10-unit boxes:
  - Fuse of overlapping boxes: volume ≈ sum minus overlap.
  - Cut: bounding box = original minus intersection.
  - Fuse of disjoint boxes: returns compound (verify).
  - Cut with no overlap: returns err `no-overlap`.
- `RevolveFeature.integration.spec.ts` — end-to-end: build a `PartDocument` with one sketch (rectangle + axis line) + one revolve feature → execute → verify mesh bounding box matches expectations.
- `FeatureTree.integration.spec.ts` — single-body model:
  - Extrude New → running body = extrude output.
  - Extrude New → Revolve Join → running body = Fuse(extrude, revolve).
  - Extrude New → Revolve Cut → running body = Cut(extrude, revolve).
  - First feature with Join (no prior New) → warning + body stays null.

### App unit

- `AddRevolveFeatureCommand.spec.ts` — apply/revert round-trip mutates store + kernel + registry correctly.
- `RevolveDialog.spec.tsx`:
  - Renders with Profile auto-selected when sketch has one closed wire.
  - OK disabled until axis picked.
  - Operation row disables Join/Cut when no running body.
  - Angle field shows inline error for bad expression.

### E2E (Playwright)

- `place-revolve-full.spec.ts` — draw rectangle + axis line → Revolve → pick axis → type 360 → OK → assert a dimension-glyph-style label or mesh-visible assertion, and that the feature tree has one revolve entry.
- `revolve-join-then-cut.spec.ts` — extrude a cube, revolve Join a torus-like solid, revolve Cut a cylinder through it → verify the final bounding box and feature-tree ordering.
- `parametric-revolve-cascade.spec.ts` — revolve with `angleParam: 2 * theta0`, edit `theta0` from `45` to `90` in the Parameters panel, verify the mesh's bounding box changes (same pattern as 2c's `edit-dim-expression.spec.ts`).

### Perf

- `revolve-preview-debounce.spec.ts` — rapid-fire 10 keystrokes in the Angle field, assert the worker received at most `ceil(keystrokes / ratio)` preview calls over the span, and total wall time ≤ 2 s.

Total new tests: **14** across layers.

---

## Risks & open items

1. **opencascade.js coverage.** The JS bindings expose most C++ APIs but not all. Verify at Task 1 time that `BRepPrimAPI_MakeRevol`, `BRepAlgoAPI_Fuse`, `BRepAlgoAPI_Cut`, and `gp_Ax1` constructors are all callable. Fallback: for `BRepPrimAPI_MakeRevol` we can route through `BRepSweep_Revol` or `BRepFeat_MakeRevol`. For booleans, `BRepAlgoAPI_BuilderAlgo` is a lower-level fallback.
2. **Axis line must not be part of the profile wire.** `combineEdgesIntoWires` in Shell MVP returns closed and open wires. The axis line is open, so it's not in the closed-wire list — the profile build is already correct. Document this invariant in the code.
3. **Sketch-plane transform for the axis.** The axis line's endpoints are in the sketch's local 2D frame. The world axis direction comes from applying the sketch's plane orientation. Extrude already does this for its direction vector; RevolveFeature reuses the same helper.
4. **Preview memory pressure.** Each preview execution creates an OCCT shape + a JS-side `Mesh`. Worker must dispose the previous preview shape before running the next. Use a sidecar pattern: `previewShape: OcctShape | null` field on `GcsSystem`-equivalent — except this is kernel, not sketcher-worker. Add to the kernel's feature-tree executor.
5. **Boolean-ops cost.** Fuse / Cut on complex solids (e.g., after several features) is O(N log N) on boundary element count. Target hardware: a 200-face running body + a 50-face revolve should fuse in <100 ms. Confirm via the perf spec.
6. **Parameter-regeneration interaction.** Changing `theta0` triggers (a) ParameterRegistry subscribe → (b) App.tsx cascade effect → (c) `kernel.execute(partId)`. The effect should debounce 100 ms to avoid re-executing on every keystroke. Same debounce pattern as the preview.
7. **Running body identity across execute calls.** Each `kernel.execute` rebuilds the running body from scratch. The executor must dispose the previous persisted `OcctShape` before the new one replaces it. Shell MVP already owns this via `cachedGeometry`; 3a extends it.

---

## Appendix — Plan self-review checklist (for when the implementation plan is written)

The plan should cover at least these tasks, in rough order:

1. Shared types: `BooleanOperation`, `RevolveFeature`, extrude retrofit.
2. File format v4 → v5 migration.
3. OCCT `BooleanOps.ts` (fuseShapes, cutShapes) + integration tests.
4. OCCT `makeRevolve` in `SolidOps.ts` + integration tests.
5. `RevolveFeature` executor in kernel/adapter.
6. Feature-tree executor single-body loop + `no-target-body` warning path.
7. `AddRevolveFeatureCommand` in app.
8. `previewFeature` kernel RPC.
9. `RevolveDialog` component + persistent panel layout.
10. Axis-pick interaction (viewport click wiring).
11. Ribbon button + `R` shortcut in Model mode.
12. Extrude dialog retrofit: Operation icon row.
13. E2E tests (3).
14. Perf test.
15. Manual test checklist.

---

**Spec ends.** Implementation plan to follow via `superpowers:writing-plans`.

---

## Implementation deltas (post-T21 clarifications)

Surgical clarifications captured after T1-T21 shipped. The body of this spec is left as originally approved; these notes record where the actual implementation shifted.

### `executeRevolveFeature` signature is 4-arg, not 5-arg

The spec's Task-5 sketch implied an executor that consumed a pre-built `SketchResult` (closed wires already produced by `executeSketchFeature`). The actual shipped signature rebuilds edges internally and drops the `SketchResult` param:

```ts
// packages/kernel/src/adapter/features/RevolveFeature.ts
export function executeRevolveFeature(
  oc: OcctInstance,
  sketchFeature: Extract<Feature, { kind: 'sketch' }>,
  feature: Extract<Feature, { kind: 'revolve' }>,
  angleRad: number
): Result<RevolveResult, KernelError>;
```

Reason: `executeSketchFeature` rejects sketches that contain a profile + an axis line as `degenerateSketch` (the axis line produces an open chain, so the sketch isn't entirely closed). The revolve executor therefore rebuilds edges from the raw sketch `Feature`, skipping the axis primitive before wire combination.

### `symmetric` direction simplified to `normal` for MVP

The spec listed `symmetric` as pre-rotating the profile by `-angle/2` before revolving. In the shipped MVP, `direction: 'symmetric'` is treated identically to `direction: 'normal'` inside `executeRevolveFeature`. The dialog still exposes the Symmetric button so the wiring is ready, but proper pre-rotation is deferred. Tracked as a TODO in the manual test checklist.

### XY-plane only

3a ships XY-plane revolves only. `executeRevolveFeature` returns a `revolveFailed` error for any `sketchFeature.plane !== 'XY'`. XZ / YZ support is deferred — it requires the same sketch-plane transform work that `extrude` has for non-XY planes, which wasn't in scope.

#### F5 status — BLOCKED on sketcher plane-selection sub-project

Lifting the XY-only guard in `executeRevolveFeature` in isolation is NOT a valid incremental change. The entire sketch-processing stack is XY-only today, and the blocker is not just in `RevolveFeature.ts`:

1. **`executeSketchFeature` (packages/kernel/src/adapter/features/SketchFeature.ts:51-58)** — hard-rejects any sketch whose `plane !== 'XY'` with an `invalidParameter` KernelError. No `SketchResult` can be produced for XZ/YZ sketches, so no downstream feature can consume them.
2. **`SketchOps.ts` primitive builders** — `makeLineEdge`, `makeCircleEdge`, `makeArcEdge`, `makeRectangleEdges`, `makeSplineEdge`, and `makeRectangleWireXY` all hardcode Z=0 and (for circles/arcs) the axis normal `(0,0,1)`. They build wires in the world XY plane regardless of `sketchFeature.plane`.
3. **`ExtrudeFeature.ts:68`** — extrusion direction is hardcoded to `gp_Vec_4(0, 0, distance)` (+Z only).
4. **UI — no plane selector** — neither `SketchModeController` nor `useAppStore` expose a plane-selection UI. Every sketch in the app is created with `plane: 'XY'`. An XZ/YZ revolve cannot be reached from the shipping UI even if the kernel accepted it.

A partial lift (axis-mapping helper only in `RevolveFeature.ts`) would pass the `sketchFeature.plane !== 'XY'` guard, then revolve an XY-plane profile wire around an axis mapped into XZ or YZ world coords — producing a skew profile/axis geometry that is geometrically meaningless. This would be a silent bug, not a stepping stone.

**Scope of a proper F5 fix (future sub-project):**

- `SketchFeature.ts` must accept XZ/YZ and transform edges into the sketch's world plane (via `gp_Trsf.SetTransformation` from a local XY `gp_Ax2` to the plane's `gp_Ax2`).
- Either (a) extend all `SketchOps` builders to accept a `plane` argument and route Z correctly, or (b) build in local XY and post-transform the resulting wire/edges.
- `ExtrudeFeature.ts` direction vector must derive from `sketch.plane`'s normal, not hardcoded `(0,0,1)`.
- `RevolveFeature.ts` axis mapping becomes trivial once the profile wire is in the right plane (mapping `(axisPrim.x*, axisPrim.y*)` through the same `gp_Ax2` used for the sketch).
- UI: sketcher needs a plane picker (XY / XZ / YZ, and eventually face-planar sketches). `SketchModeController` must thread the chosen plane through to `AddSketchCommand`.

**Recommended sequencing:** Make non-XY sketch planes a dedicated sub-project (e.g., 3c or a targeted polish pass after 3b), because the change touches sketch creation, every primitive builder, extrude, revolve, and the sketcher UI simultaneously. An isolated F5 edit in `RevolveFeature` is worse than the current explicit rejection.

**Current behavior is correct:** `revolveFailed` with `message: 'Revolve on {XZ|YZ} plane not supported in 3a'` is the right contract until the full stack supports non-XY planes.

### FeatureTree revolve-sketch pre-scan

To prevent `executeSketchFeature` from rejecting profile+axis sketches as degenerate, `FeatureTree.executeTree` pre-scans for revolve features and collects their `sketchRef`s into a `revolveSketchIds: Set<string>`. The main loop then skips `executeSketchFeature` for any sketch whose id is in that set — the revolve executor handles wire construction itself.

```ts
// packages/kernel/src/adapter/FeatureTree.ts (T8)
const revolveSketchIds = new Set<string>();
for (const f of part.featureTree) {
  if (f.kind === 'revolve') revolveSketchIds.add(f.sketchRef);
}
// ... main loop:
if (feature.kind === 'sketch' && revolveSketchIds.has(feature.id)) continue;
```

### Kernel-side param cascade fix (T18)

The spec's `AddRevolveFeatureCommand` describes setting the registry param, then calling `kernel.addFeature` + `kernel.execute`. That covers the initial commit, but editing `theta0` later through the Parameters panel did not regenerate the revolve geometry — the kernel's `executeTree` reads from its own internal parts map, not the app store.

T18 extended the `parameterRegistry.subscribe` listener in `App.tsx` to also push non-dim parameter changes down to the kernel:

```ts
// packages/app/src/App.tsx — cascade effect
if (kernelClient && part) {
  const names = Object.keys(part.parameters ?? {});
  for (const name of names) {
    const p = parameterRegistry.getAll().find((x) => x.name === name);
    if (!p || p.value === undefined) continue;
    const stored = part.parameters[name];
    if (stored && stored.expression === p.expression && stored.value === p.value) continue;
    await kernelClient.setParameter(part.id, {
      name: p.name, expression: p.expression, value: p.value, unit: p.unit
    });
  }
}
```

This guarantees the kernel's parts map stays in sync with the registry, so the next `kernel.execute(partId)` regenerates revolve + extrude geometry with the new angle / distance values. Covered by `parametric-revolve-cascade.spec.ts` (T18).

### Dialog error surfacing — toast, not inline / footer badge

The spec described (a) an error badge in the dialog footer for preview failures and (b) an inline error under the Angle field for bad expressions. Neither UI was built in T11-T15. The shipped dialog surfaces all revolve / parameter errors via the global toast on commit (`showToast('Revolve failed: ...')`) and silently no-ops the preview mesh on preview failures. Inline / footer error UI is a TODO carried forward into 3b or polish.

### Profile picking is a stub

The `Pick` profile button in the dialog is wired to a no-op. The profile is derived automatically from the active sketch via `computeProfileRef()` — any sketch whose closed-wire count is non-zero qualifies. Explicit profile picking can land later when face-picking infrastructure arrives in 3b.

### `KernelClient = KernelApi` alias

Adding the `previewFeature` RPC (T9) required no manual `KernelClient` interface update — it's a type alias over `KernelApi`, so the new method propagated automatically. The spec's Task-8 step for updating the client interface was a no-op in practice.

### File + command references

- Executor: `packages/kernel/src/adapter/features/RevolveFeature.ts`
- Feature-tree loop: `packages/kernel/src/adapter/FeatureTree.ts`
- Dialog: `packages/app/src/shell/RevolveDialog.tsx`
- Command: `packages/app/src/commands/AddRevolveFeatureCommand.ts`
- Param cascade (T18 fix): `packages/app/src/App.tsx` `parameterRegistry.subscribe` effect

