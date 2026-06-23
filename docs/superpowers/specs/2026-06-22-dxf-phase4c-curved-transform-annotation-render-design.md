# DXF Phase 4c (session slice) — Curved geometry under INSERT transform + 2D annotation render

**Date:** 2026-06-22
**Branch:** `feat/dxf-support` (off master `8112434a`, NOT merged — M1 builds 4c before merge)
**Status:** design approved, ready for implementation plan
**Manifest:** NO bump (Slice A emits only existing v32 SketchPrimitive shapes; Slice B is pure rendering)

## Context

DXF milestone M1 Phases 1+2+3+4a+4b are shipped on `feat/dxf-support` (HEAD `7d5a8528`).
Phase 4c is the next slice before the M1 merge. This spec covers the **two slices the user
selected for this session**:

- **Slice A** — curved geometry rendered correctly under a non-trivial INSERT transform
  (the load-bearing 4b deferral).
- **Slice B** — render the 2D text annotations that 4b stores/persists but never draws.

The remaining 4c work (DIMENSION/LEADER/MLEADER, SOLID/3DFACE, RAY/XLINE, HATCH boundary,
LAYER color/linetype→metadata, parser perf, large-file handling) is **out of scope for this
session** and will be planned later as independent slices.

Both decisions were ratified with the user:
- **Scope:** Slice A + Slice B this session.
- **Curve fidelity:** general/exact (unified linear-map-of-ellipse), not a pragmatic
  common-cases approximation — we are here to retire the documented-wrong deferral, not
  reintroduce a smaller one.

---

## Slice A — Curved geometry correct under any INSERT transform

### The bug being fixed

`packages/shared/src/dxf/toSketch.ts` → `transformPrimitive(m: Affine, p: SketchPrimitive)`
(currently lines ~104–134) applies an INSERT's affine to a primitive. Today it moves curve
**centers** but leaves everything else untouched:

```text
circle:    cx,cy mapped; radius UNCHANGED            (// 4b)
arc:       cx,cy mapped; radius + start/end UNCHANGED (// 4b)
ellipse:   cx,cy mapped; rx/ry/rotation UNCHANGED     (// 4b)
rectangle: x,y mapped;  w/h UNCHANGED                 (// 4b)  ← DEAD: mapper never emits rectangle
```

So a ROTATED or SCALED INSERT containing curves imports with wrong sweep / orientation / size.
This is the same class as the 4a OCS-bulge bug, and was deliberately documented
(`// 4b LIMITATION`) and **pinned** by a behavior test in `toSketch.spec.ts`.

The mapper (`mapEntity`) only ever emits `line | circle | arc | ellipse | spline | point`
(verified) — `rectangle` is unreachable in the import path, present in `transformPrimitive`
only for type exhaustiveness. We do not need rotated-rectangle decomposition.

### Approach: unified linear-map-of-ellipse

Every curved primitive is an ellipse (a circle is an ellipse with `rx=ry`, `rotation=0`;
a circular arc is an elliptical arc). The affine image of an ellipse is an ellipse. So a single
pure routine transforms all curve kinds correctly, including rotation, uniform AND non-uniform
scale, reflection (negative scale), and the shear-like compositions that arise from nested
INSERTs (affines composed via `afMul`).

#### New pure helper (in `toSketch.ts`)

```ts
// All inputs/outputs in the SAME 2D frame transformPrimitive already works in.
function transformEllipse(
  m: Affine,                 // full affine (includes translation) for the INSERT cell
  cx: number, cy: number,    // source ellipse center
  rx: number, ry: number,    // source semi-axes
  rotation: number,          // source ellipse local rotation (radians); 0 for circle/arc
  startParam?: number,       // source start parameter (radians, local frame); omit for full
  endParam?: number,         // source end parameter
): {
  cx: number; cy: number;
  rx: number; ry: number;    // A >= B (principal semi-axes of the image)
  rotation: number;          // major-axis angle of the image (radians)
  startAngle?: number;       // mapped start param (radians, image local frame)
  endAngle?: number;         // mapped end param
  isotropic: boolean;        // A ~= B within EPS → caller may simplify to circle/arc
}
```

**Algorithm:**

1. Linear part `L = { a: m.a, b: m.b, c: m.c, d: m.d }` (drop translation `e,f`).
2. Source semi-axis vectors: `u = R(rotation)·(rx, 0)`, `v = R(rotation)·(0, ry)`.
3. Map them: `u' = L·u`, `v' = L·v`. These are conjugate semi-diameters of the image ellipse
   (perpendicular axes generally map to non-perpendicular conjugate diameters).
4. **Rytz's construction** — recover principal semi-axes `A ≥ B` and major-axis angle `φ'`
   from the conjugate semi-diameters `u', v'`:
   - `t* = 0.5 * atan2( 2 * dot(u',v'), dot(u',u') - dot(v',v') )`
   - `p = u'·cos t*       + v'·sin t*`
   - `q = u'·cos(t*+π/2)  + v'·sin(t*+π/2)`   (= `-u'·sin t* + v'·cos t*`)
   - `|p|, |q|` are the principal semi-axis lengths; `A = max`, `B = min`;
     `φ' = atan2(major.y, major.x)` where `major` is whichever of `p,q` is longer.
5. New center: `(cx', cy') = afApply(m, cx, cy)` (full affine, includes translation).
6. **start/end by point-mapping** (robust, avoids conjugate-param conversion):
   - source start point `Ps = (cx,cy) + R(rotation)·(rx·cos startParam, ry·sin startParam)`
   - `Ps' = afApply(m, Ps)`
   - parameter on image ellipse: `qv = R(-φ')·(Ps' - (cx',cy'))`;
     `startAngle = atan2(qv.y / B, qv.x / A)`
   - same for `endParam → endAngle`.
   - When `A ≈ B` (isotropic) this `atan2` reduces to the true angle about the center, which is
     exactly what `arc.startAngle/endAngle` mean for a circle — so the same formula serves both
     the simplify-to-arc and the elliptical-arc cases.
7. **Reflection** (`det L = a·d − b·c < 0`): the affine reverses orientation, so a CCW source
   sweep becomes CW. Our `arc`/`ellipse` convention is CCW from start→end, so **swap
   start↔end** when `det L < 0` (mirrors the 4a `ocsReflected` angle-swap precedent). Full
   curves (no start/end) need no swap.
8. **Degenerate guard:** if `|det L|` is ~0 (zero-scale INSERT collapses the curve), do not
   attempt Rytz; fall back to mapping the center only and keeping prior radii (or skip) — this
   is a pathological INSERT and should not crash. Pick the simplest non-crashing behavior and
   note it in a comment + a test.

`EPS` for the isotropy check: a small relative tolerance, e.g. `Math.abs(A - B) <= 1e-9 * A`.
Tune via the hand-derived tests.

#### Per-kind dispatch in `transformPrimitive`

- **`circle`** → `transformEllipse(m, cx, cy, r, r, 0)`; if `isotropic` emit
  `circle { cx', cy', r: A }`; else emit full `ellipse { cx', cy', rx:A, ry:B, rotation:φ' }`
  (no start/end).
- **`arc`** → `transformEllipse(m, cx, cy, r, r, 0, startAngle, endAngle)`; if `isotropic`
  emit `arc { cx', cy', r:A, startAngle, endAngle }` (rotated/reflected angles); else emit
  elliptical-arc as `ellipse { cx', cy', rx:A, ry:B, rotation:φ', startAngle, endAngle }`.
- **`ellipse`** → `transformEllipse(m, cx, cy, rx, ry, rotation, startAngle, endAngle)`; emit
  `ellipse` (or simplify to `circle`/`arc` when `isotropic`, parallel to above).
- **`line`** / **`spline`** / **`point`** → unchanged (every vertex already affine-mapped;
  correct).
- **`rectangle`** → keep current center-map behavior (unreachable in import path; leave a
  comment that it is exhaustiveness-only).

Remove the `// 4b LIMITATION` block once the curve cases are correct.

### POINT OCS (folded into Slice A)

Separate, small: `mapEntity`'s POINT branch currently uses raw OCS x/y. Apply
`ocsXY(ext, e.x, e.y)` (extrusion 210/220/230), parallel to how CIRCLE/ARC already do it, to
close the 4b "POINT has no OCS extrusion handling" gap. POINT has no radius/angles, so this is
just the same OCS→WCS point projection used elsewhere.

### Tests (Slice A) — hand-derived oracles, TDD red→green

- **Update the pinning test** in `toSketch.spec.ts`
  (`'arc center is transformed but start/end angles are unchanged under a 90° rotated INSERT'`):
  rename to reflect corrected behavior and assert the rotated values its own comment already
  derives — `startAngle = π/6 + π/2 = 2π/3`, `endAngle = 2π/3 + π/2 = 7π/6`, center `(-4,3)`.
- arc under 90° rotated unit-scale INSERT → angles rotate +90°, stays an `arc` (isotropic).
- circle under non-uniform scale (e.g. xscale=2, yscale=1) → becomes `ellipse` with `rx=2r`,
  `ry=r`, `rotation=0` (no INSERT rotation).
- circle under non-uniform scale + 90° rotation → `ellipse` with axes swapped vs. above and
  `rotation=π/2` — exercises the Rytz path with a tilt.
- ellipse that is itself rotated (rotation=φ) under non-uniform scale → general Rytz case;
  oracle hand-derived from conjugate diameters.
- reflection: INSERT with xscale=-1 (mirror) on an arc → angles swapped (CW→CCW convention),
  center mirrored.
- nested INSERT composition (block within block, each with rotation+scale) → the composed
  affine produces the correct single transformed curve.
- POINT with extrusion (0,0,-1) → x mirrored via `ocsXY`.
- degenerate INSERT (xscale=0) → no crash; documented fallback.

---

## Slice B — Render 2D text annotations

### What exists

`TextAnnotation = { id; x; y; height; value; rotation }` (radians), attached as the optional
sibling array `annotations?: TextAnnotation[]` on the sketch Feature
(`packages/shared/src/types.ts`). 4b stores + persists + round-trips it, but nothing renders it.

The ONLY render site is `packages/app/src/sketcher/render/CommittedSketchRenderer.ts` — a pure
Three.js class whose `group: THREE.Group` holds the committed sketch geometry, drawn in the
sketch plane in the 3D viewport. (`SketchOverlay` is transient drafts only; the drawing module's
SVG text is a different subsystem.) There is no existing Three.js text facility and no
troika/drei dependency — only `three@0.165`.

### Approach: canvas-texture in-plane mesh (no new dependency)

Add to `CommittedSketchRenderer`:

- `private buildAnnotation(ann: TextAnnotation): THREE.Mesh`
  - render `ann.value` onto a 2D `<canvas>` with `fillText` (sized for legibility, e.g. a fixed
    pixel font size with the canvas dimensioned to the text metrics);
  - `THREE.CanvasTexture` → transparent `MeshBasicMaterial` (`depthTest` consistent with the
    other committed-sketch materials);
  - `PlaneGeometry` sized so the plane's **world height = `ann.height`** and width preserves the
    text aspect ratio;
  - position `(ann.x, ann.y, SKETCH_Z)`; `mesh.rotation.z = ann.rotation`.
  - This is an **in-plane mesh**, not a camera-facing `Sprite` — it lies in the sketch plane and
    rotates with the annotation, like the rest of the committed geometry.
- Extend the public API:
  `update(primitives: ReadonlyArray<SketchPrimitive>, annotations: ReadonlyArray<TextAnnotation> = [])`.
  Iterate annotations into `this.group` alongside primitives.
- **Cache key:** fold annotation identity into the existing rebuild cache key
  (`id:value:height:rotation` per annotation) so text rebuilds only when it changes.
- **Disposal:** dispose the `CanvasTexture` (and geometry/material) for annotation meshes in
  `dispose()` / on rebuild, matching the existing primitive cleanup.

### Call site

`packages/app/src/App.tsx:1951`
`r.update(sketch?.primitives ?? [])` → `r.update(sketch?.primitives ?? [], sketch?.annotations ?? [])`.

### Tests (Slice B)

Mirror the 4b point-marker test in
`packages/app/src/sketcher/render/__tests__/CommittedSketchRenderer.spec.ts`:

- `update([], [ann])` → `group.children` has length 1, child is a `THREE.Mesh` whose material
  carries a `CanvasTexture`.
- `mesh.rotation.z === ann.rotation`.
- plane world-height matches `ann.height` (assert via geometry parameters / bounding box).
- annotations + primitives together → both render; counts add up.
- empty/omitted annotations → no change vs. primitives-only (back-compat).
- changing only an annotation's `value`/`rotation` triggers a rebuild (cache-key test);
  unchanged input does not.

---

## Cross-cutting

- **No manifest bump.** Slice A emits only existing v32 primitive shapes; Slice B is pure
  rendering and changes no document shape.
- **No kernel / no WASM rebuild.** Slice A is pure shared TS; Slice B is app-side Three.js.
- **§6 verification:** package unit suites green for both, plus an e2e (extend
  `tests/e2e/drawing/dxf-import.spec.ts` or add a fixture) importing a DXF whose INSERT is
  rotated+scaled and contains an arc and a TEXT entity; assert via `window.__zilventorStore`
  that the imported arc has rotated angles (Slice A) and that an annotation is present and
  rendered (Slice B). Headless Chrome renders the viewport black → assert via store/DOM, never
  pixels. DEV import hook signature: `window.__zilventorImportDxfNewPart(file: File)`.

## Out of scope (later 4c slices, do NOT build now)

DIMENSION/LEADER/MLEADER→annotations; SOLID/3DFACE; RAY/XLINE→construction; HATCH boundary
loops; LAYER color/linetype→metadata; parser perf (index pairs per entity); large-file handling.
Then Phase 5 (round-trip/perf + §6) → M1 merge decision. Phase 2 §6 (real-AutoCAD open of an
EXPORTED dxf) remains HUMAN-GATED.
