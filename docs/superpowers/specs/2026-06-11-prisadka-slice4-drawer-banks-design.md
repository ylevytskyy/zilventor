# присадка slice 4 — Drawer banks (front + nested box + side-mount Ø5 slide boring)

Status: VERIFIED v2 (brainstorm-approved 2026-06-11; **§14 Corrections v2 is AUTHORITATIVE and overrides any conflicting earlier text** — post 4-lens adversarial verify)
Track: Tier-1 "Inventor 2012 parity for furniture" — 11th feature.
Predecessors: присадка slice 1 carcass boring `bdfe322`, slice 2 doors+hinge-cup+система-32 `a57b1f7`, slice 3 live-edit+hardware-BOM `d4e17b8`. Door pipeline = `AddDoorCommand` + `doorMath`/`hingeMath` + `prisadkaFaceConventions.ts`.

## 1. Goal

One command places a **bank of N equal-height drawers** into a base-cabinet opening. Each drawer = a visible **front panel** + a **nested drawer-box sub-assembly** (5 butt-jointed panels) + **side-mount Ø5 Система-32 slide boring** (the присадка) on the cabinet sides and the box sides. Undoable. Slide bores flow through the existing DXF/CSV boring-map and bake to real OCCT holes.

Furniture value: drawer banks are core casework (4-drawer base, pot drawers). The присадка (slide boring) is the star, consistent with the slice theme.

## 2. Locked design decisions (brainstorm)

| Axis | Decision |
|---|---|
| Slide system | **Side-mount Ø5 Система-32** — two rows of Ø5 holes on each cabinet inner side + matching on each box side, on the 32 mm grid. Reuses slice-2 `shelfPinGrid` / Ø5 hinge-plate boring infra. |
| Drawer count | **Drawer bank**: command takes `count N`, divides the usable opening height into N **equal-height** drawers. |
| Box construction | **5-panel nested `.ziasm` sub-assembly** (2 sides, front, back, bottom captured), **butt joints**. One drawer box = one `ComponentInstance` (partPath → box `.ziasm`) inside the cabinet. |
| Front overlay | Reuse door overlay model (`full` / `half` / `inset`); default `full`. |

## 3. Chosen numeric defaults (configurable later; not all surfaced in v1 dialog)

- Side-mount slide clearance: **12.5 mm per side** (box outer width = opening inner width − 25 mm).
- Box side/front/back thickness: **16 mm**. Box bottom thickness: **12 mm** (captured, butt — sits inside, flush to bottom edges; see §6).
- Front panel thickness: **18 mm** (matches door default).
- Box height: drawer slot height − top/bottom clearance (see §5).
- Box depth: cabinet inner depth − **back clearance 10 mm** (box stops short of the back).
- Slide vertical position: centered on the box side height (single side-mount slide row pair per drawer); Ø5 holes at the **front and rear** of the slide line on the 32 mm grid (≥2 holes per side), setback from front = `DRAWER_SLIDE_FRONT_SETBACK = 37 mm` (Система-32 first-hole offset).

These constants live in ONE shared module (`drawerConventions.ts`) — see §10. No re-declaration anywhere (git-grep-gated), same discipline as `prisadkaFaceConventions.ts`.

## 4. Architecture

```
AssemblyTab "Add Drawers" button
  → DrawerBankDialog (cabinet, N 1–10, overlay, front thickness)
  → onCommit → new AddDrawerBankCommand(opts)

AddDrawerBankCommand.apply():
  1. unpack cabinet .ziasm (opfs.read → unpackAssembly)
  2. deriveCabinetDims(cab)              // REUSE from AddDoorCommand path
  3. drawerBankLayout(opening, N)         // → N slot rects (equal heights)
  for each slot i:
     4a. front = doorMath-style front sizing (overlay) → write front .zipt → component role 'drawerFront'
     4b. box  = drawerBoxMath(slot, clearances) → 5 PartDocuments → pack into a box .ziasm
              → write box .ziasm to OPFS → component role 'drawerBox' (partPath → box .ziasm)
     4c. slideBores = drawerSlideMath(slot, cabinetDims, boxDims)
              → append cabinet-side Ø5 bores to cabinet left/right side .zipt (like writePlateBores)
              → append box-side Ø5 bores to the box side panels (inside the box .ziasm)
  5. push front + box components into cab.components
  6. packAssembly(cab) → opfs.write(cabinetPath)
  7. reloadCabinet() → store subAssemblyDocs[cabinetPath]

AddDrawerBankCommand.revert():  remove created components, restore prior side bores (snapshot map), delete written box .ziasm / front .zipt blobs, repack+reload.
```

Nested `.ziasm` (box) inside cabinet `.ziasm`: rendering recurses (slice-1 sub-assembly render fix), BOM recurses cabinet-scoped (slice-3 `aggregateConnectorBomRecursive`), boring map recurses (`aggregateBoresRecursive`). No new recursion code needed — verify each path actually reaches the nested box (final-review item).

## 5. Geometry — bank division & box sizing

Let opening = usable inner cavity of the cabinet front face: `openW` (inner width = W − 2·Tc), `openH` (inner height between top and bottom panels, above toekick), `innerD` (inner depth).

**Bank division (`drawerBankLayout`):** N equal slots stacked bottom→top. `slotH = openH / N`. Slot i occupies `[bottomZ + i·slotH, bottomZ + (i+1)·slotH]`. Front face of each drawer fills its slot per overlay (full overlay → front slightly larger than slot with reveal; inset → inside slot with clearance), reusing the door overlay reveal/clearance constants. **Invariant (tested): Σ slotH == openH** (no gap, no overlap) within 1e-6.

**Box sizing (`drawerBoxMath`):**
- Box outer width `bw = openW − 2·SLIDE_CLEARANCE` (= openW − 25).
- Box outer height `bh = slotH − 2·BOX_VERT_CLEARANCE` (default BOX_VERT_CLEARANCE = 12 → box sits centered in slot with travel clearance).
- Box depth `bd = innerD − BOX_BACK_CLEARANCE` (= innerD − 10).
- Panels (butt): left side & right side = `bd × bh × 16`; box front & back = `(bw − 2·16) × bh × 16` (fit between the sides); bottom = `(bw − 2·16) × (bd − 2·16) × 12`, captured flush to the bottom edges of the four walls (butt, sits on the lower inner ledge — for v1 the bottom is simply a panel coplanar with the bottom edges; no groove).
- Each panel gets a pose so the assembled box is upright, box-front facing world +Y (same front direction as the cabinet/door). Box-local origin = box front-bottom-left corner; box `.ziasm` is placed by the drawerBox component at the slot's world position.

All face-direction choices DERIVE from `drawerConventions.ts` + reuse `prisadkaFaceConventions` where a side-panel inner face is involved.

## 6. Geometry — slide boring (`drawerSlideMath`) — the присадка

Side-mount slide = a rail screwed to the cabinet side + a rail screwed to the box side, at the SAME height, meeting when the drawer is inserted.

- **Cabinet side bores:** on `LEFT_SIDE_INNER_FACE` ('Top') of the left side panel and `RIGHT_SIDE_INNER_FACE` ('Bottom') of the right side panel (reuse `prisadkaFaceConventions`). For drawer i: Ø5 holes at `u = slide vertical center of drawer i` (a single row height), `v = {DRAWER_SLIDE_FRONT_SETBACK, DRAWER_SLIDE_FRONT_SETBACK + k·32, …}` along depth — ≥2 holes spanning the slide length, on the 32 mm grid. `connectorKind: 'drawerSlide'`, `role: 'drawerSlide-cabinet'`. depth = blind (default 12 mm into the 16 mm side).
- **Box side bores:** matching Ø5 holes on the box's two side panels (outer faces), same depth pattern, `role: 'drawerSlide-box'`.
- Each cabinet-bore + its paired box-bore share a `connectorId` (so BOM counts one slide pair per drawer per side, and slice-3 live-edit/BOM treats them as a unit). connectorId scheme: `drawerSlide-<drawerIndex>-<L|R>-<holeIndex>` grouped so a "slide" = the row (BOM rolls up per slide pair). **Decision: one connectorId per (drawer, side) slide assembly**, with the row of Ø5 holes as its members — mirrors how a hinge groups its cup+plate holes.

**Slide vertical center:** centered on box side height: `slideZ = slotBottomZ + BOX_VERT_CLEARANCE + bh/2` (matched on cabinet and box so rails align). Tested: cabinet-side `u` and box-side `u` map to the SAME world Z.

## 7. Schema changes (additive, manifest v23 → v24)

All additive, back-compatible (older docs load, migrate no-op):
- `PanelRole += 'drawerFront' | 'drawerBox-side' | 'drawerBox-front' | 'drawerBox-back' | 'drawerBox-bottom'`.
- `ComponentInstance.role` accepts `'drawerFront' | 'drawerBox'`.
- `ComponentInstance.drawerSpec?: { overlay; index; count }` (optional; analogous to `doorSpec`).
- `BoreRole += 'drawerSlide-cabinet' | 'drawerSlide-box'`.
- `BoreConnectorKind += 'drawerSlide'`.
- `connectorCatalog` gains a `drawerSlide` entry (Ø5, blind depth) so bake + DXF labeling + BOM naming work.
- Migration `v23→v24`: identity (no field reshape) — bump `CURRENT_FORMAT_VERSION` and add the union members + a migration stub that passes docs through.

i18n: new `dialog.drawerBank.*`, `tab.asm.addDrawers`, `aria.add_drawers`, `bom.connector.drawerSlide`, boring-map labels for the two new roles — added to BOTH en.json and uk.json (parity-test gate). Drawing OUTPUT (DXF/CSV) stays English per existing convention.

## 8. UI

- AssemblyTab: new "Add Drawers" button next to "Add Door".
- `DrawerBankDialog.tsx`: cabinet picker (assembly components that are cabinets), `count` (int 2–10, default 3; **validate** 1–10, `step={1}`), `overlay` select (full/half/inset, default full), front `thickness` (default 18). Box/clearance params use defaults (not surfaced v1). Validation blocks invalid count / non-positive derived dims (degenerate-cabinet guard — analogous to circular-pattern's radius guard: if `slotH ≤ box vertical clearance·2` or `openW ≤ 25`, block with an error message, do NOT silently produce a zero/negative panel).
- Store: `drawerBankDialogOpen` flag + setter.

## 9. Bake / export

- Slide Ø5 bores bake via the existing `atFace` HolePlacement pipeline (slice 1) — no new kernel code, real OCCT Ø5 blind holes. Bake guard test asserts a measurable OCCT volume drop on a generated box side panel AND a cabinet side panel.
- DXF/CSV boring map: `aggregateBoresRecursive` already walks nested assemblies; the new roles get labels via the catalog. Verify the nested box `.ziasm` bores appear in the recursive aggregate (final-review item — this is exactly the slice-3 "does the recursion actually reach it" risk).

## 10. Single-source-of-truth & false-green guards (LOAD-BEARING)

Every prior slice was saved by these. Mandatory:

1. **`drawerConventions.ts`** (packages/shared): ALL drawer constants (clearances, thicknesses, setbacks, slide grid) + any drawer face-direction choices, DERIVED once. Imported everywhere; **zero re-declarations** (git-grep gate in a test). Side-panel inner faces reuse `prisadkaFaceConventions` (do not re-derive 'Top'/'Bottom').
2. **Anti-tautology pose oracle** (slide & box panels): tests build expected world positions/orientations from an INDEPENDENT computation (two separate `quatToMat3` applications or direct trig), NEVER by calling the same producer helper. Test points not parallel to any axis. (The slice-2/circular-pattern rule.)
3. **Bank-division invariant**: `Σ slotH == openH`, slots tile with no gap/overlap, first slot bottom == opening bottom, last slot top == opening top.
4. **Slide-rail alignment**: cabinet-side slide row and box-side slide row map to the SAME world Z (the whole point of a slide) — asserted directly, not by reusing one to compute the other.
5. **Real-OCCT bake guard** on GENERATED bores (not hand-authored): pick the producer's actual output bores, bake, assert Ø5 void volume drop on both a box side and a cabinet side.
6. **Command test uses a FULL `AssemblyDocument` seed** (`setActiveDocument({kind:'assembly', document: makeAsm([...])})`, `// @vitest-environment node`) — a bare `setState` shim omits `groundedComponentPaths` and `addComponent` crashes (slice-3/circular trap).
7. **The FINAL whole-branch review re-checks THIS spec §-by-§** against the real UI + command code — not "does it work." Specifically verify: (a) the nested box `.ziasm` is actually written to OPFS and referenced, not just built in memory; (b) the recursive render/BOM/boring-map ACTUALLY reach the nested box bores (slice-3 false-green class: a probe/command e2e can be green while a UI handler or a recursion is stubbed); (c) the dialog handlers call the command for real (not stub `onChange`); (d) revert restores prior cabinet-side bores AND deletes the written box/front blobs (no OPFS leak); (e) the degenerate-cabinet guard fires.

## 11. Testing plan (TDD slices — red→green per slice)

1. `drawerConventions` constants + git-grep no-redeclare test.
2. `drawerBankLayout(openH, N)` → N equal slots; Σ==openH; tiling invariant (red: empty fn).
3. `drawerBoxMath(slot, clearances)` → 5 panel dims + poses; anti-tautology pose oracle; butt-fit invariants (front/back fit between sides; bottom fits inside).
4. `drawerSlideMath` → Ø5 grid on 32mm, ≥2 holes/side, cabinet & box rows align in world Z; connectorId grouping (one per drawer-side); role/kind correct.
5. Schema v24: union members added, migration v23→v24 identity, manifest bump; back-compat load of a v23 doc.
6. `AddDrawerBankCommand` apply: full AssemblyDocument seed; N fronts + N boxes pushed; box `.ziasm` written to OPFS (assert via opfs read + unpack); cabinet-side slide bores appended; nested box-side bores present.
7. `AddDrawerBankCommand` revert: components removed, prior side bores restored, written blobs deleted (no leak).
8. Real-OCCT bake guard (kernel integration): generated Ø5 slide bores on a box side + cabinet side drop volume.
9. DrawerBankDialog DOM test (`fireEvent`): validation (count bounds, degenerate guard), onCommit opts threaded.
10. i18n en/uk parity for new keys.
11. e2e (real browser + WASM, probe path on `playwright.worktree.config.ts` port 5182): seed cabinet → command N=3 → probe `boreMarkerCount` > 0, component count grew by 6 (3 fronts + 3 boxes), OPFS-unpack a box `.ziasm` and assert 5 panels + box-side bores, then undo restores counts.

## 12. Deferred (explicit)

Handles/pulls; specific slide-brand catalog SKUs (generic Ø5 grid only); bottom-in-groove joinery (butt only, v1); 3D drag-gizmo for slide bores; soft-close / over-travel / full-extension geometry; per-drawer unequal/custom heights; drawer dividers; file-drawer rails; lead reviews uk.json `dialog.drawerBank.*` + `bom.connector.drawerSlide` terms.

## 13. Out of scope / non-goals

No kernel geometry beyond reusing the slice-1 `atFace` bake. No new package deps. No change to the door pipeline (clone-of-pattern, not refactor). Desktop-Chromium / OPFS+disk storage only (no cloud/mobile).

## 14. Corrections v2 — AUTHORITATIVE (post 4-lens adversarial verify, 2026-06-11)

This section OVERRIDES conflicting earlier text. Each item cites the verifier finding it resolves.

### 14.1 Geometry — drawer-front sizing (overrides §5 "reuse door overlay" — geom BLOCKER #1)
Per-slot reuse of the door reveal formula makes adjacent full/half-overlay fronts **overlap by 2·reveal** on shared boundaries. Correct model (in `drawerConventions.ts`): add `DRAWER_FRONT_GAP = 3` (mm, between adjacent fronts). Front sizing is on the OUTER face, not the inner slot:
- `overhang = overlay==='full' ? Tc : overlay==='half' ? Tc/2 : 0` (covers carcass panel edge).
- Slots tile the inner opening: `slotBottomZ_i = openBottomZ + i·slotH`, `slotTopZ_i = openBottomZ + (i+1)·slotH`, `slotH = openH/N`.
- **Full/half overlay** front i vertical extents:
  - `bottomZ_i = slotBottomZ_i + (i==0 ? −overhang : +GAP/2)`
  - `topZ_i    = slotTopZ_i    + (i==N-1 ? +overhang : −GAP/2)`
  - `frontH_i = topZ_i − bottomZ_i`, centered at `(topZ_i+bottomZ_i)/2`. Width = `openW + 2·overhang` (single column, no horizontal neighbor).
  - Guarantees: interior boundary has exactly `GAP` between neighbors (no collision); end fronts overhang by `overhang`. **Tested invariant: for every adjacent pair, `bottomZ_{i+1} − topZ_i == GAP` (>0).**
- **Inset** front i: `bottomZ_i = slotBottomZ_i + c`, `topZ_i = slotTopZ_i − c`, width `= openW − 2c` (`c` = inset clearance from door constants). No collision by construction.
- This is **new code** `drawerFrontMath(slotIndex, N, opening, overlay, params)` — NOT a call to `doorMath` (see 14.5).

### 14.2 Geometry — box side-panel axis (overrides §5 box panel dims — geom BLOCKER #2)
A panel's broad-face u-axis = part-X = `length`. Cabinet side panels use `length=H` (height) so `u`=height. The box side panels MUST therefore be declared **`{length: bh, width: bd, thickness: 16}`** (height as `length`, depth as `width`) — NOT `bd × bh`. Otherwise the box-side slide `u` encodes DEPTH while the cabinet-side `u` encodes HEIGHT and the rails never align. §5 text "`bd × bh × 16`" for the two side panels is corrected to "`bh × bd × 16`". Box front/back and bottom panel formulas unchanged.

### 14.3 Geometry — degenerate guards (overrides §8 thresholds — geom #3/#4)
Front/back panel width `= bw − 2·16 = openW − 57`. Guard must block `openW ≤ 57` (not just `≤ 25`) and `slotH ≤ 24` (strict — `bh` must be strictly positive; `buildPanelBox` throws on 0). Dialog blocks with `drawerBank.error.tooSmall`. Also block `N < 1`.

### 14.4 Slide world-Z alignment is the load-bearing oracle (strengthens §6/§10.4/§11.4 — FG BLOCKER #2)
Define ONE independent target `slideWorldZ_i = openBottomZ + i·slotH + BOX_VERT_CLEARANCE + bh/2`. `drawerSlideMath` must place BOTH the cabinet-side row and the box-side row so each bore's resolved WORLD-Z equals `slideWorldZ_i`. Test asserts each row's world-Z against this **third constant** computed from first principles — never cabinet-row vs box-row against each other (that passes a symmetric bug).

### 14.5 Reuse premises that DON'T hold — new code required (reuse HIGH/MEDIUM)
- `deriveCabinetDims` is **module-private** in `AddDoorCommand.ts:63`. Resolution: extract it to a shared/app helper module and `export` it; both door and drawer commands import it. (No body change.)
- `doorMath` is **hardwired to full cabinet height H + count single/double** — it CANNOT size a sub-height slot. Resolution: `drawerFrontMath` (14.1) is new code that imports the reveal/clearance/overlay CONSTANTS from `doorMath`'s constants but computes its own sizing.
- `shelfPinGrid` / `columnPositions` are **not exported** and shaped for full-height sweeps. Resolution: `drawerSlideMath` is new code (already planned); drop the "reuses shelfPinGrid" claim — it reuses the 32 mm grid CONSTANT and the Ø5 + face-frame conventions only.
- `writePlateBores` clones cleanly for **cabinet-side** bores, but **box-side** bores live inside the nested box `.ziasm`: writing them requires unpack box → locate the side-panel `.zipt` inside → patch bores → repack box → opfs.write. This is **new nested-container traversal code** and is the single biggest hidden risk — it gets its own early plan chunk + test BEFORE the rest of boring is built.

### 14.6 Schema exhaustiveness compile-guards (overrides §7 — schema/reuse BLOCKER)
Adding `'drawerSlide'` to `BoreConnectorKind` breaks compile at every `satisfies Record<BoreConnectorKind, …>` / `Record<BoreConnectorKind, …>` site until updated. The schema TDD slice MUST update, in the same commit: (a) `BORE_COLORS` in `packages/app/src/scene/SceneManager.ts`, (b) `CONNECTOR_BOM_CATALOG` in `connectorBomCatalog.ts` (add a `drawerSlide` entry with `nameKey: 'bom.connector.drawerSlide'`), (c) both exhaustiveness spec-test arrays (`ALL_KINDS` etc.), (d) the `connectorCatalog` bake/geometry entry. `BoreRole` additions hit no exhaustive switch (`face2DFrame` switches over face roles, not bore roles) — safe. Migration `v23→v24` is identity pass-through (no validator rejects unknown enum values).

### 14.7 Kernel registration + unique partPaths + revert cleanup (schema SHOULD-FIX)
- Newly written drawer panel `.zipt`s and box `.ziasm`s must be `registerPart`-ed with the kernel (and features executed) before the boring map / bake can see their bores — mirror `AddDoorCommand`'s `KernelPartApi` `registerPart`/`deletePart` usage.
- `subAssemblyDocs` is keyed by `partPath`; per-slot box and front paths MUST be unique (`dedupeName` per slot, not per bank) or a second slot silently overwrites the first.
- `revert` must `opfs.delete` ALL N box `.ziasm` + N front `.zipt` blobs AND restore prior cabinet-side bores from the snapshot (best-effort delete per existing pattern; test asserts each blob absent — FG SHOULD-FIX #6).

### 14.8 UI wiring — commit to the door pattern (overrides §8 — reuse LOW)
"Add Door" lives in **FurnitureTab** using `beginOneComponentPick` → `setAddDrawerBankDialog({cabinetPath, onSubmit, onCancel})` (callback-object on the store), NOT an AssemblyTab boolean flag. Slice 4 follows the **door pattern**: "Add Drawers" button in FurnitureTab next to "Add Door"; cabinet chosen via `beginOneComponentPick`; `DrawerBankDialog` driven by the callback-object. (The §8 `drawerBankDialogOpen` boolean is dropped.)

### 14.9 Box-pose oracle origin convention (strengthens §11.3 — FG BLOCKER #1)
Pin the box-local origin = **box front-bottom-left corner**; the `drawerBox` component `position` = that corner's world coordinate. The pose oracle computes each box panel's expected world centroid by raw arithmetic from this origin (two separate `quatToMat3` applications, never the producer helper) and runs against a **cabinet rotated 15° about world-Z** so axis-parallel sign bugs surface.

### 14.10 Test-plan strengthenings (override §11 where stricter)
- §11.2 bank-division: test `N=3, openH=500` (non-divisible) — assert `slots[1].bottom==slots[0].top`, … `slots[N-1].top≈openH` within 1e-6 (N=1 is tautological).
- §11.8 bake guard: feed the **producer's actual emitted `BoreOp[]`** (extracted from the written panels via `boresOf`) into `bakeHoles`, not hand-authored u/v.
- §11.9 dialog test: after `fireEvent` commit, assert `bus.execute` was called with an **`AddDrawerBankCommand` instance** carrying the right opts (proves dialog→command path, not a stub).
- §11.11 e2e: in addition to OPFS-unpacking a box `.ziasm` (assert 5 panels + box-side bores), assert `aggregateBoresRecursive(cabinet)` **returns bores with `role:'drawerSlide-box'`** (proves recursion reaches the nested level).
- §11.10 + new: assert `ConnectorBomTable` renders the `drawerSlide` group with a localized label, and uk.json has `bom.connector.drawerSlide` (parity).
- §11.1 git-grep gate: grep for the bare numeric literals (`32`, `37`, `12`, `12.5`, `16`) outside `drawerConventions.ts`, not only re-declared identifiers.

### 14.11 Scope (reuse MEDIUM) — stays ONE slice, ordered
Box-model (front + 5-panel nested box) goes green BEFORE slide boring is added. The box-side nested-`.ziasm` bore-write (14.5) is the load-bearing seam → its own early chunk with a focused test. No decomposition into separate shipped slices.
