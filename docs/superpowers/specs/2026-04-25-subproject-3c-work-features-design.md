# Sub-project 3c — Work Features Design

**Status:** spec
**Author:** levytskyy
**Date:** 2026-04-25

## Background

ZilInventor's 3D part modeling sub-project (3) has shipped Hole, Fillet, Chamfer, Shell, Sweep, Linear Pattern, Mirror, and Revolve — all features that produce or modify solids. The next sub-project, 4 (Assemblies), needs **reference geometry** that constraints can target: axes, planes, and points that are not part of the solid but exist as parametric markers in 3D space.

Inventor 2012 calls these **Work Features**. They are first-class entries in the part feature tree, parametric, pickable for downstream features, and visible (toggleable) in the viewport.

3c carves out work features as their own sub-project so 4b (assembly constraints) lands on a known foundation. Work features are also useful beyond 4b — driving sketches that aren't on origin planes, projecting points onto faces, and so on.

## Goals

- Add three new feature types — `WorkAxis`, `WorkPlane`, `WorkPoint` — to the part feature tree.
- Cover the full Inventor 2012 creation-mode set per type (~18 modes total) so users coming from Inventor have parity.
- Auto-create 7 origin work features on every new part: X/Y/Z axes, XY/YZ/XZ planes, Center Point. Migrate legacy v7 parts to include them on first load.
- Render work features in the viewport with appropriate visual treatment (dashed line, translucent rectangle, marker cross).
- Make work features pickable so 4b can reference them; meanwhile let sketches use work planes as their plane reference.
- Parametric: a parameter change cascades through the work-feature graph and updates dependent geometry.
- Soft-fail when a referenced face/edge/vertex is gone (existing `featureErrors` pattern).

## Non-goals

- Assembly constraints themselves (4b).
- Surface-feature work geometry (e.g., curve on surface) — surface modeling is out of scope.
- Work-feature creation in the assembly context — only part-level work features in 3c. Assembly-level work features are a 4-series concern.
- Any work-feature mode not in the Inventor 2012 set.

## Locked decisions

| Question | Choice |
|---|---|
| Mode coverage per work-feature type | Full Inventor 2012 set (~18 modes) |
| Parametric behavior | Fully parametric — first-class features in `featureTree`, re-execute on cascade, soft-fail on broken refs |
| Origin features | Auto-create 7 origin features on every new part; legacy parts migrated on load |
| Reference scope | Faces, edges, vertices, axes, planes, points — every existing geometry kind plus other work features |
| Renderer | three.js scene-graph nodes per feature, diff-rendered (mirrors `setComponentMeshes`) |
| Picker integration | Existing 3b face/edge pickers + three new controllers (axis/plane/point) |

## Architecture

### Data model

Three new feature kinds in `packages/shared/src/types.ts`:

```ts
export type WorkAxisFeature = {
  kind: 'workAxis'; id: string; name?: string; visible: boolean;
  source:
    | { mode: 'cylindricalFace'; face: FaceName }
    | { mode: 'twoPoints'; pointA: PointRef; pointB: PointRef }
    | { mode: 'edge'; edge: EdgeName }
    | { mode: 'twoPlanes'; planeA: PlaneRef; planeB: PlaneRef }
    | { mode: 'normalToPlaneThroughPoint'; plane: PlaneRef; point: PointRef }
    | { mode: 'origin'; axis: 'X' | 'Y' | 'Z' };
};

export type WorkPlaneFeature = {
  kind: 'workPlane'; id: string; name?: string; visible: boolean;
  source:
    | { mode: 'offsetFromPlane'; plane: PlaneRef; offset: ParamOrLiteral }
    | { mode: 'threePoints'; points: [PointRef, PointRef, PointRef] }
    | { mode: 'axisAtAngleToPlane'; axis: AxisRef; plane: PlaneRef; angle: ParamOrLiteral }
    | { mode: 'tangentToSurfaceParallelToPlane'; face: FaceName; plane: PlaneRef }
    | { mode: 'axisPerpendicularToPlane'; axis: AxisRef; plane: PlaneRef }
    | { mode: 'midplane'; planeA: PlaneRef; planeB: PlaneRef }
    | { mode: 'origin'; plane: 'XY' | 'YZ' | 'XZ' };
};

export type WorkPointFeature = {
  kind: 'workPoint'; id: string; name?: string; visible: boolean;
  source:
    | { mode: 'vertex'; edge: EdgeName; end: 'start' | 'end' }
    | { mode: 'midpointOfEdge'; edge: EdgeName }
    | { mode: 'centerOfArc'; face: FaceName }
    | { mode: 'axisIntersectsPlane'; axis: AxisRef; plane: PlaneRef }
    | { mode: 'threePlanes'; planes: [PlaneRef, PlaneRef, PlaneRef] }
    | { mode: 'origin' };
};

export type AxisRef =
  | { source: 'cylindricalFace'; face: FaceName }
  | { source: 'edge'; edge: EdgeName }
  | { source: 'workAxis'; featureId: string };

export type PlaneRef =
  | { source: 'face'; face: FaceName }
  | { source: 'workPlane'; featureId: string };

export type PointRef =
  | { source: 'vertex'; edge: EdgeName; end: 'start' | 'end' }
  | { source: 'workPoint'; featureId: string };

export type ParamOrLiteral =
  | { kind: 'param'; paramName: string }
  | { kind: 'literal'; value: number };
```

The `Feature` discriminated union in `types.ts` gains `WorkAxisFeature | WorkPlaneFeature | WorkPointFeature`.

### Origin features

`newPart()` in `packages/kernel/src/adapter/PartDocument.ts` seeds the feature tree with 7 origin work features:

```
workAxis  id="origin.X"   source.mode='origin' axis='X'  visible=false
workAxis  id="origin.Y"   source.mode='origin' axis='Y'  visible=false
workAxis  id="origin.Z"   source.mode='origin' axis='Z'  visible=false
workPlane id="origin.XY"  source.mode='origin' plane='XY' visible=false
workPlane id="origin.YZ"  source.mode='origin' plane='YZ' visible=false
workPlane id="origin.XZ"  source.mode='origin' plane='XZ' visible=false
workPoint id="origin.O"   source.mode='origin'           visible=false
```

These IDs are stable identifiers callers depend on (`origin.X`, etc.). They cannot be deleted by the user. The browser pane renders them under a collapsible "Origin" group at the top of the tree.

### Migration

`migrateManifest` in `packages/shared/src/fileFormat.ts` detects legacy v7 manifests without origin features and prepends the 7 entries. Format version stays `7` (additive change). Existing apps reading new files unknown features fall through the switch and are ignored at the part level — but every consumer that runs through `migrateManifest` does see them.

Sketches today store `plane: 'XY' | 'XZ' | 'YZ'`. After 3c the field is widened to `plane: PlaneRef`. Legacy sketches migrate the literal:
- `'XY'` → `{ source: 'workPlane', featureId: 'origin.XY' }`
- `'YZ'` → `{ source: 'workPlane', featureId: 'origin.YZ' }`
- `'XZ'` → `{ source: 'workPlane', featureId: 'origin.XZ' }`

### Kernel-side execution

New file `packages/kernel/src/occt/WorkFeatureOps.ts`:

```ts
export function evaluateWorkAxis(
  occt: OcctInstance, namedShape: NamedShape | null,
  source: WorkAxisFeature['source'],
  workFeatures: Map<string, WorkFeatureValue>,
): Result<WorkFeatureAxisValue, KernelError>;

export function evaluateWorkPlane(...): Result<WorkFeaturePlaneValue, KernelError>;
export function evaluateWorkPoint(...): Result<WorkFeaturePointValue, KernelError>;

export function resolveAxisRef(...): Result<{ origin: Vec3; direction: Vec3 }, KernelError>;
export function resolvePlaneRef(...): Result<{ origin: Vec3; normal: Vec3 }, KernelError>;
export function resolvePointRef(...): Result<{ position: Vec3 }, KernelError>;
```

Each evaluator handles all modes for its type. Most are pure linear algebra. OCCT primitives are needed for:
- `cylindricalFace` axis extraction (`gp_Cylinder.Axis()`)
- `edge` axis extraction (linear vs circular detection)
- `centerOfArc` (`gp_Circ.Location()`)
- `tangentToSurfaceParallelToPlane` (cylinder/sphere intersection math against a parallel plane)

Vec3 is a plain object `{ x, y, z }` — Comlink-cloneable.

### `executeTree` integration

After each kernel feature in the tree is processed, work features in the same scope are evaluated using the current `NamedShape` snapshot. Results accumulate into a Map keyed by feature id, exposed on the existing `ExecuteResult`:

```ts
export type ExecuteResult = {
  mesh: Mesh;
  // existing optional fields…
  workFeatures?: WorkFeatureValue[];
};

export type WorkFeatureValue =
  | { featureId: string; kind: 'axis'; origin: Vec3; direction: Vec3 }
  | { featureId: string; kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { featureId: string; kind: 'point'; position: Vec3 };
```

A broken reference becomes a soft failure entered into `featureErrors` (existing 3b infrastructure). Downstream features that consumed the broken work feature's output also break — `executeTree` already handles transitive soft failures.

### Sketch plane resolution

`SketchFeature` evaluation switches from a `gp_Pln` selector keyed on `'XY' | 'XZ' | 'YZ'` to `resolvePlaneRef(sketch.plane, ...)`. The OCCT sketch ops are unchanged once they receive a `gp_Pln`.

### Renderer

New methods on `SceneManager`:

```ts
setWorkFeatures(specs: Array<{
  featureId: string;
  kind: 'axis' | 'plane' | 'point';
  origin: Vec3;
  direction?: Vec3;  // axis only
  normal?: Vec3;     // plane only
  visible: boolean;
}>): void;

clearWorkFeatures(): void;
workFeatureCount(): number;
getWorkFeatureNode(featureId: string): THREE.Object3D | undefined;
raycastWorkFeature(camera: THREE.Camera, ndc: THREE.Vector2): string | null;
```

Diff rendering follows the T7 `setComponentMeshes` pattern: id-based add/update/remove, instance reuse.

Visual treatment per kind:

| Kind | Geometry | Color | Notes |
|---|---|---|---|
| Axis | `THREE.Line` 200 mm long, dashed (4 mm gap / 8 mm dash) | `#e8c36a` | Direction normalized; `LineDashedMaterial` |
| Plane | 200 × 200 mm `MeshBasicMaterial` rectangle, `opacity: 0.15` `transparent: true` `side: DoubleSide` `depthWrite: false`; wireframe border opaque | `#5b9ad8` | Oriented to normal |
| Point | `THREE.Group` with three crossed segments (X/Y/Z, 6 mm long each) | `#7ed957` | No depth fade |

Each renderer node carries `userData.workFeatureId` for raycaster.

The viewport's `geometryHash()` (T8) extends to fold visible work-feature transforms (axis origin + direction; plane origin + normal; point position) so E2E specs detect parametric updates.

### Creation UI

**Ribbon — Model tab gets a new "Work Features" panel** between "Sketch" and "Modify":

```
[Plane] [Axis] [Point]
```

Three split-buttons. Click the icon to launch the default mode; click the dropdown arrow for the full mode list.

**Per-feature dialogs** (3 total — one per kind):

`WorkPlaneDialog` is a top-right floating panel with a mode dropdown (7 options). Each mode shows mode-specific input rows: pick buttons for refs, numeric inputs for parameters/literals, OK/Cancel.

`WorkAxisDialog` and `WorkPointDialog` follow the same shape with their respective mode lists.

**Picking** uses 3b's existing face/edge pickers plus three new controllers:

- `WorkAxisPickController` — pick a work axis (raycast against rendered axis lines) OR a cylindrical face / linear edge for derive-from-geom modes.
- `WorkPlanePickController` — pick a work plane (raycast against rendered plane geometry) OR a flat face for face-as-plane.
- `WorkPointPickController` — pick a vertex (edge endpoint) or work point.

Each dialog seeds picker mode by row context: clicking the "pick plane" button arms the plane picker; clicking again disarms.

**Hotkeys:**

- `Ctrl+Shift+P` → New Work Plane
- `Ctrl+Shift+A` → New Work Axis
- `Ctrl+Shift+W` → New Work Point

(Inventor uses `Ctrl+W` for Work Point, but `w` is already bound to Sweep in our app.)

**Edit:** double-click a work feature in the browser pane → re-opens its dialog with prior values, like the existing fillet/hole edit flow.

### Browser pane integration

`BrowserPane.tsx` extensions:

- Render the Origin group (collapsed by default) at the top of the part tree.
- Render user-created work features under the appropriate group (mixed in tree order, like other features).
- Eye toggle next to each work feature flips `visible`. Toggling does NOT trigger a kernel re-execute — only a viewport re-render. The store mutation propagates through the existing `setActivePart` cascade.
- Red ⚠ badge for broken work features; click to re-open the dialog.

### Store

`useAppStore` gains 3 dialog slices (mirroring `holeDialog…` / `sweepDialog…` patterns):

```ts
workPlaneDialogOpen: boolean;
workPlaneMode: WorkPlaneFeature['source']['mode'] | null;
editingWorkPlaneId: string | null;
workPlaneInitialValues: WorkPlaneFeature | null;
openWorkPlaneForEdit(id: string): void;
resetWorkPlaneDialog(): void;
toggleWorkPlaneDialog(open: boolean): void;
// …same shape for workAxis* and workPoint*
```

Plus a single setter `setWorkFeatureVisible(featureId: string, visible: boolean)` that updates the in-tree feature without a re-execute.

## Testing

### Unit (kernel)

`packages/kernel/src/occt/__tests__/WorkFeatureOps.spec.ts`:
- Each of the 18 modes gets a test that constructs a known input geometry, invokes the evaluator, and asserts the resulting axis/plane/point matches the expected math.

`packages/shared/src/__tests__/fileFormat.spec.ts`:
- Legacy v7 manifest without origin features → `migrateManifest` injects all 7.
- Legacy sketch with `plane: 'XY'` migrates to `{ source: 'workPlane', featureId: 'origin.XY' }`.

`packages/kernel/src/adapter/__tests__/PartDocument.spec.ts`:
- `newPart()` returns a tree with the 7 origin entries.
- Adding a user feature appends after origin features.

### Unit (app)

`packages/app/src/store/__tests__/useAppStore.spec.ts`: dialog state slices for all 3 work-feature dialogs.

`packages/app/src/shell/__tests__/WorkPlaneDialog.spec.tsx`, `WorkAxisDialog.spec.tsx`, `WorkPointDialog.spec.tsx`: presentation tests per dialog with each mode rendering its inputs.

`packages/app/src/shell/__tests__/BrowserPane.spec.tsx`: render the Origin folder + visibility toggles + work-feature leaves.

### Unit (viewport)

`packages/app/src/viewport/__tests__/SceneManager.spec.ts`: extend with `setWorkFeatures` diff render tests, raycast tests for `raycastWorkFeature`.

### Integration (kernel-side)

`packages/kernel/src/__tests__/WorkFeature.integration.spec.ts`:
- Build a part with sketch + extrude + work plane offset from a face + work axis through cylinder face + work point at edge midpoint.
- Run `kernel.execute`.
- Assert `workFeatures` array has 3 entries with correct geometry.

### E2E

`tests/e2e/work-features/`:

- `create-work-plane.spec.ts`: open WorkPlane dialog via ribbon, pick a face, enter offset, OK. Assert feature in tree + visible in viewport (geometry hash bumped).
- `parametric-cascade.spec.ts`: build a part with a parametric work plane offset, change the parameter via the parameter panel, assert the work plane re-evaluates and downstream extrudes update.
- `broken-ref-badge.spec.ts`: build a part with a work plane referencing a face, delete the feature that produced that face, assert browser pane shows red ⚠ badge.

### Perf

`tests/perf/work-features-recompute.spec.ts`:
- Build a part with 20 chained work features (axis → plane → axis → plane …).
- Edit the root parameter.
- Measure cascade recompute time.
- Budget: ≤ 200 ms on the target hardware (2014–2016 i3/i5).

## Implementation phases (rough)

1. **Data model + origin features + migration.** Shared types extended; `newPart()` seeds origin entries; `migrateManifest` adds them to legacy v7 parts; sketch plane field widened. Existing tests pass after migration shim.
2. **Kernel evaluators.** `WorkFeatureOps.ts` with the 18 mode evaluators + 3 reference resolvers. Hooked into `executeTree`. Integration test green.
3. **Renderer.** `SceneManager.setWorkFeatures` + raycaster. Diff rendering of axes/planes/points.
4. **Dialogs + commands.** Three dialogs, three commands (`Add{WorkAxis,WorkPlane,WorkPoint}FeatureCommand`), three picker controllers. Edit-by-double-click hooked up.
5. **Browser pane integration.** Origin group; visibility toggles; broken-ref badges.
6. **Hotkeys + ribbon.** Ribbon panel; Ctrl+Shift+{P,A,W} bindings.
7. **E2E + perf.** Three E2E specs + the cascade perf spec.

The implementation plan (next step) will decompose these into discrete TDD tasks (~40-50 tasks total).

## Risks

- **Soft-fail propagation correctness.** Work features can fail transitively when their refs disappear. The existing 3b `featureErrors` infrastructure handles single-feature failures, but cascading failures across a chain of work features need careful test coverage in the integration suite.
- **Migration churn.** Every `.zipt` file ever saved is a v7 manifest without origin features. The migration is straightforward, but every existing E2E spec that asserts on `featureTree.length` will need updating — silently injecting 7 entries shifts all indices.
- **Picker UX.** With 5 reference kinds (face, edge, vertex, axis, plane, point) and existing fillet/chamfer/shell/profile/axis pickers, the App.tsx `handleViewportPointer` switch becomes very long. Consider extracting to a router/strategy pattern before adding more picker branches.

## Open questions deferred to plan

- Exact ID scheme for user-created work features (`WP1`, `WA2`, `WPT3` vs single counter `WF1`).
- Whether work-feature names default to the mode (e.g., "Plane offset 10mm from XY") or to a generic counter ("Plane1").
- Whether the render lengths (200 mm for axis / 200×200 mm for plane / 6 mm for point cross) need to be view-distance-adaptive for very small or very large parts. Likely no for v1.
