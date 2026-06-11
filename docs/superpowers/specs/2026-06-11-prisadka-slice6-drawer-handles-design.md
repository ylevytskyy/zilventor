# Присадка slice 6 — Drawer handles / pulls

**Date:** 2026-06-11
**Track:** Tier-1 "Inventor 2012 parity for furniture" — присадка / hardware boring (slice 6)
**Predecessors:** slice 1 carcass joints `bdfe322` · slice 2 doors+система-32 `a57b1f7` · slice 3 live-edit+BOM `d4e17b8` · slice 4 drawer banks `9574d3f3` · slice 5 3D drag-gizmo `08722eee`
**Manifest:** v24 → **v25** (additive)
**Kernel:** small additive change (first kernel change since the bake-generic streak)

---

## 1. Goal

Each drawer in a bank gets:
1. A **visible bar-pull** rendered in the 3D viewport — bought hardware, NOT a manufacturable cut panel.
2. **Ø5 mounting-screw boring** on the drawer front's outward (`'Top'`) face — the holes the shop actually drills.

Configured **per-bank** via a dialog (one handle type/spacing applied to every drawer in the bank). The pull rolls into the **hardware BOM**; the bores roll into the **connector BOM** and the **DXF/CSV boring maps** and render as **3D bore markers** — all via the existing kind-agnostic pipelines.

Bar pull only this slice (knob/revolve deferred). Two screws at a standard center-to-center spacing.

---

## 2. Locked design decisions (from brainstorm)

| Axis | Decision |
|---|---|
| Direction | Присадка slice 6 — drawer handles/pulls |
| Handle geometry | **Visible bbox pull, rendered by teaching the kernel to bake the existing `hardware` feature's bbox** (`makeBox`). Correct hardware-BOM, no cut-list pollution, reusable for all future hardware. |
| Handle type | **Bar pull, 2 screws**, center-to-center ∈ {96, 128, 160} mm |
| Config UX | **Per-bank uniform dialog** (mirrors `DrawerBankDialog`) |

**Why the kernel path over app-only extrude:** the `'hardware'` feature kind already exists (`hardware-feature.ts`) and stores `bboxMm`, but `FeatureTree` has no dispatch branch for it → it currently renders nothing (kernel no-op, confirmed conf 92). `PanelFeature` renders but resolves a `PanelSpec` → wrongly appears in the cut-list. Teaching `FeatureTree` to bake `hardware → makeBox(bboxMm)` (a) makes the existing feature finally render, (b) keeps it out of the panel cut-list (no `PanelSpec`), (c) lands it in the hardware BOM, (d) is reusable for hinges/slides as real 3D parts later. `makeBox` already exists in `SolidOps`.

---

## 3. Ground-truth premises (from 4 Explore audits — confidence noted)

1. **Drawer fronts** (conf 88): each front is a `PartDocument` with a single 18mm `PanelFeature`, placed directly into the cabinet `.ziasm` as a `ComponentInstance` with `role:'drawerFront'`, posed with `DOOR_POSE` quaternion `[0.5,0.5,0.5,-0.5]`. The **outward (room-facing) face is `'Top'`**. On the `'Top'` face: **u-axis = height direction, v-axis = width direction**; face origin `{x:-L/2, y:-W/2, z:T}`, where `L = front.height`, `W = front.width`. Bores append to `front.bores[]` exactly like slice-4 slide bores (`AddDrawerBankCommand.ts:382`).
2. **No handle/pull/knob concept exists anywhere** (conf 88) — net-new.
3. **`hardware` feature is a kernel no-op** (conf 92): no `FeatureTree` branch; produces no solid; SceneManager has no special-case. `HardwareFeature` params: `{ kind:'hardware', id, hardwareSkuId, bboxMm:{l,w,h}, attachPoints }` (`hardware-feature.ts:25-31`).
4. **Cut-list vs hardware BOM are disjoint** (conf 92): `aggregateCutListRecursive` includes a part only if `resolvePanelSpec` finds an `isPanelFeature` (`resolvePanelSpec.ts:25`) — a hardware part returns null → excluded. `aggregateHardwareRecursive` finds `isHardwareFeature` → hardware BOM. ⚠️ **OPEN: confirm `aggregateHardwareRecursive` is wired into the shell (may be dead code).**
5. **Bore kind additive** (conf 82): `BoreConnectorKind` in `bore.ts:13`; `BoreRole` in `bore.ts:3-11`; `BoreOp = {id, face:FaceName, u, v, diameter, depth:number|'throughAll', role, connectorId, connectorKind, edited?, jointDir?}` (`bore.ts:21-39`, **no `atFace` field** — face is a `FaceName` object). `CONNECTOR_BOM_CATALOG` is data `{kind, nameKey, nameEn, nameUk, notes}` (`connectorBomCatalog.ts`); diameter/depth live on `BoreOp`, not the catalog.
6. **Export pipeline is kind-agnostic** (conf 82): `aggregateBoresRecursive`, `renderBoringDxf`, `buildBoringCsv` all pass any kind through — no new wiring.
7. **Manifest:** `CURRENT_FORMAT_VERSION = 24` (`fileFormat.ts:4`); additive bump = bump const + add `24:(m)=>({...deepClone(m), formatVersion:25})` + extend `normalizeKind` version list. Closest model spec: `migrateManifest-v21-to-v22.spec.ts`.

---

## 4. Schema changes (additive, v24 → v25)

In `packages/shared/src`:
- `bore.ts`: add `'handleScrew'` to `BoreConnectorKind`; add `'handleScrew-face'` to `BoreRole`.
- `connectorBomCatalog.ts`: add `handleScrew: { kind:'handleScrew', nameKey:'bom.connector.handleScrew', nameEn:'Handle screw', nameUk:'Гвинт ручки', notes:'Ø5 face mount' }`.
- `fileFormat.ts`: `CURRENT_FORMAT_VERSION = 25`; migration `24:(m)=>({...deepClone(m), formatVersion:25})`; extend `normalizeKind` version list to include 25.

In `packages/app/src/viewport`:
- `SceneManager.ts` `BORE_COLORS`: add `handleScrew: '<distinct color>'` (satisfies `Record<BoreConnectorKind,string>` — compile-guards).

Test arrays (exhaustiveness):
- `SceneManager.boreColors.spec.ts` `ALL_KINDS`: add `'handleScrew'`.
- `connectorBomCatalog.spec.ts` `ALL_KINDS`: add `'handleScrew'` **and** the pre-existing-missing `'drawerSlide'` (slice-4 escapee — currently red/absent).

i18n: add `bom.connector.handleScrew` key to en/uk bundles (parity-test gate). `dialog.drawerHandle.*` keys for the new dialog.

**No new persisted spec field** — the command bakes pulls + bores directly (bake-and-forget, like `AddDrawerBankCommand`). The v25 bump exists solely to gate the new persisted `connectorKind` enum value. (Spec-verify: challenge whether a bump is even required for a purely additive enum value; precedent = drawerSlide bumped v24.)

---

## 5. Kernel change (additive)

`packages/kernel/src/adapter/FeatureTree.ts`: add a dispatch branch for `feature.kind === 'hardware'`:
- Build a box from `bboxMm` via `makeBox` (`SolidOps.ts`), centered on origin in X/Y with bottom at Z=0 (match `PanelOps` box convention so pose math is consistent), OR centered on all three axes — **decide in plan; must match the pose math in §6**. Union into the running solid (a fresh hardware part has only this feature, so it becomes `finalSolid`).
- Real-OCCT integration test: a hardware part with `bboxMm = {l:128, w:30, h:12}` bakes to a solid of volume `128·30·12 = 46080 mm³` (±tolerance). A move/size change reflects in the volume → not a false green.

⚠️ Confirm in spec-verify: does any other code path assume `hardware` produces no geometry (e.g. a bbox-preview renderer, a guard that skips hardware in bake)? If so, reconcile.

---

## 6. Geometry

**Bar pull dimensions** (defaults; bar length derived from cc):
- `barLength = cc + 2·END_ALLOWANCE` (END_ALLOWANCE ≈ 16 mm) → e.g. cc=128 → 160 mm bar.
- Section: `BAR_DEPTH` (standoff from face, world-Y) ≈ 30 mm; `BAR_HEIGHT` (world-Z) ≈ 12 mm.
- `bboxMm = { l: barLength (along width/world-X), w: BAR_DEPTH (world-Y, outward), h: BAR_HEIGHT (world-Z) }` — exact axis assignment confirmed against the bake box convention in §5 + the pull pose quaternion.

**Pull pose:** a `ComponentInstance` placed so the bar lies horizontally, centered on the front's width, vertically centered, standing proud of the `'Top'` face by `frontThickness/2 + standoff`. Pose translation derived from the front's pose + the outward normal (world-Y) — reuse the front's `DOOR_POSE`-derived frame. Pure helper `handlePullPose(front)` → `{ translation, quaternion }`, unit-tested with an independent-frame oracle (do not reuse the production rotation in the test).

**Mounting bores** (per front, 2 bores) on the `'Top'` face:
- `u = front.height / 2` (vertical center).
- `v = front.width / 2 ± cc / 2` → two bores.
- `diameter = 5`, `depth = 'throughAll'` (screw passes through the 18mm front into the pull).
- `role = 'handleScrew-face'`, `connectorKind = 'handleScrew'`, shared `connectorId` per front (or per bore — decide; BOM dedup is cabinet-scoped per `connectorId`).
- Pure helper `handleBoreUV(front, cc)` → `[{u,v}, {u,v}]`, unit-tested.

---

## 7. Command + UI

**`AddDrawerHandlesCommand`** (`packages/app/src/commands`):
- Input: target cabinet assembly + `cc` (and any size overrides).
- Recurse the cabinet `.ziasm` for components with `role:'drawerFront'`.
- For each front: compute the 2 bores (`handleBoreUV`) → append to the front `.zipt` `bores[]` (read-mutate-write, slice-4 pattern); create the pull `PartDocument` (one `HardwareFeature`, `hardwareSkuId` → pull SKU, `bboxMm`) → `registerPart`/`opfs.write` → `addComponent` at `handlePullPose`.
- Atomic + undoable via `bus.execute`. Redo-optimized branch if cheap.
- ⚠️ Confirm the **hardware SKU registry** exists and how to register/reference a pull `HardwareEntry` (`hardwareSkuId`). If none exists, the plan adds a minimal pull SKU entry.

**UI:** `FurnitureTab` button **"Add Handles"** (enabled when the active cabinet has ≥1 drawer front) → `DrawerHandleDialog` (cc selector 96/128/160; optional bar size) → `bus.execute(new AddDrawerHandlesCommand(...))`. i18n keys `dialog.drawerHandle.*`.

**3D:** bore markers use the new `handleScrew` color; the pull renders as a box (via the §5 kernel branch). Selecting a `handleScrew` bore opens `BorePropertiesPanel` (Ø/depth/delete; `handleScrew` ∉ `CARCASS_KINDS` and ≠ `'hinge'` → `boreGizmoAxis` returns null → no drag gizmo, which is correct).

---

## 8. BOM / export

- **Hardware BOM:** pull aggregated by `hardwareSkuId` via `aggregateHardwareRecursive` (⚠️ confirm it's wired — §3.4). ×N drawers.
- **Connector BOM:** `handleScrew` bores via `CONNECTOR_BOM_CATALOG['handleScrew']` (cabinet-scoped `connectorId` dedup, slice-3 mechanism). 2 per front.
- **DXF/CSV boring map:** automatic (kind-agnostic walkers, §3.6).
- **Cut-list:** pull EXCLUDED (no `PanelSpec`). Verify it does NOT appear as a cut row (real test).

---

## 9. TDD slice plan (red→green→refactor each)

1. **Schema + migration + exhaustiveness compile-guards** — add `handleScrew` to both unions, catalog entry, `BORE_COLORS`, both `ALL_KINDS` (+ drawerSlide escapee); v24→v25 migration + round-trip test. Red: exhaustiveness `satisfies` fails to compile / ALL_KINDS test red.
2. **Kernel hardware-bbox bake** — real-OCCT integration: hardware part `{l,w,h}` → solid volume `l·w·h`. Red without the `FeatureTree` branch.
3. **`handleBoreUV` math** — 2 bores at `(H/2, W/2±cc/2)` for cc∈{96,128,160}. Pure unit test.
4. **`handlePullPose` math** — pose centered + proud of `'Top'`; independent-frame oracle. Pure unit test.
5. **`AddDrawerHandlesCommand`** — N fronts → N pull components + 2N bores; `bus.execute(instanceof)`; undo restores (no bores, no pull); redo. Controller test with a FULL `AssemblyDocument` seed (bare shim crashes addComponent — slice-4 lesson).
6. **`DrawerHandleDialog` + FurnitureTab wiring** — dialog submit dispatches the command (not a stub); controller test on the real handler.
7. **Real-browser e2e** — "Add Handles" → dialog → command → `__zilventorBoringAggregate()` shows 2·N `handleScrew` bores (recursion reaches every front) + hardware BOM shows N pulls + pull mesh present (probe `boreMarkerCount`/scene). Headless viewport is black → probes, not screenshots.

---

## 10. Verification gates

- Full app tsc via **direct `cd packages/app && npx tsc --noEmit | grep -c "error TS"`** (baseline 60 — `pnpm -r typecheck` MASKS app errors). Shared baseline 1.
- Full suites: shared (`packages/shared`), app (`packages/app`, `__tests__/`), kernel real-OCCT (`vitest.integration.config.ts`).
- Real-OCCT bake = ground-truth geometry proof (§5).
- e2e via `playwright.worktree.config.ts` (port 5182, manual `vite --port 5182` first).
- **FINAL whole-branch review re-checking this spec §-by-§** (caught silent unhandled-rejection + dead code in prior slices).

---

## 11. Deferred

Knob / revolve pulls; standoff "legs" (realistic bar profile); multiple pull SKUs / catalog browser; per-drawer handle config; handles on doors (not just drawers); vertical handle position options (top-mount vs centered); 32mm Система-32 grid snap for handle holes; drag-gizmo for handle bores (no move-axis); soft-close / push-to-open hardware; lead uk.json review of `bom.connector.handleScrew` + `dialog.drawerHandle.*`.

---

## 12. Open questions for spec-verify (4-lens)

- **A (geometry):** exact bbox axis↔world mapping for the pull pose; box centering convention in the §5 bake must match §6 pose math; bores `throughAll` vs partial depth correctness; END_ALLOWANCE/section defaults realistic.
- **B (schema/persistence/nesting):** is a v25 bump actually required for an additive enum value, or only a convention? Does anything assume `hardware`=no-geometry? Does the pull part need to nest anywhere special, or directly in the cabinet `.ziasm`?
- **C (false-green test design):** kernel bake must prove a MOVE/SIZE changes volume; e2e must prove recursion reaches EVERY front + dialog→command isn't stubbed; pose oracle must be independent of the production rotation.
- **D (reuse/API fit):** does a hardware SKU registry exist for `hardwareSkuId`? Is `aggregateHardwareRecursive` wired into the shell? Does `addComponent`/pack path reach a fresh hardware part? Is `BorePropertiesPanel` safe for a non-carcass/non-hinge kind?
