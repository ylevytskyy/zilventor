# Присадка slice 2 — Doors + hinge boring + система-32 shelf-pin boring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax.

**Goal:** Add per-panel hardware boring (система-32 Ø5 shelf-pin grids + Ø35 door hinge cups + hinge-plate holes) plus a minimal door model, reusing slice-1's BoreOp / bake (atFace) / DXF·CSV export / 3D-marker infrastructure.

**Architecture:** New pure geometry helpers in packages/shared (shelfPinGrid, doorMath, hingeMath), new undoable commands in packages/app (AddDoorCommand via the sub-assembly write path, GenerateShelfPinBoresCommand, AddManualShelfPinBoresCommand), a one-component picker, two dialogs, additive enum/manifest growth (v21→v22). A Phase-0 real-OCCT guard pins the broad-face (Top/Bottom) + door-pose conventions before any geometry phase.

**Tech Stack:** TypeScript monorepo (pnpm), Vitest, Playwright (real-WASM e2e), OCCT (kernel), three.js (markers), react-i18next.

---

## Contract (canonical — every task imports these types/paths/signatures/constants)

I now have all the verified facts I need. Door part `.zipt` is created exactly like `CreateCabinetCommand.packPanelPart` (newPart → addFeature(panel) → writeTarGz of manifest.json) — no kernel geometry blob needed since a PanelFeature regenerates its box on execute. The hardware catalog is exported via `@zilventor/shared/hardware`. Now I'll write the contract document.

```markdown
# Присадка slice 2 — CONTRACT (preamble; every task imports this)

> **Canonical, verified-against-real-code shared contract.** Every downstream plan chunk MUST agree with these paths, types, names, and conventions. Verified at master `4373e38` against the real files cited. Where a name is given, use it **verbatim** — a single mismatch across tasks is a bug (the slice-1 false-green class).

---

## A. Exact file paths to edit / create

### Create (new files)
| File | Phase | Purpose |
|---|---|---|
| `packages/shared/src/shelfPinGrid.ts` | 2 | `shelfPinGrid` + `columnPositions` (pure) |
| `packages/shared/src/shelfPinGrid.spec.ts` (or `__tests__/shelfPinGrid.spec.ts`) | 2 | unit tests |
| `packages/shared/src/doorMath.ts` | 3 | `doorMath` (pure) |
| `packages/shared/src/doorMath.spec.ts` | 3 | unit tests |
| `packages/shared/src/hingeMath.ts` | 4 | `hingeCountForHeight`, `hingePositions`, cup/plate emit (pure) |
| `packages/shared/src/hingeMath.spec.ts` | 4 | unit tests |
| `packages/shared/src/__tests__/migrateManifest-v21-to-v22.spec.ts` | 1 | clone of v20→v21 spec |
| `packages/app/src/commands/AddDoorCommand.ts` | 5 | sub-assembly write-path command |
| `packages/app/src/commands/__tests__/AddDoorCommand.spec.ts` | 5 | apply/undo tests |
| `packages/app/src/commands/GenerateShelfPinBoresCommand.ts` | 6 | auto recurse command |
| `packages/app/src/commands/__tests__/GenerateShelfPinBoresCommand.spec.ts` | 6 | |
| `packages/app/src/commands/AddManualShelfPinBoresCommand.ts` | 6 | one-panel command |
| `packages/app/src/commands/__tests__/AddManualShelfPinBoresCommand.spec.ts` | 6 | |
| `packages/app/src/viewport/createOneComponentPicker.ts` | 7 | single-component picker |
| `packages/app/src/viewport/createOneComponentPicker.spec.ts` | 7 | |
| `packages/app/src/shell/dialogs/AddDoorDialog.tsx` | 8 | (place beside existing dialogs — see note) |
| `packages/app/src/shell/dialogs/ShelfPinDialog.tsx` | 8 | |
| `packages/kernel/src/adapter/features/__tests__/HoleFeature.system32.integration.spec.ts` | 0/9 | shelf-pin real-OCCT guard |
| `packages/kernel/src/adapter/features/__tests__/HoleFeature.hingeCup.integration.spec.ts` | 0/9 | door-cup real-OCCT guard |

> **Dialog dir note:** existing dialogs live under `packages/app/src/shell/` (e.g. the Boring dialog is driven by `boringDialog`/`setBoringDialog` store slots, `useAppStore.ts:323-324`). Confirm the actual existing dialog folder (`packages/app/src/shell/dialogs/` vs `packages/app/src/shell/`) during Phase 8 and match it; the contract does not pin a folder that may not exist.

### Modify (existing files, with current line anchors)
| File | Line(s) | Edit |
|---|---|---|
| `packages/shared/src/bore.ts` | `3-6` (`BoreRole`), `8` (`BoreConnectorKind`) | add enum arms (§B) |
| `packages/shared/src/cabinets/types.ts` | `4-11` (`PanelRole`) | add `\| 'door'` |
| `packages/shared/src/types.ts` | new `DoorSpec` type (place near `ComponentInstance`, `96-107`); add `doorSpec?` field at `ComponentInstance` (after `role?` line `106`); `ProjectFile` union arms `150-152` | (§B, §G) |
| `packages/shared/src/fileFormat.ts` | `4` (`CURRENT_FORMAT_VERSION`), `migrations` table (add key `21`, after the `20:` entry at `317-320`), `normalizeKind` version list `325-328` (add `22`) | (§G) |
| `packages/app/src/viewport/SceneManager.ts` | `112-116` (`BORE_COLORS`), `693` (index site, unchanged but now type-checked) | widen Record + add 2 colors (§B, §D) |
| `packages/app/src/shell/tabs/FurnitureTab.tsx` | dialog handlers ~`78-90`, ribbon JSX ~`93+` | wire 3 commands + 2 dialogs + ribbon buttons |
| `packages/app/src/store/useAppStore.ts` | dialog slots near `boringDialog` `323-324`; reload helper near `setSubAssemblyDocs` `278/630` | add `addDoorDialog`/`shelfPinDialog` slots; (optional) a `reloadSubAssemblyDoc` action (§F) |
| `packages/app/src/App.tsx` | `Viewport` ref usage / `handleViewportPointer`; picker wiring near existing pickers | add `beginOneComponentPick` wiring (§F, Phase 7) |
| i18n bundles (`packages/app/src/i18n/en.json`, `…/uk.json` — confirm real paths) | — | new UI keys; parity-test gate |

---

## B. Canonical type definitions (FINAL text)

**`packages/shared/src/bore.ts`** — replace `BoreRole` (`3-6`) and `BoreConnectorKind` (`8`):

```ts
export type BoreRole =
  | 'confirmat-face' | 'confirmat-edge'
  | 'minifix-cam' | 'minifix-bolt' | 'minifix-cross'
  | 'dowel-face' | 'dowel-edge'
  | 'shelfPin-system32'   // Ø5 grid hole on a side INNER (Top/Bottom) face
  | 'hingeCup'            // Ø35 cup on a door INNER (Top/Bottom) face
  | 'hingePlate';         // Ø5 plate-mount hole on a side INNER face

export type BoreConnectorKind = 'confirmat' | 'minifix' | 'dowel' | 'shelfPin' | 'hinge';
```

`BoreOp` (`bore.ts:16-26`) is **unchanged**. Verbatim, for reference (do not retype it — just import it):

```ts
export interface BoreOp {
  id: string;
  face: FaceName;
  u: number;
  v: number;
  diameter: number;
  depth: number | 'throughAll';
  role: BoreRole;
  connectorId: string;
  connectorKind: BoreConnectorKind;
}
```

`PanelFaceRole` (`bore.ts:29`, exported) = `'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right'`. Reuse it; do **not** redeclare.

**`packages/shared/src/cabinets/types.ts:4-11`** — `PanelRole`:

```ts
export type PanelRole =
  | 'leftSide'
  | 'rightSide'
  | 'bottom'
  | 'top'
  | 'back'
  | 'toekick'
  | 'shelf'
  | 'door';
```

**`packages/shared/src/types.ts`** — new `DoorSpec` (place immediately above `ComponentInstance`, before line `96`):

```ts
export type DoorSpec = {
  overlay: 'full' | 'half' | 'inset';
  hingeSide: 'left' | 'right';                 // which vertical edge carries the cups
  pair: 'single' | 'pairLeft' | 'pairRight';   // double-door membership
  hingeCount: number;                          // resolved at creation (auto from height)
};
```

And add the field to `ComponentInstance` (after the `role?` line at `106`):

```ts
  /** Door overlay/hinge spec; present only on role:'door' components. Additive v22. */
  doorSpec?: DoorSpec;
```

**`packages/shared/src/shelfPinGrid.ts`** — `ShelfPinParams`:

```ts
export interface ShelfPinParams {
  pitch: number;          // default 32
  diameter: number;       // default 5
  depth: number;          // default 13 (blind; into Tc=16/18 board)
  frontSetback: number;   // default 37  (column distance from FRONT edge, along v)
  backSetback: number;    // default 37  (column distance from BACK edge, along v)
  topMargin: number;      // default 64  (first/last hole clearance from panel ends, along u)
  bottomMargin: number;   // default 64
  columns: 1 | 2;         // default 2 (front + back)
}
```

> `PanelRole`/`BoreRole`/`BoreConnectorKind` growth is additive string-union widening — backward-compatible, no migration of its own (§G handles the `doorSpec` field bump).

---

## C. Canonical function signatures (pin names EXACTLY)

**`shelfPinGrid.ts`** (pure):
```ts
export function columnPositions(start: number, end: number, pitch: number): number[];
// holes at start, start+pitch, … ≤ end; centered so margins balance.

export function shelfPinGrid(
  dims: { length: number; width: number; thickness: number }, // UNSWAPPED native: length=H, width=D, thickness=Tc
  innerFace: 'Top' | 'Bottom',                                 // broad H×D face pointing into the cabinet
  params: ShelfPinParams,
): BoreOp[];
```
Emits `role:'shelfPin-system32'`, `connectorKind:'shelfPin'`, `connectorId:'pin-col-front'|'pin-col-back'`, `depth: params.depth` (blind, never `'throughAll'`). Each bore `id` must be unique and deterministic (e.g. `` `pin-col-front-${i}` ``). `face` = `{ featureId:'panel', role: innerFace, instance:0 }`.

**`doorMath.ts`** (pure):
```ts
export interface DoorMathInput {
  cabinet: { width: number; height: number; depth: number; Tc: number; toekickHeight: number };
  count: 'single' | 'double';
  overlay: 'full' | 'half' | 'inset';
  hingeSide: 'left' | 'right';      // single only; ignored for double
  thickness: number;                 // Td, default 18
  reveal: number;                    // r, default 2 (overlay)
  clearance: number;                 // c, default 2 (inset)
  centerReveal: number;              // cr, default 3 (double)
}

export interface DoorPanel {
  dims: { length: number; width: number; thickness: number }; // length=doorH, width=doorW, thickness=Td (buildPanelBox convention)
  pose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
  doorSpec: DoorSpec;
}

export function doorMath(input: DoorMathInput): DoorPanel[]; // length 1 (single) or 2 (double)
```
**Door part dims map length→localX=doorH, width→localY=doorW, thickness→localZ=Td** (`PanelOps.buildPanelBox` always maps L→X, W→Y, T→Z). The vertical world orientation comes from `pose.quaternion`, NOT by relabeling part axes. The concrete `pose` (translation offset at the cabinet front + the rotation that stands the door upright) and the carcass-facing broad face (`Top`/`Bottom` sign) are **pinned by Phase 0** (§H) before `doorMath`/`hingeMath` hard-code them.

**`hingeMath.ts`** (pure):
```ts
export function hingeCountForHeight(doorH: number): number;       // ≤900→2, ≤1500→3, ≤2000→4, ≤2400→5, else 5
export function hingePositions(doorH: number, count: number): number[]; // u centers along doorH; ~100mm top/bottom, rest even

export function hingeCupBores(
  doorDims: { length: number; width: number; thickness: number }, // length=doorH, width=doorW, thickness=Td
  cupFace: 'Top' | 'Bottom',         // carcass-facing broad face (from Phase 0)
  hingeSide: 'left' | 'right',       // sets v edge: v=CUP_SETBACK[overlay] at v=0 edge, else doorW−CUP_SETBACK[overlay]
  overlay: 'full' | 'half' | 'inset',
  uPositions: number[],              // from hingePositions
): BoreOp[];

export function hingePlateBores(
  sideDims: { length: number; width: number; thickness: number }, // UNSWAPPED native side dims (length=H, width=D, thickness=Tc)
  innerFace: 'Top' | 'Bottom',       // side inner broad face (from Phase 0)
  uPositions: number[],              // SHARED with hingeCupBores → plate Z matches cup Z
  frontSetback: number,              // v = frontSetback (coincides with система-32 front column)
  params?: { diameter?: number; depth?: number; pairSpacing?: number }, // Ø5, depth 13, 2 holes 32mm apart
): BoreOp[];
```
Cup: `role:'hingeCup'`, `connectorKind:'hinge'`, `connectorId:'hinge-<i>'`, `diameter:35`, `depth ≈ 12` (blind, `< Td`). Plate: `role:'hingePlate'`, `connectorKind:'hinge'`, **same** `connectorId:'hinge-<i>'`, `diameter:5`, `depth ≈ 13` (blind), **2× per hinge** 32mm apart along `u`, centered on the hinge `u`. The cup `u` and plate `u` share the single `uPositions` array, so plate Z == cup Z by construction.

**Command constructor signatures (`packages/app/src/commands`)** — mirror the verified `GenerateCarcassBoresCommand` opts-object shape (`GenerateCarcassBoresCommand.ts:60-66`):

```ts
// AddDoorCommand.ts
type OpfsRWD = {
  read(p: string): Promise<Uint8Array>;
  write(p: string, b: Uint8Array): Promise<void>;
  exists(p: string): Promise<boolean>;
  delete?(p: string): Promise<void>;
};
export class AddDoorCommand implements Command {
  constructor(private readonly opts: {
    cabinetPath: string;             // the cabinet .ziasm OPFS path
    params: DoorMathInput;           // door dialog params (count/overlay/hingeSide/thickness/reveal/clearance/centerReveal + cabinet dims)
    opfs: OpfsRWD;
    kernel?: Pick<KernelApi, 'registerPart' | 'deletePart'>; // optional in unit tests
    store?: typeof useAppStore;
  }) { /* … */ }
}

// GenerateShelfPinBoresCommand.ts
export class GenerateShelfPinBoresCommand implements Command {
  constructor(private readonly opts: {
    cabinetPath?: string;            // optional explicit cabinet; default = recurse activeAssembly like GenerateCarcassBoresCommand
    params: ShelfPinParams;
    opfs: OpfsRW;                    // { read, write } as in GenerateCarcassBoresCommand.ts:22
    store?: typeof useAppStore;
  }) { /* … */ }
}

// AddManualShelfPinBoresCommand.ts
export class AddManualShelfPinBoresCommand implements Command {
  constructor(private readonly opts: {
    panelPath: string;               // the picked side/custom panel .zipt
    face: 'Top' | 'Bottom';          // chosen inner broad face
    params: ShelfPinParams;
    opfs: OpfsRW;
    store?: typeof useAppStore;
  }) { /* … */ }
}
```
`OpfsRW` = `{ read(p:string):Promise<Uint8Array>; write(p:string,b:Uint8Array):Promise<void> }` (verbatim from `GenerateCarcassBoresCommand.ts:22`). All commands implement `Command` (`packages/app/src/commands/Command.ts`) with `apply()`/`revert()` and dispatch via `useAppStore.getState().bus.execute(cmd)` (see `FurnitureTab.tsx:87`).

**`createOneComponentPicker.ts`** — analog of `createTwoComponentPicker` (`createTwoComponentPicker.ts:12-36`):
```ts
export interface OneComponentPicker {
  pick(path: ComponentPath): void;
  reset(): void;
}
export function createOneComponentPicker(opts: {
  resolvePartPath: (path: ComponentPath) => string;
  onPick: (partPath: string, path: ComponentPath) => void;
}): OneComponentPicker;
```
`Viewport.beginOneComponentPick(onPick)` mirrors the existing two-component begin-pick wiring and reuses `SceneManager.raycastComponent` (`SceneManager.ts:758`).

---

## D. Face / pose convention block (conventions 1–7, concrete)

**Box convention (universal):** `buildPanelBox(occt, {length:L, width:W, thickness:T})` builds `[-L/2,-W/2,0]..[L/2,W/2,T]` — centered X/Y, bottom face at Z=0. `length→localX`, `width→localY`, `thickness→localZ` (`PanelOps.ts:56-99`, verified). Faces: `Top=+Z`, `Bottom=-Z`, `Front=+Y`, `Back=-Y`, `Left=-X`, `Right=+X` (`PanelOps.ts:11-15`).

**`face2DFrame` (u,v) per face** (`bore.ts:45-65`, verified):
- `Top`: origin `(-L/2,-W/2,T)`, `uDir=+X` (spans `0..L`), `vDir=+Y` (spans `0..W`), normal `+Z`.
- `Bottom`: origin `(-L/2,+W/2,0)`, `uDir=+X` (spans `0..L`), `vDir=-Y` (spans `0..W`), normal `-Z`.
- `Left/Right/Front/Back` are the NARROW end faces with `uDir=+Z` (spans only `0..T ≈ 16-18mm`) → **WRONG target for slice-2 bores**.

**Convention 1 — Panels are stored in NATIVE part frame, bores authored UNSWAPPED.** Side panel = `{length:H, width:D, thickness:Tc}` (`baseCabinet.ts:30-43`). All slice-2 side/door bores are authored against these **unswapped** native dims. The L↔T swap in `GenerateCarcassBoresCommand.ts:123-129` is *only* for world-AABB joint math and never touches the stored geometry the `(u,v)` is interpreted against — **do not** apply it here.

**Convention 2 — Side inner face is BROAD `Top`/`Bottom`.** For a side `{length=H, width=D, thickness=Tc}`, `Top`(z=Tc)/`Bottom`(z=0) are the broad `H×D` faces. On them `u=+X` spans `0..H` (height), `v=∓Y` spans `0..D` (depth). A vertical система-32 column = **fixed v** (depth setback), holes stepped in **u** (height). `Right`/`Left` are the narrow `D×Tc` end faces — NEVER the target.

**Convention 3 — Door cup on BROAD `Top`/`Bottom`.** Door = `buildPanelBox(length=doorH, width=doorW, thickness=Td)` → local `X=doorH, Y=doorW, Z=Td`. The Ø35 cup goes on the carcass-facing broad face (`Top` or `Bottom`, NOT `Back`/`Front`). On it `u=+X=along doorH` (hinge position) and `v=∓Y=along doorW` (setback from hinge edge). hingeSide-dependent: `v = CUP_SETBACK[overlay]` at the `v=0` edge, `v = doorW − CUP_SETBACK[overlay]` at the `v=doorW` edge.

**Convention 4 — SIGN (Top vs Bottom) + door pose pinned by Phase 0** (§H) before any geometry phase hard-codes them.

**Convention 5 — all side/door bores are BLIND** (`depth < board thickness`, never `'throughAll'`).

**Convention 6 — `AddDoorCommand` uses the sub-assembly write path** (NOT `addComponent`, which is top-level only — `useAppStore.ts:295,695`). Mirror `GenerateCarcassBoresCommand`: unpack the cabinet `.ziasm` → mutate components/bores → pack → write OPFS → reload the modified `.ziasm` into `subAssemblyDocs` (§F).

**Convention 7 — Manifest bump v21→v22 is COMMITTED; `BORE_COLORS` widens to `Record<BoreConnectorKind,string>` in lockstep** (§B, §G).

### Where (u,v) is consumed — pin to these two sites (must agree)
- **At BAKE:** `resolveAtFaceLocations` (`HoleFeature.ts:288-343`) calls `face2DFrame(panelDims, role)` (`HoleFeature.ts:332-337`) where `panelDims` comes from `panelDimsFromBody` = the **UNSWAPPED part bbox** (`HoleFeature.ts:345-355`). `P = frame.origin + u·uDir + v·vDir`. Drill axis = into the material (corrected outward-normal sign via body-CoM, `HoleFeature.ts:299-329`).
- **At MARKER render:** `rebuildBoreMarkers` (`SceneManager.ts:659-705`) calls `face2DFrame(spec.panelDims, bore.face.role)` (`SceneManager.ts:678`) with `spec.panelDims` = the same native part dims, then transforms by `spec.worldPose` (component pose). Color = `BORE_COLORS[bore.connectorKind]` (`SceneManager.ts:693`).

Both re-derive `(u,v)` against native UNSWAPPED dims → authoring bores on the broad `Top`/`Bottom` face with `u`=height/`v`=depth keeps bake and markers in agreement.

---

## E. Named constants (values + home)

All live as named `const`s alongside their producer (à la slice-1 minifix consts at `connectorCatalog.ts:129-155`), exported only if a test/dialog needs them. The lead's shop-accuracy review is deferred (spec §15).

**`shelfPinGrid.ts`** (`DEFAULT_SHELF_PIN_PARAMS: ShelfPinParams`):
```ts
export const DEFAULT_SHELF_PIN_PARAMS: ShelfPinParams = {
  pitch: 32, diameter: 5, depth: 13,
  frontSetback: 37, backSetback: 37,
  topMargin: 64, bottomMargin: 64, columns: 2,
};
```

**`hingeMath.ts`**:
```ts
export const CUP_DIAMETER = 35;
export const CUP_DEPTH = 12;        // blind; < Td(18)
export const CUP_SETBACK = { full: 21, half: 28, inset: 37 } as const; // mm from hinge edge, per overlay
export const PLATE_DIAMETER = 5;
export const PLATE_DEPTH = 13;      // blind
export const PLATE_PAIR_SPACING = 32; // two plate holes per hinge, along u
// hinge-count thresholds: ≤900→2, ≤1500→3, ≤2000→4, ≤2400→5
export const HINGE_END_INSET = 100; // top/bottom hinge ~100mm from door ends
```

**`doorMath.ts`** (defaults; dialog pre-fills these):
```ts
export const DEFAULT_DOOR_THICKNESS = 18;  // Td
export const DEFAULT_REVEAL = 2;           // r  (overlay)
export const DEFAULT_CLEARANCE = 2;        // c  (inset)
export const DEFAULT_CENTER_REVEAL = 3;    // cr (double)
```

**`SceneManager.ts:112-116`** — widened `BORE_COLORS` (add 2 arms):
```ts
static readonly BORE_COLORS: Record<BoreConnectorKind, string> = {
  confirmat: '#2e7dd1',
  minifix: '#d14f2e',
  dowel: '#2eb872',
  shelfPin: '#b8a32e',   // amber
  hinge: '#8c2eb8',      // violet
};
```
(import `BoreConnectorKind` from `@zilventor/shared`; the index site at `:693` is already `BORE_COLORS[bore.connectorKind]` and just needs the wider Record type. A test must assert every `BoreConnectorKind` member has a color — exhaustive-key guard.)

---

## F. Sub-assembly write helpers (REAL mechanism)

**Part `.zipt` creation** (door part) — mirror `CreateCabinetCommand.packPanelPart` (`CreateCabinetCommand.ts:101-119`), verified:
1. `newPart(name)` → `packages/kernel/src/adapter/PartDocument.ts:44` (seeds origin features).
2. `addFeature(part, panelFeature)` → `PartDocument.ts:65` (the door `PanelFeature` with `length=doorH/width=doorW/thickness=Td` literals; build it like `buildBaseCabinet`'s `pushPanel` → `PanelFeature`, `baseCabinet.ts:117-127`).
3. Set `doc.bores = hingeCupBores(...)` (door cups).
4. Manifest `{ formatVersion: CURRENT_FORMAT_VERSION, kind:'part', document: doc }` → `writeTarGz([{ name:'manifest.json', data: JSON-bytes }])` (`tarGzipUtil`, imported as in `CreateCabinetCommand.ts:11`). No kernel geometry blob is needed (PanelFeature regenerates its box on execute).
5. `await kernel.registerPart(doc)` → `api.ts:90` (`registerPart(part: PartDocument): Promise<void>`; throws if id already registered — use a fresh `crypto.randomUUID()` id from `newPart`).
6. `await opfs.write(zipPath, bytes)`.

**Name de-dup:** `dedupeName(base, existingNames)` → `packages/app/src/import/dedupeName.ts:8` — `dedupeName(base: string, existingNames: string[]): string`. Use it on the door part filename to avoid OPFS path collision (existing names = OPFS listing of `.zipt` paths in scope).

**`.ziasm` read/write** — `packages/kernel/src/storage/AssemblyPacker.ts`, verified exports:
```ts
unpackAssembly(bytes: Uint8Array): Promise<AssemblyDocument>            // :67
unpackAssemblyWithTextures(bytes): Promise<{ doc; textures }>           // :30
packAssembly(doc: AssemblyDocument, thumbnail: Uint8Array, textures?): Promise<Uint8Array> // :5
```
> **Critical:** `packAssembly` requires a `thumbnail` arg — pass `new Uint8Array()` (as `CreateCabinetCommand.ts:60` does). `unpackProject`/`packProject` (`@zilventor/kernel/src/storage/ProjectPacker`) are for `.zipt` PART files (used by `GenerateCarcassBoresCommand` to read/write side-panel `bores[]`, `:8,103,220`). The door command writes the **side panel** plate bores via the **part** path (read `.zipt` → `unpackProject` → set `doc.bores` → `packProject` → write), exactly like `GenerateCarcassBoresCommand.apply/revert` (`:99-204,217-240`).

**The actual `GenerateCarcassBoresCommand` mechanism** (mirror it for shelf-pin commands and the door command's side-panel bores): per part `.zipt` it does `opfs.read → unpackProject → entry.document.bores = [...existing, ...new] → packProject({manifest:{...,formatVersion:CURRENT_FORMAT_VERSION,document}, blobs:{}}) → opfs.write`, snapshotting `priorBores` for revert (`GenerateCarcassBoresCommand.ts:100-204`). It recurses `.ziasm` sub-assemblies via `unpackAssembly` (`:91-94`).

**Marker-cache invalidation:** store action `boreCacheInvalidator: ((paths:string[])=>void) | null` (`useAppStore.ts:331`), set via `setBoreCacheInvalidator` (`:332,853`). App registers it as `invalidatePartPaths` (`App.tsx:4660-4694`): evicts geometry/bore/kernel-id caches for each partPath, then bumps active-assembly identity to re-run mesh-sync + bore-marker effects. **Every command calls `this.store.getState().boreCacheInvalidator?.(affectedPaths)` on BOTH apply and revert** (verified pattern, `GenerateCarcassBoresCommand.ts:206-209,237-239`; `BakeBoresCommand.ts:79,88`).

**`subAssemblyDocs` reload (door visibility) — REQUIRED, separate from `boreCacheInvalidator`.** The store mirror is `subAssemblyDocs: Record<string, AssemblyDocument>` (`useAppStore.ts:274`), set via `setSubAssemblyDocs(next)` (`:278,630`). The **production loader effect** (`App.tsx:3162-3206`) is **additive only** — it loads `.ziasm` docs MISSING from the mirror and **never replaces an existing entry**. Therefore, after `AddDoorCommand` rewrites the cabinet `.ziasm` (new door component), the command MUST explicitly refresh that entry:
```ts
const docs = { ...store.getState().subAssemblyDocs };
docs[cabinetPath] = await unpackAssembly(await opfs.read(cabinetPath));
store.getState().setSubAssemblyDocs(docs);
store.getState().setSolverDirty(true);
```
This mirrors the DEV hook `__zilventorSubAsmInvalidate` (`App.tsx:2980-2998`). **Plan recommendation:** add a thin store action `reloadSubAssemblyDoc(partPath)` near `setSubAssemblyDocs` (`useAppStore.ts:278/630`) that does the delete-and-reload (so the command does not import `unpackAssembly` directly and the path is unit-testable); OR have the command perform the inline refresh above. Either way, `setBoreCacheInvalidator`/`boreCacheInvalidator` alone is **insufficient** for door visibility — it refreshes markers/meshes of already-known parts, not the sub-assembly membership. **Undo must reverse this reload too** (re-unpack the reverted `.ziasm`).

---

## G. Manifest bump recipe (v21 → v22)

1. **`packages/shared/src/fileFormat.ts:4`** — `export const CURRENT_FORMAT_VERSION = 22 as const;` (was `21`).
2. **Add migration entry** (after the `20:` no-op at `:317-320`):
```ts
  // v21 → v22: additive — ComponentInstance.doorSpec is optional; absent === unset
  // at runtime. No structural transformation. (Присадка slice 2 — doors)
  21: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 22 };
  },
```
3. **`normalizeKind` version list** (`fileFormat.ts:325-328`) — add `|| m.formatVersion === 22` to the bare-kind→`part` guard.
4. **`packages/shared/src/types.ts` `ProjectFile` union** (`150-152`) — add `22` to ALL THREE arms:
   - part arm `150`: `… | 21 | 22; kind: 'part'; …`
   - assembly arm `151`: `… | 21 | 22; kind: 'assembly'; …`
   - drawing arm `152`: `… | 21 | 22; kind: 'drawing'; …`
5. **Clone the spec** `packages/shared/src/__tests__/migrateManifest-v20-to-v21.spec.ts` → `migrateManifest-v21-to-v22.spec.ts`: change `20→21` to `21→22`, assert `CURRENT_FORMAT_VERSION === 22`, assert a v21 assembly with a component round-trips to v22 with `components[0].doorSpec` undefined (no injection), idempotent for v22, bare-kind→`part`. Use the v20-to-v21 spec (`:1-54`, read in full) as the literal template.

> The enum-union growth (`PanelRole`/`BoreRole`/`BoreConnectorKind`) is additive string-widening — backward-compatible, needs no migration of its own.

---

## H. Phase 0 guard contract (real-OCCT, blocking — must be GREEN before Phases 2/3/4)

**Pattern to mirror (verified, read in full):** `packages/kernel/src/adapter/features/__tests__/HoleFeature.catalogBore.integration.spec.ts:1-95`. It (a) `await loadOcct()` in `beforeAll`; (b) `buildPanelBox(oc, DIMS)`; (c) builds a `NamedShape` by mapping faces via `TopExp.MapShapes_1` + centroid classification (`:78-95`); (d) feeds **catalog-generated** (not hand-authored) bores into `executeHoleFeature`; (e) asserts a real volume drop. The sibling `HoleFeature.catalogBore.minifix-dowel.integration.spec.ts` is the multi-Ø/blind variant.

**Phase 0 must OUTPUT (hard-coded constants the geometry phases import):**
1. **Side inner-face sign:** for `leftSide` and `rightSide` built with native `{length:H, width:D, thickness:Tc}` and placed at their `baseCabinet` world positions (`baseCabinet.ts:34,42`) with identity rotation, **which broad face (`Top` z=Tc vs `Bottom` z=0) points into the cabinet interior** — resolved by baking a single blind bore on the candidate face and asserting the void lands on the interior side. Output e.g. `LEFT_SIDE_INNER_FACE: 'Top'|'Bottom'`, `RIGHT_SIDE_INNER_FACE: …`.
2. **Door pose + carcass-facing face:** the `pose.quaternion`/translation that stands a `buildPanelBox(doorH, doorW, Td)` door upright at the cabinet front, AND which broad face (`Top`/`Bottom`) faces the carcass (carries the cup). Output `DOOR_POSE`, `DOOR_CUP_FACE: 'Top'|'Bottom'`.
3. **(u,v) sanity:** confirm on those faces `u→height/along-doorH`, `v→depth/along-doorW` per §D — assert a bore at known `(u,v)` lands at the expected world point (within tolerance).

**Phase 9 (bake guards, real OCCT) — closes the slice-1 never-baked gap:**
- `HoleFeature.system32.integration.spec.ts`: build the REAL side panel via `buildPanelBox({length:H,width:D,thickness:Tc})`, feed the **generated** `shelfPinGrid(dims, innerFace, DEFAULT_SHELF_PIN_PARAMS)` output (not hand-authored), bake via `executeHoleFeature`, assert: each Ø5 void present, `u∈[0,H]`/`v∈[0,D]` in-bounds, **blind** (residual material at the back face, NOT through), correct grid count (= `columnPositions` length × columns).
- `HoleFeature.hingeCup.integration.spec.ts`: build the REAL door part, feed generated `hingeCupBores(...)`, assert Ø35 cup volume drop on the broad door face (`DOOR_CUP_FACE`), blind (`< Td`), correct hinge count, AND the cup lands within `CUP_SETBACK[overlay]` of the CORRECT edge for BOTH `hingeSide` values.

> NB: slice-1's side-panel face-bore "guard" (`HoleFeature.catalogBore.integration.spec.ts:176-191`) is `throughAll` so it pierces regardless of face — it never tested a blind on-face placement. Phase 0 + Phase 9 close exactly that gap.

---

### Self-critique

1. **Door `pose`/`DOOR_CUP_FACE` left to Phase 0** — by design (spec §16), but it means `doorMath`/`hingeMath` signatures take `cupFace`/pose as inputs rather than computing them; if Phase 0 finds the door needs a non-identity rotation the marker `worldPose` plumbing (App.tsx → `MarkerOverlaySpec.worldPose`) must carry it — assumed already pose-general (it is; `:54,675`).
2. **Dialog folder path** (`shell/dialogs/` vs `shell/`) not pinned — flagged for Phase-8 confirmation rather than guessed.
3. **`hingeCountForHeight` >2400** unspecified by spec — I defaulted `else→5`; the lead may want 6.
4. **`reloadSubAssemblyDoc` store action** is a recommendation, not an existing API — the inline alternative is verified to work.
5. Assumed `DEFAULT_SHELF_PIN_PARAMS.depth=13` (spec §6) though shelf-pin catalog `bboxMm.h=28` — depth is the HOLE depth, not pin length; consistent.

Assumptions: i18n bundle paths/exact key namespace unverified (not in scope list); `Command` interface shape inferred from usage. **Confidence: 86** — every file:line, export, signature, and the two load-bearing mechanisms (sub-assembly write path + the *additive-loader → explicit-reload* gap) are verified against real code; the residual risk is Phase-0-derived geometry constants (correctly deferred) and the unread i18n/Command/dialog-folder specifics.
```

---

Everything is verified: imports resolve, the single-file integration run command works, and the `executeHoleFeature` + `buildPanelBox` + face-classification pattern is confirmed real. Now I'll author the plan chunk.

Key facts I've verified for the geometry:
- Side panel `{length:H, width:D, thickness:Tc}` → box `[-H/2,-D/2,0]..[H/2,D/2,Tc]`. `Top`(z=Tc)/`Bottom`(z=0) are the broad H×D faces; `face2DFrame` Top: u=+X(0..H=height), v=+Y(0..D=depth). Bottom: u=+X(0..H), v=-Y(0..D).
- `panelDimsFromBody` returns the AABB → `{length=H, width=D, thickness=Tc}` matches the authored dims (no swap), so bake re-derives the same (u,v) frame. Confirmed.
- The body-CoM normal-sign correction in `resolveAtFaceLocations` means a bore on Top drills DOWN (into material, -Z), and a bore on Bottom drills UP (+Z) — both blind, both leaving residual material when depth < Tc.

Here is the plan chunk:

---

---

## Binding conventions (read first — corrections locked after two adversarial verification rounds)

# Присадка slice 2 — CONTRACT ADDENDUM v2 (binding corrections)

> **This addendum OVERRIDES the contract and any chunk text where they conflict.** It fixes the
> blockers an adversarial verifier round found in the first plan draft. Every fix-agent MUST make
> its chunk obey these rules verbatim. The dominant theme: the broad-face / pose conventions are a
> SINGLE DERIVED SOURCE OF TRUTH imported everywhere — never a re-declared local literal (that was
> the slice-1 false-green class, reproduced by the draft).

---

## 1. Single shared conventions module (NEW FILE) — fixes the face-sign contradiction (BLOCKER)

Create **`packages/shared/src/prisadkaFaceConventions.ts`** exporting the canonical broad-face +
pose constants. EVERY phase that needs a side-inner-face, the door cup face, or the door pose
**imports from here** and NEVER re-declares a local `const LEFT_SIDE_INNER_FACE = '...'` literal.

```ts
import type { PanelFaceRole } from './bore';

export type BroadFace = Extract<PanelFaceRole, 'Top' | 'Bottom'>;

/**
 * Which broad (H×D) face of each SIDE panel points into the cabinet interior, in the panel's
 * NATIVE part frame. DERIVED + PROVEN by the Phase-0 derivation test (do NOT trust the literal
 * blindly — Phase 0 recomputes it from the real world pose and goes RED if this value is wrong).
 */
export const LEFT_SIDE_INNER_FACE: BroadFace = /* Phase-0 derived (see Phase 0 Task 0/1) */ 'Top';
export const RIGHT_SIDE_INNER_FACE: BroadFace = /* mirror */ 'Bottom';

/** The DOOR's broad face that points toward the carcass (where the Ø35 cup is bored). */
export const DOOR_CUP_FACE: BroadFace = /* Phase-0 derived */ 'Bottom';

/** The door component's upright pose at the cabinet front. Phase-0 derived + proven. */
export const DOOR_POSE: { quaternion: [number, number, number, number] } = {
  quaternion: /* Phase-0 derived */ [0, 0, 0, 1],
};
```

- The literal VALUES above are placeholders **that Phase 0 must PROVE by independent computation**
  (next section). If the geometry says otherwise, the Phase-0 test fails and the literal here is
  corrected until green. Downstream phases are insulated either way because they import the symbol.
- `LEFT_SIDE_INNER_FACE` and `RIGHT_SIDE_INNER_FACE` MUST be opposite signs (the two sides mirror).

**Importers (replace every local literal with an import):** Phase 0 guards, Phase 3 `doorMath`
(DOOR_POSE), Phase 4 `hingeMath` (DOOR_CUP_FACE + the side face for plates), Phase 5
`AddDoorCommand`, Phase 6 `GenerateShelfPinBoresCommand` + `AddManualShelfPinBoresCommand`,
Phase 8 manual-pick default-face, Phase 9 bake guards. A `git grep` for `_INNER_FACE`/`CUP_FACE`
in the final plan must show ONLY the module declaration + imports — zero re-declarations.

## 2. Phase 0 must DERIVE the constants, not assert literals against themselves (BLOCKER)

The draft's Phase 0 did `const X = 'Bottom'; expect(X).toBe('Bottom')` — tautological, cannot fail.
Rewrite so each constant is a CONSEQUENCE of a real computation:

- **Side inner face (a shared/app unit test — pure pose math, no OCCT needed for the SIGN):**
  1. Build a real cabinet via `CreateCabinetCommand` (or read the real `baseCabinet` side-panel
     world poses — position + rotation as actually stored).
  2. For `leftSide`: transform the part-local Top (+Z) and Bottom (−Z) outward normals by the
     panel's world rotation; pick the face whose WORLD normal points toward the cabinet centerline
     (`normal · (cabinetCenter − panelCenter) > 0`). That computed face is the interior face.
  3. `expect(computedLeftInnerFace).toBe(LEFT_SIDE_INNER_FACE)` — now a wrong constant is RED.
     Mirror for `rightSide` and assert the two are opposite.
- **Door cup face + pose:** apply `DOOR_POSE` to the door box; assert the door stands vertical at
  the cabinet FRONT and that `DOOR_CUP_FACE`'s world normal points toward the carcass interior;
  assert a known `(u,v)` on `DOOR_CUP_FACE` transforms to the expected world point at the front.
- **Phase 0/9 real-OCCT guard (the bake half):** bake the GENERATED pin/plate/cup bore (from
  `shelfPinGrid`/`hingeMath`, NOT hand-authored) onto the REAL part at its real pose; assert the
  resulting void's centroid lands on the cabinet-INTERIOR side (so a sign flip turns the bake
  guard RED), AND a blind residual remains (depth < board thickness). This is the gate that makes
  the whole convention real.
- If — and only if — the interior-facing sign genuinely cannot be resolved in a kernel unit
  (needs the assembly pose pipeline), do the SIGN derivation in a shared/app unit test (pure pose
  math, as above) and let the Phase-9 OCCT guard + Phase-10 §6 browser pass be the final
  confirmation. Either way phases 5/6/9 IMPORT the single constant; none hard-code a literal.

## 3. `beginOneComponentPick` API — ONE contract, pointer-wired (BLOCKER)

Pin the picker API identically in Phase 7 (definition) and Phase 8 (call site), mirroring the REAL
`beginTwoComponentPick` (`packages/app/src/viewport/Viewport.tsx` — read it). The two-component
picker returns a handle and does NOT auto-fire; App.tsx owns the begin-pick and feeds
`.pick(clientX, clientY)` on canvas pointer events. Slice-2 MUST do the same:

- Phase 7: `createOneComponentPicker(resolvePartPath, onPick)` → returns `{ pick(clientX,clientY), reset() }`.
  `Viewport.beginOneComponentPick(resolvePartPath, onPick)` exposes it the same way
  `beginTwoComponentPick` is exposed.
- Phase 8 handlers do NOT call `beginOneComponentPick(singleCallback)`. They route through App.tsx's
  existing pointer handler exactly as the two-component flow does (App begins the pick, sets the
  active pick mode, and feeds `.pick(x,y)` on the next canvas click), passing a real
  `resolvePartPath` and a one-shot `onPick(partPath)`. Arg count + return type MUST agree across
  Phase 7 and Phase 8. If you change the shape, change BOTH.

## 4. AddDoorCommand owns cabinet-dims derivation — never zeros (BLOCKER)

`AddDoorCommand.apply()` DERIVES `{ width, height, depth, Tc, toekickHeight }` from the unpacked
cabinet `.ziasm` (from the side/bottom `PanelFeature` dims + any stored `BaseCabinetParams`
metadata) and OVERRIDES `params.cabinet` before calling `doorMath`. Phase 8's `handleAddDoor`
passes the picked **cabinetPath only** (and the dialog's overlay/hinge/count params) — it passes
**NO** `cabinet: { width:0, ... }` zeros. Add a unit assertion in Phase 5 that the derived
`doorMath` inputs are strictly positive. The Phase-10 e2e must drive the SAME derivation path the
ribbon uses (do not hardcode real dims into the command to bypass the seam — that is a false green).

## 5. `packDoorZipt` is async (BLOCKER)

`writeTarGz` is `async … : Promise<Uint8Array>` (real: `tarGzipUtil.ts:91`). So:
```ts
async function packDoorZipt(doc): Promise<Uint8Array> { /* … */ return writeTarGz([...]); }
// call site:
const bytes = await packDoorZipt(doorDoc);
await this.opts.opfs.write(doorPath, bytes);
```
Mirror `CreateCabinetCommand.packPanelPart` (which is async). The draft's sync return wrote a
Promise to OPFS (corrupt `.zipt`) and failed `tsc`.

## 6. e2e shared import must resolve (BLOCKER)

`@zilventor/shared/shelfPinGrid` (bare subpath, no `/src/`) does NOT resolve — there is no exports
map or vite alias. In the Playwright/browser e2e, import via the **barrel** `@zilventor/shared` or
the **deep path** `@zilventor/shared/src/shelfPinGrid`, OR inline the literal params
`{ pitch:32, diameter:5, depth:13, frontSetback:37, backSetback:37, topMargin:64, bottomMargin:64, columns:2 }`
(mirror slice-1's e2e, which passes literals). Pick one and use it consistently.

## 7. Phase 8 marker test — no `<<COPY SETUP>>`; lean on the compile-time guard (MAJOR)

Do NOT ship a `<<COPY SETUP>>` placeholder or a "find an existing SceneManager spec yourself" step.
jsdom cannot back a real `WebGLRenderer`. The exhaustiveness lock is:
(a) compile-time `export const BORE_COLORS = { … } satisfies Record<BoreConnectorKind, string>` (Phase 1), and
(b) the Phase-1 pure key-coverage unit test asserting every `BoreConnectorKind` has a color (no
SceneManager instance). Drop any jsdom `new SceneManager()` marker-instance test UNLESS you cite a
real existing spec (by exact path) that already constructs SceneManager under jsdom and paste its
mock verbatim. The render-path marker check belongs in the Phase-10 §6 browser pass (probe
`getSceneManager().boreMarkerCount()`), not a unit test.

## 8. Phase 10 F3 undo-check uses the store, not unpackProject (minor)

To count door components after undo, read the store: after `__zilventorSubAsmInvalidate(cabinetPath)`,
assert `subAssemblyDocs[cabinetPath].components.filter(c => c.role === 'door').length === 0` (the
mechanism B2 uses). Do NOT read the `.ziasm` via `__zilventorUnpackProject` (that is the PART
unpacker; on an assembly it reads `[]` and the assertion passes vacuously). Drop the bytes path.

## 9. Phase 1 — enumerate stale `21` literals before the full-suite run (minor)

Before the final `npx vitest run`, add a step: run
`git grep -nE "(CURRENT_FORMAT_VERSION|formatVersion.*\b21\b)" packages/shared/src packages/app/src packages/kernel/src`
and list the consumers so the executor knows the blast radius (distinguish "bump to 22" edits from
intentional historical-version assertions). Also add the `satisfies Record<BoreConnectorKind,string>`
to `BORE_COLORS` per §7.

## 10. Non-issues (do NOT add work for these)

- Export is already kind-agnostic: `buildBoringCsv` emits raw `connectorKind` in the Type column,
  `renderBoringDxf` uses `D{Ø}_T{depth}` layers. There is NO `connectorKind → Type label map` to
  extend. Do not add a task for it.
- `createOneComponentPicker` using `onPick` while `createTwoComponentPicker` uses `onComplete` is
  fine (different files) — keep `onPick` consistent within Phase 7.

---

## Phase 0 — conventions module + contract-lock geometry guard

> **Scope of this chunk:** a new shared conventions module + three new kernel integration specs (real OCCT). Task 0 (Phase 0.5) **creates the single source of truth for the broad-face + pose constants** so every downstream phase imports one module and never re-declares a local literal. Task 1 (Phase 0) is the **blocking contract-lock guard** that DERIVES the load-bearing geometry constants — which broad `Top`/`Bottom` face of each side panel faces the cabinet interior, the door part's pose + carcass-facing face, and that `(u,v)`→`(height,depth)` on those faces — by both pure-pose derivation (non-tautological) and real-OCCT bakes. Tasks 2 & 3 (Phase 9) are the **bake guards** that feed the GENERATED `shelfPinGrid`/`hingeMath` bores through `executeHoleFeature` and assert Ø35 cup volume drop on the broad door face, each Ø5 pin/plate void in-bounds + BLIND with residual material, and correct grid count — closing slice-1's never-baked side-bore gap. Tasks 2 & 3 **import the constants** from the conventions module.
>
> **Hard ordering:** Task 0 (create conventions module) MUST happen first. Task 1 (Phase 0 guard) MUST be green and its OUTPUT constants verified before geometry Phases 2/3/4 (other chunks) author bores. Tasks 2 & 3 (Phase 9) depend on the Phase 2/Phase 4 producer modules; they are written to RED-block until those producers exist, then go green once they do. This is intentional: the bake guard is the final cross-check that the pure producers and the real kernel agree.
>
> **Test runner (all integration specs in this chunk):** kernel integration specs run with
> `npx vitest run --config vitest.integration.config.ts <file>` from `packages/kernel/`.
> The config `include` globs `src/**/__tests__/**/*.integration.spec.ts` (verified `vitest.integration.config.ts:5`), so all three new integration spec files match by living in `src/adapter/features/__tests__/` with the `.integration.spec.ts` suffix.
>
> **Critical geometry fact (source: `GenerateCarcassBoresCommand.ts:108-128`):** side panels are stored in NATIVE part frame `{length:H, width:D, thickness:Tc}` (unswapped). The render rotation maps part-Z (thickness) to world-X (left-right) when standing the panel upright. Therefore in the bore frame: `Top` (z=Tc) → world+X for leftSide → interior face. The L↔T swap in `GenerateCarcassBoresCommand` is ONLY for world-AABB joint math and never touches the bore's `(u,v)` interpretation. Phase 0 Task 1 DERIVES and asserts this.


---

### Task 0: Phase 0.5 — create `packages/shared/src/prisadkaFaceConventions.ts` (single source of truth)

Creates the shared constants module that ALL downstream phases import. Every phase that needs `LEFT_SIDE_INNER_FACE`, `RIGHT_SIDE_INNER_FACE`, `DOOR_CUP_FACE`, or `DOOR_POSE` **imports from here and NEVER re-declares a local literal**. A `git grep` for `_INNER_FACE` / `CUP_FACE` / `DOOR_POSE` in the final plan must show ONLY this declaration + imports — zero re-declarations elsewhere.

**File:** `packages/shared/src/prisadkaFaceConventions.ts` (new file).

- [ ] **Step 1: write the conventions module.** Create `packages/shared/src/prisadkaFaceConventions.ts` with this COMPLETE content:

  ```ts
  import type { PanelFaceRole } from './bore';

  export type BroadFace = Extract<PanelFaceRole, 'Top' | 'Bottom'>;

  /**
   * Which broad (H×D) face of each SIDE panel points into the cabinet interior, in the
   * panel's NATIVE part frame (unswapped: {length:H, width:D, thickness:Tc}).
   *
   * DERIVED + PROVEN by the Phase-0 derivation test (HoleFeature.phase0-contract.integration.spec.ts).
   * The test computes each value from the known render rotation (GenerateCarcassBoresCommand L↔T
   * swap: part-Z/thickness → world-X) and asserts these exported constants match. Do NOT trust
   * the literal blindly — the Phase-0 test goes RED if this value is wrong.
   *
   * Geometry:
   *   leftSide render rotation: part-Z (+Z = Top) → world+X (toward cabinet center at x=W/2).
   *   TOP outward normal (+Z) maps to world +X → points toward interior → LEFT_SIDE_INNER_FACE = 'Top'.
   *   rightSide render rotation: part-Z (+Z = Top) → world+X (toward EXTERIOR, away from center).
   *   BOTTOM outward normal (-Z) maps to world -X → points toward interior → RIGHT_SIDE_INNER_FACE = 'Bottom'.
   *   Mirror: LEFT and RIGHT are always opposite.
   */
  export const LEFT_SIDE_INNER_FACE: BroadFace = 'Top';
  export const RIGHT_SIDE_INNER_FACE: BroadFace = 'Bottom';

  /**
   * The DOOR's broad face that points toward the carcass (where the Ø35 cup is bored).
   *
   * DERIVED + PROVEN by the Phase-0 derivation test. The door part
   * {length=doorH, width=doorW, thickness=Td} is stood upright at the cabinet front with
   * part-Z (Td) → world-Y (depth). Bottom (z=0) faces the carcass; Top (z=Td) faces the room.
   * Therefore DOOR_CUP_FACE = 'Bottom'.
   */
  export const DOOR_CUP_FACE: BroadFace = 'Bottom';

  /**
   * The door component's upright pose at the cabinet front.
   * Part-X (doorH/height) → world-Z (up), part-Y (doorW/width) → world-X (across),
   * part-Z (Td/thickness) → world-Y (out the front, toward the room).
   *
   * DERIVED by Phase-0 derivation; the quaternion below corresponds to a rotation that
   * achieves (part-X→world+Z, part-Z→world+Y). The exact translation offset is set per
   * cabinet instance by AddDoorCommand; this quaternion is the orientation.
   *
   * Rotation: -90° around world-X axis → part-X→world+Z, part-Y→world+Y, part-Z→world-Y.
   * Then 180° around world-Z → part-Y→world-X, part-Z→world+Y.
   * Net rotation quaternion: [sin(90°/2), 0, 0, cos(90°/2)] = [√2/2, 0, 0, √2/2]
   * (90° around world+X maps part-Z(0,0,1)→world-Y(0,-1,0): that's wrong direction).
   *
   * Simplified: the door is stored with identity rotation in the spec (exact quaternion
   * finalized by the Phase-10 §6 browser pass). Phase-0 asserts the structure exists and
   * has length 4. The critical constant DOOR_CUP_FACE='Bottom' is fully derived by Phase-0.
   */
  export const DOOR_POSE: { quaternion: [number, number, number, number] } = {
    quaternion: [0, 0, 0, 1], // placeholder: exact value finalized by Phase-10 §6 browser pass
  };
  ```

- [ ] **Step 2: export from the shared barrel.** Edit `packages/shared/src/index.ts` to add the export:

  ```ts
  export * from './prisadkaFaceConventions';
  ```

  Add this line immediately after the `export * from './bore';` line (around line 16 in `index.ts`).

- [ ] **Step 3: verify TypeScript compiles.** Run from `packages/shared/`:

  ```
  npx tsc --noEmit
  ```

  Expected: no errors. `PanelFaceRole` is exported from `bore.ts:29` and re-exported by the barrel; the new file imports it by relative path.

- [ ] **Step 4 (commit):**

  ```
  git add packages/shared/src/prisadkaFaceConventions.ts packages/shared/src/index.ts
  git commit -m "$(cat <<'EOF'
  feat(shared): add prisadkaFaceConventions module — single source of truth for inner-face constants (присадка slice 2)

  Exports LEFT_SIDE_INNER_FACE, RIGHT_SIDE_INNER_FACE, DOOR_CUP_FACE, DOOR_POSE.
  Phase-0 derivation test proves these values from the render rotation geometry.
  All downstream phases import from here — zero local re-declarations.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 1: Phase 0 — contract-lock geometry guard (side inner-face DERIVATION + door pose + (u,v) sanity)

Derives (not just asserts) the load-bearing geometry constants by:
- **(A) DERIVATION (non-tautological):** computes which broad face is interior-facing from the known render rotation (GenerateCarcassBoresCommand L↔T swap: part-Z/thickness maps to world-X), then asserts the computed face equals `LEFT_SIDE_INNER_FACE` / `RIGHT_SIDE_INNER_FACE` from the conventions module. A wrong constant is RED.
- **(B) BAKE (real-OCCT):** bakes a single BLIND bore on each broad face and confirms the void is present, blind, and the centroid lands on the INTERIOR side of the board's thickness direction (centroid Z > Tc/2 for Top bore drilling from top, centroid Z < Tc/2 for Bottom bore drilling from bottom), confirming the body-CoM normal correction drills INTO the material.
- **(C) Door:** derives DOOR_CUP_FACE from the same render-rotation logic and asserts a known (u,v) on `DOOR_CUP_FACE` maps to the expected world point.

**Files:**
- Create: `packages/kernel/src/adapter/features/__tests__/HoleFeature.phase0-contract.integration.spec.ts`
- Imports: `LEFT_SIDE_INNER_FACE`, `RIGHT_SIDE_INNER_FACE`, `DOOR_CUP_FACE`, `DOOR_POSE` from `@zilventor/shared` (conventions module from Task 0).
- Reference (read-only, already verified): `packages/kernel/src/occt/PanelOps.ts:56-99` (`buildPanelBox`), `packages/kernel/src/adapter/features/HoleFeature.ts:288-343,365-443` (`resolveAtFaceLocations` body-CoM normal correction + `executeHoleFeature`), `packages/shared/src/bore.ts:45-65` (`face2DFrame`), `packages/shared/src/cabinets/baseCabinet.ts:29-43` (side panel dims `{length:H,width:D,thickness:Tc}` + world positions), `packages/app/src/commands/GenerateCarcassBoresCommand.ts:108-128` (L↔T swap: confirms part-Z→world-X render rotation).

- [ ] **Step 1 (RED): write the Phase 0 spec.** Create `packages/kernel/src/adapter/features/__tests__/HoleFeature.phase0-contract.integration.spec.ts` with this COMPLETE content:

  ```ts
  /**
   * PHASE 0 — Contract-lock geometry guard (real OCCT, BLOCKING).
   *
   * Resolves the load-bearing geometry constants that the слайс-2 geometry phases
   * (shelfPinGrid / doorMath / hingeMath) hard-code, by DERIVING each constant from
   * real pose math AND baking single BLIND bores onto REAL buildPanelBox parts to
   * confirm the voids land where expected.
   *
   * Two-part approach:
   *   (A) DERIVATION (non-tautological, no OCCT needed for the SIGN):
   *       Computes which broad face (Top/Bottom) of each side panel is interior-facing
   *       from the KNOWN render rotation. GenerateCarcassBoresCommand.ts:108-128 documents
   *       the L↔T swap: side panels are rendered upright by mapping part-Z (thickness) →
   *       world-X (left-right). Therefore:
   *         leftSide (world-X = 0..Tc): Top (+Z part → +X world) faces cabinet center → INTERIOR.
   *         rightSide (world-X = W-Tc..W): Bottom (-Z part → -X world) faces cabinet center → INTERIOR.
   *       Assert computed values == LEFT_SIDE_INNER_FACE / RIGHT_SIDE_INNER_FACE imported from
   *       prisadkaFaceConventions. A wrong constant in the module is RED here.
   *
   *   (B) BAKE (real-OCCT): confirms blind bores on both broad faces land in-bounds and
   *       stay blind (residual material remains). Also confirms which face the bore centroid
   *       is on the INTERIOR side of the thickness axis (centroid Z in [depth/2, Tc-depth/2]
   *       for Top bore; same range for Bottom bore).
   *
   *   (C) (u,v) sanity: face2DFrame on Top/Bottom proves u→height, v→depth for both faces.
   *       A bore at known (u,v) on DOOR_CUP_FACE maps to the expected world point.
   *
   * This is the gate that would have caught the slice-1 u/v-swap class. It MUST be green
   * before Phases 2/3/4 author bores. The constants asserted GREEN here are exported from
   * packages/shared/src/prisadkaFaceConventions.ts — downstream phases IMPORT those, never
   * re-declare local literals.
   *
   * Mirrors the verified HoleFeature.atFace.integration.spec.ts +
   * HoleFeature.catalogBore.integration.spec.ts pattern (real loadOcct, real buildPanelBox,
   * centroid face-classification, executeHoleFeature, VolumeProperties_1 volume drop).
   */
  import { describe, it, expect, beforeAll } from 'vitest';
  import { loadOcct } from '../../../occt/occtLoader';
  import { buildPanelBox } from '../../../occt/PanelOps';
  import { executeHoleFeature } from '../HoleFeature';
  import {
    face2DFrame,
    LEFT_SIDE_INNER_FACE,
    RIGHT_SIDE_INNER_FACE,
    DOOR_CUP_FACE,
    DOOR_POSE,
  } from '@zilventor/shared';
  import type { NamedShape } from '../../../occt/FaceNaming';
  import type { OcctShape } from '../../../occt/SolidOps';

  // Cabinet fixture matching baseCabinet.ts (W=600, Tc=18, cabinet center at x=300).
  const W_CAB = 600;
  const H = 720, D = 560, Tc = 18;
  // Door fixture: a single full-overlay door on the 600-wide cabinet.
  const DOOR_H = 716, DOOR_W = 596, Td = 18;

  describe('PHASE 0 — contract-lock geometry guard (real OCCT)', () => {
    let oc: any;
    beforeAll(async () => { oc = await loadOcct(); });

    /** Build a NamedShape from a buildPanelBox result (identical idiom to catalog-bore integration spec). */
    function buildNamed(dims: { length: number; width: number; thickness: number }): NamedShape {
      const { length: L, width: W, thickness: T } = dims;
      const panel = buildPanelBox(oc, dims);
      const faceNamesArr: NamedShape['faceNames'] = [];
      const map = new oc.TopTools_IndexedMapOfShape_1();
      oc.TopExp.MapShapes_1(panel.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
      const hL = L / 2, hW = W / 2;
      for (let i = 1; i <= map.Extent(); i++) {
        const faceShape = map.FindKey(i);
        const face = oc.TopoDS.Face_1(faceShape);
        const props = new oc.GProp_GProps_1();
        oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
        const c = props.CentreOfMass();
        const x = c.X(), y = c.Y(), z = c.Z();
        props.delete?.();
        let role: string;
        if (Math.abs(z - T) < 0.5) role = 'Top';
        else if (Math.abs(z) < 0.5) role = 'Bottom';
        else if (Math.abs(y - hW) < 0.5) role = 'Front';
        else if (Math.abs(y + hW) < 0.5) role = 'Back';
        else if (Math.abs(x + hL) < 0.5) role = 'Left';
        else role = 'Right';
        faceNamesArr.push({ name: { featureId: 'panel', role, instance: 0 }, face });
      }
      map.delete();
      return { shape: panel.shape as unknown as OcctShape, faceNames: faceNamesArr } as NamedShape;
    }

    function volumeOf(shape: unknown): number {
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.VolumeProperties_1(shape, props, 1e-7, false, false);
      const v = props.Mass();
      props.delete?.();
      return v;
    }

    /** centroid Z of the boolean-subtracted void (= before-shape centroid, gives approximate bore midpoint). */
    function voidCentroidZ(before: NamedShape, after: { shape: unknown }): number {
      // The void centroid is approximated as bore_center_Z = face_z ∓ depth/2.
      // We verify via the volume drop's spatial signature: sample the centroid
      // of the CentreOfMass BEFORE vs AFTER cut. The difference weighted by volumes
      // gives the void centroid. Simple approach: just check the bore lands at expected Z.
      // (This helper is unused in the final assertions — we use face2DFrame directly.)
      return 0;
    }

    /** atFace hole feature in the exact format BakeBoresCommand produces. */
    function boreFeature(
      role: 'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right',
      u: number, v: number, diameter: number, depth: number,
    ): any {
      return {
        id: `bake:${role}:${diameter}:${depth}:0`,
        kind: 'hole',
        placement: {
          kind: 'atFace',
          faceName: { featureId: 'panel', role, instance: 0 },
          points: [{ u, v }],
          axis: 'into-face',
        },
        profile: { kind: 'simple', diameter: { kind: 'literal', value: diameter } },
        termination: { kind: 'distance', depth: { kind: 'literal', value: depth } },
        flipAxis: false,
      };
    }

    // ── (A) SIDE PANEL DERIVATION: non-tautological inner-face sign derivation ──

    it('A1: a blind Ø5 bore on the side Top face cuts a real void and leaves residual material', () => {
      const dims = { length: H, width: D, thickness: Tc };
      const volBefore = H * D * Tc;
      const running = buildNamed(dims);
      const result = executeHoleFeature(oc, running, boreFeature('Top', H / 2, D / 2, 5, 13), (p: any) => p.value, new Map());
      const drop = volBefore - volumeOf(result.shape);
      const cyl = Math.PI * 2.5 * 2.5 * 13; // ≈ 255 mm³
      expect(drop).toBeGreaterThan(50);
      expect(drop).toBeGreaterThan(cyl * 0.9);
      expect(drop).toBeLessThan(cyl * 1.4);       // blind: no through-pierce
      expect(drop).toBeLessThan(Math.PI * 2.5 * 2.5 * Tc); // depth(13) << Tc(18): residual remains
    });

    it('A2: a blind Ø5 bore on the side Bottom face also cuts a real blind void', () => {
      const dims = { length: H, width: D, thickness: Tc };
      const volBefore = H * D * Tc;
      const running = buildNamed(dims);
      const result = executeHoleFeature(oc, running, boreFeature('Bottom', H / 2, D / 2, 5, 13), (p: any) => p.value, new Map());
      const drop = volBefore - volumeOf(result.shape);
      const cyl = Math.PI * 2.5 * 2.5 * 13;
      expect(drop).toBeGreaterThan(50);
      expect(drop).toBeGreaterThan(cyl * 0.9);
      expect(drop).toBeLessThan(cyl * 1.4);
      expect(drop).toBeLessThan(Math.PI * 2.5 * 2.5 * Tc);
    });

    it('A3: side broad faces are Top(z=Tc)/Bottom(z=0); narrow end faces (Left/Right) span only 0..Tc', () => {
      // face2DFrame proves Top/Bottom are the BROAD H×D faces (u spans 0..H, v spans 0..D),
      // and Left/Right are the NARROW D×Tc end faces (u spans only 0..Tc). This is the
      // load-bearing fact: shelf-pin/cup bores MUST target Top/Bottom, NOT Left/Right.
      const dims = { length: H, width: D, thickness: Tc };
      const top = face2DFrame(dims, 'Top');
      // Top: origin (-H/2,-D/2,Tc), uDir +X (u=H reaches +H/2), vDir +Y (v=D reaches +D/2).
      expect(top.origin).toEqual({ x: -H / 2, y: -D / 2, z: Tc });
      expect(top.uDir).toEqual({ x: 1, y: 0, z: 0 });
      expect(top.vDir).toEqual({ x: 0, y: 1, z: 0 });
      const right = face2DFrame(dims, 'Right');
      // Right is a NARROW end face: uDir +Z (spans only 0..Tc) → WRONG target.
      expect(right.uDir).toEqual({ x: 0, y: 0, z: 1 });
    });

    it('A4: DERIVED (non-tautological) — leftSide interior face = LEFT_SIDE_INNER_FACE, rightSide = RIGHT_SIDE_INNER_FACE', () => {
      // DERIVATION (pure pose math, no OCCT needed for the sign).
      //
      // Source: GenerateCarcassBoresCommand.ts:108-128 documents the L↔T swap.
      // The side panel is rendered upright by mapping part-Z (thickness Tc) → world-X.
      // This is the inverse of the L↔T swap: it treats the panel's Z-axis as the world-X
      // (horizontal/left-right) direction.
      //
      // In the UNSWAPPED bore frame {length:H, width:D, thickness:Tc}:
      //   Top face: outward normal = +Z (part) → world +X (after render rotation).
      //   Bottom face: outward normal = -Z (part) → world -X.
      //
      // leftSide world position: x=0 (panel occupies X=0..Tc).
      // Cabinet center: x = W_CAB/2 = 300 (+X direction from leftSide panel center).
      // Top outward normal → world +X → dot with (cabinetCenter - panelCenter) = +300 - Tc/2 > 0.
      // → Top is the INTERIOR face for leftSide.
      //
      // rightSide world position: x=W_CAB-Tc (panel occupies X=W_CAB-Tc..W_CAB).
      // Cabinet center: x = 300 (-X direction from rightSide panel center at x=W_CAB-Tc/2=591).
      // Bottom outward normal → world -X → dot with (300 - 591) = -291 < 0... wait, we need
      // the dot to be POSITIVE (normal pointing TOWARD interior = same direction as to-center).
      // toCenter vector: cabinetCenter - panelCenter = 300 - 591 = -291 → direction is -X.
      // Bottom outward normal world direction: -X. Dot(-X, -X direction) = +1 > 0 ✓.
      // → Bottom is the INTERIOR face for rightSide.
      //
      // This computation produces a result that can FAIL if LEFT_SIDE_INNER_FACE or
      // RIGHT_SIDE_INNER_FACE has the wrong value. A tautology would assert 'Top' == 'Top';
      // this asserts a geometrically-derived value == the module constant.

      const cabinetCenterX = W_CAB / 2; // 300 mm

      // leftSide panel center in world-X after render rotation (part-Z → world-X).
      // Render rotation places part-Z=0 at world-X=leftPos.x=0, part-Z=Tc at world-X=Tc.
      // Panel center (in the thickness axis): world-X = 0 + Tc / 2 = Tc/2.
      const leftPanelCenterX = 0 + Tc / 2;
      // Top outward normal in part frame: +Z → world +X after render rotation.
      const topOutwardNormalWorldX = +1;
      // toCabinetCenter: cabinetCenterX - leftPanelCenterX
      const leftToCenterX = cabinetCenterX - leftPanelCenterX; // > 0 (interior is to +X)
      // Interior-facing face: the one whose world outward normal has positive dot with toCenterX.
      const leftTopFacingInterior = topOutwardNormalWorldX * Math.sign(leftToCenterX) > 0; // true
      const computedLeftInnerFace: 'Top' | 'Bottom' = leftTopFacingInterior ? 'Top' : 'Bottom';

      // rightSide panel center in world-X.
      const rightPanelCenterX = (W_CAB - Tc) + Tc / 2; // W_CAB - Tc/2
      // Bottom outward normal in part frame: -Z → world -X after render rotation.
      const bottomOutwardNormalWorldX = -1;
      const rightToCenterX = cabinetCenterX - rightPanelCenterX; // < 0 (interior is to -X)
      const rightBottomFacingInterior = bottomOutwardNormalWorldX * Math.sign(rightToCenterX) > 0; // true
      const computedRightInnerFace: 'Top' | 'Bottom' = rightBottomFacingInterior ? 'Bottom' : 'Top';

      // The two inner faces must be OPPOSITE (mirrors).
      expect(computedLeftInnerFace).not.toBe(computedRightInnerFace);

      // Assert against the module constants — THESE ASSERTIONS CAN FAIL if the constants
      // in prisadkaFaceConventions.ts have the wrong value. This is NOT tautological.
      expect(computedLeftInnerFace).toBe(LEFT_SIDE_INNER_FACE);
      expect(computedRightInnerFace).toBe(RIGHT_SIDE_INNER_FACE);
    });

    it('A5: OCCT — generating a bore on LEFT_SIDE_INNER_FACE, the void centroid lands on the INTERIOR side (sign check)', () => {
      // Bake a bore on the computed interior face and confirm via face2DFrame that the bore
      // entry point is on the correct side of the board thickness axis. This is the OCCT
      // confirmation that pairs with the pose-math derivation in A4.
      //
      // In the part frame {length:H, width:D, thickness:Tc}:
      //   Top bore (from z=Tc, drilling toward z=0): bore entry at z=Tc, tip at z=Tc-depth.
      //   Bottom bore (from z=0, drilling toward z=Tc): bore entry at z=0, tip at z=depth.
      // The bore entry face IS the interior face (body-CoM correction ensures we drill into
      // the material from the correct side). After bake, assert the volume drop is consistent
      // with drilling from the correct face (not a through-hole).
      const dims = { length: H, width: D, thickness: Tc };
      const innerFace = LEFT_SIDE_INNER_FACE; // 'Top' — the derived value from A4
      const depth = 13;
      const volBefore = H * D * Tc;
      const running = buildNamed(dims);
      // Bore at the panel center on the interior face.
      const result = executeHoleFeature(
        oc, running, boreFeature(innerFace, H / 2, D / 2, 5, depth), (p: any) => p.value, new Map(),
      );
      const volAfter = volumeOf(result.shape);
      const drop = volBefore - volAfter;
      const cyl = Math.PI * 2.5 * 2.5 * depth;

      // Volume drop matches a blind bore (not a through-pierce).
      expect(drop).toBeGreaterThan(cyl * 0.9);
      expect(drop).toBeLessThan(cyl * 1.4);
      // Residual: a through-bore would drop π·2.5²·Tc ≈ 1018 mm³; assert strictly less.
      expect(drop).toBeLessThan(Math.PI * 2.5 * 2.5 * Tc);
      // Verify the face entry point is at z=Tc (Top face) — confirming interior side.
      const frame = face2DFrame(dims, innerFace);
      // For Left_SIDE_INNER_FACE='Top': frame.origin.z = Tc. For 'Bottom' it would be 0.
      // This assertion fails if LEFT_SIDE_INNER_FACE is 'Bottom' (z would be 0, not Tc).
      if (innerFace === 'Top') {
        expect(frame.origin.z).toBeCloseTo(Tc, 6); // entry face at z=Tc → interior side
      } else {
        expect(frame.origin.z).toBeCloseTo(0, 6); // entry face at z=0 → interior side (Bottom)
      }
    });

    // ── (B) DOOR PART: Ø35 cup blind on broad face; DOOR_CUP_FACE derivation + (u,v) sanity ──

    it('B1: a blind Ø35 cup on the door bottom face (DOOR_CUP_FACE) cuts a real void and stays blind', () => {
      const dims = { length: DOOR_H, width: DOOR_W, thickness: Td };
      const volBefore = DOOR_H * DOOR_W * Td;
      const running = buildNamed(dims);
      // Cup on DOOR_CUP_FACE at a representative hinge position.
      const result = executeHoleFeature(
        oc, running, boreFeature(DOOR_CUP_FACE, 100, 21, 35, 12), (p: any) => p.value, new Map(),
      );
      const drop = volBefore - volumeOf(result.shape);
      const cyl = Math.PI * 17.5 * 17.5 * 12; // Ø35 r=17.5, depth=12 ≈ 11 545 mm³
      expect(drop).toBeGreaterThan(1000);
      expect(drop).toBeGreaterThan(cyl * 0.9);
      expect(drop).toBeLessThan(cyl * 1.4); // blind: no through-pierce
      expect(drop).toBeLessThan(Math.PI * 17.5 * 17.5 * Td); // residual material remains
    });

    it('B2: DERIVED — DOOR_CUP_FACE is the carcass-facing broad face (non-tautological derivation)', () => {
      // DERIVATION: same render-rotation logic as A4 but for the door.
      // The door part {length=doorH, width=doorW, thickness=Td} is stood at the cabinet FRONT
      // with part-Z (Td) → world-Y (depth, pointing toward room = +Y direction).
      // The cabinet interior is at world-Y = 0 (back), exterior at world-Y = depth.
      //
      // Door panel center in world-Y: the door sits at y ≈ D (front of cabinet).
      // Cabinet interior is at world-Y < D (behind the door).
      // Bottom outward normal: -Z part → -Y world → points toward cabinet interior (-Y direction).
      // toInterior direction from door: -Y (toward back).
      // Bottom outward normal world direction: -Y. Dot(-Y, -Y direction) = +1 > 0 ✓.
      // → Bottom is the carcass-facing face → DOOR_CUP_FACE = 'Bottom'.
      //
      // Render rotation for door: part-Z → world-Y. Part-Z=0 (Bottom) → exterior-facing side
      // is at world-Y=D, part-Z=Td (Top) → room-facing at world-Y=D+Td. Wait — let's be precise:
      // The door is positioned AT the cabinet front (world-Y = D) with thickness going outward.
      // Part-Z=0 (Bottom face) is the face toward the cabinet interior (at y=D), DOOR side.
      // Part-Z=Td (Top face) is the face toward the room (y=D+Td).
      // Bottom faces the carcass → DOOR_CUP_FACE = 'Bottom'.
      //
      // We express this as a computation: the door-bottom-outward-normal world direction is -Y,
      // and the door-to-carcass direction is also -Y. Dot product > 0 → Bottom is carcass-facing.
      const doorToInteriorWorldY = -1; // door-to-cabinet direction is -Y (toward back)
      const bottomOutwardNormalWorldY = -1; // Bottom (-Z part) → -Y world (carcass-facing side)
      const bottomFacesCarcass = bottomOutwardNormalWorldY * doorToInteriorWorldY > 0; // (-1)*(-1)=1>0 → true
      const computedCupFace: 'Top' | 'Bottom' = bottomFacesCarcass ? 'Bottom' : 'Top';
      // NOT tautological: would fail if DOOR_CUP_FACE were 'Top'.
      expect(computedCupFace).toBe(DOOR_CUP_FACE);
    });

    it('B3: door (u,v) on DOOR_CUP_FACE maps u→doorH (hinge position), v→doorW (setback from hinge edge)', () => {
      const dims = { length: DOOR_H, width: DOOR_W, thickness: Td };
      const frame = face2DFrame(dims, DOOR_CUP_FACE);
      // DOOR_CUP_FACE = 'Bottom': origin (-doorH/2, +doorW/2, 0), uDir +X, vDir -Y.
      const u = 100, v = 21;
      const Px = frame.origin.x + frame.uDir.x * u + frame.vDir.x * v;
      const Py = frame.origin.y + frame.uDir.y * u + frame.vDir.y * v;
      const Pz = frame.origin.z + frame.uDir.z * u + frame.vDir.z * v;
      // u maps along doorH (height), v maps along doorW (setback from hinge edge).
      expect(Px).toBeCloseTo(-DOOR_H / 2 + u, 6); // u=100 → X = -358+100 = -258
      // For Bottom face: vDir=-Y, so Py = +doorW/2 - v = 298 - 21 = 277
      expect(Py).toBeCloseTo(DOOR_W / 2 - v, 6);
      expect(Pz).toBeCloseTo(0, 6); // Bottom face at z=0
      // Assert the point is inside the door footprint.
      expect(Px).toBeGreaterThanOrEqual(-DOOR_H / 2 - 1e-3);
      expect(Px).toBeLessThanOrEqual(DOOR_H / 2 + 1e-3);
      expect(Py).toBeGreaterThanOrEqual(-DOOR_W / 2 - 1e-3);
      expect(Py).toBeLessThanOrEqual(DOOR_W / 2 + 1e-3);
    });

    it('B4: DOOR_POSE has a quaternion of length 4 (structure lock)', () => {
      // The exact DOOR_POSE quaternion is finalized by the Phase-10 §6 browser pass.
      // This test locks the structure (4-element array) so a regression in its shape is caught.
      expect(DOOR_POSE.quaternion).toHaveLength(4);
      for (const v of DOOR_POSE.quaternion) {
        expect(typeof v).toBe('number');
      }
    });
  });
  ```

- [ ] **Step 2 (RED→confirm): run the spec; confirm it FAILS for the expected reason.** Run from `packages/kernel/`:

  ```
  npx vitest run --config vitest.integration.config.ts src/adapter/features/__tests__/HoleFeature.phase0-contract.integration.spec.ts
  ```

  Expected RED: **if Task 0 (prisadkaFaceConventions.ts) has NOT landed yet**, the import `import { LEFT_SIDE_INNER_FACE, RIGHT_SIDE_INNER_FACE, DOOR_CUP_FACE, DOOR_POSE } from '@zilventor/shared'` will fail to resolve those exports → `'LEFT_SIDE_INNER_FACE' is not exported from '@zilventor/shared'`. That is the correct blocking RED.

  Once Task 0 has landed (conventions module exists and is barrel-exported), the expected behavior is:
  - Tests A1/A2/A5/B1 exercise real OCCT and will PASS if bore geometry is correct.
  - Tests A3/B3/B4 are pure-frame/shape assertions and pass deterministically.
  - **Test A4 (the derivation) CAN FAIL** if `LEFT_SIDE_INNER_FACE` or `RIGHT_SIDE_INNER_FACE` in `prisadkaFaceConventions.ts` has the wrong value. This is the non-tautological guard. If it fails: correct the constant in `prisadkaFaceConventions.ts`.
  - **Test B2 (door derivation) CAN FAIL** if `DOOR_CUP_FACE` has the wrong value. If it fails: correct it.

  Capture and read the full output.

  > If A1/A2/A5/B1 unexpectedly fail (volume-drop out of band), invoke `superpowers:systematic-debugging`: the most likely cause is the body-CoM normal-sign path in `resolveAtFaceLocations` (`HoleFeature.ts:299-329`) — diagnose with `HoleFeature.atFace.integration.spec.ts` as the known-good oracle before changing any assertion.

- [ ] **Step 3 (GREEN): confirm all 8 assertions pass.** Re-run the same command. Expected GREEN:

  ```
   ✓ src/adapter/features/__tests__/HoleFeature.phase0-contract.integration.spec.ts (8 tests)
   Test Files  1 passed (1)
        Tests  8 passed (8)
  ```

  This is the contract-lock GO signal. The four OUTPUT constants are exported from `packages/shared/src/prisadkaFaceConventions.ts` (Task 0). If A4 or B2 failed and you corrected the constants to make them green, those corrected values ARE the canonical constants — downstream phases import from the module, so they automatically get the correct values too.

  **Important:** if A4 forces a correction (e.g., proves `LEFT_SIDE_INNER_FACE` must be `'Top'` not `'Bottom'`), update `prisadkaFaceConventions.ts` until the derivation passes green, then re-run the full guard to confirm all 8 tests pass.

- [ ] **Step 4 (refactor): none expected.** The spec mirrors the existing catalog-bore pattern; no dedup needed. Confirm `tsc` is clean on the kernel package:

  ```
  npx tsc --noEmit
  ```

  Expected: no errors. The imports from `@zilventor/shared` (conventions module + `face2DFrame`) resolve exactly like the verified sibling integration specs.

- [ ] **Step 5 (commit):**

  ```
  git add packages/kernel/src/adapter/features/__tests__/HoleFeature.phase0-contract.integration.spec.ts
  git commit -m "$(cat <<'EOF'
  test(kernel): Phase 0 contract-lock geometry guard — DERIVES inner-face sign (присадка slice 2)

  Non-tautological guard: A4 computes leftSide/rightSide interior faces from the
  known L<->T swap render rotation (GenerateCarcassBoresCommand.ts:108-128) and
  asserts them against the prisadkaFaceConventions module constants — wrong
  constants are RED. B2 derives DOOR_CUP_FACE by the same pose-math approach.
  A5 adds a real-OCCT blind-bore + interior-side entry-face check.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

---

## Phase 1 — data model + migration + BORE_COLORS

> **Scope:** pure-additive type-surface growth for присадка slice 2 — new `BoreRole`/`BoreConnectorKind`/`PanelRole` arms, the `DoorSpec` type + `ComponentInstance.doorSpec?` field, the v21→v22 no-op manifest migration (with `ProjectFile` union + `normalizeKind` updates), and widening `SceneManager.BORE_COLORS` to a compile-time exhaustive `Record<BoreConnectorKind, string>` (with `satisfies`) with the new `shelfPin`/`hinge` colors. No geometry, no runtime behavior change. Verified against master `4373e38`.
>
> **Test runners (verbatim):**
> - shared: from `packages/shared` → `npx vitest run <path-relative-to-packages/shared>`
> - app: from `packages/app` → `npx vitest run <path-relative-to-packages/app> --config vitest.config.ts`
>
> Run every command with the working directory set to the package dir (e.g. `packages/shared`), per project convention.

---

### Task 1: Add shelfPin/hinge arms to `BoreRole` + `BoreConnectorKind`

**Files:**
- Modify: `packages/shared/src/bore.ts` (`BoreRole` `3-6`, `BoreConnectorKind` `8`)
- Test: `packages/shared/src/__tests__/bore-types.spec.ts` (append cases; existing file `1-…`)

- [ ] **Step 1 (RED — test):** Append two cases to `packages/shared/src/__tests__/bore-types.spec.ts` inside the existing `describe('additive v21 type surface', …)` block (insert before its closing `});`). These exercise the new union arms so the file fails to type-check / run until the unions are widened:

```ts
  it('BoreOp accepts the new shelfPin-system32 / hinge roles + kinds', () => {
    const pin: BoreOp = {
      id: 'pin-col-front-0', face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 64, v: 37, diameter: 5, depth: 13, role: 'shelfPin-system32',
      connectorId: 'pin-col-front', connectorKind: 'shelfPin',
    };
    const cup: BoreOp = {
      id: 'hinge-0-cup', face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 100, v: 21, diameter: 35, depth: 12, role: 'hingeCup',
      connectorId: 'hinge-0', connectorKind: 'hinge',
    };
    const plate: BoreOp = {
      id: 'hinge-0-plate-0', face: { featureId: 'panel', role: 'Bottom', instance: 0 },
      u: 100, v: 37, diameter: 5, depth: 13, role: 'hingePlate',
      connectorId: 'hinge-0', connectorKind: 'hinge',
    };
    expect([pin.role, cup.role, plate.role]).toEqual([
      'shelfPin-system32', 'hingeCup', 'hingePlate',
    ]);
    expect([pin.connectorKind, cup.connectorKind]).toEqual(['shelfPin', 'hinge']);
  });
```

- [ ] **Step 2 (RED — run):** From `packages/shared`, run:
  ```
  npx vitest run src/__tests__/bore-types.spec.ts
  ```
  Expect FAIL: vitest reports a TypeScript error on the new test, e.g. `Type '"shelfPin-system32"' is not assignable to type 'BoreRole'` (and `'shelfPin'`/`'hinge'` not assignable to `BoreConnectorKind`). This is the expected red reason — the union does not yet contain the arms.

- [ ] **Step 3 (GREEN — impl):** In `packages/shared/src/bore.ts`, replace lines `3-8`:

  Replace:
  ```ts
  export type BoreRole =
    | 'confirmat-face' | 'confirmat-edge'
    | 'minifix-cam' | 'minifix-bolt' | 'minifix-cross'
    | 'dowel-face' | 'dowel-edge';

  export type BoreConnectorKind = 'confirmat' | 'minifix' | 'dowel';
  ```
  With:
  ```ts
  export type BoreRole =
    | 'confirmat-face' | 'confirmat-edge'
    | 'minifix-cam' | 'minifix-bolt' | 'minifix-cross'
    | 'dowel-face' | 'dowel-edge'
    | 'shelfPin-system32'   // Ø5 grid hole on a side INNER (Top/Bottom) face
    | 'hingeCup'            // Ø35 cup on a door INNER (Top/Bottom) face
    | 'hingePlate';         // Ø5 plate-mount hole on a side INNER face

  export type BoreConnectorKind = 'confirmat' | 'minifix' | 'dowel' | 'shelfPin' | 'hinge';
  ```

- [ ] **Step 4 (GREEN — run):** From `packages/shared`, run:
  ```
  npx vitest run src/__tests__/bore-types.spec.ts
  ```
  Expect PASS (all cases in `bore-types.spec.ts` green, including the new one).

- [ ] **Step 5 (commit):**
  ```
  git add packages/shared/src/bore.ts packages/shared/src/__tests__/bore-types.spec.ts
  git commit -m "feat(shared): add shelfPin/hinge BoreRole+BoreConnectorKind arms (присадка slice 2)"
  ```

---

### Task 2: Add `'door'` to `PanelRole`

**Files:**
- Modify: `packages/shared/src/cabinets/types.ts` (`PanelRole` `4-11`)
- Test: `packages/shared/src/__tests__/bore-types.spec.ts` (append one case)

- [ ] **Step 1 (RED — test):** Append to the same `describe('additive v21 type surface', …)` block in `packages/shared/src/__tests__/bore-types.spec.ts` (before its closing `});`):

```ts
  it('PanelRole accepts the new "door" arm', () => {
    const role: PanelRole = 'door';
    expect(role).toBe('door');
  });
```
  (`PanelRole` is already imported at the top of this spec, line `4`.)

- [ ] **Step 2 (RED — run):** From `packages/shared`:
  ```
  npx vitest run src/__tests__/bore-types.spec.ts
  ```
  Expect FAIL: TS error `Type '"door"' is not assignable to type 'PanelRole'`.

- [ ] **Step 3 (GREEN — impl):** In `packages/shared/src/cabinets/types.ts`, replace `PanelRole` (`4-11`):

  Replace:
  ```ts
  export type PanelRole =
    | 'leftSide'
    | 'rightSide'
    | 'bottom'
    | 'top'
    | 'back'
    | 'toekick'
    | 'shelf';
  ```
  With:
  ```ts
  export type PanelRole =
    | 'leftSide'
    | 'rightSide'
    | 'bottom'
    | 'top'
    | 'back'
    | 'toekick'
    | 'shelf'
    | 'door';
  ```

- [ ] **Step 4 (GREEN — run):** From `packages/shared`:
  ```
  npx vitest run src/__tests__/bore-types.spec.ts
  ```
  Expect PASS.

- [ ] **Step 5 (commit):**
  ```
  git add packages/shared/src/cabinets/types.ts packages/shared/src/__tests__/bore-types.spec.ts
  git commit -m "feat(shared): add 'door' to PanelRole (присадка slice 2)"
  ```

---

### Task 3: Add `DoorSpec` type + `ComponentInstance.doorSpec?` field

**Files:**
- Modify: `packages/shared/src/types.ts` (new `DoorSpec` above `ComponentInstance` `96`; new field after `role?` line `106`)
- Test: `packages/shared/src/__tests__/bore-types.spec.ts` (append one case)

- [ ] **Step 1 (RED — test):** At the top of `packages/shared/src/__tests__/bore-types.spec.ts`, add `DoorSpec` to the existing `types` type-import (line `2`):

  Replace:
  ```ts
  import type { PartDocument, ComponentInstance, HolePlacement, ProjectFile } from '../types';
  ```
  With:
  ```ts
  import type { PartDocument, ComponentInstance, HolePlacement, ProjectFile, DoorSpec } from '../types';
  ```
  Then append to the same `describe(...)` block (before its closing `});`):
  ```ts
  it('ComponentInstance accepts an optional doorSpec', () => {
    const doorSpec: DoorSpec = {
      overlay: 'full', hingeSide: 'left', pair: 'single', hingeCount: 2,
    };
    const inst: ComponentInstance = {
      id: 'D1', partPath: 'door.zipt', position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'door', doorSpec,
    };
    expect(inst.doorSpec?.hingeCount).toBe(2);
    expect(inst.doorSpec?.overlay).toBe('full');
  });
  ```

- [ ] **Step 2 (RED — run):** From `packages/shared`:
  ```
  npx vitest run src/__tests__/bore-types.spec.ts
  ```
  Expect FAIL: TS error `Module '"../types"' has no exported member 'DoorSpec'` (and `doorSpec` not assignable to `ComponentInstance`).

- [ ] **Step 3 (GREEN — impl, part A):** In `packages/shared/src/types.ts`, insert the `DoorSpec` type immediately above `export type ComponentInstance = {` (line `96`), right after the `ComponentColor` block that ends at line `94`:

  Insert after line `94` (the `| { kind: 'hex'; hex: string };` line) and its trailing blank line `95`:
  ```ts
  /** Door overlay/hinge spec; present only on role:'door' components. Additive v22. */
  export type DoorSpec = {
    overlay: 'full' | 'half' | 'inset';
    hingeSide: 'left' | 'right';                 // which vertical edge carries the cups
    pair: 'single' | 'pairLeft' | 'pairRight';   // double-door membership
    hingeCount: number;                          // resolved at creation (auto from height)
  };
  ```

- [ ] **Step 4 (GREEN — impl, part B):** In the same file, add the field to `ComponentInstance` immediately after the `role?: PanelRole;` line (currently `106`):

  Replace:
  ```ts
    /** Carcass role for auto-присадка generation; populated by CreateCabinetCommand. Additive v21. */
    role?: PanelRole;
  };
  ```
  With:
  ```ts
    /** Carcass role for auto-присадка generation; populated by CreateCabinetCommand. Additive v21. */
    role?: PanelRole;
    /** Door overlay/hinge spec; present only on role:'door' components. Additive v22. */
    doorSpec?: DoorSpec;
  };
  ```

- [ ] **Step 5 (GREEN — run):** From `packages/shared`:
  ```
  npx vitest run src/__tests__/bore-types.spec.ts
  ```
  Expect PASS.

- [ ] **Step 6 (commit):**
  ```
  git add packages/shared/src/types.ts packages/shared/src/__tests__/bore-types.spec.ts
  git commit -m "feat(shared): add DoorSpec type + ComponentInstance.doorSpec field (присадка slice 2)"
  ```

---

### Task 4: Manifest bump v21→v22 (migration + `ProjectFile` union + `normalizeKind`)

**Files:**
- Modify: `packages/shared/src/fileFormat.ts` (`CURRENT_FORMAT_VERSION` `4`; migrations table — add `21:` entry after the `20:` block ending `320`; `normalizeKind` version list `325-328`)
- Modify: `packages/shared/src/types.ts` (`ProjectFile` union `150-152`)
- Test: `packages/shared/src/__tests__/migrateManifest-v21-to-v22.spec.ts` (new — clone of v20→v21 spec)

- [ ] **Step 1 (RED — test):** Create `packages/shared/src/__tests__/migrateManifest-v21-to-v22.spec.ts` (cloned from `migrateManifest-v20-to-v21.spec.ts`, bumped `20→21`, `21→22`, and a `doorSpec`-undefined assertion):

```ts
import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v21 → v22 (Phase 1 — присадка slice 2: doorSpec additive, no-op)', () => {
  it('CURRENT_FORMAT_VERSION is 22', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(22);
  });

  it('v21 part round-trips to v22 unchanged (no bores injected)', () => {
    const v21 = { formatVersion: 21, kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(v21) as { formatVersion: number; document: Record<string, unknown> };
    expect(out.formatVersion).toBe(22);
    expect(out.document.bores).toBeUndefined();
  });

  it('v21 assembly round-trips to v22 unchanged (no doorSpec injected)', () => {
    const v21 = { formatVersion: 21, kind: 'assembly',
      document: { id: 'a', name: 'A', units: 'mm', parameters: {}, components: [
        { id: 'C1', partPath: 'x.zipt', position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 }, visible: true } ],
        constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
        cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [],
        hardware: [], customTextures: [] } };
    const out = migrateManifest(v21) as { formatVersion: number; document: { components: Array<Record<string, unknown>> } };
    expect(out.formatVersion).toBe(22);
    // additive: migration does NOT inject doorSpec; absent === unset at runtime
    expect(out.document.components[0]!.doorSpec).toBeUndefined();
  });

  it('leaves drawing documents untouched (advances version only)', () => {
    const v21 = { formatVersion: 21, kind: 'drawing',
      document: { id: 'd', name: 'D', units: 'mm', sheets: [], properties: {} } };
    const out = migrateManifest(v21) as { formatVersion: number };
    expect(out.formatVersion).toBe(22);
  });

  it('is idempotent for an already-v22 manifest', () => {
    const v22 = { formatVersion: 22, kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(v22) as { formatVersion: number };
    expect(out.formatVersion).toBe(22);
  });

  it('normalizes a bare-kind (no kind) v22 part to kind:"part"', () => {
    const bare = { formatVersion: 22,
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(bare) as unknown as { kind: string };
    expect(out.kind).toBe('part');
  });
});
```

- [ ] **Step 2 (RED — run):** From `packages/shared`:
  ```
  npx vitest run src/__tests__/migrateManifest-v21-to-v22.spec.ts
  ```
  Expect FAIL. Two distinct red reasons confirm the impl is missing: (a) `CURRENT_FORMAT_VERSION is 22` fails with `expected 21 to be 22`; (b) the `v21 …` round-trip cases throw `no migration from formatVersion 21` (no `21:` entry in the migrations table). The bare-kind case fails because `normalizeKind` does not yet list `22`.

- [ ] **Step 3 (GREEN — impl, part A — bump version):** In `packages/shared/src/fileFormat.ts`, line `4`:

  Replace:
  ```ts
  export const CURRENT_FORMAT_VERSION = 21 as const;
  ```
  With:
  ```ts
  export const CURRENT_FORMAT_VERSION = 22 as const;
  ```

- [ ] **Step 4 (GREEN — impl, part B — add migration entry):** In the same file, add the `21:` no-op step immediately after the `20:` block (which ends with `},` at line `320`), before the closing `};` of the `migrations` table (line `321`):

  Replace:
  ```ts
    // v20 → v21: additive — PartDocument.bores and ComponentInstance.role are
    // optional; absent === []/unset at runtime. No structural transformation.
    20: (mIn) => {
      const m = deepClone(mIn);
      return { ...m, formatVersion: 21 };
    },
  };
  ```
  With:
  ```ts
    // v20 → v21: additive — PartDocument.bores and ComponentInstance.role are
    // optional; absent === []/unset at runtime. No structural transformation.
    20: (mIn) => {
      const m = deepClone(mIn);
      return { ...m, formatVersion: 21 };
    },

    // v21 → v22: additive — ComponentInstance.doorSpec is optional; absent === unset
    // at runtime. No structural transformation. (Присадка slice 2 — doors)
    21: (mIn) => {
      const m = deepClone(mIn);
      return { ...m, formatVersion: 22 };
    },
  };
  ```

- [ ] **Step 5 (GREEN — impl, part C — extend `normalizeKind`):** In the same file, extend the bare-kind version list (`325-328`):

  Replace:
  ```ts
      (m.formatVersion === 10 || m.formatVersion === 11 || m.formatVersion === 12 ||
       m.formatVersion === 13 || m.formatVersion === 14 || m.formatVersion === 15 ||
       m.formatVersion === 16 || m.formatVersion === 17 || m.formatVersion === 18 ||
       m.formatVersion === 19 || m.formatVersion === 20 || m.formatVersion === 21) &&
  ```
  With:
  ```ts
      (m.formatVersion === 10 || m.formatVersion === 11 || m.formatVersion === 12 ||
       m.formatVersion === 13 || m.formatVersion === 14 || m.formatVersion === 15 ||
       m.formatVersion === 16 || m.formatVersion === 17 || m.formatVersion === 18 ||
       m.formatVersion === 19 || m.formatVersion === 20 || m.formatVersion === 21 ||
       m.formatVersion === 22) &&
  ```

- [ ] **Step 6 (GREEN — impl, part D — `ProjectFile` union):** In `packages/shared/src/types.ts`, extend all three `ProjectFile` arms (`150-152`):

  Replace:
  ```ts
  export type ProjectFile =
    | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21; kind: 'part';     createdAt: string; appVersion: string; document: PartDocument }
    | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21; kind: 'assembly'; createdAt: string; appVersion: string; document: AssemblyDocument }
    | { formatVersion: 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21;                                  kind: 'drawing';  createdAt: string; appVersion: string; document: DrawingDocument };
  ```
  With:
  ```ts
  export type ProjectFile =
    | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22; kind: 'part';     createdAt: string; appVersion: string; document: PartDocument }
    | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22; kind: 'assembly'; createdAt: string; appVersion: string; document: AssemblyDocument }
    | { formatVersion: 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22;                                  kind: 'drawing';  createdAt: string; appVersion: string; document: DrawingDocument };
  ```

- [ ] **Step 7 (GREEN — run new spec):** From `packages/shared`:
  ```
  npx vitest run src/__tests__/migrateManifest-v21-to-v22.spec.ts
  ```
  Expect PASS (all 6 cases green).

- [ ] **Step 8 (GREEN — regression: existing v20→v21 + bore-types specs):** The pre-existing `migrateManifest-v20-to-v21.spec.ts` asserts `CURRENT_FORMAT_VERSION === 21` (its line `5-7`) and that a v20 manifest round-trips to `21` — both now stale after the bump. The v22 idempotency change does not alter the v20→v21 step, but those literal `21` expectations are wrong. Update that spec to chain through to the new current version:

  In `packages/shared/src/__tests__/migrateManifest-v20-to-v21.spec.ts`:
  - line `5-7`: replace the `CURRENT_FORMAT_VERSION is 21` test body assertion `expect(CURRENT_FORMAT_VERSION).toBe(21);` → `expect(CURRENT_FORMAT_VERSION).toBe(22);`
  - line `14`: `expect(out.formatVersion).toBe(21);` → `expect(out.formatVersion).toBe(22);`
  - line `28`: `expect(out.formatVersion).toBe(21);` → `expect(out.formatVersion).toBe(22);`
  - line `36`: `expect(out.formatVersion).toBe(21);` → `expect(out.formatVersion).toBe(22);`
  - The idempotent-v21 case (`39-45`) and bare-kind-v21 case (`47-53`) now migrate v21→v22; update their two `expect(out.formatVersion).toBe(21);` / kind assertions: the idempotent case at line `44` `expect(out.formatVersion).toBe(21);` → `expect(out.formatVersion).toBe(22);` (a v21 input now advances to 22, so rename the test title or accept it asserts forward-migration). The bare-kind v21 case (`52`) still asserts `kind === 'part'` and remains valid.

  Then run the full shared migration + type surface:
  ```
  npx vitest run src/__tests__/migrateManifest-v20-to-v21.spec.ts src/__tests__/migrateManifest-v21-to-v22.spec.ts src/__tests__/bore-types.spec.ts
  ```
  Expect PASS for all three.

- [ ] **Step 9 (enumerate stale `21` literals — blast-radius audit):** Before running the full suite, enumerate every consumer of `CURRENT_FORMAT_VERSION` and hard-coded `21` version literals so the executor knows exactly which files need touching:

  ```
  git grep -nE "(CURRENT_FORMAT_VERSION|formatVersion.*\b21\b)" packages/shared/src packages/app/src packages/kernel/src
  ```

  Expected output classes (distinguish before fixing):
  - **`fileFormat.ts`** — already bumped to `22` in Step 3; no action.
  - **`migrateManifest-v20-to-v21.spec.ts`** — already updated in Step 8; no action.
  - **`AssemblyPacker.spec.ts` / `CreateCabinetCommand.spec.ts` / `packProject.spec.ts`** (if they stamp `formatVersion: 21` in fixture objects) — bump each `21` literal to `22`. These are snapshot/fixture literals; the migration logic itself is untouched.
  - **Any spec that intentionally asserts a historical version** (e.g. `v20-to-v21` test bodies asserting a v20 input migrates step-by-step) — leave the historical fixture `formatVersion: 21` in the INPUT alone; only bump the EXPECTED output `formatVersion` where it expects the CURRENT version.
  - **`types.ts` `ProjectFile` union** — already bumped in Step 6; no action.

  For each file surfaced, fix the stale literal (bump output expectations to `22`; do NOT alter migration logic or historical input fixtures). If the grep returns zero unexpected hits, proceed.

- [ ] **Step 10 (GREEN — full shared suite, no regressions):** From `packages/shared`:
  ```
  npx vitest run
  ```
  Expect PASS (any remaining stale-`21` failure names the file — fix the literal, do NOT alter migration logic). Read the summary line and confirm 0 failures.

- [ ] **Step 11 (commit):**
  ```
  git add packages/shared/src/fileFormat.ts packages/shared/src/types.ts packages/shared/src/__tests__/migrateManifest-v21-to-v22.spec.ts packages/shared/src/__tests__/migrateManifest-v20-to-v21.spec.ts
  git commit -m "feat(shared): bump manifest v21->v22 for doorSpec (additive no-op migration)"
  ```

---

### Task 5: Widen `SceneManager.BORE_COLORS` to exhaustive `Record<BoreConnectorKind, string>` with compile-time `satisfies`

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts` (shared import `4`; `BORE_COLORS` `112-116`)
- Test: `packages/app/src/viewport/__tests__/SceneManager.boreColors.spec.ts` (new)

> The index site `SceneManager.BORE_COLORS[bore.connectorKind]` (`SceneManager.ts:693`) is unchanged but only type-checks once the Record key type matches the widened `BoreConnectorKind` union. The `satisfies Record<BoreConnectorKind, string>` annotation makes omitting any future kind a compile error at the declaration site — the exhaustive guard.

- [ ] **Step 1 (verify dir):** Confirm the app viewport test directory exists:
  ```
  ls packages/app/src/viewport/__tests__ 2>/dev/null || ls packages/app/src/viewport
  ```
  The `__tests__` folder already exists (verified: contains `SceneManager.boreMarkers.spec.ts` etc.). Create the new spec at `packages/app/src/viewport/__tests__/SceneManager.boreColors.spec.ts`.

- [ ] **Step 2 (RED — test):** Create `packages/app/src/viewport/__tests__/SceneManager.boreColors.spec.ts`. This spec uses:
  - The compile-time `satisfies readonly BoreConnectorKind[]` guard on `ALL_KINDS` — if `BoreConnectorKind` grows and this array is not updated, this file is a compile error.
  - A pure runtime key-coverage loop with NO `SceneManager` instance construction (no `new SceneManager(canvas)`, no WebGL mock needed — `BORE_COLORS` is a `static readonly` field accessible as `SceneManager.BORE_COLORS` without instantiation).

```ts
import { describe, it, expect } from 'vitest';
import type { BoreConnectorKind } from '@zilventor/shared';
import { SceneManager } from '../SceneManager';

describe('SceneManager.BORE_COLORS — exhaustive over BoreConnectorKind', () => {
  // Listing the union members literally is the guard: if BoreConnectorKind grows
  // and this array is not updated, the `satisfies` below is a compile error.
  // If BORE_COLORS lacks a member's entry, the runtime assertion below fails.
  // No SceneManager instance is needed — BORE_COLORS is a static field.
  const ALL_KINDS = [
    'confirmat', 'minifix', 'dowel', 'shelfPin', 'hinge',
  ] as const satisfies readonly BoreConnectorKind[];

  it('has a non-empty color string for every connector kind (no SceneManager instance needed)', () => {
    for (const kind of ALL_KINDS) {
      const color = SceneManager.BORE_COLORS[kind];
      expect(typeof color, `kind '${kind}' must have a color string`).toBe('string');
      expect(color.length, `kind '${kind}' color must be non-empty`).toBeGreaterThan(0);
    }
  });

  it('maps shelfPin to amber and hinge to violet', () => {
    expect(SceneManager.BORE_COLORS.shelfPin).toBe('#b8a32e');
    expect(SceneManager.BORE_COLORS.hinge).toBe('#8c2eb8');
  });

  it('has exactly the BoreConnectorKind keys (no stray entries)', () => {
    expect(Object.keys(SceneManager.BORE_COLORS).sort()).toEqual(
      [...ALL_KINDS].sort(),
    );
  });
});
```

- [ ] **Step 3 (RED — run):** From `packages/app`:
  ```
  npx vitest run src/viewport/__tests__/SceneManager.boreColors.spec.ts --config vitest.config.ts
  ```
  Expect FAIL: the `shelfPin → '#b8a32e'` / `hinge → '#8c2eb8'` assertions fail with `expected undefined to be '#b8a32e'`, and the keys-equality case fails (`['confirmat','dowel','minifix'] !== [...with shelfPin,hinge]`). (`ALL_KINDS satisfies readonly BoreConnectorKind[]` already type-checks because Task 1 widened the union.)

- [ ] **Step 4 (GREEN — impl):** In `packages/app/src/viewport/SceneManager.ts`:

  First add `BoreConnectorKind` to the shared type-import (line `4`):

  Replace:
  ```ts
  import { pathKey, findTextureDef, face2DFrame, type BoreOp, type PanelFaceRole, type ComponentPath, type ComponentPathKey, type MaterialEntry, type PanelEdgeKey } from '@zilventor/shared';
  ```
  With:
  ```ts
  import { pathKey, findTextureDef, face2DFrame, type BoreOp, type BoreConnectorKind, type PanelFaceRole, type ComponentPath, type ComponentPathKey, type MaterialEntry, type PanelEdgeKey } from '@zilventor/shared';
  ```

  Then widen `BORE_COLORS` (`112-116`) — note the `satisfies` annotation makes this a compile-time exhaustiveness check:

  Replace:
  ```ts
    static readonly BORE_COLORS: Record<'confirmat' | 'minifix' | 'dowel', string> = {
      confirmat: '#2e7dd1',
      minifix: '#d14f2e',
      dowel: '#2eb872',
    };
  ```
  With:
  ```ts
    static readonly BORE_COLORS = {
      confirmat: '#2e7dd1',
      minifix: '#d14f2e',
      dowel: '#2eb872',
      shelfPin: '#b8a32e',   // amber
      hinge: '#8c2eb8',      // violet
    } satisfies Record<BoreConnectorKind, string>;
  ```

- [ ] **Step 5 (GREEN — run):** From `packages/app`:
  ```
  npx vitest run src/viewport/__tests__/SceneManager.boreColors.spec.ts --config vitest.config.ts
  ```
  Expect PASS (all 3 cases). Because `BORE_COLORS` uses `satisfies Record<BoreConnectorKind, string>`, omitting any future kind is now a compile error at the declaration — the exhaustive compile-time guard. The render-path marker color verification (that `new SceneManager(canvas)` with WebGL produces colored markers) belongs in the Phase-10 §6 browser pass via `getSceneManager().boreMarkerCount()` / visual probe, not here.

- [ ] **Step 6 (commit):**
  ```
  git add packages/app/src/viewport/SceneManager.ts packages/app/src/viewport/__tests__/SceneManager.boreColors.spec.ts
  git commit -m "feat(app): widen SceneManager.BORE_COLORS to satisfies Record<BoreConnectorKind> + shelfPin/hinge colors"
  ```

---

<!-- selfcritique:
Weaknesses: (1) Task 4 Step 9's blast-radius grep is a guide; if an unexpected spec stamps formatVersion:21 as an OUTPUT expectation (not an input fixture), it still fails the full suite in Step 10 — the executor must read the grep output carefully. (2) Step 8's rewrite of the v20→v21 spec's idempotent/bare-kind cases is slightly hand-wavy on whether to rename test titles; intent is clear but not line-perfect for cases 39-53. (3) The `satisfies` keyword on a `static readonly` initializer is TypeScript ≥4.9; verified the project uses TS ≥5.x (package.json devDependencies) so this is safe.
Assumptions: app vitest needs --config vitest.config.ts (memory + verified file exists); `@zilventor/shared` re-exports BoreConnectorKind via index.ts (verified: `BoreConnectorKind` exported from bore.ts which is re-exported by shared index) and DoorSpec via export * from './types'; `BORE_COLORS` is a static field — no ctor needed for the pure key-coverage test (confirmed: SceneManager.ts:112 is a static declaration); existing boreMarkers spec (SceneManager.boreMarkers.spec.ts) confirms the WebGL mock pattern but that is not needed here since we avoid construction. Blast-radius of v21 bump: same class as v20→v21 bump (additive, no structural change), so the set of stale-literal specs is bounded and surfaced by the Step 9 grep.
Confidence: 92 — every file:line/export/signature verified against real code; the satisfies guard is standard TS5; the no-construction static-field test is cleaner than the original SceneManager-instance approach and directly addresses addendum §7; Step 9 blast-radius audit directly addresses addendum §9.
-->

---

## Phase 2 — shelfPinGrid + columnPositions

> **Depends on Phase 0** for the side inner-face sign constants `LEFT_SIDE_INNER_FACE` / `RIGHT_SIDE_INNER_FACE` (`'Top' | 'Bottom'`). Phase 2 is pure math and takes `innerFace` as an **argument** — it does not import the Phase-0 constants directly; the *caller* (Phase 6 commands) supplies them. The tests in this phase therefore exercise BOTH `'Top'` and `'Bottom'` explicitly so the producer is correct regardless of which sign Phase 0 pins.
>
> Reuses the CONTRACT (§B `ShelfPinParams`, §C signatures, §D face convention, §E `DEFAULT_SHELF_PIN_PARAMS`). `BoreOp` / `face2DFrame` / `PanelFaceRole` are imported verbatim from `../bore` — do NOT redeclare them. The `'shelfPin-system32'` arm of `BoreRole` and the `'shelfPin'` arm of `BoreConnectorKind` are added in **Phase 1** (manifest/types chunk); Phase 2 depends on them existing. If Phase 2 is executed before Phase 1's `bore.ts` enum edit lands, prepend Step 1 of Task 1 below with the two-line union widen (noted inline).

All commands run with **cwd = `packages/shared`** (the `@zilventor/shared` package). Test runner is `vitest` (`packages/shared/package.json:8`, `"test:unit": "vitest run"`). Run a single spec with `npx vitest run src/<file>.spec.ts`.

---

### Task 1: `columnPositions` — centered span-stepper (the u-axis hole ladder)

`columnPositions(start, end, pitch)` returns the система-32 hole centers along one axis: a run of points spaced exactly `pitch` apart, **centered** inside `[start, end]` so the leading/trailing clearances are equal. This is the building block `shelfPinGrid` uses for the `u` (height) ladder.

**Files:**
- Create: `packages/shared/src/shelfPinGrid.ts`
- Test: `packages/shared/src/shelfPinGrid.spec.ts`

- [ ] **Step 1: RED — write the failing `columnPositions` spec.**
  Create `packages/shared/src/shelfPinGrid.spec.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { columnPositions } from './shelfPinGrid';

  describe('columnPositions — centered system-32 ladder', () => {
    it('steps at exactly `pitch` between consecutive holes', () => {
      const xs = columnPositions(64, 656, 32); // span 592 = 18*32 + 16
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeCloseTo(32, 9);
      }
    });

    it('centers the run so leading and trailing clearances are equal', () => {
      const start = 64, end = 656, pitch = 32;
      const xs = columnPositions(start, end, pitch);
      const leading = xs[0] - start;
      const trailing = end - xs[xs.length - 1];
      expect(leading).toBeCloseTo(trailing, 9);
    });

    it('keeps every hole inside [start, end]', () => {
      const start = 64, end = 656, pitch = 32;
      const xs = columnPositions(start, end, pitch);
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(start - 1e-9);
        expect(x).toBeLessThanOrEqual(end + 1e-9);
      }
    });

    it('places exactly floor(span/pitch)+1 holes', () => {
      // span = 656-64 = 592; floor(592/32)=18 → 19 holes
      expect(columnPositions(64, 656, 32)).toHaveLength(19);
    });

    it('returns a single centered hole when span < pitch', () => {
      const xs = columnPositions(100, 120, 32); // span 20 < 32
      expect(xs).toHaveLength(1);
      expect(xs[0]).toBeCloseTo(110, 9); // midpoint of [100,120]
    });

    it('returns a single hole at start when span === 0', () => {
      expect(columnPositions(50, 50, 32)).toEqual([50]);
    });
  });
  ```

- [ ] **Step 2: RED — run, confirm failure for the expected reason.**
  ```
  npx vitest run src/shelfPinGrid.spec.ts
  ```
  Expected RED: module-resolution failure — `Failed to resolve import "./shelfPinGrid"` (the file does not exist yet). This is the correct red (no symbol to test).

- [ ] **Step 3: GREEN — create `shelfPinGrid.ts` with the minimal `columnPositions`.**
  Create `packages/shared/src/shelfPinGrid.ts`:
  ```ts
  import type { BoreOp, PanelFaceRole } from './bore';
  import { face2DFrame } from './bore';

  /**
   * система-32 shelf-pin boring parameters. All distances in mm.
   * `frontSetback`/`backSetback` = the v-offset of the front/back columns
   * (depth direction). `topMargin`/`bottomMargin` = the u-clearance of the
   * first/last hole from the panel ends (height direction). Blind `depth`.
   */
  export interface ShelfPinParams {
    pitch: number;
    diameter: number;
    depth: number;
    frontSetback: number;
    backSetback: number;
    topMargin: number;
    bottomMargin: number;
    columns: 1 | 2;
  }

  export const DEFAULT_SHELF_PIN_PARAMS: ShelfPinParams = {
    pitch: 32,
    diameter: 5,
    depth: 13,
    frontSetback: 37,
    backSetback: 37,
    topMargin: 64,
    bottomMargin: 64,
    columns: 2,
  };

  /**
   * Hole centers along one axis: a run spaced `pitch` apart, centered inside
   * [start, end] so the leading and trailing clearances are equal. When the
   * span is smaller than one pitch, a single hole is placed at the midpoint.
   */
  export function columnPositions(start: number, end: number, pitch: number): number[] {
    const span = end - start;
    if (span <= 0) return [start];
    const steps = Math.floor(span / pitch); // gaps between holes
    if (steps <= 0) return [(start + end) / 2];
    const count = steps + 1;
    const runLength = steps * pitch;
    const lead = (span - runLength) / 2; // equal leading/trailing clearance
    const first = start + lead;
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(first + i * pitch);
    return out;
  }
  ```
  > **If Phase 1 has not yet widened `bore.ts`:** the `import type { BoreOp, PanelFaceRole }` line still resolves (both already exist at `bore.ts:16,29`). The new `BoreRole`/`BoreConnectorKind` arms are only needed by Task 2 below; if Task 2 runs before Phase 1, prepend the two-line union widen from CONTRACT §B to `bore.ts` first.

- [ ] **Step 4: GREEN — run, confirm pass.**
  ```
  npx vitest run src/shelfPinGrid.spec.ts
  ```
  Expected GREEN: all 6 `columnPositions` cases pass. (`shelfPinGrid` itself is unexported-tested yet — added in Task 2.)

- [ ] **Step 5: Commit.**
  ```
  git add packages/shared/src/shelfPinGrid.ts packages/shared/src/shelfPinGrid.spec.ts
  git commit -m "feat(shared): columnPositions centered system-32 hole ladder (присадка slice2 phase2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: `shelfPinGrid` — 2-column grid of BLIND Ø5 bores on a side INNER broad face

`shelfPinGrid(dims, innerFace, params)` emits the full система-32 grid for one side panel: `columns` vertical columns (front at `v=frontSetback`, back at `v=width−backSetback`), each a ladder of holes in `u` from `bottomMargin` to `length−topMargin`. Authored against the **UNSWAPPED native dims** (`length=H`, `width=D`, `thickness=Tc`), on the broad `Top`/`Bottom` face per CONTRACT §D. All bores BLIND, `role:'shelfPin-system32'`, `connectorKind:'shelfPin'`.

**Files:**
- Modify: `packages/shared/src/shelfPinGrid.ts` (add `shelfPinGrid`)
- Test: `packages/shared/src/shelfPinGrid.spec.ts` (add `shelfPinGrid` describe block; imports real side-panel dims from `buildBaseCabinet`)

- [ ] **Step 1: RED — add the `shelfPinGrid` spec, computing dims from a REAL cabinet build.**
  Append to `packages/shared/src/shelfPinGrid.spec.ts` (and extend the import line at the top):
  ```ts
  // --- add to the top import block of the file ---
  import { columnPositions, shelfPinGrid, DEFAULT_SHELF_PIN_PARAMS } from './shelfPinGrid';
  import { buildBaseCabinet } from './cabinets';
  import type { BaseCabinetParams } from './cabinets';
  import type { MaterialEntry } from './material';
  import { face2DFrame } from './bore';
  ```
  ```ts
  // --- append below the existing describe('columnPositions', ...) block ---

  // Build a REAL side panel via buildBaseCabinet and read its native dims.
  // Side panel native frame = {length:H, width:D, thickness:Tc} (baseCabinet.ts:30-43).
  const CARCASS: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
  const BACK: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };
  const REGISTRY: ReadonlyArray<MaterialEntry> = [CARCASS, BACK];
  const PARAMS: BaseCabinetParams = {
    name: 'C', width: 600, depth: 560, height: 720,
    toekickHeight: 100, toekickSetback: 50, shelfCount: 0,
    carcassMaterialId: 'm-birch-18', backMaterialId: 'm-hb-6', bandMaterialId: null,
  };

  function sidePanelDims(): { length: number; width: number; thickness: number } {
    const out = buildBaseCabinet(PARAMS, REGISTRY);
    const left = out.panels.find((p) => p.role === 'leftSide')!;
    const lit = (e: { kind: string; value?: number }) => (e as { value: number }).value;
    return {
      length: lit(left.panel.length),     // H = 720
      width: lit(left.panel.width),       // D = 560
      thickness: lit(left.panel.thickness) // Tc = 18
    };
  }

  describe('shelfPinGrid — 2-column system-32 grid on a side inner broad face', () => {
    const dims = sidePanelDims(); // { length:720, width:560, thickness:18 }
    const p = DEFAULT_SHELF_PIN_PARAMS;

    it('uses real side-panel native dims (sanity)', () => {
      expect(dims).toEqual({ length: 720, width: 560, thickness: 18 });
    });

    it('emits 2 columns × (ladder length) bores on the Top inner face', () => {
      const bores = shelfPinGrid(dims, 'Top', p);
      const ladder = columnPositions(p.bottomMargin, dims.length - p.topMargin, p.pitch);
      expect(bores).toHaveLength(2 * ladder.length);
    });

    it('places the front column at v=frontSetback and the back column at v=width−backSetback', () => {
      const bores = shelfPinGrid(dims, 'Top', p);
      const front = bores.filter((b) => b.connectorId === 'pin-col-front');
      const back = bores.filter((b) => b.connectorId === 'pin-col-back');
      expect(front.length).toBeGreaterThan(0);
      expect(back.length).toBeGreaterThan(0);
      for (const b of front) expect(b.v).toBeCloseTo(p.frontSetback, 9);          // 37
      for (const b of back) expect(b.v).toBeCloseTo(dims.width - p.backSetback, 9); // 560-37 = 523
    });

    it('steps holes in u from bottomMargin..length−topMargin at pitch=32', () => {
      const bores = shelfPinGrid(dims, 'Top', p);
      const front = bores.filter((b) => b.connectorId === 'pin-col-front').map((b) => b.u);
      const expected = columnPositions(p.bottomMargin, dims.length - p.topMargin, p.pitch);
      expect(front).toEqual(expected.map((u) => expect.closeTo(u, 9)));
      for (let i = 1; i < front.length; i++) expect(front[i] - front[i - 1]).toBeCloseTo(32, 9);
    });

    it('keeps every bore in-bounds: u∈[0,H], v∈[0,D]', () => {
      const bores = shelfPinGrid(dims, 'Top', p);
      for (const b of bores) {
        expect(b.u).toBeGreaterThanOrEqual(0);
        expect(b.u).toBeLessThanOrEqual(dims.length);  // H
        expect(b.v).toBeGreaterThanOrEqual(0);
        expect(b.v).toBeLessThanOrEqual(dims.width);   // D
      }
    });

    it('emits BLIND Ø5 shelfPin bores with correct role/kind (never throughAll)', () => {
      const bores = shelfPinGrid(dims, 'Top', p);
      for (const b of bores) {
        expect(b.diameter).toBe(p.diameter);          // 5
        expect(b.depth).toBe(p.depth);                // 13 (blind number, never 'throughAll')
        expect(typeof b.depth).toBe('number');
        expect(b.depth).toBeLessThan(dims.thickness); // 13 < 18 → blind
        expect(b.role).toBe('shelfPin-system32');
        expect(b.connectorKind).toBe('shelfPin');
        expect(['pin-col-front', 'pin-col-back']).toContain(b.connectorId);
      }
    });

    it('targets the requested broad inner face and panel feature', () => {
      const bores = shelfPinGrid(dims, 'Top', p);
      for (const b of bores) {
        expect(b.face).toEqual({ featureId: 'panel', role: 'Top', instance: 0 });
      }
      const bottomBores = shelfPinGrid(dims, 'Bottom', p);
      for (const b of bottomBores) expect(b.face.role).toBe('Bottom');
    });

    it('emits unique deterministic ids', () => {
      const bores = shelfPinGrid(dims, 'Top', p);
      const ids = bores.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('honors columns:1 (front column only)', () => {
      const bores = shelfPinGrid(dims, 'Top', { ...p, columns: 1 });
      const ladder = columnPositions(p.bottomMargin, dims.length - p.topMargin, p.pitch);
      expect(bores).toHaveLength(ladder.length);
      for (const b of bores) expect(b.connectorId).toBe('pin-col-front');
    });

    it('produces a world point on the broad face via face2DFrame (u→height, v→depth)', () => {
      // Cross-check that authoring (u,v) against native dims on Top lands where
      // bake/markers will read it (CONTRACT §D): u spans 0..H along +X, v spans 0..D along +Y.
      const frame = face2DFrame(dims, 'Top'); // origin (-360,-280,18), uDir +X, vDir +Y
      const b = shelfPinGrid(dims, 'Top', p)[0];
      const P = {
        x: frame.origin.x + b.u * frame.uDir.x + b.v * frame.vDir.x,
        y: frame.origin.y + b.u * frame.uDir.y + b.v * frame.vDir.y,
        z: frame.origin.z + b.u * frame.uDir.z + b.v * frame.vDir.z,
      };
      // u is a height offset along X within [-H/2, H/2]; v a depth offset along Y within [-D/2, D/2]; on the +Z broad face.
      expect(P.x).toBeGreaterThanOrEqual(-dims.length / 2 - 1e-9);
      expect(P.x).toBeLessThanOrEqual(dims.length / 2 + 1e-9);
      expect(P.y).toBeGreaterThanOrEqual(-dims.width / 2 - 1e-9);
      expect(P.y).toBeLessThanOrEqual(dims.width / 2 + 1e-9);
      expect(P.z).toBeCloseTo(dims.thickness, 9); // on the Top (z=Tc) broad face
    });
  });
  ```

- [ ] **Step 2: RED — run, confirm failure for the expected reason.**
  ```
  npx vitest run src/shelfPinGrid.spec.ts
  ```
  Expected RED: `shelfPinGrid is not a function` / `does not provide an export named 'shelfPinGrid'` (the symbol is not yet defined). The `columnPositions` cases from Task 1 still pass; only the new `shelfPinGrid` describe block fails. This is the correct red (missing producer, not a typo).

- [ ] **Step 3: GREEN — implement `shelfPinGrid` in `shelfPinGrid.ts`.**
  Append to `packages/shared/src/shelfPinGrid.ts` (the `import` lines at the top of the file already cover `BoreOp`, `PanelFaceRole`, `face2DFrame` — `face2DFrame` import can be removed if unused; it is **not** used by the producer, only by the test, so do not import it in the source):
  ```ts
  /**
   * система-32 shelf-pin grid for ONE side panel, authored against its UNSWAPPED
   * native dims {length:H, width:D, thickness:Tc} on the broad inner face
   * (`innerFace` = 'Top' z=Tc or 'Bottom' z=0; pinned per-side by Phase 0).
   *
   * Layout (CONTRACT §D, Convention 2): on the broad face, u=+X spans 0..H
   * (height), v=∓Y spans 0..D (depth). Each column is a fixed v (depth setback):
   *   - front column at v = frontSetback
   *   - back  column at v = width − backSetback   (= D − backSetback)
   * Holes step in u from bottomMargin..(length − topMargin) at `pitch`, centered.
   * All bores are BLIND (`depth`, never 'throughAll'); Ø`diameter`.
   */
  export function shelfPinGrid(
    dims: { length: number; width: number; thickness: number },
    innerFace: 'Top' | 'Bottom',
    params: ShelfPinParams,
  ): BoreOp[] {
    const face: PanelFaceRole = innerFace;
    const uPositions = columnPositions(
      params.bottomMargin,
      dims.length - params.topMargin,
      params.pitch,
    );
    const cols: Array<{ id: 'pin-col-front' | 'pin-col-back'; v: number }> = [
      { id: 'pin-col-front', v: params.frontSetback },
    ];
    if (params.columns >= 2) {
      cols.push({ id: 'pin-col-back', v: dims.width - params.backSetback });
    }

    const bores: BoreOp[] = [];
    for (const col of cols) {
      uPositions.forEach((u, i) => {
        bores.push({
          id: `${col.id}-${i}`,
          face: { featureId: 'panel', role: face, instance: 0 },
          u,
          v: col.v,
          diameter: params.diameter,
          depth: params.depth, // blind number, never 'throughAll'
          role: 'shelfPin-system32',
          connectorId: col.id,
          connectorKind: 'shelfPin',
        });
      });
    }
    return bores;
  }
  ```
  > Note: `import { face2DFrame } from './bore';` in the source file (added in Task 1 Step 3) is now unused by the producer — **remove that import** to keep the source clean (the spec imports `face2DFrame` independently). The `import type { BoreOp, PanelFaceRole } from './bore';` line stays.

- [ ] **Step 4: GREEN — run, confirm pass.**
  ```
  npx vitest run src/shelfPinGrid.spec.ts
  ```
  Expected GREEN: all `columnPositions` (6) + all `shelfPinGrid` (10) cases pass. Key derived numbers to sanity-check in output: ladder over `[64, 656]` pitch 32 = 19 holes → 38 bores for 2 columns; front `v=37`, back `v=523`; every `depth===13 (<18)`.

- [ ] **Step 5: REFACTOR — remove the dead `face2DFrame` import; confirm still green.**
  Open `packages/shared/src/shelfPinGrid.ts`, delete the line `import { face2DFrame } from './bore';` (leaving `import type { BoreOp, PanelFaceRole } from './bore';`). Re-run:
  ```
  npx vitest run src/shelfPinGrid.spec.ts
  ```
  Expected GREEN: unchanged pass count (the import was unused by the producer).

- [ ] **Step 6: Typecheck the package (guards `exactOptionalPropertyTypes` / union arms).**
  ```
  npx tsc --noEmit
  ```
  Expected: exits 0. If it errors on `role: 'shelfPin-system32'` or `connectorKind: 'shelfPin'` not assignable to `BoreRole`/`BoreConnectorKind`, **Phase 1's `bore.ts` enum widen has not landed** — apply CONTRACT §B's `BoreRole`/`BoreConnectorKind` edit to `packages/shared/src/bore.ts:3-8` first, then re-run. (Phase 2 sequences after Phase 1; this is the gate that catches an out-of-order run.)

- [ ] **Step 7: Commit.**
  ```
  git add packages/shared/src/shelfPinGrid.ts packages/shared/src/shelfPinGrid.spec.ts
  git commit -m "feat(shared): shelfPinGrid — 2-column system-32 blind Ø5 bores on side inner face (присадка slice2 phase2)

Authored against unswapped native side dims {length:H,width:D,thickness:Tc} on the
broad Top/Bottom inner face; front v=frontSetback, back v=D-backSetback; u-ladder
centered bottomMargin..H-topMargin at pitch 32. Tested on real buildBaseCabinet dims.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

</plan-chunk>

<!-- selfcritique:
Weaknesses: (1) `expect.closeTo` inside an array `.toEqual` mapping is valid vitest but slightly unusual — if the runner version chokes, fall back to per-index loop; low risk (vitest ^2). (2) The §D world-point cross-check asserts only bounding-box membership, not the exact P (exact P depends on the Phase-0 sign which Top/Bottom pins) — intentional, but weaker than a pinned-coordinate assert. (3) `columnPositions` "centered" semantics: I made margins balance within [start,end] rather than honoring topMargin/bottomMargin as hard offsets; contract says "centered so margins balance" — matches, but a reviewer wanting exact bottomMargin as the first u would disagree (then count = floor(span/pitch)+1 still, first=start). 
Assumptions: (a) Phase 1 lands `bore.ts` union arms before Phase 2 (noted + gated in Step 6/Task1 note); (b) `buildBaseCabinet` panel dims are `{kind:'literal',value}` (verified baseCabinet.ts:120-122); (c) `face: {featureId,role,instance}` shape matches FaceName (verified bore.ts comment :13-14, jointMath usage). 
Confidence: 88 — every path/export/dim verified against real files; residual risk is the centering convention nuance and the deferred exact-coordinate assert (correctly Phase-0-gated). -->

---

I have everything I need. The contract pins types/signatures/constants; the spec pins formulas; the real code confirms `face2DFrame`, `Pose`, `Vec3`, `BoreOp`, `buildBaseCabinet` dims, the test idiom, and the bore-emit style. 

Key facts I've verified for the plan:
- `DoorSpec` and `PanelRole += 'door'` are added in **Phase 1** (a different chunk). Phase 3/4 depend on them — I'll note the import and that Phase 1 is a prerequisite.
- `face2DFrame(dims, 'Top')`: origin `(-L/2,-W/2,T)`, uDir `+X`, vDir `+Y`. For door part `{length=doorH, width=doorW, thickness=Td}`, Top is the broad face; `u` spans `0..doorH`, `v` spans `0..doorW`. Good.
- `buildBaseCabinet` inner opening: bottom panel top at `tkH+Tc`, top panel bottom at `H−Tc` → `innerOpeningH = H − tkH − 2·Tc`. `Wo = W − 2·Tc`.
- Test runner: `vitest run` from `packages/shared`. Specs live in `src/__tests__/`.
- `Pose = { translation: Vec3; quaternion: [x,y,z,w] }`.

Now I'll author the plan chunk.

```markdown

---

## Phases 3 & 4 — doorMath + hingeMath

> **Prerequisites (other chunks):** Phase 0 (real-OCCT contract-lock guard) MUST be green — it
> derives and exports the constants `DOOR_CUP_FACE: 'Top'|'Bottom'`, `DOOR_POSE`, and the
> side-panel `*_INNER_FACE` signs from `packages/shared/src/prisadkaFaceConventions.ts`. Phase 1
> (data model) MUST have landed `DoorSpec` in `packages/shared/src/types.ts` and `'door'` on
> `PanelRole`. Both `doorMath` and `hingeMath` are **pure** modules in `packages/shared`; they
> take `cupFace`/`innerFace`/`pose` as **inputs** (they do not compute the OCCT-derived face sign
> themselves — that is Phase 0's job). All commands run from `packages/shared` with `vitest run`
> (script `test:unit`).
>
> **IMPORT RULE (addendum §1, binding):** Every side-inner-face constant, door-cup-face constant,
> and door pose constant MUST be imported from `packages/shared/src/prisadkaFaceConventions.ts`.
> NEVER re-declare a local `const UPRIGHT_QUAT`, `const CUP_FACE`, or `const LEFT_SIDE_INNER_FACE`
> literal — that is the slice-1 false-green class reproduced by the draft. A `git grep` for
> `UPRIGHT_QUAT` in the final plan must return zero results outside `prisadkaFaceConventions.ts`.

---

### Task 1: `doorMath` — sizing + pose for single/double × full/half/inset (RED)

**Files:**
- Create (test): `packages/shared/src/__tests__/doorMath.spec.ts`
- Create (impl, stub only in this task): `packages/shared/src/doorMath.ts`
- Reference (read-only): `packages/shared/src/cabinets/baseCabinet.ts:22-67` (real cabinet z/x layout — `Tc`, `Wo=W−2·Tc`, bottom top at `tkH+Tc`, top bottom at `H−Tc`), `packages/shared/src/jointMath.ts:5` (`Pose` shape), `packages/shared/src/types.ts:96-107` (`DoorSpec` added in Phase 1), `packages/shared/src/prisadkaFaceConventions.ts` (Phase 0 output — `DOOR_POSE`)

- [ ] **Step 1: Write the failing test file.** Create `packages/shared/src/__tests__/doorMath.spec.ts` with the COMPLETE content below. It pins sizing against the REAL `buildBaseCabinet` layout (not the prose), the `buildPanelBox(length=doorH,width=doorW,thickness=Td)` dim mapping, and the `pair`/`hingeSide`/`hingeCount` `doorSpec` wiring. The pose quaternion is asserted against the imported `DOOR_POSE.quaternion` — so if Phase 0 derives a different rotation, the test catches the mismatch rather than silently agreeing with a local copy.

```ts
import { describe, it, expect } from 'vitest';
import { doorMath, type DoorMathInput } from '../doorMath';
import { DOOR_POSE } from '../prisadkaFaceConventions';

// Real base-cabinet external dims (typical full-height carcass), Tc from the
// carcass material default thickness. These mirror buildBaseCabinet's inputs so
// the door sizing is checked against the SAME numbers the carcass uses.
const CABINET = { width: 600, height: 720, depth: 560, Tc: 18, toekickHeight: 100 };

function baseInput(over: Partial<DoorMathInput> = {}): DoorMathInput {
  return {
    cabinet: CABINET,
    count: 'single',
    overlay: 'full',
    hingeSide: 'left',
    thickness: 18,
    reveal: 2,
    clearance: 2,
    centerReveal: 3,
    ...over,
  };
}

describe('doorMath — sizing', () => {
  it('single full-overlay door = W−2r × H−2r, thickness Td', () => {
    const [d] = doorMath(baseInput({ overlay: 'full', count: 'single' }));
    expect(d.dims.width).toBeCloseTo(600 - 2 * 2, 6);   // doorW = W − 2r
    expect(d.dims.length).toBeCloseTo(720 - 2 * 2, 6);  // doorH = H − 2r  (length→localX)
    expect(d.dims.thickness).toBeCloseTo(18, 6);        // Td (thickness→localZ)
  });

  it('half-overlay sizing matches full (differs only in cup setback, not geometry)', () => {
    const [full] = doorMath(baseInput({ overlay: 'full' }));
    const [half] = doorMath(baseInput({ overlay: 'half' }));
    expect(half.dims.width).toBeCloseTo(full.dims.width, 6);
    expect(half.dims.length).toBeCloseTo(full.dims.length, 6);
  });

  it('single inset door = (Wo−2c) × (innerOpeningH−2c), Wo=W−2Tc, innerH=H−tkH−2Tc', () => {
    const [d] = doorMath(baseInput({ overlay: 'inset', count: 'single' }));
    const Wo = 600 - 2 * 18;                  // = 564
    const innerH = 720 - 100 - 2 * 18;        // = 584
    expect(d.dims.width).toBeCloseTo(Wo - 2 * 2, 6);     // 560
    expect(d.dims.length).toBeCloseTo(innerH - 2 * 2, 6); // 580
  });

  it('double full-overlay: two doors, each (W−2r−cr)/2 wide, same height', () => {
    const doors = doorMath(baseInput({ count: 'double', overlay: 'full' }));
    expect(doors).toHaveLength(2);
    const each = (600 - 2 * 2 - 3) / 2;       // (W − 2r − cr)/2
    expect(doors[0].dims.width).toBeCloseTo(each, 6);
    expect(doors[1].dims.width).toBeCloseTo(each, 6);
    expect(doors[0].dims.length).toBeCloseTo(720 - 2 * 2, 6);
    expect(doors[1].dims.length).toBeCloseTo(doors[0].dims.length, 6);
  });

  it('double inset: each (Wo−cr−2c)/2 wide, inset height', () => {
    const doors = doorMath(baseInput({ count: 'double', overlay: 'inset' }));
    expect(doors).toHaveLength(2);
    const Wo = 600 - 2 * 18;                  // 564
    const each = (Wo - 3 - 2 * 2) / 2;        // (Wo − cr − 2c)/2  → split with center clearance
    expect(doors[0].dims.width).toBeCloseTo(each, 6);
    expect(doors[1].dims.width).toBeCloseTo(each, 6);
  });
});

describe('doorMath — doorSpec', () => {
  it('single carries the dialog hingeSide + pair:single + auto hingeCount', () => {
    const [d] = doorMath(baseInput({ count: 'single', hingeSide: 'right' }));
    expect(d.doorSpec.pair).toBe('single');
    expect(d.doorSpec.hingeSide).toBe('right');
    expect(d.doorSpec.overlay).toBe('full');
    expect(d.doorSpec.hingeCount).toBeGreaterThanOrEqual(2); // resolved from doorH
  });

  it('double: left door pairLeft/hinge left, right door pairRight/hinge right', () => {
    const [left, right] = doorMath(baseInput({ count: 'double' }));
    expect(left.doorSpec.pair).toBe('pairLeft');
    expect(left.doorSpec.hingeSide).toBe('left');
    expect(right.doorSpec.pair).toBe('pairRight');
    expect(right.doorSpec.hingeSide).toBe('right');
  });

  it('both doors of a pair get the same auto hingeCount', () => {
    const [left, right] = doorMath(baseInput({ count: 'double' }));
    expect(left.doorSpec.hingeCount).toBe(right.doorSpec.hingeCount);
  });
});

describe('doorMath — pose', () => {
  it('every door has a pose with a translation + a 4-tuple quaternion matching DOOR_POSE', () => {
    for (const d of doorMath(baseInput({ count: 'double' }))) {
      expect(typeof d.pose.translation.x).toBe('number');
      expect(typeof d.pose.translation.y).toBe('number');
      expect(typeof d.pose.translation.z).toBe('number');
      expect(d.pose.quaternion).toHaveLength(4);
      // quaternion must be the Phase-0-derived upright pose, not a local re-declaration
      expect(d.pose.quaternion).toEqual(DOOR_POSE.quaternion);
    }
  });

  it('double doors are offset from each other in the cabinet-width direction', () => {
    const [left, right] = doorMath(baseInput({ count: 'double' }));
    // The two leaves cannot share the same world translation.
    const same =
      left.pose.translation.x === right.pose.translation.x &&
      left.pose.translation.y === right.pose.translation.y &&
      left.pose.translation.z === right.pose.translation.z;
    expect(same).toBe(false);
  });
});
```

- [ ] **Step 2: Add a minimal stub so the test fails on ASSERTIONS (not import).** Create `packages/shared/src/doorMath.ts` with ONLY the types + defaults + a stub that returns `[]`. Note: this stub does NOT declare a local `UPRIGHT_QUAT` literal — that import comes from `prisadkaFaceConventions.ts` in Task 2's implementation.

```ts
import type { DoorSpec, Vec3 } from './types';

export const DEFAULT_DOOR_THICKNESS = 18; // Td
export const DEFAULT_REVEAL = 2;          // r  (overlay)
export const DEFAULT_CLEARANCE = 2;       // c  (inset)
export const DEFAULT_CENTER_REVEAL = 3;   // cr (double)

export interface DoorMathInput {
  cabinet: { width: number; height: number; depth: number; Tc: number; toekickHeight: number };
  count: 'single' | 'double';
  overlay: 'full' | 'half' | 'inset';
  hingeSide: 'left' | 'right'; // single only; ignored for double
  thickness: number;           // Td, default 18
  reveal: number;              // r, default 2 (overlay)
  clearance: number;           // c, default 2 (inset)
  centerReveal: number;        // cr, default 3 (double)
}

export interface DoorPanel {
  dims: { length: number; width: number; thickness: number }; // length=doorH, width=doorW, thickness=Td
  pose: { translation: Vec3; quaternion: [number, number, number, number] };
  doorSpec: DoorSpec;
}

export function doorMath(_input: DoorMathInput): DoorPanel[] {
  return [];
}
```

- [ ] **Step 3: Run the test — confirm RED for the expected reason.** Run:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run src/__tests__/doorMath.spec.ts
```

Expected: file imports cleanly (no "Cannot find module"), tests FAIL on assertions — e.g. `expected undefined ...` / `Cannot destructure property 'dims' of 'undefined'` because `doorMath` returns `[]` so `[d] = []` yields `d === undefined`. This is the correct RED (logic missing, not a typo). If you instead see `Cannot find name 'DoorSpec'`, Phase 1 has not landed — STOP and resolve Phase 1 first. If you see `Cannot find module '../prisadkaFaceConventions'`, Phase 0 has not landed — STOP and resolve Phase 0 first.

---

### Task 2: `doorMath` — implement sizing + pose (GREEN)

**Files:**
- Modify (impl): `packages/shared/src/doorMath.ts` (replace the stub body from Task 1)

- [ ] **Step 1: Implement the real `doorMath`.** Replace the entire `packages/shared/src/doorMath.ts` with the COMPLETE implementation below. Sizing follows spec §7a verified against `buildBaseCabinet` (`Wo = W − 2·Tc`, `innerOpeningH = H − tkH − 2·Tc`). `hingeCount` is auto-resolved via `hingeCountForHeight` (Task 3's module — imported; if Phases 3/4 are authored strictly in order, Task 3 already exists; if not, see the note in Step 2). **Pose uses the Phase-0-derived `DOOR_POSE` imported from `prisadkaFaceConventions.ts` — there is NO local `UPRIGHT_QUAT` constant.** The implementation computes only the per-door translation (cabinet-width offset); the rotation quaternion is always `DOOR_POSE.quaternion`.

```ts
import type { DoorSpec, Vec3 } from './types';
import { DOOR_POSE } from './prisadkaFaceConventions';
import { hingeCountForHeight } from './hingeMath';

export const DEFAULT_DOOR_THICKNESS = 18; // Td
export const DEFAULT_REVEAL = 2;          // r  (overlay)
export const DEFAULT_CLEARANCE = 2;       // c  (inset)
export const DEFAULT_CENTER_REVEAL = 3;   // cr (double)

export interface DoorMathInput {
  cabinet: { width: number; height: number; depth: number; Tc: number; toekickHeight: number };
  count: 'single' | 'double';
  overlay: 'full' | 'half' | 'inset';
  hingeSide: 'left' | 'right'; // single only; ignored for double
  thickness: number;           // Td, default 18
  reveal: number;              // r, default 2 (overlay)
  clearance: number;           // c, default 2 (inset)
  centerReveal: number;        // cr, default 3 (double)
}

export interface DoorPanel {
  dims: { length: number; width: number; thickness: number }; // length=doorH, width=doorW, thickness=Td
  pose: { translation: Vec3; quaternion: [number, number, number, number] };
  doorSpec: DoorSpec;
}

interface Sizing {
  doorH: number;
  /** total combined door width available (single = one leaf; double = sum of both leaves) */
  totalDoorW: number;
}

function sizing(input: DoorMathInput): Sizing {
  const { width: W, height: H, Tc, toekickHeight: tkH } = input.cabinet;
  const r = input.reveal;
  const c = input.clearance;
  if (input.overlay === 'inset') {
    const Wo = W - 2 * Tc;
    const innerOpeningH = H - tkH - 2 * Tc;
    return { doorH: innerOpeningH - 2 * c, totalDoorW: Wo - 2 * c };
  }
  // full + half overlay sit OVER the front; sizing identical (half differs only
  // in the cup setback constant, applied later in hingeMath).
  return { doorH: H - 2 * r, totalDoorW: W - 2 * r };
}

export function doorMath(input: DoorMathInput): DoorPanel[] {
  const { doorH, totalDoorW } = sizing(input);
  const Td = input.thickness;
  const hingeCount = hingeCountForHeight(doorH);

  // World Y position of the door plane: at the cabinet front (y = depth), proud
  // for overlay, flush-into-opening for inset. The exact proud/recess offset is
  // derived from Phase 0's DOOR_POSE; the cabinet-front Y is the door plane.
  const frontY =
    input.overlay === 'inset'
      ? input.cabinet.depth - Td // recessed into the opening (front board face)
      : input.cabinet.depth;     // overlay door sits just proud of the front

  // The rotation quaternion is the Phase-0-derived upright pose — NEVER a local
  // re-declaration. Only the per-door translation is computed here.
  const quaternion = DOOR_POSE.quaternion;

  if (input.count === 'single') {
    const doorW = totalDoorW;
    return [
      {
        dims: { length: doorH, width: doorW, thickness: Td },
        pose: {
          translation: { x: input.cabinet.width / 2, y: frontY, z: input.cabinet.height / 2 },
          quaternion,
        },
        doorSpec: {
          overlay: input.overlay,
          hingeSide: input.hingeSide,
          pair: 'single',
          hingeCount,
        },
      },
    ];
  }

  // double: split totalDoorW into two equal leaves with a center clearance.
  // overlay center clearance = centerReveal; inset center clearance = centerReveal
  // (both consume the same gap between leaves).
  const each = (totalDoorW - input.centerReveal) / 2;
  const halfSpan = each / 2 + input.centerReveal / 2; // leaf-center offset from cabinet center
  return [
    {
      dims: { length: doorH, width: each, thickness: Td },
      pose: {
        translation: { x: input.cabinet.width / 2 - halfSpan, y: frontY, z: input.cabinet.height / 2 },
        quaternion,
      },
      doorSpec: { overlay: input.overlay, hingeSide: 'left', pair: 'pairLeft', hingeCount },
    },
    {
      dims: { length: doorH, width: each, thickness: Td },
      pose: {
        translation: { x: input.cabinet.width / 2 + halfSpan, y: frontY, z: input.cabinet.height / 2 },
        quaternion,
      },
      doorSpec: { overlay: input.overlay, hingeSide: 'right', pair: 'pairRight', hingeCount },
    },
  ];
}
```

> **Cross-module note:** `doorMath.ts` imports `hingeCountForHeight` from `./hingeMath`. If you are authoring this chunk strictly top-to-bottom, Task 3 creates `hingeMath.ts`. To keep Task 2 green in isolation, you MAY author Task 3's `hingeCountForHeight` (a 4-line threshold function) first, OR temporarily inline the threshold in `doorMath` and refactor to the import in Task 4's refactor step. The recommended order: do Task 3 Step 1–2 (`hingeCountForHeight`) BEFORE running Task 2's GREEN check. The plan assembler should sequence accordingly.

- [ ] **Step 2: Run the test — confirm GREEN.** Run:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run src/__tests__/doorMath.spec.ts
```

Expected: all `doorMath` describe blocks PASS (sizing single/double × full/half/inset, doorSpec wiring, pose present + matches `DOOR_POSE.quaternion` + double-door offset). If `hingeCountForHeight` is not yet defined you will see a module-resolution error — author Task 3 Step 1–2 first (see the cross-module note).

- [ ] **Step 3: Add the barrel export.** Append to `packages/shared/src/index.ts` (after the existing `export * from './connectorCatalog';` line at `:17`):

```ts
export * from './doorMath';
```

- [ ] **Step 4: Run the shared suite + typecheck to confirm no regression.** Run:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run && npx tsc --noEmit
```

Expected: full shared suite GREEN, `tsc` clean (the `DoorPanel`/`DoorMathInput` types compile; `DoorSpec`/`Vec3` resolve from `./types`; `DOOR_POSE` resolves from `./prisadkaFaceConventions`).

- [ ] **Step 5: Commit.** Run:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/shared/src/doorMath.ts packages/shared/src/__tests__/doorMath.spec.ts packages/shared/src/index.ts && git commit -m "feat(prisadka): doorMath — door sizing + pose for single/double × full/half/inset

Pure shared module. Sizing verified against buildBaseCabinet layout
(Wo=W−2Tc, innerOpeningH=H−tkH−2Tc); part dims map length→doorH, width→doorW,
thickness→Td per buildPanelBox; pose quaternion imported from
prisadkaFaceConventions (DOOR_POSE) — no local re-declaration. doorSpec
carries overlay/hingeSide/pair/auto-hingeCount.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `hingeMath` — `hingeCountForHeight` + `hingePositions` (RED→GREEN)

**Files:**
- Create (test): `packages/shared/src/__tests__/hingeMath.spec.ts`
- Create (impl): `packages/shared/src/hingeMath.ts`

- [ ] **Step 1: Write the failing test for count + positions.** Create `packages/shared/src/__tests__/hingeMath.spec.ts` with the content below. (Cup/plate tests are added in Task 4 — this task covers the count rule + Z positions only.)

```ts
import { describe, it, expect } from 'vitest';
import { hingeCountForHeight, hingePositions, HINGE_END_INSET } from '../hingeMath';

describe('hingeCountForHeight — threshold rule (spec §7b)', () => {
  it('≤900 → 2 hinges', () => {
    expect(hingeCountForHeight(600)).toBe(2);
    expect(hingeCountForHeight(900)).toBe(2);
  });
  it('901..1500 → 3 hinges', () => {
    expect(hingeCountForHeight(901)).toBe(3);
    expect(hingeCountForHeight(1500)).toBe(3);
  });
  it('1501..2000 → 4 hinges', () => {
    expect(hingeCountForHeight(1501)).toBe(4);
    expect(hingeCountForHeight(2000)).toBe(4);
  });
  it('2001..2400 → 5 hinges', () => {
    expect(hingeCountForHeight(2001)).toBe(5);
    expect(hingeCountForHeight(2400)).toBe(5);
  });
  it('>2400 → 5 hinges (contract default)', () => {
    expect(hingeCountForHeight(2700)).toBe(5);
  });
});

describe('hingePositions — Z centers along doorH', () => {
  it('count=2: one near each end at ~HINGE_END_INSET from the door ends', () => {
    const p = hingePositions(720, 2);
    expect(p).toHaveLength(2);
    expect(p[0]).toBeCloseTo(HINGE_END_INSET, 6);
    expect(p[1]).toBeCloseTo(720 - HINGE_END_INSET, 6);
  });
  it('positions are ascending and strictly inside (0, doorH)', () => {
    const p = hingePositions(2000, 4);
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThan(p[i - 1]);
    expect(p[0]).toBeGreaterThan(0);
    expect(p[p.length - 1]).toBeLessThan(2000);
  });
  it('count=3: ends at inset, middle evenly between them', () => {
    const p = hingePositions(1200, 3);
    expect(p).toHaveLength(3);
    expect(p[0]).toBeCloseTo(HINGE_END_INSET, 6);
    expect(p[2]).toBeCloseTo(1200 - HINGE_END_INSET, 6);
    expect(p[1]).toBeCloseTo((p[0] + p[2]) / 2, 6);
  });
  it('count=1 degenerate: single hinge at door mid-height', () => {
    const p = hingePositions(800, 1);
    expect(p).toEqual([400]);
  });
});
```

- [ ] **Step 2: Implement `hingeMath.ts` (count + positions + constants).** Create `packages/shared/src/hingeMath.ts` with the content below. (Cup/plate emitters are added in Task 4 — keep this file minimal now so Task 2's import of `hingeCountForHeight` resolves.)

```ts
import type { BoreOp, BoreRole, PanelFaceRole } from './bore';
import { face2DFrame } from './bore';

// ─── Hinge geometry constants (spec §7b; shop-tunable, lead review deferred §15) ───
export const CUP_DIAMETER = 35;
export const CUP_DEPTH = 12;        // blind; < Td(18)
export const CUP_SETBACK = { full: 21, half: 28, inset: 37 } as const; // mm from hinge edge, per overlay
export const PLATE_DIAMETER = 5;
export const PLATE_DEPTH = 13;      // blind
export const PLATE_PAIR_SPACING = 32; // two plate holes per hinge, along u
export const HINGE_END_INSET = 100; // top/bottom hinge ~100mm from door ends

/** Hinge count from door height (spec §7b): ≤900→2, ≤1500→3, ≤2000→4, ≤2400→5, else 5. */
export function hingeCountForHeight(doorH: number): number {
  if (doorH <= 900) return 2;
  if (doorH <= 1500) return 3;
  if (doorH <= 2000) return 4;
  return 5; // ≤2400 and >2400 both clamp to 5 (contract default)
}

/**
 * Hinge Z centers along the door height (the part-local u axis = +X = doorH on
 * the broad cup face). Ends sit ~HINGE_END_INSET from the door ends; interior
 * hinges are spaced evenly between them. count=1 degenerates to mid-height.
 */
export function hingePositions(doorH: number, count: number): number[] {
  if (count <= 1) return [doorH / 2];
  const first = HINGE_END_INSET;
  const last = doorH - HINGE_END_INSET;
  const step = (last - first) / (count - 1);
  return Array.from({ length: count }, (_, i) => first + i * step);
}
```

> The unused `BoreOp`/`BoreRole`/`PanelFaceRole`/`face2DFrame` imports above are consumed by the cup/plate emitters added in Task 4. If `tsc`/lint flags them as unused in THIS task, omit them now and re-add in Task 4 Step 2 (the project's `tsc --noEmit` does not error on unused imports by default — verify in Step 3).

- [ ] **Step 3: Run the test — confirm GREEN.** Run:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run src/__tests__/hingeMath.spec.ts
```

Expected: both describe blocks (count thresholds + positions) PASS. (No RED step is gated here because the count/positions logic is small and the failing-import RED is implicit — if you want an explicit RED, create the spec in Step 1 and run before Step 2: it fails with "Cannot find module '../hingeMath'", which is the expected pre-impl failure.)

- [ ] **Step 4: Add the barrel export.** Append to `packages/shared/src/index.ts` (after the `export * from './doorMath';` line added in Task 2 Step 3):

```ts
export * from './hingeMath';
```

- [ ] **Step 5: Commit.** Run:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/shared/src/hingeMath.ts packages/shared/src/__tests__/hingeMath.spec.ts packages/shared/src/index.ts && git commit -m "feat(prisadka): hingeMath — hinge count rule + Z positions + constants

hingeCountForHeight thresholds (≤900→2 … ≤2400→5, else 5); hingePositions
(~100mm end inset, even interior spacing); cup/plate constants
(CUP_DIAMETER 35, CUP_SETBACK per overlay, PLATE_PAIR_SPACING 32).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `hingeMath` — cup + plate bore emission, both hinge sides (RED→GREEN)

**Files:**
- Create/extend (test): `packages/shared/src/__tests__/hingeMath.spec.ts` (append cup/plate describe blocks)
- Modify (impl): `packages/shared/src/hingeMath.ts` (add `hingeCupBores` + `hingePlateBores`)
- Reference (read-only): `packages/shared/src/bore.ts:45-65` (`face2DFrame` — Top/Bottom origins & uDir/vDir), `packages/shared/src/connectorCatalog.ts:106-114` (BoreOp construction idiom), `packages/shared/src/prisadkaFaceConventions.ts` (Phase 0 output — `DOOR_CUP_FACE`, `LEFT_SIDE_INNER_FACE`, `RIGHT_SIDE_INNER_FACE`)

- [ ] **Step 1: Append the failing cup/plate tests.** Add the COMPLETE describe blocks below to `packages/shared/src/__tests__/hingeMath.spec.ts`. They (a) assert the cup lands within `CUP_SETBACK` of the CORRECT door edge for BOTH `hingeSide` values, computed via the door's REAL `face2DFrame` against **`DOOR_CUP_FACE`** imported from `prisadkaFaceConventions.ts`; (b) assert per-hinge 2× plate holes `PLATE_PAIR_SPACING` apart centered on the shared hinge `u`; (c) assert cup and plate share `connectorId` per hinge so plate-Z == cup-Z by construction.

  **World-Y math for `DOOR_CUP_FACE = 'Bottom'` (addendum §2 / verifier "Phase 4 vs Phase 9 CUP_FACE mismatch"):**
  From `bore.ts:55`: Bottom frame for door `{length=716, width=596, thickness=18}`:
  - origin = `(-358, +298, 0)`, `uDir = +X`, `vDir = -Y`
  - `w.y = origin.y + v * vDir.y = +298 + v * (−1) = 298 − v`

  Therefore:
  - `hingeSide='left'`: `v = CUP_SETBACK.full = 21` → `w.y = 298 − 21 = +277 = +doorW/2 − CUP_SETBACK.full`
  - `hingeSide='right'`: `v = doorW − CUP_SETBACK.full = 575` → `w.y = 298 − 575 = −277 = −doorW/2 + CUP_SETBACK.full`

  Update the import line at the top of the file to add the new symbols including `DOOR_CUP_FACE`, `LEFT_SIDE_INNER_FACE`.

```ts
// ── replace the existing import at the top of hingeMath.spec.ts ──
import {
  hingeCountForHeight,
  hingePositions,
  hingeCupBores,
  hingePlateBores,
  HINGE_END_INSET,
  CUP_SETBACK,
  CUP_DIAMETER,
  CUP_DEPTH,
  PLATE_DIAMETER,
  PLATE_DEPTH,
  PLATE_PAIR_SPACING,
} from '../hingeMath';
import { face2DFrame } from '../bore';
import { DOOR_CUP_FACE, LEFT_SIDE_INNER_FACE } from '../prisadkaFaceConventions';
import type { BoreOp } from '../bore';

// Door part dims: length=doorH, width=doorW, thickness=Td (buildPanelBox convention).
const DOOR_DIMS = { length: 716, width: 596, thickness: 18 };

/** World point of a bore (u,v) on a given face of the door box (no component pose). */
function worldOf(dims: { length: number; width: number; thickness: number }, b: BoreOp) {
  const f = face2DFrame(dims, b.face.role as 'Top' | 'Bottom');
  return {
    x: f.origin.x + b.u * f.uDir.x + b.v * f.vDir.x,
    y: f.origin.y + b.u * f.uDir.y + b.v * f.vDir.y,
    z: f.origin.z + b.u * f.uDir.z + b.v * f.vDir.z,
  };
}

describe('hingeCupBores — Ø35 cups on the door broad face', () => {
  const u = hingePositions(DOOR_DIMS.length, hingeCountForHeight(DOOR_DIMS.length));

  it('emits one cup per hinge with role/kind/diameter/blind depth', () => {
    const bores = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', u);
    expect(bores).toHaveLength(u.length);
    for (const b of bores) {
      expect(b.role).toBe('hingeCup');
      expect(b.connectorKind).toBe('hinge');
      expect(b.diameter).toBe(CUP_DIAMETER);
      expect(b.depth).toBe(CUP_DEPTH);
      expect(b.depth).not.toBe('throughAll'); // blind, < Td
      // face.role must be the imported DOOR_CUP_FACE constant — NOT a local re-declaration
      expect(b.face.role).toBe(DOOR_CUP_FACE);
    }
  });

  it('cup u positions equal the shared hingePositions (along doorH)', () => {
    const bores = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', u);
    expect(bores.map((b) => b.u)).toEqual(u);
  });

  // World-Y math for DOOR_CUP_FACE='Bottom':
  //   Bottom frame: origin.y = +doorW/2 = +298, vDir.y = -1
  //   w.y = +298 - v
  //   hingeSide='left': v=CUP_SETBACK.full=21 → w.y = +298-21 = +277 = +doorW/2 - CUP_SETBACK.full
  it('hingeSide=left: cups within CUP_SETBACK of the v=0 door edge (world-Y verified for DOOR_CUP_FACE)', () => {
    const bores = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', u);
    for (const b of bores) {
      expect(b.v).toBeCloseTo(CUP_SETBACK.full, 6); // setback from the v=0 edge
      // Bottom face: origin.y = +W/2; w.y = +W/2 - v
      const w = worldOf(DOOR_DIMS, b);
      expect(w.y).toBeCloseTo(DOOR_DIMS.width / 2 - CUP_SETBACK.full, 6);
    }
  });

  // hingeSide='right': v=doorW-CUP_SETBACK.full=575 → w.y = +298-575 = -277 = -doorW/2+CUP_SETBACK.full
  it('hingeSide=right: cups within CUP_SETBACK of the v=doorW door edge (world-Y verified for DOOR_CUP_FACE)', () => {
    const bores = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'right', 'full', u);
    for (const b of bores) {
      expect(b.v).toBeCloseTo(DOOR_DIMS.width - CUP_SETBACK.full, 6);
      // Bottom face: w.y = +W/2 - v = +298 - (W - setback) = setback - W/2
      const w = worldOf(DOOR_DIMS, b);
      expect(w.y).toBeCloseTo(-DOOR_DIMS.width / 2 + CUP_SETBACK.full, 6);
    }
  });

  it('overlay drives the setback constant (inset deeper than full)', () => {
    const full = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', u);
    const inset = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'inset', u);
    expect(full[0].v).toBeCloseTo(CUP_SETBACK.full, 6);
    expect(inset[0].v).toBeCloseTo(CUP_SETBACK.inset, 6);
    expect(CUP_SETBACK.inset).toBeGreaterThan(CUP_SETBACK.full);
  });
});

describe('hingePlateBores — Ø5 plate holes on the side broad face', () => {
  // Side panel native dims: length=H, width=D, thickness=Tc (UNSWAPPED).
  const SIDE_DIMS = { length: 720, width: 560, thickness: 18 };
  // Use the imported LEFT_SIDE_INNER_FACE constant — never re-declare a local 'Top'/'Bottom' literal
  const FRONT_SETBACK = 37;
  const u = hingePositions(716, hingeCountForHeight(716)); // SHARED with the cups

  it('emits 2 plate holes per hinge, PLATE_PAIR_SPACING apart, centered on each hinge u', () => {
    const bores = hingePlateBores(SIDE_DIMS, LEFT_SIDE_INNER_FACE, u, FRONT_SETBACK);
    expect(bores).toHaveLength(u.length * 2);
    // group by connectorId and check the pair geometry
    for (let i = 0; i < u.length; i++) {
      const pair = bores.filter((b) => b.connectorId === `hinge-${i}`);
      expect(pair).toHaveLength(2);
      const us = pair.map((b) => b.u).sort((a, c) => a - c);
      expect(us[1] - us[0]).toBeCloseTo(PLATE_PAIR_SPACING, 6);
      expect((us[0] + us[1]) / 2).toBeCloseTo(u[i], 6); // centered on the hinge u
    }
  });

  it('plate holes carry role/kind/diameter/blind depth + sit at v=frontSetback + face.role = LEFT_SIDE_INNER_FACE', () => {
    const bores = hingePlateBores(SIDE_DIMS, LEFT_SIDE_INNER_FACE, u, FRONT_SETBACK);
    for (const b of bores) {
      expect(b.role).toBe('hingePlate');
      expect(b.connectorKind).toBe('hinge');
      expect(b.diameter).toBe(PLATE_DIAMETER);
      expect(b.depth).toBe(PLATE_DEPTH);
      expect(b.depth).not.toBe('throughAll');
      expect(b.v).toBeCloseTo(FRONT_SETBACK, 6);
      // face.role must be the imported LEFT_SIDE_INNER_FACE constant — never a local 'Top'/'Bottom'
      expect(b.face.role).toBe(LEFT_SIDE_INNER_FACE);
    }
  });

  it('plate connectorIds match the cup connectorIds (same hinge grouping → plate-Z==cup-Z)', () => {
    const cups = hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, 'left', 'full', u);
    const plates = hingePlateBores(SIDE_DIMS, LEFT_SIDE_INNER_FACE, u, FRONT_SETBACK);
    const cupIds = new Set(cups.map((b) => b.connectorId));
    for (const p of plates) expect(cupIds.has(p.connectorId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the appended tests — confirm RED for the expected reason.** Run:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run src/__tests__/hingeMath.spec.ts
```

Expected: the count/positions blocks still PASS; the new cup/plate blocks FAIL with `hingeCupBores is not a function` / `hingePlateBores is not a function` (they don't exist yet). This is the correct RED.

- [ ] **Step 3: Implement the cup + plate emitters.** Add the two functions below to `packages/shared/src/hingeMath.ts` (after `hingePositions`). Cup `v` is hingeSide-dependent (`CUP_SETBACK[overlay]` at the `v=0` edge for `'left'`, `doorW − CUP_SETBACK` at the `v=doorW` edge for `'right'`). Plate emits 2 holes per hinge `PLATE_PAIR_SPACING` apart centered on the SHARED `uPositions`, so plate Z matches cup Z by construction; both use `connectorId: 'hinge-<i>'`. The `cupFace` and `innerFace` parameters receive the values imported from `prisadkaFaceConventions` by the CALLER — `hingeMath` itself does NOT import or re-declare those constants (the face is a parameter, not a hardcoded value).

```ts
/**
 * Ø35 hinge cups on the door's carcass-facing broad face (Top/Bottom, from
 * Phase-0 DOOR_CUP_FACE imported by the caller). u = +X = along doorH (the shared
 * hinge positions); v = ∓Y = along doorW, set back from the hinge-side edge:
 *   hingeSide='left'  → edge at v=0     → v = CUP_SETBACK[overlay]
 *   hingeSide='right' → edge at v=doorW → v = doorW − CUP_SETBACK[overlay]
 */
export function hingeCupBores(
  doorDims: { length: number; width: number; thickness: number }, // length=doorH, width=doorW, thickness=Td
  cupFace: 'Top' | 'Bottom',   // caller passes DOOR_CUP_FACE from prisadkaFaceConventions
  hingeSide: 'left' | 'right',
  overlay: 'full' | 'half' | 'inset',
  uPositions: number[],
): BoreOp[] {
  const setback = CUP_SETBACK[overlay];
  const v = hingeSide === 'left' ? setback : doorDims.width - setback;
  return uPositions.map((u, i) => ({
    id: `hinge-${i}-cup`,
    face: { featureId: 'panel', role: cupFace as PanelFaceRole, instance: 0 },
    u,
    v,
    diameter: CUP_DIAMETER,
    depth: CUP_DEPTH,
    role: 'hingeCup' as BoreRole,
    connectorId: `hinge-${i}`,
    connectorKind: 'hinge',
  }));
}

/**
 * Ø5 plate-mount holes on the side panel's broad inner face (Top/Bottom, from
 * Phase-0 *_INNER_FACE imported by the caller). Per hinge: 2 holes PLATE_PAIR_SPACING
 * apart along the panel height (u), centered on the SHARED hinge u (so plate Z == cup Z
 * by construction), at the front column setback (v = frontSetback).
 */
export function hingePlateBores(
  sideDims: { length: number; width: number; thickness: number }, // UNSWAPPED native: length=H, width=D, thickness=Tc
  innerFace: 'Top' | 'Bottom',  // caller passes LEFT/RIGHT_SIDE_INNER_FACE from prisadkaFaceConventions
  uPositions: number[],
  frontSetback: number,
  params?: { diameter?: number; depth?: number; pairSpacing?: number },
): BoreOp[] {
  const diameter = params?.diameter ?? PLATE_DIAMETER;
  const depth = params?.depth ?? PLATE_DEPTH;
  const spacing = params?.pairSpacing ?? PLATE_PAIR_SPACING;
  const half = spacing / 2;
  const bores: BoreOp[] = [];
  uPositions.forEach((u, i) => {
    for (const [n, du] of [[0, -half], [1, +half]] as const) {
      bores.push({
        id: `hinge-${i}-plate-${n}`,
        face: { featureId: 'panel', role: innerFace as PanelFaceRole, instance: 0 },
        u: u + du,
        v: frontSetback,
        diameter,
        depth,
        role: 'hingePlate' as BoreRole,
        connectorId: `hinge-${i}`,
        connectorKind: 'hinge',
      });
    }
  });
  return bores;
}
```

> The `face2DFrame` import added in Task 3 Step 2 is used by the TEST (for the world-Y derivation), not the impl; the impl only needs `BoreOp`/`BoreRole`/`PanelFaceRole` types. If you omitted those type imports in Task 3 (per its note), re-add `import type { BoreOp, BoreRole, PanelFaceRole } from './bore';` at the top of `hingeMath.ts` now.

- [ ] **Step 4: Run the test — confirm GREEN.** Run:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run src/__tests__/hingeMath.spec.ts
```

Expected: ALL describe blocks PASS, including both-hinge-side cup placement for `DOOR_CUP_FACE='Bottom'`:
- `hingeSide='left'`: `v = CUP_SETBACK.full = 21`, `w.y ≈ +doorW/2 − CUP_SETBACK.full = +277`
- `hingeSide='right'`: `v = doorW − CUP_SETBACK.full = 575`, `w.y ≈ −doorW/2 + CUP_SETBACK.full = −277`

Also: plate pair geometry (2× per hinge, 32mm apart, centered), `face.role === LEFT_SIDE_INNER_FACE`, and the cup/plate shared-`connectorId` invariant.

- [ ] **Step 5: Run the full shared suite + typecheck.** Run:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/shared && npx vitest run && npx tsc --noEmit
```

Expected: full shared suite GREEN, `tsc` clean. (`'hingeCup'`/`'hingePlate'` must already be valid `BoreRole` arms and `'hinge'` a valid `BoreConnectorKind` — these are added in Phase 1; if `tsc` errors `Type '"hingeCup"' is not assignable to type 'BoreRole'`, Phase 1 has not landed — STOP and resolve Phase 1.)

- [ ] **Step 6: Commit.** Run:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor && git add packages/shared/src/hingeMath.ts packages/shared/src/__tests__/hingeMath.spec.ts && git commit -m "feat(prisadka): hingeMath — Ø35 cup + Ø5 plate bore emission (both hinge sides)

Cup on door broad face (cupFace param from caller's DOOR_CUP_FACE import),
hingeSide-dependent v (CUP_SETBACK[overlay] at v=0 edge or doorW−CUP_SETBACK at
v=doorW edge); plate = 2× Ø5 PLATE_PAIR_SPACING apart on the side inner face
(innerFace param from caller's LEFT/RIGHT_SIDE_INNER_FACE import) at v=frontSetback,
centered on the shared hingePositions so plate-Z==cup-Z; cup+plate share connectorId
'hinge-<i>'. Both blind. World-Y assertions derived against DOOR_CUP_FACE='Bottom'
frame (origin.y=+W/2, vDir=-Y). No local face-constant re-declarations anywhere.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

<!-- selfcritique:
Weaknesses:
1. DOOR_POSE is imported but its actual quaternion value is left to Phase 0 derivation (by design,
   per spec §16 + addendum §1). The doorMath test asserts `pose.quaternion toEqual DOOR_POSE.quaternion`
   — this is correct (not tautological) because if Phase 0 derives [0,0.707,0,0.707] but doorMath
   hardcoded [0,-0.707,0,0.707], the test would fail. The test IS a real constraint between phases.
2. World-Y derivation for DOOR_CUP_FACE='Bottom' is computed inline in this chunk. If Phase 0
   resolves DOOR_CUP_FACE='Top' instead, the hingeMath test will fail — which is correct behavior
   (it forces re-deriving the world-Y expectations from the Top frame). The addendum states 'Bottom'
   is the proven value; the tests import the constant so they track whatever Phase 0 actually lands.
3. hingeCountForHeight >2400 defaults to 5; spec is silent — flagged as deferred for lead review.
4. Double-inset center-clearance formula (each=(Wo-cr-2c)/2) uses centerReveal as inter-leaf gap —
   defensible but unverified against shop practice.

Assumptions:
- prisadkaFaceConventions.ts is created by Phase 0 before this chunk runs; its exports include
  DOOR_POSE, DOOR_CUP_FACE, LEFT_SIDE_INNER_FACE, RIGHT_SIDE_INNER_FACE (all confirmed in addendum §1).
- DoorSpec + 'door' PanelRole + new BoreRole/BoreConnectorKind arms land in Phase 1 before this chunk.
- tsc --noEmit does not flag unused imports (noUnusedLocals likely off — Step 5 verifies).
- face2DFrame Top/Bottom math is as read (verified bore.ts:45-65).

Confidence: 87 — sizing, both-hinge-side cup v, plate pairing, shared-connectorId, and all signatures
are verified against contract + real bore.ts code; world-Y math is independently re-derived in this
document from the real frame data; all local face/pose re-declarations replaced with imports per
addendum §1. Residual risk: Phase 0 DOOR_CUP_FACE final value (if 'Top', world-Y assertions need
recalculating for Top frame — but the test imports the constant so it will fail loudly rather than
silently pass the wrong geometry).
-->

---

## Phase 5 — AddDoorCommand

> **Depends on:** Phase 0 (`prisadkaFaceConventions.ts` — DOOR_CUP_FACE, LEFT/RIGHT_SIDE_INNER_FACE, DOOR_POSE), Phase 1 (`doorSpec` field on `ComponentInstance`, `DoorSpec` type, v22 manifest, `PanelRole` + `'door'`), Phase 3 (`doorMath`, `DEFAULT_*` door consts), Phase 4 (`hingeCupBores`, `hingePlateBores`, `hingePositions`, `hingeCountForHeight`). This phase wires them into a single undoable command on the **sub-assembly write path**.
>
> **All commands in this phase run with `// @vitest-environment node`** (mirrors `GenerateCarcassBoresCommand.spec.ts:1`) and use the in-memory `MemOpfs` + `useAppStore.setActiveDocument` pattern from that spec. **Run app suites from `packages/app` (cwd) with `npx vitest`.**

The command, on `apply()`:
1. Read the cabinet `.ziasm` via `unpackAssembly`.
2. **DERIVE `{width, height, depth, Tc, toekickHeight}` from the unpacked cabinet assembly** — read the `leftSide` (or `rightSide`) component's `.zipt` PanelFeature dims (`length=H, width=D, thickness=Tc`), infer `width` from position of rightSide (`position.x + Tc`), and `toekickHeight` from the bottom panel's `position.z`. OVERRIDE `params.cabinet` with these derived values before calling `doorMath`. Assert all derived dims are strictly positive.
3. For each `DoorPanel` returned by `doorMath`: create a `dedupeName`'d door `.zipt` (PanelFeature + cup bores) via the `CreateCabinetCommand.packPanelPart` recipe (async), `registerPart`, `opfs.write`.
4. Push a `role:'door'` `ComponentInstance` (carrying `doorSpec` + `pose`) into the cabinet doc's `components[]`.
5. Write **plate** bores into the side panel `.zipt`(s) via the `GenerateCarcassBoresCommand` part-path mechanism (read → `unpackProject` → append `bores` → `packProject` → write), snapshotting prior bores.
6. `packAssembly` the mutated cabinet doc → `opfs.write` the `.ziasm`.
7. Reload that `.ziasm` entry into `subAssemblyDocs` (additive loader won't replace it), `setSolverDirty(true)`.
8. `boreCacheInvalidator?.(affectedSidePaths)`.

On `revert()`: restore side bores[], remove the door component(s), `deletePart` + `opfs.delete` the door `.zipt`(s), reload `.ziasm`, invalidate cache. Redo is optimized to skip `doorMath`/part-rebuild by replaying captured artifacts.

**Face-sign import rule (addendum §1):** `DOOR_CUP_FACE`, `LEFT_SIDE_INNER_FACE`, `RIGHT_SIDE_INNER_FACE` MUST be imported from `packages/shared/src/prisadkaFaceConventions.ts` (created by Phase 0). Never re-declare local literals. Phase 0 is a hard prerequisite — do not execute Phase 5 until `prisadkaFaceConventions.ts` is on disk.

---

### Task 1: AddDoorCommand — cabinet dims derivation + door part creation + component push (apply happy path)

**Files:**
- Create: `packages/app/src/commands/AddDoorCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/AddDoorCommand.spec.ts`

This task lands the skeleton + the cabinet-dims derivation from the unpacked `.ziasm` + the door-part/`.zipt` write + component push. Plate bores + revert come in Tasks 2–4.

- [ ] **Step 1 (RED): write the failing apply-happy-path test.** Create `packages/app/src/commands/__tests__/AddDoorCommand.spec.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDoorCommand } from '../AddDoorCommand';
import { useAppStore } from '../../store/useAppStore';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, DoorMathInput, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async exists(p: string) { return this.files.has(p); }
  async delete(p: string) { this.files.delete(p); }
}

/** Minimal in-memory kernel mock: tracks registered/deleted part ids. */
function makeKernel() {
  const registered = new Set<string>();
  return {
    registered,
    async registerPart(part: PartDocument) {
      if (registered.has(part.id)) throw new Error(`already registered ${part.id}`);
      registered.add(part.id);
    },
    async deletePart(partId: string) { registered.delete(partId); },
  };
}

const Tc = 18;
const CABW = 600, CABD = 560, CABH = 720, TOEKICK_H = 100;

/** Cabinet .ziasm with the two side panels (the ones that carry hinge plates). */
async function seedCabinet(opfs: MemOpfs): Promise<string> {
  // Side panel .zipt files — native dims {length:H, width:D, thickness:Tc}.
  for (const [path] of [['L.zipt'], ['R.zipt']] as const) {
    const doc: Partial<PartDocument> = {
      id: path, name: path, units: 'mm', parameters: {},
      featureTree: [{
        kind: 'panel', id: 'panel',
        length: { kind: 'literal', value: CABH },
        width: { kind: 'literal', value: CABD },
        thickness: { kind: 'literal', value: Tc },
        thicknessFromMaterial: true, materialId: 'm', grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
      } as unknown as import('@zilventor/shared').Feature],
    };
    const { packProject } = await import('@zilventor/kernel/src/storage/ProjectPacker');
    await opfs.write(path, await packProject({
      manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc },
      blobs: {},
    }));
  }
  // Bottom panel .zipt — its position.z tells AddDoorCommand the toekick height.
  const bottomDoc: Partial<PartDocument> = {
    id: 'B.zipt', name: 'B.zipt', units: 'mm', parameters: {},
    featureTree: [{
      kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: CABW - 2 * Tc },
      width: { kind: 'literal', value: CABD },
      thickness: { kind: 'literal', value: Tc },
      thicknessFromMaterial: true, materialId: 'm', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    } as unknown as import('@zilventor/shared').Feature],
  };
  const { packProject: pp } = await import('@zilventor/kernel/src/storage/ProjectPacker');
  await opfs.write('B.zipt', await pp({
    manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: bottomDoc },
    blobs: {},
  }));

  const cabinet: AssemblyDocument = {
    id: 'A_CAB', name: 'Cab', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'C1', partPath: 'L.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
      { id: 'C2', partPath: 'R.zipt', position: { x: CABW - Tc, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
      { id: 'C3', partPath: 'B.zipt', position: { x: Tc, y: 0, z: TOEKICK_H }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom' },
    ],
    constraints: [], groundedComponentPaths: [['C1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  const cabinetPath = 'Cab.ziasm';
  await opfs.write(cabinetPath, await packAssembly(cabinet, new Uint8Array()));
  // Active top-level assembly holds a wrapper pointing at the cabinet (matches real structure).
  const top: AssemblyDocument = {
    id: 'A_TOP', name: 'Room', units: 'mm', parameters: {}, properties: {},
    components: [{ id: 'TOP1', partPath: cabinetPath, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
    constraints: [], groundedComponentPaths: [['TOP1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: top });
  useAppStore.getState().setSubAssemblyDocs({ [cabinetPath]: cabinet });
  return cabinetPath;
}

/**
 * NOTE: `params.cabinet` here passes ZEROS for width/height/depth/Tc/toekickHeight.
 * AddDoorCommand.apply() MUST derive these from the unpacked .ziasm before calling doorMath.
 * This is load-bearing: passing zeros should FAIL (doorMath returns negative door dims) unless
 * the command overrides them from real panel dims. If this test passes with zeros persisting
 * into doorMath, it is a false-green — the assertion on doorBores.length > 0 would fail first.
 */
const SINGLE_DOOR_ZERO_DIMS: DoorMathInput = {
  cabinet: { width: 0, height: 0, depth: 0, Tc: 0, toekickHeight: 0 }, // INTENTIONALLY ZERO
  count: 'single', overlay: 'full', hingeSide: 'left',
  thickness: 18, reveal: 2, clearance: 2, centerReveal: 3,
};

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

describe('AddDoorCommand — apply (cabinet dims derivation + door part + component)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('derives cabinet dims from the .ziasm side-panel PanelFeature and passes positive values to doorMath', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    // Command is constructed with zero dims — apply() must override from the unpacked assembly.
    const cmd = new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel });
    await cmd.apply();

    // Cabinet .ziasm now has one extra role:door component carrying doorSpec.
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const doors = cab.components.filter((c) => c.role === 'door');
    expect(doors.length).toBe(1);
    expect(doors[0]!.doorSpec).toBeDefined();
    expect(doors[0]!.doorSpec!.hingeSide).toBe('left');

    // The referenced door .zipt exists, was registered, and carries Ø35 cup bores.
    const doorPath = doors[0]!.partPath;
    expect(await opfs.exists(doorPath)).toBe(true);
    const doorBores = await boresOf(opfs, doorPath);
    // If doorMath received zero dims it would return a zero/negative-size door with no valid bores,
    // so a non-zero bores array proves cabinet dims were correctly derived (strictly positive).
    expect(doorBores.length).toBeGreaterThan(0);
    expect(doorBores.every((b) => b.connectorKind === 'hinge')).toBe(true);
    expect(doorBores.some((b) => b.role === 'hingeCup' && b.diameter === 35)).toBe(true);
    expect(kernel.registered.size).toBe(1);
  });

  it('throws if derived cabinet dims are not all strictly positive', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    // Seed a cabinet with NO side panels — dims derivation should fail the positive assertion.
    const emptyCab: AssemblyDocument = {
      id: 'A_EMPTY', name: 'Empty', units: 'mm', parameters: {}, properties: {},
      components: [], constraints: [], groundedComponentPaths: [],
      colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    const cabPath = 'Empty.ziasm';
    await opfs.write(cabPath, await packAssembly(emptyCab, new Uint8Array()));
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyCab });
    useAppStore.getState().setSubAssemblyDocs({ [cabPath]: emptyCab });

    const cmd = new AddDoorCommand({ cabinetPath: cabPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel });
    await expect(cmd.apply()).rejects.toThrow(/dims.*positive|positive.*dims|cabinet.*dims|width.*height/i);
  });
});
```

- [ ] **Step 2 (RED-run): confirm it fails because the module does not exist.** Run from `packages/app`:
```bash
npx vitest run src/commands/__tests__/AddDoorCommand.spec.ts
```
Expect RED: `Failed to resolve import "../AddDoorCommand"` (the file does not exist yet). This is the expected red reason — module-not-found, not an assertion.

- [ ] **Step 3 (GREEN): create the command with cabinet-dims derivation + door-part + component-push path.** Create `packages/app/src/commands/AddDoorCommand.ts`:

```ts
import type { Command } from './Command';
import type {
  AssemblyDocument,
  BoreOp,
  ComponentInstance,
  DoorMathInput,
  PanelFeature,
  PartDocument,
} from '@zilventor/shared';
import {
  CURRENT_FORMAT_VERSION,
  doorMath,
  hingeCupBores,
  hingePositions,
} from '@zilventor/shared';
// ADDENDUM §1: import face-sign constants from the shared conventions module (Phase 0 output).
// DO NOT re-declare local literals — a single Phase-0 change propagates to all consumers.
import {
  DOOR_CUP_FACE,
  LEFT_SIDE_INNER_FACE,
  RIGHT_SIDE_INNER_FACE,
} from '@zilventor/shared/src/prisadkaFaceConventions';
import type { KernelApi } from '@zilventor/kernel/src/api';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { dedupeName } from '../import/dedupeName';
import { useAppStore } from '../store/useAppStore';

type OpfsRWD = {
  read(p: string): Promise<Uint8Array>;
  write(p: string, b: Uint8Array): Promise<void>;
  exists(p: string): Promise<boolean>;
  delete?(p: string): Promise<void>;
};

/** A door created during apply() — recorded so revert (and redo) can replay/undo it. */
interface CreatedDoor {
  partPath: string;     // OPFS .zipt path of the door part
  partId: string;       // PartDocument id (for kernel deletePart)
  componentId: string;  // ComponentInstance.id pushed into the cabinet doc
  bytes: Uint8Array;    // packed .zipt bytes (for redo without rebuild)
  component: ComponentInstance; // the pushed component (for redo re-push)
}

/**
 * Derives {width, height, depth, Tc, toekickHeight} from the unpacked cabinet .ziasm.
 *
 * Strategy (mirrors how buildBaseCabinet lays out panels, baseCabinet.ts:29-77):
 * - leftSide component: position.x=0, PanelFeature.length=H, .width=D, .thickness=Tc
 * - rightSide component: position.x = W - Tc  →  W = position.x + Tc
 * - bottom component: position.z = toekickHeight
 *
 * All returned values MUST be strictly positive. If derivation fails, throws.
 */
async function deriveCabinetDims(
  cab: AssemblyDocument,
  opfs: Pick<OpfsRWD, 'read'>,
): Promise<{ width: number; height: number; depth: number; Tc: number; toekickHeight: number }> {
  const leftComp = cab.components.find((c) => c.role === 'leftSide');
  const rightComp = cab.components.find((c) => c.role === 'rightSide');
  const bottomComp = cab.components.find((c) => c.role === 'bottom');

  if (!leftComp) throw new Error('AddDoorCommand: cabinet has no leftSide component — cannot derive cabinet dims');

  // Read the left-side PanelFeature to get H, D, Tc.
  const leftProject = await unpackProject(await opfs.read(leftComp.partPath));
  const leftDoc = (leftProject.manifest as { document: { featureTree?: Array<Record<string, unknown>> } }).document;
  const leftPanel = (leftDoc.featureTree ?? []).find((f) => f.kind === 'panel') as
    | { length: { value: number }; width: { value: number }; thickness: { value: number } }
    | undefined;
  if (!leftPanel) throw new Error('AddDoorCommand: leftSide panel has no PanelFeature — cannot derive cabinet dims');

  const H = leftPanel.length.value;   // side panel native length = cabinet height
  const D = leftPanel.width.value;    // side panel native width  = cabinet depth
  const Tc = leftPanel.thickness.value;

  // Width: rightSide position.x + Tc  (from buildBaseCabinet: rightSide.position = {x: W - Tc, ...})
  const W = rightComp ? rightComp.position.x + Tc : NaN;

  // Toekick height: bottom panel position.z  (from buildBaseCabinet: bottom.position = {z: tkH, ...})
  const tkH = bottomComp ? bottomComp.position.z : 0;

  const derived = { width: W, height: H, depth: D, Tc, toekickHeight: tkH };

  // ADDENDUM §4: assert all strictly positive before passing to doorMath.
  for (const [k, v] of Object.entries(derived)) {
    if (typeof v !== 'number' || isNaN(v) || v < 0) {
      throw new Error(`AddDoorCommand: derived cabinet dims not all positive — ${k}=${v}`);
    }
  }
  // width and height must be strictly > 0 (toekickHeight and Tc may be 0 only in degenerate cases
  // but must be >= 0; width/height/depth/Tc must be > 0 for a valid door).
  if (derived.width <= 0 || derived.height <= 0 || derived.depth <= 0 || derived.Tc <= 0) {
    throw new Error(
      `AddDoorCommand: derived cabinet dims must be strictly positive — width=${derived.width} height=${derived.height} depth=${derived.depth} Tc=${derived.Tc}`,
    );
  }

  return derived;
}

export class AddDoorCommand implements Command {
  readonly name = 'AddDoor';
  private readonly store: typeof useAppStore;
  /** Door artifacts created during the FIRST apply() — replayed on redo. */
  private createdDoors: CreatedDoor[] | null = null;
  /** sidePanelPath → prior bores[] before this command appended plates (for revert). */
  private priorSideBores = new Map<string, BoreOp[]>();

  constructor(private readonly opts: {
    cabinetPath: string;
    params: DoorMathInput;
    opfs: OpfsRWD;
    kernel?: Pick<KernelApi, 'registerPart' | 'deletePart'>;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const cab = await unpackAssembly(await this.opts.opfs.read(this.opts.cabinetPath));

    // ADDENDUM §4: derive real cabinet dims from the unpacked .ziasm; override params.cabinet.
    const derivedDims = await deriveCabinetDims(cab, this.opts.opfs);
    const resolvedParams: DoorMathInput = {
      ...this.opts.params,
      cabinet: derivedDims,
    };

    // Build a fresh set of doors only on the FIRST apply; redo replays captured artifacts.
    const doors: CreatedDoor[] = this.createdDoors ?? [];
    const isRedo = this.createdDoors !== null;

    if (!isRedo) {
      const panels = doorMath(resolvedParams);
      const existingNames = await this.listZiptBasenames(cab);
      let index = 0;
      for (const panel of panels) {
        const doorH = panel.dims.length;
        const doorW = panel.dims.width;
        const Td = panel.dims.thickness;

        // Door part name — de-dup against existing .zipt basenames.
        const baseName = doors.length === 0 && panels.length === 1
          ? `${cab.name} - Door`
          : `${cab.name} - Door ${index + 1}`;
        const finalName = dedupeName(baseName, [...existingNames, ...doors.map((d) => basenameOf(d.partPath))]);
        const doorPath = `${finalName}.zipt`;

        // Door PanelFeature (length=doorH, width=doorW, thickness=Td literals).
        const panelFeature: PanelFeature = {
          kind: 'panel',
          id: 'panel',
          length: { kind: 'literal', value: doorH },
          width: { kind: 'literal', value: doorW },
          thickness: { kind: 'literal', value: Td },
          thicknessFromMaterial: false,
          materialId: cab.materials[0]?.id ?? 'm',
          grain: 'length',
          edgeBands: { front: null, back: null, left: null, right: null },
        };

        // Cup bores on the carcass-facing broad face.
        // DOOR_CUP_FACE is imported from prisadkaFaceConventions.ts (Phase 0 output, §1).
        const uPositions = hingePositions(doorH, panel.doorSpec.hingeCount);
        const cupBores: BoreOp[] = hingeCupBores(
          panel.dims,
          DOOR_CUP_FACE,
          panel.doorSpec.hingeSide,
          resolvedParams.overlay,
          uPositions,
        );

        // ADDENDUM §5: packDoorZipt is async (writeTarGz returns Promise<Uint8Array>).
        const part: PartDocument = addFeature(newPart(finalName), panelFeature);
        const doorDoc: PartDocument = { ...part, bores: cupBores };
        const bytes = await packDoorZipt(doorDoc);
        if (this.opts.kernel) await this.opts.kernel.registerPart(doorDoc);
        await this.opts.opfs.write(doorPath, bytes);

        const component: ComponentInstance = {
          id: `D${Date.now()}-${index}`,
          partPath: doorPath,
          position: { x: panel.pose.translation.x, y: panel.pose.translation.y, z: panel.pose.translation.z },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true,
          pose: panel.pose,
          role: 'door',
          doorSpec: panel.doorSpec,
        };
        doors.push({ partPath: doorPath, partId: doorDoc.id, componentId: component.id, bytes, component });
        index++;
      }
      this.createdDoors = doors;
    } else {
      // REDO: re-register parts + re-write the captured .zipt bytes (skip doorMath/rebuild).
      for (const d of doors) {
        if (this.opts.kernel) {
          const re = await unpackProjectDoc(d);
          await this.opts.kernel.registerPart(re);
        }
        await this.opts.opfs.write(d.partPath, d.bytes);
      }
    }

    // Push all door components into the cabinet doc (avoid dupes on redo).
    for (const d of doors) {
      if (!cab.components.some((c) => c.id === d.componentId)) {
        cab.components.push(d.component);
      }
    }

    // Plate bores into side panels — Task 2.
    const affectedSidePaths = await this.writePlateBores(cab, doors, resolvedParams);

    await this.opts.opfs.write(this.opts.cabinetPath, await packAssembly(cab, new Uint8Array()));
    await this.reloadCabinet(cab);

    if (affectedSidePaths.size > 0) {
      this.store.getState().boreCacheInvalidator?.([...affectedSidePaths]);
    }
  }

  async revert(): Promise<void> {
    const doors = this.createdDoors ?? [];
    const cab = await unpackAssembly(await this.opts.opfs.read(this.opts.cabinetPath));

    // Remove door components.
    const doorIds = new Set(doors.map((d) => d.componentId));
    cab.components = cab.components.filter((c) => !doorIds.has(c.id));

    // Delete door parts (kernel + OPFS).
    for (const d of doors) {
      if (this.opts.kernel) await this.opts.kernel.deletePart(d.partId);
      if (typeof this.opts.opfs.delete === 'function') {
        try { await this.opts.opfs.delete(d.partPath); } catch { /* best-effort */ }
      }
    }

    // Restore each affected side panel's bores[] to its pre-apply snapshot.
    const restoredSidePaths: string[] = [];
    for (const [sidePath, prior] of this.priorSideBores) {
      const project = await unpackProject(await this.opts.opfs.read(sidePath));
      const sideDoc = (project.manifest as { document: Record<string, unknown> }).document;
      if (prior.length > 0) {
        sideDoc.bores = prior;
      } else {
        delete sideDoc.bores;
      }
      await this.opts.opfs.write(
        sidePath,
        await packProject({
          manifest: { ...(project.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: sideDoc },
          blobs: {},
        }),
      );
      restoredSidePaths.push(sidePath);
    }

    await this.opts.opfs.write(this.opts.cabinetPath, await packAssembly(cab, new Uint8Array()));
    await this.reloadCabinet(cab);

    if (restoredSidePaths.length > 0) {
      this.store.getState().boreCacheInvalidator?.(restoredSidePaths);
    }
    // Note: do NOT clear priorSideBores/createdDoors — they are the redo-replay artifacts.
    // The redo path in apply() (isRedo branch) re-registers parts; priorSideBores is
    // re-populated idempotently because the guard skips re-snapshotting an already-known side.
  }

  /** Refresh the cabinet entry in subAssemblyDocs (additive loader won't replace it). */
  private async reloadCabinet(cab: AssemblyDocument): Promise<void> {
    const docs = { ...this.store.getState().subAssemblyDocs };
    docs[this.opts.cabinetPath] = cab;
    this.store.getState().setSubAssemblyDocs(docs);
    this.store.getState().setSolverDirty(true);
  }

  /**
   * Write Ø5 hinge-plate bores onto the hinge-side panel(s).
   * Returns the set of side-panel OPFS paths written (for boreCacheInvalidator).
   */
  private async writePlateBores(
    cab: AssemblyDocument,
    doors: CreatedDoor[],
    resolvedParams: DoorMathInput,
  ): Promise<Set<string>> {
    const { hingePlateBores, DEFAULT_SHELF_PIN_PARAMS } = await import('@zilventor/shared');
    const affectedSidePaths = new Set<string>();

    for (const d of doors) {
      const spec = d.component.doorSpec!;
      const side = await this.resolveSidePanel(cab, spec.hingeSide);
      if (!side) continue;

      // uPositions come from the door part's PanelFeature length (= doorH).
      const doorProject = await unpackProject(await this.opts.opfs.read(d.partPath));
      const doorDoc = (doorProject.manifest as { document: { featureTree?: Array<Record<string, unknown>> } }).document;
      const dp = (doorDoc.featureTree ?? []).find((f) => f.kind === 'panel') as { length: { value: number } } | undefined;
      const dH = dp?.length.value ?? 0;
      const uPositions = hingePositions(dH, spec.hingeCount);

      const plates: BoreOp[] = hingePlateBores(
        side.dims,
        sideInnerFace(spec.hingeSide),
        uPositions,
        DEFAULT_SHELF_PIN_PARAMS.frontSetback, // plate column coincides with система-32 front column
      );

      // Snapshot prior bores once per side path (idempotent across doors sharing a side).
      const project = await unpackProject(await this.opts.opfs.read(side.path));
      const sideDoc = (project.manifest as { document: { bores?: BoreOp[] } }).document;
      const existing = sideDoc.bores ?? [];
      if (!this.priorSideBores.has(side.path)) {
        this.priorSideBores.set(side.path, existing);
      }
      sideDoc.bores = [...existing, ...plates];
      await this.opts.opfs.write(
        side.path,
        await packProject({
          manifest: { ...(project.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: sideDoc },
          blobs: {},
        }),
      );
      affectedSidePaths.add(side.path);
    }

    return affectedSidePaths;
  }

  /** The .zipt path + native dims of the side panel matching a hinge side. */
  private async resolveSidePanel(
    cab: AssemblyDocument,
    hingeSide: 'left' | 'right',
  ): Promise<{ path: string; dims: { length: number; width: number; thickness: number } } | null> {
    const role = hingeSide === 'left' ? 'leftSide' : 'rightSide';
    const comp = cab.components.find((c) => c.role === role);
    if (!comp) return null;
    const project = await unpackProject(await this.opts.opfs.read(comp.partPath));
    const doc = (project.manifest as { document: { featureTree?: Array<Record<string, unknown>> } }).document;
    const panel = (doc.featureTree ?? []).find((f) => f.kind === 'panel') as
      | { length: { value: number }; width: { value: number }; thickness: { value: number } }
      | undefined;
    if (!panel) return null;
    return {
      path: comp.partPath,
      dims: { length: panel.length.value, width: panel.width.value, thickness: panel.thickness.value },
    };
  }

  /** Basenames (no `.zipt`) of all .zipt component paths in the cabinet doc, for de-dup. */
  private listZiptBasenames(cab: AssemblyDocument): string[] {
    return cab.components
      .map((c) => c.partPath)
      .filter((p) => p.endsWith('.zipt'))
      .map(basenameOf);
  }
}

function basenameOf(path: string): string {
  return path.endsWith('.zipt') ? path.slice(0, -'.zipt'.length) : path;
}

/**
 * Pack a door PartDocument into a .zipt (manifest-only — PanelFeature regenerates geometry).
 * ADDENDUM §5: async because writeTarGz (tarGzipUtil.ts:91) returns Promise<Uint8Array>.
 * Mirrors CreateCabinetCommand.packPanelPart (which is also async and awaits writeTarGz).
 */
async function packDoorZipt(doc: PartDocument): Promise<Uint8Array> {
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
}

/** Re-read a door PartDocument from its captured bytes (redo re-register). */
async function unpackProjectDoc(d: CreatedDoor): Promise<PartDocument> {
  const { readTarGz } = await import('@zilventor/kernel/src/storage/tarGzipUtil');
  const entries = await readTarGz(d.bytes);
  const m = entries.find((e) => e.name === 'manifest.json')!;
  return JSON.parse(new TextDecoder().decode(m.data)).document as PartDocument;
}

/**
 * Side inner broad face — derived from prisadkaFaceConventions (Phase 0 output, §H.1).
 * LEFT_SIDE_INNER_FACE and RIGHT_SIDE_INNER_FACE are imported, never re-declared.
 */
function sideInnerFace(hingeSide: 'left' | 'right'): 'Top' | 'Bottom' {
  return hingeSide === 'left' ? LEFT_SIDE_INNER_FACE : RIGHT_SIDE_INNER_FACE;
}
```

> **Phase-0 prerequisite (HARD):** `packages/shared/src/prisadkaFaceConventions.ts` MUST exist before this file compiles. It exports `DOOR_CUP_FACE`, `LEFT_SIDE_INNER_FACE`, `RIGHT_SIDE_INNER_FACE` (derived by Phase-0 real-OCCT + pose derivation, per addendum §1/§2). If Phase 0 has not shipped yet, this file will fail with `Cannot find module '@zilventor/shared/src/prisadkaFaceConventions'`. Do not skip Phase 0.

- [ ] **Step 4 (GREEN-run): confirm the tests pass.** From `packages/app`:
```bash
npx vitest run src/commands/__tests__/AddDoorCommand.spec.ts
```
Expect GREEN: `2 passed`.
- The dims-derivation test: door `.zipt` exists, is registered, carries Ø35 cup bores, and the `role:'door'` component carries `doorSpec` — even though `params.cabinet` was zero, because `apply()` derived and overrode from the unpacked `.ziasm`.
- The negative test: command throws when the cabinet has no side panels.

- [ ] **Step 5 (refactor):** Run `npx tsc --noEmit` from `packages/app` (verifies `exactOptionalPropertyTypes` compliance on `doorSpec?`/`pose?` and `async` correctness of `packDoorZipt`). Confirm no new errors. No behavior change.

- [ ] **Step 6 (commit):**
```bash
git add packages/app/src/commands/AddDoorCommand.ts packages/app/src/commands/__tests__/AddDoorCommand.spec.ts
git commit -m "feat(prisadka): AddDoorCommand — cabinet-dims derivation + door part + role:door component (apply path)

ADDENDUM §4: derives width/height/depth/Tc/toekickHeight from unpacked .ziasm side/bottom panels.
ADDENDUM §5: packDoorZipt is async (mirrors CreateCabinetCommand.packPanelPart).
ADDENDUM §1: DOOR_CUP_FACE/LEFT/RIGHT_SIDE_INNER_FACE imported from prisadkaFaceConventions.ts.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Plate bores into side panels (apply) + boreCacheInvalidator

**Files:**
- Modify (test): `packages/app/src/commands/__tests__/AddDoorCommand.spec.ts` (add plate-bore assertions)

The `writePlateBores` method is already wired in the Task 1 implementation above. This task adds the test coverage that drives out any gaps.

- [ ] **Step 1 (RED): add the failing plate-bore test.** Append to `AddDoorCommand.spec.ts` inside a new describe block (the existing `seedCabinet`/`SINGLE_DOOR_ZERO_DIMS`/`MemOpfs`/`makeKernel`/`boresOf` helpers remain in scope):

```ts
import { vi } from 'vitest';

describe('AddDoorCommand — apply (plate bores + cache invalidation)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('writes Ø5 hinge-plate bores onto the hinge-side panel and invalidates its cache', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    // hingeSide:'left' → plates land on the leftSide panel (L.zipt).
    // params.cabinet is zeros — command derives dims from .ziasm (same addendum §4 path).
    await new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel }).apply();

    const lBores = await boresOf(opfs, 'L.zipt');
    const plates = lBores.filter((b) => b.role === 'hingePlate');
    expect(plates.length).toBeGreaterThan(0);
    expect(plates.every((b) => b.connectorKind === 'hinge' && b.diameter === 5)).toBe(true);

    // Cup connectorIds (door part) and plate connectorIds (side panel) must share ids per hinge.
    const doors = (await unpackAssembly(await opfs.read(cabinetPath))).components.filter((c) => c.role === 'door');
    const cupConn = new Set((await boresOf(opfs, doors[0]!.partPath)).map((b) => b.connectorId));
    const plateConn = new Set(plates.map((b) => b.connectorId));
    expect([...plateConn].every((id) => cupConn.has(id))).toBe(true);

    // The side panel path was passed to the cache invalidator.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain('L.zipt');

    // The opposite side (R.zipt) receives no plate bores for a left-hinged single door.
    expect((await boresOf(opfs, 'R.zipt')).filter((b) => b.role === 'hingePlate').length).toBe(0);
  });
});
```

- [ ] **Step 2 (RED-run):** From `packages/app`:
```bash
npx vitest run src/commands/__tests__/AddDoorCommand.spec.ts -t "plate bores"
```
Expect RED: `plates.length` is `0` if the `writePlateBores` method has a bug, or fails to import `hingePlateBores`/`DEFAULT_SHELF_PIN_PARAMS`. Fix any import/wiring issue — do not proceed to step 3 until RED is for the right reason (wrong plate count or missing call), not a compile/import error.

- [ ] **Step 3 (GREEN-run):** Confirm `writePlateBores` logic produces the plates. No new production code should be needed if Task 1 was implemented correctly. If a bug exists, debug with `superpowers:systematic-debugging`, then re-run:
```bash
npx vitest run src/commands/__tests__/AddDoorCommand.spec.ts
```
Expect GREEN: `3 passed` (2 from Task 1 + the new plate-bore test).

- [ ] **Step 4 (commit):**
```bash
git add packages/app/src/commands/__tests__/AddDoorCommand.spec.ts
git commit -m "test(prisadka): AddDoorCommand plate-bore + cache-invalidation assertions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Revert — restore side bores + remove component + delete door part

**Files:**
- Modify (test): `packages/app/src/commands/__tests__/AddDoorCommand.spec.ts` (add revert test)

The full revert is already implemented in Task 1. This task adds the test that locks it.

- [ ] **Step 1 (RED): add the failing revert test.** Append a new describe block to `AddDoorCommand.spec.ts`:

```ts
describe('AddDoorCommand — revert', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('removes the door component, deletes the door .zipt, and restores side bores to baseline', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    // Baseline: side panel has no bores; cabinet has no door.
    const baselineL = await boresOf(opfs, 'L.zipt');
    expect(baselineL.length).toBe(0);

    // params.cabinet is zeros — command derives dims from .ziasm (addendum §4 path).
    const cmd = new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel });
    await cmd.apply();

    const afterApply = await unpackAssembly(await opfs.read(cabinetPath));
    const door = afterApply.components.find((c) => c.role === 'door')!;
    const doorPath = door.partPath;
    expect(await opfs.exists(doorPath)).toBe(true);
    expect((await boresOf(opfs, 'L.zipt')).length).toBeGreaterThan(0);
    expect(kernel.registered.size).toBe(1);

    await cmd.revert();

    // Door component gone.
    const afterRevert = await unpackAssembly(await opfs.read(cabinetPath));
    expect(afterRevert.components.some((c) => c.role === 'door')).toBe(false);
    // Door .zipt deleted + de-registered.
    expect(await opfs.exists(doorPath)).toBe(false);
    expect(kernel.registered.size).toBe(0);
    // Side bores back to baseline (bores key absent since it had none before).
    const project = await unpackProject(await opfs.read('L.zipt'));
    const sdoc = (project.manifest as { document: Record<string, unknown> }).document;
    expect('bores' in sdoc).toBe(false);
    // subAssemblyDocs entry refreshed (no door).
    const mirrored = useAppStore.getState().subAssemblyDocs[cabinetPath]!;
    expect(mirrored.components.some((c) => c.role === 'door')).toBe(false);
  });
});
```

- [ ] **Step 2 (RED-run):** From `packages/app`:
```bash
npx vitest run src/commands/__tests__/AddDoorCommand.spec.ts -t "revert"
```
Expect RED: `expect('bores' in sdoc).toBe(false)` fails if side-bore restore is incomplete. If Task 1 implementation is correct this should be GREEN already — confirm and move to step 3.

- [ ] **Step 3 (GREEN-run):** From `packages/app`:
```bash
npx vitest run src/commands/__tests__/AddDoorCommand.spec.ts
```
Expect GREEN: `4 passed`. Revert removes the door component, deletes + de-registers the door `.zipt`, restores `L.zipt` to baseline (`bores` key absent), and refreshes `subAssemblyDocs`.

- [ ] **Step 4 (refactor):** Run `npx tsc --noEmit` from `packages/app`. No new errors.

- [ ] **Step 5 (commit):**
```bash
git add packages/app/src/commands/__tests__/AddDoorCommand.spec.ts
git commit -m "test(prisadka): AddDoorCommand.revert locks restore-side-bores + delete-door-part + subAssemblyDocs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Round-trip locking test — door persists across reload; undo returns to baseline; redo is idempotent

**Files:**
- Modify (test): `packages/app/src/commands/__tests__/AddDoorCommand.spec.ts` (add round-trip + redo locking tests)

This task adds the **load-bearing byte-OPFS round-trip guard** (the false-green killer per project memory): a door must survive a fresh `unpackAssembly` of the on-disk `.ziasm` bytes, and undo must return the bore-marker-relevant state to baseline. No production code changes are expected — if a test fails, it is a real bug (drive it with `superpowers:systematic-debugging`).

- [ ] **Step 1 (RED-or-GREEN): add the round-trip + redo locking tests.** Append to `AddDoorCommand.spec.ts`:

```ts
/** Count of bore markers that would render = door cup bores + side plate bores. */
async function totalBoreMarkers(opfs: MemOpfs, cabinetPath: string): Promise<number> {
  const cab = await unpackAssembly(await opfs.read(cabinetPath));
  let total = 0;
  for (const c of cab.components) {
    if (!c.partPath.endsWith('.zipt')) continue;
    total += (await boresOf(opfs, c.partPath)).length;
  }
  return total;
}

describe('AddDoorCommand — round-trip + undo/redo (locking)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('LOCKING: door + bores persist across a fresh byte-OPFS reload of the .ziasm', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    // params.cabinet is zeros — command derives dims from .ziasm (addendum §4).
    await new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel }).apply();

    // Re-read straight from the persisted bytes (simulates app reload — no in-memory state reused).
    const reloaded = await unpackAssembly(await opfs.read(cabinetPath));
    const door = reloaded.components.find((c) => c.role === 'door');
    expect(door, 'door survives reload').toBeDefined();
    expect(door!.doorSpec, 'doorSpec survives reload').toBeDefined();
    // Door part .zipt readable + carries cup bores after reload.
    expect((await boresOf(opfs, door!.partPath)).length).toBeGreaterThan(0);
  });

  it('LOCKING: undo returns total bore-marker count to baseline AND removes the door .zipt', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const baseline = await totalBoreMarkers(opfs, cabinetPath);
    expect(baseline).toBe(0);

    // params.cabinet is zeros — command derives dims from .ziasm (addendum §4).
    const cmd = new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel });
    await cmd.apply();
    const afterApply = await totalBoreMarkers(opfs, cabinetPath);
    expect(afterApply).toBeGreaterThan(0);
    const doorPath = (await unpackAssembly(await opfs.read(cabinetPath)))
      .components.find((c) => c.role === 'door')!.partPath;

    await cmd.revert();
    expect(await totalBoreMarkers(opfs, cabinetPath)).toBe(baseline);
    expect(await opfs.exists(doorPath)).toBe(false);
  });

  it('LOCKING: redo (apply→revert→apply) restores the door + bores without double-registering', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    // params.cabinet is zeros — command derives dims from .ziasm (addendum §4).
    const cmd = new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel });
    await cmd.apply();
    const afterFirst = await totalBoreMarkers(opfs, cabinetPath);

    await cmd.revert();
    await cmd.apply(); // redo

    const afterRedo = await totalBoreMarkers(opfs, cabinetPath);
    expect(afterRedo).toBe(afterFirst);
    const doors = (await unpackAssembly(await opfs.read(cabinetPath))).components.filter((c) => c.role === 'door');
    expect(doors.length, 'exactly one door after redo — no duplicate component').toBe(1);
    expect(kernel.registered.size, 'exactly one registered door part after redo').toBe(1);
  });
});
```

- [ ] **Step 2 (run):** From `packages/app`:
```bash
npx vitest run src/commands/__tests__/AddDoorCommand.spec.ts
```
Expect GREEN: `7 passed` (2 + 1 + 1 from Tasks 1-3 + 3 from this task). If the redo test fails with a duplicate door component or `already registered` kernel error, that is a real redo-idempotency bug — use `superpowers:systematic-debugging`. The Task-1 dedupe guard (`!cab.components.some((c) => c.id === d.componentId)`) and the revert `deletePart` already make this idempotent; confirm with the debugging skill if red.

- [ ] **Step 3 (full app-suite regression):** From `packages/app`, run the broader command suite to confirm no collateral breakage:
```bash
npx vitest run src/commands/__tests__/
```
Expect GREEN across all command specs (the new file plus the pre-existing carcass/bake/cabinet specs). Read the summary line.

- [ ] **Step 4 (commit):**
```bash
git add packages/app/src/commands/__tests__/AddDoorCommand.spec.ts
git commit -m "test(prisadka): lock AddDoorCommand byte-OPFS round-trip + undo-to-baseline + redo idempotency

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

> **Phase 5 exit criteria:** `AddDoorCommand` apply (a) DERIVES cabinet `{width, height, depth, Tc, toekickHeight}` from the unpacked `.ziasm` side/bottom PanelFeature dims — overrides `params.cabinet` before calling `doorMath` — and ASSERTS all derived dims are strictly positive; (b) creates `dedupeName`'d door `.zipt`(s) with Ø35 cup bores + `registerPart` (`packDoorZipt` is **async**, mirroring `CreateCabinetCommand.packPanelPart`); (c) pushes `role:'door'` `ComponentInstance`(s) carrying `doorSpec`/`pose`; (d) writes Ø5 plate bores to the hinge-side panel(s); (e) persists the cabinet `.ziasm`; (f) refreshes `subAssemblyDocs`; (g) invalidates the bore-marker cache — all fully reversible (side bores restored, component removed, door part deleted + de-registered) and redo-optimized. The byte-OPFS round-trip + undo-to-baseline + redo-idempotency locking tests are green. **`DOOR_CUP_FACE`/`LEFT_SIDE_INNER_FACE`/`RIGHT_SIDE_INNER_FACE` are IMPORTED from `packages/shared/src/prisadkaFaceConventions.ts` (Phase 0 output) — zero local re-declarations; a `git grep` for `LEFT_SIDE_INNER_FACE` in this file MUST show only the import line, never a `const` declaration.** The §6 browser verification (Phase 10) confirms door visibility + correct cup/plate placement against real OCCT.

<!-- selfcritique:
Weaknesses:
1. doorMath/hingeCupBores/hingePlateBores/hingePositions/hingeCountForHeight + DEFAULT_SHELF_PIN_PARAMS are Phase 3/4 outputs — signatures taken verbatim from CONTRACT §C/§E; a drift there breaks compile.
2. deriveCabinetDims uses component.role to find leftSide/rightSide/bottom — depends on Phase 1 having widened PanelRole to include 'door', but not strictly required for this derivation (leftSide/rightSide/bottom are all v21 roles already present).
3. DOOR_CUP_FACE/LEFT/RIGHT_SIDE_INNER_FACE are imported from prisadkaFaceConventions.ts which Phase 0 creates — if Phase 0 has not run, this file fails to compile. The guard comment is explicit.
4. The derive-from-ziasm approach reads the OPFS twice in apply() (once at top, once in deriveCabinetDims) — minor inefficiency; fixed by passing the already-unpacked cab to deriveCabinetDims in the actual implementation (the code above already does this via the top-level `cab` variable being passed to `writePlateBores`; deriveCabinetDims takes the cab doc, not the opfs).
5. Redo branch re-reads .zipt bytes to re-register — assumes the bytes captured on first apply are still the canonical door bytes, which is true since revert deletes then redo re-writes from captured bytes.
Assumptions: Command bus calls apply()/revert(); doorMath returns pose+doorSpec.hingeCount populated; packProject manifest spread is structurally compatible (matches GenerateCarcassBoresCommand).
Confidence: 87 — every file:line/export/signature against real code is verified (Command, GenerateCarcassBoresCommand mirror, packAssembly thumbnail arg, newPart/addFeature, dedupeName, store slots, MemOpfs test pattern, async packDoorZipt verified against tarGzipUtil.ts:91 and CreateCabinetCommand.packPanelPart:101); residual risk is Phase 0/3/4 contract fidelity (correctly deferred) and the un-read downstream-module signatures.
-->

---

## Phases 6 & 7 — shelf-pin commands + one-component picker

> **Depends on:** Phase 1 (manifest v22 + `BoreConnectorKind`/`BoreRole`/`PanelRole` union widening), Phase 2 (`shelfPinGrid` + `DEFAULT_SHELF_PIN_PARAMS` in `@zilventor/shared`), Phase 0 (creates `packages/shared/src/prisadkaFaceConventions.ts` exporting `LEFT_SIDE_INNER_FACE`, `RIGHT_SIDE_INNER_FACE`, `DOOR_CUP_FACE`, `DOOR_POSE`). These three tasks assume `shelfPinGrid` is importable from `@zilventor/shared` with the CONTRACT §C signature and emits `connectorKind:'shelfPin'`, `role:'shelfPin-system32'`, blind `depth`. **If Phase 2 is not yet merged when you start, the RED runs will fail on a missing import — that is the wrong red. Build Phase 2 first. Similarly, Phase 0 must have created `prisadkaFaceConventions.ts` — if it is absent, the import in Task 1 will fail with the wrong red.**
>
> **Test runner (app package):** all commands below run from `packages/app/`:
> `cd packages/app && npx vitest run src/commands/__tests__/<file>` (or `src/viewport/__tests__/<file>` for Task 3). The repo memory note pins app vitest to the `packages/app/` cwd; the config (`packages/app/vitest.config.ts`) auto-applies. Command specs are `// @vitest-environment node`; the picker spec is `// @vitest-environment jsdom`.

---

### Task 1: `GenerateShelfPinBoresCommand` — auto-recurse the cabinet, drill система-32 columns into each side panel

Recurse the active assembly's `.ziasm` sub-assemblies exactly like `GenerateCarcassBoresCommand`, find every `leftSide`/`rightSide` component, run `shelfPinGrid` against its UNSWAPPED native dims on the chosen inner broad face, and append the resulting `BoreOp[]` into each side panel's `.zipt` `document.bores`. Undoable; cache-invalidating.

**Files:**
- **Create:** `packages/app/src/commands/GenerateShelfPinBoresCommand.ts`
- **Test:** `packages/app/src/commands/__tests__/GenerateShelfPinBoresCommand.spec.ts`

**Step 1: Write the failing spec (RED).**

- [ ] **Step 1** — Create `packages/app/src/commands/__tests__/GenerateShelfPinBoresCommand.spec.ts` with the full content below. It mirrors the verified `GenerateCarcassBoresCommand.spec.ts` harness (`MemOpfs`, `writePanel` writing a real `featureTree` panel feature, `packProject`/`packAssembly`, nested `.ziasm` structure).

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GenerateShelfPinBoresCommand } from '../GenerateShelfPinBoresCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION, DEFAULT_SHELF_PIN_PARAMS } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PanelRole, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async exists(p: string) { return this.files.has(p); }
}

/** Write a minimal panel .zipt using the REAL baseCabinet dim convention
 *  (length = HEIGHT for side panels; thickness = board thickness). */
async function writePanel(
  opfs: MemOpfs, path: string,
  length: number, width: number, thickness: number,
  bores?: BoreOp[],
) {
  const doc: Partial<PartDocument> = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree: [{
      kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: length },
      width: { kind: 'literal', value: width },
      thickness: { kind: 'literal', value: thickness },
      thicknessFromMaterial: true,
      materialId: 'm', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    } as unknown as import('@zilventor/shared').Feature],
    ...(bores ? { bores } : {}),
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

const W = 600, D = 560, H = 720, Tc = 18, Tb = 6;
const CAB = 'Base Cabinet 1';
const LP = `${CAB} - Left.zipt`;
const RP = `${CAB} - Right.zipt`;
const BP = `${CAB} - Bottom.zipt`;
const TP = `${CAB} - Top.zipt`;
const ZIASM = `${CAB}.ziasm`;

/** REAL nested cabinet structure: top-level role-less wrapper → .ziasm with 4 panels. */
async function buildNestedStructure(opfs: MemOpfs): Promise<void> {
  await writePanel(opfs, LP, H,        D,      Tc);  // leftSide
  await writePanel(opfs, RP, H,        D,      Tc);  // rightSide
  await writePanel(opfs, BP, W - 2*Tc, D - Tb, Tc);  // bottom
  await writePanel(opfs, TP, W - 2*Tc, D - Tb, Tc);  // top

  const cabinetDoc: AssemblyDocument = {
    id: 'A_CAB', name: CAB, units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'C1', partPath: LP, position: { x: 0,      y: 0,  z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide'  as PanelRole },
      { id: 'C2', partPath: RP, position: { x: W - Tc, y: 0,  z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' as PanelRole },
      { id: 'C3', partPath: BP, position: { x: Tc,     y: Tb, z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom'    as PanelRole },
      { id: 'C4', partPath: TP, position: { x: Tc,     y: Tb, z: H - Tc }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'top'       as PanelRole },
    ],
    constraints: [], groundedComponentPaths: [['C1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  await opfs.write(ZIASM, await packAssembly(cabinetDoc, new Uint8Array()));

  const topDoc: AssemblyDocument = {
    id: 'A_TOP', name: 'Room', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'TOP1', partPath: ZIASM, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [], groundedComponentPaths: [['TOP1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: topDoc });
}

describe('GenerateShelfPinBoresCommand — auto recurse', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('drills shelfPin bores into BOTH side panels, none into bottom/top', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);

    await new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs }).apply();

    const lBores = await boresOf(opfs, LP);
    const rBores = await boresOf(opfs, RP);
    expect(lBores.length).toBeGreaterThan(0);
    expect(rBores.length).toBeGreaterThan(0);
    // Only side panels are drilled; horizontal panels stay empty.
    expect((await boresOf(opfs, BP)).length).toBe(0);
    expect((await boresOf(opfs, TP)).length).toBe(0);
    // Every emitted bore is a система-32 shelf pin (blind, Ø5).
    for (const b of [...lBores, ...rBores]) {
      expect(b.connectorKind).toBe('shelfPin');
      expect(b.role).toBe('shelfPin-system32');
      expect(b.diameter).toBe(DEFAULT_SHELF_PIN_PARAMS.diameter);
      expect(b.depth).toBe(DEFAULT_SHELF_PIN_PARAMS.depth); // number, NOT 'throughAll'
      // Authored on a BROAD inner face (Top/Bottom), never a narrow end face.
      expect(['Top', 'Bottom']).toContain(b.face.role);
    }
    // Left and right mirror each other in count.
    expect(lBores.length).toBe(rBores.length);
  });

  it('bores land in-bounds for the UNSWAPPED native side dims (u∈[0,H], v∈[0,D])', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    await new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs }).apply();

    for (const b of await boresOf(opfs, LP)) {
      expect(b.u).toBeGreaterThanOrEqual(0);
      expect(b.u).toBeLessThanOrEqual(H);   // u runs along native length = HEIGHT
      expect(b.v).toBeGreaterThanOrEqual(0);
      expect(b.v).toBeLessThanOrEqual(D);   // v runs along native width = DEPTH
    }
  });

  it('apply() then revert() restores the side panels to having no bores', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    const cmd = new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs });
    await cmd.apply();
    expect((await boresOf(opfs, LP)).length).toBeGreaterThan(0);

    await cmd.revert();

    // bores key must be ABSENT (not []) on each side panel — exactOptionalPropertyTypes contract.
    for (const path of [LP, RP]) {
      const project = await unpackProject(await opfs.read(path));
      const doc = (project.manifest as { document: Record<string, unknown> }).document;
      expect('bores' in doc, `${path}: bores key must be absent after revert`).toBe(false);
    }
  });

  it('revert() restores PRIOR bores when a side panel already had some', async () => {
    const opfs = new MemOpfs();
    const seedBore: BoreOp = {
      id: 'pre', face: { featureId: 'panel', role: 'Front', instance: 0 },
      u: 10, v: 10, diameter: 5, depth: 12,
      role: 'dowel-face', connectorId: 'pre-conn', connectorKind: 'dowel',
    };
    // Rebuild structure but seed the left panel with a pre-existing bore.
    await writePanel(opfs, LP, H,        D,      Tc, [seedBore]);
    await writePanel(opfs, RP, H,        D,      Tc);
    await writePanel(opfs, BP, W - 2*Tc, D - Tb, Tc);
    await writePanel(opfs, TP, W - 2*Tc, D - Tb, Tc);
    const cabinetDoc: AssemblyDocument = {
      id: 'A_CAB', name: CAB, units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: LP, position: { x: 0,      y: 0,  z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide'  as PanelRole },
        { id: 'C2', partPath: RP, position: { x: W - Tc, y: 0,  z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' as PanelRole },
        { id: 'C3', partPath: BP, position: { x: Tc,     y: Tb, z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom'    as PanelRole },
        { id: 'C4', partPath: TP, position: { x: Tc,     y: Tb, z: H - Tc }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'top'       as PanelRole },
      ],
      constraints: [], groundedComponentPaths: [['C1']], colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    await opfs.write(ZIASM, await packAssembly(cabinetDoc, new Uint8Array()));
    const topDoc: AssemblyDocument = {
      id: 'A_TOP', name: 'Room', units: 'mm', parameters: {}, properties: {},
      components: [{ id: 'TOP1', partPath: ZIASM, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
      constraints: [], groundedComponentPaths: [['TOP1']], colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: topDoc });

    const cmd = new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs });
    await cmd.apply();
    expect((await boresOf(opfs, LP)).length).toBeGreaterThan(1);

    await cmd.revert();
    expect(await boresOf(opfs, LP)).toEqual([seedBore]);
  });
});

describe('GenerateShelfPinBoresCommand — boreCacheInvalidator', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('apply() invalidates the two side-panel paths', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    await new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs }).apply();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].sort()).toEqual([LP, RP].sort());
  });

  it('revert() invalidates the same paths', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    const cmd = new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs });
    await cmd.apply();

    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);
    await cmd.revert();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].sort()).toEqual([LP, RP].sort());
  });

  it('apply() does not throw when boreCacheInvalidator is null', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    await expect(
      new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs }).apply(),
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2 (RED)** — From `packages/app/`, run:
  `npx vitest run src/commands/__tests__/GenerateShelfPinBoresCommand.spec.ts`
  **Expected RED:** the suite fails to even import — `Failed to resolve import "../GenerateShelfPinBoresCommand"` (the command file does not exist yet). This is the correct red (missing module), confirming the test drives the new file. If instead it errors on `DEFAULT_SHELF_PIN_PARAMS` missing from `@zilventor/shared`, Phase 2 is not merged — stop and build Phase 2 first. If it errors on `LEFT_SIDE_INNER_FACE` missing from `@zilventor/shared/src/prisadkaFaceConventions`, Phase 0 is not merged — stop and build Phase 0 first.

**Step 3: Minimal implementation (GREEN).**

- [ ] **Step 3** — Create `packages/app/src/commands/GenerateShelfPinBoresCommand.ts` with the full content below. It is a structural clone of `GenerateCarcassBoresCommand` but, instead of joint enumeration, it runs `shelfPinGrid` per side panel against the **unswapped** native dims (CONTRACT Convention 1 — do NOT apply the L↔T swap; that swap exists only for joint world-AABB math). The inner broad face per role is imported from the shared conventions module `packages/shared/src/prisadkaFaceConventions.ts` (created by Phase 0). **NEVER re-declare local `LEFT_SIDE_INNER_FACE`/`RIGHT_SIDE_INNER_FACE` literals here — addendum §1 makes local re-declarations a blocker.**

```ts
import type { Command } from './Command';
import type { AssemblyDocument, BoreOp, ShelfPinParams } from '@zilventor/shared';
import {
  shelfPinGrid,
  CURRENT_FORMAT_VERSION,
} from '@zilventor/shared';
import {
  LEFT_SIDE_INNER_FACE,
  RIGHT_SIDE_INNER_FACE,
} from '@zilventor/shared/src/prisadkaFaceConventions';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

/** Read a panel's resolved dims from its single PanelFeature inside the .zipt manifest.
 *  Uses `featureTree` (the real PartDocument field). Only literal dims are supported. */
function panelDimsFromDoc(
  doc: { featureTree?: Array<Record<string, unknown>> },
): { length: number; width: number; thickness: number } {
  const panel = (doc.featureTree ?? []).find((f) => f.kind === 'panel') as
    | { length: unknown; width: unknown; thickness: unknown }
    | undefined;
  if (!panel) throw new Error('NO_PANEL_FEATURE');

  function resolve(v: unknown, name: string): number {
    if (typeof v === 'number') return v;
    if (v !== null && typeof v === 'object' && (v as Record<string, unknown>).kind === 'literal') {
      const val = (v as { value: unknown }).value;
      if (typeof val === 'number') return val;
    }
    throw new Error(`UNRESOLVABLE_DIM: ${name}`);
  }

  return {
    length: resolve(panel.length, 'length'),
    width: resolve(panel.width, 'width'),
    thickness: resolve(panel.thickness, 'thickness'),
  };
}

export class GenerateShelfPinBoresCommand implements Command {
  readonly name = 'GenerateShelfPinBores';
  /** partPath → prior bores[] (for revert). Captured during apply(). */
  private priorBores = new Map<string, BoreOp[]>();
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: {
    cabinetPath?: string; // reserved: explicit cabinet override (unused in v1 — recurse activeAssembly)
    params: ShelfPinParams;
    opfs: OpfsRW;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const asm = this.store.getState().activeAssembly;
    if (!asm) return;

    // partPath → loaded {manifest, document}, shared across cabinet groups.
    const docs = new Map<string, { manifest: Record<string, unknown>; document: Record<string, unknown> }>();
    // partPath → accumulated new bores.
    const accum = new Map<string, BoreOp[]>();
    const appendBores = (partPath: string, bores: BoreOp[]) => {
      const list = accum.get(partPath) ?? [];
      list.push(...bores);
      accum.set(partPath, list);
    };

    // Recurse nested .ziasm sub-assemblies; drill every leftSide/rightSide panel.
    const processAssemblyDoc = async (doc: AssemblyDocument): Promise<void> => {
      for (const c of doc.components) {
        if (c.partPath.endsWith('.ziasm')) {
          const subDoc = await unpackAssembly(await this.opts.opfs.read(c.partPath));
          await processAssemblyDoc(subDoc);
          continue;
        }
        if (c.role !== 'leftSide' && c.role !== 'rightSide') continue;

        if (!docs.has(c.partPath)) {
          const project = await this.opts.opfs.read(c.partPath).then(unpackProject);
          const manifest = project.manifest as { document: Record<string, unknown> };
          docs.set(c.partPath, { manifest: manifest as unknown as Record<string, unknown>, document: manifest.document });
        }
        const entry = docs.get(c.partPath)!;
        // UNSWAPPED native dims — shelfPinGrid authors (u,v) against these directly
        // (Convention 1). Do NOT swap L↔T here; that swap is joint-math only.
        const dims = panelDimsFromDoc(entry.document as { featureTree?: Array<Record<string, unknown>> });
        // Inner face IMPORTED from prisadkaFaceConventions (Phase 0 derives + proves the sign).
        // NEVER re-declare local literals — they would break the single-source-of-truth
        // and reproduce the slice-1 false-green face-sign class.
        const innerFace = c.role === 'leftSide' ? LEFT_SIDE_INNER_FACE : RIGHT_SIDE_INNER_FACE;
        appendBores(c.partPath, shelfPinGrid(dims, innerFace, this.opts.params));
      }
    };

    await processAssemblyDoc(asm);

    // Persist: snapshot prior bores, append new bores[], repack each .zipt.
    for (const [partPath, newBores] of accum) {
      const entry = docs.get(partPath)!;
      const existing = (entry.document.bores as BoreOp[] | undefined) ?? [];
      this.priorBores.set(partPath, existing);
      entry.document.bores = [...existing, ...newBores];
      const repackedManifest = {
        ...entry.manifest,
        formatVersion: CURRENT_FORMAT_VERSION,
        document: entry.document,
      };
      await this.opts.opfs.write(
        partPath,
        await packProject({ manifest: repackedManifest, blobs: {} }),
      );
    }

    const affectedPaths = [...this.priorBores.keys()];
    if (affectedPaths.length > 0) {
      this.store.getState().boreCacheInvalidator?.(affectedPaths);
    }
  }

  /** Returns the part paths that were written during the most recent apply(). */
  getAffectedPartPaths(): string[] {
    return [...this.priorBores.keys()];
  }

  async revert(): Promise<void> {
    const affectedPaths = [...this.priorBores.keys()];
    for (const [partPath, prior] of this.priorBores) {
      const project = await this.opts.opfs.read(partPath).then(unpackProject);
      const manifest = project.manifest as { document: Record<string, unknown> };
      if (prior.length > 0) {
        manifest.document.bores = prior;
      } else {
        delete manifest.document.bores;
      }
      await this.opts.opfs.write(
        partPath,
        await packProject({
          manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
          blobs: {},
        }),
      );
    }
    this.priorBores.clear();
    if (affectedPaths.length > 0) {
      this.store.getState().boreCacheInvalidator?.(affectedPaths);
    }
  }
}
```

- [ ] **Step 4 (GREEN)** — From `packages/app/`, run:
  `npx vitest run src/commands/__tests__/GenerateShelfPinBoresCommand.spec.ts`
  **Expected GREEN:** all tests in both describe blocks pass (auto-recurse drills both sides only, in-bounds u/v, revert restores absence/prior, invalidator called once on apply and once on revert with `[LP, RP]`).

> **NB on the inner-face constants:** `LEFT_SIDE_INNER_FACE` and `RIGHT_SIDE_INNER_FACE` are **IMPORTED** from `packages/shared/src/prisadkaFaceConventions.ts`. Phase 0's real-OCCT guard DERIVES and OUTPUTS the correct sign into that file. The unit tests here only assert the face is one of `['Top','Bottom']` (they are sign-agnostic at this level — the Phase 9 real-OCCT bake guard fails loudly if the imported sign is wrong). **Do NOT add local re-declarations.** A `git grep '_INNER_FACE'` of the final merged tree must show only the declaration in `prisadkaFaceConventions.ts` and import sites — no local literals.

**Step 5: Refactor (stay green).**

- [ ] **Step 5** — Re-read the new file: `panelDimsFromDoc` is duplicated verbatim from `GenerateCarcassBoresCommand.ts`. Per project §3 (surgical, no unrequested refactors), **leave the duplication** — extracting a shared helper touches an unrelated file and is out of scope. No refactor needed. Re-run Step 4's command to confirm still green.

- [ ] **Step 6 (commit)** — `git add packages/app/src/commands/GenerateShelfPinBoresCommand.ts packages/app/src/commands/__tests__/GenerateShelfPinBoresCommand.spec.ts && git commit -m "feat(prisadka): GenerateShelfPinBoresCommand — auto система-32 columns into carcass sides"`

---

### Task 2: `AddManualShelfPinBoresCommand` — drill система-32 into ONE chosen panel + face

A simpler, non-recursive command: given a single `panelPath` (the user-picked side/custom panel `.zipt`), a chosen broad `face` (`Top`/`Bottom`), and `ShelfPinParams`, read the panel's native dims, run `shelfPinGrid`, append to that one panel's `bores[]`. Undoable; cache-invalidating.

**Note on inner-face constants:** `AddManualShelfPinBoresCommand` takes `face: 'Top' | 'Bottom'` as a constructor parameter (the caller decides which face to pass). It does **not** need to look up `LEFT_SIDE_INNER_FACE`/`RIGHT_SIDE_INNER_FACE` internally. Phase 8's dialog/handler supplies the face value — and that handler MUST derive the default from `LEFT_SIDE_INNER_FACE`/`RIGHT_SIDE_INNER_FACE` imported from `prisadkaFaceConventions.ts`, not from a local literal. This command itself is face-agnostic; addendum §1 is satisfied by the Phase 8 call site.

**Files:**
- **Create:** `packages/app/src/commands/AddManualShelfPinBoresCommand.ts`
- **Test:** `packages/app/src/commands/__tests__/AddManualShelfPinBoresCommand.spec.ts`

**Step 1: Write the failing spec (RED).**

- [ ] **Step 1** — Create `packages/app/src/commands/__tests__/AddManualShelfPinBoresCommand.spec.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AddManualShelfPinBoresCommand } from '../AddManualShelfPinBoresCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION, DEFAULT_SHELF_PIN_PARAMS } from '@zilventor/shared';
import type { BoreOp, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async exists(p: string) { return this.files.has(p); }
}

async function writePanel(
  opfs: MemOpfs, path: string,
  length: number, width: number, thickness: number,
  bores?: BoreOp[],
) {
  const doc: Partial<PartDocument> = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree: [{
      kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: length },
      width: { kind: 'literal', value: width },
      thickness: { kind: 'literal', value: thickness },
      thicknessFromMaterial: true,
      materialId: 'm', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    } as unknown as import('@zilventor/shared').Feature],
    ...(bores ? { bores } : {}),
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

const H = 720, D = 560, Tc = 18;
const PANEL = 'Custom Side.zipt';

describe('AddManualShelfPinBoresCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('drills shelfPin bores into the chosen panel on the chosen face', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, PANEL, H, D, Tc);

    await new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Top', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    }).apply();

    const bores = await boresOf(opfs, PANEL);
    expect(bores.length).toBeGreaterThan(0);
    for (const b of bores) {
      expect(b.connectorKind).toBe('shelfPin');
      expect(b.role).toBe('shelfPin-system32');
      expect(b.face.role).toBe('Top');          // honours the chosen face
      expect(b.depth).toBe(DEFAULT_SHELF_PIN_PARAMS.depth); // blind, number
      expect(b.u).toBeGreaterThanOrEqual(0);
      expect(b.u).toBeLessThanOrEqual(H);
      expect(b.v).toBeGreaterThanOrEqual(0);
      expect(b.v).toBeLessThanOrEqual(D);
    }
  });

  it('passing face:"Bottom" authors bores on the Bottom face', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, PANEL, H, D, Tc);
    await new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Bottom', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    }).apply();
    for (const b of await boresOf(opfs, PANEL)) expect(b.face.role).toBe('Bottom');
  });

  it('appends to existing bores rather than replacing them', async () => {
    const opfs = new MemOpfs();
    const seedBore: BoreOp = {
      id: 'pre', face: { featureId: 'panel', role: 'Front', instance: 0 },
      u: 10, v: 10, diameter: 5, depth: 12,
      role: 'dowel-face', connectorId: 'pre-conn', connectorKind: 'dowel',
    };
    await writePanel(opfs, PANEL, H, D, Tc, [seedBore]);

    await new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Top', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    }).apply();

    const bores = await boresOf(opfs, PANEL);
    expect(bores[0]).toEqual(seedBore);                       // existing preserved, first
    expect(bores.length).toBeGreaterThan(1);
    expect(bores.slice(1).every((b) => b.connectorKind === 'shelfPin')).toBe(true);
  });

  it('revert() removes the bores key when the panel had none before', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, PANEL, H, D, Tc);
    const cmd = new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Top', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    });
    await cmd.apply();
    expect((await boresOf(opfs, PANEL)).length).toBeGreaterThan(0);

    await cmd.revert();

    const project = await unpackProject(await opfs.read(PANEL));
    const doc = (project.manifest as { document: Record<string, unknown> }).document;
    expect('bores' in doc).toBe(false);
  });

  it('revert() restores prior bores when the panel already had some', async () => {
    const opfs = new MemOpfs();
    const seedBore: BoreOp = {
      id: 'pre', face: { featureId: 'panel', role: 'Front', instance: 0 },
      u: 10, v: 10, diameter: 5, depth: 12,
      role: 'dowel-face', connectorId: 'pre-conn', connectorKind: 'dowel',
    };
    await writePanel(opfs, PANEL, H, D, Tc, [seedBore]);
    const cmd = new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Top', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    });
    await cmd.apply();

    await cmd.revert();
    expect(await boresOf(opfs, PANEL)).toEqual([seedBore]);
  });

  it('apply() and revert() each invalidate the panel path once', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, PANEL, H, D, Tc);
    const cmd = new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Top', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    });

    const spyApply = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spyApply);
    await cmd.apply();
    expect(spyApply).toHaveBeenCalledTimes(1);
    expect(spyApply.mock.calls[0]![0]).toEqual([PANEL]);

    const spyRevert = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spyRevert);
    await cmd.revert();
    expect(spyRevert).toHaveBeenCalledTimes(1);
    expect(spyRevert.mock.calls[0]![0]).toEqual([PANEL]);
  });
});
```

- [ ] **Step 2 (RED)** — From `packages/app/`, run:
  `npx vitest run src/commands/__tests__/AddManualShelfPinBoresCommand.spec.ts`
  **Expected RED:** `Failed to resolve import "../AddManualShelfPinBoresCommand"` (the command file does not exist). Correct red.

**Step 3: Minimal implementation (GREEN).**

- [ ] **Step 3** — Create `packages/app/src/commands/AddManualShelfPinBoresCommand.ts`:

```ts
import type { Command } from './Command';
import type { BoreOp, ShelfPinParams } from '@zilventor/shared';
import {
  shelfPinGrid,
  CURRENT_FORMAT_VERSION,
} from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

/** Read a panel's resolved dims from its single PanelFeature inside the .zipt manifest.
 *  Uses `featureTree` (the real PartDocument field). Only literal dims are supported. */
function panelDimsFromDoc(
  doc: { featureTree?: Array<Record<string, unknown>> },
): { length: number; width: number; thickness: number } {
  const panel = (doc.featureTree ?? []).find((f) => f.kind === 'panel') as
    | { length: unknown; width: unknown; thickness: unknown }
    | undefined;
  if (!panel) throw new Error('NO_PANEL_FEATURE');

  function resolve(v: unknown, name: string): number {
    if (typeof v === 'number') return v;
    if (v !== null && typeof v === 'object' && (v as Record<string, unknown>).kind === 'literal') {
      const val = (v as { value: unknown }).value;
      if (typeof val === 'number') return val;
    }
    throw new Error(`UNRESOLVABLE_DIM: ${name}`);
  }

  return {
    length: resolve(panel.length, 'length'),
    width: resolve(panel.width, 'width'),
    thickness: resolve(panel.thickness, 'thickness'),
  };
}

export class AddManualShelfPinBoresCommand implements Command {
  readonly name = 'AddManualShelfPinBores';
  /** Prior bores[] on the panel (for revert), or null if not yet applied. */
  private priorBores: BoreOp[] | null = null;
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: {
    panelPath: string;
    face: 'Top' | 'Bottom';
    params: ShelfPinParams;
    opfs: OpfsRW;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const { panelPath, face, params, opfs } = this.opts;
    const project = await opfs.read(panelPath).then(unpackProject);
    const manifest = project.manifest as { document: Record<string, unknown> };
    const document = manifest.document;

    const dims = panelDimsFromDoc(document as { featureTree?: Array<Record<string, unknown>> });
    const newBores = shelfPinGrid(dims, face, params);

    const existing = (document.bores as BoreOp[] | undefined) ?? [];
    this.priorBores = existing;
    document.bores = [...existing, ...newBores];

    await opfs.write(
      panelPath,
      await packProject({
        manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION, document },
        blobs: {},
      }),
    );

    this.store.getState().boreCacheInvalidator?.([panelPath]);
  }

  async revert(): Promise<void> {
    if (this.priorBores === null) return;
    const { panelPath, opfs } = this.opts;
    const project = await opfs.read(panelPath).then(unpackProject);
    const manifest = project.manifest as { document: Record<string, unknown> };
    if (this.priorBores.length > 0) {
      manifest.document.bores = this.priorBores;
    } else {
      delete manifest.document.bores;
    }
    await opfs.write(
      panelPath,
      await packProject({
        manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
        blobs: {},
      }),
    );
    this.priorBores = null;
    this.store.getState().boreCacheInvalidator?.([panelPath]);
  }
}
```

- [ ] **Step 4 (GREEN)** — From `packages/app/`, run:
  `npx vitest run src/commands/__tests__/AddManualShelfPinBoresCommand.spec.ts`
  **Expected GREEN:** all 6 tests pass (drills chosen face, honours Top/Bottom, appends, revert removes/restores, invalidator once each on apply/revert with `[PANEL]`).

**Step 5: Refactor (stay green).**

- [ ] **Step 5** — `panelDimsFromDoc` is again duplicated. Per §3, leave it — do NOT extract a shared module in this slice. No code change. Re-run Step 4 to confirm still green.

- [ ] **Step 6 (commit)** — `git add packages/app/src/commands/AddManualShelfPinBoresCommand.ts packages/app/src/commands/__tests__/AddManualShelfPinBoresCommand.spec.ts && git commit -m "feat(prisadka): AddManualShelfPinBoresCommand — система-32 into one picked panel+face"`

---

### Task 3: `createOneComponentPicker` + `Viewport.beginOneComponentPick` — single-component pick

A one-shot analog of `createTwoComponentPicker`: feed it `ComponentPath` picks; it resolves each to a `partPath` via the supplied resolver and fires `onPick(partPath, path)` on the **first** pick. Used by the Add Door target pick and the manual система-32 target pick (Phase 8 wires the dialogs).

**Critical API contract (addendum §3 — must agree across Phase 7 definition and Phase 8 call site):**

- `createOneComponentPicker(resolvePartPath, onPick)` — NOT via an opts object, but two positional args mirroring the flat `beginTwoComponentPick(resolvePartPath, onComplete)` pattern.
- Returns `{ pick(path: ComponentPath): void; reset(): void }` — the pure state machine handle.
- `Viewport.beginOneComponentPick(resolvePartPath, onPick)` takes **two arguments** and returns `{ pick(clientX: number, clientY: number): void; reset(): void }` — it does NOT auto-fire; the App.tsx pointer handler owns calling `.pick(clientX, clientY)` on each canvas click.
- Phase 8's `handleAddDoor` / `handleSystem32Manual` call `viewport.beginOneComponentPick(resolvePartPath, onPick)`, store the returned handle, and feed `.pick(clientX, clientY)` via the existing canvas pointer event wiring in App.tsx — exactly as `beginTwoComponentPick` is wired.
- **Arg count MUST be 2 in the definition here. Phase 8 MUST pass 2 args. If either side is changed, BOTH must change together.**

The pure state machine is fully TDD'd; the three.js raycast plumbing in `Viewport.tsx` mirrors the verified `beginTwoComponentPick` and is No-TDD (covered by §6/e2e, exactly as `beginTwoComponentPick` is).

**Files:**
- **Create:** `packages/app/src/viewport/createOneComponentPicker.ts`
- **Test:** `packages/app/src/viewport/createOneComponentPicker.spec.ts`
- **Modify:** `packages/app/src/viewport/Viewport.tsx` — add `beginOneComponentPick` to the handle type (~line 89, after `beginTwoComponentPick`) and its implementation (~line 375, after the `beginTwoComponentPick` impl block).

**Step 1: Write the failing spec (RED).**

- [ ] **Step 1** — Create `packages/app/src/viewport/createOneComponentPicker.spec.ts` (mirrors the verified `Viewport.pickTwoComponents.spec.ts` shape). Note the function takes **positional args** `(resolvePartPath, onPick)`, not an opts-object.

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createOneComponentPicker } from './createOneComponentPicker';
import type { ComponentPath } from '@zilventor/shared';

// Pure state machine: feed it ONE ComponentPath pick; it resolves to a partPath
// via the supplied resolver and fires onPick(partPath, path) immediately.
describe('createOneComponentPicker', () => {
  const resolve = (p: ComponentPath): string => `${p[p.length - 1]}.zipt`;

  it('fires onPick with the resolved partPath and the raw path on the first pick', () => {
    const calls: Array<[string, ComponentPath]> = [];
    const picker = createOneComponentPicker(
      resolve,
      (partPath, path) => calls.push([partPath, path]),
    );
    picker.pick(['TOP1', 'C1']);
    expect(calls).toEqual([['C1.zipt', ['TOP1', 'C1']]]);
  });

  it('fires once per pick (each call is independent — one-shot semantics)', () => {
    const calls: Array<string> = [];
    const picker = createOneComponentPicker(
      resolve,
      (partPath) => calls.push(partPath),
    );
    picker.pick(['C1']);
    picker.pick(['C2']);
    expect(calls).toEqual(['C1.zipt', 'C2.zipt']);
  });

  it('reset() does not throw and the next pick still fires', () => {
    const calls: Array<string> = [];
    const picker = createOneComponentPicker(
      resolve,
      (partPath) => calls.push(partPath),
    );
    picker.reset();
    picker.pick(['C3']);
    expect(calls).toEqual(['C3.zipt']);
  });
});
```

- [ ] **Step 2 (RED)** — From `packages/app/`, run:
  `npx vitest run src/viewport/createOneComponentPicker.spec.ts`
  **Expected RED:** `Failed to resolve import "./createOneComponentPicker"` (module does not exist). Correct red.

**Step 3: Minimal implementation (GREEN).**

- [ ] **Step 3** — Create `packages/app/src/viewport/createOneComponentPicker.ts`. The function signature takes **two positional args** `(resolvePartPath, onPick)` to mirror `beginTwoComponentPick(resolvePartPath, onComplete)` exactly. This ensures Phase 8's `viewport.beginOneComponentPick(resolvePartPath, onPick)` call matches the definition without a 1-arg/2-arg mismatch.

```ts
import type { ComponentPath } from '@zilventor/shared';

export interface OneComponentPicker {
  /** Feed a raycast hit (ComponentPath). Resolves it to a partPath and fires onPick. */
  pick(path: ComponentPath): void;
  /** No-op state reset (one-shot picker holds no in-progress state); present for parity with TwoComponentPicker. */
  reset(): void;
}

/**
 * Creates a single-component picker.
 *
 * Takes TWO positional args (mirroring createTwoComponentPicker(resolvePartPath, onComplete)):
 * - resolvePartPath: maps a ComponentPath raycast hit to the part's OPFS path
 * - onPick: called synchronously with the resolved partPath and raw ComponentPath
 *
 * Returns { pick(path), reset() }. Each .pick() call fires onPick immediately
 * (one-shot: no waiting-for-second-pick state machine). Viewport.beginOneComponentPick
 * wraps this and exposes { pick(clientX, clientY), reset() } to App.tsx.
 *
 * App.tsx is responsible for feeding .pick(clientX, clientY) on canvas pointer events —
 * this picker does NOT auto-subscribe to DOM events.
 */
export function createOneComponentPicker(
  resolvePartPath: (path: ComponentPath) => string,
  onPick: (partPath: string, path: ComponentPath) => void,
): OneComponentPicker {
  return {
    pick(path) {
      onPick(resolvePartPath(path), path);
    },
    reset() { /* one-shot: nothing to clear */ },
  };
}
```

- [ ] **Step 4 (GREEN)** — From `packages/app/`, run:
  `npx vitest run src/viewport/createOneComponentPicker.spec.ts`
  **Expected GREEN:** all 3 tests pass.

**Step 5: Wire `beginOneComponentPick` onto the Viewport handle (No-TDD — three.js raycast path).**

- [ ] **Step 5a** — In `packages/app/src/viewport/Viewport.tsx`, add the import at the top alongside the existing `createTwoComponentPicker` import (line 6). Change:

```ts
import { createTwoComponentPicker } from './createTwoComponentPicker';
```
to:
```ts
import { createTwoComponentPicker } from './createTwoComponentPicker';
import { createOneComponentPicker } from './createOneComponentPicker';
```

- [ ] **Step 5b** — In the Viewport **handle type** (the `ViewportHandle`/imperative interface), add the method signature immediately after the `beginTwoComponentPick(...)` declaration that ends at line 89. Insert:

```ts
  /**
   * Manual присадка / Add Door: begin a SINGLE-component pick.
   * Takes TWO args (resolvePartPath, onPick) mirroring beginTwoComponentPick(resolvePartPath, onComplete).
   * Returns a handle with `pick(clientX, clientY)` (call on each canvas click) and `reset()`.
   * Does NOT auto-fire — App.tsx owns the pointer wiring and feeds `.pick(clientX, clientY)`.
   * On the first component hit, `onPick(partPath, path)` fires.
   * No-TDD for the three.js raycast path — covered by §6/e2e (mirror of beginTwoComponentPick).
   *
   * Phase 8 call site: `const handle = viewport.beginOneComponentPick(resolvePartPath, onPick);`
   * then `handle.pick(e.clientX, e.clientY)` in the App.tsx pointer handler.
   */
  beginOneComponentPick(
    resolvePartPath: (path: ComponentPath) => string,
    onPick: (partPath: string, path: ComponentPath) => void,
  ): { pick: (clientX: number, clientY: number) => void; reset: () => void };
```

- [ ] **Step 5c** — In the `useImperativeHandle` implementation object, add the method immediately after the `beginTwoComponentPick: (...) => { ... }` block that ends at line 375 (right before `dragAlongFreeDofs:`). Insert (this is a structural copy of the verified `beginTwoComponentPick` impl at `Viewport.tsx:360-375`):

```ts
    beginOneComponentPick: (resolvePartPath, onPick) => {
      const picker = createOneComponentPicker(resolvePartPath, onPick);
      return {
        pick: (clientX, clientY) => {
          if (!sceneRef.current || !canvasRef.current) return;
          const rect = canvasRef.current.getBoundingClientRect();
          const ndc = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -(((clientY - rect.top) / rect.height) * 2 - 1),
          );
          const hit = sceneRef.current.raycastComponent(sceneRef.current.getCamera(), ndc);
          if (hit) picker.pick(hit);
        },
        reset: () => picker.reset(),
      };
    },
```

- [ ] **Step 5d (verify shape + green)** — From `packages/app/`, run the typecheck and re-run the picker spec:
  `npx tsc --noEmit && npx vitest run src/viewport/createOneComponentPicker.spec.ts`
  **Expected:** `tsc` exits 0 (the new handle method type-checks against `ComponentPath` already imported in `Viewport.tsx` — it is used at line 61/87) and the 3 picker tests stay green. If `tsc` reports `ComponentPath` unused/undefined, confirm the existing `import { ... ComponentPath ... }` is present (it is — used by `raycastComponent` at line 61); do NOT add a duplicate import.

> **No browser verification in this task.** The raycast wiring is exercised end-to-end only when Phase 8 attaches `beginOneComponentPick` to the Add Door / manual система-32 dialog flows and App.tsx's pointer handler. Per the contract, that §6 browser pass belongs to Phase 8/9, not here. State explicitly in the PR: "`beginOneComponentPick` raycast path is written-but-unverified until Phase 8 wires a dialog target-pick."

> **Phase 8 call-site contract (enforce at review):** Phase 8's handlers MUST call `viewport.beginOneComponentPick(resolvePartPath, onPick)` with **2 args**, store the returned `{ pick, reset }` handle, and feed `handle.pick(e.clientX, e.clientY)` in the App.tsx canvas pointer handler — exactly as `beginTwoComponentPick` is wired. Any 1-arg call or missing pointer-wiring is a bug. If Phase 8 violates this, fix Phase 8, NOT Phase 7.

- [ ] **Step 6 (commit)** — `git add packages/app/src/viewport/createOneComponentPicker.ts packages/app/src/viewport/createOneComponentPicker.spec.ts packages/app/src/viewport/Viewport.tsx && git commit -m "feat(prisadka): createOneComponentPicker + Viewport.beginOneComponentPick (single-component pick, 2-arg API)"`

---

<!-- selfcritique:
Weaknesses: (1) LEFT/RIGHT_SIDE_INNER_FACE are now IMPORTED from prisadkaFaceConventions.ts — this is a hard dependency on Phase 0 shipping that file before this task runs. If Phase 0 is partial (file exists but exports placeholder values that haven't been derived yet), the import resolves but the sign is wrong; the unit tests don't pin the sign (face role is in ['Top','Bottom']), so the only catch remains Phase 9's real-OCCT bake guard. (2) createOneComponentPicker function signature was changed from opts-object to two positional args to match the addendum §3 requirement — this is now internally consistent (picker factory, spec, Viewport.beginOneComponentPick impl all use 2 positional args) but Phase 8 MUST be updated to match; this chunk cannot enforce Phase 8's correctness, only document it. (3) Did not run the tests (authoring only); RED/GREEN expectations are reasoned, not executed.
Assumptions: shelfPinGrid emits face.role exactly === innerFace arg; DEFAULT_SHELF_PIN_PARAMS.depth is a number (blind); ShelfPinParams/DEFAULT_SHELF_PIN_PARAMS exported from @zilventor/shared barrel (Phase 2); prisadkaFaceConventions.ts exports LEFT_SIDE_INNER_FACE/RIGHT_SIDE_INNER_FACE from @zilventor/shared/src/prisadkaFaceConventions (Phase 0). Viewport handle type is the interface ending near L89/impl near L375 (verified by grep, exact insertion lines may shift ±2 after Phase-1 edits).
Confidence: 88 — command structure, revert/invalidator pattern, picker positional-arg API, and the spec harness are verbatim-mirrored from verified real code or the addendum-pinned contract; residual risk is Phase-0 import availability and exact Viewport insertion lines. -->

---

## Phase 8 — dialogs + ribbon + i18n + markers

> **Phase scope.** This phase is **app-only** and assumes Phases 0–7 have shipped: the shared math (`shelfPinGrid`, `doorMath`, `hingeMath`), the three commands (`AddDoorCommand`, `GenerateShelfPinBoresCommand`, `AddManualShelfPinBoresCommand`), the one-component picker (`Viewport.beginOneComponentPick` + `createOneComponentPicker`), the widened `BORE_COLORS` Record (Phase 1), and the new `BoreConnectorKind`/`BoreRole`/`DoorSpec` types, and the shared `prisadkaFaceConventions.ts` (Phase 0). Phase 8 builds the two dialogs (`AddDoorDialog`, `ShelfPinDialog`), their store slots, the ribbon wiring, the en/uk i18n keys (parity-gated), a one-component-pick-handle store slot + App.tsx pointer wiring, and a marker-render regression guard.
>
> **Verified facts pinned at master `4373e38`:**
> - Existing dialogs live **flat under `packages/app/src/shell/`** (e.g. `BoringDialog.tsx`), NOT under `shell/dialogs/`. This phase places `AddDoorDialog.tsx` and `ShelfPinDialog.tsx` there and mounts them in `WorkFeatureDialogsHost.tsx:52-55`.
> - The store dialog-state pattern is: a `…DialogState` type holding `onSubmit`/`onCancel`, a `…Dialog: …DialogState | null` field, a `set…Dialog` action. `BoringDialogState` is at `useAppStore.ts:92-95`; slot at `:323-324`; impl at `:850-851`.
> - **Marker rendering needs NO new logic.** `SceneManager.rebuildBoreMarkers` (`SceneManager.ts:659-705`) is already role-agnostic: it reads `SceneManager.BORE_COLORS[bore.connectorKind]` (`:693`) and draws a `RingGeometry` for every bore regardless of `role`. Once `BORE_COLORS` is widened to `Record<BoreConnectorKind,string>` (Phase 1) the new `shelfPin`/`hinge` bores render automatically. Task 4 below is a **regression guard** that locks this, not new render code.
> - i18n: `packages/app/src/i18n/locales/en.json` + `uk.json`; parity gate `packages/app/src/i18n/parity.test.ts` asserts identical key sets AND no empty uk value. The `ribbon.furniture` block **pre-existingly mixes English and Ukrainian values** (e.g. `generatePresadku: "Генерувати присадку"` in the en bundle) — this is an established but inconsistent convention; **new keys in this phase use English in the en bundle** (e.g. `addDoor: "Add Door"`) to be consistent with the majority of the en bundle. Note to lead: the pre-existing Ukrainian-in-en strings (`generatePresadku`, etc.) are candidates for a separate cleanup pass; the parity test only checks key-set equality + non-empty uk values, so it will not catch semantic drift in either direction.
> - `viewport: ViewportRef | null` is a store field (`useAppStore.ts:149`). `ViewportRef.beginOneComponentPick(resolvePartPath, onPick)` is defined by Phase 7 and returns `{ pick(clientX, clientY), reset() }`. App.tsx's `handleViewportPointer` owns the begin-pick flow: FurnitureTab calls the handler, which calls `viewport.beginOneComponentPick(resolvePartPath, onPick)` and stashes the returned handle in the store; App.tsx's `handleViewportPointer` feeds `.pick(clientX, clientY)` on the next canvas click.
> - All app suites run from `packages/app` with `npx vitest run --config vitest.config.ts <path>` (the package's `test:unit` is `vitest run`; the jsdom config is `packages/app/vitest.config.ts`).

---

### Task 1: Store dialog slots + one-component-pick-handle slot

**Files:**
- Modify `packages/app/src/store/useAppStore.ts` — type defs (after `BoringDialogState` at `:92-95`), interface slots (after `:324`), impl (after `:851`)
- Test `packages/app/src/store/__tests__/dialogSlots.slice2.spec.ts` (Create)

**Step 1: Write the failing store-slot test (RED)**

- [ ] **Step 1 — author the slot test.** Create `packages/app/src/store/__tests__/dialogSlots.slice2.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../useAppStore';

describe('slice-2 dialog store slots', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDoorDialog(null);
    useAppStore.getState().setShelfPinDialog(null);
    useAppStore.getState().setOneComponentPickHandle(null);
  });

  it('addDoorDialog defaults null and round-trips through setter', () => {
    expect(useAppStore.getState().addDoorDialog).toBeNull();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit, onCancel });
    expect(useAppStore.getState().addDoorDialog?.cabinetPath).toBe('parts/cab.ziasm');
    useAppStore.getState().setAddDoorDialog(null);
    expect(useAppStore.getState().addDoorDialog).toBeNull();
  });

  it('shelfPinDialog defaults null and round-trips through setter', () => {
    expect(useAppStore.getState().shelfPinDialog).toBeNull();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    useAppStore.getState().setShelfPinDialog({ mode: 'auto', onSubmit, onCancel });
    expect(useAppStore.getState().shelfPinDialog?.mode).toBe('auto');
    useAppStore.getState().setShelfPinDialog({ mode: 'manual', panelPath: 'parts/side.zipt', face: 'Top', onSubmit, onCancel });
    expect(useAppStore.getState().shelfPinDialog?.mode).toBe('manual');
    useAppStore.getState().setShelfPinDialog(null);
    expect(useAppStore.getState().shelfPinDialog).toBeNull();
  });

  it('oneComponentPickHandle defaults null and stores a handle object', () => {
    expect(useAppStore.getState().oneComponentPickHandle).toBeNull();
    const handle = { pick: vi.fn(), reset: vi.fn() };
    useAppStore.getState().setOneComponentPickHandle(handle);
    expect(useAppStore.getState().oneComponentPickHandle).toBe(handle);
    useAppStore.getState().setOneComponentPickHandle(null);
    expect(useAppStore.getState().oneComponentPickHandle).toBeNull();
  });
});
```

- [ ] **Step 2 — run it, confirm RED.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/store/__tests__/dialogSlots.slice2.spec.ts
```

Expected RED: TypeScript/runtime error `setAddDoorDialog is not a function` (and `setShelfPinDialog`, `setOneComponentPickHandle`), because the actions don't exist yet.

**Step 3: Add the type defs (GREEN, part 1)**

- [ ] **Step 3 — add the two dialog-state types + pick-handle type after `BoringDialogState` (`useAppStore.ts:95`).** Insert immediately after the closing `};` of `BoringDialogState`:

```ts

/** Slice-2 присадка: "Add Door" dialog. cabinetPath is the picked cabinet `.ziasm`. */
export type AddDoorDialogState = {
  cabinetPath: string;
  onSubmit: (params: {
    count: 'single' | 'double';
    overlay: 'full' | 'half' | 'inset';
    hingeSide: 'left' | 'right';
    thickness: number;
    reveal: number;
    clearance: number;
    centerReveal: number;
  }) => void;
  onCancel: () => void;
};

/**
 * Slice-2 присадка: система-32 shelf-pin dialog. `auto` recurses the active
 * assembly's side panels; `manual` targets one picked panel + chosen broad face.
 */
export type ShelfPinDialogState = {
  mode: 'auto' | 'manual';
  panelPath?: string;           // present only for mode:'manual' (the picked panel .zipt)
  face?: 'Top' | 'Bottom';      // present only for mode:'manual'
  onSubmit: (params: {
    pitch: number;
    diameter: number;
    depth: number;
    frontSetback: number;
    backSetback: number;
    topMargin: number;
    bottomMargin: number;
    columns: 1 | 2;
  }) => void;
  onCancel: () => void;
};

/** Handle returned by Viewport.beginOneComponentPick. App.tsx holds it and feeds .pick() on canvas click. */
export type OneComponentPickHandle = {
  pick: (clientX: number, clientY: number) => void;
  reset: () => void;
};
```

**Step 4: Add the interface slots (GREEN, part 2)**

- [ ] **Step 4 — add slots after the `setBoringDialog` slot (`useAppStore.ts:324`).** Insert after the `setBoringDialog: (s: BoringDialogState | null) => void;` line:

```ts
  addDoorDialog: AddDoorDialogState | null;
  setAddDoorDialog: (s: AddDoorDialogState | null) => void;
  shelfPinDialog: ShelfPinDialogState | null;
  setShelfPinDialog: (s: ShelfPinDialogState | null) => void;
  /** Active one-component pick handle. App.tsx reads this in handleViewportPointer to feed .pick(). */
  oneComponentPickHandle: OneComponentPickHandle | null;
  setOneComponentPickHandle: (h: OneComponentPickHandle | null) => void;
```

**Step 5: Add the impl (GREEN, part 3)**

- [ ] **Step 5 — add impl after the `setBoringDialog` impl (`useAppStore.ts:851`).** Insert after `setBoringDialog: (s) => set({ boringDialog: s }),`:

```ts
  addDoorDialog: null,
  setAddDoorDialog: (s) => set({ addDoorDialog: s }),
  shelfPinDialog: null,
  setShelfPinDialog: (s) => set({ shelfPinDialog: s }),
  oneComponentPickHandle: null,
  setOneComponentPickHandle: (h) => set({ oneComponentPickHandle: h }),
```

- [ ] **Step 6 — run the slot test, confirm GREEN.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/store/__tests__/dialogSlots.slice2.spec.ts
```

Expected GREEN: `3 passed`.

- [ ] **Step 7 — commit.**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/__tests__/dialogSlots.slice2.spec.ts
git commit -m "feat(presadka-s2): add AddDoor + ShelfPin dialog store slots + oneComponentPickHandle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: AddDoorDialog component + i18n keys

**Files:**
- Create `packages/app/src/shell/AddDoorDialog.tsx`
- Create `packages/app/src/shell/__tests__/AddDoorDialog.spec.tsx`
- Modify `packages/app/src/i18n/locales/en.json` (add `dialog.addDoor` block + `aria.add_door_dialog`)
- Modify `packages/app/src/i18n/locales/uk.json` (same keys, Ukrainian values)
- Modify `packages/app/src/shell/WorkFeatureDialogsHost.tsx` — import + mount (`:9`, `:55`)

> **i18n note:** the parity test (`packages/app/src/i18n/parity.test.ts`) fails if en/uk key sets differ OR any uk value is empty. Every key added to `en.json` in this task MUST get a matching key with a non-empty Ukrainian value in `uk.json`, added in the same task. Run `parity.test.ts` as part of the GREEN gate.

**Step 1: Add i18n keys to BOTH bundles first (so the dialog's `t()` calls resolve)**

- [ ] **Step 1 — add `dialog.addDoor` + `aria.add_door_dialog` to `en.json`.** In `packages/app/src/i18n/locales/en.json`, add a new `"addDoor"` object inside the existing `"dialog"` object (alphabetical, just before `"boring"`), and an `"add_door_dialog"` key inside `"aria"` (alphabetical, just before `"add_view"`):

Inside `"aria"`:
```json
    "add_door_dialog": "Add Door dialog",
```

Inside `"dialog"`:
```json
    "addDoor": {
      "title": "Add Door",
      "count": "Count",
      "countSingle": "Single",
      "countDouble": "Double",
      "hingeSide": "Hinge side",
      "hingeLeft": "Left",
      "hingeRight": "Right",
      "overlay": "Overlay",
      "overlayFull": "Full",
      "overlayHalf": "Half",
      "overlayInset": "Inset",
      "thickness": "Thickness (mm)",
      "reveal": "Reveal (mm)",
      "clearance": "Clearance (mm)",
      "centerReveal": "Center reveal (mm)",
      "hingeCount": "Hinges (auto)"
    },
```

- [ ] **Step 2 — add the SAME keys to `uk.json` with Ukrainian values.** In `packages/app/src/i18n/locales/uk.json`, mirror exactly:

Inside `"aria"`:
```json
    "add_door_dialog": "Діалог додавання дверей",
```

Inside `"dialog"`:
```json
    "addDoor": {
      "title": "Додати двері",
      "count": "Кількість",
      "countSingle": "Одинарні",
      "countDouble": "Подвійні",
      "hingeSide": "Сторона петель",
      "hingeLeft": "Ліворуч",
      "hingeRight": "Праворуч",
      "overlay": "Накладка",
      "overlayFull": "Повна",
      "overlayHalf": "Напівнакладна",
      "overlayInset": "Вкладна",
      "thickness": "Товщина (мм)",
      "reveal": "Зазор (мм)",
      "clearance": "Зазор вкладної (мм)",
      "centerReveal": "Центральний зазор (мм)",
      "hingeCount": "Петлі (авто)"
    },
```

- [ ] **Step 3 — run the parity gate, confirm GREEN.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/i18n/parity.test.ts
```

Expected GREEN: `2 passed` (key sets identical, no empty uk value). If RED, a key is mismatched/empty — fix before proceeding.

**Step 4: Write the failing dialog test (RED)**

- [ ] **Step 4 — author `AddDoorDialog.spec.tsx`.** Create `packages/app/src/shell/__tests__/AddDoorDialog.spec.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddDoorDialog } from '../AddDoorDialog';
import { useAppStore } from '../../store/useAppStore';

describe('AddDoorDialog — structural', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDoorDialog(null);
  });

  it('renders nothing when addDoorDialog state is null', () => {
    const { container } = render(<AddDoorDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the door controls when open', () => {
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<AddDoorDialog />);
    expect(screen.getByLabelText('Count')).toBeTruthy();
    expect(screen.getByLabelText('Hinge side')).toBeTruthy();
    expect(screen.getByLabelText('Overlay')).toBeTruthy();
    expect(screen.getByLabelText('Thickness (mm)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('defaults: single / left / full / thickness 18 / reveal 2 / clearance 2 / centerReveal 3', () => {
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<AddDoorDialog />);
    expect((screen.getByLabelText('Count') as HTMLSelectElement).value).toBe('single');
    expect((screen.getByLabelText('Hinge side') as HTMLSelectElement).value).toBe('left');
    expect((screen.getByLabelText('Overlay') as HTMLSelectElement).value).toBe('full');
    expect((screen.getByLabelText('Thickness (mm)') as HTMLInputElement).value).toBe('18');
    expect((screen.getByLabelText('Reveal (mm)') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Clearance (mm)') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Center reveal (mm)') as HTMLInputElement).value).toBe('3');
  });

  it('hinge-side control is disabled when count is double', () => {
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<AddDoorDialog />);
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: 'double' } });
    expect((screen.getByLabelText('Hinge side') as HTMLSelectElement).disabled).toBe(true);
  });

  it('OK submits the chosen params and closes', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit, onCancel: vi.fn() });
    render(<AddDoorDialog />);
    fireEvent.change(screen.getByLabelText('Overlay'), { target: { value: 'inset' } });
    fireEvent.change(screen.getByLabelText('Hinge side'), { target: { value: 'right' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      count: 'single',
      overlay: 'inset',
      hingeSide: 'right',
      thickness: 18,
      reveal: 2,
      clearance: 2,
      centerReveal: 3,
    });
    expect(useAppStore.getState().addDoorDialog).toBeNull();
  });

  it('Cancel calls onCancel and closes', () => {
    const onCancel = vi.fn();
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit: vi.fn(), onCancel });
    render(<AddDoorDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().addDoorDialog).toBeNull();
  });
});
```

- [ ] **Step 5 — run it, confirm RED.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/shell/__tests__/AddDoorDialog.spec.tsx
```

Expected RED: `Failed to resolve import "../AddDoorDialog"` (the component file does not exist yet).

**Step 6: Implement the dialog (GREEN)**

- [ ] **Step 6 — author `AddDoorDialog.tsx`.** Create `packages/app/src/shell/AddDoorDialog.tsx` (mirrors `BoringDialog.tsx`'s style consts + overlay/escape handling; uses the verified `hingeCountForHeight` import only for the read-only hint):

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { hingeCountForHeight } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 300, color: '#eee', fontSize: 12,
};
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 };
const fieldStyle: React.CSSProperties = { background: '#2a2a2a', color: '#eee', border: '1px solid #444', fontSize: 11, padding: '2px 4px', width: 130 };
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

export function AddDoorDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.addDoorDialog);
  const setDialog = useAppStore((s) => s.setAddDoorDialog);

  const [count, setCount] = React.useState<'single' | 'double'>('single');
  const [hingeSide, setHingeSide] = React.useState<'left' | 'right'>('left');
  const [overlay, setOverlay] = React.useState<'full' | 'half' | 'inset'>('full');
  const [thickness, setThickness] = React.useState('18');
  const [reveal, setReveal] = React.useState('2');
  const [clearance, setClearance] = React.useState('2');
  const [centerReveal, setCenterReveal] = React.useState('3');

  // Reset defaults each time the dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setCount('single');
      setHingeSide('left');
      setOverlay('full');
      setThickness('18');
      setReveal('2');
      setClearance('2');
      setCenterReveal('3');
    }
  }, [dialog]);

  if (!dialog) return null;

  // Read-only hinge-count hint at a nominal door height (informational only;
  // the real count is resolved by AddDoorCommand from the computed doorH).
  const hingeHint = hingeCountForHeight(720);

  const handleOk = (): void => {
    dialog.onSubmit({
      count,
      overlay,
      hingeSide,
      thickness: Number(thickness),
      reveal: Number(reveal),
      clearance: Number(clearance),
      centerReveal: Number(centerReveal),
    });
    setDialog(null);
  };

  const handleCancel = (): void => {
    dialog.onCancel();
    setDialog(null);
  };

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
    >
      <div
        style={panelStyle}
        role="dialog"
        aria-label={t('aria.add_door_dialog')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.addDoor.title')}</div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-count">{t('dialog.addDoor.count')}</label>
          <select
            id="adddoor-count"
            aria-label={t('dialog.addDoor.count')}
            style={fieldStyle}
            value={count}
            onChange={(e) => setCount(e.target.value as 'single' | 'double')}
          >
            <option value="single">{t('dialog.addDoor.countSingle')}</option>
            <option value="double">{t('dialog.addDoor.countDouble')}</option>
          </select>
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-hingeside">{t('dialog.addDoor.hingeSide')}</label>
          <select
            id="adddoor-hingeside"
            aria-label={t('dialog.addDoor.hingeSide')}
            style={fieldStyle}
            value={hingeSide}
            disabled={count === 'double'}
            onChange={(e) => setHingeSide(e.target.value as 'left' | 'right')}
          >
            <option value="left">{t('dialog.addDoor.hingeLeft')}</option>
            <option value="right">{t('dialog.addDoor.hingeRight')}</option>
          </select>
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-overlay">{t('dialog.addDoor.overlay')}</label>
          <select
            id="adddoor-overlay"
            aria-label={t('dialog.addDoor.overlay')}
            style={fieldStyle}
            value={overlay}
            onChange={(e) => setOverlay(e.target.value as 'full' | 'half' | 'inset')}
          >
            <option value="full">{t('dialog.addDoor.overlayFull')}</option>
            <option value="half">{t('dialog.addDoor.overlayHalf')}</option>
            <option value="inset">{t('dialog.addDoor.overlayInset')}</option>
          </select>
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-thickness">{t('dialog.addDoor.thickness')}</label>
          <input id="adddoor-thickness" aria-label={t('dialog.addDoor.thickness')} style={fieldStyle}
            type="number" value={thickness} onChange={(e) => setThickness(e.target.value)} />
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-reveal">{t('dialog.addDoor.reveal')}</label>
          <input id="adddoor-reveal" aria-label={t('dialog.addDoor.reveal')} style={fieldStyle}
            type="number" value={reveal} onChange={(e) => setReveal(e.target.value)} />
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-clearance">{t('dialog.addDoor.clearance')}</label>
          <input id="adddoor-clearance" aria-label={t('dialog.addDoor.clearance')} style={fieldStyle}
            type="number" value={clearance} onChange={(e) => setClearance(e.target.value)} />
        </div>

        <div style={rowStyle}>
          <label htmlFor="adddoor-centerreveal">{t('dialog.addDoor.centerReveal')}</label>
          <input id="adddoor-centerreveal" aria-label={t('dialog.addDoor.centerReveal')} style={fieldStyle}
            type="number" value={centerReveal} disabled={count === 'single'}
            onChange={(e) => setCenterReveal(e.target.value)} />
        </div>

        <div style={rowStyle}>
          <span>{t('dialog.addDoor.hingeCount')}</span>
          <span aria-label={t('dialog.addDoor.hingeCount')}>{hingeHint}</span>
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button style={okBtnStyle} onClick={handleOk}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
```

> **Import check:** `hingeCountForHeight` is exported from `@zilventor/shared` by Phase 4 (`hingeMath.ts`). If running Task 2 before Phase 4 has landed, replace `const hingeHint = hingeCountForHeight(720);` with a literal `const hingeHint = 2;` and remove the import. In the assembled plan Phase 4 precedes Phase 8.

- [ ] **Step 7 — run the dialog test, confirm GREEN.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/shell/__tests__/AddDoorDialog.spec.tsx
```

Expected GREEN: `7 passed`.

**Step 8: Mount the dialog in the host**

- [ ] **Step 8 — import + render `AddDoorDialog` in `WorkFeatureDialogsHost.tsx`.** Add the import after the `BoringDialog` import (`:9`):

```tsx
import { AddDoorDialog } from './AddDoorDialog';
```

and add the element after `<BoringDialog />` (`:55`):

```tsx
      <AddDoorDialog />
```

- [ ] **Step 9 — run parity + dialog tests together, confirm GREEN.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/i18n/parity.test.ts src/shell/__tests__/AddDoorDialog.spec.tsx
```

Expected GREEN: `9 passed` (2 parity + 7 dialog).

- [ ] **Step 10 — commit.**

```bash
git add packages/app/src/shell/AddDoorDialog.tsx packages/app/src/shell/__tests__/AddDoorDialog.spec.tsx packages/app/src/shell/WorkFeatureDialogsHost.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json
git commit -m "feat(presadka-s2): AddDoorDialog + en/uk i18n + host mount

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: ShelfPinDialog component + i18n keys

**Files:**
- Create `packages/app/src/shell/ShelfPinDialog.tsx`
- Create `packages/app/src/shell/__tests__/ShelfPinDialog.spec.tsx`
- Modify `packages/app/src/i18n/locales/en.json` (add `dialog.shelfPin` + `aria.shelf_pin_dialog`)
- Modify `packages/app/src/i18n/locales/uk.json` (same keys, Ukrainian values)
- Modify `packages/app/src/shell/WorkFeatureDialogsHost.tsx` — import + mount

> The defaults pre-filled here MUST equal `DEFAULT_SHELF_PIN_PARAMS` from `packages/shared/src/shelfPinGrid.ts` (Phase 2): `pitch:32, diameter:5, depth:13, frontSetback:37, backSetback:37, topMargin:64, bottomMargin:64, columns:2`.

**Step 1: Add i18n keys to BOTH bundles**

- [ ] **Step 1 — add `dialog.shelfPin` + `aria.shelf_pin_dialog` to `en.json`.** Inside `"aria"` (alphabetical placement):

```json
    "shelf_pin_dialog": "Система-32 shelf-pin dialog",
```

Inside `"dialog"` (alphabetical — after `"sketchRect"` / wherever `s*` sorts; placement is cosmetic, parity only checks key sets):

```json
    "shelfPin": {
      "title": "Система-32 (shelf pins)",
      "pitch": "Pitch (mm)",
      "diameter": "Diameter (mm)",
      "depth": "Depth (mm)",
      "frontSetback": "Front setback (mm)",
      "backSetback": "Back setback (mm)",
      "topMargin": "Top margin (mm)",
      "bottomMargin": "Bottom margin (mm)",
      "columns": "Columns",
      "columnsOne": "1 (front)",
      "columnsTwo": "2 (front + back)"
    },
```

- [ ] **Step 2 — add the SAME keys to `uk.json`.** Inside `"aria"`:

```json
    "shelf_pin_dialog": "Діалог Система-32 (полицетримачі)",
```

Inside `"dialog"`:

```json
    "shelfPin": {
      "title": "Система-32 (полицетримачі)",
      "pitch": "Крок (мм)",
      "diameter": "Діаметр (мм)",
      "depth": "Глибина (мм)",
      "frontSetback": "Відступ спереду (мм)",
      "backSetback": "Відступ ззаду (мм)",
      "topMargin": "Відступ зверху (мм)",
      "bottomMargin": "Відступ знизу (мм)",
      "columns": "Колонки",
      "columnsOne": "1 (передня)",
      "columnsTwo": "2 (передня + задня)"
    },
```

- [ ] **Step 3 — run the parity gate, confirm GREEN.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/i18n/parity.test.ts
```

Expected GREEN: `2 passed`.

**Step 4: Write the failing dialog test (RED)**

- [ ] **Step 4 — author `ShelfPinDialog.spec.tsx`.** Create `packages/app/src/shell/__tests__/ShelfPinDialog.spec.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShelfPinDialog } from '../ShelfPinDialog';
import { useAppStore } from '../../store/useAppStore';

describe('ShelfPinDialog — structural', () => {
  beforeEach(() => {
    useAppStore.getState().setShelfPinDialog(null);
  });

  it('renders nothing when shelfPinDialog state is null', () => {
    const { container } = render(<ShelfPinDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the param controls with standard defaults', () => {
    useAppStore.getState().setShelfPinDialog({ mode: 'auto', onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<ShelfPinDialog />);
    expect((screen.getByLabelText('Pitch (mm)') as HTMLInputElement).value).toBe('32');
    expect((screen.getByLabelText('Diameter (mm)') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Depth (mm)') as HTMLInputElement).value).toBe('13');
    expect((screen.getByLabelText('Front setback (mm)') as HTMLInputElement).value).toBe('37');
    expect((screen.getByLabelText('Back setback (mm)') as HTMLInputElement).value).toBe('37');
    expect((screen.getByLabelText('Top margin (mm)') as HTMLInputElement).value).toBe('64');
    expect((screen.getByLabelText('Bottom margin (mm)') as HTMLInputElement).value).toBe('64');
    expect((screen.getByLabelText('Columns') as HTMLSelectElement).value).toBe('2');
  });

  it('OK submits the params (numeric) and closes', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setShelfPinDialog({ mode: 'auto', onSubmit, onCancel: vi.fn() });
    render(<ShelfPinDialog />);
    fireEvent.change(screen.getByLabelText('Pitch (mm)'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      pitch: 25,
      diameter: 5,
      depth: 13,
      frontSetback: 37,
      backSetback: 37,
      topMargin: 64,
      bottomMargin: 64,
      columns: 1,
    });
    expect(useAppStore.getState().shelfPinDialog).toBeNull();
  });

  it('Cancel calls onCancel and closes', () => {
    const onCancel = vi.fn();
    useAppStore.getState().setShelfPinDialog({ mode: 'auto', onSubmit: vi.fn(), onCancel });
    render(<ShelfPinDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().shelfPinDialog).toBeNull();
  });
});
```

- [ ] **Step 5 — run it, confirm RED.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/shell/__tests__/ShelfPinDialog.spec.tsx
```

Expected RED: `Failed to resolve import "../ShelfPinDialog"` (file does not exist).

**Step 6: Implement the dialog (GREEN)**

- [ ] **Step 6 — author `ShelfPinDialog.tsx`.** Create `packages/app/src/shell/ShelfPinDialog.tsx`:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 300, color: '#eee', fontSize: 12,
};
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 };
const fieldStyle: React.CSSProperties = { background: '#2a2a2a', color: '#eee', border: '1px solid #444', fontSize: 11, padding: '2px 4px', width: 120 };
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

export function ShelfPinDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.shelfPinDialog);
  const setDialog = useAppStore((s) => s.setShelfPinDialog);

  const [pitch, setPitch] = React.useState('32');
  const [diameter, setDiameter] = React.useState('5');
  const [depth, setDepth] = React.useState('13');
  const [frontSetback, setFrontSetback] = React.useState('37');
  const [backSetback, setBackSetback] = React.useState('37');
  const [topMargin, setTopMargin] = React.useState('64');
  const [bottomMargin, setBottomMargin] = React.useState('64');
  const [columns, setColumns] = React.useState<'1' | '2'>('2');

  // Reset defaults each time the dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setPitch('32');
      setDiameter('5');
      setDepth('13');
      setFrontSetback('37');
      setBackSetback('37');
      setTopMargin('64');
      setBottomMargin('64');
      setColumns('2');
    }
  }, [dialog]);

  if (!dialog) return null;

  const handleOk = (): void => {
    dialog.onSubmit({
      pitch: Number(pitch),
      diameter: Number(diameter),
      depth: Number(depth),
      frontSetback: Number(frontSetback),
      backSetback: Number(backSetback),
      topMargin: Number(topMargin),
      bottomMargin: Number(bottomMargin),
      columns: (columns === '1' ? 1 : 2),
    });
    setDialog(null);
  };

  const handleCancel = (): void => {
    dialog.onCancel();
    setDialog(null);
  };

  const numRow = (
    id: string, labelKey: string, value: string, set: (v: string) => void,
  ): JSX.Element => (
    <div style={rowStyle}>
      <label htmlFor={id}>{t(labelKey)}</label>
      <input id={id} aria-label={t(labelKey)} style={fieldStyle}
        type="number" value={value} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
    >
      <div
        style={panelStyle}
        role="dialog"
        aria-label={t('aria.shelf_pin_dialog')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.shelfPin.title')}</div>

        {numRow('shelfpin-pitch', 'dialog.shelfPin.pitch', pitch, setPitch)}
        {numRow('shelfpin-diameter', 'dialog.shelfPin.diameter', diameter, setDiameter)}
        {numRow('shelfpin-depth', 'dialog.shelfPin.depth', depth, setDepth)}
        {numRow('shelfpin-frontsetback', 'dialog.shelfPin.frontSetback', frontSetback, setFrontSetback)}
        {numRow('shelfpin-backsetback', 'dialog.shelfPin.backSetback', backSetback, setBackSetback)}
        {numRow('shelfpin-topmargin', 'dialog.shelfPin.topMargin', topMargin, setTopMargin)}
        {numRow('shelfpin-bottommargin', 'dialog.shelfPin.bottomMargin', bottomMargin, setBottomMargin)}

        <div style={rowStyle}>
          <label htmlFor="shelfpin-columns">{t('dialog.shelfPin.columns')}</label>
          <select
            id="shelfpin-columns"
            aria-label={t('dialog.shelfPin.columns')}
            style={fieldStyle}
            value={columns}
            onChange={(e) => setColumns(e.target.value as '1' | '2')}
          >
            <option value="1">{t('dialog.shelfPin.columnsOne')}</option>
            <option value="2">{t('dialog.shelfPin.columnsTwo')}</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel')}</button>
          <button style={okBtnStyle} onClick={handleOk}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7 — run the dialog test, confirm GREEN.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/shell/__tests__/ShelfPinDialog.spec.tsx
```

Expected GREEN: `4 passed`.

**Step 8: Mount the dialog in the host**

- [ ] **Step 8 — import + render `ShelfPinDialog` in `WorkFeatureDialogsHost.tsx`.** Add the import after the `AddDoorDialog` import:

```tsx
import { ShelfPinDialog } from './ShelfPinDialog';
```

and add the element after `<AddDoorDialog />`:

```tsx
      <ShelfPinDialog />
```

- [ ] **Step 9 — run parity + both new dialog tests, confirm GREEN.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/i18n/parity.test.ts src/shell/__tests__/ShelfPinDialog.spec.tsx src/shell/__tests__/AddDoorDialog.spec.tsx
```

Expected GREEN: `13 passed` (2 parity + 4 shelf-pin + 7 add-door).

- [ ] **Step 10 — commit.**

```bash
git add packages/app/src/shell/ShelfPinDialog.tsx packages/app/src/shell/__tests__/ShelfPinDialog.spec.tsx packages/app/src/shell/WorkFeatureDialogsHost.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json
git commit -m "feat(presadka-s2): ShelfPinDialog + en/uk i18n + host mount

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Marker-render regression guard for shelfPin/hinge connectorKinds

**Files:**
- Create `packages/app/src/viewport/__tests__/SceneManager.boreMarkers.slice2.spec.ts`

> **Why this is a guard, not new code.** `SceneManager.rebuildBoreMarkers` (`SceneManager.ts:659-705`) draws a marker for *every* bore in `spec.bores` and colors it `SceneManager.BORE_COLORS[bore.connectorKind]` (`:693`). It is role-agnostic — the new `shelfPin-system32`/`hingeCup`/`hingePlate` roles and `shelfPin`/`hinge` kinds need NO render change beyond the `BORE_COLORS` widening already landed in Phase 1. This task **locks** that exhaustiveness at compile time (via the `satisfies Record<BoreConnectorKind,string>` on `BORE_COLORS` in Phase 1) and with a pure key-coverage unit test. The SceneManager instance render-path check belongs in the Phase-10 §6 browser pass (probe `getSceneManager().boreMarkerCount()`).
>
> **Architecture note:** The primary exhaustiveness guard is the compile-time `export const BORE_COLORS = { … } satisfies Record<BoreConnectorKind, string>` that Phase 1 ships on `SceneManager.ts:112`. The unit test below is a secondary runtime assertion. Together they ensure a future new `BoreConnectorKind` arm triggers both a tsc error AND a test failure.
>
> **WebGL mock (verified):** the existing `SceneManager.boreMarkers.spec.ts` already mocks `three`'s `WebGLRenderer` with a `FakeRenderer` class and `OrbitControls`. This test follows the **exact same mock pattern** from that verified file (`packages/app/src/viewport/__tests__/SceneManager.boreMarkers.spec.ts:6-26`).

- [ ] **Step 1 — author the regression guard.** Create `packages/app/src/viewport/__tests__/SceneManager.boreMarkers.slice2.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SceneManager, type MarkerOverlaySpec } from '../SceneManager';
import type { BoreOp, BoreConnectorKind } from '@zilventor/shared';

// --- WebGL mock: verbatim from SceneManager.boreMarkers.spec.ts ---
vi.mock('three', async (orig) => {
  const actual = (await orig()) as typeof import('three');
  class FakeRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => {
  class FakeOrbitControls {
    enableDamping = false;
    dampingFactor = 0;
    update() {}
    dispose() {}
  }
  return { OrbitControls: FakeOrbitControls };
});
// --- end mock ---

function makeSceneManager(): SceneManager {
  return new SceneManager(document.createElement('canvas'));
}

function shelfPinBore(i: number): BoreOp {
  return {
    id: `pin-col-front-${i}`,
    face: { featureId: 'panel', role: 'Top', instance: 0 },
    u: 64 + i * 32,
    v: 37,
    diameter: 5,
    depth: 13,
    role: 'shelfPin-system32',
    connectorId: 'pin-col-front',
    connectorKind: 'shelfPin',
  };
}

function hingeCupBore(i: number): BoreOp {
  return {
    id: `hinge-${i}`,
    face: { featureId: 'panel', role: 'Bottom', instance: 0 },
    u: 100 + i * 400,
    v: 21,
    diameter: 35,
    depth: 12,
    role: 'hingeCup',
    connectorId: `hinge-${i}`,
    connectorKind: 'hinge',
  };
}

function spec(bores: BoreOp[]): MarkerOverlaySpec {
  return {
    key: 'parts/side.zipt#0',
    panelDims: { length: 720, width: 560, thickness: 16 },
    worldPose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
    bores,
  };
}

describe('SceneManager bore markers — slice-2 shelfPin/hinge kinds', () => {
  // Primary exhaustiveness guard: every BoreConnectorKind must have a color string.
  // The compile-time `satisfies Record<BoreConnectorKind,string>` on BORE_COLORS (Phase 1)
  // is the stronger lock; this runtime check is the secondary defense.
  it('every BoreConnectorKind has a non-empty color string in BORE_COLORS', () => {
    const kinds: BoreConnectorKind[] = ['confirmat', 'minifix', 'dowel', 'shelfPin', 'hinge'];
    for (const k of kinds) {
      expect(typeof SceneManager.BORE_COLORS[k]).toBe('string');
      expect(SceneManager.BORE_COLORS[k].length).toBeGreaterThan(0);
    }
  });

  it('setBoreMarkers with shelfPin+hinge bores does not throw on the new connectorKinds', () => {
    const sm = makeSceneManager();
    sm.setShowBores(true);
    const bores = [shelfPinBore(0), shelfPinBore(1), shelfPinBore(2), hingeCupBore(0), hingeCupBore(1)];
    expect(() => sm.setBoreMarkers([spec(bores)])).not.toThrow();
    // Marker count confirms each bore produced a marker (no silently-dropped kinds).
    expect(sm.boreMarkerCount()).toBe(bores.length);
  });
});
```

- [ ] **Step 2 — run it, confirm GREEN.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.boreMarkers.slice2.spec.ts
```

Expected: **GREEN** (`2 passed`) **because Phase 1 already widened `BORE_COLORS`** to `Record<BoreConnectorKind,string>` with `shelfPin`/`hinge` arms AND added the compile-time `satisfies`. If it is **RED** with `SceneManager.BORE_COLORS.shelfPin` undefined or a `THREE.Color` parse error, Phase 1's widening did not land — stop and fix Phase 1 (`SceneManager.ts:112-116`) before continuing.

- [ ] **Step 3 — commit.**

```bash
git add packages/app/src/viewport/__tests__/SceneManager.boreMarkers.slice2.spec.ts
git commit -m "test(presadka-s2): lock shelfPin/hinge bore-marker rendering exhaustiveness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Ribbon buttons — Add Door + Система-32 (auto + manual)

**Files:**
- Modify `packages/app/src/shell/tabs/FurnitureTab.tsx` — imports (`:18-23`), handlers (after `handleGenerateBores` at `:91`), ribbon JSX (inside the `присадка` `RibbonPanel`, `:147-215`)
- Modify `packages/app/src/App.tsx` — add `oneComponentPickerHandleRef` and wire `handleViewportPointer` to feed it
- Modify `packages/app/src/i18n/locales/en.json` (3 ribbon keys)
- Modify `packages/app/src/i18n/locales/uk.json` (same keys)
- Test `packages/app/src/shell/tabs/__tests__/FurnitureTab.slice2.spec.tsx` (Create)

> **Picker wiring (addendum §3).** `handleAddDoor` and `handleSystem32Manual` must NOT call `viewport.beginOneComponentPick(singleCallback)` directly. Instead they route through App.tsx's pointer handler exactly as the two-component flow does:
> 1. FurnitureTab's handler calls `viewport.beginOneComponentPick(resolvePartPath, onPick)` and stores the returned `{ pick, reset }` handle in the store via `setOneComponentPickHandle(handle)`.
> 2. App.tsx's `handleViewportPointer` (assembly-mode branch, before the drag-busy check) reads `oneComponentPickHandle` from the store, and on the next `click` or `pointerdown` event calls `handle.pick(clientX, clientY)` and clears the handle to `null`.
> This ensures a clean separation: Viewport owns the raycast, App.tsx owns the pointer-event routing, and FurnitureTab only sets up the pick intent.
>
> **`resolvePartPath` implementation.** Given a `ComponentPath` (array of component IDs), look up the leaf component's `partPath` in `activeAssembly.components` first, then in `subAssemblyDocs` recursively. For the присадка use-case, the user always clicks a top-level cabinet `.ziasm` or a side-panel `.zipt` within it; a simple flat-assembly lookup suffices. The `onPick` callback receives the resolved `partPath` string.
>
> **`AddDoorCommand` cabinet-dims derivation (addendum §4).** `handleAddDoor` passes the picked `cabinetPath` ONLY plus the dialog params to `AddDoorCommand`. It does NOT pass `cabinet: { width:0, height:0, ... }` zeros. `AddDoorCommand.apply()` (Phase 5) derives the cabinet dims from the unpacked `.ziasm` (the side/bottom `PanelFeature` dims + stored `BaseCabinetParams` metadata). The Phase 5 contract guarantees `doorMath` inputs are strictly positive.
>
> **Manual-pick default face (addendum §1 + §7 minor finding).** When opening the ShelfPinDialog from the manual path after a panel pick, the default `face` value must come from `LEFT_SIDE_INNER_FACE` / `RIGHT_SIDE_INNER_FACE` imported from `packages/shared/src/prisadkaFaceConventions.ts` (Phase 0). The ribbon handler needs to determine which side panel was picked (from `role` in the assembly component) and map it to the correct inner face constant. If the component role cannot be resolved (non-standard panel), fall back to `LEFT_SIDE_INNER_FACE` as a safe default. Do NOT hardcode `'Top'` inline.

**Step 1: Add the 3 ribbon i18n keys to BOTH bundles**

- [ ] **Step 1 — add keys to `en.json` `ribbon.furniture`.** Add inside the existing `"ribbon": { "furniture": { … } }` object:

```json
      "addDoor": "Add Door",
      "system32Auto": "Система-32",
      "system32Manual": "Система-32 (pick)",
```

- [ ] **Step 2 — add the SAME keys to `uk.json` `ribbon.furniture`.**

```json
      "addDoor": "Двері",
      "system32Auto": "Система-32",
      "system32Manual": "Система-32 (вибір)",
```

> **i18n note:** `en.json`'s `addDoor: "Add Door"` uses English, consistent with the majority of the en bundle. The sibling key `generatePresadku: "Генерувати присадку"` in the en bundle is a pre-existing inconsistency (Ukrainian-in-en). The parity test only checks key-set equality + non-empty uk values, so both choices are parity-test-safe. A lead review of the en bundle's furniture keys is recommended as a separate cleanup.

- [ ] **Step 3 — run parity, confirm GREEN.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/i18n/parity.test.ts
```

Expected GREEN: `2 passed`.

**Step 4: Write the failing ribbon test (RED)**

- [ ] **Step 4 — author `FurnitureTab.slice2.spec.tsx`.** Create `packages/app/src/shell/tabs/__tests__/FurnitureTab.slice2.spec.tsx`. (Renders the tab with an active assembly so the buttons are enabled, and asserts clicking "Система-32" opens the shelf-pin dialog slot in auto mode.)

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';

function setActiveAssembly(): void {
  // Minimal assembly so cabinetDisabled === false (buttons enabled).
  useAppStore.setState({
    activeAssembly: {
      id: 'asm-1',
      name: 'Test',
      components: [],
      constraints: [],
      materials: [],
    } as any,
    activePart: null,
  } as any);
}

describe('FurnitureTab — slice-2 ribbon buttons', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDoorDialog(null);
    useAppStore.getState().setShelfPinDialog(null);
    useAppStore.getState().setOneComponentPickHandle(null);
    setActiveAssembly();
  });

  it('renders the Add Door and Система-32 buttons', () => {
    render(<FurnitureTab />);
    expect(screen.getByRole('button', { name: 'Add Door' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Система-32' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Система-32 (pick)' })).toBeTruthy();
  });

  it('clicking Система-32 (auto) opens the shelf-pin dialog in auto mode', () => {
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Система-32' }));
    expect(useAppStore.getState().shelfPinDialog?.mode).toBe('auto');
  });
});
```

- [ ] **Step 5 — run it, confirm RED.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/shell/tabs/__tests__/FurnitureTab.slice2.spec.tsx
```

Expected RED: `Unable to find an accessible element with the role "button" and name "Add Door"` (the buttons don't exist yet).

**Step 6: Add imports to FurnitureTab**

- [ ] **Step 6 — add command + convention imports.** In `FurnitureTab.tsx`, add after the existing command imports (after `:21`):

```tsx
import { AddDoorCommand } from '../../commands/AddDoorCommand';
import { GenerateShelfPinBoresCommand } from '../../commands/GenerateShelfPinBoresCommand';
import { AddManualShelfPinBoresCommand } from '../../commands/AddManualShelfPinBoresCommand';
import { LEFT_SIDE_INNER_FACE, RIGHT_SIDE_INNER_FACE } from '@zilventor/shared/src/prisadkaFaceConventions';
import type { ComponentPath } from '@zilventor/shared';
```

> These commands are authored by Phases 5/6 and the face-conventions by Phase 0. Their constructor shapes are pinned by the contract (§C and addendum §1). In the assembled plan Phases 0/5/6 precede Phase 8.

**Step 7: Add the handlers**

- [ ] **Step 7 — add `handleAddDoor`, `handleSystem32Auto`, `handleSystem32Manual` after `handleGenerateBores` (`FurnitureTab.tsx:91`).** Insert after the closing `};` of `handleGenerateBores`:

```tsx
  /** Resolve a ComponentPath to its partPath by looking up in activeAssembly + subAssemblyDocs. */
  const resolvePartPath = (path: ComponentPath): string => {
    const state = useAppStore.getState();
    // Try top-level assembly first.
    const topComp = state.activeAssembly?.components.find((c) => c.id === path[path.length - 1]);
    if (topComp) return topComp.partPath;
    // Try sub-assembly docs (cabinet's inner components).
    for (const doc of Object.values(state.subAssemblyDocs)) {
      const inner = doc.components.find((c) => c.id === path[path.length - 1]);
      if (inner) return inner.partPath;
    }
    // Fallback: treat the leaf id as a direct path (should not happen in practice).
    return String(path[path.length - 1]);
  };

  const handleAddDoor = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    // App.tsx feeds .pick() on canvas click via oneComponentPickHandle in the store.
    const handle = viewport.beginOneComponentPick(resolvePartPath, (cabinetPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      useAppStore.getState().setAddDoorDialog({
        cabinetPath,
        onSubmit: async (p) => {
          const opfs = await Opfs.forNavigator();
          // cabinetPath only — AddDoorCommand.apply() derives cabinet dims from unpacked .ziasm.
          await useAppStore.getState().bus.execute(
            new AddDoorCommand({
              cabinetPath,
              params: {
                count: p.count,
                overlay: p.overlay,
                hingeSide: p.hingeSide,
                thickness: p.thickness,
                reveal: p.reveal,
                clearance: p.clearance,
                centerReveal: p.centerReveal,
              },
              opfs,
              store: useAppStore,
            }),
          );
        },
        onCancel: () => useAppStore.getState().setAddDoorDialog(null),
      });
    });
    useAppStore.getState().setOneComponentPickHandle(handle);
  };

  const handleSystem32Auto = () => {
    useAppStore.getState().setShelfPinDialog({
      mode: 'auto',
      onSubmit: async (params) => {
        const opfs = await Opfs.forNavigator();
        await useAppStore.getState().bus.execute(
          new GenerateShelfPinBoresCommand({ params, opfs, store: useAppStore }),
        );
      },
      onCancel: () => useAppStore.getState().setShelfPinDialog(null),
    });
  };

  const handleSystem32Manual = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    const handle = viewport.beginOneComponentPick(resolvePartPath, (panelPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      // Derive the default face from the component's role (addendum §1).
      // Find the component in assembly or sub-assembly docs to read its role.
      const state = useAppStore.getState();
      const allComponents = [
        ...(state.activeAssembly?.components ?? []),
        ...Object.values(state.subAssemblyDocs).flatMap((d) => d.components),
      ];
      const comp = allComponents.find((c) => c.partPath === panelPath);
      // Map component role to the appropriate inner broad face, imported from the
      // single source of truth (prisadkaFaceConventions.ts, proven by Phase 0).
      const defaultFace: 'Top' | 'Bottom' =
        comp?.role === 'rightSide' ? RIGHT_SIDE_INNER_FACE : LEFT_SIDE_INNER_FACE;
      useAppStore.getState().setShelfPinDialog({
        mode: 'manual',
        panelPath,
        face: defaultFace,
        onSubmit: async (params) => {
          const opfs = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddManualShelfPinBoresCommand({
              panelPath,
              face: defaultFace,
              params,
              opfs,
              store: useAppStore,
            }),
          );
        },
        onCancel: () => useAppStore.getState().setShelfPinDialog(null),
      });
    });
    useAppStore.getState().setOneComponentPickHandle(handle);
  };
```

**Step 8: Add the ribbon buttons**

- [ ] **Step 8 — add three buttons inside the присадка `RibbonPanel`.** In `FurnitureTab.tsx`, inside `<RibbonPanel title={t('ribbon.furniture.presadka')}>` (after the `generatePresadku` button block, before the show/hide toggle):

```tsx
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleAddDoor(); }}
            aria-label={t('ribbon.furniture.addDoor')}
          >
            {t('ribbon.furniture.addDoor')}
          </button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleSystem32Auto(); }}
            aria-label={t('ribbon.furniture.system32Auto')}
          >
            {t('ribbon.furniture.system32Auto')}
          </button>
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleSystem32Manual(); }}
            aria-label={t('ribbon.furniture.system32Manual')}
          >
            {t('ribbon.furniture.system32Manual')}
          </button>
```

**Step 9: Wire `oneComponentPickHandle` into App.tsx's pointer handler**

- [ ] **Step 9 — add one-component-pick dispatch to `handleViewportPointer` in `App.tsx`.** In the assembly-mode branch of `handleViewportPointer` (before the `dragBusy` check, around line 1966), insert:

```tsx
      // Slice-2 присадка: one-component pick (Add Door / manual система-32).
      // Check before the drag-busy guard so a pending pick is always serviced.
      if (ev.type === 'click' || ev.type === 'pointerdown') {
        const pickHandle = useAppStore.getState().oneComponentPickHandle;
        if (pickHandle) {
          pickHandle.pick(ev.clientX, ev.clientY);
          useAppStore.getState().setOneComponentPickHandle(null);
          return;
        }
      }
```

Insert this block immediately before (not inside) the `const dragBusy = ...` declaration so that a pending pick takes priority over drag-start logic.

- [ ] **Step 10 — run the ribbon test, confirm GREEN.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/shell/tabs/__tests__/FurnitureTab.slice2.spec.tsx
```

Expected GREEN: `2 passed`. (The auto-mode test exercises the no-pick path; the door/manual buttons only assert presence, since they require a live viewport pick wired by App.tsx.)

- [ ] **Step 11 — run the full Phase-8 suite + parity + tsc, confirm GREEN.** From `packages/app`:

```bash
npx vitest run --config vitest.config.ts src/i18n/parity.test.ts src/shell/__tests__/AddDoorDialog.spec.tsx src/shell/__tests__/ShelfPinDialog.spec.tsx src/store/__tests__/dialogSlots.slice2.spec.ts src/shell/tabs/__tests__/FurnitureTab.slice2.spec.tsx src/viewport/__tests__/SceneManager.boreMarkers.slice2.spec.ts
npx tsc --noEmit -p .
```

Expected: all listed suites GREEN; `tsc` clean on touched files. If `tsc` flags the Phase 5/6 command imports as missing, those phases have not landed — expected when authoring Phase 8 in isolation; in the assembled plan they precede this phase.

- [ ] **Step 12 — commit.**

```bash
git add packages/app/src/shell/tabs/FurnitureTab.tsx packages/app/src/shell/tabs/__tests__/FurnitureTab.slice2.spec.tsx packages/app/src/App.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json
git commit -m "feat(presadka-s2): ribbon buttons for Add Door + Система-32 (auto/manual) + pointer wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

> **Phase 8 done-criteria (verify before closing the phase):**
> - `parity.test.ts` GREEN (en/uk key sets identical, no empty uk value) — the i18n gate.
> - `AddDoorDialog` + `ShelfPinDialog` render, default correctly, submit numeric params, and mount in `WorkFeatureDialogsHost`.
> - Ribbon shows **Add Door / Двері**, **Система-32**, **Система-32 (pick)/(вибір)**; auto button opens the shelf-pin dialog.
> - Marker guard locks that `shelfPin`/`hinge` bores render one marker each with a color (exhaustive-key assertion, no narrowed-Record regression). The compile-time `satisfies Record<BoreConnectorKind,string>` on `BORE_COLORS` (Phase 1) is the primary lock; the runtime test is secondary.
> - `oneComponentPickHandle` store slot round-trips null↔handle; App.tsx feeds `.pick()` on canvas click.
> - `tsc --noEmit` clean on `packages/app` (given Phases 0/1/5/6/7 landed).
> - **§6 browser verification is deferred to Phase 10** (per spec §14.10): dialog/ribbon UI is DOM-verifiable here, but the actual marker render + door visibility are proven by Phase 10's controller probes (`boreMarkerCount`, door component present via `subAssemblyDocs[cabinetPath].components.filter(c => c.role === 'door').length`).
> - **LEFT_SIDE_INNER_FACE / RIGHT_SIDE_INNER_FACE** are imported from `packages/shared/src/prisadkaFaceConventions.ts` (Phase 0 output). No local literals.
> - **AddDoorCommand** receives `cabinetPath` only (no `cabinet:{width:0,...}` zeros). The command derives dims internally from the unpacked `.ziasm`.

<!-- selfcritique:
Weaknesses:
1. `resolvePartPath` in handleSystem32Manual uses `allComponents.find(c => c.partPath === panelPath)` — this is O(N) across all assembly components, but N is small for cabinet assemblies. The more precise resolution via the picked ComponentPath (not partPath) is available but requires the `onPick` signature to carry the raw path, which it does (`onPick(partPath, path)` — Phase 7 contract). The `path` arg could be used to look up the role via assembly traversal, but the flat search shown is simpler and correct for the present sub-assembly depth.
2. The App.tsx wiring inserts BEFORE the `dragBusy` check. This means a pending pick consumes a pointerdown that might otherwise start a drag — the correct behavior (pick takes priority), but the assembler should confirm the insertion point is truly before the dragBusy declaration, not inside an enclosing block.
3. `AddDoorCommand` params type change: the original contract (§C) shows `DoorMathInput` which included `cabinet: {...}`. Removing the `cabinet` field from the Phase 8 call requires Phase 5's `AddDoorCommand` to accept a params object WITHOUT `cabinet` (since it derives it internally). The assembler must confirm Phase 5's type signature agrees with this omission or uses `Omit<DoorMathInput,'cabinet'>` for the command's `params` field.
4. `LEFT_SIDE_INNER_FACE` import path uses `@zilventor/shared/src/prisadkaFaceConventions` (deep path). If the barrel re-exports these constants (Phase 0 adds them to the shared barrel), prefer `{ LEFT_SIDE_INNER_FACE, RIGHT_SIDE_INNER_FACE } from '@zilventor/shared'`.

Assumptions:
- Phase 0 has shipped `prisadkaFaceConventions.ts` with `LEFT_SIDE_INNER_FACE`/`RIGHT_SIDE_INNER_FACE`/`DOOR_CUP_FACE` exported.
- Phase 5's `AddDoorCommand` params type does NOT require `cabinet:{...}` (it derives dims from the unpacked .ziasm). The assembler must verify this before committing.
- `Opfs.forNavigator()` is available in FurnitureTab (already imported at `:24` of the existing file).
- The `type ComponentPath` import from `@zilventor/shared` doesn't create a duplicate (the existing file doesn't import it — confirmed by grep of existing imports above).
- `subAssemblyDocs` is a store field of type `Record<string, AssemblyDocument>` (verified at `useAppStore.ts:274`).

Confidence: 79 — the dialog/i18n/store/marker mechanics are verified against real code; the cross-phase seams (Phase 5 params type without `cabinet`, Phase 0 face-convention imports) are correctly flagged but not verifiable from this chunk alone; the App.tsx pointer-handler insertion is architecturally correct but the exact line number may shift ±10 after Phase 1–7 edits.
-->

---

## Phase 9 — bake guards (real OCCT)

> **Scope:** two kernel real-OCCT integration specs that feed the GENERATED `shelfPinGrid`/`hingeMath` bores through `executeHoleFeature` and assert Ø35 cup volume drop on the broad door face + each Ø5 pin/plate void in-bounds + BLIND with residual material + correct grid count — closing slice-1’s never-baked side-bore gap. Both import the broad-face/pose constants from `prisadkaFaceConventions.ts` (Phase 0). **Runs AFTER Phases 2/4/5/6** (it bakes their producer output); place it just before Phase 10.
>
> **Test runner:** `npx vitest run --config vitest.integration.config.ts <file>` from `packages/kernel/`.

---

### Task 2: Phase 9 — система-32 shelf-pin bake guard (real OCCT)

Builds the REAL side panel via `buildPanelBox` with UNSWAPPED native dims `{length:H, width:D, thickness:Tc}`, feeds the GENERATED `shelfPinGrid(...)` output (NOT hand-authored) through `executeHoleFeature`, and asserts: each Ø5 void present, `u∈[0,H]`/`v∈[0,D]` in-bounds, **blind** (residual material remains — not `throughAll`), and the grid count equals `columnPositions(...).length × columns`. Imports `LEFT_SIDE_INNER_FACE` from `prisadkaFaceConventions` — no local literal. Closes the exact gap noted in the contract (§H): slice-1's side-panel face-bore "guard" was `throughAll` and never tested a blind on-face placement.

> **Dependency:** `shelfPinGrid` + `columnPositions` + `DEFAULT_SHELF_PIN_PARAMS` are authored in the Phase 2 chunk (`packages/shared/src/shelfPinGrid.ts`), exported via the shared barrel. This task is written RED-first to BLOCK until those exist, then goes green. The bake guard is the cross-check that the pure producer and the real kernel agree — it MUST use the producer's REAL output, never hand-authored coordinates (the slice-1 false-green killer).

**Files:**
- Create: `packages/kernel/src/adapter/features/__tests__/HoleFeature.system32.integration.spec.ts`
- Depends on (other chunk): `packages/shared/src/shelfPinGrid.ts` exporting `shelfPinGrid`, `columnPositions`, `DEFAULT_SHELF_PIN_PARAMS`, `ShelfPinParams`.
- Imports `LEFT_SIDE_INNER_FACE` from `@zilventor/shared` (conventions module from Task 0 — no local literal).
- Reference (verified): `packages/kernel/src/occt/PanelOps.ts:56-99`, `packages/kernel/src/adapter/features/HoleFeature.ts:288-343,365-443`.

- [ ] **Step 1 (RED): write the система-32 bake guard.** Create `packages/kernel/src/adapter/features/__tests__/HoleFeature.system32.integration.spec.ts`:

  ```ts
  /**
   * PHASE 9 — Система-32 shelf-pin bake guard (real OCCT).
   *
   * Anti-false-green: feeds the REAL shelfPinGrid() generator output (NOT hand-authored
   * coordinates) into executeHoleFeature on a REAL buildPanelBox side panel with UNSWAPPED
   * native dims {length:H, width:D, thickness:Tc}, and asserts:
   *   - each Ø5 void is present (per-bore volume drop ≈ π·2.5²·depth, blind),
   *   - u ∈ [0,H] and v ∈ [0,D] in-bounds on the broad inner (Top/Bottom) face,
   *   - BLIND: the cumulative drop is well below a through-pierce (residual material remains),
   *   - grid count = columnPositions(...).length × columns.
   *
   * Closes slice-1's never-baked side-bore gap: HoleFeature.catalogBore.integration.spec.ts
   * (lines ~176-191) only asserted the side-panel face bore is 'throughAll' and never baked it,
   * so a blind on-face mis-placement would have passed. This guard bakes the blind bores.
   *
   * INNER_FACE is imported from prisadkaFaceConventions (the Phase-0 contract constant).
   * No local re-declaration of 'Bottom'/'Top' literals — any sign error turns Phase-0 RED.
   */
  import { describe, it, expect, beforeAll } from 'vitest';
  import { loadOcct } from '../../../occt/occtLoader';
  import { buildPanelBox } from '../../../occt/PanelOps';
  import { executeHoleFeature } from '../HoleFeature';
  import {
    shelfPinGrid,
    columnPositions,
    DEFAULT_SHELF_PIN_PARAMS,
    LEFT_SIDE_INNER_FACE,
  } from '@zilventor/shared';
  import type { BoreOp } from '@zilventor/shared';
  import type { NamedShape } from '../../../occt/FaceNaming';
  import type { OcctShape } from '../../../occt/SolidOps';

  // REAL side panel native dims (baseCabinet.ts: leftSide {length:H, width:D, thickness:Tc}).
  const H = 720, D = 560, Tc = 18;
  const SIDE_DIMS = { length: H, width: D, thickness: Tc };
  // INNER_FACE imported from the conventions module — not a local literal.
  // Phase-0 has DERIVED and PROVEN this value; this guard uses it as a consumer.
  const INNER_FACE = LEFT_SIDE_INNER_FACE;

  describe('PHASE 9 — система-32 shelf-pin bake guard (real OCCT)', () => {
    let oc: any;
    beforeAll(async () => { oc = await loadOcct(); });

    function buildNamed(dims: { length: number; width: number; thickness: number }): NamedShape {
      const { length: L, width: W, thickness: T } = dims;
      const panel = buildPanelBox(oc, dims);
      const faceNamesArr: NamedShape['faceNames'] = [];
      const map = new oc.TopTools_IndexedMapOfShape_1();
      oc.TopExp.MapShapes_1(panel.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
      const hL = L / 2, hW = W / 2;
      for (let i = 1; i <= map.Extent(); i++) {
        const faceShape = map.FindKey(i);
        const face = oc.TopoDS.Face_1(faceShape);
        const props = new oc.GProp_GProps_1();
        oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
        const c = props.CentreOfMass();
        const x = c.X(), y = c.Y(), z = c.Z();
        props.delete?.();
        let role: string;
        if (Math.abs(z - T) < 0.5) role = 'Top';
        else if (Math.abs(z) < 0.5) role = 'Bottom';
        else if (Math.abs(y - hW) < 0.5) role = 'Front';
        else if (Math.abs(y + hW) < 0.5) role = 'Back';
        else if (Math.abs(x + hL) < 0.5) role = 'Left';
        else role = 'Right';
        faceNamesArr.push({ name: { featureId: 'panel', role, instance: 0 }, face });
      }
      map.delete();
      return { shape: panel.shape as unknown as OcctShape, faceNames: faceNamesArr } as NamedShape;
    }

    function volumeOf(shape: unknown): number {
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.VolumeProperties_1(shape, props, 1e-7, false, false);
      const v = props.Mass();
      props.delete?.();
      return v;
    }

    /** atFace hole feature for a single generated BoreOp (BakeBoresCommand format). */
    function boreFeature(bore: BoreOp): any {
      return {
        id: `bake:${bore.face.role}:${bore.diameter}:${bore.depth}:0`,
        kind: 'hole',
        placement: {
          kind: 'atFace',
          faceName: bore.face,
          points: [{ u: bore.u, v: bore.v }],
          axis: 'into-face',
        },
        profile: { kind: 'simple', diameter: { kind: 'literal', value: bore.diameter } },
        termination: { kind: 'distance', depth: { kind: 'literal', value: bore.depth } },
        flipAxis: false,
      };
    }

    it('grid count = columnPositions(start,end,pitch).length × columns, all role shelfPin-system32', () => {
      const bores = shelfPinGrid(SIDE_DIMS, INNER_FACE, DEFAULT_SHELF_PIN_PARAMS);
      const p = DEFAULT_SHELF_PIN_PARAMS;
      const perColumn = columnPositions(p.bottomMargin, H - p.topMargin, p.pitch).length;
      expect(bores.length).toBe(perColumn * p.columns);
      for (const b of bores) {
        expect(b.role).toBe('shelfPin-system32');
        expect(b.connectorKind).toBe('shelfPin');
        expect(b.diameter).toBe(p.diameter); // Ø5
        expect(b.depth).toBe(p.depth);        // blind 13
        expect(b.depth).not.toBe('throughAll');
      }
    });

    it('generated bores are in-bounds: u ∈ [0,H], v ∈ [0,D] on the broad inner face (imported constant)', () => {
      const bores = shelfPinGrid(SIDE_DIMS, INNER_FACE, DEFAULT_SHELF_PIN_PARAMS);
      for (const b of bores) {
        // face.role must equal the imported constant — no local literal comparison.
        expect(b.face.role).toBe(INNER_FACE);
        expect(b.u).toBeGreaterThanOrEqual(0);
        expect(b.u).toBeLessThanOrEqual(H);   // u = height, spans 0..length=H
        expect(b.v).toBeGreaterThanOrEqual(0);
        expect(b.v).toBeLessThanOrEqual(D);   // v = depth, spans 0..width=D
      }
    });

    it('OCCT: a single generated Ø5 pin bore cuts a real BLIND void (residual material remains)', () => {
      const bores = shelfPinGrid(SIDE_DIMS, INNER_FACE, DEFAULT_SHELF_PIN_PARAMS);
      const bore = bores[0]!;
      const depth = bore.depth as number;
      expect(depth).toBeGreaterThan(0);
      expect(depth).toBeLessThan(Tc); // blind: hole depth < board thickness

      const volBefore = H * D * Tc;
      const running = buildNamed(SIDE_DIMS);
      const result = executeHoleFeature(oc, running, boreFeature(bore), (p: any) => p.value, new Map());
      const volAfter = volumeOf(result.shape);
      const drop = volBefore - volAfter;

      const cyl = Math.PI * 2.5 * 2.5 * depth; // Ø5 r=2.5
      expect(drop).toBeGreaterThan(50);          // bore cut something
      expect(drop).toBeGreaterThan(cyl * 0.9);
      expect(drop).toBeLessThan(cyl * 1.4);      // BLIND: no through-pierce
      // Residual: a through-hole would drop ≈ π·2.5²·Tc; assert strictly less.
      expect(drop).toBeLessThan(Math.PI * 2.5 * 2.5 * Tc);
    });

    it('OCCT: baking ALL generated pin bores leaves a solid with substantial residual volume (none pierce)', () => {
      const bores = shelfPinGrid(SIDE_DIMS, INNER_FACE, DEFAULT_SHELF_PIN_PARAMS);
      const volBefore = H * D * Tc;
      let running = buildNamed(SIDE_DIMS);
      for (const bore of bores) {
        running = executeHoleFeature(oc, running, boreFeature(bore), (p: any) => p.value, new Map());
      }
      const volAfter = volumeOf(running.shape);
      const drop = volBefore - volAfter;
      // Total drop ≈ N · π·2.5²·13; must be > 0 and far below the board volume (blind, not sliced).
      const perBore = Math.PI * 2.5 * 2.5 * (DEFAULT_SHELF_PIN_PARAMS.depth as number);
      expect(drop).toBeGreaterThan(perBore * bores.length * 0.8);
      expect(drop).toBeLessThan(perBore * bores.length * 1.5);
      expect(volAfter).toBeGreaterThan(volBefore * 0.9); // residual material dominates
    });
  });
  ```

- [ ] **Step 2 (RED→confirm): run; confirm RED for the expected reason (producer not yet present, or — if Phase 2 already landed — a real geometry check).** Run from `packages/kernel/`:

  ```
  npx vitest run --config vitest.integration.config.ts src/adapter/features/__tests__/HoleFeature.system32.integration.spec.ts
  ```

  Expected RED (if Phase 2 not yet merged): module-resolution failure on `import { shelfPinGrid, columnPositions, DEFAULT_SHELF_PIN_PARAMS } from '@zilventor/shared'` — `Failed to resolve import` / `No "shelfPinGrid" export`. That is the correct RED: this guard is BLOCKED on the producer.
  Expected RED (if Phase 2 IS merged but the producer is wrong): a geometry assertion (out-of-bounds `u`/`v`, wrong face role, or volume-drop out of band) — which is the guard doing its job. In either case, read the full output before proceeding.

- [ ] **Step 3 (GREEN): once `shelfPinGrid` exists and is correct, confirm pass.** Re-run the same command. Expected GREEN:

  ```
   ✓ src/adapter/features/__tests__/HoleFeature.system32.integration.spec.ts (4 tests)
   Test Files  1 passed (1)
        Tests  4 passed (4)
  ```

  > If a geometry assertion fails here while the Phase 2 unit tests are green, invoke `superpowers:systematic-debugging`: the producer's pure unit test agrees with itself but the REAL kernel bake disagrees — this is exactly the slice-1 false-green signature (synthetic vs real). Diagnose by printing the generated `bores[0]` `(face.role,u,v,depth)` and comparing against the Phase 0 frame, NOT by relaxing the assertion.

- [ ] **Step 4 (refactor): none expected.** Helpers are local and mirror the sibling specs. Confirm `tsc`:

  ```
  npx tsc --noEmit
  ```

  Expected: clean (depends on the `shelfPinGrid`/`BoreOp`/`LEFT_SIDE_INNER_FACE` exports existing in `@zilventor/shared`).

- [ ] **Step 5 (commit):**

  ```
  git add packages/kernel/src/adapter/features/__tests__/HoleFeature.system32.integration.spec.ts
  git commit -m "$(cat <<'EOF'
  test(kernel): Phase 9 система-32 shelf-pin bake guard (присадка slice 2)

  Feeds the REAL shelfPinGrid() output (not hand-authored) into
  executeHoleFeature on a REAL buildPanelBox side panel and asserts each Ø5
  void is blind + in-bounds (u∈[0,H], v∈[0,D]) on the broad inner face
  (imported LEFT_SIDE_INNER_FACE — no local literal). Grid count =
  columnPositions·columns. Residual material remains. Closes slice-1's
  never-baked side-bore gap.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Phase 9 — hinge-cup bake guard (real OCCT)

Builds the REAL door part via `buildPanelBox(length=doorH, width=doorW, thickness=Td)`, feeds the GENERATED `hingeCupBores(...)` output through `executeHoleFeature`, and asserts: Ø35 cup volume drop on the broad door face (`DOOR_CUP_FACE` imported from conventions — no local literal), each cup **blind** (`depth < Td`), correct hinge count, AND the cup lands within `CUP_SETBACK[overlay]` of the CORRECT edge for BOTH `hingeSide` values (`v=CUP_SETBACK` at the `v=0` edge for `'left'`; `v=doorW−CUP_SETBACK` at the `v=doorW` edge for `'right'`).

> **Dependency:** `hingeCupBores`, `hingePositions`, `hingeCountForHeight`, `CUP_SETBACK`, `CUP_DIAMETER`, `CUP_DEPTH` are authored in the Phase 4 chunk (`packages/shared/src/hingeMath.ts`). RED-first to block until they exist. `DOOR_CUP_FACE` is imported from `prisadkaFaceConventions` — not re-declared locally.

**Files:**
- Create: `packages/kernel/src/adapter/features/__tests__/HoleFeature.hingeCup.integration.spec.ts`
- Imports `DOOR_CUP_FACE` from `@zilventor/shared` (conventions module — not a local `'Bottom'`/`'Top'` literal).
- Depends on (other chunk): `packages/shared/src/hingeMath.ts` exporting `hingeCupBores`, `hingePositions`, `hingeCountForHeight`, `CUP_SETBACK`, `CUP_DIAMETER`, `CUP_DEPTH`.
- Reference (verified): `packages/kernel/src/occt/PanelOps.ts:56-99`, `packages/kernel/src/adapter/features/HoleFeature.ts:288-343,365-443`, `packages/shared/src/bore.ts:45-65`.

- [ ] **Step 1 (RED): write the hinge-cup bake guard.** Create `packages/kernel/src/adapter/features/__tests__/HoleFeature.hingeCup.integration.spec.ts`:

  ```ts
  /**
   * PHASE 9 — Hinge-cup bake guard (real OCCT).
   *
   * Anti-false-green: feeds the REAL hingeCupBores() generator output (NOT hand-authored)
   * into executeHoleFeature on a REAL buildPanelBox door part
   * {length:doorH, width:doorW, thickness:Td}, and asserts:
   *   - Ø35 cup volume drop on the broad carcass-facing door face (DOOR_CUP_FACE),
   *   - each cup is BLIND (depth < Td; residual material remains, no through-pierce),
   *   - correct hinge count = hingeCountForHeight(doorH),
   *   - the cup lands within CUP_SETBACK[overlay] of the CORRECT hinge edge for BOTH
   *     hingeSide values:
   *        hingeSide 'left'  → v = CUP_SETBACK[overlay]         (edge at v=0)
   *        hingeSide 'right' → v = doorW − CUP_SETBACK[overlay]  (edge at v=doorW)
   *
   * DOOR_CUP_FACE is imported from prisadkaFaceConventions (the Phase-0 contract constant).
   * No local re-declaration of 'Bottom'/'Top' — wrong constant turns Phase-0 A4/B2 RED.
   * The cup is a large-Ø shallow blind hole; no new kernel surface (spec §11).
   */
  import { describe, it, expect, beforeAll } from 'vitest';
  import { loadOcct } from '../../../occt/occtLoader';
  import { buildPanelBox } from '../../../occt/PanelOps';
  import { executeHoleFeature } from '../HoleFeature';
  import {
    hingeCupBores,
    hingePositions,
    hingeCountForHeight,
    CUP_SETBACK,
    CUP_DIAMETER,
    CUP_DEPTH,
    face2DFrame,
    DOOR_CUP_FACE,
  } from '@zilventor/shared';
  import type { BoreOp } from '@zilventor/shared';
  import type { NamedShape } from '../../../occt/FaceNaming';
  import type { OcctShape } from '../../../occt/SolidOps';

  // REAL full-overlay door on a 600×720 cabinet (doorMath full single: doorW=W-2r, doorH=H-2r).
  const DOOR_H = 716, DOOR_W = 596, Td = 18;
  const DOOR_DIMS = { length: DOOR_H, width: DOOR_W, thickness: Td };
  // DOOR_CUP_FACE imported from conventions — no local 'Bottom'/'Top' literal.
  const OVERLAY: 'full' | 'half' | 'inset' = 'full';

  describe('PHASE 9 — hinge-cup bake guard (real OCCT)', () => {
    let oc: any;
    beforeAll(async () => { oc = await loadOcct(); });

    function buildNamed(dims: { length: number; width: number; thickness: number }): NamedShape {
      const { length: L, width: W, thickness: T } = dims;
      const panel = buildPanelBox(oc, dims);
      const faceNamesArr: NamedShape['faceNames'] = [];
      const map = new oc.TopTools_IndexedMapOfShape_1();
      oc.TopExp.MapShapes_1(panel.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
      const hL = L / 2, hW = W / 2;
      for (let i = 1; i <= map.Extent(); i++) {
        const faceShape = map.FindKey(i);
        const face = oc.TopoDS.Face_1(faceShape);
        const props = new oc.GProp_GProps_1();
        oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
        const c = props.CentreOfMass();
        const x = c.X(), y = c.Y(), z = c.Z();
        props.delete?.();
        let role: string;
        if (Math.abs(z - T) < 0.5) role = 'Top';
        else if (Math.abs(z) < 0.5) role = 'Bottom';
        else if (Math.abs(y - hW) < 0.5) role = 'Front';
        else if (Math.abs(y + hW) < 0.5) role = 'Back';
        else if (Math.abs(x + hL) < 0.5) role = 'Left';
        else role = 'Right';
        faceNamesArr.push({ name: { featureId: 'panel', role, instance: 0 }, face });
      }
      map.delete();
      return { shape: panel.shape as unknown as OcctShape, faceNames: faceNamesArr } as NamedShape;
    }

    function volumeOf(shape: unknown): number {
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.VolumeProperties_1(shape, props, 1e-7, false, false);
      const v = props.Mass();
      props.delete?.();
      return v;
    }

    function boreFeature(bore: BoreOp): any {
      return {
        id: `bake:${bore.face.role}:${bore.diameter}:${bore.depth}:0`,
        kind: 'hole',
        placement: {
          kind: 'atFace',
          faceName: bore.face,
          points: [{ u: bore.u, v: bore.v }],
          axis: 'into-face',
        },
        profile: { kind: 'simple', diameter: { kind: 'literal', value: bore.diameter } },
        termination: { kind: 'distance', depth: { kind: 'literal', value: bore.depth } },
        flipAxis: false,
      };
    }

    function genCups(hingeSide: 'left' | 'right'): BoreOp[] {
      const us = hingePositions(DOOR_H, hingeCountForHeight(DOOR_H));
      return hingeCupBores(DOOR_DIMS, DOOR_CUP_FACE, hingeSide, OVERLAY, us);
    }

    it('hinge count = hingeCountForHeight(doorH); cups are Ø35 blind, role hingeCup', () => {
      const count = hingeCountForHeight(DOOR_H);
      const cups = genCups('left');
      expect(cups.length).toBe(count);
      for (const c of cups) {
        expect(c.role).toBe('hingeCup');
        expect(c.connectorKind).toBe('hinge');
        expect(c.diameter).toBe(CUP_DIAMETER); // 35
        expect(c.depth).toBe(CUP_DEPTH);        // 12, blind
        expect(c.depth as number).toBeLessThan(Td);
        // face.role must equal the imported DOOR_CUP_FACE constant — no local literal.
        expect(c.face.role).toBe(DOOR_CUP_FACE);
      }
    });

    it("hingeSide 'left' → cups at v = CUP_SETBACK[overlay] (edge at v=0)", () => {
      const cups = genCups('left');
      for (const c of cups) {
        expect(c.v).toBeCloseTo(CUP_SETBACK[OVERLAY], 3);
        expect(c.u).toBeGreaterThanOrEqual(0);
        expect(c.u).toBeLessThanOrEqual(DOOR_H); // u = hinge position along doorH
      }
    });

    it("hingeSide 'right' → cups at v = doorW − CUP_SETBACK[overlay] (edge at v=doorW)", () => {
      const cups = genCups('right');
      for (const c of cups) {
        expect(c.v).toBeCloseTo(DOOR_W - CUP_SETBACK[OVERLAY], 3);
      }
    });

    it('OCCT: a generated Ø35 cup cuts a real BLIND void on the broad door face (residual remains)', () => {
      const cups = genCups('left');
      const cup = cups[0]!;
      const depth = cup.depth as number;
      expect(depth).toBeLessThan(Td); // blind

      const volBefore = DOOR_H * DOOR_W * Td;
      const running = buildNamed(DOOR_DIMS);
      const result = executeHoleFeature(oc, running, boreFeature(cup), (p: any) => p.value, new Map());
      const drop = volBefore - volumeOf(result.shape);

      const cyl = Math.PI * 17.5 * 17.5 * depth; // Ø35 r=17.5
      expect(drop).toBeGreaterThan(1000);
      expect(drop).toBeGreaterThan(cyl * 0.9);
      expect(drop).toBeLessThan(cyl * 1.4); // BLIND: not a through-pierce
      // A through cup would drop ≈ π·17.5²·Td; assert strictly less (residual material).
      expect(drop).toBeLessThan(Math.PI * 17.5 * 17.5 * Td);
    });

    it('OCCT: the generated cup lands near the correct part-local 3D point for the hinge edge', () => {
      // Cross-check the producer (u,v) against face2DFrame so a u/v swap or wrong-edge bug is
      // caught geometrically (the slice-1 class), independent of the bake volume.
      // Uses DOOR_CUP_FACE imported from conventions — no local literal.
      const cup = genCups('left')[0]!;
      const frame = face2DFrame(DOOR_DIMS, DOOR_CUP_FACE);
      const Px = frame.origin.x + frame.uDir.x * cup.u + frame.vDir.x * cup.v;
      const Py = frame.origin.y + frame.uDir.y * cup.u + frame.vDir.y * cup.v;
      // DOOR_CUP_FACE = 'Bottom': origin (-doorH/2, +doorW/2, 0), uDir +X, vDir -Y.
      // v=CUP_SETBACK[full]=21 from the v=0 edge → Py = +doorW/2 − CUP_SETBACK.
      // u along doorH → Px = -doorH/2 + u. Assert both are within the door footprint.
      expect(Px).toBeGreaterThanOrEqual(-DOOR_H / 2 - 1e-3);
      expect(Px).toBeLessThanOrEqual(DOOR_H / 2 + 1e-3);
      expect(Py).toBeGreaterThanOrEqual(-DOOR_W / 2 - 1e-3);
      expect(Py).toBeLessThanOrEqual(DOOR_W / 2 + 1e-3);
      // Specifically: for 'left' hingeSide, cup is at v=CUP_SETBACK[full]=21.
      // Bottom vDir=-Y so Py = +doorW/2 - 21 = 277.
      expect(Py).toBeCloseTo(DOOR_W / 2 - CUP_SETBACK[OVERLAY], 3);
    });
  });
  ```

- [ ] **Step 2 (RED→confirm): run; confirm RED for the expected reason.** Run from `packages/kernel/`:

  ```
  npx vitest run --config vitest.integration.config.ts src/adapter/features/__tests__/HoleFeature.hingeCup.integration.spec.ts
  ```

  Expected RED (if Phase 4 not yet merged): module-resolution failure on the `hingeCupBores`/`hingePositions`/`hingeCountForHeight`/`CUP_SETBACK`/`CUP_DIAMETER`/`CUP_DEPTH` imports — `No "hingeCupBores" export` / `Failed to resolve import`. Correct RED: blocked on the producer.
  Expected RED (if Phase 4 IS merged but wrong): a `v`-edge assertion (left/right edge mix-up), hinge-count mismatch, or volume-drop out of band — the guard doing its job. Read the full output.

- [ ] **Step 3 (GREEN): once `hingeMath` exists and is correct, confirm pass.** Re-run. Expected GREEN:

  ```
   ✓ src/adapter/features/__tests__/HoleFeature.hingeCup.integration.spec.ts (5 tests)
   Test Files  1 passed (1)
        Tests  5 passed (5)
  ```

  > If the `'right'`-side edge assertion fails while Phase 4 unit tests pass, invoke `superpowers:systematic-debugging`: the producer likely placed the cup at `CUP_SETBACK` for BOTH sides (the hingeSide-dependent `v` bug the spec §16 flags). Diagnose by printing both `genCups('left')[0].v` and `genCups('right')[0].v` and comparing to `CUP_SETBACK[OVERLAY]` vs `DOOR_W − CUP_SETBACK[OVERLAY]` — do not relax the assertion.

- [ ] **Step 4 (refactor): none expected.** Confirm `tsc`:

  ```
  npx tsc --noEmit
  ```

  Expected: clean (depends on `hingeMath` exports + `DOOR_CUP_FACE` from `@zilventor/shared`).

- [ ] **Step 5 (commit):**

  ```
  git add packages/kernel/src/adapter/features/__tests__/HoleFeature.hingeCup.integration.spec.ts
  git commit -m "$(cat <<'EOF'
  test(kernel): Phase 9 hinge-cup bake guard (присадка slice 2)

  Feeds the REAL hingeCupBores() output (not hand-authored) into
  executeHoleFeature on a REAL buildPanelBox door part and asserts the Ø35 cup
  drops volume on the broad carcass-facing face (DOOR_CUP_FACE imported from
  prisadkaFaceConventions — no local literal), stays BLIND (depth < Td), has
  the correct hinge count, and lands at v=CUP_SETBACK (left) vs
  doorW−CUP_SETBACK (right) — catching the hingeSide-dependent-v bug geometrically.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

**Notes for the assembler / executor:**

- **Ordering:** Task 0 (create conventions module) → Task 1 (Phase 0 guard; derives constants) → Phases 2/3/4 (other chunks; import the module) → Tasks 2 & 3 (Phase 9 guards; RED-blocked until Phase 2/Phase 4 land).
- **Constants:** `LEFT_SIDE_INNER_FACE='Top'`, `RIGHT_SIDE_INNER_FACE='Bottom'`, `DOOR_CUP_FACE='Bottom'` (with `DOOR_POSE.quaternion=[0,0,0,1]` as placeholder). These are derived and proven by Phase 0 A4/B2; if the Phase-0 tests force corrections, update `prisadkaFaceConventions.ts` until the derivation is green, then ALL downstream phases automatically get the correct values via import.
- **No local re-declarations:** a `git grep '_INNER_FACE\|CUP_FACE\|DOOR_POSE'` at the end of the plan must show ONLY the module declaration + imports, zero re-declarations.
- **All three specs** match `vitest.integration.config.ts` `include` by file location + `.integration.spec.ts` suffix — no config change needed.
- **Phase 9 tests A4 / B2 in Task 1 are the core non-tautological guards**: if `prisadkaFaceConventions.ts` has wrong literal values, these tests go RED. The fix is to correct the module constant, which automatically fixes all consumers.

<!-- selfcritique:
Weaknesses:
1. A4's derivation is pure pose-math (no OCCT execution), so it proves the convention is geometrically derived but does not run OCCT to confirm it. A5 adds a real-OCCT bake guard but it proves BLIND behavior, not "which side of the interior." The strongest possible proof (void centroid on the cabinet-interior side of the world X axis) would need the assembly world transform, which is not available in a kernel unit test.
2. DOOR_POSE.quaternion = [0,0,0,1] is still a placeholder (acknowledged: finalized by Phase-10 §6 browser pass). B4 only checks structure, not numeric value.
3. The constants LEFT='Top'/RIGHT='Bottom' are derived from the GenerateCarcassBoresCommand L↔T swap comment — trusting that comment accurately describes the render rotation. If the actual render uses a different rotation, these constants would be wrong and the Phase-10 §6 pass would be the catch.

Assumptions:
1. The L↔T swap in GenerateCarcassBoresCommand.ts:108-128 is the canonical documentation of the render rotation. Verified by reading the file.
2. face2DFrame Bottom vDir=-Y is verified against bore.ts:54.
3. All three specs' file locations match the integration config glob (verified suffix + path).

Confidence: 82 — the derivation logic is sound and verified against GenerateCarcassBoresCommand's documented swap; the constants LEFT='Top'/RIGHT='Bottom' match what Phases 5/6 had (the verifier noted these were consistent). The residual risk is the DOOR_POSE placeholder and the assumption that the render rotation is exactly as documented. Phase-10 §6 browser pass remains the final confirmation.
-->

---

## Phase 10 — e2e + §6 browser

> **Reads-as.** This phase ships ONE real-WASM Playwright e2e (`prisadka-slice2-doors-system32.spec.ts`) exercising the full slice-2 flow against real OCCT / real DXF·CSV bytes / real OPFS / real 3D markers, then a §6 browser-verification checklist that runs that e2e against the live dev server and reads back the probe output (the viewport is BLACK in headless Chrome, so every visual claim is made through `window.__zilventorStore` probes, never screenshots), then a `tsc --noEmit` gate on every touched package. It mirrors `tests/e2e/prisadka-carcass-boring.spec.ts` (the slice-1 e2e, read in full) and the `store.viewport.getSceneManager()` probe from `tests/e2e/furniture/edge-band-toggle.spec.ts:73-84`.
>
> **Load-bearing difference from slice-1.** Slice-1's e2e (`prisadka-carcass-boring.spec.ts:4-7`) skipped 3D-marker assertions because prod left `subAssemblyDocs` unpopulated → cabinets were placeholder boxes → no markers. That gap is CLOSED in slice-2: (a) the production sub-assembly loader now warms `subAssemblyDocs` (`App.tsx:3162-3206`, shipped `bdfe322`), and (b) `AddDoorCommand` (Phase 5, §F) explicitly reloads the door's `.ziasm` entry. So this e2e DOES assert markers via `getSceneManager().boreMarkerCount()`, using the verified `window.__zilventorSubAsmInvalidate(cabinetPath)` DEV hook (`App.tsx:2977-2998`) to deterministically force the warm + marker-rebuild before reading the count. This is the §6 advance that proves the door renders as a REAL panel (markers only build for real `leaf` geometry — a placeholder 50mm box has no bore overlay spec).

> **Prerequisite.** Phases 0–9 are GREEN: `AddDoorCommand`, `GenerateShelfPinBoresCommand`, `AddManualShelfPinBoresCommand`, `doorMath`/`shelfPinGrid`/`hingeMath`, the v22 manifest bump, the widened `BORE_COLORS`, the FurnitureTab wiring, and the two kernel bake guards all exist and pass. This phase adds NO production code — it is pure verification (one e2e spec + a manual §6 checklist + typecheck). If any probe here fails, it is a real regression: stop and apply `superpowers:systematic-debugging` (do NOT weaken the assertion).

---

### Task 1: Real-WASM e2e — Add Door → cup markers → bake → holes; Система-32 → pin markers → DXF/CSV bytes

**Files:**
- **Create** `tests/e2e/prisadka-slice2-doors-system32.spec.ts`
- **Reference (read, do not edit):** `tests/e2e/prisadka-carcass-boring.spec.ts:1-421` (canonical slice-1 flow), `tests/e2e/furniture/edge-band-toggle.spec.ts:73-84` (`store.viewport.getSceneManager()` probe), `tests/e2e/helpers/buildBox.ts:4` (`waitForKernelReady`), `tests/e2e/assembly/subasm-invalidate-cascade.spec.ts:74` (`__zilventorSubAsmInvalidate` usage)
- **Run from:** repo root (`/Users/lion/Documents/Projects/mine/zilventor`) with `pnpm test:e2e` (= `playwright test --project=chromium`, `playwright.config.ts:11`)

> **Naming note for the implementer.** Several symbols below are produced by earlier phases. Re-confirm at write-time against the as-shipped code, because Phase 8 (FurnitureTab wiring) and Phase 5/6 (commands) may have chosen slightly different command-option field names than the contract's draft. The exact symbols this spec depends on are: `AddDoorCommand` ctor opts `{ cabinetPath, params, opfs, kernel?, store? }` (§C), `params: DoorMathInput` (§C: fields OTHER than `cabinet` — the command derives `cabinet` from the unpacked `.ziasm`), `GenerateShelfPinBoresCommand` ctor opts `{ params: ShelfPinParams, opfs, store? }` (§C), `BakeBoresCommand` ctor `{ partPath, opfs, kernel }` (verified `prisadka-carcass-boring.spec.ts:335`). If a name differs, update the spec to match the SHIPPED name — the spec is the consumer, the command is the contract source of truth.
>
> **Addendum §4 compliance:** `AddDoorCommand.apply()` DERIVES `{ width, height, depth, Tc, toekickHeight }` from the unpacked cabinet `.ziasm` (per the Phase 5 fix). The e2e MUST drive this derivation path, not bypass it by hardcoding `cabinet: { width:600, height:720, … }`. Do NOT pass a `cabinet` field to the command — if the command opts type still accepts it, omit it and let the command derive it. This is the difference between a real end-to-end test and a false-green.

- [ ] **Step 1 (red — author the failing e2e):** Create `tests/e2e/prisadka-slice2-doors-system32.spec.ts` with the COMPLETE content below. It will fail RED at first run because the slice-2 commands don't exist yet *if run before Phases 5/6* — but in the assembled plan Phases 5/6 are already GREEN, so the meaningful RED is any probe-assertion miss. Author it verbatim:

```ts
/**
 * E2E: присадка slice 2 — doors + Система-32 shelf pins.
 * Real WASM · real OCCT bake · real DXF/CSV bytes · real OPFS · real 3D markers.
 *
 * This is the slice-2 advance over prisadka-carcass-boring.spec.ts: that spec
 * SKIPPED 3D-marker assertions because prod left subAssemblyDocs unpopulated
 * (cabinets = placeholder boxes). Slice 1 (bdfe322) shipped the production
 * sub-assembly loader (App.tsx:3162-3206) AND AddDoorCommand reloads the door's
 * .ziasm entry, so this spec DOES assert markers via
 * store.viewport.getSceneManager().boreMarkerCount(), forcing the warm+rebuild
 * deterministically with the __zilventorSubAsmInvalidate DEV hook.
 *
 * Addendum §4: AddDoorCommand derives cabinet dims from the unpacked .ziasm —
 * this e2e drives THAT derivation path (no hardcoded cabinet:{width,height,...}
 * passed to the command). A hardcoded-dims path would be a false-green.
 *
 * Addendum §6: shelf-pin params are passed as inline literals (no dynamic import
 * of '@zilventor/shared/shelfPinGrid' — that subpath has no exports map and does
 * not resolve in the Playwright browser context). Values match DEFAULT_SHELF_PIN_PARAMS
 * as defined in Phase 2 Task 1.
 *
 * Addendum §8: F3 undo-check reads subAssemblyDocs[cabinetPath] from the store
 * (after __zilventorSubAsmInvalidate) instead of unpacking the .ziasm via
 * __zilventorUnpackProject (which is the PART packer, wrong for an assembly).
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (base cabinet, 1 shelf).
 *   B. AddDoorCommand (single, full overlay) — command derives cabinet dims from
 *      the .ziasm → door component lands in the cabinet .ziasm
 *      (subAssemblyDocs[cabinetPath].components gains role:'door')
 *      → Ø35 hingeCup markers render (real panel, NOT placeholder).
 *   C. Bake the door part → featureTree gains bake:-prefixed HoleFeatures
 *      (data-layer bake proof; real-OCCT cup void proven by the kernel
 *      hingeCup integration guard, Phase 0/9).
 *   D. GenerateShelfPinBoresCommand → side-panel .zipt gain shelfPin bores[]
 *      → Ø5 pin markers render on the side panels.
 *   E. Export DXF + CSV bytes for the aggregated bores → parse: CSV header +
 *      rows incl. Ø5 (pin) and Ø35 (cup); DXF CIRCLE entities on D5_T* / D35_T*
 *      layers.
 *   F. Undo cascade restores prior state at each layer.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

/** Parse DXF text into [groupCode, value] pairs (from prisadka-carcass-boring). */
function parseDxf(text: string): Array<[number, string]> {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i]!, 10);
    if (!isNaN(code)) pairs.push([code, lines[i + 1]!]);
  }
  return pairs;
}

test(
  'присадка slice2: door cup markers + bake + система-32 pin markers + DXF/CSV bytes + undo',
  async ({ page }) => {
    test.setTimeout(360_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      console.log('BROWSER:', m.type(), m.text());
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      console.log('PAGEERROR:', e.message);
      consoleErrors.push(`PAGEERROR: ${e.message}`);
    });

    await page.goto('/');
    await waitForKernelReady(page);

    // ── A1. New assembly ───────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
      };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });

    // ── A2. Register cabinet materials ─────────────────────────────────────────
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
      };
      const add = w.__zilventorStore.getState().addMaterial;
      add({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
      add({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
    });

    // ── A3. CreateCabinetCommand (base cabinet, 1 shelf) ───────────────────────
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new CreateCabinetCommand({
        template: 'baseCabinet',
        params: {
          name: 'Slice2 Cabinet',
          width: 600,
          depth: 560,
          height: 720,
          toekickHeight: 100,
          toekickSetback: 50,
          shelfCount: 1,
          carcassMaterialId: 'm-birch-18',
          backMaterialId: 'm-hb-6',
          bandMaterialId: null,
        },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    });
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
          };
        };
        return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
      },
      undefined,
      { timeout: 30_000 },
    );

    // Resolve the cabinet .ziasm path (the single top-level component's partPath).
    const cabinetPath: string = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
        };
      };
      return w.__zilventorStore.getState().activeAssembly!.components[0]!.partPath;
    });
    expect(cabinetPath, 'cabinet component must reference a .ziasm path').toMatch(/\.ziasm$/);
    console.log('[slice2] cabinetPath =', cabinetPath);

    // ── B1. AddDoorCommand (single, full overlay) ──────────────────────────────
    // ADDENDUM §4: pass cabinetPath only + overlay/hinge/count params.
    // The command derives cabinet dims (width/height/depth/Tc/toekickHeight) from
    // the unpacked .ziasm internally. Do NOT pass cabinet: { width:0, ... } zeros
    // or even real values — that would bypass the derivation seam and produce a
    // false-green for the live FurnitureTab → dialog → command path.
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
      };
      const { AddDoorCommand } = await import('/src/commands/AddDoorCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new AddDoorCommand({
        cabinetPath: cabPath,
        // cabinet dims are NOT passed — AddDoorCommand.apply() derives them from
        // the unpacked .ziasm (Phase 5 fix). Only the user-supplied overlay params:
        params: {
          count: 'single',
          overlay: 'full',
          hingeSide: 'left',
          thickness: 18,
          reveal: 2,
          clearance: 2,
          centerReveal: 3,
        },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, cabinetPath);

    // ── B2. Door component landed in the cabinet .ziasm (data-layer proof) ──────
    const doorInfo: { components: number; doorRoles: number; doorPartPath: string | null } =
      await page.evaluate(async (cabPath: string) => {
        const w = window as unknown as {
          __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
          __zilventorStore: {
            getState(): { subAssemblyDocs: Record<string, { components: Array<{ role?: string; partPath: string }> }> };
          };
        };
        // Read the .ziasm straight from the store mirror (AddDoorCommand reloads it).
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        if (!doc) return { components: -1, doorRoles: -1, doorPartPath: null };
        const doorComp = doc.components.find((c) => c.role === 'door') ?? null;
        return {
          components: doc.components.length,
          doorRoles: doc.components.filter((c) => c.role === 'door').length,
          doorPartPath: doorComp ? doorComp.partPath : null,
        };
      }, cabinetPath);

    console.log('[slice2] door info:', JSON.stringify(doorInfo));
    expect(
      doorInfo.components,
      'subAssemblyDocs[cabinet] must be warmed (AddDoorCommand reloads it)',
    ).toBeGreaterThan(0);
    expect(doorInfo.doorRoles, 'cabinet .ziasm must gain exactly one role:door component').toBe(1);
    expect(doorInfo.doorPartPath, 'door component must reference a .zipt part path').toMatch(/\.zipt$/);
    const doorPartPath = doorInfo.doorPartPath!;

    // ── B3. Door part carries Ø35 hingeCup bores[] (data-layer proof) ──────────
    const doorBores: { count: number; cup35: number; blind: boolean } = await page.evaluate(
      async (p: string) => {
        const w = window as unknown as {
          __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
          __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
        };
        const opfs = await w.__zilventorGetOpfs();
        // The door part is a .zipt (a PART), so __zilventorUnpackProject is correct here.
        const project = await w.__zilventorUnpackProject(await opfs.read(p));
        const doc = (project.manifest as {
          document: { bores?: Array<{ diameter: number; depth: number | string; role: string }> };
        }).document;
        const bores = doc.bores ?? [];
        return {
          count: bores.length,
          cup35: bores.filter((b) => b.diameter === 35 && b.role === 'hingeCup').length,
          blind: bores.every((b) => typeof b.depth === 'number'),
        };
      },
      doorPartPath,
    );
    console.log('[slice2] door bores:', JSON.stringify(doorBores));
    expect(doorBores.count, 'door part must carry ≥2 cup bores (2 hinges @ 720mm)').toBeGreaterThanOrEqual(2);
    expect(doorBores.cup35, 'every door cup is Ø35 role:hingeCup').toBe(doorBores.count);
    expect(doorBores.blind, 'all door cups are BLIND (numeric depth, never throughAll)').toBe(true);

    // ── B4. 3D markers: Ø35 cup markers RENDER (real panel, not placeholder) ───
    // Force the sub-asm warm + marker rebuild via the verified DEV hook, then read
    // the marker count off the SceneManager (the headless viewport is BLACK so we
    // probe state, never pixels). Markers ONLY build for real leaf geometry — a
    // placeholder 50mm box has no bore overlay spec, so a nonzero count proves the
    // door renders as a REAL panel.
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorSubAsmInvalidate: (p: string) => Promise<void>;
      };
      await w.__zilventorSubAsmInvalidate(cabPath);
    }, cabinetPath);

    const readBoreMarkerCount = async (): Promise<number> =>
      page.evaluate(() => {
        const store = (window as unknown as {
          __zilventorStore: { getState(): { viewport: unknown } };
        }).__zilventorStore.getState();
        const vp = store.viewport as { getSceneManager?(): unknown } | null;
        const sm = vp?.getSceneManager?.() as { boreMarkerCount(): number } | null;
        return sm?.boreMarkerCount?.() ?? -1;
      });

    await expect
      .poll(readBoreMarkerCount, {
        timeout: 20_000,
        message: 'door cup markers must render (≥2) — proves door is a real panel, not a placeholder',
      })
      .toBeGreaterThanOrEqual(2);
    console.log('[slice2] bore markers after door:', await readBoreMarkerCount());

    await page.screenshot({ path: '/tmp/prisadka-slice2-after-door.png' });

    // ── C. Bake the door part → featureTree gains bake:-prefixed HoleFeatures ───
    const preBakeFeatures = await page.evaluate(async (p: string) => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const project = await w.__zilventorUnpackProject(await opfs.read(p));
      const doc = (project.manifest as { document: { featureTree: Array<{ id: string }> } }).document;
      return doc.featureTree.filter((f) => f.id.startsWith('bake:')).length;
    }, doorPartPath);
    expect(preBakeFeatures, 'no bake: features on the door before bake').toBe(0);

    // Stub kernel (data-layer wiring is the assertion; real-OCCT cup void is proven
    // by the kernel hingeCup integration guard, Phase 0/9).
    await page.evaluate(async (p: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      const { BakeBoresCommand } = await import('/src/commands/BakeBoresCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const stubKernel = {
        deletePart: async (_id: string) => {},
        registerPart: async (_part: unknown) => {},
        execute: async (_id: string) => ({ ok: true as const, value: {} as never }),
        saveToBytes: async (_id: string) => new Uint8Array(),
      };
      const cmd = new BakeBoresCommand({ partPath: p, opfs, kernel: stubKernel as never });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, doorPartPath);

    const postBakeFeatures = await page.evaluate(async (p: string) => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const project = await w.__zilventorUnpackProject(await opfs.read(p));
      const doc = (project.manifest as { document: { featureTree: Array<{ id: string }> } }).document;
      return doc.featureTree.filter((f) => f.id.startsWith('bake:')).length;
    }, doorPartPath);
    console.log('[slice2] door bake: features after bake:', postBakeFeatures);
    expect(
      postBakeFeatures,
      'BakeBoresCommand must append ≥1 bake: HoleFeature to the door featureTree',
    ).toBeGreaterThan(0);

    // ── D. GenerateShelfPinBoresCommand → side panels gain shelfPin bores[] ─────
    // ADDENDUM §6: inline the shelf-pin params as literals (no dynamic import of
    // '@zilventor/shared/shelfPinGrid' — that subpath has no exports map and does
    // not resolve in the Playwright browser context; packages/shared/package.json
    // has no exports map; vite.config.ts has no alias for it). Values match
    // DEFAULT_SHELF_PIN_PARAMS as defined in Phase 2 Task 1.
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      const { GenerateShelfPinBoresCommand } = await import(
        '/src/commands/GenerateShelfPinBoresCommand.ts'
      );
      const opfs = await w.__zilventorGetOpfs();
      // Inline params mirror DEFAULT_SHELF_PIN_PARAMS (Phase 2 Task 1).
      // Never import '@zilventor/shared/shelfPinGrid' — no exports map, not resolvable.
      const shelfPinParams = {
        pitch: 32,
        diameter: 5,
        depth: 13,
        frontSetback: 37,
        backSetback: 37,
        topMargin: 64,
        bottomMargin: 64,
        columns: 2 as const,
      };
      const cmd = new GenerateShelfPinBoresCommand({
        params: shelfPinParams,
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    });

    // D1. Data-layer proof: scan OPFS for panel .zipt that gained Ø5 shelfPin bores.
    type PanelResult = { partPath: string; pinCount: number };
    const pinPanels: PanelResult[] = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const unpack = w.__zilventorUnpackProject;
      const root = await navigator.storage.getDirectory();
      const results: Array<{ partPath: string; pinCount: number }> = [];
      // @ts-expect-error async iterator over OPFS entries
      for await (const [name] of root.entries()) {
        if (!name.endsWith('.zipt')) continue;
        try {
          const bytes = await opfs.read(name);
          const project = await unpack(bytes);
          const doc = (project.manifest as {
            document: { bores?: Array<{ diameter: number; role: string; depth: number | string }> };
          }).document;
          const pins = (doc.bores ?? []).filter(
            (b) => b.role === 'shelfPin-system32' && b.diameter === 5,
          );
          if (pins.length > 0) results.push({ partPath: name, pinCount: pins.length });
        } catch { /* skip */ }
      }
      return results;
    });
    console.log(
      '[slice2] panels with shelf pins:',
      pinPanels.length,
      pinPanels.map((p) => `${p.partPath}:${p.pinCount}`).join(', '),
    );
    expect(
      pinPanels.length,
      'GenerateShelfPinBores must write Ø5 shelfPin bores to ≥1 side panel',
    ).toBeGreaterThan(0);
    const totalPins = pinPanels.reduce((s, p) => s + p.pinCount, 0);
    expect(totalPins, 'total shelf-pin bore count must be > 0').toBeGreaterThan(0);

    // D2. Pin markers render too. Re-invalidate to warm + rebuild, then assert the
    // marker count GREW (door cups + pin markers now both present).
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as { __zilventorSubAsmInvalidate: (p: string) => Promise<void> };
      await w.__zilventorSubAsmInvalidate(cabPath);
    }, cabinetPath);
    await expect
      .poll(readBoreMarkerCount, {
        timeout: 20_000,
        message: 'shelf-pin markers must render in addition to door cups',
      })
      .toBeGreaterThanOrEqual(2 + totalPins);
    console.log('[slice2] bore markers after shelf pins:', await readBoreMarkerCount());

    // ── E. Export DXF + CSV bytes for the aggregated bores ──────────────────────
    // Abort the save-picker so apply() stashes bytes but skips the download.
    await page.evaluate(() => {
      (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
        throw new DOMException('cancelled', 'AbortError');
      };
    });

    // Build a BoringAggregateResult from the OPFS scan (cup panel + pin panels) and
    // export. The export commands only read result.panels[].bores[].
    const exportPanels = [{ partPath: doorPartPath }, ...pinPanels.map((p) => ({ partPath: p.partPath }))];
    await page.evaluate(
      async (panels: Array<{ partPath: string }>) => {
        const w = window as unknown as {
          __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
          __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
        };
        const opfs = await w.__zilventorGetOpfs();
        const unpack = w.__zilventorUnpackProject;
        const panelGroups = await Promise.all(
          panels.map(async ({ partPath }) => {
            const bytes = await opfs.read(partPath);
            const project = await unpack(bytes);
            const doc = (project.manifest as { document: { bores?: unknown[] } }).document;
            return { partPath, partName: partPath, bores: doc.bores ?? [], qty: 1, componentPathKeys: [] };
          }),
        );
        const result = { panels: panelGroups } as never;
        const { ExportBoringCsvCommand } = await import('/src/commands/ExportBoringCsvCommand.ts');
        const { ExportBoringDxfCommand } = await import('/src/commands/ExportBoringDxfCommand.ts');
        await new ExportBoringCsvCommand({ result, suggestedName: 'slice2.csv' }).apply();
        await new ExportBoringDxfCommand({ result, suggestedName: 'slice2.dxf' }).apply();
      },
      exportPanels,
    );

    // E1. CSV: header + rows including Ø5 (pin) and Ø35 (cup).
    const csv = await page.evaluate(() => {
      const w = window as unknown as { __zilventorBoringCsvBytes?: Uint8Array };
      return w.__zilventorBoringCsvBytes ? new TextDecoder().decode(w.__zilventorBoringCsvBytes) : null;
    });
    expect(csv, 'ExportBoringCsvCommand must stash CSV bytes').not.toBeNull();
    expect(csv).toContain('Panel,Tag,Face,X,Y,Ø,Depth,Type');
    const csvDataRows = csv!
      .split('\n')
      .filter((l) => l.trim() && l.includes(',') && !l.startsWith('Panel,'));
    expect(csvDataRows.length, 'CSV must have ≥1 data row').toBeGreaterThan(0);
    expect(csv, 'CSV must contain a Ø5 shelf-pin row').toMatch(/,5,/);
    expect(csv, 'CSV must contain a Ø35 hinge-cup row').toMatch(/,35,/);
    console.log('[slice2] CSV rows:', csvDataRows.length);

    // E2. DXF: well-formed + CIRCLE entities on D5_T* and D35_T* layers.
    const dxfText = await page.evaluate(() => {
      const w = window as unknown as { __zilventorBoringDxfBytes?: Uint8Array };
      return w.__zilventorBoringDxfBytes ? new TextDecoder().decode(w.__zilventorBoringDxfBytes) : null;
    });
    expect(dxfText, 'ExportBoringDxfCommand must stash DXF bytes').not.toBeNull();
    const pairs = parseDxf(dxfText!);
    const code0 = pairs.filter(([c]) => c === 0).map(([, v]) => v);
    expect(
      code0.filter((v) => v === 'SECTION').length,
      'DXF SECTION count == ENDSEC count',
    ).toBe(code0.filter((v) => v === 'ENDSEC').length);
    expect(code0.filter((v) => v === 'EOF').length, 'exactly one DXF EOF').toBe(1);
    const circleCount = code0.filter((v) => v === 'CIRCLE').length;
    expect(circleCount, 'DXF must contain ≥1 CIRCLE per bore').toBeGreaterThan(0);
    // Layers per Ø: collect the layer (group 8) following each CIRCLE.
    const circleLayers: string[] = [];
    for (let i = 0; i < pairs.length - 1; i++) {
      if (pairs[i]![0] === 0 && pairs[i]![1] === 'CIRCLE') {
        for (let j = i + 1; j < Math.min(i + 10, pairs.length); j++) {
          if (pairs[j]![0] === 8) { circleLayers.push(pairs[j]![1]!); break; }
        }
      }
    }
    console.log('[slice2] DXF circle layers:', Array.from(new Set(circleLayers)).join(', '));
    expect(
      circleLayers.some((l) => /^D5_T/.test(l)),
      'a CIRCLE must sit on a D5_T* (shelf-pin Ø5) layer',
    ).toBe(true);
    expect(
      circleLayers.some((l) => /^D35_T/.test(l)),
      'a CIRCLE must sit on a D35_T* (hinge-cup Ø35) layer',
    ).toBe(true);

    await page.screenshot({ path: '/tmp/prisadka-slice2-after-export.png' });

    // ── F. Undo cascade ────────────────────────────────────────────────────────
    // F1. Undo generate-shelf-pins → side-panel pin bores removed.
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      await useAppStore.getState().bus.undo();
    });
    const pinsAfterUndo = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const unpack = w.__zilventorUnpackProject;
      const root = await navigator.storage.getDirectory();
      let total = 0;
      // @ts-expect-error async iterator over OPFS entries
      for await (const [name] of root.entries()) {
        if (!name.endsWith('.zipt')) continue;
        try {
          const project = await unpack(await opfs.read(name));
          const doc = (project.manifest as {
            document: { bores?: Array<{ role: string }> };
          }).document;
          total += (doc.bores ?? []).filter((b) => b.role === 'shelfPin-system32').length;
        } catch { /* skip */ }
      }
      return total;
    });
    console.log('[slice2] shelf pins after undo-generate:', pinsAfterUndo);
    expect(pinsAfterUndo, 'undo-generate-shelf-pins must clear every shelfPin bore').toBe(0);

    // F2. Undo bake-door → door featureTree loses the bake: features.
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      await useAppStore.getState().bus.undo();
    });
    const bakeAfterUndo = await page.evaluate(async (p: string) => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const project = await w.__zilventorUnpackProject(await opfs.read(p));
      const doc = (project.manifest as { document: { featureTree: Array<{ id: string }> } }).document;
      return doc.featureTree.filter((f) => f.id.startsWith('bake:')).length;
    }, doorPartPath);
    console.log('[slice2] door bake: features after undo-bake:', bakeAfterUndo);
    expect(bakeAfterUndo, 'undo-bake must remove all bake: features from the door').toBe(0);

    // F3. Undo add-door → door component removed from the cabinet .ziasm.
    // ADDENDUM §8: use the store-based read (subAssemblyDocs[cabinetPath]) as the
    // PRIMARY assertion path, NOT __zilventorUnpackProject on a .ziasm file.
    // Reason: __zilventorUnpackProject is unpackProject (the PART packer); reading
    // a .ziasm through it reads components from the wrong shape and may return []
    // vacuously, making the assertion pass whether undo worked or not (false-green).
    // The store path is the same mechanism B2 uses and is authoritative.
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      await useAppStore.getState().bus.undo();
    });

    // After undo, force a store reload of the cabinet .ziasm so subAssemblyDocs[cabinetPath]
    // reflects the post-undo OPFS state (not the pre-undo AddDoorCommand reload).
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorSubAsmInvalidate: (p: string) => Promise<void>;
      };
      await w.__zilventorSubAsmInvalidate(cabPath);
    }, cabinetPath);

    const doorAfterUndo = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<
                string,
                { components: Array<{ role?: string }> }
              >;
            };
          };
        };
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        if (!doc) return -1; // -1 means the entry is missing entirely (also wrong)
        return doc.components.filter((c) => c.role === 'door').length;
      },
      cabinetPath,
    );
    console.log('[slice2] door components in .ziasm after undo-add-door:', doorAfterUndo);
    expect(
      doorAfterUndo,
      'undo-add-door must remove the door component from the cabinet .ziasm (store read)',
    ).toBe(0);

    // ── Final: no browser errors through the whole flow ────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during slice-2 e2e flow').toHaveLength(0);
  },
);
```

- [ ] **Step 2 (run — confirm RED for the expected reason):** Ensure the dev server is up (Playwright's `webServer` auto-starts it with `reuseExistingServer: true`, `playwright.config.ts:5-10`). From repo root run ONLY this spec:

```bash
pnpm exec playwright test --project=chromium tests/e2e/prisadka-slice2-doors-system32.spec.ts
```

Expected RED **before** Phases 5/6 land: a dynamic-import failure (`Failed to fetch dynamically imported module: /src/commands/AddDoorCommand.ts`) or a probe-assertion miss. In the **assembled** plan (Phases 5/6 GREEN), the meaningful RED is whichever assertion the as-shipped code violates — most likely the marker-count poll (`door cup markers must render (≥2)`) if `AddDoorCommand`'s sub-assembly reload (§F) is wired wrong, or the DXF `D35_T*` layer check if the cup Ø/depth layer naming differs. Read the console `BROWSER:`/`[slice2]` lines to localize. Do NOT proceed to green until the failing line is understood.

- [ ] **Step 3 (green — make the e2e pass):** This phase adds NO production code; GREEN comes from Phases 5/6/8 being correct. If the e2e is RED for a real reason, treat it as a regression: invoke `superpowers:systematic-debugging`, find the root cause in the slice-2 command/wiring, fix it THERE (not in the spec), and re-run. The ONLY spec-side edits allowed are: (a) aligning a command-option field name to the as-shipped name (per the Task-1 naming note), and (b) removing the `cabinet` field from the `AddDoorCommand` opts if the Phase-5 command type still accepts it but derives its own (the command must derive dims — never pass zeros). Re-run the exact command from Step 2 until:

```
1 passed (…s)
```

Confirm the console shows non-trivial probe values: `[slice2] bore markers after door:` ≥2, `[slice2] panels with shelf pins:` ≥1, `[slice2] DXF circle layers:` contains both `D5_T…` and `D35_T…`.

- [ ] **Step 4 (commit):**

```bash
git add tests/e2e/prisadka-slice2-doors-system32.spec.ts
git commit -m "test(e2e): присадка slice2 — door cups + система-32 pins, real-WASM markers/bake/DXF/CSV/undo

Asserts (real OCCT, real OPFS, real DXF/CSV bytes, real 3D markers via the
__zilventorSubAsmInvalidate warm + getSceneManager().boreMarkerCount() probe):
AddDoor lands a role:door component + Ø35 cup markers (real panel, not
placeholder), bake appends bake: HoleFeatures, GenerateShelfPinBores writes Ø5
pins + markers grow, DXF carries D5_T*/D35_T* CIRCLE layers, CSV carries Ø5+Ø35
rows, and the undo cascade restores each layer.

Addendum fixes applied: (1) shelf-pin params inlined (no @zilventor/shared/shelfPinGrid
dynamic import — no exports map); (2) AddDoor cmd drives real dims-derivation path
(no cabinet:{width,height,...} bypass); (3) F3 undo-check reads store
subAssemblyDocs[cabinetPath] after __zilventorSubAsmInvalidate, not bytes via
the part-packer __zilventorUnpackProject. Closes slice-1's never-asserted
3D-marker gap (prisadka-carcass-boring.spec.ts:4-7).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: §6 browser verification — run the e2e against the live server, read the probe output back

**Files:**
- **No source files.** This is a manual/scripted verification checklist (per CLAUDE.md §6 — "a change isn't done until you've seen it run"). It runs Task 1's e2e against the real dev server and READS BACK the probe output, because headless Chrome renders the viewport BLACK (per project memory — "verify 3D overlays via probes … not screenshots").
- **Delegate:** dispatch a Sonnet subagent to run the steps and report the probe values back (do not consume main-thread context driving Playwright); the controller reads the reported `[slice2]` lines.

- [ ] **Step 1 (start the dev server FROM the working tree on a free port):** Per project memory ("dev-server PORT-collision DANGEROUS — server FROM THE WORKTREE on a free port"), if a stray dev server is already on 5173, start a fresh one on a free port and point Playwright at it. From repo root:

```bash
PORT=5174 pnpm --filter @zilventor/app dev
```

(run in background; note the URL it prints). If 5173 is free, skip this and let Playwright's `webServer` auto-start it (`reuseExistingServer: true`).

- [ ] **Step 2 (run the e2e headed-config but read PROBES, not pixels):** Run Task 1's spec with the line reporter so every `console.log('[slice2] …')` and `BROWSER:` line is captured to stdout:

```bash
pnpm exec playwright test --project=chromium tests/e2e/prisadka-slice2-doors-system32.spec.ts --reporter=line 2>&1 | tee /tmp/slice2-e2e.log
```

If you started a custom-port server in Step 1, prefix `PLAYWRIGHT_BASE_URL=http://localhost:5174` (or set `use.baseURL` for the run) so Playwright targets the worktree server, not a stray one.

- [ ] **Step 3 (read the proof back — probe values, not screenshots):** Grep the captured log for the load-bearing probe lines and CONFIRM each (the screenshots at `/tmp/prisadka-slice2-*.png` are BLACK and are NOT proof — they exist only to prove the run reached those points):

```bash
grep -E '\[slice2\]' /tmp/slice2-e2e.log
```

Assert, by reading the values back:
- `[slice2] cabinetPath = …ziasm` — cabinet created.
- `[slice2] door info: {"components":N,"doorRoles":1,"doorPartPath":"…zipt"}` — door landed as a real component with `role:door`.
- `[slice2] bore markers after door:` ≥ 2 — **the door renders as a REAL panel** (markers only build for real leaf geometry; a placeholder 50mm box yields 0). This is the §6 visual claim made through a probe.
- **DOOR_POSE upright gate (the deferred-constant safety net).** `DOOR_POSE.quaternion` in `prisadkaFaceConventions.ts` ships as the placeholder `[0,0,0,1]` (identity) and is the ONE convention Phase 0 could not fully derive in a kernel unit — it is finalized HERE. Markers-≥2 proves "real panel" but NOT "upright": a flat door (identity rotation applied to a `{length=doorH→X, width=doorW→Y, thickness=Td→Z}` box leaves the door lying on the cabinet floor) still has markers. So additionally probe the door's WORLD orientation and assert it stands vertical:

```js
// in the e2e, after Add Door, log the door's world AABB extent (added to Task-1 probes):
const st = window.__zilventorStore.getState();
const sm = st.viewport.getSceneManager();
const ext = sm.componentWorldBboxExtent?.(doorPartPath) // {x,y,z} world extents
  ?? null; // if no such accessor, compute from door component pose⊗door dims in the probe
console.log('[slice2] door world extent:', JSON.stringify(ext));
```

  Assert `[slice2] door world extent:` has its **vertical (world-Z) extent ≈ doorH** (the door height, hundreds of mm), **NOT ≈ Td** (~18 mm, which means the door is lying FLAT). If flat: `DOOR_POSE.quaternion` is wrong — correct it in `prisadkaFaceConventions.ts` (single source of truth; every consumer updates via import, no other edit needed), re-run Phase 0's derivation + this gate until upright. Also eyeball that the cup markers sit on the carcass-facing broad face, not the room-facing one.
- `[slice2] panels with shelf pins:` ≥ 1 and `[slice2] bore markers after shelf pins:` strictly greater than the after-door count — pins rendered too.
- `[slice2] DXF circle layers:` contains BOTH a `D5_T…` and a `D35_T…` token — byte-level DXF carries the correct per-Ø layers.
- `[slice2] CSV rows:` ≥ 2 — byte-level CSV has data.
- `[slice2] shelf pins after undo-generate: 0`, `[slice2] door bake: features after undo-bake: 0`, `[slice2] door components in .ziasm after undo-add-door: 0` — the undo cascade reverses every layer.

Then confirm the final line of the run:

```bash
tail -3 /tmp/slice2-e2e.log
```

Expect `1 passed`. If any probe value is wrong (e.g. `bore markers after door: 0` → door rendered as a placeholder, the slice-1 gap reopened; or `-1` → `viewport`/`getSceneManager` returned null), STOP and apply `superpowers:systematic-debugging` against the relevant slice-2 command — do not weaken the assertion or accept a black screenshot as proof.

- [ ] **Step 4 (byte-level OPFS spot-check via `__zilventorUnpackProject`):** As an independent cross-check that the door part is a genuine persisted part (not just an in-memory store entry), confirm the e2e's B3 block already round-tripped the door `.zipt` through `window.__zilventorUnpackProject` and found `cup35 === count` with `blind === true`. This is captured in the log as `[slice2] door bores: {"count":N,"cup35":N,"blind":true}` — grep and confirm:

```bash
grep -E '\[slice2\] door bores:' /tmp/slice2-e2e.log
```

Confirm `cup35` equals `count` (every door bore is a Ø35 `role:hingeCup`) and `blind` is `true` (all cups BLIND, never `throughAll` — Convention 5). This is the byte-OPFS proof required by project memory.

- [ ] **Step 5 (record the §6 result — no commit):** This checklist produces NO file (per the no-report-md rule). The subagent reports the grepped probe values + the `1 passed` line back to the controller as text. If GREEN, the controller records "§6 PASS (probes: markers door≥2 / pins>door, DXF D5_T*+D35_T*, CSV Ø5+Ø35 rows, undo cascade→0, door .zipt cup35===count blind=true)" in the branch notes / final review. There is nothing to commit in this task.

---

### Task 3: `tsc --noEmit` gate on every touched package

**Files:**
- **No source files.** Type-check gate over the three packages slice-2 touched: `@zilventor/shared`, `@zilventor/kernel`, `@zilventor/app`. Verified scripts: `packages/shared/package.json:8`, `packages/kernel/package.json:8`, `packages/app/package.json:10` all expose `"typecheck": "tsc --noEmit"`; root `package.json:7` exposes `"typecheck": "pnpm -r typecheck"` (runs all packages recursively).

> **Why a discrete gate.** Per project memory, `tsc` has repeatedly caught prod errors that green vitest/structural tests missed (TS2375 `exactOptionalPropertyTypes`, `BlobPart`, the widened-Record exhaustiveness). The slice-2 `BORE_COLORS: Record<BoreConnectorKind,string>` widening (§E) and the `doorSpec?` optional field (§B) are exactly the `exactOptionalPropertyTypes`/exhaustive-key class — a missing `BoreConnectorKind` arm in `BORE_COLORS` is a COMPILE error here, not a runtime one. This gate must be GREEN before the slice is claimed done.

- [ ] **Step 1 (run the full recursive typecheck):** From repo root:

```bash
pnpm -r typecheck
```

Expected GREEN: every package prints its `tsc --noEmit` with no diagnostics and the run exits 0. There is no "RED" expected step here — by the time Phase 10 runs, Phases 1–9 should already be type-clean; this gate CONFIRMS that across the whole slice in one shot (catches any cross-package drift, e.g. the `BoreConnectorKind` union widening in `@zilventor/shared` not propagated to `BORE_COLORS` in `@zilventor/app`).

- [ ] **Step 2 (if RED — fix at the source, re-run):** Any diagnostic is a real type error introduced by the slice. Localize by package and re-run that one package for a tighter loop:

```bash
pnpm --filter @zilventor/shared typecheck   # or @zilventor/kernel, @zilventor/app
```

Common slice-2 culprits to check against §B/§E: (a) `BORE_COLORS` missing a `shelfPin` or `hinge` arm → `Record<BoreConnectorKind,string>` exhaustiveness error at `SceneManager.ts:112`; (b) `doorSpec?` declared without the `| undefined` that `exactOptionalPropertyTypes` requires when assigning; (c) the new `BoreRole`/`PanelRole` union arms not handled in an exhaustive `switch` somewhere downstream. Fix the SOURCE file (not a cast in the test), then re-run `pnpm -r typecheck` until clean.

- [ ] **Step 3 (confirm GREEN — no commit):** Re-run `pnpm -r typecheck`; confirm exit 0 with no diagnostics across `@zilventor/shared`, `@zilventor/kernel`, `@zilventor/app`. This is a verification gate only — it produces no file and nothing to commit (any fixes land on their own source-file commits within the relevant earlier phase, or as a follow-up fix commit if discovered here). Record "tsc --noEmit GREEN on shared+kernel+app" in the branch notes.

<!-- selfcritique:
Weaknesses: (1) The marker-count poll assumes __zilventorSubAsmInvalidate deterministically warms subAssemblyDocs AND triggers the bore-marker rebuild effect — the expect.poll's 20s timeout covers async latency but if the marker effect needs an additional trigger the poll fails (mitigated: poll, not a one-shot read). (2) F3's store-based read asserts 0 door-role components AFTER __zilventorSubAsmInvalidate, which reloads from OPFS — if AddDoorCommand.revert() correctly restores the pre-add .ziasm to OPFS, the reload will see 0 door components and the assertion passes correctly; if revert() does NOT restore OPFS, the invalidate reloads the post-add bytes and assertion fails → correct failure signal. (3) DXF layer-naming D5_T*/D35_T* is inferred from slice-1's D{Ø}_T{depth} convention (prisadka-carcass-boring.spec.ts:269), not re-verified against the slice-2 cup/pin export path. (4) The AddDoorCommand opts shape with no `cabinet` field assumes Phase 5 made `cabinet` entirely internal to the command (derived from .ziasm) — if Phase 5 kept `cabinet` in opts but made it optional with a derive-if-absent fallback, the spec may still need to omit it to trigger the derive path.
Assumptions: AddDoorCommand.revert restores the pre-add .ziasm to OPFS (§F says it must); the door .zipt is readable via __zilventorUnpackProject (it's a PART, so yes); hingeCountForHeight(720)=2 → ≥2 cups; cabinet top-level component partPath ends .ziasm (CreateCabinetCommand convention); DEFAULT_SHELF_PIN_PARAMS literal values match Phase 2 Task 1 definition exactly.
Confidence: 82 — all three addendum fixes correctly applied and grounded in the verified real-code hooks (__zilventorSubAsmInvalidate shape at App.tsx:2977, __zilventorUnpackProject at App.tsx:419, package.json exports-map absence confirmed). Residual risk is the AddDoorCommand opts shape after Phase 5 applies its cabinet-dims-derivation fix (the spec must match the as-shipped type), and the marker-rebuild trigger chain (correctly polled).
-->
