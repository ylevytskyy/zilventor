# ZilInventor Hole feature — design spec (2026-04-25)

Hole feature for Sub-project 3 (3D part modeling), reusing the 3D-op pipeline
established by fillet / chamfer / shell / mirror / linear-pattern. Targets
Inventor 2012 parity in dialog shape and semantics for the furniture-CAD
workflow.

## Scope summary

| Axis | In scope | Deferred |
|---|---|---|
| Placement | From Sketch, Linear, Concentric | On Point (needs work-geometry) |
| Profile | Simple, Counterbore, Countersink | Spotface, Tapped/thread |
| Termination | Distance, Through All, To Face, To Next | — |
| Direction | Normal-to-face + flip toggle | Symmetric (not meaningful), angled |
| Drill point | 118° cone on blind holes, fixed | Flat-bottom toggle |
| Per-hole overrides | No — one feature = one profile for all locations | — |
| Annotation | No hole-note UI in this spec | Sub-project 6 (2D drawings) |

## Data model

Added to `packages/shared/src/types.ts`:

```ts
type HolePlacement =
  | { kind: "fromSketch"; sketchId: string }
  | { kind: "linear";
      faceName: FaceName;
      refEdge1: EdgeName; offset1: ParamOrLiteral;
      refEdge2: EdgeName; offset2: ParamOrLiteral }
  | { kind: "concentric";
      faceName: FaceName;
      circularEdgeName: EdgeName };

type HoleProfile =
  | { kind: "simple"; diameter: ParamOrLiteral }
  | { kind: "counterbore";
      diameter: ParamOrLiteral;
      cboreDiameter: ParamOrLiteral;
      cboreDepth: ParamOrLiteral }
  | { kind: "countersink";
      diameter: ParamOrLiteral;
      cskDiameter: ParamOrLiteral;
      cskAngle: ParamOrLiteral };     // default 82°

type HoleTermination =
  | { kind: "distance"; depth: ParamOrLiteral }  // 118° tip drawn below `depth`
  | { kind: "throughAll" }
  | { kind: "toFace"; targetFaceName: FaceName }
  | { kind: "toNext" };

type HoleFeature = {
  id: string;
  kind: "hole";
  placement: HolePlacement;
  profile: HoleProfile;
  termination: HoleTermination;
  flipAxis: boolean;
};
```

- All numeric fields are `ParamOrLiteral`, so every dimension participates in
  the existing parametric cascade without new wiring.
- `HoleFeature` joins the discriminated `Feature` union.
- `formatVersion` bumps **v5 → v6**. Migration is purely additive — existing
  parts at v5 have no `HoleFeature` nodes; the migration bumps the version
  number and leaves everything else alone.

## Kernel — `packages/kernel/src/occt/HoleOps.ts`

New module. Parallels `FilletOps` / `ShellOps` / `ChamferOps`.

```ts
export function makeHole(
  oc: OpenCascadeInstance,
  body: TopoDS_Shape,
  locations: { origin: gp_Pnt; axis: gp_Dir }[],
  profile: ResolvedHoleProfile,            // literals — adapter has resolved params
  termination: ResolvedHoleTermination
): TopoDS_Shape;
```

**Cutter construction per location:**

**Angle convention.** `cskAngle` and the fixed 118° drill-tip angle are both **full included angles** (tip-to-tip), matching Inventor and drill-bit catalogs. Half-angle = `angle / 2`.

| Profile | Cutter shape |
|---|---|
| Simple      | `Cylinder(d, L)` + 118° cone tip (blind only) |
| Counterbore | `Cylinder(d, L)` + `Cylinder(cboreD, cboreDepth)` stacked at top + 118° cone (blind) |
| Countersink | `Cylinder(d, L)` + `Cone(d → cskD, h = (cskD - d)/2 · cot(cskAngle/2))` stacked at top + 118° cone (blind) |

Primitives built with `BRepPrimAPI_MakeCylinder` / `BRepPrimAPI_MakeCone`
positioned by an `Ax2` frame whose `direction` = hole axis and whose `location`
= computed cutter top. Per-location cutters fuse into a single compound with
`BRepAlgoAPI_Fuse`, then one `BRepAlgoAPI_Cut` against `body` yields the final
shape. (One boolean per Hole feature — matches chamfer's per-feature boolean
discipline.)

**Length L and termination resolution:**

- `distance` → L = `depth`; drill tip cone appended below.
- `throughAll` → L = 2 × body-bounding-box-diagonal; no drill tip.
- `toFace` → `BRepIntCurveSurface_Inter` along axis against `body`; L =
  distance to nearest intersection on `targetFaceName`; no drill tip.
- `toNext` → same intersector; L = distance to first face crossing strictly
  past entry; no drill tip.

**Face naming:** every new face on the cut body is tagged
`{feature.id}/hole/{locationIndex}/{role}` where
`role ∈ {shank, cbore, csk, tip}`. Lets downstream fillets / chamfers pick
hole faces stably.

**Failure:** `makeHole` throws on any OCCT error. Caller (adapter) soft-fails.

### Kernel tests

`packages/kernel/src/occt/__tests__/HoleOps.spec.ts`:
- Simple through: 1 cylinder face, no cone.
- Simple blind: 1 cylinder + 1 cone tip at 118°.
- CBORE: 2 concentric cylinder faces + tip if blind.
- CSK: 1 cylinder + 1 conical face at 82°.
- Axis-intersector helper on a stacked-cube fixture finds nearest / next face
  crossing at expected depths.

## Adapter — `packages/kernel/src/adapter/features/HoleFeature.ts`

Four-arg signature (matches revolve):

```ts
executeHoleFeature(
  oc: OpenCascadeInstance,
  runningBody: NamedShape,
  feature: HoleFeature,
  resolveParam: (p: ParamOrLiteral) => number,
  sketchById: Map<string, Feature>
): NamedShape;
```

**Location resolution per placement kind:**

1. `fromSketch`
   - Look up `sketchById[feature.placement.sketchId]`. Extract every `circle`'s
     center and every lone `point` from the raw sketch primitives.
   - Transform each 2D sketch-plane point to world 3D using the sketch's plane.
   - Axis = sketch-plane normal, flipped if `flipAxis`.
   - N locations (N = circle count + point count).

2. `linear`
   - Resolve `faceName` on `runningBody`; extract face plane + outward normal.
   - Resolve `refEdge1`/`refEdge2` on `runningBody`; extract each edge's line
     in the face plane.
   - Solve a 2D linear system on the face plane for the point that sits at
     `offset1` perpendicular to edge1 and `offset2` perpendicular to edge2.
   - Axis = face outward normal (flipped if `flipAxis`).
   - Single location.

3. `concentric`
   - Resolve `faceName` → face outward normal (used for axis sign).
   - Resolve `circularEdgeName` → `BRepAdaptor_Curve` + `GeomAPI` to extract
     the circle's center and the circle normal.
   - Origin = circle center. Axis = circle normal, sign chosen to align with
     face normal (flipped by `flipAxis`).
   - Single location.

Adapter then resolves all `ParamOrLiteral` fields to numbers, calls `makeHole`,
and wraps the result in a `NamedShape` with its new face/edge name maps.

## FeatureTree integration — `packages/kernel/src/adapter/FeatureTree.ts`

- **Pre-scan at the top of `executeTree`:** collect
  `holeSketchIds: Set<string>` from every `HoleFeature` whose placement is
  `fromSketch`. Mirrors the revolve pre-scan from 3a.
- Main loop: sketches whose id is in `holeSketchIds` skip
  `executeSketchFeature` (kept as raw `Feature`, passed to the hole adapter
  via `sketchById`).
- New `case "hole":` branch. On throw, soft-fail: keep prior running body,
  record `HoleFeatureError` in diagnostics, browser-pane shows red badge.
- `ExecutionResult.faceNames` picks up new hole faces automatically — no new
  pipeline changes.

## Parametric cascade

No new wiring. `App.tsx`'s existing
`parameterRegistry.subscribe → kernel.setParameter → kernel.execute` chain
already cascades every `ParamOrLiteral` in every feature. Hole diameters,
depths, CSK angles, linear offsets, etc. are just more `ParamOrLiteral` fields
and ride that cascade for free.

## UI — `packages/app/src/shell/HoleDialog.tsx`

Flat modern dialog (not Inventor's tabbed one), four regions stacked
top-to-bottom:

### Placement
- Radio group: `From Sketch | Linear | Concentric`.
- Mode-specific pick row:
  - *From Sketch* → "Pick sketch" button. New lightweight
    `SketchPickController` — click the browser-pane sketch node OR click a
    sketch primitive in the viewport to select its parent sketch. Label shows
    sketch name + detected location count (`N points`).
  - *Linear* → "Pick face" (FacePickController) + "Pick edge 1" / offset1
    field + "Pick edge 2" / offset2 field. EdgePickController filtered to
    edges adjacent to the picked face.
  - *Concentric* → "Pick face" (FacePickController) + "Pick circular edge"
    (EdgePickController filtered to circular edges on that face).
- Flip-axis toggle (arrow button, Inventor-style).

### Profile
- Radio group: `Simple | Counterbore | Countersink` with inline SVG icons.
- Diameter field (all profiles).
- CBORE: + `CBORE Ø` + `CBORE depth`.
- CSK: + `CSK Ø` + `CSK angle` (default 82°).
- Every numeric field is a `NumericInputOverlay` accepting literal or
  `=paramName`.

### Termination
- Dropdown: `Distance | Through All | To Face | To Next`.
- Distance → `Depth` field.
- To Face → "Pick target face" button (FacePickController).
- Through All / To Next → no extra fields.

### Footer
- OK / Cancel / Apply.
- Error badge slot — same soft-fail pattern as FilletDialog.

### Preview
Match FilletDialog — `previewFeature` RPC fires on field blur / pick commit,
viewport renders translucent cutter via existing preview pipeline. On error,
footer badge + preview cleared. Debounce threshold matches fillet (150 ms).

### Rehydrate on edit
Double-click a Hole browser-pane node → `openHoleForEdit(featureId)` → dialog
opens with all fields + picks populated from the stored `HoleFeature`.
Replace-in-place on commit (T26 pattern from 3b).

## Command & app wiring

- `packages/app/src/commands/AddHoleFeatureCommand.ts`, positional-arg pattern
  matching `AddRevolveFeatureCommand`.
- Keyboard shortcut **H**.
- Ribbon button in Model → Modify panel next to Chamfer / Shell / Fillet.
- BrowserPane: new Hole node under the active part, double-click triggers
  edit. Icon: small drill symbol.

### Store slice (`useAppStore`)

```ts
holeDialogOpen: boolean
holePlacementMode: "fromSketch" | "linear" | "concentric"
holeSketchId: string | null
holePlacementFace: FaceName | null
holeRefEdges: [EdgeName | null, EdgeName | null]
holeCircularEdge: EdgeName | null
holeTargetFace: FaceName | null
editingHoleId: string | null
holeInitialValues: Partial<HoleFeature> | null
openHoleForEdit: (id: string) => void
resetHoleDialog: () => void
```

## Testing

### Shared unit — `packages/shared/src/__tests__/hole-feature.spec.ts`
- Discriminated-union narrowing for `HolePlacement` / `HoleProfile` / `HoleTermination`.
- v5 → v6 migration: empty `holes` round-trip preserves shape, bumps version.
- Legacy v5 file with no `holes` field loads clean into v6.

### Kernel unit — `packages/kernel/src/occt/__tests__/HoleOps.spec.ts`
Listed above under Kernel tests.

### Kernel integration — `packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts`
- Simple through on 10mm cube — volume ≈ 10³ − π·r²·10 within 0.5%.
- CBORE blind on a plate — named faces `/hole/0/shank`, `/hole/0/cbore`, `/hole/0/tip`.
- CSK through on a plate — `/hole/0/csk` conical face at ≈ 82°/2 half-angle.
- From-sketch 3-circle pattern — three shank faces named `/hole/{0,1,2}/shank`.
- Linear placement — resolved origin sits at expected (offset1, offset2) within 1e-6 mm.
- Concentric placement — origin at the circle center of a revolved ring's inner edge.
- To-Face termination on a 2-plate sandwich — drill stops at picked face, second plate untouched.
- To-Next termination on same fixture — drill stops at first face crossing past entry.
- Soft-fail: malformed `faceName` → prior body unchanged, error recorded.
- Parametric-cascade regression: d=5 vs d=8 → different `data-geometry-hash` (3b hash trick).

### App unit — `packages/app/src/shell/__tests__/HoleDialog.spec.tsx` + command spec
- Radio-group toggles show/hide mode-specific pick rows.
- Profile toggle shows/hides CBORE/CSK fields.
- Numeric fields accept `=d_hole` parametric syntax.
- `openHoleForEdit` populates all fields per placement kind × profile kind × termination kind.
- `AddHoleFeatureCommand` dispatches correct store transitions per mode.
- BrowserPane renders Hole node; double-click calls `openHoleForEdit`.

### E2E — `tests/e2e/model/`
- `hole-from-sketch.spec.ts` — sketch two circles, simple-through, geometry hash shows 2 holes.
- `hole-linear.spec.ts` — pick face + 2 edges + offsets, CBORE blind, assert CBORE face + drill tip.
- `hole-concentric.spec.ts` — revolved solid, concentric CSK through, CSK face present.
- `hole-parametric-cascade.spec.ts` — drive diameter via parameter, assert `data-geometry-hash` changes.
- `hole-edit-reopen.spec.ts` — commit, re-open dialog, assert fields populated.

### Perf — `tests/e2e/perf/hole-preview-debounce.spec.ts`
Preview RPC never fires more than once per 150 ms during dialog drag (matches
fillet threshold).

## Deferred / not in this release

- **On Point placement** — needs work-point infrastructure (its own feature).
- **Spotface** — model as CBORE until a customer asks.
- **Tapped / cosmetic thread** — misleading without real threads; skipped.
- **Flat-bottom blind holes** — 118° tip always drawn; toggle can land later.
- **Per-hole overrides** — one Hole feature = one profile / termination / diameter set for all its locations (matches Inventor).
- **Symmetric direction** — not meaningful for holes.
- **Taper / reamed / bored variants** — not primary furniture-CAD needs.
- **Thread callouts / hole-note annotations** — Sub-project 6 (2D drawings).

## Explicitly not refactored

- `AddExtrusionCommand` (ctx-object) vs `AddRevolveFeatureCommand` (positional)
  divergence stays as-is. Hole follows the positional pattern.
- No shared "param-dirty → re-execute" dispatcher yet (3b learning #2 flagged
  it as a future refactor). Revisit after one more 3D-op lands.

## File references

- Spec (this file): `docs/superpowers/specs/2026-04-25-hole-design.md`
- New kernel op: `packages/kernel/src/occt/HoleOps.ts`
- New adapter: `packages/kernel/src/adapter/features/HoleFeature.ts`
- FeatureTree hook: `packages/kernel/src/adapter/FeatureTree.ts`
- Shared type: `packages/shared/src/types.ts`
- Migration: `packages/shared/src/fileFormat.ts`
- Dialog: `packages/app/src/shell/HoleDialog.tsx`
- Command: `packages/app/src/commands/AddHoleFeatureCommand.ts`
- Store slice: `packages/app/src/store/useAppStore.ts`
- Browser pane node: `packages/app/src/shell/BrowserPane.tsx`
- Ribbon entry: `packages/app/src/shell/Ribbon.tsx`
