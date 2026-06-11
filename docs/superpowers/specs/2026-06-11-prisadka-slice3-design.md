# Присадка Slice 3 — Live-editable connectors + Hardware-BOM rollup

**Status:** Design (brainstorming output, revised after 4-lens adversarial spec-verify) · **Date:** 2026-06-11 · **Base:** master @ `bf35be8`
**Track:** Tier-1 "Inventor-2012 parity for furniture" · 9th feature · extends присадка slice 1 (`bdfe322`, carcass joints) + slice 2 (`a57b1f7`, doors + hinge cups + система-32 shelf pins).

## 1. Goal

Two complementary halves on top of the existing присадка boring system:

- **A. Hardware-BOM rollup** — tally the connectors implied by `PartDocument.bores[]` (confirmat / minifix / dowel / shelf-pin / hinge) into a per-type hardware bill-of-materials, rolled up across the whole assembly, surfaced in the existing Hardware table and the cut-list CSV. Today bores are only listed per-hole (boring map); nobody can answer "how many hinges / confirmats does this cabinet need".
- **B. Live-editable connectors** — select a placed connector and edit it in place (change Ø/depth, move, delete) instead of today's only path of *clear everything and regenerate*. Editing is done through a **numeric properties panel** (no 3D drag gizmo). Edits persist, survive regeneration, and bake/export correctly.

User decisions (brainstorm 2026-06-11): **full live-edit capability + full BOM**, **select + numeric panel** interaction (not 3D drag), **extend the existing Hardware table + cut-list CSV** (not a separate tab).

## 2. Scope

**In scope**
- Connector BOM: a connector catalog (kind → human name, bilingual), a recursive aggregator with correct cross-document + nesting counting, a table section under the existing Hardware table, and a CSV section in the cut-list export.
- Live-edit, via clicking a bore's 3D marker → numeric panel:
  - **All kinds:** edit `diameter`, `depth`; **delete** (whole connector for fasteners, single hole for shelf pins); undo/redo; OPFS persistence; regeneration that preserves edits and honors deletions.
  - **Hinge:** **coupled move** along door/side height (cup + both plates move together).
  - **Shelf pin:** per-bore move (`u`,`v`) — single document, no coupling.

**Out of scope / deferred (with reason)**
- ⚠ **Carcass-connector position-move (confirmat/minifix/dowel).** The existing carcass generator labels the along-joint coordinate as `u` even on narrow `Right`/`Left`/`Front`/`Back` faces (slice-1 `faceA='Right'` worked only via an L↔T dim-swap and a `throughAll`, convention-tolerant bore — see slice-1 memory). The along-joint↔(u,v) mapping is therefore **not consistently recoverable from a single `BoreOp`**, so a coupled move would be the classic присадка false-green. v1 supports **delete + Ø/depth** for carcass connectors; position-move is deferred until the joint direction is stored or derived geometrically (see §11). **This is a narrowing of "full live-edit" forced by the audit — flagged for the lead's approval at spec review.**
- 3D drag gizmo / draggable markers (Q2 chose numeric panel).
- Editing **baked** holes directly — v1 edits the unbaked `bores[]` markers; baked geometry must be Unbaked first (`UnbakeBoresCommand`), edited, re-Baked (`BakeBoresCommand`).
- Supplier SKUs / prices / stock in the BOM (catalog is name + count only).
- Changing a connector's *kind* or a door's overlay/hinge-count live — stays a clear+regenerate parametric op.
- Per-bore face reassignment — faces are fixed by `prisadkaFaceConventions`; only (u,v,Ø,depth) are editable.

## 3. Ground truth (verified against source, 2026-06-11)

- `BoreOp` (`packages/shared/src/bore.ts`): `{ id, face: FaceName, u, v, diameter, depth: number|'throughAll', role: BoreRole, connectorId, connectorKind }`. All fields are *derived at generation*; there is **no override/edited field**.
- **`id` is deterministic** (`confirmat-0-A-0`, `hinge-0-cup`, `hinge-0-plate-1`) but is built with `bores.length`/loop index (`connectorCatalog.ts:108`, `hingeMath`/`shelfPinGrid` loop index). A *fresh* generation always yields the same ids; ids are stable **only while the joint's parametrization is unchanged**.
- **`connectorId` couples members of one physical fastener across documents.** Confirmat/minifix/dowel: `boresA` (panel A `.zipt`) and `boresB` (panel B `.zipt`) share `connectorId='<kind>-<i>'`. Hinge: cup (`hinge-0-cup`, door `.zipt`) + plates (`hinge-0-plate-0/1`, side `.zipt`) share `connectorId='hinge-0'`. **The same `connectorId` therefore appears in two different panel documents** — the root of the BOM double-count blocker (§4.2).
- **Shelf-pin `connectorId` is column-level**, shared by every Ø5 hole in a column (`pin-col-front`/`pin-col-back`) — *not* a physical fastener. Shelf pins are counted and edited **per bore/hole**, never grouped.
- `face2DFrame(panelDims, role)` (bore.ts:48) defines the panel-local (u,v) frame per face (Top/Bottom: u=+X; Left/Right/Front/Back: u=+Z). `endFaceUsesZforU(role)` (connectorCatalog.ts:73, **currently un-exported**) encodes whether u is the thickness axis.
- The carcass generator (`makeBores`, connectorCatalog.ts:83-117) sets side-A `u=along-joint` unconditionally and side-B via `bSwapUV = side==='B' && endFaceUsesZforU(endB)` — so "u=along-joint" on side A does **not** correspond to face2DFrame's geometric u on non-Top/Bottom faces. (Root of the §2 carcass-move deferral.)
- Hinge: cup u and plate u are **both the part-local height axis** (`hingeMath.ts`: "plate Z == cup Z by construction"); plates are `cup.u ± PLATE_PAIR_SPACING/2`. Door is posed by `DOOR_POSE`=[0.5,0.5,0.5,-0.5] so its length/u axis is world-vertical, as is the side panel's (length=H) — so a `Δu` applied to cup and plate alike preserves world-Z alignment.
- Persistence pattern (`ClearBoresCommand`): `opfs.read` → `unpackProject` → mutate `manifest.document.bores` → `packProject({manifest:{...,formatVersion:CURRENT_FORMAT_VERSION}})` → `opfs.write` → `useAppStore.getState().boreCacheInvalidator?.([partPath])`; snapshot prior `bores[]` for undo; `exactOptionalPropertyTypes` ⇒ empty list is the **absent** key, not `[]`.
- `AddDoorCommand` already writes plate bores into a **second** document (the side panel) via unpack→mutate→pack→write — the template for cross-document commands; it currently does **not** guard partial-write failure.
- BOM precedent: `aggregateHardwareRecursive` → `HardwareRow{skuId,name,category,qty,notes}` → `HardwareTable` (i18n `table.hardware.*`) → `# Hardware` section in `buildCutListCsv` (via `csvCell`). Bores are **never** tallied by type today. `aggregateBoresRecursive(activeDoc, cache, partBores, partInfo)` walks the tree incrementing per-part `qty` per component instance — the recursion template.
- Markers (`SceneManager.rebuildBoreMarkers`): one `RingGeometry` per bore, `userData={kind:'boreMarker', boreId, markerKey}`. **No `partPath` in userData**, no `raycastBoreMarker`, no bore-selection state, no edit panel. `markerKey = pathKey(componentPath)`, not the OPFS partPath. Inline-edit precedents: `DimensionRenderer`, `PropertiesPanel`, `BomTable`. `MarkerOverlaySpec` is built in `App.tsx` from leaves that already carry `leaf.partPath`.
- Current manifest version is **v22** (`CURRENT_FORMAT_VERSION`); v20→v21 and v21→v22 migrations are additive no-ops.

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
- `BoreOp.edited?: boolean` — set when a bore's geometry was manually changed; tells regeneration to preserve it. (Absent, never `false`, per the exactOptionalPropertyTypes contract — documented in a type comment.)
- `PartDocument.suppressedConnectorIds?: string[]` — connectorIds (or shelf-pin bore ids) deleted by the user, so regeneration does not resurrect them. (Absent, never `[]`.)
- Migration v22→v23 is an additive no-op (like v20→v21); old docs load unchanged; absent keys mean "nothing edited / nothing suppressed". A round-trip test asserts the fields are not reified.

### B.2 Selection
- Add `partPath` to `MarkerOverlaySpec` (built in `App.tsx` from `leaf.partPath`); set `mesh.userData.partPath` in `rebuildBoreMarkers`.
- `SceneManager.raycastBoreMarker(clientX, clientY): { boreId, partPath } | null` — raycast restricted to `boreMarkers`.
- Store: `selectedBoreId: string | null` (+ owning `partPath`) in `useAppStore`. Selecting highlights the marker; for a fastener, its connector-group siblings highlight too (look up by `connectorId`).
- **Click routing (App.tsx):** when no pick/drag mode is active, a viewport click hit-tests bore markers **first**; a hit sets `selectedBoreId`, **clears component selection**, and opens the panel. A click on empty space clears the bore selection. Bore selection and component selection are mutually exclusive (no panel collision).

### B.3 Editing UI — `BorePropertiesPanel` (new)
Numeric panel (reuses the `DimensionRenderer`/`BomTable` inline-edit pattern). Behavior by selected kind:
- **Shelf pin:** clicking a hole selects that single bore; fields `u`, `v`, `diameter`, `depth`; **Delete pin**.
- **Hinge:** clicking any of its bores selects the connector group; a single **height** field (primary-axis move of cup + both plates), plus `diameter`/`depth` (cup and plate rows), plus **Delete hinge**. (u/v are not directly editable — height is the coherent control.)
- **Carcass (confirmat/minifix/dowel):** clicking any bore selects the connector group; `diameter`/`depth` per role, **Delete connector**. **No position field in v1** (see §2 deferral).
Enter commits; Esc cancels; invalid input keeps the editor open.

### B.4 Commands (undoable, OPFS-persisting; follow `ClearBoresCommand`)
- `EditBoreCommand` — mutate one bore's `{diameter, depth}` (and `u,v` for shelf pins), set `edited=true`, snapshot prior, persist, invalidate. Single owning document.
- `MoveHingeCommand` — set the hinge's cup `u=h` and each plate `u=h±PLATE_PAIR_SPACING/2` (offset-preserving), set `edited=true`. **Cross-document** (door + side): snapshot **both** docs, apply both in memory, write both, **revert both on any failure** (§B.6); invalidate both partPaths.
- `DeleteConnectorCommand` — remove all bores of a `connectorId` from **every document that holds one**, and append the `connectorId` to **each such doc's** `suppressedConnectorIds`; cross-document atomic like `MoveHingeCommand`. Shelf-pin variant removes a single bore id (+ suppresses that id).
- All register with the existing undo bus and call `boreCacheInvalidator` for every affected partPath.

### B.5 Coupling — `packages/shared/src/connectorCoupling.ts` (new) ⚠ load-bearing
v1 contains **only the hinge rule** (carcass-move deferred):
- `moveHinge(cupBores, plateBores, newHeight)` → returns updated bores with `cup.u=newHeight`, `plate.u=newHeight ± PLATE_PAIR_SPACING/2`, `v`/Ø/depth unchanged. Pure; imports `PLATE_PAIR_SPACING` from `hingeMath` (no re-declaration, git-grep-gated).
- The rule is **verified in world space, not by the part-local literal**: the real-OCCT guard (§7) bakes the moved hinge and asserts the cup hole and both plate holes are co-height in **world** coordinates (derive expected from geometry, flip-to-RED).
- (Deferred carcass rule, documented for the follow-up: `alongJointAxis(bore) = endFaceUsesZforU(bore.face.role) ? 'v' : 'u'` applied uniformly per bore — requires `endFaceUsesZforU` to be exported and the joint direction to be recoverable; not in v1.)

### B.6 Cross-document atomicity
`MoveHingeCommand`/`DeleteConnectorCommand` touch two `.zipt` docs. OPFS writes are not transactional, so: (1) snapshot both docs' prior `bores[]`/`suppressedConnectorIds` in memory; (2) mutate both in memory; (3) write doc1 — on failure, revert both in-memory and throw (no doc changed yet on disk except doc1 which is rewritten to its snapshot); (4) write doc2 — on failure, rewrite doc1 back to its snapshot, revert in-memory, throw; (5) invalidate both caches. Tested by mocking the 2nd write to throw and asserting doc1 ends at its pre-command bytes (byte-level OPFS).

### B.7 Regeneration merge policy
The `Generate*BoresCommand`s currently **append** fresh bores (`[...existing, ...fresh]`) — a latent duplicate-id bug. Change them to **replace-with-merge**:
1. Compute fresh bores.
2. Drop any fresh bore whose `connectorId`/id is in `suppressedConnectorIds`.
3. For any fresh bore whose `id` matches an existing `edited` bore, keep the **edited** one (deterministic ids make this exact).
4. Otherwise take the fresh bore. Write the merged set (replace, not append).
**Limitation (documented):** edits are preserved across re-Generate only while the joint's parametrization (count/spacing/dims) is unchanged; a dimension change that shifts spacing indices may orphan edits — acceptable for v1. `ClearBoresCommand` still wipes everything including edits and the suppressed list (full reset).

### B.8 Bake / export interaction
Bake reads `(u,v,Ø,depth)` at bake time, so edited/moved bores bake to the new holes with no change to `BakeBoresCommand`'s grouped `atFace` path; deleted bores are simply absent. v1 edits **unbaked** markers; baked holes are edited via Unbake → edit → Bake. DXF/CSV boring-map and the connector BOM read live `bores[]`, so edits flow through automatically.

## 6. Data flow

```
Generate*/AddDoor ─► PartDocument.bores[] ─► rebuildBoreMarkers ─► RingGeometry markers (userData.boreId, partPath)
                              ▲                                                   │ click (bore-first)
 Edit/MoveHinge/Delete ───────┘◄── BorePropertiesPanel ◄── selectedBoreId ◄── raycastBoreMarker
 (snapshot→apply→persist→invalidate; cross-doc for hinge/delete)
   bores[] ─► aggregateConnectorBomRecursive (scoped-connectorId dedup) ─► ConnectorBomRow[] ─► ConnectorBomTable + cut-list CSV
   bores[] ─► BakeBoresCommand (atFace) ─► real OCCT holes ─► 3D + .zidw drawings
```

## 7. Testing strategy (false-green-proof — the recurring присадка trap)

- **BOM counting (the critical fix), non-tautological fixture:** an assembly whose connector counts derive from its joints (not hard-coded). Assert: (a) a confirmat spanning two panels counts **once**, not twice; (b) a hinge (cup+2 plates across door+side) counts **once**; (c) a cabinet instanced ×N multiplies counts ×N; (d) a 2-column ×K-hole shelf-pin panel counts **2K pins**. Flip-to-RED: remove the scope-dedup and confirm (a)/(b) go to 2×.
- **Hinge move (real-OCCT, world-space):** generate a real hinge, `MoveHinge` by Δ, bake, assert cup hole centroid and both plate hole centroids are co-height in **world** coordinates and Δ matches. Derive expected from geometry; flip the plate sign / drop the move to confirm RED.
- **Cross-document atomicity:** mock the 2nd OPFS write to throw; assert the 1st doc is restored to its pre-command bytes and undo restores both docs.
- **Regeneration merge:** edit a bore's depth + delete a connector, re-run Generate (unchanged dims); assert the edited depth survived (by id) and the suppressed connector did not reappear, on real generated output (no stub).
- **§6 browser gate:** headless viewport renders **black** — verify via probes (`raycastBoreMarker` hit on a known marker, `selectedBoreId` set, panel DOM values, `boreMarkerCount`) + byte-OPFS, not screenshots. e2e: select→edit depth→delete→assert markers/bytes→bake→holes→BOM count.
- tsc 0-new; app/shared/kernel suites green from their own dirs (`--config vitest(.integration).config.ts`).

## 8. Risks & mitigations

1. **BOM cross-document double-count (was a real spec bug, now fixed):** scoped-`connectorId` dedup (§4.2) + the explicit count test (§7). Highest-value correctness fix.
2. **Carcass-move convention false-green:** avoided by deferring carcass position-move (§2); v1 carcass edit = delete + Ø/depth only.
3. **Hinge coupling:** clean u→u (both axes world-vertical) but verified in **world space** by a real-OCCT flip-to-RED guard, never a part-local literal.
4. **Cross-document atomicity:** snapshot-both/apply-both/revert-both (§B.6) + the partial-write test.
5. **Regeneration footgun** (Generate appends/duplicates today): fixed by replace-with-merge + suppressed list; edits stable only under unchanged parametrization (documented).
6. **Shelf-pin column connectorId** misread as a fastener: shelf pins are per-hole everywhere (catalog, aggregator, edit, delete); count test asserts 2K, not 2.
7. **Marker hit-testing small Ø5 rings:** raycast the full ring disc + generous threshold; selecting highlights the whole connector for feedback.
8. **Prerequisite export:** `endFaceUsesZforU` export only needed if/when carcass-move lands; not required for v1.

## 9. Manifest
`v22 → v23`, additive no-op migration (`BoreOp.edited?`, `PartDocument.suppressedConnectorIds?`). Part A needs no schema change.

## 10. Deliverables checklist
- shared: `connectorBomCatalog.ts`, `connectorCoupling.ts` (hinge only), `edited?`/`suppressedConnectorIds?` types + v23 migration + round-trip test, export `endFaceUsesZforU` (deferred-carcass prerequisite, optional).
- app: `aggregateConnectorBomRecursive`, `useConnectorBomResult`, `ConnectorBomTable`, `BorePropertiesPanel`, `partPath` on markers + `raycastBoreMarker` + selection state + bore-first click routing, `EditBoreCommand`/`MoveHingeCommand`/`DeleteConnectorCommand`, replace-with-merge in the Generate commands, `buildCutListCsv` connectors section, en/uk strings.
- kernel: no new API (bake unchanged); real-OCCT integration guards for the hinge move.
- tests: unit (catalog/aggregator dedup/coupling), real-OCCT (hinge-move world-coplanarity, regeneration merge), 1 e2e (select→edit→delete→bake→BOM), tsc 0-new.

## 11. Open questions for review
- ⚠ **Carcass-connector position-move deferral (§2):** the audit found the existing along-joint↔(u,v) convention is not safely recoverable from a single `BoreOp`. v1 ships carcass **delete + Ø/depth** but **not** carcass position-move. Approve this narrowing of "full", or ask to solve the convention now (store joint direction / derive geometrically — adds scope + a higher false-green risk).
- BOM connector names/units are first-draft furniture terms; the lead may prefer different Ukrainian terms (e.g. «Конфірмат» vs «Єврогвинт») — flagged for the deferred uk.json term review, not a blocker.
- If the plan comes out too large, Part A (BOM) + B-core (edit/delete) can land as v1.0 and hinge-move as a fast follow — noted but not the default.
