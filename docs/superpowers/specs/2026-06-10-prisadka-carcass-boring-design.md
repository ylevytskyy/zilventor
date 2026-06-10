# Присадка slice 1 — Carcass-joint boring (hardware drilling map)

**Date:** 2026-06-10
**Status:** Approved (brainstorming → spec)
**Track:** Tier-1 "Inventor 2012 parity for furniture" (follow-up feature; sub-project-scale)
**Base:** master `859df7f` · manifest v20 → **v21** (additive)

---

## 1. Motivation

The furniture-design team named **присадка** (hardware boring / drilling map for panels)
its most-demanded missing capability. A присадка is the set of holes a panel needs so
fittings mount and the carcass assembles: confirmat / minifix / dowel joints, hinge cups,
система-32 shelf-pin rows. The production deliverable is a **карта присадки** (per-panel
hole coordinates + Ø + depth) that feeds a присадочний станок (boring machine / CNC) or a
manual drilling station.

This slice delivers **carcass-joint присадка**: the connector holes (конфірмат / мініфікс /
шкант) that join carcass panels — generated automatically from a cabinet's structure or
manually from two picked panels — visualized as 3D markers, exported as DXF + CSV, and
optionally **baked** into real holes so they also appear in 3D and in 2D `.zidw` drawings.

Hinge-cup and система-32 shelf-pin присадка are a **later slice** (out of scope here).

## 2. Decisions (locked in brainstorming)

| Axis | Decision |
|---|---|
| Geometry representation | **Hybrid**: lightweight bore metadata + 3D markers (fast path) **+ "bake"** to real `HoleFeature`s on demand |
| First-slice source | **Carcass joints** (конфірмат / мініфікс / шкант) |
| Joint detection | **Auto from cabinet template + manual two-panel fallback** |
| Connectors | **конфірмат + мініфікс + шкант** (all three) |
| Export | **DXF + CSV** |
| 2D drawings | **Yes** — via the bake path (baked holes auto-project) |

## 3. Verified premises (code-checked before this spec)

1. **Bake → drawings — CONFIRMED.** The projector consumes the part's final solid
   (`FeatureTree.ts:902` tessellates `finalSolid`; `getProjectorInput.ts:26-31`), and
   `holeTable.extractHolesInView` (`holeTable.ts:151-198`) + `autoPlaceCenterMarks`
   (`autoPlaceCenterMarks.ts:49-112`) key off projected circle geometry / `featureId`
   face-names. Baked holes appear in `.zidw` with **no** extra drawing work.
   - *Caveat:* `fromSketch` hole placement only supports origin planes (XY/XZ/YZ)
     (`HoleFeature.ts:210-231`). Baking onto offset panel faces therefore uses **`linear`
     placement** (`HoleFeature.ts:85-143`, resolves on the running body) **or** a new thin
     additive **`atFace`** placement (see §9).
2. **3D pick infra — CONFIRMED.** `raycastAssemblyRef('face'|'edge')` and component pick
   (`Viewport.tsx:73-77,284-333`; `SceneManager.raycastComponent` `:648-661`); transient
   overlays via `setPreviewMesh`/`addObject`/`removeObject` (`SceneManager.ts:129,147,259-282`);
   edge-band line overlays as a marker precedent (`SceneManager.ts:556-594`).
   - *Gap:* assembly-mode **FaceName/EdgeName resolution is an unfinished TODO** (T36/T38;
     `AssemblyRefPickController.ts:18-58`, `App.tsx:2173-2181`). The manual tool therefore
     picks **two whole panels (component-level pick, already wired)** and infers the joint
     geometrically — sidestepping the unfinished face-name resolution.
3. **Auto-from-template — PARTIAL → fixed by role persistence.** The cabinet builder knows
   each panel's role+pose at build time (`CabinetPanelDef.role`, `CabinetComponentDef.position/
   rotation`, `cabinets/types.ts:4-37`) but **discards role** when writing the assembly
   (`CreateCabinetCommand.ts:126-132` → `ComponentInstance` has no role; `properties: {}`).
   Fix: persist role (additive `role?` on `ComponentInstance`, populated at create time).
   - *Consequence:* auto-присадка lights up only for cabinets **created after** this feature;
     pre-existing cabinets use the manual path.
   - Left/right sides are **separate files with identical dims** (`baseCabinet.ts:29-43`),
     not mirror-instances → присадка is computed **mirrored per side** and stored on each
     distinct part.

## 4. Architecture overview

```
                 ┌─────────────── generation (assembly context) ───────────────┐
  cabinet roles  │  GenerateCarcassBoresCommand (auto)                          │
  + poses ───────┤  AddManualJointBoresCommand (two picked panels)              │
                 │     │  jointMath: role/pose/dims → joint line + A/B + frames  │
                 │     │  connectorCatalog: kind → BoreOp[] on A and on B        │
                 └─────┼──────────────────────────────────────────────────────┘
                       ▼ writes (atomic, undoable)
        PartDocument.bores: BoreOp[]   (intrinsic to each panel part)
                       │
        ┌──────────────┼───────────────────────────────┬───────────────────────┐
        ▼ fast path     ▼ fast path                      ▼ on demand             ▼ on demand
   3D markers      DXF + CSV boring-map              BakeBoresCommand        (un-bake)
  (three.js,      (per-panel hole coords)        → HoleFeatures → real      removes holes
   no OCCT)                                          holes → 3D + .zidw
```

**Bores live on the part.** A panel is intrinsically "a drilled panel"; bores travel with it,
export per-part, bake locally, and draw in part drawings. The assembly only carries `role`
(for auto generation). No live "connector" entity in slice 1 — `BoreOp.connectorId` links a
pair/set for export grouping; **editing a placed connector = regenerate** (live editable
connectors = slice 2).

## 5. Data model (`packages/shared`)

```ts
// new: packages/shared/src/bore.ts
type BoreRole =
  | 'confirmat-face' | 'confirmat-edge'
  | 'minifix-cam' | 'minifix-bolt' | 'minifix-cross'
  | 'dowel-face' | 'dowel-edge';

interface BoreOp {
  id: string;
  face: FaceName;            // which panel face (Top/Bottom/Front/Back/Left/Right) the drill enters
  u: number; v: number;      // panel-local 2D coordinate on that face (mm), per face2DFrame()
  diameter: number;          // mm
  depth: number | 'throughAll';
  role: BoreRole;
  connectorId: string;       // links the bores of one connector (pair/triple)
  connectorKind: 'confirmat' | 'minifix' | 'dowel';
}

// additive on the part document (types.ts PartDocument)
bores?: BoreOp[];

// additive on the assembly instance (types.ts ComponentInstance) — for auto generation
role?: PanelRole;            // 'leftSide'|'rightSide'|'bottom'|'top'|'back'|'toekick'|'shelf'
```

`face2DFrame(panelDims, faceName)` (new, pure): returns the origin + u/v basis for a face's
local 2D coordinate system, so `(u,v)` is deterministic and reversible. Panel part frame is
the existing one (centered in X/Y, bottom at Z=0; `PanelOps.buildPanelBox`).

## 6. Connector catalog (`packages/shared/src/connectorCatalog.ts`, parametric)

Each connector kind is a pure generator `(joint, panelA, panelB, params) → { boresA: BoreOp[], boresB: BoreOp[] }`.
`A` = the face-drilled (through) panel; `B` = the end-drilled panel.

Standard furniture defaults (all parametric + editable in the dialog; cited from система-32
practice — confirm with the team before lock):

| Kind | Panel A (face/through) | Panel B (end/edge) | Extra bore | Notes |
|---|---|---|---|---|
| **confirmat** (евровинт 7×50) | Ø7 through A, at B-thickness centerline | Ø5 × (L−tA) into B end | — | L=50 default |
| **minifix** (ексцентрик Ø15) | Ø15 cam blind ×12.5 on A face | Ø8 bolt in B end ×24–34 | Ø8 cross from A edge into cam | cam center ~34 mm from edge |
| **dowel** (шкант Ø8) | Ø8 × 12 face | Ø8 × 20 end | — | alignment; often paired w/ confirmat |

Placement along a joint (parametric): `endSetback` (default 60 mm), `maxSpacing` (default
250 mm), `minCount` (2). Count = `max(minCount, ceil((jointLen − 2·endSetback)/maxSpacing)+1)`,
evenly distributed between the setbacks.

> **Spec TODO before plan lock:** a furniture-accurate review pass on the minifix three-bore
> geometry (cam offset, cross-bore depth = edge→cam distance) and confirmat edge depth.
> Defaults above are sound but the minifix cam offset in particular should be confirmed.

## 7. Joint derivation (`packages/shared/src/jointMath.ts`, pure)

Input: two panels as `{ dims, pose, role? }`. Output: `Joint = { line: {p0,p1}, panelA, panelB,
faceA: FaceName, endB: FaceName, frameA, frameB }` or `null` if no valid butt joint.

- **Auto (template):** from persisted `role` + pose + dims, enumerate the standard carcass
  joints — side↔bottom, side↔top, side↔shelf(s). For each, role fixes A (face-drilled) vs B
  (end-drilled) deterministically; right-side joints mirror the left. No geometric contact test.
  **Back↔carcass and toekick joints are DEFERRED** — backs sit in a groove/rebate (not
  connector-drilled) and toekick is non-structural; `enumerateAutoJoints` must NOT pair these.
- **Manual:** infer from the two picked panels' world AABBs/poses — find the coplanar-adjacent
  face↔end pair (A's face plane within ε of B's end plane, overlapping extents). Choose A =
  the panel whose **face** lies in the joint plane, B = the panel whose **end** butts it
  (user can swap A/B in the dialog).

## 8. Commands (`packages/app/src/commands`, undoable on the bus)

- `GenerateCarcassBoresCommand(assembly, params)` — auto; reads persisted roles, runs
  jointMath over all standard joints, generates connectors, writes `bores[]` to every
  involved part atomically. Revert restores prior `bores[]` per part.
- `AddManualJointBoresCommand(panelPathA, panelPathB, kind, params)` — manual two-panel path.
- `BakeBoresCommand(part)` / `UnbakeBoresCommand(part)` — see §9.
- `ClearBoresCommand(scope)` — remove generated bores.
- `CreateCabinetCommand` — **modified**: populate `ComponentInstance.role` from `CabinetPanelDef.role`.

## 9. Bake (hybrid) — `packages/kernel` thin additive surface

`BakeBoresCommand` groups a part's `bores[]` by `(face, diameter, depth)` and emits hole
geometry through the existing `makeHole` pipeline (`HoleOps.ts`), appending `HoleFeature`(s)
to the part featureTree and executing. Reuse path:

- **Preferred:** add an additive `HolePlacement` variant **`atFace`**:
  `{ mode:'atFace', face: FaceName, points: {u,v}[], axis:'into-face' }`, resolved in
  `HoleFeature.ts` to `HoleLocation[]` against the running solid (parallels
  `resolveLinearLocation`). Small, additive — no manifest impact (Feature union just grows).
- Un-bake removes the bake-authored `HoleFeature`s (tracked by a `boreBakeId` tag).

**Perf:** bake = N sequential OCCT Boolean cuts (the known cliff; ~10–50 ms each). It is
**opt-in, batched, progress-gated**; the fast path (markers + DXF/CSV) never pays it. This is
the entire reason for the hybrid choice. Bake groups by profile so identical bores share a
single fused cut where possible.

## 10. 3D markers (`packages/app/src/viewport`, no OCCT)

Render `part.bores` as instanced disc/ring markers (`THREE.CircleGeometry`/`RingGeometry`,
`MeshBasicMaterial`, `depthWrite:false`) on panel faces, transformed by component pose in
assembly view. Color by `connectorKind`, radius by Ø. Built/cleared via the existing
`addObject`/`removeObject` + overlay-array cleanup pattern (precedent:
`rebuildEdgeBandOverlays`). Toggle in the Furniture ribbon.

## 11. Export (`packages/app`)

- **CSV** — `aggregateBoresRecursive(assembly, cache)` (new walker, mirrors
  `aggregateCutListRecursive`) collects each panel instance's `bores[]`; `buildBoringCsv`
  emits rows `Panel, Tag, Face, X, Y, Ø, Depth, Type` grouped per panel (reuses `csvCell`).
  `ExportBoringCsvCommand` + Furniture-ribbon button.
- **DXF** — `renderBoringDxf` via existing `dxfWriter`: one block per panel = panel outline
  (POLYLINE) + a CIRCLE per bore on a layer named per `(Ø,depth)` e.g. `D5_T34`, `D15_T12`.
  `ExportBoringDxfCommand` + button. Panels laid out with offset (nesting-style) or one file
  per panel — finalize in plan (default: single DXF, panels offset on a grid).

## 12. 2D `.zidw` drawings

Satisfied via §9 bake: once baked, holes auto-project with center-marks + hole-table rows
(premise 1, CONFIRMED). No separate drawing-pipeline code in this slice. (Showing bores in a
drawing **without** baking is a deferred non-goal.)

## 13. Persistence / manifest (additive → v21)

- `PartDocument.bores?: BoreOp[]` (optional; default `[]`).
- `ComponentInstance.role?: PanelRole` (optional).
- `connectorCatalog` is code-seeded (like `builtinCatalog`), not persisted per-document.
- Bump `CURRENT_FORMAT_VERSION` 20 → **21** with a **no-op migration** (absent → `[]`/unset),
  add `21` to the `ProjectFile` formatVersion union, add a `migrateManifest-v20-to-v21` test.
  Pattern mirrors v19→v20 (`customTextures[]`). No existing field removed or retyped.

## 14. Internal phase plan (TDD slices — input to writing-plans)

Each phase = red→green→refactor; suite green after each.

1. **Data model + catalog + migration** — `bore.ts`, `connectorCatalog.ts`, `face2DFrame`,
   v20→v21 migration + test. (shared)
2. **Joint math** — `jointMath.ts` auto + manual inference, unit-tested on cabinet geometry. (shared)
3. **Auto generation + role persistence** — `GenerateCarcassBoresCommand`; modify
   `CreateCabinetCommand` to persist `role`. (app)
4. **Manual two-panel command** — `AddManualJointBoresCommand` + viewport two-panel pick wiring. (app)
5. **3D markers** — render `bores[]` as face markers + ribbon toggle. (app)
6. **CSV export** — `aggregateBoresRecursive` + `buildBoringCsv` + command/button. (app/shared)
7. **DXF export** — `renderBoringDxf` + command/button. (app)
8. **Bake/un-bake** — `atFace` placement (kernel) + `BakeBoresCommand`/`UnbakeBoresCommand`;
   prove holes appear in 3D + `.zidw`. (kernel + app)
9. **e2e + §6 browser** — real-WASM e2e (generate → markers → bake → drawing/holes;
   export bytes), §6 controller reads screenshots, tsc pass.

## 15. Non-goals (deferred)

- Geometric auto-joint-detection across arbitrary assemblies.
- Live editable / draggable connectors (edit = regenerate in slice 1).
- Hinge-cup + система-32 shelf-pin присадка (the other Q2 branch).
- Per-connector hardware-BOM rollup (count confirmats/minifix into the Hardware CSV).
- Bores in `.zidw` **without** baking (separate 2D-annotation path).
- Auto-role-tagging of pre-existing (pre-feature) cabinets.
- Back-panel and toekick auto-присадка (backs are grooved/rebated into the sides, not connector-drilled; toekick is non-structural; both are excluded from `enumerateAutoJoints` in slice 1).

## 16. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| Pre-existing cabinets lack `role` → no auto присадка | Manual two-panel path covers them; document clearly |
| Bake perf on a full carcass (many Boolean cuts) | Opt-in, batched, progress-gated; fast path never bakes |
| `atFace` placement is new kernel surface | Small, additive; locked with a kernel integration test (real OCCT) |
| Marker/joint coordinate correctness invisible to unit tests | **§6 real-browser gate is mandatory** + real-WASM e2e; any kernel/solver bug surfaced → RED-without-fix regression |
| Minifix default geometry inaccurate | Furniture-accurate review pass before plan lock (§6 catalog TODO) |

## 17. Success criteria

- Auto: a freshly created base cabinet → "Присадка (auto)" generates confirmat/minifix/dowel
  bores on the correct joints, mirrored correctly L/R; markers visible at correct positions
  (§6 browser-verified).
- Manual: pick two panels → connectors along the inferred joint.
- Export: CSV rows + DXF circles match the bores (byte-verified); per-panel grouping correct.
- Bake: baked holes appear as real 3D voids **and** as circles + center-marks in a `.zidw`
  view (§6 + e2e).
- Undo restores prior `bores[]` for every command.
- Additive only: v20 files load unchanged; v21 migration is no-op; existing suites green.
