# M4 Slice B — Toekick leg-leveler boring (+ 3D legs + BOM)

**Date:** 2026-06-25
**Milestone:** M4 (Furniture authoring correctness) — Slice B
**Status:** Approved, ready for implementation plan

## Goal

Add a command that fits adjustable leg-levelers to a base cabinet: it drills the
baseplate screw bores into the underside of the cabinet bottom panel, places the
legs as 3D components, and surfaces them in the hardware BOM. Legs hide behind the
toekick.

Success = a base cabinet with a toekick gains 2R leg components and 4R screw bores
(R = user-specified legs-per-row), the legs appear in the hardware BOM with the
correct qty, and the command reverts cleanly. All gates green (typecheck 0, unit,
e2e 0-console-errors).

## Decisions (locked via brainstorming)

1. **Leg count** — user specifies **legs-per-row** `R`; total = `2R` (R front + R back).
   Minimum `R = 2` (4 legs). No auto width-threshold logic.
2. **Bore pattern** — **4 screw bores per leg** in a square pattern. Pattern
   dimensions + screw diameter/depth stored on the leg-leveler `CatalogEntry`
   (data-driven, reusable for the future SKU-import slice D).
3. **Scope** — bores **+ 3D leg components + BOM** (full variant).
4. **Front-to-back placement** — front-row legs inset from the cabinet front by
   `toekickSetback + margin` so they sit behind the toekick panel; back row inset
   symmetrically from the back.

## Grounding (current code)

- `BoreOp` (`packages/shared/src/bore.ts`): `{ id, face: FaceName, u, v, diameter,
  depth: number|'throughAll', role: BoreRole, connectorId, connectorKind, ... }`.
  Panel-local coords via `face2DFrame()`. `BoreRole` has **no** `legLeveler` value yet.
- Bores live in `project.manifest.document.bores: BoreOp[]` inside a packed `.zipt`.
- Bottom panel: `buildBaseCabinet` (`packages/shared/src/cabinets/baseCabinet.ts`)
  places the `bottom` panel at `position.z = toekickHeight`; its `Bottom` face
  (underside) is at world Z = `toekickHeight`. Toekick panel exists when
  `toekickHeight > 0`. `BaseCabinetParams` carries `toekickHeight`, `toekickSetback`.
- `deriveCabinetDims()` (`packages/app/src/commands/cabinetDims.ts`) reverse-derives
  `{ width, height, depth, Tc, toekickHeight }` from a built cabinet assembly.
- Catalog entry `leg-leveler-100` exists (`packages/shared/src/hardware/builtinCatalog.ts`,
  `category: 'legLevelers'`, `bboxMm: {l:50,w:50,h:120}`). `HardwareCategory` includes
  `'legLevelers'`. No bore spec on the entry today.
- 3D hardware placement template: `buildSlidePart` (`packages/app/src/commands/buildSlidePart.ts`)
  — look up SKU in `BUILTIN_CATALOG`, build a `PartDocument` carrying a
  `HardwareFeature` with `bboxMm`, pack to `hardware/<skuId>.zipt`. Kernel
  (`packages/kernel/src/adapter/FeatureTree.ts`) renders a `kind:'hardware'` feature
  as a centered OCCT box from `bboxMm`.
- Component append: push a `ComponentInstance` (`packages/shared/src/types.ts`:
  `{ id, partPath, position:{x,y,z}, rotation:{rx,ry,rz}, visible, role?, ... }`) onto
  `assembly.components[]`, then `packAssembly`. See `AddDrawerBankCommand.ts:287-319`.
- BOM: `aggregateHardwareRecursive` + `buildHardwareCache` aggregate hardware rows
  automatically for any component whose `partPath` matches `hardware/*.zipt` (SKU
  parsed from filename). A leg-leveler row appears with `qty = leg count` for free.
- `CURRENT_FORMAT_VERSION = 32` (`packages/shared/src/fileFormat.ts`).
- Command tests: `packages/app/src/commands/__tests__/` (see `AddDrawerBankCommand.spec.ts`
  — `MemOpfs`, `makeKernel`, `boresOf` helpers, `// @vitest-environment node`).
  E2e: `tests/e2e/` (see `m4-variable-height-drawers.spec.ts`, `prisadka-slice4-drawer-banks.spec.ts`).

## Architecture

### Layer 1 — `packages/shared` (pure functions + catalog)

**1a. Catalog spec.** Add an optional field to `CatalogEntry`:

```ts
export interface LegLevelerSpec {
  screwCount: 4;          // fixed at 4 for this slice
  patternW: number;       // square pattern width  (mm), e.g. 36
  patternD: number;       // square pattern depth  (mm), e.g. 36
  screwDiameter: number;  // mm, e.g. 4
  screwDepth: number;     // mm, e.g. 13
}
// on CatalogEntry:  legLeveler?: LegLevelerSpec
```

Populate it on `leg-leveler-100`: `{ screwCount: 4, patternW: 36, patternD: 36,
screwDiameter: 4, screwDepth: 13 }`. Add `'legLeveler'` to the `BoreRole` union
(and, if `BoreConnectorKind` is non-optional on `BoreOp`, a `'legLeveler'` member
there too).

**1b. `computeLegPositions`** (new `packages/shared/src/cabinets/legLayout.ts`):

```ts
computeLegPositions(p: {
  width: number; depth: number;
  legsPerRow: number;   // R >= 2
  sideInset: number;    // inset from left/right edges to outermost leg center
  frontInset: number;   // inset from front edge to front-row leg centers
  backInset: number;    // inset from back edge to back-row leg centers
}): Array<{ u: number; v: number }>   // 2R positions, bottom-panel-local
```

- Across width (u): R legs evenly spaced. `R == 1` → centered at `width/2`
  (defensive; command enforces R≥2). `R >= 2` → `u_i = sideInset + i*(width −
  2*sideInset)/(R−1)`, `i = 0..R−1`.
- Front row at `v = frontInset`; back row at `v = depth − backInset`.
- Returns front row then back row.

**1c. `legLevelerBores`** (same file or `bore.ts` helper):

```ts
legLevelerBores(
  legPos: { u: number; v: number },
  spec: LegLevelerSpec,
  face: FaceName,
  idBase: string,
): BoreOp[]   // 4 bores at (u ± patternW/2, v ± patternD/2)
```

Each bore: `diameter = spec.screwDiameter`, `depth = spec.screwDepth`,
`role = 'legLeveler'`, `face = bottom-panel Bottom face`, unique `id`/`connectorId`
derived from `idBase`.

### Layer 2 — `AddLegLevelersCommand` (`packages/app/src/commands/`)

Mirror `AddDrawerBankCommand`. Input: `{ cabinetPath, legsPerRow, skuId?
('leg-leveler-100' default), sideInset?, margin? }`.

Flow:
1. `deriveCabinetDims` → `{ width, depth, toekickHeight, Tc }`.
2. **Validate (throw before any write):**
   - `toekickHeight <= 0` → `legLeveler.error.noToekick`.
   - `legsPerRow < 2` → `legLeveler.error.tooFewLegs`.
   - catalog entry missing `legLeveler` spec → `legLeveler.error.noSpec`.
   - baseplate pattern + inset doesn't fit inside the bottom-panel footprint
     (e.g. `2*sideInset + patternW > width`, or front/back rows overlap) →
     `legLeveler.error.tooSmall`.
3. Compute insets: `frontInset = toekickSetback + margin` (default `margin` e.g. 25mm),
   `backInset = margin`, `sideInset` default e.g. 50mm. `toekickSetback` available
   from cabinet derivation or params (extend `deriveCabinetDims` to return it if
   needed).
4. `computeLegPositions` → 2R positions.
5. For each position: `legLevelerBores` → append to the **bottom** panel part's
   `.bores` (find component with `role: 'bottom'`, read/pack its `.zipt`). Mirror
   `appendCabinetSideBores`.
6. Synthesize/ensure leg part `hardware/leg-leveler-100.zipt` via the `buildSlidePart`
   template (catalog nominal geometry — **no per-cabinet height override**, to avoid
   shared-file collisions). Push 2R `ComponentInstance`s: `role: 'legLeveler'`,
   `partPath`, position = world `(x, y)` from panel-local `(u, v)`, `z` chosen so the
   leg **top aligns to the bottom-panel underside** (`z = toekickHeight − bboxMm.h/2`),
   `rotation` 0.
7. `packAssembly` + write.

**Revert:** remove the appended bores (by id/connectorId prefix) from the bottom
panel and remove the 2R leg components (by id prefix). Mirror Slice A / drawer-bank
revert (compare geometry/component count, not raw gzip bytes).

**No manifest bump** — `bores[]` and `components[]` are already serialized; the new
`BoreRole` value and catalog spec are not migration-affecting (Slice A precedent).

### Layer 3 — UI (`packages/app`)

`LegLevelersDialog.tsx` (mirror `DrawerBankDialog`): fields = legs-per-row (number,
default 2, min 2), SKU dropdown (filtered to `category === 'legLevelers'`, default
`leg-leveler-100`). Show live "total legs = 2R". OK gated on validity (R≥2, fits).
Wire a store action + invocation point alongside the drawer-bank entry (Furniture
tab / cabinet context menu). i18n keys (en + uk) for labels + the 4 error messages.

### Layer 4 — e2e

`tests/e2e/m4-leg-levelers.spec.ts` (mirror `m4-variable-height-drawers.spec.ts`):
seed a base cabinet with a toekick → open dialog → set legs-per-row → submit →
assert leg components present in the scene + 0 console errors.

## Known limitations (deliberate)

- **Leg 3D height** is the catalog nominal (120mm), top-aligned to the panel underside
  on the shared `leg-leveler-100.zipt`. If `toekickHeight ≠ 120`, the foot
  floats/penetrates the floor slightly. Accepted: legs are adjustable; this is a
  placeholder box, and a per-cabinet height override would collide the shared part
  file across cabinets and complicate BOM SKU keying. Revisit if a real leg model lands.
- `screwCount` fixed at 4 (square pattern only). Other patterns deferred.

## Out of scope

Wall/tall cabinets (legs are a base-cabinet concern), non-rectangular leg layouts,
real leg geometry/STEP, the future custom-SKU import (Slice D) that will reuse the
catalog `LegLevelerSpec`.

## TDD slice outline (for the implementation plan)

1. **Catalog + types** — add `LegLevelerSpec`, populate `leg-leveler-100`, add
   `'legLeveler'` `BoreRole`. Red: entry-has-spec test.
2. **`computeLegPositions`** — Red: count `= 2R`, symmetry, inset/even-spacing checks.
3. **`legLevelerBores`** — Red: 4 bores per leg, square pattern coords, face/dia/depth.
4. **Command — bores + validation** — Red: bores appended to bottom panel;
   `noToekick`/`tooFewLegs`/`tooSmall`/`noSpec` errors thrown before writes.
5. **Command — 3D legs + BOM + revert** — Red: 2R leg components pushed (role/partPath/
   pose); hardware BOM qty `= 2R`; revert removes bores + components.
6. **Dialog + store + i18n** — Red: dialog renders, OK gated, submit dispatches command.
7. **e2e** — Red: full flow, 0 console errors.
