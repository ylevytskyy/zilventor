# Присадка Slice 3 — Live-editable connectors + Hardware-BOM rollup

**Status:** Design (brainstorming output, revised after 4-lens adversarial spec-verify + the "keep carcass-move" decision) · **Date:** 2026-06-11 · **Base:** master @ `bf35be8`
**Track:** Tier-1 "Inventor-2012 parity for furniture" · 9th feature · extends присадка slice 1 (`bdfe322`, carcass joints) + slice 2 (`a57b1f7`, doors + hinge cups + система-32 shelf pins).

## 1. Goal

Two complementary halves on top of the existing присадка boring system:

- **A. Hardware-BOM rollup** — tally the connectors implied by `PartDocument.bores[]` (confirmat / minifix / dowel / shelf-pin / hinge) into a per-type hardware bill-of-materials, rolled up across the whole assembly, surfaced in the existing Hardware table and the cut-list CSV. Today bores are only listed per-hole (boring map); nobody can answer "how many hinges / confirmats does this cabinet need".
- **B. Live-editable connectors** — select a placed connector and edit it in place (change Ø/depth, move, delete) instead of today's only path of *clear everything and regenerate*. Editing is done through a **numeric properties panel** (no 3D drag gizmo). Edits persist, survive regeneration, and bake/export correctly.

User decisions (brainstorm 2026-06-11): **full live-edit capability + full BOM**, **select + numeric panel** interaction (not 3D drag), **extend the existing Hardware table + cut-list CSV** (not a separate tab), and — after the audit flagged the carcass-move convention risk — **keep carcass-connector position-move in v1**, solved by storing the joint direction (this spec, §B.5).

## 2. Scope

**In scope**
- Connector BOM: a connector catalog (kind → human name, bilingual), a recursive aggregator with correct cross-document + nesting counting, a table section under the existing Hardware table, and a CSV section in the cut-list export.
- Live-edit, via clicking a bore's 3D marker → numeric panel:
  - **All kinds:** edit `diameter`, `depth`; **delete** (whole connector for fasteners, single hole for shelf pins); undo/redo; OPFS persistence; regeneration that preserves edits and honors deletions.
  - **Hinge & carcass (confirmat/minifix/dowel):** **coupled move** along the connector's principal direction — all member bores move together across both panel documents (hinge = the door/side height axis; carcass = the joint line). Done by a single convention-free world-space primitive (§B.5).
  - **Shelf pin:** per-bore move (`u`,`v`) — single document, no coupling.

**Out of scope / deferred (with reason)**
- 3D drag gizmo / draggable markers (Q2 chose numeric panel).
- Editing **baked** holes directly — v1 edits the unbaked `bores[]` markers; baked geometry must be Unbaked first (`UnbakeBoresCommand`), edited, re-Baked (`BakeBoresCommand`).
- Supplier SKUs / prices / stock in the BOM (catalog is name + count only).
- Changing a connector's *kind* or a door's overlay/hinge-count live — stays a clear+regenerate parametric op.
- Per-bore face reassignment — faces are fixed by `prisadkaFaceConventions`; only (u,v,Ø,depth) are editable.
- **Carcass position-move on legacy bores** generated before this slice (which lack the stored `jointDir`): the move is offered only for connectors that carry `jointDir`; older bores must be regenerated once to enable it (documented; low impact since присадки are routinely regenerated).

## 3. Ground truth (verified against source, 2026-06-11)

- `BoreOp` (`packages/shared/src/bore.ts`): `{ id, face: FaceName, u, v, diameter, depth: number|'throughAll', role: BoreRole, connectorId, connectorKind }`. All fields are *derived at generation*; there is **no override/edited/jointDir field** today.
- **`id` is deterministic** (`confirmat-0-A-0`, `hinge-0-cup`, `hinge-0-plate-1`) but built with `bores.length`/loop index (`connectorCatalog.ts:108`, `hingeMath`/`shelfPinGrid` loop index). A *fresh* generation always yields the same ids; ids are stable **only while the joint's parametrization is unchanged**.
- **`connectorId` couples members of one physical fastener across documents.** Confirmat/minifix/dowel: `boresA` (panel A `.zipt`) and `boresB` (panel B `.zipt`) share `connectorId='<kind>-<i>'`. Hinge: cup (`hinge-0-cup`, door `.zipt`) + plates (`hinge-0-plate-0/1`, side `.zipt`) share `connectorId='hinge-0'`. **The same `connectorId` therefore appears in two different panel documents** — the root of the BOM double-count blocker (§4.2).
- **Shelf-pin `connectorId` is column-level** (`pin-col-front`/`pin-col-back`), shared by every Ø5 hole in a column — *not* a physical fastener. Shelf pins are counted and edited **per hole**, never grouped.
- `face2DFrame(panelDims, role)` (bore.ts:48) returns `{origin, uDir, vDir}` (part-local) per face (Top/Bottom: u=+X; Left/Right/Front/Back: u=+Z) with `uDir × vDir` = outward normal. This is the exact, reliable mapping from (u,v) to part-local 3D — the foundation of the move primitive (§B.5).
- **The carcass generator's (u,v) labeling is not a reliable convention to *move* by.** `makeBores` (connectorCatalog.ts:83-117) sets side-A `u=along-joint` unconditionally and side-B via `bSwapUV = side==='B' && endFaceUsesZforU(endB)`; on non-Top/Bottom faces "u=along-joint" does not match `face2DFrame`'s geometric u. ⇒ a move must **not** trust which of (u,v) is "along-joint"; it must work in world space (§B.5).
- The joint line **is** known cleanly at generation: `JointInput.line = {p0, p1}` (world) drives `enumerateAutoJoints`/`inferManualJoint`. Its unit direction is the natural `jointDir` to persist on carcass bores.
- Hinge: cup u and plate u are **both the part-local height axis**; plates are `cup.u ± PLATE_PAIR_SPACING/2`; door is posed by `DOOR_POSE`=[0.5,0.5,0.5,-0.5] so its u-axis (and the side panel's length axis) is world-vertical → a height move is the cup-panel's world u-direction.
- Persistence pattern (`ClearBoresCommand`): `opfs.read` → `unpackProject` → mutate `manifest.document.bores` → `packProject({manifest:{...,formatVersion:CURRENT_FORMAT_VERSION}})` → `opfs.write` → `boreCacheInvalidator?.([partPath])`; snapshot prior `bores[]` for undo; `exactOptionalPropertyTypes` ⇒ empty list is the **absent** key, not `[]`.
- `AddDoorCommand` already writes plate bores into a **second** document (the side panel) via unpack→mutate→pack→write — the template for cross-document commands; it does **not** guard partial-write failure.
- BOM precedent: `aggregateHardwareRecursive` → `HardwareRow{skuId,name,category,qty,notes}` → `HardwareTable` (i18n `table.hardware.*`) → `# Hardware` section in `buildCutListCsv` (via `csvCell`). Bores are **never** tallied by type today. `aggregateBoresRecursive(activeDoc, cache, partBores, partInfo)` walks the tree incrementing per-part `qty` per component instance — the recursion template.
- Markers (`SceneManager.rebuildBoreMarkers`): one `RingGeometry` per bore, `userData={kind:'boreMarker', boreId, markerKey}`. **No `partPath` in userData**, no `raycastBoreMarker`, no bore-selection state, no edit panel. `markerKey = pathKey(componentPath)`. `MarkerOverlaySpec` (built in `App.tsx`) carries `panelDims` + `worldPose` per panel and is fed `leaf.partPath` — i.e. the panel world pose + dims needed by the move primitive are already assembled where markers are built.
- Current manifest version is **v22** (`CURRENT_FORMAT_VERSION`); v20→v21, v21→v22 migrations are additive no-ops.

## 4. Part A — Hardware-BOM rollup (lower risk, build first)

### A.1 Connector catalog — `packages/shared/src/connectorBomCatalog.ts` (new)
Single source-of-truth mapping each `connectorKind` to a BOM line. Names are **i18n keys** (`bom.connector.<kind>`) with a static English fallback; counts are unitless piece counts.

| connectorKind | Count unit | name key (en fallback) | uk first-draft | notes |
|---|---|---|---|---|
| confirmat | per fastener (scoped distinct `connectorId`) | Confirmat 7×50 | Конфірмат 7×50 | Ø7 face + Ø5 edge |
| minifix | per fastener | Minifix cam fitting | Стяжка Minifix | cam+cross+bolt |
| dowel | per fastener | Dowel Ø8 | Шкант Ø8 | 2 bores |
| shelfPin | **per hole** (`role==='shelfPin-system32'`) | Shelf pin Ø5 | Полицетримач Ø5 | система-32 |
| hinge | per fastener (scoped distinct `connectorId`) | Hinge Ø35 cup | Завіса Ø35 | + 2 plate screws |

### A.2 Aggregator — `aggregateConnectorBomRecursive(activeDoc, cache, partBores, partInfo)` (new walker)
Mirrors `aggregateBoresRecursive`'s recursion (per-instance walk, tracking the component path). **Counting model (fixes the cross-document double-count):**
- Maintain `enclosingScopeKey` = `pathKey` of the nearest enclosing **sub-assembly instance** (the cabinet `.ziasm` instance); root assembly if none.
- **Fasteners (confirmat/minifix/dowel/hinge):** add `(enclosingScopeKey, connectorKind, connectorId)` to a global `Set`. A fastener's two bores live in two panel docs **within the same cabinet instance** ⇒ identical scope key + connectorId ⇒ **counted once**. A cabinet instanced ×N yields N distinct scope keys ⇒ **counted ×N**. Final qty per kind = number of distinct tuples.
- **Shelf pins:** increment a per-kind counter by **1 per bore** of `role==='shelfPin-system32'` at each instance visit (each hole = one pin; column `connectorId` is *not* used for dedup).
Returns `ConnectorBomRow[] = { kind, name, qty, notes }`, sorted by kind. Pure, no I/O. The cross-document dedup and the nesting multiplication are the two named, separately-tested invariants.

### A.3 UI — `ConnectorBomTable` (new) under the Hardware table
Sibling to `HardwareTable` (columns: Type, Name, Qty, Notes), rendered directly below it in the Cut List tab (`BrowserPane`). Connector rows have different columns than SKU hardware, so a sibling table is cleaner than overloading `HardwareTable`. Memoized via a new `useConnectorBomResult` hook (mirrors `useBoringResult`). i18n keys for headers (`table.connector.*`) + names (`bom.connector.*`), en/uk parity-gated.

### A.4 CSV — extend `buildCutListCsv`
Add a `# присадка / Connectors` section (`Type,Name,Qty,Notes`) after the `# Hardware` section, fed `ConnectorBomRow[]` with names already i18n-resolved at call time, escaped via the existing `csvCell`. The existing cut-list export button carries it; no new button.

### A.5 No schema change
Pure aggregation over existing `bores[]`. Part A needs no manifest bump.

## 5. Part B — Live-editable connectors

### B.1 Data model (additive, manifest **v22 → v23**)
- `BoreOp.edited?: boolean` — set when a bore's geometry was manually changed; tells regeneration to preserve it.
- `BoreOp.jointDir?: { x: number; y: number; z: number }` — world-space **unit** direction of the joint line, written by the carcass generators (`generateConfirmat/Minifix/Dowel`) as `normalize(line.p1 − line.p0)` from `JointInput.line`. (Must be normalized — the projection in §B.5 extracts a scalar multiple only for a unit `worldDir`.) Absent on hinge/shelf-pin bores (they don't need it) and on legacy carcass bores (regenerate to populate).
- `PartDocument.suppressedConnectorIds?: string[]` — connectorIds (or shelf-pin bore ids) deleted by the user, so regeneration does not resurrect them.
- All three follow the absent-not-empty/false contract (documented in a type comment). Migration v22→v23 is an additive no-op; a round-trip test asserts the fields are not reified on load.

### B.2 Selection
- Add `partPath` to `MarkerOverlaySpec` (from `leaf.partPath`); set `mesh.userData.partPath` in `rebuildBoreMarkers`.
- `SceneManager.raycastBoreMarker(clientX, clientY): { boreId, partPath } | null` — raycast restricted to `boreMarkers`.
- Store: `selectedBoreId: string | null` (+ owning `partPath`) in `useAppStore`. Selecting highlights the marker; for a fastener, its connector-group siblings (same `connectorId`, possibly in another doc) highlight too.
- **Click routing (App.tsx):** when no pick/drag mode is active, a viewport click hit-tests bore markers **first**; a hit sets `selectedBoreId`, **clears component selection**, opens the panel. A click on empty space clears the bore selection. Bore and component selection are mutually exclusive (no panel collision).

### B.3 Editing UI — `BorePropertiesPanel` (new)
Numeric panel (reuses the `DimensionRenderer`/`BomTable` inline-edit pattern). Behavior by selected kind:
- **Shelf pin:** clicking a hole selects that single bore; fields `u`, `v`, `diameter`, `depth`; **Delete pin**.
- **Hinge:** clicking any bore selects the connector group; a single **height** field (coupled move of cup + both plates), plus `diameter`/`depth` (cup + plate rows), plus **Delete hinge**.
- **Carcass (confirmat/minifix/dowel):** clicking any bore selects the connector group; an **along-joint position** field (coupled move of all members; disabled with a tooltip if `jointDir` is absent on a legacy bore), plus `diameter`/`depth` per role, plus **Delete connector**.
Enter commits; Esc cancels; invalid input keeps the editor open. The displayed "position" is a signed offset from the connector's current location; committing applies the delta via §B.5.

### B.4 Commands (undoable, OPFS-persisting; follow `ClearBoresCommand`)
- `EditBoreCommand` — mutate one bore's `{diameter, depth}` (and `u,v` for shelf pins), set `edited=true`, snapshot prior, persist, invalidate. Single owning document.
- `MoveConnectorCommand` — coupled move of a fastener (hinge or carcass). Gathers each member bore + its owning panel's **current** world pose & dims (resolved at move time from the live assembly/`MarkerOverlaySpec` data, never a stale snapshot — a rotated cabinet must move correctly), computes the move's `worldDir` (hinge = cup-panel world u-direction; carcass = the bores' stored `jointDir`), calls `translateConnectorAlong` (§B.5) with the user's Δ, sets `edited=true` on each moved bore. **Cross-document atomic** (§B.6).
- `DeleteConnectorCommand` — remove all bores of a `connectorId` from **every document that holds one**, append the `connectorId` to **each such doc's** `suppressedConnectorIds`; cross-document atomic. Shelf-pin variant removes one bore id (+ suppresses it).
- All register with the undo bus and call `boreCacheInvalidator` for every affected partPath.

### B.5 Coupling — `packages/shared/src/connectorCoupling.ts` (new, single source of truth) ⚠ load-bearing
One convention-free primitive for **all** coupled moves:

```
translateConnectorAlong(members, worldDir, Δ):
  for each member bore m (with its panel worldPose Pm and dims Dm):
    { uDir, vDir } = face2DFrame(Dm, m.face.role)            // part-local face axes
    worldUDir = rotate(Pm.quat, uDir);  worldVDir = rotate(Pm.quat, vDir)   // → world
    du = Δ * dot(worldDir, worldUDir)
    dv = Δ * dot(worldDir, worldVDir)
    m.u += du;  m.v += dv
```

- Because every member is translated by the **same** world vector `Δ·worldDir`, the fastener's internal geometry (screw axis, plate spacing) is preserved by construction; each member's (u,v) delta is just that world vector projected onto its own face axes — so any face convention (incl. the carcass `bSwapUV` faces) is handled automatically, with **no reliance on which of (u,v) was "along-joint"**.
- `worldDir`: hinge = the cup panel's world u-direction (height, recovered from its pose — robust to a rotated cabinet); carcass = the stored `jointDir`. Both are unit world vectors that lie *within* every member's face plane, so the move keeps holes on their faces.
- Imports `PLATE_PAIR_SPACING` etc. from `hingeMath`; declares no geometry literal of its own (git-grep-gated). Verified **in world space** by the real-OCCT guard (§7), never by a part-local literal.

### B.6 Cross-document atomicity
`MoveConnectorCommand`/`DeleteConnectorCommand` touch two `.zipt` docs. OPFS writes are not transactional, so: (1) snapshot both docs' prior `bores[]`/`suppressedConnectorIds`; (2) mutate both in memory; (3) write doc1 — on failure revert both in-memory and throw; (4) write doc2 — on failure rewrite doc1 back to its snapshot bytes, revert in-memory, throw; (5) **only after both writes succeed**, invalidate both caches (so a mid-command failure never leaves the UI showing a half-applied move). Tested by mocking the 2nd write to throw and asserting doc1 ends at its pre-command bytes (byte-level OPFS) and undo restores both.

### B.7 Regeneration merge policy
The `Generate*BoresCommand`s currently **append** fresh bores (`[...existing, ...fresh]`) — a latent duplicate-id bug. Change to **replace-with-merge**:
1. Compute fresh bores.
2. Drop any fresh bore whose `connectorId`/id is in `suppressedConnectorIds`.
3. For any fresh bore whose `id` matches an existing `edited` bore, keep the **edited** one (deterministic ids make this exact).
4. Otherwise take the fresh bore. Write the merged set (replace, not append).
**Limitation (documented):** edits are preserved across re-Generate only while the joint's parametrization (count/spacing/dims) is unchanged; a dimension change that shifts spacing indices may orphan edits — acceptable for v1. `ClearBoresCommand` still wipes everything including edits and the suppressed list (full reset).

### B.8 Bake / export interaction
Bake reads `(u,v,Ø,depth)` at bake time, so edited/moved bores bake to the new holes with no change to `BakeBoresCommand`'s grouped `atFace` path; deleted bores are simply absent. v1 edits **unbaked** markers; baked holes are edited via Unbake → edit → Bake. DXF/CSV boring-map and the connector BOM read live `bores[]`, so edits flow through automatically.

## 6. Data flow

```
Generate*/AddDoor ─► PartDocument.bores[] (carcass bores carry jointDir) ─► rebuildBoreMarkers ─► markers (userData.boreId, partPath)
                              ▲                                                                          │ click (bore-first)
 Edit/MoveConnector/Delete ───┘◄── BorePropertiesPanel ◄── selectedBoreId ◄── raycastBoreMarker
 (translateConnectorAlong in world space; cross-doc snapshot→apply→persist→invalidate)
   bores[] ─► aggregateConnectorBomRecursive (scoped-connectorId dedup) ─► ConnectorBomRow[] ─► ConnectorBomTable + cut-list CSV
   bores[] ─► BakeBoresCommand (atFace) ─► real OCCT holes ─► 3D + .zidw drawings
```

## 7. Testing strategy (false-green-proof — the recurring присадка trap)

- **BOM counting (critical fix), non-tautological fixture:** an assembly whose connector counts derive from its joints (not hard-coded). Assert (a) a confirmat across two panels counts **once**; (b) a hinge (cup+2 plates across door+side) counts **once**; (c) a cabinet instanced ×N multiplies counts ×N; (d) a 2-column ×K-hole panel = **2K pins**. Flip-to-RED: remove the scope-dedup → (a)/(b) go to 2×.
- **Coupled move (real-OCCT, world-space) — the load-bearing guard:** for **both** a hinge and a confirmat (carcass), generate the real connector, `MoveConnector` by a known Δ, **bake**, and assert in **world** coordinates: every member hole shifted by exactly `Δ·worldDir`, the holes stayed on their faces, and the inter-bore geometry (screw axis collinearity / cup-plate co-height & spacing) is unchanged. Derive expected from geometry; **flip-to-RED** by negating one member's projection or zeroing `jointDir`. This guard exercises the exact `bSwapUV`/narrow-face case (e.g. a confirmat with `endB='Left'`).
- **jointDir provenance:** assert generated carcass bores carry a unit `jointDir` equal (within ε) to the normalized `JointInput.line` direction; hinge/shelf-pin bores have none.
- **Cross-document atomicity:** mock the 2nd OPFS write to throw; assert doc1 is restored to pre-command bytes and undo restores both.
- **Regeneration merge:** edit a bore's depth + delete a connector, re-run Generate (unchanged dims); assert the edited depth survived (by id) and the suppressed connector did not reappear, on real generated output.
- **§6 browser gate:** headless viewport is **black** — verify via probes (`raycastBoreMarker` hit, `selectedBoreId`, panel DOM values, `boreMarkerCount`) + byte-OPFS. e2e: select→edit depth→move→delete→assert markers/bytes→bake→holes→BOM count.
- tsc 0-new; app/shared/kernel suites green from their own dirs (`--config vitest(.integration).config.ts`).

## 8. Risks & mitigations

1. **BOM cross-document double-count (was a real spec bug, now fixed):** scoped-`connectorId` dedup (§4.2) + explicit count test. Highest-value correctness fix.
2. **Coupled-move convention false-green (the historic trap):** dissolved by working in **world space** — `translateConnectorAlong` projects one world translation onto each face's real axes, never trusting the generator's (u,v) labels; `jointDir` is captured cleanly at generation from `JointInput.line`. Verified by the world-space real-OCCT flip-to-RED guard exercising the narrow-face `bSwapUV` case.
3. **Cross-document atomicity:** snapshot-both/apply-both/revert-both (§B.6) + partial-write test.
4. **Legacy bores lack `jointDir`:** carcass move is offered only when `jointDir` is present; legacy connectors show a "regenerate to enable move" tooltip. Documented; low impact.
5. **Regeneration footgun** (Generate appends/duplicates today): fixed by replace-with-merge + suppressed list; edits stable only under unchanged parametrization (documented).
6. **Shelf-pin column connectorId** misread as a fastener: per-hole everywhere; count test asserts 2K, not 2.
7. **Marker hit-testing small Ø5 rings:** raycast the full ring disc + generous threshold; selecting highlights the whole connector.

## 9. Manifest
`v22 → v23`, additive no-op migration (`BoreOp.edited?`, `BoreOp.jointDir?`, `PartDocument.suppressedConnectorIds?`). Part A needs no schema change.

## 10. Deliverables checklist
- shared: `connectorBomCatalog.ts`, `connectorCoupling.ts` (`translateConnectorAlong`), `edited?`/`jointDir?`/`suppressedConnectorIds?` types + v23 migration + round-trip test, carcass generators populate `jointDir`.
- app: `aggregateConnectorBomRecursive`, `useConnectorBomResult`, `ConnectorBomTable`, `BorePropertiesPanel`, `partPath` on markers + `raycastBoreMarker` + selection state + bore-first click routing, `EditBoreCommand`/`MoveConnectorCommand`/`DeleteConnectorCommand` (resolving member panel poses+dims), replace-with-merge in the Generate commands, `buildCutListCsv` connectors section, en/uk strings.
- kernel: no new API (bake unchanged); real-OCCT integration guards for hinge **and** carcass coupled moves.
- tests: unit (catalog/aggregator dedup/coupling projection), real-OCCT (hinge + confirmat world-space move, jointDir provenance, regeneration merge), 1 e2e (select→edit→move→delete→bake→BOM), tsc 0-new.

## 11. Open questions for review
- BOM connector names/units are first-draft furniture terms; the lead may prefer different Ukrainian terms (e.g. «Конфірмат» vs «Єврогвинт») — flagged for the deferred uk.json term review, not a blocker.
- The unified world-space coupling (§B.5) replaces the earlier per-kind axis rules; a focused real-OCCT coupling re-verify round is run before writing the plan (per the audit follow-up agreed for keeping carcass-move).
- If the plan comes out very large, Part A (BOM) can land first and Part B (edit/move/delete) immediately after — same slice, two commits — but both are intended for v1.
