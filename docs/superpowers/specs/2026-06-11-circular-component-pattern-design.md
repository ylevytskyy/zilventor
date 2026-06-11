# Circular / Polar Component Pattern — Design Spec

**Date:** 2026-06-11
**Status:** Approved (brainstorm) → spec-verify → plan
**Track:** Tier-1 Inventor-2012 furniture parity. 10th feature. Extends Assembly Component Pattern + Mirror (`e1b5498`).
**Manifest:** NO bump (reuses `ComponentInstance` schema). **No kernel change.**

## 1. Goal

Add a **circular (polar) component pattern** to the AssemblyTab: select a source component, a rotation
axis + center, a count, and a total sweep angle; bake `count−1` additional `ComponentInstance`s evenly
spaced around the circle. Furniture use cases: round-table legs, lazy-susan trays, carousel shelving,
spoke layouts.

Architecture deliberately **mirrors the existing rectangular pattern stack** so the blast radius is small
and the code reads like its neighbor.

## 2. Locked decisions (from brainstorm)

| Axis | Q | Decision |
|---|---|---|
| Axis/center | Q1 | **World axis (X/Y/Z) + typed center point** `{x,y,z}`. No 3D edge/face picking (deferred). |
| Distribution | Q2 | **Count + total angle**, default 360°. Evenly spaced. (Incremental angle-step mode deferred.) |
| Orientation | Q3 | **Rotate instances ON by default, with a toggle.** ON = each instance rotated about the axis by its angle (legs/spokes point outward). OFF = source orientation kept, position still circles. |
| Scope | Q4 | **Bake independent instances** (like rect pattern). No live parametric pattern node (deferred). |

## 3. Pure pose math (`packages/app/src/assembly/poseHelpers.ts`)

Reuses existing `Pose = { translation: Vec3; quaternion: [x,y,z,w] }`, `quatToMat3`, `mat3ToQuat`,
`axisVec(axis)`. Adds two missing primitives + the pose generator.

### 3.1 New primitives

```ts
// Rodrigues axis-angle → unit quaternion [x,y,z,w]. axis assumed unit length.
export function axisAngleToQuat(axis: Vec3, angleRad: number): [number, number, number, number]

// Hamilton product a·b (both [x,y,z,w]). Used to compose the circle rotation onto sourceQuat.
export function quatMul(a: Quat, b: Quat): [number, number, number, number]
```

### 3.2 `computeCircularPoses`

```ts
export function computeCircularPoses(
  sourcePose: Pose,
  axis: PatternAxis,            // 'x' | 'y' | 'z'  → unit world axis via axisVec
  center: Vec3,                 // rotation center (point the axis passes through)
  count: number,                // total instances INCLUDING source (>= 2)
  totalAngleDeg: number,        // (0, 360]
  rotateInstances: boolean,
): Pose[]                        // returns count-1 NEW poses (source EXCLUDED), in i=1..count-1 order
```

**Angle-step convention (EXPLICIT — this is a known false-green trap):**
- **Full circle** (`totalAngleDeg >= 360`, clamp to 360): `stepRad = (2π) / count`.
  count=4 → angles 90°,180°,270° for i=1,2,3 (i=0 source at 0° excluded). No duplicate at 360°.
- **Partial arc** (`totalAngleDeg < 360`): `stepRad = (totalAngleDeg·π/180) / (count − 1)`.
  180°/5 → i=1..4 at 45°,90°,135°,180° (endpoints included).
- θᵢ = i · stepRad for i = 1..count−1.

**Translation** (rotate the radius vector about the world axis):
```
r   = sourcePose.translation − center
rᵢ  = rotateVecAboutAxis(r, axisUnit, θᵢ)      // via axisAngleToQuat(axis,θᵢ) applied to r
posᵢ = center + rᵢ
```
Note: the component of `r` parallel to the axis is preserved by the rotation (helix-free planar circle
when source is in the plane through center ⟂ axis; otherwise instances trace a circle at the source's
axial height — correct).

**Orientation:**
- `rotateInstances === true`: `quatᵢ = quatMul(axisAngleToQuat(axisUnit, θᵢ), sourcePose.quaternion)`
  (world-frame **pre-multiply** — the rotation is about a world axis, so it left-multiplies).
- `rotateInstances === false`: `quatᵢ = sourcePose.quaternion` (unchanged; position still circles).

`rotateVecAboutAxis(v, axis, θ)` = apply the quaternion `axisAngleToQuat(axis,θ)` to vector `v`
(`q · (0,v) · q⁻¹`, or equivalently `quatToMat3(q) · v`). Implement via `quatToMat3` to reuse code.

## 4. Command (`packages/app/src/commands/CreateCircularPatternCommand.ts`)

Parallel to `CreateComponentPatternCommand`. **No kernel call** (no geometry reflected; existing part is
re-placed). Pure store mutation + undo.

```ts
type CreateCircularPatternOpts = {
  sourceInstanceId: string;
  axis: PatternAxis;
  center: { x: number; y: number; z: number };
  count: number;               // >= 2
  totalAngleDeg: number;       // (0, 360]
  rotateInstances: boolean;
};
```

- `apply()`: look up source instance (noop if missing); `computeCircularPoses(...)`; for each new pose,
  create a `ComponentInstance` with a fresh UUID id, same `partPath`, `color`, `visible:true`, the new
  `pose` (+ legacy `position` mirrored from `pose.translation`, `rotation` left default per existing
  pattern), push via `useAppStore.getState().addComponent`. Track `createdIds`.
- `revert()`: remove `createdIds` from the assembly. Mirrors `CreateComponentPatternCommand`.

## 5. UI

### 5.1 AssemblyTab
Add a **"Circular Pattern"** button to the existing Pattern button group in
`packages/app/src/shell/tabs/AssemblyTab.tsx`, next to "Rect Pattern" + "Mirror". Opens a new dialog via a
new store flag `setCircularPatternDialogOpen(true)` (parallel to `setComponentPatternDialogOpen`).

### 5.2 `CircularPatternDialog` (`packages/app/src/shell/CircularPatternDialog.tsx`)
Copy the structure of `ComponentPatternDialog`. Collects:
- **Source component** (same selector as rect dialog).
- **Axis**: X/Y/Z button group (default Z — vertical, the common furniture case).
- **Center**: three numeric inputs x/y/z (default 0,0,0).
- **Count**: 2–200 (default 4).
- **Total angle (deg)**: numeric, (0, 360] (default 360).
- **Rotate instances**: checkbox, default **checked**.

**Validation** (block submit + inline message): count integer ≥ 2 and ≤ 200; angle a number in (0, 360];
center components numeric; a source component selected. On submit dispatch
`CreateCircularPatternCommand` through `bus.execute`, then close.

All new user-facing strings go through `t()` (i18n) with `en` + `uk` keys, matching the codebase
convention. (uk values: lead reviews later — flag in handoff.)

## 6. Tests (TDD slices) — built to dodge the recurring false-greens

### Slice A — `axisAngleToQuat` + `quatMul` (unit, app/poseHelpers.spec.ts)
- `axisAngleToQuat([0,0,1], π/2)` → known quaternion `[0,0,√2/2,√2/2]`; applying it (via `quatToMat3`)
  to `[1,0,0]` yields `[0,1,0]` (within 1e-9). Assert the **rotated vector**, not the raw quat, to avoid
  sign-convention tautology.
- `quatMul` against a hand-computed Hamilton product; and identity `quatMul(q, [0,0,0,1]) === q`.

### Slice B — `computecircularPoses` translation (unit)
- Source at `{2,0,0}`, axis z, center origin, count 4, angle 360, rotate any. Assert the 3 returned
  translations are at radius 2 from the z-axis (`hypot(x,y) ≈ 2`) and at angles 90/180/270° (`atan2(y,x)`).
  **World-position round-trip — NOT quaternion equality.**
- Partial arc: count 5, angle 180. Assert angles 45/90/135/180° (endpoints) — proves the `count−1` divisor.
- Off-center: center `{1,0,0}`, source `{3,0,0}` (radius 2 about center). Assert instances orbit `center`,
  not origin.
- Axial-height preservation: source `{2,0,5}`, axis z. Assert each instance keeps `z ≈ 5`.

### Slice C — orientation (unit)
- `rotateInstances=true`, source with a NON-identity quaternion (e.g. 90° about x). Map a source-local
  point through each instance's composed quaternion (`quatToMat3(quatᵢ)·p`) and assert it matches
  `R(axis,θᵢ)·(R_source·p)` — i.e. the world pre-multiply order. A wrong compose order (post-multiply)
  fails this. (This is the load-bearing non-tautological orientation test.)
- `rotateInstances=false`: assert every instance quaternion `=== sourceQuat` AND positions still moved.

### Slice D — `CreateCircularPatternCommand` (command spec)
- count 4 → 3 new instances added; positions match `computeCircularPoses`; all share source `partPath`.
- undo (`revert`) → back to 1 instance. Redo round-trip.
- noop when `sourceInstanceId` missing.

### Slice E — UI dialog (app component test) — guards the slice-3 lesson
- Render `CircularPatternDialog`, set count/angle/axis, toggle rotate, submit → assert a
  `CreateCircularPatternCommand` is dispatched with the **exact** opts the form held (not a stub).
- Validation: count 1 or angle 0/361 blocks submit + shows message.

### Slice F — e2e (probe path, `tests/e2e/`) + §6 browser
- Drive `CreateCircularPatternCommand` via `page.evaluate` import (matches existing pattern e2e), assert 4
  instances on the circle via `__zilventorStore` / `__zilventorAssemblyPoses()`, undo round-trip.
- Headless viewport is BLACK → verify via probes + (if persistence touched) byte-OPFS, not screenshots.

### FINAL gate (NOT a test slice — a review)
**Whole-branch review of the actual UI code** (`CircularPatternDialog.tsx` + `AssemblyTab.tsx` wiring),
because slice 3 shipped a green command-e2e over a stubbed dialog. Confirm the button opens the dialog,
the dialog reads live state, and submit dispatches the real command. Slice E is the automated guard;
the review is the human-equivalent backstop.

## 7. Explicit non-goals (deferred)
- 3D edge/face axis picking (world-axis + typed center only).
- Incremental angle-step distribution mode (count + total-angle only).
- Live parametric pattern node / re-bake on source move (bake independent instances).
- Pattern of a sub-assembly as a unit, pattern-of-pattern, edge/face-driven refs.
- Kernel geometry (none — instances re-place existing BREP).

## 8. False-green ledger (carried from prior slices — must all be addressed)
1. **Tautological pose assertion** → Slices B/C assert world position + mapped-point, never raw quat equality.
2. **Angle-division convention** (count vs count−1) → §3.2 explicit + Slice B tests BOTH full and partial.
3. **rotateInstances compose order** (pre vs post multiply) → Slice C tests with a non-identity source quat.
4. **Green command-e2e over a stubbed UI** → Slice E exercises the dialog submit + FINAL whole-branch review.
5. **tsc errors in test files** vitest misses → run FULL-package `tsc --noEmit` before merge.

## 9. Verification matrix
- shared: n/a (math lives in app/poseHelpers). app unit: Slices A–E. e2e: Slice F.
- §6: real-browser probe (`__zilventorAssemblyPoses`) — instances at correct circular poses.
- tsc: 0 new errors (full-package).
- No kernel integration (no new OCCT geometry — flagged intentionally).

## 10. Spec corrections v2 — AUTHORITATIVE (post 4-lens adversarial verify)

Core math, compose order, and angle-step convention verified CORRECT (no blockers). The following
corrections are binding on the plan/implementation. They OVERRIDE any conflicting earlier text.

### 10.1 Test oracles must be independent (anti-tautology) — load-bearing
- **Slice C oracle:** compute the expected rotated point as
  `quatToMat3(axisAngleToQuat(axisUnit, θᵢ)) · ( quatToMat3(sourceQuat) · p )` — TWO separate matrix
  applications. **Do NOT call `quatMul` in the oracle** (a `quatMul` sign bug would otherwise pass in both
  actual and expected). This mirrors the existing `poseHelpers.spec.ts` mirror round-trip convention.
- **Slice C test point `p`** must NOT be parallel to the circle axis NOR the source rotation axis
  (e.g. with axis z + source-rot about x, use `p = [1,1,0]`), else pre/post-multiply are indistinguishable.
- **Slice A `axisAngleToQuat`** expected value `[0,0,√2/2,√2/2]` is HAND-AUTHORED (not derived from the fn);
  assert the rotated vector `[1,0,0]→[0,1,0]` too.
- **Slice A `quatMul`** hand-test must use a NON-degenerate, non-commuting pair, e.g. `quatMul([1,0,0,0],
  [0,1,0,0]) === [0,0,1,0]` (i·j=k). The identity test alone is degenerate (zero cross term).

### 10.2 Slice D must thread `center` + `rotateInstances` (command-level) — load-bearing
The command could hardcode `center:{0,0,0}` / `rotateInstances:true` and still pass default-only tests. ADD:
- A command test with `center:{1,0,0}`, source at `{3,0,0}` → assert created instances orbit `{1,0,0}` (not origin).
- A command test with `rotateInstances:false` → assert every created instance quaternion `=== sourceQuat`.

### 10.3 Codebase-fit corrections (confirmed against real code)
- **No `Quat` type in `@zilventor/shared`.** Use the bare tuple `[number, number, number, number]` for
  `axisAngleToQuat`/`quatMul` signatures (do NOT import the kernel-internal `Quat`).
- **`axisVec` is file-private** in `poseHelpers.ts` — `computeCircularPoses` lives in the SAME file; tests
  must not import `axisVec` directly.
- **ComponentInstance fields:** the new instances MUST set `rotation: { rx: 0, ry: 0, rz: 0 }` explicitly
  (NOT `undefined`), `visible: true`, `position` mirrored from `pose.translation`, `partPath`+`color` from
  source — copy the exact struct from `CreateComponentPatternCommand.ts` (~line 52–66).
- **New store flag** `circularPatternDialogOpen` + `setCircularPatternDialogOpen` go in
  `packages/app/src/store/useAppStore.ts` alongside `componentPatternDialogOpen`/`mirrorComponentDialogOpen`.
- **i18n parity gate:** `packages/app/src/i18n/parity.test.ts` enforces strict en≡uk key-set equality →
  every new key (e.g. `dialog.circularPattern.*`, the AssemblyTab button label) MUST be added to BOTH
  `en.json` and `uk.json` in the SAME change or the build fails. (uk values: provisional; lead reviews — flag in handoff.)

### 10.4 Dialog/validation corrections
- **Count label** reads **"Count (incl. source)"** with helper text (e.g. "4 = source + 3 copies") — avoids
  the total-vs-new foot-gun. Input `step={1}`; validation asserts `Number.isInteger(count)` and `2 ≤ count ≤ 200`.
- **Degenerate radius guard:** if `|sourcePos − center|` (component ⟂ axis) `< ε` (0.1 mm), block submit with
  a message ("Source lies on the rotation axis — all copies would overlap; move the center"). Add to §5.2 validation.
- Axis default Z; angle default 360; rotate-instances default checked (unchanged).

### 10.5 e2e (Slice F) scope — accepted as-is
Probe-path command e2e + Slice E (DOM-interaction dialog test using `fireEvent.change`/`userEvent`, NOT prop
injection) + the FINAL whole-branch UI review together cover the slice-3 stubbed-UI class. A button-click
Playwright path is OPTIONAL (rect pattern shipped without one); add only if cheap. Slice E MUST drive real
`<input>` elements and assert the dispatched command opts match what the form held.
