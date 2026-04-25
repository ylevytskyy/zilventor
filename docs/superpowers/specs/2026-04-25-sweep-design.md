# ZilInventor Sweep feature — design spec (2026-04-25)

Sweep feature, the final piece of Sub-project 3 (3D part modeling). Sweeps a
closed-loop profile sketch along a path sketch (open or closed chain) to
produce a solid. Reuses the 3D-op pipeline established by fillet / chamfer /
shell / hole and the boolean-op infrastructure shipped by 3a.

## Scope summary

| Axis | In scope | Deferred |
|---|---|---|
| Orientation | Path (Frenet), Parallel, Guide Rail | Twist, Taper |
| Path topology | Open chain, Closed chain | — |
| Profile | Single closed loop | Multi-loop (outer + inner holes) |
| Operation | New / Join / Cut | — |
| Direction | One-way along path | Symmetric |
| Preview | Debounced live preview via existing RPC | — |
| Rehydrate | Double-click browser-pane node → dialog reopens | — |

## Data model

Added to `packages/shared/src/types.ts`:

```ts
export type SweepOrientation =
  | { kind: 'path' }                                // Frenet frame; profile perpendicular to tangent
  | { kind: 'parallel' }                            // profile keeps initial frame
  | { kind: 'guideRail'; guideRailSketchId: string };

export type SweepFeature = {
  id: string;
  kind: 'sweep';
  profileSketchId: string;                          // closed-loop sketch
  pathSketchId: string;                             // open or closed chain
  orientation: SweepOrientation;
  operation: BooleanOperation;                      // 'new' | 'join' | 'cut'
};
```

- `SweepFeature` joins the discriminated `Feature` union.
- All sketch references (`profile`, `path`, optional `guideRail`) get the
  same FeatureTree pre-scan treatment as revolve/hole — they stay raw.
- No numeric `ParamOrLiteral` fields on the sweep itself — sweep geometry is
  fully driven by sketch dimensions, which already participate in the
  parametric cascade through `parameterRegistry.subscribe → kernel.setParameter
  → kernel.execute`.
- `formatVersion` bumps **v6 → v7**. Migration is purely additive.

## Kernel — `packages/kernel/src/occt/SweepOps.ts`

New module. Public entry point:

```ts
export type ResolvedSweepOrientation =
  | { kind: 'path' }
  | { kind: 'parallel' }
  | { kind: 'guideRail'; guideWire: TopoDS_Wire };

export function makeSweep(
  oc: OcctInstance,
  profileWire: TopoDS_Wire,            // closed loop (profile.Closed() === true)
  pathWire: TopoDS_Wire,               // open or closed chain
  orientation: ResolvedSweepOrientation,
): TopoDS_Shape;                       // a TopoDS_Solid
```

Implementation uses `BRepOffsetAPI_MakePipeShell` for all three orientations:

- **Path:** `builder.SetMode_2(true)` for Frenet-frame mode (default
  perpendicular-to-tangent behavior).
- **Parallel:** `builder.SetMode_1(profileFrame)` — `gp_Ax2` derived from the
  profile's centroid and plane normal — locks the profile orientation.
- **Guide Rail:** `builder.SetMode_4(guideWire, /* keepContact */ true,
  oc.BRepFill_TypeOfContact.ContactOnBorder)` — profile orientation tracks the
  guide curve.

Then `Add_1(profileWire, false, false)`, `Build(...)`, `IsDone()`,
`MakeSolid()`, `Shape()`. Each step's failure throws with a descriptive
message.

OCCT overload suffixes are best-guesses based on common patterns and will be
verified during implementation against `node_modules/opencascade.js/dist/opencascade.full.d.ts`. Adjust as needed.

### Wire builder

`buildWireFromSketch(oc, sketch): TopoDS_Wire` — walks a sketch's primitives
in order, converts each to an `Edge`:

| Primitive | OCCT |
|---|---|
| line   | `BRepBuilderAPI_MakeEdge_3(gp_Lin)` clamped to start/end |
| arc    | `Geom_Circle` clamped to start/end angles |
| circle | full `Geom_Circle` |
| spline | `Geom_BSplineCurve` from control points |

Then assembles via `BRepBuilderAPI_MakeWire`. Validates connectivity:

- Profile sketch must yield `wire.Closed() === true`.
- Path sketch must yield a single connected chain (open or closed).
- Guide rail sketch must yield a single connected chain.

Disconnected or self-overlapping wires throw before reaching `makeSweep`.

If `buildWireFromSketch` already exists in `SketchOps.ts` (likely from revolve
or extrude work), reuse — extend only as needed for spline support.

### Failure modes

| Cause | Behavior |
|---|---|
| Profile not closed | `makeSweep` throws |
| Path is degenerate (single point) | throws |
| Guide rail not connected | throws |
| `MakePipeShell.Build` fails (self-intersecting result) | throws |
| `MakeSolid()` returns false | throws |

Adapter catches and soft-fails.

### Kernel tests — `packages/kernel/src/occt/__tests__/SweepOps.spec.ts`

- Path mode + line + circle → cylinder, volume ≈ π·r²·L within 1%.
- Path mode + 90° arc + circle → toroidal segment volume.
- Parallel mode + line + offset square → rectangular prism.
- Guide-rail mode + line + parallel rail → tracked sweep with 4 lateral faces.
- Closed-loop path (rectangle) + circle → ring shape, lateral face count consistent.
- Profile-not-closed → throws.
- Zero-length spine → throws.

## Adapter — `packages/kernel/src/adapter/features/SweepFeature.ts`

```ts
executeSweepFeature(
  oc: OcctInstance,
  runningBody: NamedShape | null,
  feature: SweepFeature,
  sketchById: Map<string, Feature>,
): NamedShape;
```

Steps:

1. Resolve `profileSketchId` and `pathSketchId` (and `guideRailSketchId` if
   Guide Rail) in `sketchById`. Throw with a clear message on miss.
2. Build wires via `buildWireFromSketch`. Validate profile is closed; path is
   connected; guide rail (if present) is connected.
3. Resolve orientation:
   - Path / Parallel: no extra geometry.
   - Guide Rail: build third wire from `guideRailSketchId`.
4. Call `makeSweep(oc, profileWire, pathWire, resolvedOrientation)`.
5. Apply boolean operation:
   - `new` → return swept solid as new body.
   - `join` → `fuseShapes(runningBody.shape, sweptSolid)` (3a infra).
   - `cut`  → `cutShapes(runningBody.shape, sweptSolid)` (3a infra).
6. Tag faces of the result with the convention `{feature.id}/sweep/{role}`:
   - `lateral/<i>` for side faces (sorted by area for stability).
   - `capStart` / `capEnd` for end caps (omitted when path is closed).
7. Return `NamedShape` with new face/edge name maps.

`runningBody` may be `null` when sweep is the first feature with `operation:
'new'`. The adapter handles this — `'new'` doesn't read `runningBody`.

## FeatureTree integration — `packages/kernel/src/adapter/FeatureTree.ts`

- Pre-scan extension: collect `sweepSketchIds: Set<string>` from every
  `SweepFeature` (profile + path + optional guide rail). Mirrors the
  revolve / hole pre-scan.
- Sketches whose id is in `sweepSketchIds` skip `executeSketchFeature` — they
  stay raw, available to `executeSweepFeature` via `sketchById`.
- New `case 'sweep':` branch in the main loop. On throw, soft-fail: keep
  prior `runningBody`, push to `featureErrors`, continue.

## Parametric cascade

No new wiring. Editing a sketch dimension that drives the path or profile
rebuilds the wires on the next execute, and the sweep regenerates. Unlike
hole / extrude / revolve, sweep has no `ParamOrLiteral` fields of its own.

## UI — `packages/app/src/shell/SweepDialog.tsx`

Presentation component (mirroring the F1-fixed HoleDialog pattern). Pure
props in, `onCommit(SweepFeature)` out. The wrapper in `App.tsx` subscribes
to the store, fetches kernel data, and dispatches `AddSweepFeatureCommand`.

Five regions:

### Profile
- "Pick profile" button → activates `SketchPickController`. Click a sketch in
  browser pane to select.
- Status label: `Profile: <sketchName>` with a small ✓ if the wire validates
  as closed.

### Path
- "Pick path" button → same `SketchPickController`, separate state slot.
- Status label: `Path: <sketchName> (open)` or `(closed)` once detected.

### Orientation
- Radio group: `Path | Parallel | Guide Rail`.
- Path / Parallel → no extra fields.
- Guide Rail → "Pick guide rail" button + status label.

### Operation
- Radio group: `New | Join | Cut`.
- Disabled `Join` / `Cut` when there's no running body.

### Footer
- OK / Cancel.
- Error badge slot — same soft-fail pattern as other dialogs.

### Live preview
Match Hole's debounced (~150 ms) `previewFeature` RPC pattern. Worker side:
the `previewFeature` route is feature-type-agnostic; sweep needs no kernel
RPC change beyond the FeatureTree branch.

### Rehydrate on edit
Double-click `Sweep` browser-pane node → `openSweepForEdit(featureId)` → all
fields pre-fill from the stored feature. Same pattern as Hole's T26.

### Validation (OK enabled when)
- Profile picked AND its sketch produces a closed wire.
- Path picked AND its sketch produces a connected chain.
- Guide Rail mode: guide rail picked AND validates as a chain.

## Command & app wiring

- `OpenSweepDialogCommand()` — opens dialog (called by ribbon button + W shortcut).
- `AddSweepFeatureCommand` — class mirroring `AddHoleFeatureCommand`:
  parameter setup → `kernel.addFeature(partId, feature)` →
  `kernel.execute(partId)` → `kernel.getPart` → `setActivePart`.
- Keyboard shortcut **W** (free; matches Inventor 2012's Sweep shortcut).
- Ribbon button: Model → **Create** panel (next to Extrude / Revolve).
  Sweep is a feature-creating op, not a Modify op like fillet/chamfer/shell.
- Browser-pane: `Sweep` node, double-click → `openSweepForEdit(id)`.

### Store slice (`useAppStore`)

```ts
sweepDialogOpen: boolean
sweepProfileSketchId: string | null
sweepPathSketchId: string | null
sweepOrientationKind: 'path' | 'parallel' | 'guideRail'
sweepGuideRailSketchId: string | null
sweepOperation: BooleanOperation                       // default 'new'
editingSweepId: string | null
sweepInitialValues: SweepFeature | null
openSweepForEdit: (id: string) => void
resetSweepDialog: () => void
toggleSweepDialog: (open: boolean) => void
```

## Testing

### Shared unit — `packages/shared/src/__tests__/sweep-feature.spec.ts`
- `SweepOrientation` discriminated-union narrowing.
- v6 → v7 migration round-trip.
- Legacy v6 file with no sweep features migrates clean.

### Kernel unit — `packages/kernel/src/occt/__tests__/SweepOps.spec.ts`
Listed above under Kernel tests.

### Kernel integration — `packages/kernel/src/adapter/features/__tests__/SweepFeature.integration.spec.ts`
- `operation: 'new'` with no runningBody → fresh solid.
- `operation: 'join'` against an extruded box → volume = box + sweep within tol.
- `operation: 'cut'` → volume = box − sweep.
- Guide-rail orientation with a third sketch.
- Soft-fail: missing profile sketch → prior body unchanged + error recorded.
- Parametric-cascade regression: sketch-dim edit → `data-geometry-hash` change.

### FeatureTree integration — extend `FeatureTree.integration.spec.ts`
- Pre-scan: `SweepFeature` referencing two sketches keeps both raw.
- Soft-fail: malformed `profileSketchId` → tree continues, error recorded.

### App unit — `packages/app/src/shell/__tests__/SweepDialog.spec.tsx` + command spec
- Five sections render when open.
- Orientation radio toggles guide-rail pick row.
- OK is disabled until profile + path are picked.
- Guide-rail mode disables OK until guide rail also picked.
- `openSweepForEdit` populates all fields per stored feature.
- `OpenSweepDialogCommand` opens dialog + clears stale state.
- `AddSweepFeatureCommand` calls kernel.addFeature + execute + setActivePart.

### E2E — `tests/e2e/model/`
- `sweep-path.spec.ts` — line + circle → cylinder.
- `sweep-arc.spec.ts` — arc + rectangle → curved molding.
- `sweep-closed-loop.spec.ts` — rectangle path + circle profile → ring.
- `sweep-guide-rail.spec.ts` — line spine + parallel guide → tracked sweep.
- `sweep-cut.spec.ts` — sweep with `'cut'` → carved channel in a body.
- `sweep-edit-reopen.spec.ts` — commit + double-click + assert prefilled.
- `sweep-parametric-cascade.spec.ts` — edit path-sketch dim → body regenerates.

### Perf — `tests/e2e/perf/sweep-preview-debounce.spec.ts`
Preview RPC fires ≤ once per 150 ms during dialog edits.

## Deferred / not in this release

- **Twist angle along the path** — needs `SetForceApproxC1` plus
  `twistAngle: ParamOrLiteral`.
- **Taper / scale along the path** — guide-rail-based scaling.
- **Multi-loop profile** — outer + inner closed loops for tube cross-sections.
  Workaround: sweep solid, then drill/shell.
- **Symmetric sweep** — not a standard CAD pattern.
- **Profile from a planar face** — face-pick instead of sketch-pick.
- **Multi-segment path with corner kinks** — may produce degraded face naming;
  fix-on-report.

## Explicitly not refactored

- Command-style divergence (`AddExtrusionCommand` ctx-object vs class-based)
  stays as-is. Sweep uses the class pattern.
- No shared "param-dirty → re-execute" dispatcher (3b learning #2 still
  deferred).
- The `OcctShape` wrapper inconsistency in `HoleFeature.ts` is not
  propagated to Sweep — sweep adapter uses the standard wrapper from the start.

## File references

- Spec (this file): `docs/superpowers/specs/2026-04-25-sweep-design.md`
- New kernel ops: `packages/kernel/src/occt/SweepOps.ts`
- New adapter: `packages/kernel/src/adapter/features/SweepFeature.ts`
- FeatureTree hook: `packages/kernel/src/adapter/FeatureTree.ts`
- Shared type: `packages/shared/src/types.ts`
- Migration: `packages/shared/src/fileFormat.ts`
- Dialog: `packages/app/src/shell/SweepDialog.tsx`
- Open-dialog command: `packages/app/src/commands/OpenSweepDialogCommand.ts`
- Add-feature command: `packages/app/src/commands/AddSweepFeatureCommand.ts`
- Store slice: `packages/app/src/store/useAppStore.ts`
- Browser-pane node: `packages/app/src/shell/BrowserPane.tsx`
- Ribbon entry: `packages/app/src/shell/tabs/ModelTab.tsx`
