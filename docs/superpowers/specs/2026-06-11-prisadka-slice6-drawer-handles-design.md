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

---

## 13. §13 Corrections v2 — AUTHORITATIVE (overrides §1–12 on conflict)

Resolved from the 4-lens adversarial spec-verify (geometry / schema / false-green / reuse — all conf ~82). The plan + implementers follow THIS section where it conflicts with the body.

### 13.1 Geometry (lens A)
- **B1 — `makeBox` is corner-at-origin, NOT centered.** `SolidOps.ts:30` uses `BRepPrimAPI_MakeBox_2(dx,dy,dz)` → box spans `[0,dx]×[0,dy]×[0,dz]`. PanelOps uses the two-corner `BRepPrimAPI_MakeBox_4(p1,p2)` to center. **Decision:** the new `hardware` bake branch builds a **fully-centered** box via the two-corner form `p1=(-l/2,-w/2,-h/2)`, `p2=(l/2,w/2,h/2)` so the part-local geometric center is the origin → the pose translation is simply the bar's world center. (Do NOT call the corner-origin `makeBox` without recentering.)
- **B2 — Pull is posed in the CABINET WORLD frame with IDENTITY quaternion, NOT `DOOR_POSE`.** The pull is a separate `ComponentInstance` in the cabinet `.ziasm` world frame; it does not inherit the front's part frame. With identity quaternion the spec §6 bbox mapping is correct: `bboxMm = { l: barLength (→world-X, horizontal/width), w: BAR_DEPTH (→world-Y, standoff/proud), h: BAR_HEIGHT (→world-Z, vertical) }`. Pose translation `= { x: openW/2 (front horizontal center), y: dims.depth + frontThickness/2 + BAR_DEPTH/2 (flush-mounted, proud of the outward face), z: centerZ (front vertical center) }`. (`handlePullPose` derives `centerZ`/`openW`/`dims.depth` from the front + its drawerFrontMath, NOT by reusing DOOR_POSE.) The front's outward direction is **+world-Y** (front center at `y=dims.depth`, outward face at `y=dims.depth+frontThickness/2`).
- **B5 — Width guard (was §12.A).** `handleBoreUV` MUST guard `cc + boreDiameter < front.width`; otherwise the screws exit a narrow front. Surface a toast / skip + warn for fronts too narrow for the chosen `cc`. The dialog should ideally disable a `cc` that no front in the bank can satisfy (MVP: command-level guard + toast is acceptable).
- Face/axes/`throughAll` direction CONFIRMED sound: outward face `'Top'`, u=height, v=width, origin `{-L/2,-W/2,T}` (`bore.ts:90-92`), `throughAll` drills +part-Z → +world-Y into the standoff (correct).

### 13.2 Schema / persistence (lens B)
- **B3 — Extend `HardwareEntry.category`.** `hardware-feature.ts` `category` is the closed union `'hinges' | 'shelfPins'`; add `'drawerHandles'` (its own plan step). A pull SKU cannot be registered without this.
- **Manifest v24→v25 — bump for CONVENTION** (not crash-required; `connectorKind` is an unvalidated TS union, old files load unknown kinds silently). Edits: `CURRENT_FORMAT_VERSION = 25`; add `24: (m) => ({ ...deepClone(m), formatVersion: 25 })` to the `migrations` Record; extend `normalizeKind`'s version list to include 25. Migration round-trip test must also assert a v24 doc carrying a `handleScrew` bore survives without the value being stripped.
- **HardwareFeature minimal literal** (all fields required): `{ kind:'hardware', id, hardwareSkuId, bboxMm:{l,w,h}, attachPoints:[...] }`. `attachPoints` is required — supply at least the 2 screw positions (reused by nothing critical, but must be a valid non-undefined array).
- **Exhaustiveness sites (file:line):** `bore.ts:13` (`BoreConnectorKind` +`'handleScrew'`) & `bore.ts:3-11` (`BoreRole` +`'handleScrew-face'`); `connectorBomCatalog.ts` (catalog entry); `packages/app/src/viewport/SceneManager.ts` `BORE_COLORS` (`satisfies` compile-guard — note: path is **`viewport/`**, one verifier mis-wrote `scene/`); `boreGizmoAxis.ts` (falls through to `null` for unknowns — safe; add explicit `handleScrew` handling only if a `never`-guard exists); `SceneManager.boreColors.spec.ts` `ALL_KINDS` (+`'handleScrew'`); `connectorBomCatalog.spec.ts` `ALL_KINDS` (see 13.3-T1).
- i18n: en/uk bundles + parity test (build-blocking). Add `bom.connector.handleScrew` (en `"Handle screw"`, uk `"Гвинт ручки"` — lead may revise) + `dialog.drawerHandle.*` keys.

### 13.3 False-green test design (lens C) — REQUIRED strengthenings
- **T1:** convert `connectorBomCatalog.spec.ts` `ALL_KINDS` from a plain `BoreConnectorKind[]` annotation to `as const satisfies readonly BoreConnectorKind[]` (so omissions compile-error), and add BOTH `'drawerSlide'` (pre-existing escapee) and `'handleScrew'`.
- **T1b:** migration test asserts a v24 doc WITH a `handleScrew` bore round-trips to v25 unchanged (not just `formatVersion===25`).
- **T2 (kernel):** volume alone is move/center-blind. Assert the baked solid's **centroid ≈ (0,0,0)** (fully-centered per B1) via `BRepBndLib`/centroid, PLUS a size-change sub-test (change one `bbox` dim, re-bake, assert volume differs and equals the new product). Don't hand-author only the volume.
- **T3 (`handleBoreUV`):** assert the 2 bores are **DISTINCT and symmetric** (e.g. cc=128,W=400 → v=136 and v=264), not both at center; cover the width-guard rejection path.
- **T4 (`handlePullPose`):** independent-frame oracle — derive expected translation from first principles (front width/height/outward-normal); do NOT consume `DOOR_POSE` or call `handlePullPose` to build the expected value.
- **T5 (command):** undo verified STRUCTURALLY — after undo, `opfs.read(frontPath)` → assert `bores.filter(b=>b.connectorKind==='handleScrew').length===0` AND the pull components are gone; not a count-only check. Seed a FULL `AssemblyDocument` with real `role:'drawerFront'` components on writable OPFS `.zipt` paths (bare shim crashes `addComponent`).
- **T6 (dialog):** instantiate the REAL component/handler, call `onSubmit({cc})`, assert `bus.execute` called with `instanceof AddDrawerHandlesCommand` (green command-e2e ≠ working panel — slice-3 class).
- **T7 (e2e):** WAIT for `boreMarkerCount() >= 2·N` before probing; assert `__zilventorBoringAggregate()` yields **N distinct fronts** each bearing `handleScrew` bores (recursion reaches EVERY front), total `2·N`; AND verify the pull rendered via a NEW `SceneManager.hardwarePartCount()` probe (**to-build — no hardware-mesh probe exists today**). Hardware-BOM assertion must drive the REAL `aggregateHardwareRecursive` path (wired at `BrowserPane.tsx:242`), not a mock.

### 13.4 Reuse / API fit (lens D)
- **B4 — Pull part path + SKU registration.** `buildHardwareCache.ts:28` seeds only `partPath` starting with `hardware/` AND skips SKUs absent from `BUILTIN_CATALOG`. **Decision:** pull parts written to `hardware/<skuId>.zipt`; register the bar-pull SKU(s) in `BUILTIN_CATALOG` (`builtinCatalog.ts`) with `category:'drawerHandles'`. `aggregateHardwareRecursive` IS wired (`BrowserPane.tsx:242` → `<HardwareTable>`).
- `addComponent` for a hardware-only part CONFIRMED (`AddDrawerBankCommand.ts:180-194`: `registerPart`→`opfs.write`→push `ComponentInstance`). No panel-feature guard blocks it.
- Find fronts: manual filter `cab.components` by `role==='drawerFront'` (`:194`), then `opfs.read(front.partPath)`→`unpackProject`→mutate `bores[]`→write back (slide-bore loop `:259-380` is the template).
- `BorePropertiesPanel` SAFE for `handleScrew` (`:125-126` flags `hasJointDir`/`isHinge` both false → no move section, no crash); marker-click passes kind generically (`SceneManager:782`).
- **connectorId granularity DECIDED: distinct `connectorId` per bore** → BOM shows 2 screws per pull (2N), correct. (Dedup key `${scope}:${kind}:${connectorId}`, `aggregateConnectorBomRecursive.ts:72-83`.)
- Button enable: existing присадка buttons use only `cabinetDisabled = !activeAssembly` (`FurnitureTab.tsx:38`). MVP: reuse that guard; the command no-ops + toasts if the cabinet has no drawer fronts (a derived "has fronts" boolean is optional polish, not required).
- FurnitureTab wiring mirrors `AddDrawerBankCommand` (`FurnitureTab.tsx:165-191`): dialog callback → `bus.execute(new AddDrawerHandlesCommand(...))`.
