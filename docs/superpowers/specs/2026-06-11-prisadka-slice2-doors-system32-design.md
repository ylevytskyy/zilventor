# Присадка slice 2 — Door modeling + hinge boring + система-32 shelf-pin boring

**Date:** 2026-06-11
**Status:** Approved (brainstorming → spec)
**Track:** Tier-1 "Inventor 2012 parity for furniture" (8th follow-up feature; sub-project-scale)
**Base:** master `4373e38` · manifest v21 → **v22** (additive)
**Predecessor:** Присадка slice 1 (`bdfe322`, carcass-joint boring) — this slice extends its data model, bake, export, and marker infrastructure.

---

## 1. Motivation

Slice 1 delivered **carcass-joint присадка** (confirmat / minifix / dowel along carcass
joints). The design team also needs the two **per-panel** boring patterns that every cabinet
with doors and adjustable shelves requires:

1. **Система-32 shelf-pin boring** — the Ø5 mm vertical line-boring grid at 32 mm pitch on
   the **inner faces of side panels**, into which shelf pins (and any system-32 hardware)
   seat. Universal: every cabinet with adjustable shelves needs it.
2. **Hinge присадка** — the Ø35 mm **cup** bored into a **door**, plus the hinge **mounting-plate
   holes** drilled into the cabinet side panel.

The first has a clean home today (side panels exist). The second does **not**: cabinets do
not currently model a door (no `'door'` panel role — verified, §3). So this slice also adds a
minimal **door model** ("Add Door" action) so the cup has a panel to live on.

All output flows through slice 1's existing fast path (3D markers + DXF/CSV boring-map) and
bake path (real OCCT holes → 3D + `.zidw`), reused unchanged.

## 2. Decisions (locked in brainstorming)

| Axis | Decision |
|---|---|
| Hinge-cup scope | **Model a door panel now** so the Ø35 cup has a target (chosen over deferring the cup or manual-only) |
| Shelf-pin targeting | **Auto (both side panels) + manual single-panel pick** |
| Configurability | **Dialog with standard defaults** (pitch, Ø, depth, setbacks, margins editable) |
| Door creation | **"Add Door" action** — select a cabinet → door created + auto-bored (not a CreateCabinet flag) |
| Door configurations | **Single + double doors** (single hinged L/R; double = mirrored pair with center reveal) |
| Overlay types | **Full + half + inset** (maps to catalog `hinge-35mm-cup-full/half/inset`) |

## 3. Verified premises (code-checked before this spec)

1. **Doors are NOT modeled today — CONFIRMED.** `buildBaseCabinet` (`shared/src/cabinets/
   baseCabinet.ts:15-97`) creates only `leftSide/rightSide/bottom/top/back/toekick/shelf`.
   `PanelRole` (`shared/src/types.ts:4-11`) has no `'door'`. ⟹ the door is **new**: a `role:'door'`
   component added into the cabinet's `.ziasm` sub-assembly by `AddDoorCommand`.
2. **Hardware catalog already has the entries — CONFIRMED.** `shared/src/hardware/
   builtinCatalog.ts:12-94`: `hinge-35mm-cup-full/half/inset` (category `'hinges'`) and
   `shelf-pin-5mm-steel/clear`, `shelf-pin-7mm-sleeve` (category `'shelfPins'`). The boring
   geometry references these for Ø + nominal depth.
3. **Side-panel inner faces are a ready target — CONFIRMED, but the face is `Top`/`Bottom`,
   NOT `Right`/`Left` (corrected after adversarial verification).** Side panels are stored in
   their NATIVE part frame `{length:H, width:D, thickness:Tc}`; `buildPanelBox` lays this out
   `L→local X`, `W→local Y`, `T→local Z` (`PanelOps.ts:56-99`), so the box is
   `[-H/2,-D/2,0]..[H/2,D/2,Tc]` with **height along X**, depth along Y, thickness along Z.
   Therefore `face2DFrame` (`bore.ts:45-65`) makes `Right`/`Left` the **narrow `D×Tc` END
   faces** (`uDir=+Z` spans only `0..Tc≈16-18mm`) — the WRONG target. The **broad inner face
   is `Top` (z=Tc) or `Bottom` (z=0)** (`uDir=+X` spans `0..H` = height, `vDir=∓Y` spans `0..D`
   = depth). A vertical pin column = fixed `v` (depth), holes stepped in `u` (height).
   - **Why this is load-bearing:** the bake (`HoleFeature.ts` `resolveAtFaceLocations` →
     `panelDimsFromBody`, the UNSWAPPED part bbox) and the 3D markers (`SceneManager.ts:678,693`
     via `panelSpecCacheRef`) both re-derive `(u,v)` against the part's **native** dims. Slice-1
     carcass face bores used `faceA='Right'` ONLY because `GenerateCarcassBoresCommand` applies
     an internal **L↔T swap** for world-AABB joint math (`{length:Tc,width:D,thickness:H}`) AND
     because that bore is `throughAll` (convention-tolerant — pierces regardless of face). The
     swap never touches the stored part geometry the `BoreOp.(u,v)` is interpreted against.
     Slice-2 bores are **blind**, so the wrong face mis-places every hole — the slice-1 u/v-swap
     false-green class. **All slice-2 side/door bores are authored in the UNSWAPPED part-local
     frame on the broad `Top`/`Bottom` face.**
   - **OPEN at contract-lock (pin with a real-OCCT guard before geometry impl):** which SIGN
     (`Top` z=Tc vs `Bottom` z=0) faces the cabinet interior depends on the side panel's WORLD
     render pose (`baseCabinet.ts:137` stores side panels with identity rotation, so they sit in
     a non-physical part orientation — height along world-X). Phase 0 resolves Top-vs-Bottom and
     the door pose by baking the REAL generated bores into the REAL cabinet part and asserting
     the void lands on the interior-facing broad face. See §16.
4. **Bore model + bake + export + markers reuse — CONFIRMED (slice 1).** `BoreOp`
   (`shared/src/bore.ts:16-26`), `PartDocument.bores[]` (`types.ts:89`), `BakeBoresCommand`
   + kernel `atFace` `resolveAtFaceLocations` (`kernel/src/adapter/features/HoleFeature.ts:288-343`),
   `aggregateBoresRecursive` (`app/src/assembly/walkers/aggregateBoresRecursive.ts:17-55`),
   `buildBoringCsv`, `renderBoringDxf`, `SceneManager.setBoreMarkers/rebuildBoreMarkers`
   (`SceneManager.ts:627-705`). All accept new bore roles transparently.
5. **Only a two-component picker exists — PARTIAL.** `createTwoComponentPicker`
   (`app/src/viewport/createTwoComponentPicker.ts:12-36`) + a generic-but-unwired
   `ComponentPickController` (`app/src/model/ComponentPickController.ts:10-20`). Manual
   single-panel shelf-pin boring needs a **new single-component picker** (`beginOneComponentPick`).
6. **No grid-pitch helper — PARTIAL.** `spacingDistances` (`connectorCatalog.ts:42-51`)
   computes even spacing for joint boring but not fixed-pitch columns. A new
   `columnPositions(start, end, pitch)` is required.
7. **CreateCabinet roles persist — CONFIRMED (slice 1).** `ComponentInstance.role` is now
   populated by `CreateCabinetCommand`, so the auto shelf-pin path can find side panels by role.

## 4. Architecture overview

```
   Add Door  ─────────────►  AddDoorCommand
   (pick cabinet)            │ doorMath: opening + overlay → door dims + pose (single|double)
                             │ create door part(s) role:'door' into cabinet .ziasm
                             │ hingeMath: door height → hinge Z positions + count
                             │   ├─ cup BoreOp[] (Ø35) on door back face
                             │   └─ plate BoreOp[] (Ø5) on side-panel inner face
                             ▼ writes bores to door part(s) + side part(s)
   Система-32 (auto)  ──►  GenerateShelfPinBoresCommand
   (pick cabinet)           │ recurse .ziasm → each leftSide/rightSide
                            │ shelfPinGrid: inner face + columns → BoreOp[] (Ø5 @ 32mm)
   Система-32 (manual) ─►  AddManualShelfPinBoresCommand (one picked panel + face + params)
                             ▼
              PartDocument.bores: BoreOp[]   (intrinsic to each panel/door part)
                             │
        ┌────────────────────┼──────────────────────────┬─────────────────────┐
        ▼ fast path           ▼ fast path                 ▼ on demand           ▼ on demand
   3D markers          DXF + CSV boring-map          BakeBoresCommand       (un-bake)
  (reused, new color)  (reused walker/writers)    → HoleFeatures → real   removes holes
                                                      holes → 3D + .zidw
```

All of the bottom row is **slice-1 infrastructure reused unchanged**. The new code is:
`doorMath`, `hingeMath`, `shelfPinGrid` (pure, shared), `AddDoorCommand`,
`GenerateShelfPinBoresCommand`, `AddManualShelfPinBoresCommand`, a one-component picker, and
two dialogs.

## 5. Data model (`packages/shared`)

```ts
// additive enum variants — packages/shared/src/bore.ts
type BoreRole =                         // ...existing slice-1 roles, plus:
  | 'shelfPin-system32'                 // Ø5 grid hole on a side INNER (Top/Bottom) face
  | 'hingeCup'                          // Ø35 cup on a door INNER (Top/Bottom) face
  | 'hingePlate';                       // Ø5 plate-mount hole on a side INNER face

type BoreConnectorKind =                // existing 'confirmat'|'minifix'|'dowel', plus:
  | 'shelfPin' | 'hinge';              // drives marker color + CSV/DXF "Type"

// additive on PanelRole — packages/shared/src/cabinets/types.ts:4-11
type PanelRole =                        // ...existing, plus:
  | 'door';

// additive optional on ComponentInstance — packages/shared/src/types.ts:96-107
interface DoorSpec {
  overlay: 'full' | 'half' | 'inset';
  hingeSide: 'left' | 'right';          // which vertical edge carries the cups
  pair: 'single' | 'pairLeft' | 'pairRight';  // double-door membership
  hingeCount: number;                   // resolved at creation (auto from height; see §7)
}
doorSpec?: DoorSpec;
```

`BoreOp` itself is unchanged (`face`, `u`, `v`, `diameter`, `depth`, `role`, `connectorId`,
`connectorKind`). Cups/pins/plates are ordinary bores; only the new role/kind strings differ.
`connectorId` groups, e.g., the cup+plate of one hinge (`hinge-0`) and a pin column
(`pin-col-front`) for export grouping and undo.

**Lockstep type-widening (else `tsc`/markers break).** `SceneManager.BORE_COLORS` is typed
`Record<'confirmat'|'minifix'|'dowel', string>` and indexed by `bore.connectorKind`
(`SceneManager.ts:112-116,693`). It MUST widen to `Record<BoreConnectorKind, string>` with
`shelfPin`/`hinge` colors in the SAME change that grows `BoreConnectorKind`, covered by a test
asserting every `connectorKind` has a color. Likewise any exhaustive `switch`/label map on
`BoreRole`/`connectorKind` (CSV/DXF "Type") gets the new arms.

## 6. Система-32 shelf-pin grid (`packages/shared/src/shelfPinGrid.ts`, pure)

```ts
interface ShelfPinParams {
  pitch: number;          // default 32
  diameter: number;       // default 5
  depth: number;          // default 13 (blind; into Tc=16/18 board)
  frontSetback: number;   // default 37  (column distance from FRONT edge, along v)
  backSetback: number;    // default 37  (column distance from BACK edge, along v)
  topMargin: number;      // default 64  (first/last hole clearance from panel ends, along u)
  bottomMargin: number;   // default 64
  columns: 1 | 2;         // default 2 (front + back)
}

// pure: given a side panel's NATIVE part dims + which broad inner face, emit the column grid
function shelfPinGrid(
  dims: { length: number; width: number; thickness: number },  // length=H, width=D, thickness=Tc (UNSWAPPED)
  innerFace: 'Top' | 'Bottom',         // the broad H×D face that points into the cabinet
  params: ShelfPinParams,
): BoreOp[];

function columnPositions(start: number, end: number, pitch: number): number[];
// holes at start, start+pitch, ... ≤ end. Symmetric: centers the run so margins are balanced.
```

- **Inner face is the broad `Top`/`Bottom` face (premise 3, corrected).** `leftSide`/`rightSide`
  map to whichever of `Top`(z=Tc)/`Bottom`(z=0) points into the cabinet interior (resolved at
  contract-lock, §16). On that face `face2DFrame` gives `u = +X = height` (spans `0..length=H`)
  and `v = ∓Y = depth` (spans `0..width=D`).
- Columns at `v = frontSetback` and `v = width − backSetback`; holes stepped in `u` from
  `bottomMargin` to `length − topMargin` at `pitch`.
- `role:'shelfPin-system32'`, `connectorKind:'shelfPin'`, `connectorId:'pin-col-front'|'pin-col-back'`.
- `depth` is blind (never `'throughAll'`) — pins must not pierce the panel.

> **Defaults note:** 37 mm front setback and 64 mm end margins are standard but shop-tunable;
> values live in named consts (à la slice-1 minifix). The lead reviews these (deferred §15).

## 7. Door model + hinge math (`packages/shared`)

### 7a. `doorMath.ts` (pure) — sizing + pose

Input: cabinet external `{ width W, height H, depth D, Tc }`, opening (front), and the dialog's
`{ count: 'single'|'double', overlay, hingeSide, thickness Td=18, reveal r=2, clearance c=2,
centerReveal cr=3 }`. Output: one or two `DoorPanel = { dims, pose, doorSpec }`.

- **Opening** = front rectangle bounded by the carcass: width `Wo = W − 2·Tc` (between sides) for
  inset; the **front face** of width `W`, height `H` for overlay reference.
- **Full / half overlay** (door sits OVER the front):
  - single: `doorW = W − 2·r`, `doorH = H − 2·r`.
  - double: each `doorW = (W − 2·r − cr) / 2`, `doorH = H − 2·r`.
  - half overlay differs only in the cup setback constant (§7b) and (for shared-side cabinets)
    a reduced side overlap; geometry sizing here matches full.
- **Inset** (door fits INSIDE the opening with clearance). The inner opening height derived from
  `buildBaseCabinet` z-positions (bottom panel top at `tkH+Tc`, top panel bottom at `H−Tc`) is
  `innerOpeningH = H − tkH − 2·Tc`:
  - single: `doorW = Wo − 2·c`, `doorH = innerOpeningH − 2·c`.
  - double: split `doorW` with `cr` center clearance; `doorH` as single.
- **Part geometry vs world pose (corrected after verification).** The door is built with
  `buildPanelBox(length=doorH, width=doorW, thickness=Td)` → **part-local** `X=doorH`,
  `Y=doorW`, `Z=Td` (`PanelOps.ts` always maps length→X, width→Y, thickness→Z). The vertical
  world orientation comes from the `ComponentInstance` **pose/rotation**, NOT by relabeling part
  axes. Positioned at the cabinet **front**: overlay → just proud of the front face; inset →
  recessed into the opening. `doorSpec.hingeSide` (single: from dialog; double: `pairLeft` hinges
  left, `pairRight` hinges right). Unit-test sizing against the REAL `buildBaseCabinet` panel
  z-positions, not the prose formulas.

### 7b. `hingeMath.ts` (pure) — hinge count, Z positions, cup + plate bores

```ts
function hingeCountForHeight(doorH: number): number;   // ≤900→2, ≤1500→3, ≤2000→4, ≤2400→5
function hingePositions(doorH: number, count: number): number[];  // Z centers; ~100mm top/bottom, rest even
```

- **Cup** (on the door's carcass-facing **broad** face — `Top` or `Bottom` in the part frame,
  NOT `Back`/`Front`; corrected after verification): Ø35, `depth ≈ 12` (blind, `< Td`). On that
  broad face `face2DFrame` gives `u = +X = along doorH` (so `u` = hinge position along the door
  height ✓) and `v = ∓Y = along doorW`, `v ∈ [0, doorW]`. The hinge-side edge is at `v=0` OR
  `v=doorW`, so the setback is **hingeSide-dependent**: `v = CUP_SETBACK` for the edge at `v=0`,
  `v = doorW − CUP_SETBACK` for the edge at `v=doorW`. Setback constant **per overlay**:
  `CUP_SETBACK = { full: 21, half: 28, inset: 37 }` (named tunable consts). `role:'hingeCup'`,
  `connectorKind:'hinge'`, `connectorId:'hinge-<i>'`. Unit-test BOTH hinge sides against the
  door's real `face2DFrame`, asserting the cup lands within `CUP_SETBACK` of the CORRECT edge.
- **Plate** (on the corresponding side panel's broad inner `Top`/`Bottom` face — same resolution
  as §6): per hinge, **2× Ø5** holes 32 mm apart along the panel height (`u`), centered on the
  hinge `u` position, at the **front column setback** (`v = frontSetback`, so they coincide with
  система-32 practice). `depth ≈ 13` (blind). `role:'hingePlate'`, `connectorKind:'hinge'`, same
  `connectorId:'hinge-<i>'`. The plate `u` positions share the single `hingePositions` output
  with the cups, so plate Z matches cup Z by construction.
- **No deferred face TBD.** Because the door is a NEW part whose pose this spec authors, the
  cup face (`Top`/`Bottom` sign) and door world-pose are resolved at **contract-lock / Phase 0**
  with a real-OCCT bake guard (§16) — not left to implementation guesswork (the slice-1
  normal-sign / u-v-swap false-green class).

## 8. Commands (`packages/app/src/commands`, undoable on the bus)

- `AddDoorCommand(cabinetPath, params)` — atomic. **The cabinet `.ziasm` is a separate OPFS
  file**, so this CANNOT use `addComponent` (which only appends to the top-level
  `activeAssembly`, `useAppStore.ts:695-708`). It must mirror `GenerateCarcassBoresCommand`'s
  sub-assembly write path (corrected after verification):
  1. `unpackAssembly` the cabinet `.ziasm` from OPFS.
  2. `doorMath` → door panel(s); create the door part `.zipt`(s) (panel-box geometry) with a
     **`dedupeName`'d** name (`import/dedupeName.ts`) to avoid OPFS path collision; `registerPart`.
  3. Push `role:'door'` `ComponentInstance`(s) with `doorSpec` into the unpacked sub-assembly;
     `hingeMath` → write cup bores to the door part(s) and plate bores to the side part(s).
  4. `packAssembly` → write the `.ziasm` back to OPFS; reload `subAssemblyDocs` so the door
     renders; call the store `boreCacheInvalidator` for the door + side part paths so markers refresh.
  - **Revert (must undo ALL of the above):** delete the created door `.zipt`(s) from OPFS, remove
    the door `ComponentInstance`(s) from the `.ziasm` (re-pack), restore each side part's prior
    `bores[]`, AND call `boreCacheInvalidator` for door + side paths (apply AND revert, per the
    slice-1 undo-marker-staleness lesson). An undo test asserts `boreMarkerCount` returns to
    baseline AND the door `.zipt` is gone from OPFS.
  - Redo-optimized like slice-1 import commands (cache the built door geometry; avoid recomputing).
- `GenerateShelfPinBoresCommand(cabinetPath, params)` — auto; recurses the `.ziasm` (mirrors
  `GenerateCarcassBoresCommand`), runs `shelfPinGrid` for each `leftSide`/`rightSide`, writes
  `bores[]` to each side part atomically. Revert restores prior `bores[]`.
- `AddManualShelfPinBoresCommand(panelPath, face, params)` — manual; one picked panel + chosen
  inner face → `shelfPinGrid` → bores. Revert restores prior `bores[]`.
- **Reused unchanged:** `BakeBoresCommand` / `UnbakeBoresCommand`, `ClearBoresCommand`,
  `ExportBoringCsvCommand`, `ExportBoringDxfCommand`. All operate on `bores[]` regardless of role.

## 9. Viewport picking (`packages/app/src/viewport`)

New **single-component picker**: `Viewport.beginOneComponentPick(onPick)` +
`createOneComponentPicker` (analog of `createTwoComponentPicker`, reusing
`SceneManager.raycastComponent`). Drives:
- **Add Door** target (pick the cabinet), and
- **Manual система-32** target (pick one side/custom panel).

Inner-face choice for the manual path: default from the picked panel's `role` (leftSide→Right,
rightSide→Left); for a roleless custom panel, the dialog exposes a face selector.

## 10. Dialogs & ribbon (`packages/app/src/shell`)

- **AddDoorDialog** — count (single/double), hinge side (single only), overlay (full/half/inset),
  thickness, reveal/clearance, center reveal (double); hinge count shown read-only (auto). i18n keys.
- **ShelfPinDialog** — pitch, Ø, depth, front/back setback, top/bottom margins, columns (1/2);
  standard defaults pre-filled. i18n keys.
- **Ribbon** (Furniture/Assembly tab, beside slice-1 присадка buttons): **"Add Door"** /
  **"Двері"**, **"Система-32"** (auto) + a manual entry. Reuse the existing **Clear / Bake /
  Export DXF / Export CSV / show-bores toggle** buttons (they already operate on all bores).

All new UI strings keyed through `t()` (en/uk bundles), per the i18n parity-test gate.

## 11. Bake / export / 2D drawings — reused

- **Bake:** cups (Ø35), pins (Ø5), plates (Ø5) flow through the existing `atFace`
  `resolveAtFaceLocations` (grouped by `(face, Ø, depth)` → real OCCT holes). Cup = a large-Ø
  shallow blind hole; no new kernel surface. Bake operates per-part, so door cups bake on the
  door part and pins/plates on the side parts.
- **Export:** `aggregateBoresRecursive` + `buildBoringCsv` + `renderBoringDxf` already walk all
  bores; new roles appear with their Ø/depth on the standard CSV columns + `D{Ø}_T{depth}` DXF
  layers (a Ø35 cup → its own `D35_T12` layer). No export code change beyond the `connectorKind`
  → "Type" label map.
- **2D `.zidw`:** satisfied via bake (slice-1 premise) — baked cups/pins/plates project with
  center marks + hole-table rows automatically.

## 12. Sub-assembly rendering — door visibility

Slice 1 fixed production loading of `.ziasm` sub-assembly docs (cabinets render real panels).
The new door component is an ordinary part in that sub-assembly, so it renders via the same path
with a camera re-fit on the placeholder→real transition already in place. **Verify in §6** that a
freshly added door renders as a real panel (not a placeholder) and that its cup markers appear.

## 13. Persistence / manifest (additive → v22)

- `PanelRole += 'door'`, `BoreRole += 'shelfPin-system32'|'hingeCup'|'hingePlate'`,
  `BoreConnectorKind += 'shelfPin'|'hinge'` — additive string-union growth, backward-compatible.
- `ComponentInstance.doorSpec?: DoorSpec` — **new optional field**. Because §5/§8/§17 require it
  for re-bore/edit, BOM rollup, and `AddDoorCommand` undo, **we commit to persisting it** (no
  hedge): bump `CURRENT_FORMAT_VERSION` 21 → **22** (`fileFormat.ts:4`) with a **no-op migration**
  (the `21:` entry `{ ...m, formatVersion: 22 }`, mirroring the verified v20→v21 no-op at
  `fileFormat.ts:317-320`), add `22` to all three `ProjectFile` `formatVersion` union arms
  (`types.ts:150-152`), and clone `migrateManifest-v20-to-v21.spec.ts` → `…-v21-to-v22.spec.ts`.
  No existing field removed or retyped.
- The enum-union growth (`PanelRole`, `BoreRole`, `BoreConnectorKind`) is additive string-union
  widening — backward-compatible, needs no migration of its own.

## 14. Internal phase plan (TDD slices — input to writing-plans)

Each phase = red→green→refactor; suite green after each. Independent geometry phases (2/3/4)
can be authored in parallel — **after Phase 0 pins the face/pose conventions they all depend on.**

0. **Contract-lock geometry guard (FIRST, blocking)** — a kernel real-OCCT integration test that
   bakes a single BLIND bore onto a REAL `CreateCabinetCommand` side panel and onto a hand-posed
   door part, resolving: (a) which broad face (`Top` z=Tc vs `Bottom` z=0) of each side panel
   faces the cabinet interior; (b) the door part's pose + which broad face faces the carcass;
   (c) that `(u,v)` on those faces maps `u`→height, `v`→depth as §3/§6/§7 assume. Output: the
   concrete face-role + pose constants the geometry phases hard-code. This is the gate that would
   have caught the slice-1 u/v-swap class; it MUST be green before phases 2/3/4 author bores.
1. **Data model + migration** — enum variants, `DoorSpec`, v21→v22 migration + test;
   widen `BORE_COLORS` to `Record<BoreConnectorKind,string>`. (shared + app)
2. **Система-32 grid** — `shelfPinGrid` + `columnPositions`, unit-tested on real side-panel dims
   (broad-face derivation from Phase 0, 2 columns, pitch, margins, blind depth). (shared)
3. **Door math** — `doorMath` sizing + pose for single/double × full/half/inset, unit-tested
   against `buildBaseCabinet` cabinet dims. (shared)
4. **Hinge math** — `hingeMath` count rule + Z positions + cup/plate bore emission. (shared)
5. **Add Door command** — `AddDoorCommand` via the **sub-assembly write path** (unpack `.ziasm`
   → dedupeName'd door part → push component → pack → write OPFS → reload `subAssemblyDocs`; NOT
   `addComponent`); redo-optimized; undo deletes the door `.zipt`, removes the component, restores
   side bores, re-invalidates the marker cache. (app)
6. **Shelf-pin commands** — `GenerateShelfPinBoresCommand` (auto, recurse) +
   `AddManualShelfPinBoresCommand` (one-pick). (app)
7. **One-component picker** — `beginOneComponentPick` + wiring for Add Door + manual система-32. (app)
8. **Dialogs + ribbon + i18n** — AddDoorDialog, ShelfPinDialog, ribbon buttons, en/uk keys,
   marker colors for shelfPin/hinge. (app)
9. **Bake guards (real OCCT)** — kernel integration: build the REAL side/door parts via
   `buildPanelBox` with UNSWAPPED dims, feed the **generated** (not hand-authored) `shelfPinGrid`
   /`hingeMath` bores, bake, and assert: (a) Ø35 cup volume drop on the broad door face;
   (b) each Ø5 pin/plate void present, `u∈[0,H]`/`v∈[0,D]` in-bounds, **blind** (residual material
   remains, not `throughAll`); (c) correct grid count. NB: slice-1's side-panel face-bore "guard"
   (`HoleFeature.catalogBore.integration.spec.ts:176-191`) never actually baked (the bore is
   `throughAll`) — this phase closes that exact untested gap. (kernel)
10. **e2e + §6 browser** — real-WASM e2e (Add Door → cup markers → bake; система-32 → pin markers
    → DXF/CSV bytes), §6 controller probes (`boreMarkerCount`, door component present, byte-OPFS),
    door renders real (not placeholder), `tsc` on touched packages.

## 15. Non-goals (deferred)

- **Drawer fronts, handles, door swing/animation, door-front decorative profiles** — door is a
  flat boring host only.
- **Continuous (piano) hinges, blind-corner / bi-fold / lift-up hardware** — only standard
  35 mm cup hinges this slice.
- **Geometric auto-detection of which side a door hinges on** — taken from the dialog.
- **Live editable / draggable cups or pin columns** — edit = clear + regenerate (as slice 1).
- **Per-connector hardware-BOM rollup** (count hinges/pins into the Hardware CSV) — `doorSpec`
  carries the data; rollup is a follow-up.
- **Система-32 on shelves or other panels** — pins seat in the SIDES; shelves rest on pins.
- **Lead's shop-accuracy review of setbacks/margins/cup-setback consts** — values are sound
  named consts; furniture-exact tuning is a follow-up (mirrors slice-1 minifix accuracy debt).

## 16. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| **(HEADLINE, caught in spec verification) Wrong broad face** — `Right`/`Left`/`Back`/`Front` are NARROW end faces; bores must target the broad `Top`/`Bottom` face → else every blind hole mis-places (slice-1 u/v-swap class) | All side/door bores authored in the UNSWAPPED part frame on the `Top`/`Bottom` face; **Phase 0 contract-lock real-OCCT guard** pins the face sign + door pose BEFORE any geometry phase; Phase-9 bakes the generated blind bores and asserts in-bounds |
| `Top`-vs-`Bottom` sign (which faces interior) + door world-pose unknown without running OCCT | Resolved in **Phase 0** by baking onto the REAL `CreateCabinetCommand` part + hand-posed door; constants hard-coded only after the guard is green |
| Cup Ø35 blind depth vs 18 mm door → over-drill / through | `depth` clamped < `Td`; bake guard asserts blind (residual material) |
| Pins/plates drilled `'throughAll'` by mistake | `shelfPinGrid`/`hingeMath` always emit blind `depth`; unit + real-OCCT bake guard (closes slice-1's never-baked side-bore gap) |
| Cup on wrong door edge for right-hinged doors | hingeSide-dependent `v` (`CUP_SETBACK` vs `doorW − CUP_SETBACK`); unit-test BOTH sides |
| Double-door split / center reveal off → overlap or gap | `doorMath` unit tests on real cabinet dims; both doors + center reveal asserted |
| Plate Z positions not matching cup Z (door vs side) | Single `hingePositions` shared by cup + plate emission; same `connectorId` |
| **`AddDoorCommand` can't use `addComponent`** (top-level only) → door silently not added to the `.ziasm` | Sub-assembly write path (unpack→push→pack→write OPFS→reload), mirroring `GenerateCarcassBoresCommand`; e2e asserts the door renders + persists across reload |
| `AddDoorCommand` undo data-loss / stale markers | Revert deletes the door `.zipt`, removes the component, restores side bores, re-invalidates marker cache; dedupeName avoids OPFS collision; undo test asserts baseline marker count + door gone |
| Synthetic flat-panel fixtures give false green (slice-1 killer) | Drive the **real** `CreateCabinetCommand` → `AddDoorCommand` output; catalog-driven real-OCCT guards, byte-OPFS, **§6 mandatory** |
| New `doorSpec` field / v22 migration breaks old files | Optional + no-op v21→v22 migration + test (committed, §13) |
| `BORE_COLORS` Record not widened with the union → tsc/markers break | Widen to `Record<BoreConnectorKind,string>` in lockstep (Phase 1); test every kind has a color |
| Manual single-pick picker is new infra | Mirror `createTwoComponentPicker`; reuse `raycastComponent`; e2e the manual path |

## 17. Success criteria

- **Add Door:** select a base cabinet → choose single (L/R) or double, overlay → door part(s)
  appear as **real rendered panels** at the front, correctly sized per overlay (§6 browser).
- **Hinge boring:** the door carries Ø35 cup markers at the correct hinge Z positions on the
  hinge-side edge; the side panel carries the matching Ø5 plate holes at the same Z (§6 + unit).
- **Система-32 (auto):** a base cabinet → "Система-32" generates Ø5 columns on **both** side
  inner faces at 32 mm pitch, correct setbacks/margins, blind depth, mirrored L/R (§6 markers).
- **Система-32 (manual):** pick one side panel → pin column on its inner face.
- **Bake:** baked cups/pins/plates appear as real 3D voids **and** as circles + center marks in
  a `.zidw` view (§6 + e2e + real-OCCT volume drop on the REAL generated bores).
- **Export:** CSV rows + DXF circles match the new bores (byte-verified); Ø35 cup on its own layer.
- **Undo** restores prior state for every command (door removed; side `bores[]` restored).
- **Additive only:** v21 files load unchanged; v21→v22 migration is no-op; existing suites green;
  i18n parity test green (en/uk keys for all new UI strings).
