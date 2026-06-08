# Component Pattern + Mirror (Assembly) — Design Spec

**Date:** 2026-06-08
**Track:** Tier-1 "Inventor 2012 parity for furniture design"
**Status:** Approved (brainstorming), pending implementation plan
**Predecessor:** Sketch productivity tools slice 1 (`08cf120`)

## 1. Purpose

Add the assembly-layer **Rectangular Component Pattern** and **Mirror Component**
operations — the assembly analog of the existing part-level Linear Pattern / Mirror
3D features. High furniture ROI: shelf arrays, drawer stacks, mirrored side panels /
doors / cabinets.

Today the assembly layer can only place components one at a time
(`PlaceComponentCommand`) or insert from STEP. There is no way to array or mirror a
placed component.

## 2. Scope

**In scope (this slice):**
- Rectangular component pattern: 1 direction, plus an optional 2nd direction (grid).
- Mirror component across a world plane, with geometrically correct (asymmetric-safe)
  mirroring.
- World axes (X/Y/Z) for pattern direction; world planes (XY/YZ/XZ, through origin)
  for the mirror plane — matching the part-level dialogs.

**Out of scope (deferred to a later slice):**
- Circular/polar pattern.
- Live-parametric / editable pattern node + grouped tree display (Inventor's
  associative pattern). Slice 1 bakes independent instances.
- Edge/face-picked direction or mirror plane (3D reference picking).
- Expression-parameter spacing (spacing is a literal mm at bake time).
- Pattern/mirror of a sub-assembly (vs a single component).

## 3. Key decisions (from brainstorming)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Bake to real `ComponentInstance`s** (not a live parametric feature) | Integrates with BOM/cut-list/nesting/drawings/solver for free; ~10× less surface than transient expansion. Trade-off: not live-editable — change count = delete group + re-pattern. |
| D2 | **Rectangular + Mirror** ship now; circular deferred | Rectangular (shelf/drawer arrays) + mirror (doors/side panels) are the furniture bread-and-butter; circular is rare in casework. |
| D3 | **Mirror = true kernel geometry mirror → new part** | The `pose` quaternion is rigid and cannot encode a reflection; reflecting only the placement is silently wrong for asymmetric parts. Mirror the BREP and recover a proper rotation. |
| D4 | **World axes/planes only** | Matches part-level Linear Pattern / Mirror; simplest; sufficient for furniture laid out on world axes. |
| D5 | **No new data-model fields, NO manifest bump (stays v20)** | Pattern → ordinary instances; mirror → a new part + ordinary instance. Nothing new to persist. |
| D6 | **No group/pattern node in slice 1** | Baked instances are independent first-class components; the create is one undo transaction. Grouped/editable pattern node deferred. |

## 4. Grounding (verified against current code)

- `ComponentInstance` (`packages/shared/src/types.ts:92`): `{ id, partPath,
  position, rotation, visible, pose?: { translation: Vec3; quaternion:
  [x,y,z,w] }, color?, flexible? }`. Migration normalizes all stored components to
  `pose` on load.
- `AssemblyDocument.components: ComponentInstance[]` (`types.ts:103`). All downstream
  consumers (BOM, cut list, nesting, drawings, solver, render, OPFS persist) iterate
  this array.
- `PlaceComponentCommand` (`packages/app/src/commands/PlaceComponentCommand.ts`):
  `apply()` builds a `ComponentInstance` (id `C${Date.now()}`), calls
  `useAppStore.getState().addComponent(instance)`. The command bus persists to OPFS.
- Command interface (`Command.ts`): `{ name; apply(): Promise<void>;
  revert(): Promise<void> }`.
- Part-level `LinearPatternFeature` / `MirrorFeature` (`types.ts:234`): single feature
  that expands to N bodies at kernel build; world axes `x/y/z`, world planes
  `xy/yz/xz`. Dialogs `LinearPatternDialog.tsx` / `MirrorDialog.tsx` (top-right fixed
  panel, Source dropdown, axis/plane buttons, Count/Spacing inputs, Cancel/OK).
- Kernel `mirrorShape(oc, shape, plane)` exists (used by part `MirrorFeature`);
  `registerPart(part)` exists (Load STEP feature); `dedupeName(base, existing)`
  (`packages/app/src/import/dedupeName.ts`).
- `AssemblyTab.tsx` ribbon sections: Component / Constraint / BOM. New "Pattern"
  panel slots between Component and Constraint.
- `CURRENT_FORMAT_VERSION = 20` (`fileFormat.ts:4`). Additive optional fields need no
  bump; this feature adds none.

## 5. Feature 1 — Rectangular Component Pattern

### 5.1 UI
New ribbon button **"Rectangular Pattern"** in a new "Pattern" panel on `AssemblyTab`
(disabled when no assembly is active / read-only). Opens `ComponentPatternDialog`
(clone of `LinearPatternDialog`):

- **Source** — dropdown of placed components (label by component/part name, value = id).
- **Direction 1** — X / Y / Z buttons.
- **Count 1** — integer 2–200.
- **Spacing 1** — mm (numeric literal; non-zero).
- **Second direction** — checkbox. When on, reveals **Direction 2 / Count 2 /
  Spacing 2** (same validation; Direction 2 must differ from Direction 1).
- Cancel / OK (OK disabled until valid).

### 5.2 Pure helper
`computeRectGridPoses(sourcePose, dir1, count1, spacing1, dir2?, count2?, spacing2?)
→ Pose[]`:
- Returns one pose per grid cell **excluding** the origin cell `(0,0)` (the source
  stays in place) — i.e. `count1*count2 − 1` poses.
- Each pose = source pose with `translation += i*spacing1*axis(dir1) +
  j*spacing2*axis(dir2)`; quaternion unchanged.
- `axis('x') = (1,0,0)`, etc. Pure rigid translation — no handedness issue.

### 5.3 Command
`CreateComponentPatternCommand`:
- `apply()`: read source instance; `computeRectGridPoses(...)`; for each pose clone the
  source `ComponentInstance` with a fresh unique id and that pose; `addComponent` each.
  Record the created ids.
- `revert()`: remove exactly the recorded ids.
- Unique ids across the batch: `C${Date.now()}_${index}` (or a counter) to avoid
  collision within a single apply.
- Persistence via the command bus (same as `PlaceComponentCommand`).

## 6. Feature 2 — Mirror Component

### 6.1 UI
Ribbon button **"Mirror"** in the "Pattern" panel. Opens `MirrorComponentDialog`
(clone of `MirrorDialog`): **Source** dropdown + **Plane** buttons XY / YZ / XZ
(through origin). Cancel / OK.

### 6.2 Geometry — the correctness core
A reflection has determinant −1, which a rigid `pose` quaternion cannot encode. So we
reflect the *geometry* and recover a proper rotation for the placement.

Let:
- `M` = world-plane reflection matrix: `M_xy = diag(1,1,−1)`,
  `M_yz = diag(−1,1,1)`, `M_xz = diag(1,−1,1)`.
- `S` = fixed **local** reflection applied to the part geometry: `diag(−1,1,1)`
  (mirror across local YZ, i.e. negate local X).
- Source placement: `world = R·local + t` (R from `pose.quaternion`, t =
  `pose.translation`).

Construct the mirrored component so that `new_world = M·old_world` for every point:
- New part geometry `local' = S·local` (kernel mirrors the BREP across local YZ).
- New placement rotation `R' = M·R·S`. Then `det(R') = (−1)(+1)(−1) = +1` → **R' is a
  proper rotation, representable as a quaternion.**
- New translation `t' = M·t`.

Verification: `R'·local' + t' = (M·R·S)(S·local) + M·t = M·R·local + M·t =
M·(R·local + t) = M·old_world`. ✔

### 6.3 Pure helper
`computeMirroredPose(sourcePose, worldPlane) → Pose`:
- Builds `M` from `worldPlane`, `S = diag(−1,1,1)`.
- `R'` = `M · quatToMat3(pose.quaternion) · S`; assert orthonormal, det +1;
  convert back to quaternion.
- `t'` = `M · pose.translation`.

### 6.4 Kernel
Public `mirrorPart(sourcePartId) → Part`: load the source part shape, `mirrorShape`
across **local YZ** (matching `S`), return a new Part. (Reuses existing `mirrorShape`;
no new OCCT primitive.)

### 6.5 Command
`MirrorComponentCommand`:
- `apply()`:
  1. `kernel.mirrorPart(source.partPath)` → mirrored Part.
  2. Name it `dedupeName("<sourceName>_mirror", existingPartNames)`; `registerPart`;
     `saveToBytes` → OPFS write (same pipeline as `ImportStepAsComponentCommand`).
  3. `computeMirroredPose(source.pose, plane)`; build instance at that pose referencing
     the new part; `addComponent`.
- `revert()`: remove the instance + the registered mirrored part (mirror
  `ImportStepAsComponentCommand.revert`).

## 7. Data model & persistence

No new shared types, no new fields, **no manifest bump (stays v20)**. Pattern produces
ordinary `ComponentInstance`s; mirror produces a new part + ordinary instance. The
mirrored part is correctly a distinct BOM line.

## 8. Testing strategy (TDD, red→green per slice)

| Layer | Tests |
|-------|-------|
| Pure helper (app/shared) | `computeRectGridPoses`: 1D count/spacing, 2D grid count, origin-excluded count, each axis. `computeMirroredPose`: each world plane; `R'` orthonormal + det +1; translation reflected; round-trips a known asymmetric pose to the expected world point. |
| Kernel (real OCCT) | `mirrorPart`: mirror an **asymmetric** solid; assert a known vertex lands at the reflected coordinate. **Driven by the producer's real output — never hand-authored** (the slice-1 fillet false-green lesson). |
| App command | `CreateComponentPatternCommand`: apply adds `count1*count2−1` instances at expected poses; revert removes them. `MirrorComponentCommand`: apply adds 1 instance + 1 part at the reflected pose; revert removes both. |
| UI | Dialog validation (count range, non-zero spacing, dir2≠dir1); ribbon button visibility/enablement. |
| e2e + §6 | Playwright through the real command bus: place a panel as a component → rectangular-pattern ×3 → assert 3 new instances + screenshot the shelf array; mirror a side panel → assert instance + reflected position + screenshot. Read screenshots back. |

## 9. Verification gate (§6)

The mirror geometry is the correctness-critical piece — it gets a **real-OCCT** test
that drives the actual `mirrorPart` output (not a hand-authored expectation), plus a
Playwright eyeball of both operations in the viewport. Pattern is rigid translation and
is covered by the pure-helper + command + e2e tests.

## 10. Open risks

- `R' = M·R·S` quaternion recovery must be verified numerically (orthonormality / det
  +1) — a sign error would silently mis-orient the mirror. Locked by the
  `computeMirroredPose` unit test asserting det +1 and a round-tripped world point.
- Mirrored part naming collisions in OPFS — guarded by `dedupeName` (the STEP-import
  data-loss lesson).
- Symmetric panels get a redundant mirrored part (accepted trade-off for always-correct
  geometry).
