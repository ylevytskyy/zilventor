# M4 Slice E — Blind + Diagonal Corner Cabinets

**Status:** Design spec
**Date:** 2026-06-26
**Branch:** feat/m4-corner-cabinets
**Prereq:** M4 Slices A–D merged (`master @3342cab5`, CURRENT_FORMAT_VERSION=33)

---

## 1. Overview and Motivation

M4 Slice E ships two corner cabinet variants as the final M4 milestone:

| Variant | Kernel dependency | Key new machinery |
|---|---|---|
| **Blind corner** | None — all rectangular panels | `doorMath` offset extension; blind filler role |
| **Diagonal corner** | `PanelFeature.outline` prism | Pentagon top/bottom; rotated stiles + door |

Both variants produce a complete, shop-ready output: carcass panels, a slab door, Ø35 hinge-cup bores on the door, Ø5 plate bores on the hinge stile, and hinge hardware entries that feed the hardware BOM. Lazy-susan rotating fittings and pentagon interior shelves are explicitly out of scope for this slice (see §10).

**Consumers that need zero changes:** `resolvePanelSpecFromFeature`, `cutListRow` (uses AABB extents — pentagon bounding rectangle is the correct sheet stock), `packAllMaterials` nesting, every `f.kind === 'panel'` guard (30+), and the BOM walker `aggregateHardwareRecursive`. All new panels remain `kind: 'panel'`.

### Phasing note

The blind corner cabinet has no kernel dependency and can be developed as an independent TDD task before the kernel `outline` work starts. The diagonal corner cabinet depends on the `outline` kernel extension (§2). The recommended slice order within the implementation plan is therefore: (1) doorMath extension, (2) blind corner builder + app, (3) `outline` kernel branch, (4) diagonal corner builder + app. A single implementation plan covering all four in sequence is appropriate.

---

## 2. `PanelFeature.outline` Extension

### 2.1 Type change

In `packages/shared/src/panel-feature.ts`, add an optional field after `suppressed`:

```typescript
export interface PanelFeature {
  // ... all existing fields unchanged ...

  /** Optional 2-D polygon defining the panel footprint in the part's length×width
   *  plane (Z=0 base face). Vertices in CCW order when viewed from +Z (outside the
   *  base face). When absent the panel is a plain axis-aligned box — existing
   *  behaviour, byte-identical. When present the kernel builds a prism instead of
   *  a box; `length` and `width` are still the AABB extents and are used by all
   *  non-kernel consumers (cut-list, nesting, BOM) without change.
   *
   *  Constraints: ≥ 3 vertices; polygon is implicitly closed (last→first edge
   *  implied); all x ∈ [0, length], y ∈ [0, width]; no self-intersections.
   *  Coordinates in mm. */
  readonly outline?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}
```

`exactOptionalPropertyTypes: true` is set project-wide — any builder assigning this field must use a conditional spread (`...(outline ? { outline } : {})`), not `outline: undefined`.

`isPanelFeature` validator (`panel-feature.ts`) must accept the new optional field — validate presence of each vertex as `{x:number, y:number}` when provided, pass-through when absent.

### 2.2 Kernel branch in `buildPanelBox`

`packages/kernel/src/occt/PanelOps.ts:buildPanelBox` (line 56) branches on `outline`:

**Absent (default path):** existing `BRepPrimAPI_MakeBox_4(P1, P2)` — unchanged.

**Present (outline path):**
1. Build a closed wire using `BRepBuilderAPI_MakeWire_1()` with sequential `BRepBuilderAPI_MakeEdge_3(gp_Pnt, gp_Pnt)` edges, one per outline segment including the closing last→first edge. Each vertex is `gp_Pnt_3(v.x, v.y, 0)`. Pattern reference: `packages/kernel/src/occt/SketchOps.ts:81–91`.
2. `BRepBuilderAPI_MakeFace_15(wire, Standard_Boolean=true)` to create the planar base face.
3. `BRepPrimAPI_MakePrism_1(face, gp_Vec_4(0, 0, thickness))` to extrude. Pattern reference: `packages/kernel/src/adapter/features/ExtrudeFeature.ts:65–74`.
4. Return the resulting solid.

### 2.3 Face naming for outline panels

The existing `classifyPanelFaces` (PanelOps.ts:114) classifies by face centroid vs. box center using dominant-axis logic. This works correctly for the **Top** and **Bottom** faces of any vertical prism (their centroids are at ±Z from the bounding-box center). The N side faces of a pentagon do NOT have axis-aligned centroids, so the existing classifier would throw.

Resolution: for Slice E, the side faces of outline panels are **not bored and not edge-banded in the boring pipeline** (bores target only door and stile panels, which are rectangular). Therefore:

- `buildPanelBox` for the outline path classifies only `Top` and `Bottom` faces (by centroid Z) and returns a reduced result where `faceNames.Front/Back/Left/Right` are absent.
- Introduce a discriminated `PanelBoxResult` variant (or a `sidesFaceNames?: ...` optional sub-object) so the TypeScript type reflects this. The caller (`PanelFeature` evaluator) already guards on which face names it requests before passing them to the bore pipeline.
- Side-face naming for outline panels (for future edge-banding or boring) is deferred to a follow-up slice (§11, Risk 1).

### 2.4 Manifest bump

`packages/shared/src/fileFormat.ts:4`: bump `CURRENT_FORMAT_VERSION` **33 → 34**.

Migration entry: additive no-op. Documents at v33 are valid at v34 because `outline` absent equals rectangular panel. Add the migration case in the `while (current.formatVersion < CURRENT_FORMAT_VERSION)` loop with an identity transform. Check any `normalizeKind` allow-lists for `'panel'` to confirm `outline` passes through without being stripped.

### 2.5 Pipeline safety argument

Every existing pipeline consumer of `PanelFeature` reads only:

- `length`, `width`, `thickness` — AABB extents, unchanged. A 600×600 pentagon panel appears as 600×600 sheet stock in cut-list and nesting (conservative; correct for guillotine planning).
- `materialId`, `grain`, `edgeBands`, `kind`, `id`, `suppressed` — unchanged.

The `outline` field is read exclusively by `buildPanelBox`. No other consumer touches it. The 30+ `f.kind === 'panel'` guards, BOM walker, `resolvePanelSpecFromFeature`, and cut-list all continue to work correctly without modification.

---

## 3. Blind Corner Cabinet

### 3.1 Concept

A full-width rectangular base carcass where one side of the front opening is "dead" — pushed into the room corner and hidden behind the adjacent cabinet. The visible portion (`openingWidth`) receives a slab door offset to the live side. A fixed blind filler panel covers the dead front zone.

### 3.2 Parameters

```typescript
// packages/shared/src/cabinets/types.ts — add alongside BaseCabinetParams
export interface BlindCornerCabinetParams {
  readonly name: string;
  readonly width: number;          // full carcass width, e.g. 900 mm
  readonly depth: number;          // full carcass depth, e.g. 560 mm
  readonly height: number;
  readonly toekickHeight: number;  // e.g. 100 mm
  readonly toekickSetback: number; // e.g. 60 mm
  readonly openingWidth: number;   // visible door zone width (< width)
  readonly blindSide: 'left' | 'right'; // which side is pushed into corner
  readonly shelfCount?: number;    // optional rectangular interior shelves, default 0
  readonly carcassMaterialId: MaterialId;
  readonly backMaterialId: MaterialId;
  readonly bandMaterialId: MaterialId | null;
}
```

Add to `CabinetTemplateErrorKind`: `'blindOpeningTooSmall'` (openingWidth < 2×Tc), `'blindOpeningTooLarge'` (openingWidth ≥ width).

### 3.3 Panel list

All panels are standard rectangular `PanelFeature` (no `outline`). Notation: `Tc` = carcass material `defaultThickness`, `Tb` = back material `defaultThickness`, `Td` = `DEFAULT_DOOR_THICKNESS` (18 mm). Positions follow the same min-corner convention as `baseCabinet.ts` and `cornerCabinet.ts`.

| Role | fileNameSuffix | Length | Width | Thickness |
|---|---|---|---|---|
| `leftSide` | Left Side | H | D | Tc |
| `rightSide` | Right Side | H | D | Tc |
| `bottom` | Bottom | W−2Tc | D−Tb | Tc |
| `top` | Top | W−2Tc | D−Tb | Tc |
| `back` | Back | W−2Tc | H−2Tc | Tb |
| `toekick` | Toekick | W−2Tc | toekickHeight | Tc |
| `shelf` × N | Shelf 1..N | W−2Tc | D−Tb | Tc |
| **`blindFiller`** | Blind Filler | H−2Tc | blindFillerW | Tc |
| **`door`** | Door | doorH | doorW | Td |

Where:
- `blindFillerW = width − openingWidth − Tc` — fills the dead zone flush to the blind-side carcass inner face.
- `blindFiller` is a new `PanelRole` value: `'blindFiller'`. Add to the union in `types.ts`; compiler-guided cascade will surface any exhaustive-Record gaps.
- The blind filler mounts vertically on the blind side at the carcass front, inside the carcass.
- Shelf spacing: evenly distributed between toekick top and top panel, same formula as `buildBaseCabinet`.

### 3.4 Door sizing and position

Uses the `doorMath` extension (§5). Single door, `count: 'single'`, overlay `'full'`.

```typescript
doorMath({
  cabinet: { width, height, depth, Tc, toekickHeight },
  count: 'single',
  overlay: 'full',
  hingeSide: openingSide,    // opposite of blindSide
  thickness: Td,
  reveal: DEFAULT_REVEAL,
  clearance: DEFAULT_CLEARANCE,
  centerReveal: DEFAULT_CENTER_REVEAL,
  openingWidth,              // new field — door sized to opening, not full width
  openingXOffset: blindSide === 'left' ? width - openingWidth : 0,  // new field
})
```

The door's world X center lands at `openingXOffset + openingWidth / 2`.

### 3.5 Hinge boring

Hinge count: `hingeCountForHeight(doorH)`.
U positions: `hingePositions(doorH, hingeCount)`.

**Door cup bores** (`fileNameSuffix: 'Door'`):
```
hingeCupBores(doorDims, DOOR_CUP_FACE, openingSide, 'full', uPositions)
```

**Plate bores** on the live-side carcass panel (`fileNameSuffix: 'Left Side'` or `'Right Side'`, whichever is on the `openingSide`):
```
hingePlateBores(
  sideDims,                               // { length:H, width:D, thickness:Tc }
  openingSide === 'left'
    ? LEFT_SIDE_INNER_FACE                // 'Top'
    : RIGHT_SIDE_INNER_FACE,              // 'Bottom'
  uPositions,
  frontSetback = depth - Td - PLATE_DEPTH,
)
```

`DOOR_CUP_FACE`, `LEFT_SIDE_INNER_FACE`, `RIGHT_SIDE_INNER_FACE` from `prisadkaFaceConventions.ts`.

### 3.6 Hardware BOM

Hinge SKU: `'hinge-35mm-cup-full'` (full-overlay). Count = `hingeCount`. The builder returns this in `CabinetBuildOutput.hardware` (§6); the app layer places it in the assembly's `hardware` array for `aggregateHardwareRecursive` to pick up.

---

## 4. Diagonal Corner Cabinet

### 4.1 Concept

A pentagon-footprint base carcass at a room corner, with a slab door on the 45° diagonal face. The top and bottom panels are pentagon-shaped (using the `outline` extension). Side panels, backs, stiles, and the door are all rectangular panels placed and rotated appropriately. Hinge bores run in each panel's axis-aligned local frame — no boring pipeline change is needed.

### 4.2 Parameters

```typescript
// packages/shared/src/cabinets/types.ts — add alongside CornerCabinetParams
export interface DiagonalCornerCabinetParams {
  readonly name: string;
  /** Cabinet face width along wall 1 (world +X direction), e.g. 600 mm */
  readonly wallWidth1: number;
  /** Cabinet face width along wall 2 (world +Y direction), e.g. 600 mm */
  readonly wallWidth2: number;
  /** Return-side depth perpendicular to wall 1 (into room along +Y), e.g. 560 mm */
  readonly returnDepth1: number;
  /** Return-side depth perpendicular to wall 2 (into room along +X), e.g. 560 mm */
  readonly returnDepth2: number;
  readonly height: number;
  readonly toekickHeight: number;
  readonly toekickSetback: number;
  /** Width of each front stile flanking the diagonal door, e.g. 50 mm */
  readonly stileWidth: number;
  readonly carcassMaterialId: MaterialId;
  readonly backMaterialId: MaterialId;
  readonly bandMaterialId: MaterialId | null;
}
```

Validation: same structural checks as `CornerCabinetParams` plus `stileWidth > 0`, `diagonalLength > 2*stileWidth + MIN_DOOR_WIDTH` (where `MIN_DOOR_WIDTH = 100`).

Add to `CabinetTemplateErrorKind`: `'diagonalDoorTooNarrow'`, `'stileWidthInvalid'`.

### 4.3 Pentagon geometry

Coordinate origin at the room corner (wall-1 meets wall-2). Shorthands: `W1=wallWidth1`, `W2=wallWidth2`, `D1=returnDepth1`, `D2=returnDepth2`.

**Pentagon plan vertices (CCW viewed from above):**

```
V0 = (0,  0 )    room corner
V1 = (W1, 0 )    wall-1 far end
V2 = (W1, D1)    front-right return corner  (return-side-1 front edge)
V3 = (D2, W2)    front-left  return corner  (return-side-2 front edge)
V4 = (0,  W2)    wall-2 far end
```

**Diagonal edge:** V2 → V3, length `diagonalLength = sqrt((W1−D2)² + (D1−W2)²)`.

Symmetric case (W1=W2=W, D1=D2=D): `diagonalLength = (W−D)·√2`.

**Diagonal direction unit vector (world XY, from V2 to V3):**
```
dX = (D2 − W1) / diagonalLength
dY = (W2 − D1) / diagonalLength
```

**Diagonal rotation angle around world+Z** (used for stile and door placement):
```
θ = atan2(dY, dX)   [radians → convert to degrees for rz]
```

Symmetric case (W1=W2=W, D1=D2=D, W>D): d = (D−W, W−D), so dX = −1/√2, dY = +1/√2, and `θ = atan2(1/√2, −1/√2) = 135°`. Concrete check: W=600, D=560 → d=(−40, 40) → θ = atan2(40, −40) = 135°. Implementation must compute θ from actual params; do not hardcode.

**Outward normal of diagonal face** (perpendicular to edge, pointing toward room, i.e. away from origin):
```
nX = −dY,   nY = dX    (rotate d by +90°)
```

Verify for symmetric W=600, D=560: d=(-40,40) normalized ≈ (-1/√2, 1/√2), n=(−1/√2, −1/√2) — points toward (−,−) i.e. into the wall corner, wrong. Rotate by −90° instead:
```
nX = dY,   nY = −dX
```
For d normalized (-1/√2, 1/√2): n=(1/√2, 1/√2) — points toward (+,+), away from origin. ✓

The door's thickness direction must align with this outward normal (n points toward the room).

### 4.4 Panel list

Add `'frontStile'` to `PanelRole`. All outline panels use `PanelFeature.outline` with the vertices below. All rectangular panels have no `outline` field.

**Outline panels (pentagon top and bottom):**

The outline field for both bottom and top:
```
outline: [
  { x: 0,  y: 0  },   // V0
  { x: W1, y: 0  },   // V1
  { x: W1, y: D1 },   // V2
  { x: D2, y: W2 },   // V3
  { x: 0,  y: W2 },   // V4
]
```
`PanelFeature.length = W1`, `PanelFeature.width = W2` (AABB extents).

| Role | Suffix | Outline? | L | W | T | World position (min-corner) |
|---|---|---|---|---|---|---|
| `bottom` | Bottom | ✓ pentagon | W1 | W2 | Tc | (0, 0, 0) |
| `top` | Top | ✓ pentagon | W1 | W2 | Tc | (0, 0, H−Tc) |
| `back` | Back 1 | rect | W1 | H | Tb | along wall Y=0 |
| `back` | Back 2 | rect | W2 | H | Tb | along wall X=0 |
| `leftSide` | Return Side 1 | rect | H | D1 | Tc | at X=W1−Tc |
| `rightSide` | Return Side 2 | rect | H | D2 | Tc | at Y=W2−Tc |
| `toekick` | Toekick 1 | rect | W1−2Tc | toekickH | Tc | along wall Y=0 |
| `toekick` | Toekick 2 | rect | W2−2Tc | toekickH | Tc | along wall X=0 |
| `frontStile` | Front Stile 1 | rect | H | stileW | Tc | diagonal, V2 end |
| `frontStile` | Front Stile 2 | rect | H | stileW | Tc | diagonal, V3 end |
| `door` | Door | rect | doorH | doorW | Td | diagonal center |

**Back panels positioning:** Back 1 lies against wall Y=0 (length=W1 along X, height=H along Z, thickness=Tb along Y). Back 2 lies against wall X=0 (length=W2 along Y, height=H along Z, thickness=Tb along X). Back 2 requires `rz=90°` in the assembly layout to orient its length along the Y axis; the implementation follows the same positional convention as `buildCornerCabinet`.

**Stile and door positions (world XY midpoints):**

Stile 1 center (V2 end of diagonal, offset inward by stileWidth/2):
```
stile1Center = V2 + (stileWidth/2) * (dX, dY)
             = (W1 + stileWidth/2 * dX, D1 + stileWidth/2 * dY)
```

Stile 2 center (V3 end of diagonal, offset inward by stileWidth/2):
```
stile2Center = V3 − (stileWidth/2) * (dX, dY)
             = (D2 − stileWidth/2 * dX, W2 − stileWidth/2 * dY)
```

Door center (midpoint of diagonal, between the two stiles):
```
doorCenter = ((W1+D2)/2, (D1+W2)/2)
```

World Z center for all three: `H/2`.

**Stile and door rotation:**

Stiles: `rotation = { rx:0, ry:0, rz: θ_deg }` where `θ_deg = θ * 180/π` (diagonal angle computed in §4.3). The stile stands upright, its face parallel to the diagonal.

Door: the rotation must encode both the standard DOOR_POSE upright orientation (part-X→world+Z, part-Z→room outward normal) and the diagonal angle. The implementation must derive the final Euler angles `{ rx, ry, rz }` via a Phase-0-style geometry derivation test that verifies:
- Part-X (doorH direction) maps to world+Z.
- Part-Z (Td direction) maps to the outward normal `(nX, nY, 0)`.
- The resulting door world height equals doorH and width equals doorW.

Do NOT hardcode the quaternion — compute symbolically or derive from the rotation matrix `R` whose columns are `(world image of part+X, world image of part+Y, world image of part+Z)` and convert to Euler via Shepperd's method (same pattern as DOOR_POSE derivation in `prisadkaFaceConventions.ts:43–56`).

### 4.5 Door sizing

Diagonal door dimensions:
```
doorW = diagonalLength − 2 * stileWidth − 2 * DEFAULT_REVEAL
doorH = height − 2 * DEFAULT_REVEAL
```

The `doorMath` function is not directly used for the diagonal door (centering logic differs); the builder computes door dims and position explicitly from the diagonal geometry.

### 4.6 Hinge boring

Hinge count and U positions: `hingeCountForHeight(doorH)`, `hingePositions(doorH, hingeCount)`.

**Door cup bores:** standard `hingeCupBores(doorDims, DOOR_CUP_FACE, hingeSide, 'full', uPositions)` in the door's LOCAL frame. `DOOR_CUP_FACE = 'Bottom'` from `prisadkaFaceConventions.ts:32`. `hingeSide` is a builder parameter (default `'right'`, i.e. the stile-1 side).

**Stile plate bores:** on the stile's inner face in the STILE's LOCAL frame. In the stile's local frame (upright, face along the diagonal), the face pointing toward the door interior is one of `'Top'`/`'Bottom'`. The exact inner face role depends on how the stile is rendered (similar to LEFT/RIGHT_SIDE_INNER_FACE derivation). The implementation must add a Phase-0 derivation test for the stile's inner face, following the `prisadkaFaceConventions.ts` pattern. Name the constant `DIAGONAL_STILE_INNER_FACE`.

Plate bore V-setback on the stile: distance from the stile's "front" edge (the edge flush with the diagonal face plane) into the stile in its local frame. This setback must position the plate holes so the hinge arm length aligns the cup bore on the door with the plate on the stile. Concrete formula:
```
stile front setback = Td + (CUP_SETBACK['full'] − stileThickness/2)
```
where the stile thickness in the plate-bore V direction equals `Tc`. The implementation must verify hinge alignment geometrically (cup center XZ = plate center XZ in world space after transformation). Flag as open question if additional calibration is needed (§11, Risk 2).

### 4.7 Hardware BOM

Hinge SKU: `'hinge-35mm-cup-full'`. Count = `hingeCount`. Placed in `CabinetBuildOutput.hardware` and written to the assembly's `hardware` array.

---

## 5. `doorMath` Extension

`packages/shared/src/doorMath.ts` — additive changes only; all existing callers unaffected.

### New fields on `DoorMathInput`

```typescript
export interface DoorMathInput {
  // ... all existing fields unchanged ...

  /** Active opening width (mm). When set, the door leaf is sized to this width
   *  instead of cabinet.width. For blind-corner sub-width door placement. */
  readonly openingWidth?: number;

  /** World-X offset of the opening's left edge from cabinet X=0 (mm).
   *  The door translation.x = openingXOffset + effectiveWidth/2.
   *  Default 0 (centered door, same as today). */
  readonly openingXOffset?: number;
}
```

### Change to `sizing()`

```typescript
function sizing(input: DoorMathInput): Sizing {
  const W = input.openingWidth ?? input.cabinet.width;   // <-- branch here
  const { height: H, Tc, toekickHeight: tkH } = input.cabinet;
  // rest unchanged ...
}
```

### Change to `doorMath()` translation

For the single-door case, replace:
```typescript
translation: { x: input.cabinet.width / 2, ... }
```
with:
```typescript
const xOffset = input.openingXOffset ?? 0;
translation: { x: xOffset + doorW / 2, ... }
```

Existing callers pass neither field → `openingWidth` falls back to `cabinet.width`, `openingXOffset` falls back to 0, producing identical output.

---

## 6. `CabinetBuildOutput` Extension

`packages/shared/src/cabinets/types.ts`:

```typescript
export interface DoorBoresDef {
  /** fileNameSuffix of the door panel that receives cup bores */
  readonly doorSuffix: string;
  readonly cupBores: ReadonlyArray<BoreOp>;
}

export interface PanelBoresDef {
  /** fileNameSuffix of the carcass panel that receives plate bores */
  readonly panelSuffix: string;
  readonly plateBores: ReadonlyArray<BoreOp>;
}

export interface HardwareInstanceDef {
  readonly skuId: string;
  readonly count: number;
}

export interface CabinetBuildOutput {
  readonly panels: ReadonlyArray<CabinetPanelDef>;
  readonly layout: ReadonlyArray<CabinetComponentDef>;
  /** Door cup bore lists. Absent for builders that don't auto-generate door bores
   *  (baseCabinet, cornerCabinet — user runs GenerateCarcassBoresCommand manually). */
  readonly doorBores?: ReadonlyArray<DoorBoresDef>;
  /** Carcass panel plate bore lists. */
  readonly plateBores?: ReadonlyArray<PanelBoresDef>;
  /** Hardware SKU instances to place in the assembly BOM. */
  readonly hardware?: ReadonlyArray<HardwareInstanceDef>;
}
```

`BoreOp` imported from `'../bore'`. The three new fields are optional so existing builders (`buildBaseCabinet`, `buildCornerCabinet`) require no change.

---

## 7. App Layer

### 7.1 `CreateCabinetCommand` — new templates

`packages/app/src/commands/CreateCabinetCommand.ts`:

```typescript
export type CreateCabinetOpts =
  | { template: 'baseCabinet';          params: BaseCabinetParams;          opfs: OpfsArg }
  | { template: 'cornerCabinet';        params: CornerCabinetParams;        opfs: OpfsArg }
  | { template: 'blindCornerCabinet';   params: BlindCornerCabinetParams;   opfs: OpfsArg }  // new
  | { template: 'diagonalCornerCabinet';params: DiagonalCornerCabinetParams;opfs: OpfsArg }; // new
```

The two new templates follow the identical apply/revert pattern:

**`apply()`:**
1. Resolve collision-free name.
2. Call `buildBlindCornerCabinet` / `buildDiagonalCornerCabinet` with `asm.materials`.
3. For each panel in `built.panels`:
   - Pack a `.zipt` part file via `packPanelPart`.
   - If the panel's `fileNameSuffix` appears in `built.doorBores`, inject the cup `BoreOp`s as `HoleFeature` entries into the part before packing.
   - If the panel's `fileNameSuffix` appears in `built.plateBores`, inject the plate `BoreOp`s similarly.
4. Write the cabinet `.ziasm` via `buildCabinetAssembly`.
5. Append `built.hardware` SKU instances into `cabinetDoc.hardware` (array of `{skuId, count}` entries compatible with `aggregateHardwareRecursive`).
6. Place the cabinet assembly via `PlaceComponentCommand`.

**`revert()`:** unchanged from existing pattern — reverse `PlaceComponentCommand`, delete written files.

The command is atomic: any failure in step 3–5 triggers `deleteWrittenFiles` before re-throw, same as today.

### 7.2 Dialogs

Two new dialogs mirroring `CornerCabinetDialog.tsx` structure (fields → validation → onSubmit → dispatch):

**`BlindCornerCabinetDialog.tsx`** — fields:
- name (text)
- width / depth / height (number, mm)
- toekickHeight / toekickSetback (number)
- openingWidth (number, must be < width)
- blindSide (select: left / right)
- shelfCount (number, 0–8, optional)
- carcassMaterialId / backMaterialId / bandMaterialId (material selectors)

**`DiagonalCornerCabinetDialog.tsx`** — fields:
- name (text)
- wallWidth1 / wallWidth2 (number)
- returnDepth1 / returnDepth2 (number)
- height (number)
- toekickHeight / toekickSetback (number)
- stileWidth (number)
- carcassMaterialId / backMaterialId / bandMaterialId (material selectors)

Validation errors surface via `CabinetTemplateError.kind` → localised strings, same pattern as `CornerCabinetDialog.tsx:190–208`.

### 7.3 Commands to open dialogs

Two new commands: `OpenBlindCornerCabinetDialogCommand` / `OpenDiagonalCornerCabinetDialogCommand`. Mirror `OpenCornerCabinetDialogCommand` exactly.

### 7.4 Ribbon buttons

`packages/app/src/ui/ribbon/FurnitureTab.tsx` — add two buttons in the corner-cabinet group (or a new "Corner" sub-group), following the pattern at lines 407–430. Each button dispatches the corresponding `OpenXxxDialogCommand`.

### 7.5 i18n

Add keys to `packages/app/src/i18n/en.ts` and `uk.ts`:

```
furniture.blindCornerCabinet         = 'Blind Corner Cabinet' / 'Глухий кутовий корпус'
furniture.diagonalCornerCabinet      = 'Diagonal Corner Cabinet' / 'Діагональний кутовий корпус'
furniture.blindSide                  = 'Blind side' / 'Сторона під кут'
furniture.openingWidth               = 'Opening width' / 'Ширина прорізу'
furniture.stileWidth                 = 'Stile width' / 'Ширина стояка'
furniture.wallWidth1                 = 'Wall width 1' / 'Ширина стіни 1'
furniture.wallWidth2                 = 'Wall width 2' / 'Ширина стіни 2'
furniture.returnDepth1               = 'Return depth 1' / 'Глибина торця 1'
furniture.returnDepth2               = 'Return depth 2' / 'Глибина торця 2'
errors.blindOpeningTooSmall          = 'Opening width is too small' / ...
errors.blindOpeningTooLarge          = 'Opening width must be less than cabinet width' / ...
errors.diagonalDoorTooNarrow         = 'Stile width leaves insufficient door opening' / ...
errors.stileWidthInvalid             = 'Stile width must be positive' / ...
```

### 7.6 Hardware BOM wiring

`aggregateHardwareRecursive` (`packages/app/src/commands/buildHardwareCache.ts:21–64`) already walks `assembly.hardware`. `CreateCabinetCommand.buildCabinetAssembly` must populate `cabinetDoc.hardware` from `built.hardware` in the format expected by that walker. Confirm the format matches M4 Slice D's custom hardware placement pattern.

---

## 8. `cabinets/index.ts` Exports

`packages/shared/src/cabinets/index.ts` — add:

```typescript
export * from './blindCornerCabinet';
export * from './diagonalCornerCabinet';
```

New files: `blindCornerCabinet.ts` exports `buildBlindCornerCabinet`; `diagonalCornerCabinet.ts` exports `buildDiagonalCornerCabinet`.

---

## 9. Testing Strategy

### 9.1 TDD slice order

Each slice: **red** (failing test asserting the expected output) → **green** (minimum implementation) → **refactor** (stay green) → run full suite.

1. `doorMath` extension (unit) — `packages/shared/src/doorMath.spec.ts`
2. Blind corner builder (unit) — `packages/shared/src/cabinets/blindCornerCabinet.spec.ts`
3. Blind corner app command (integration) — `packages/app/...`
4. Kernel outline prism (unit, kernel pack) — `packages/kernel/src/occt/PanelOps.outline.spec.ts`
5. Diagonal corner builder (unit) — `packages/shared/src/cabinets/diagonalCornerCabinet.spec.ts`
6. Diagonal corner app command (integration) — `packages/app/...`
7. E2E (Playwright) — `tests/e2e/`

### 9.2 doorMath extension tests

```typescript
// doorMath with openingWidth and openingXOffset
const result = doorMath({
  cabinet: { width: 900, height: 720, depth: 560, Tc: 18, toekickHeight: 100 },
  count: 'single', overlay: 'full', hingeSide: 'left',
  thickness: 18, reveal: 2, clearance: 2, centerReveal: 3,
  openingWidth: 450, openingXOffset: 0,
});
expect(result[0].dims.width).toBeCloseTo(450 - 2 * 2);   // 446
expect(result[0].pose.translation.x).toBeCloseTo(0 + 446/2);  // 223
// Legacy call (no new fields) → unchanged output
```

### 9.3 Blind corner builder tests

Assert POSITIONS not just counts:

```typescript
const out = buildBlindCornerCabinet(params, materials);
// Panel counts
expect(out.panels).toHaveLength(7 + shelfCount + 2); // carcass+filler+door
// Blind filler exists with correct role and width
const filler = out.panels.find(p => p.role === 'blindFiller')!;
expect(resolveLen(filler.panel)).toBe(height - 2 * Tc);
expect(resolveWid(filler.panel)).toBe(width - openingWidth - Tc);
// Door is narrower than cabinet
const door = out.panels.find(p => p.role === 'door')!;
expect(resolveWid(door.panel)).toBeLessThan(width - 4);  // narrower than full
// Door position X is offset to the opening side (not cabinet center)
const doorComp = out.layout.find(c => c.fileNameSuffix === 'Door')!;
expect(doorComp.position.x).toBeCloseTo(expectedDoorCenterX, 1);
// Cup bores exist on the door
expect(out.doorBores).toBeDefined();
expect(out.doorBores![0].cupBores).toHaveLength(hingeCountForHeight(doorH));
// Plate bores exist on the live-side carcass panel
expect(out.plateBores).toBeDefined();
expect(out.plateBores![0].plateBores).toHaveLength(hingeCountForHeight(doorH) * 2);
// Cup bore U positions match plate bore U positions (alignment)
const cupUs = out.doorBores![0].cupBores.map(b => b.u).sort();
const plateUs = [...new Set(out.plateBores![0].plateBores.map(b => b.u))].sort();
expect(cupUs).toEqual(plateUs);
// Hardware
expect(out.hardware).toEqual([{ skuId: 'hinge-35mm-cup-full', count: hingeCountForHeight(doorH) }]);
```

### 9.4 Kernel outline prism tests

```typescript
// outline panel produces correct AABB
const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18,
  outline: [{x:0,y:0},{x:600,y:0},{x:600,y:300},{x:300,y:600},{x:0,y:600}] });
expect(result.bbox).toEqual([-300, -300, 0, 300, 300, 18]);  // AABB is full bounding rect
// Top and Bottom face names exist
expect(result.faceNames.Top).toBeDefined();
expect(result.faceNames.Bottom).toBeDefined();
// Non-outline panel unchanged (byte-identical AABB)
const rect = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 });
expect(rect.bbox).toEqual([-300, -300, 0, 300, 300, 18]);
```

### 9.5 Diagonal corner builder tests

```typescript
// Pentagon panel has outline field set
const bottomDef = out.panels.find(p => p.role === 'bottom')!;
expect(bottomDef.panel.outline).toHaveLength(5);
expect(bottomDef.panel.outline![2]).toEqual({ x: W1, y: D1 });
expect(bottomDef.panel.outline![3]).toEqual({ x: D2, y: W2 });
// AABB extents match params
expect(resolveLen(bottomDef.panel)).toBe(W1);
expect(resolveWid(bottomDef.panel)).toBe(W2);
// Two front stiles
const stiles = out.panels.filter(p => p.role === 'frontStile');
expect(stiles).toHaveLength(2);
// Door width = diagonalLength - 2*stileWidth - 2*reveal
const diag = Math.sqrt((W1-D2)**2 + (D1-W2)**2);
expect(resolveWid(door.panel)).toBeCloseTo(diag - 2*stileW - 2*2, 1);
// Door and stile layout entries have non-zero rz rotation
const doorComp = out.layout.find(c => c.fileNameSuffix === 'Door')!;
expect(doorComp.rotation.rz).not.toBe(0);
// Cup U positions match plate U positions (hinge alignment)
// Hardware SKU
expect(out.hardware).toEqual([{ skuId: 'hinge-35mm-cup-full', count: hingeCount }]);
```

### 9.6 Cut-list survival (outline panel AABB)

```typescript
// Pentagon panel appears in cut list as its bounding rectangle
const row = cutListRow(bottomDef.panel, bottomDef.role, parameters);
expect(row).not.toBeNull();
expect(row!.length).toBe(W1);
expect(row!.width).toBe(W2);
```

### 9.7 Undo/revert parity

For both commands: apply → assert files written + component placed; revert → assert files deleted + component removed. Mirror the M4 Slice D e2e pattern (assert via `window.__zilventorStore`, not OPFS bytes).

### 9.8 E2E (`tests/e2e/`)

Two tests (one per variant):
1. Open dialog → fill valid params → submit → assert cabinet component appears in assembly tree → assert hardware BOM contains hinge SKU → assert 0 console errors.
2. Apply → Ctrl+Z → assert component removed, 0 console errors.

Run via `pnpm exec playwright test tests/e2e/blindCornerCabinet.spec.ts` (and diagonal). Full typecheck gate: `pnpm typecheck` must report 0 errors. Scoped lint: `cd packages/shared && pnpm exec eslint src/` (no full-repo to avoid OOM); same for `packages/app` and `packages/kernel`.

---

## 10. Scope / Non-Goals

The following are explicitly out of scope for Slice E. Each is a potential follow-up.

1. **Lazy-susan rotating fitting:** hardware-only; no carcass change; defer.
2. **Door style:** slab only. Shaker/raisedPanel reuse existing framed door builder without architectural change when added.
3. **Toekick:** included on both variants (standard rectangular toekick panels).
4. **Carcass joinery bores (cam/dowel, shelf-pin rows):** not auto-generated. User runs `GenerateCarcassBoresCommand` separately, same as base cabinet.
5. **Single door per cabinet:** one door leaf per variant; double door is a follow-up.
6. **Interior shelves:** blind corner includes optional `shelfCount` (rectangular shelves, same as `BaseCabinetParams`). Diagonal corner interior shelves are deferred — pentagon shelves require the `outline` machinery on shelf panels, adding implementation scope for non-visible-in-assembly components; the architecture supports it with no further change.

---

## 11. Risks and Open Questions

**Risk 1 — Outline side-face naming for edge-banding.**
The diagonal cabinet's pentagon top/bottom panels currently have no named side faces (§2.3). If a future slice needs to edge-band the back edges of the pentagon or the diagonal return faces, a side-face naming scheme must be designed (edge-index-based or role-based). No impact on Slice E; deferred.

**Risk 2 — Hinge plate V-setback on the diagonal stile.**
The formula `Td + (CUP_SETBACK['full'] − Tc/2)` is an approximation based on a straight-face hinge. Because the diagonal stile's local V axis is not parallel to the world Y axis, the world-space distance from stile front edge to plate hole center differs from the local V distance by a factor of `|dX|` or `|dY|`. The implementation must verify hinge-arm alignment geometrically (cup center world XZ = plate center world XZ after the respective rotation transforms). A dedicated integration test that computes both positions and asserts they match to within 0.1 mm is required before marking this slice done.

**Risk 3 — Door Euler angle derivation for non-symmetric cabinets.**
For symmetric parameters (W1=W2, D1=D2) the diagonal angle θ=±45° is clean. For asymmetric parameters, θ is an arbitrary angle. The Phase-0 derivation test must cover both symmetric and asymmetric cases. The door Euler angles must be computed algebraically from θ (not hardcoded for 45°).

**Risk 4 — Two `toekick` PanelRole entries for the diagonal variant.**
The diagonal cabinet emits two toekick panels (one per wall leg). The `PanelRole` union already allows duplicate roles (same as two `'back'` panels in `buildCornerCabinet`); no change needed. Cut-list groups by role, so both toekicks appear under the `toekick` cut-list section. Verify this is acceptable shop behavior.

**Risk 5 — `outline` polygon winding order and OCCT face orientation.**
OCCT `BRepPrimAPI_MakePrism` requires the base wire to be oriented so the extrusion produces the correct solid outward normals. If the pentagon outline is given CCW (viewed from +Z) but OCCT expects CW for the base face to extrude upward, the resulting solid will have reversed face normals. The implementation must test with the actual OCCT bindings and may need to reverse vertex order. The outline spec says CCW-from-+Z; implementation must confirm or correct.

---

## Appendix A — File Locations (Verified)

| File | Verified at |
|---|---|
| `packages/shared/src/panel-feature.ts` | Lines 14–25 |
| `packages/shared/src/cabinets/types.ts` | Lines 80–83 (`CabinetBuildOutput`), 31 (`BaseCabinetParams`), 55 (`CornerCabinetParams`), 4 (`PanelRole`) |
| `packages/shared/src/cabinets/cornerCabinet.ts` | Lines 27–111 |
| `packages/shared/src/cabinets/index.ts` | Exports `baseCabinet`, `cornerCabinet`, `legLayout` |
| `packages/shared/src/doorMath.ts` | Lines 10–28 (`DoorMathInput`), 56–115 (`doorMath`), 79 (translation.x) |
| `packages/shared/src/hingeMath.ts` | Lines 25–31 (`hingePositions`), 40–60 (`hingeCupBores`), 68–96 (`hingePlateBores`) |
| `packages/shared/src/prisadkaFaceConventions.ts` | Line 32 (`DOOR_CUP_FACE`), line 55 (`DOOR_POSE`) |
| `packages/kernel/src/occt/PanelOps.ts` | Lines 56–99 (`buildPanelBox`), 114–207 (`classifyPanelFaces`, `roleFromOffset`) |
| `packages/app/src/commands/CreateCabinetCommand.ts` | Lines 27–28 (`CreateCabinetOpts`), 40–72 (`apply`), 74–80 (`revert`) |
| `packages/shared/src/fileFormat.ts` | Line 4 (`CURRENT_FORMAT_VERSION = 33`) |
