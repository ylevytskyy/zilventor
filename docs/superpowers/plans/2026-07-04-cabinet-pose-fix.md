# Cabinet Pose & Rotation Fix — Implementation Plan (v2)

**Status:** v2 draft — AWAITING USER RATIFICATION. Planner conf 82/100; adversarial verifier
scored v1 at 58/100 with 4 required amendments, ALL addressed in this revision (verifier
endorsed the core Option B strategy; claims A/B/E verified against code; the regression
gates were empirically run: 37/37 green baseline). Residual risk: per-role rotation SIGNS
for roles derived by analogy are pinned by locking tests, not by this document.
**Do not implement until ratified.**

**Scope:** `packages/shared/src/cabinets/*`, `packages/app/src/assembly/walkers/composedPoses.ts`,
`flattenForSolver.ts`, `packages/app/src/kernel-client/flattenAssemblyForProjection.ts`,
`CreateCabinetCommand.ts`, `MirrorComponentCommand.ts`, `CreateComponentPatternCommand.ts`,
`CreateCircularPatternCommand.ts`, `EditComponentCommand.ts`
**Non-goals:** manufacturing/cut-list/DXF/nesting/labels/BOM (panel-local, already correct);
bore/joint-role semantics (`prisadkaFaceConventions.ts`, `syntheticSideBoreToReal`).

## 1. Defect

**Cause 1 — pose derivation drops rotation, duplicated 6 ways.** `composedPoses.ts:43`
hardcodes identity quaternion and never reads `c.rotation` or `c.pose`. Six call sites
duplicate "derive local pose from ComponentInstance" with three different fallback behaviors:
composedPoses (no pose, no rotation), flattenForSolver/flattenAssemblyForProjection/
MirrorComponentCommand/CreateComponentPatternCommand/CreateCircularPatternCommand (pose yes,
rotation no). Even diagonalCornerCabinet's correct `uprightRot` is discarded by all six.

**Cause 2 — template positions assume a box convention that doesn't exist.** buildPanelBox
(PanelOps.ts:94-98) builds X/Y-CENTERED, Z∈[0,T] boxes; all 4 templates store min-corner
positions + rotation {0,0,0}. Every panel sits offset by half its extents; side/back/toekick/
hangingRail panels additionally lie flat. Render composition (SceneManager.ts:533-541,
verified): `world = R·local + T`.

**Prior art to reuse:** DOOR_POSE quaternion + worked Shepperd derivation
(prisadkaFaceConventions.ts:55-57 — currently dead code: blindCornerCabinet drops the
quaternion); doorMath.ts center/edge translation convention; diagonalCornerCabinet uprightRot;
quatFromEulerXYZ (kernel/src/assembly/quat.ts:65-78, intrinsic XYZ).

## 2. Coupling analysis (verifier-confirmed)

- **2.1 Bore/joint pipeline fully decoupled:** GenerateCarcassBoresCommand (:126-146) builds
  its own PanelInput from `c.position` + panel dims, hardcoded identity quaternion; never
  reads c.rotation/c.pose/composedPoses. Its L↔T swap is a self-contained synthetic frame.
  ONLY changing `c.position` NUMBERS can break it — Option B never does. Baseline 37/37
  green (GenerateCarcassBores ×2 specs 20/20, jointMath 8/8, phase0-contract 9/9).
- **2.2 Bore-role remap rotation-independent:** syntheticSideBoreToReal is a pure role-tag
  remap; face2DFrame consumes panelDims only — no pose anywhere down to executeHoleFeature.
  phase0-contract A4/B2 derive the face constants from the same physical model this plan
  implements. Gate stays green untouched.
- **2.3 Stale-pose foot-gun (REAL, reachable):** EditComponentDialog (reachable on cabinet
  panels via right-click → open standalone, where they become isRoot) commits
  {position, rotation} via EditComponentCommand → updateComponent shallow-merge — pose
  survives untouched → post-fix, edits would be render-inert while still mutating fields the
  bore pipeline reads. Closed by Slice 2, sequenced BEFORE any template slice.
- **2.4 Consumers fixed for free:** SceneManager, picking, MoveConnector (consumes external
  worldPose), drawing/section projection (same composition path), resolveExportLeaves/clash.
  Solver seeding: flexible sub-assemblies seed leaf unknowns via initialPose — post-fix seeds
  carry real quaternions; quat math is generic; Slice 0 adds an empirical rotated-seed test.
- **2.5 Persistence:** ComponentInstance.pose already optional/additive — NO format bump.
  fileFormat.ts backfillAssembly4b (:545) already backfills pose from rotation on every
  unpackAssembly (its private eulerXYZToQuat is a THIRD duplicate of quatFromEulerXYZ —
  de-dup optional, non-trivial: kernel depends on shared, so the shared copy would need to
  become canonical). Nuance: diagonal stile/door render flat IN-SESSION today and only
  partially self-heal after OPFS round-trip for pose-honoring consumers; composedPoses never
  self-heals — Slice 0 fixes it immediately. Old documents keep broken render (positions
  baked at creation; no migration in this change; follow-up "Repair Cabinet Geometry"
  command proposed, gated on real-user-data exposure).

## 3. Translation rule (v2 core correction — verifier finding G)

buildPanelBox local box: X∈[-L/2,L/2] centered, Y∈[-W/2,W/2] centered, Z∈[0,T] EDGE-ANCHORED.
For a quarter-turn rotation sending local+Z to world axis `axisT` with sign `s_thk`, and
local X/Y to axes `axisL`/`axisW` (signs irrelevant — symmetric):

```
pose.translation[axisL] = position[axisL] + L/2          // always +, center
pose.translation[axisW] = position[axisW] + W/2          // always +, center
pose.translation[axisT] = s_thk > 0 ? position[axisT]    // near corner
                                    : position[axisT] + T // far corner
pose.quaternion         = quatFromEulerXYZ(rx, ry, rz)
```

Stored `position` numbers NEVER change (Option B isolation guarantee). A single rotated-vector
shortcut (`position + R·(L/2,W/2,0)`) is WRONG whenever a length/width sign is −1.
Verified against two independently-derived examples: leftSide → translation = position +
(0, D/2, H/2), rot ≈ 90° about Y, AABB x:[0,18] y:[0,560] z:[0,720]; back → position +
(W/2, Tb, H/2), rot ≈ 90° about X (s_thk=−1 → +Tb far corner).

### baseCabinet table (rotations are HYPOTHESES pinned by locking tests)

| Role | dims (L,W,T) | rotation (Euler XYZ°) | translation |
|---|---|---|---|
| leftSide | H,D,Tc | (0,90,0) | position + (0, D/2, H/2) |
| rightSide | H,D,Tc | (0,90,0) | position + (0, D/2, H/2) |
| back | W,H,Tb | (90,0,0) | position + (W/2, Tb, H/2) |
| toekick | W−2Tc,tkH,Tc | (−90,0,0) | position + ((W−2Tc)/2, 0, tkH/2) |
| hangingRail | W−2Tc,80,Tc | (−90,0,0) | position + ((W−2Tc)/2, 0, 40) |
| bottom/top/shelf | var,var,Tc | (0,0,0) | position + (L/2, W/2, 0) |

Other templates instantiate the same rule by role-analogy (cornerPost/blindFiller = side-panel
family; diagonal Bottom/Top = center-correction only; Back 2 keeps its existing rz=90, needs
only translation; Front Stile 1/2 + diagonal Door need ZERO template changes — Slice 0 alone
fixes them; blindCorner Door threads DOOR_POSE.quaternion directly).

## 4. Options

- **A — full unification** (rewrite position semantics, remove synthetic swap): rejected for
  this pass — changes c.position numbers → forces re-verification of the freshly-fixed bore
  pipeline in the same PR. Deferred as Phase 2 once B is stable.
- **B — additive pose field (RECOMMENDED, conf 80):** pose? wins in all consumers via one
  shared componentLocalPose helper; position/rotation numerically untouched; bore pipeline
  zero changes; per-role shippable/revertable.
- **C — render-only compensation: rejected** (fixes 1 of 6+ consumers; viewport would
  disagree with clash/exports; adds a 7th duplicate).

## 5. Slices (red→green; locking test = numeric world-AABB per role)

0. **componentLocalPose helper + 6-site consolidation** (+ rotated-seed flattenForSolver
   test; free win: diagonal stile/door render fixed in-session; optional eulerXYZToQuat
   de-dup flagged).
1. **CabinetComponentDef.pose? + CreateCabinetCommand threading** (absent stays absent —
   exactOptionalPropertyTypes).
2. **EditComponentCommand deletes pose when patching position/rotation** (true key deletion;
   revert restores exact prior snapshot incl. pose). MUST precede Slice 3.
3. **baseCabinet leftSide/rightSide** (flagship; EXEC screenshot; regression gates 37/37
   unchanged).
4. **baseCabinet back/toekick/hangingRail** (joint-excluded roles — pure render).
5. **baseCabinet bottom/top/shelf** (translation-only; panelB regression check).
6. **cornerCabinet** (8 roles incl. cornerPost).
7. **blindCornerCabinet** (7 roles + Door gets DOOR_POSE.quaternion — currently dropped).
8. **diagonalCornerCabinet remaining flat panels.**
9. **interference-clash-check re-derivation** (stale comment :259-261 + add a real AABB
   probe assertion; SC-11(b) count>0 still holds — overlap re-derived by hand; SC-11(c)
   untouched).

## 6. Test impact

Re-derive: interference-clash-check only. Must stay green unmodified: GenerateCarcassBores ×2,
jointMath, phase0-contract, composedPoses/flattenForSolver/flattenAssemblyForProjection/
SceneManager suites, Mirror/Pattern/CircularPattern command specs. New: componentLocalPose
spec, rotated-seed solver spec, CreateCabinetCommand pose case, EditComponentCommand
pose-deletion case, ~24 per-role locking tests, one EXEC screenshot per template.
Honest breaks expected: none identified.

## 7. Migration

No format bump (pose already additive). Old documents keep broken viewport render — no
regression, no repair; follow-up "Repair Cabinet Geometry" command proposed (out of scope),
gated on user-data exposure.

## 8. Risks / rollback

Sign errors → caught by numeric AABB locking tests before EXEC steps. Stale-pose class:
Slice 2 closes the known reachable path; other position/rotation-writing UI paths not
exhaustively audited (open follow-up). Partial rollout visible per-template — each slice
independently shippable/revertable. Rollback = remove pose values / revert helper fallback;
bore pipeline never touched.

## Open items for ratification

1. Approve Option B (vs A now / C never).
2. Approve Slice 2's delete-pose-on-manual-edit semantics.
3. Decide bundling of the optional eulerXYZToQuat de-dup (requires moving quat helpers into
   shared — dependency-direction change).
4. Confirm real-user-data exposure → priority of the follow-up repair command.
5. After Slices 3+ ship: decide Phase-2 (Option A unification) timing.
