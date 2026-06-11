# присадка slice 4 — Drawer banks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Each chunk = one fresh Sonnet implementer. Spec = `docs/superpowers/specs/2026-06-11-prisadka-slice4-drawer-banks-design.md` — **§14 Corrections v2 is AUTHORITATIVE.**

**Goal:** One command places a bank of N equal-height drawers (visible front + nested 5-panel box `.ziasm` + side-mount Ø5 Система-32 slide boring) into a cabinet opening; undoable; bores flow to DXF/CSV + bake to real OCCT.

**Architecture:** Clone-of-pattern from `AddDoorCommand`. New pure math in `packages/shared` (`drawerConventions`, `drawerBankLayout`, `drawerFrontMath`, `drawerBoxMath`, `drawerSlideMath`); new `AddDrawerBankCommand` in `packages/app`; nested box `.ziasm` packed to OPFS and referenced as one component inside the cabinet `.ziasm` (recursion already supported). Schema additive v23→v24. UI follows the door's FurnitureTab callback-object pattern.

**Tech Stack:** TypeScript monorepo (pnpm), Vitest, Three.js viewport, OPFS storage, opencascade.js kernel, Playwright e2e, react-i18next.

---

## Conventions & gotchas (read before any chunk)

- **CWD trap:** app suites run from `packages/app/` (`npx vitest run --config vitest.config.ts <relpath>`); shared from `packages/shared/`; kernel real-OCCT from `packages/kernel/` (`--config vitest.integration.config.ts`). Wrong dir → blank output, NOT a pass. `cd` absolute at the start of each package op.
- **Worktree:** implementers run in a worktree (controller creates it). First line of every implementer prompt = branch check + absolute worktree path substitution.
- **Single source of truth:** ALL drawer constants live in `drawerConventions.ts`. Zero re-declarations and zero bare numeric literals (`32/37/12/12.5/16/3`) outside it (git-grep gated — Task A1).
- **Anti-tautology:** pose/position oracles compute expected values INDEPENDENTLY (raw arithmetic / two separate `quatToMat3`), never by calling the producer. Non-axis-parallel test points; rotated-cabinet (15° about Z) for box poses.
- **Full AssemblyDocument seed** for command tests (`setActiveDocument({kind:'assembly', document: makeAsm([...])})`, `// @vitest-environment node`) — a bare `setState` shim crashes `addComponent`.
- **§14 overrides §1–13** wherever they conflict.

## File structure

**Create (packages/shared/src):**
- `drawerConventions.ts` — constants (clearances, thicknesses, setbacks, grid, gap, overlay overhang).
- `drawerBankLayout.ts` — `drawerBankLayout(openH, N)` → slot rects.
- `drawerFrontMath.ts` — `drawerFrontMath(...)` → front panel dims + pose (overlay gap model §14.1).
- `drawerBoxMath.ts` — `drawerBoxMath(...)` → 5 panel defs + poses (§14.2/14.9).
- `drawerSlideMath.ts` — `drawerSlideMath(...)` → cabinet-side + box-side Ø5 BoreOp rows (§14.4).
- `cabinetDims.ts` — extracted+exported `deriveCabinetDims` (§14.5/F).

**Create (packages/app/src):**
- `commands/AddDrawerBankCommand.ts`.
- `commands/buildDrawerBox.ts` — build + pack box `.ziasm`; nested box-side bore write/restore (§14.5 seam).
- `shell/DrawerBankDialog.tsx`.

**Modify (packages/shared/src):** `cabinets/types.ts` (PanelRole), `types.ts` (ComponentInstance.role + drawerSpec), `bore.ts` (BoreRole, BoreConnectorKind), `connectorBomCatalog.ts` (CONNECTOR_BOM_CATALOG), `connectorCatalog.ts` (bake entry), `fileFormat.ts` (v24).

**Modify (packages/app/src):** `scene/SceneManager.ts` (BORE_COLORS), `shell/tabs/FurnitureTab.tsx` (button + wiring), `commands/AddDoorCommand.ts` (import extracted deriveCabinetDims), `store/useAppStore.ts` (addDrawerBankDialog callback-object), locales `en.json`/`uk.json`.

**Tests:** colocated `__tests__/` per source; kernel integration `packages/kernel/...integration.spec.ts`; e2e `tests/e2e/prisadka-slice4-drawer-banks.spec.ts`.

---

## Chunk A — drawerConventions + schema v24 (foundation)

### Task A1: drawerConventions.ts + no-redeclare gate

**Files:** Create `packages/shared/src/drawerConventions.ts`; Test `packages/shared/src/__tests__/drawerConventions.spec.ts`.

- [ ] **Step 1 — failing test** (`packages/shared/`):
```ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as C from '../drawerConventions';

describe('drawerConventions', () => {
  it('exposes the locked constants', () => {
    expect(C.SLIDE_CLEARANCE_PER_SIDE).toBe(12.5);
    expect(C.BOX_PANEL_THICKNESS).toBe(16);
    expect(C.BOX_BOTTOM_THICKNESS).toBe(12);
    expect(C.BOX_VERT_CLEARANCE).toBe(12);
    expect(C.BOX_BACK_CLEARANCE).toBe(10);
    expect(C.DRAWER_FRONT_GAP).toBe(3);
    expect(C.DRAWER_FRONT_THICKNESS).toBe(18);
    expect(C.SLIDE_GRID_PITCH).toBe(32);
    expect(C.DRAWER_SLIDE_FRONT_SETBACK).toBe(37);
    expect(C.DRAWER_SLIDE_HOLE_DIAMETER).toBe(5);
    expect(C.DRAWER_SLIDE_HOLE_DEPTH).toBe(12);
  });
  it('no bare drawer literals re-declared outside drawerConventions.ts', () => {
    // grep for the named constants being re-assigned elsewhere
    const out = execSync(
      `git grep -nE '(SLIDE_CLEARANCE_PER_SIDE|BOX_VERT_CLEARANCE|DRAWER_FRONT_GAP|DRAWER_SLIDE_FRONT_SETBACK)\\s*=' -- 'packages/' ':!packages/shared/src/drawerConventions.ts' || true`,
      { cwd: process.cwd() + '/../..', encoding: 'utf8' }
    );
    expect(out.trim()).toBe('');
  });
});
```
- [ ] **Step 2 — run, expect FAIL** (`drawerConventions` not found). Run: `cd packages/shared && npx vitest run src/__tests__/drawerConventions.spec.ts`
- [ ] **Step 3 — implement** `drawerConventions.ts`:
```ts
/** Single source of truth for drawer-bank geometry (присадка slice 4). */
export const SLIDE_CLEARANCE_PER_SIDE = 12.5; // mm box side ↔ cabinet side
export const BOX_PANEL_THICKNESS = 16;
export const BOX_BOTTOM_THICKNESS = 12;
export const BOX_VERT_CLEARANCE = 12; // box height inset within its slot (top+bottom each)
export const BOX_BACK_CLEARANCE = 10; // box stops short of cabinet back
export const DRAWER_FRONT_GAP = 3; // gap between adjacent fronts (no collision)
export const DRAWER_FRONT_THICKNESS = 18;
export const SLIDE_GRID_PITCH = 32; // Система-32
export const DRAWER_SLIDE_FRONT_SETBACK = 37; // first hole offset from front edge
export const DRAWER_SLIDE_HOLE_DIAMETER = 5;
export const DRAWER_SLIDE_HOLE_DEPTH = 12; // blind into 16mm wall
export const DRAWER_SLIDE_MIN_HOLES = 2; // ≥2 holes per side
/** full overlay overhang covers a carcass panel of thickness Tc; half = Tc/2; inset = 0. */
export function overlayOverhang(overlay: 'full' | 'half' | 'inset', Tc: number): number {
  return overlay === 'full' ? Tc : overlay === 'half' ? Tc / 2 : 0;
}
```
- [ ] **Step 4 — run, expect PASS.** (Adjust the `cwd` in the grep test to the repo root; if `process.cwd()` resolution is awkward, use `execSync('git rev-parse --show-toplevel')` to anchor.)
- [ ] **Step 5 — commit:** `git add packages/shared/src/drawerConventions.ts packages/shared/src/__tests__/drawerConventions.spec.ts && git commit -m "feat(drawer): drawerConventions single source of truth"`

### Task A2: schema v24 (unions + exhaustiveness sites + migration)

**Files:** Modify `packages/shared/src/cabinets/types.ts`, `types.ts`, `bore.ts`, `connectorBomCatalog.ts`, `connectorCatalog.ts`, `fileFormat.ts`, `packages/app/src/scene/SceneManager.ts`; Test `packages/shared/src/__tests__/drawerSchema.spec.ts`.

- [ ] **Step 1 — read first:** Read `bore.ts` (`BoreRole`, `BoreConnectorKind`), `connectorBomCatalog.ts` (`CONNECTOR_BOM_CATALOG` + any `ALL_KINDS`/exhaustiveness test array), `connectorCatalog.ts` (per-kind bake entry shape), `fileFormat.ts` (`CURRENT_FORMAT_VERSION` + migration registry shape), `SceneManager.ts` (`BORE_COLORS`), `cabinets/types.ts` (`PanelRole`), `types.ts` (`ComponentInstance`, `DoorSpec`). Match the existing entry shapes exactly.
- [ ] **Step 2 — failing test** (`packages/shared/`):
```ts
import { describe, it, expect } from 'vitest';
import { CONNECTOR_BOM_CATALOG } from '../connectorBomCatalog';
import { connectorCatalog } from '../connectorCatalog';
import { CURRENT_FORMAT_VERSION, migrateToCurrent } from '../fileFormat'; // match real names

describe('drawer schema v24', () => {
  it('drawerSlide kind has BOM + bake catalog entries', () => {
    expect(CONNECTOR_BOM_CATALOG.drawerSlide.nameKey).toBe('bom.connector.drawerSlide');
    expect(connectorCatalog.drawerSlide).toBeDefined();
  });
  it('format version bumped to 24', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(24);
  });
  it('a v23 doc migrates to 24 unchanged (identity)', () => {
    const v23 = { /* minimal valid v23 part doc per existing fixtures */ } as any;
    const out = migrateToCurrent(v23);
    expect(out.formatVersion).toBe(24);
  });
});
```
- [ ] **Step 3 — run, expect FAIL.** `cd packages/shared && npx vitest run src/__tests__/drawerSchema.spec.ts`
- [ ] **Step 4 — implement (all in one commit to keep compile green):**
  - `cabinets/types.ts`: `PanelRole` union `+= 'drawerFront' | 'drawerBox-side' | 'drawerBox-front' | 'drawerBox-back' | 'drawerBox-bottom'`.
  - `types.ts`: `ComponentInstance.role` accepts `'drawerFront' | 'drawerBox'`; add `drawerSpec?: { overlay: 'full'|'half'|'inset'; index: number; count: number }`.
  - `bore.ts`: `BoreRole += 'drawerSlide-cabinet' | 'drawerSlide-box'`; `BoreConnectorKind += 'drawerSlide'`.
  - `connectorBomCatalog.ts`: add `drawerSlide: { nameKey: 'bom.connector.drawerSlide', /* match existing fields: countPerConnector, etc. */ }` to `CONNECTOR_BOM_CATALOG`; update any exhaustiveness `ALL_KINDS` array.
  - `connectorCatalog.ts`: add `drawerSlide` entry (diameter 5, depth `DRAWER_SLIDE_HOLE_DEPTH`, blind) matching the shape bake/DXF read.
  - `SceneManager.ts`: add `drawerSlide: '<hex>'` to `BORE_COLORS` (pick a distinct color, e.g. `'#7d2ed1'`).
  - `fileFormat.ts`: bump `CURRENT_FORMAT_VERSION` 23→24; register `migrations[23] = identity` (pass-through that stamps `formatVersion: 24`), matching how v22→v23 was done.
- [ ] **Step 5 — run schema test + FULL shared suite, expect PASS** (catches broken exhaustiveness elsewhere): `cd packages/shared && npx vitest run`
- [ ] **Step 6 — app-side compile check** (BORE_COLORS exhaustiveness): `cd packages/app && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'BORE_COLORS|drawerSlide' || echo 'no new drawerSlide tsc errors'`
- [ ] **Step 7 — commit:** `git commit -am "feat(drawer): schema v24 — drawer roles + drawerSlide kind + catalogs"`

---

## Chunk B — drawerBankLayout

### Task B1: equal-slot division

**Files:** Create `packages/shared/src/drawerBankLayout.ts`; Test `__tests__/drawerBankLayout.spec.ts`.

- [ ] **Step 1 — failing test** (uses non-divisible heights per §14.10):
```ts
import { describe, it, expect } from 'vitest';
import { drawerBankLayout } from '../drawerBankLayout';

describe('drawerBankLayout', () => {
  it('tiles the opening into N equal slots with no gap/overlap (N=3, openH=500)', () => {
    const openBottomZ = 100;
    const slots = drawerBankLayout({ openBottomZ, openH: 500 }, 3);
    expect(slots).toHaveLength(3);
    expect(slots[0].bottomZ).toBeCloseTo(100, 6);
    expect(slots[1].bottomZ).toBeCloseTo(slots[0].topZ, 6);
    expect(slots[2].bottomZ).toBeCloseTo(slots[1].topZ, 6);
    expect(slots[2].topZ).toBeCloseTo(600, 6);
    slots.forEach((s) => expect(s.topZ - s.bottomZ).toBeCloseTo(500 / 3, 6));
  });
});
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:**
```ts
export interface Slot { index: number; bottomZ: number; topZ: number; }
export function drawerBankLayout(opening: { openBottomZ: number; openH: number }, n: number): Slot[] {
  if (n < 1) throw new Error('drawer count must be ≥ 1');
  const h = opening.openH / n;
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    bottomZ: opening.openBottomZ + i * h,
    topZ: opening.openBottomZ + (i + 1) * h,
  }));
}
```
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit:** `git commit -am "feat(drawer): drawerBankLayout equal-slot division"`

---

## Chunk C — drawerFrontMath (overlay gap model §14.1)

### Task C1: collision-free front sizing

**Files:** Create `packages/shared/src/drawerFrontMath.ts`; Test `__tests__/drawerFrontMath.spec.ts`. Reuse reveal/clearance CONSTANTS from `doorMath` (read it; do NOT call it).

- [ ] **Step 1 — failing test** (collision invariant is the headline):
```ts
import { describe, it, expect } from 'vitest';
import { drawerFrontMath } from '../drawerFrontMath';
import { DRAWER_FRONT_GAP } from '../drawerConventions';

const opening = { openBottomZ: 100, openH: 600, openW: 564, frontY: 500 };
const params = { Tc: 18, reveal: 2, insetClearance: 2 };

describe('drawerFrontMath full overlay', () => {
  it('adjacent fronts leave exactly DRAWER_FRONT_GAP, no overlap (N=3)', () => {
    const f = [0, 1, 2].map((i) => drawerFrontMath(i, 3, opening, 'full', params));
    expect(f[1].bottomZ - f[0].topZ).toBeCloseTo(DRAWER_FRONT_GAP, 6);
    expect(f[2].bottomZ - f[1].topZ).toBeCloseTo(DRAWER_FRONT_GAP, 6);
    // end fronts overhang by Tc
    expect(f[0].bottomZ).toBeCloseTo(100 - 18, 6);
    expect(f[2].topZ).toBeCloseTo(700 + 18, 6);
    // width covers sides
    expect(f[0].width).toBeCloseTo(564 + 2 * 18, 6);
  });
});

describe('drawerFrontMath inset', () => {
  it('front sits inside slot with clearance, no overlap', () => {
    const f0 = drawerFrontMath(0, 3, opening, 'inset', params);
    expect(f0.bottomZ).toBeCloseTo(100 + 2, 6);
    expect(f0.width).toBeCloseTo(564 - 4, 6);
  });
});
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** per §14.1 (slot = `openH/n`; full/half overhang via `overlayOverhang`; inner boundaries contribute `−GAP/2`, outer edges `+overhang`; inset uses clearance). Return `{ index, bottomZ, topZ, width, height, thickness, pose }` where pose = `DOOR_POSE` quaternion and translation places the front-face center at `frontY` with center Z `(bottomZ+topZ)/2` and center X `openW/2`. Import `DOOR_POSE` from `prisadkaFaceConventions`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit:** `git commit -am "feat(drawer): drawerFrontMath collision-free overlay gap model"`

---

## Chunk D — drawerBoxMath (5-panel box §14.2/14.9)

### Task D1: box panel dims + poses (anti-tautology, rotated cabinet)

**Files:** Create `packages/shared/src/drawerBoxMath.ts`; Test `__tests__/drawerBoxMath.spec.ts`.

- [ ] **Step 1 — failing test** (independent oracle; box origin = front-bottom-left corner per §14.9; butt-fit invariants):
```ts
import { describe, it, expect } from 'vitest';
import { drawerBoxMath } from '../drawerBoxMath';
import { BOX_PANEL_THICKNESS as T, BOX_BOTTOM_THICKNESS, BOX_VERT_CLEARANCE,
         SLIDE_CLEARANCE_PER_SIDE, BOX_BACK_CLEARANCE } from '../drawerConventions';

const slot = { bottomZ: 100, topZ: 300 };           // slotH = 200
const opening = { openW: 564, innerD: 500 };

describe('drawerBoxMath', () => {
  const box = drawerBoxMath(slot, opening);
  const bw = 564 - 2 * SLIDE_CLEARANCE_PER_SIDE;     // 539
  const bh = 200 - 2 * BOX_VERT_CLEARANCE;           // 176
  const bd = 500 - BOX_BACK_CLEARANCE;               // 490
  it('produces 5 panels with correct roles', () => {
    expect(box.panels.map((p) => p.role).sort()).toEqual(
      ['drawerBox-back', 'drawerBox-bottom', 'drawerBox-front', 'drawerBox-side', 'drawerBox-side']);
  });
  it('SIDE panels declared length=bh (height), width=bd (depth) — §14.2', () => {
    const side = box.panels.find((p) => p.role === 'drawerBox-side')!;
    expect(side.dims.length).toBeCloseTo(bh, 6); // height as length → u-axis = height
    expect(side.dims.width).toBeCloseTo(bd, 6);
    expect(side.dims.thickness).toBe(T);
  });
  it('front/back fit between the two sides; bottom fits inside', () => {
    const front = box.panels.find((p) => p.role === 'drawerBox-front')!;
    expect(front.dims.length).toBeCloseTo(bw - 2 * T, 6);
    const bottom = box.panels.find((p) => p.role === 'drawerBox-bottom')!;
    expect(bottom.dims.thickness).toBe(BOX_BOTTOM_THICKNESS);
    expect(bottom.dims.width).toBeCloseTo(bd - 2 * T, 6);
  });
  it('box outer dims', () => {
    expect(box.outer).toMatchObject({ width: bw, height: bh, depth: bd });
  });
});
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `drawerBoxMath(slot, opening)`:
  - `bw = openW − 2·SLIDE_CLEARANCE_PER_SIDE`, `bh = slotH − 2·BOX_VERT_CLEARANCE`, `bd = innerD − BOX_BACK_CLEARANCE`.
  - Panels (box-local origin = front-bottom-left corner; +X right, +Y back/depth, +Z up): left/right side `{length:bh, width:bd, thickness:T}`; front/back `{length:bw−2T, width:bh, thickness:T}`; bottom `{length:bw−2T, width:bd−2T, thickness:BOX_BOTTOM_THICKNESS}`. Each panel gets a local pose (translation + quaternion) so assembled box is upright with front facing +Y. Return `{ panels: {role,dims,pose}[], outer:{width:bw,height:bh,depth:bd} }`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — add pose oracle test** (rotated cabinet 15° about Z; assert one panel's WORLD centroid via two independent `quatToMat3` applications — NOT the producer). Run, expect PASS.
- [ ] **Step 6 — commit:** `git commit -am "feat(drawer): drawerBoxMath 5-panel butt box (side length=bh)"`

---

## Chunk E — drawerSlideMath (Ø5 slide bores §14.4)

### Task E1: cabinet-side + box-side rows, world-Z alignment

**Files:** Create `packages/shared/src/drawerSlideMath.ts`; Test `__tests__/drawerSlideMath.spec.ts`. Read `bore.ts` `face2DFrame`, `prisadkaFaceConventions` (`LEFT_SIDE_INNER_FACE`/`RIGHT_SIDE_INNER_FACE`), and slice-2 `hingeMath.hingePlateBores` for the side-panel u(height)/v(depth) convention.

- [ ] **Step 1 — failing test** (independent third-constant world-Z target per §14.4):
```ts
import { describe, it, expect } from 'vitest';
import { drawerSlideMath } from '../drawerSlideMath';
import { BOX_VERT_CLEARANCE, SLIDE_GRID_PITCH, DRAWER_SLIDE_FRONT_SETBACK,
         DRAWER_SLIDE_HOLE_DIAMETER } from '../drawerConventions';

const ctx = {
  drawerIndex: 1, openBottomZ: 100, slotH: 200, bh: 176,
  cabinet: { H: 720, D: 500, Tc: 18 },
  box: { bd: 490 },
  slideLength: 450,
};
describe('drawerSlideMath', () => {
  const r = drawerSlideMath(ctx);
  // independent target: rail world Z (height) for drawer 1
  const slideWorldZ = 100 + 1 * 200 + BOX_VERT_CLEARANCE + 176 / 2; // 410
  it('cabinet rows on left & right inner faces at the rail height', () => {
    const left = r.cabinetBores.filter((b) => b.face.role === 'Top');   // LEFT_SIDE_INNER_FACE
    const right = r.cabinetBores.filter((b) => b.face.role === 'Bottom');
    expect(left.length).toBeGreaterThanOrEqual(2);
    expect(right.length).toBe(left.length);
    // u = height coordinate on the side panel maps to world Z target
    left.forEach((b) => expect(ctx.cabinet.Tc /* placeholder */ && b.u).toBeCloseTo(slideWorldZ /* via panel frame */, 6));
  });
  it('box-side rows align to the SAME independent rail height', () => {
    expect(r.boxBores.length).toBe(r.cabinetBores.length);
    // box side panel u (height) → same world Z as cabinet (asserted against third constant)
  });
  it('Ø5 holes on 32mm grid, ≥2 per side, setback from front', () => {
    expect(r.cabinetBores.every((b) => b.diameter === DRAWER_SLIDE_HOLE_DIAMETER)).toBe(true);
    const vs = r.cabinetBores.filter((b) => b.face.role === 'Top').map((b) => b.v).sort((a, c) => a - c);
    expect(vs[0]).toBeCloseTo(DRAWER_SLIDE_FRONT_SETBACK, 6);
    expect(vs[1] - vs[0]).toBeCloseTo(SLIDE_GRID_PITCH, 6); // or a multiple
  });
  it('one connectorId per (drawer, side); cabinet+box bores share it', () => {
    const ids = new Set(r.cabinetBores.concat(r.boxBores).map((b) => b.connectorId));
    expect(ids.size).toBe(2); // left + right
  });
});
```
> **Implementer note:** the `u`-to-world-Z mapping depends on the side panel frame. Compute the expected `u` value that the panel's local frame must carry so its WORLD-Z resolves to `slideWorldZ` (use the same `face2DFrame`+pose transform the renderer/`translateConnectorAlong` uses), and assert against THAT independently-derived number — not against the box row. Fix the placeholder assertion accordingly.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `drawerSlideMath(ctx)`: emit Ø5 `BoreOp`s on cabinet left (`LEFT_SIDE_INNER_FACE`='Top') + right (`RIGHT_SIDE_INNER_FACE`='Bottom') side panels, `u` = the side-panel height coordinate that resolves to `slideWorldZ`, `v` = `DRAWER_SLIDE_FRONT_SETBACK + k·SLIDE_GRID_PITCH` for k=0..(holes−1) spanning `slideLength`; mirror on the box's two side panels (`role:'drawerSlide-box'`). `connectorKind:'drawerSlide'`; one `connectorId` per (drawer,side) = `drawerSlide-${drawerIndex}-${L|R}`; `depth = DRAWER_SLIDE_HOLE_DEPTH`. Return `{ cabinetBores, boxBores }`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit:** `git commit -am "feat(drawer): drawerSlideMath Ø5 slide rows, rail-aligned"`

---

## Chunk F — extract & export deriveCabinetDims (§14.5)

### Task F1: move deriveCabinetDims to a shared helper, keep door green

**Files:** Create `packages/app/src/commands/cabinetDims.ts`; Modify `packages/app/src/commands/AddDoorCommand.ts`. Test: existing AddDoorCommand suite must stay green (regression) + a small direct test.

- [ ] **Step 1 — read** `AddDoorCommand.ts:63-115` (`deriveCabinetDims`). Note its exact return shape and dependencies (opfs, unpackAssembly, PanelFeature reads).
- [ ] **Step 2 — failing test** `packages/app/src/commands/__tests__/cabinetDims.spec.ts`: import `deriveCabinetDims` from `../cabinetDims`, seed a packed cabinet in a fake opfs, assert it returns `{ width, height, depth, Tc, toekickHeight }` with the seeded values. (Expect FAIL: module not found.)
- [ ] **Step 3 — implement:** cut the function body verbatim into `cabinetDims.ts`, `export async function deriveCabinetDims(...)`; re-import it in `AddDoorCommand.ts` (delete the private copy). NO logic change.
- [ ] **Step 4 — run BOTH** the new test AND the full AddDoorCommand suite: `cd packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/cabinetDims.spec.ts src/commands/__tests__/AddDoorCommand.spec.ts` — expect PASS (no door regression).
- [ ] **Step 5 — commit:** `git commit -am "refactor(drawer): extract+export deriveCabinetDims (no behavior change)"`

---

## Chunk G — buildDrawerBox: pack box .ziasm + nested bore write (§14.5 SEAM, load-bearing)

### Task G1: build/pack box, write box-side bores into the nested .ziasm, restore

**Files:** Create `packages/app/src/commands/buildDrawerBox.ts`; Test `__tests__/buildDrawerBox.spec.ts`. Read `AssemblyPacker.ts` (`packAssembly`/`unpackAssembly`), `AddDoorCommand.writePlateBores`, and how a `PartDocument` (with `bores`) is packed inside an assembly.

- [ ] **Step 1 — failing test** (round-trip: build → pack → unpack → 5 panels; then patch box-side bores → repack → unpack → bores present; then restore):
```ts
import { describe, it, expect } from 'vitest';
import { buildDrawerBox, writeBoxSideBores, restoreBoxSideBores } from '../buildDrawerBox';
import { drawerBoxMath } from '@zilventor/shared/drawerBoxMath';        // match real import path
import { unpackAssembly } from '@zilventor/kernel/...';                  // match real path

describe('buildDrawerBox', () => {
  const box = drawerBoxMath({ bottomZ: 100, topZ: 300 }, { openW: 564, innerD: 500 });
  it('packs a .ziasm with 5 part components', async () => {
    const bytes = await buildDrawerBox(box, { boxId: 'box0', name: 'Drawer Box 1' });
    const asm = await unpackAssembly(bytes);
    expect(asm.components).toHaveLength(5);
  });
  it('writes Ø5 box-side bores into the nested side-panel parts and reads them back', async () => {
    const bytes = await buildDrawerBox(box, { boxId: 'box0', name: 'B' });
    const sideBores = [/* a couple BoreOp with role drawerSlide-box on a side panel */];
    const patched = await writeBoxSideBores(bytes, sideBores);
    const asm = await unpackAssembly(patched);
    const allBores = asm.parts.flatMap((p: any) => p.bores ?? []);
    expect(allBores.filter((b: any) => b.role === 'drawerSlide-box').length).toBe(sideBores.length);
  });
});
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:**
  - `buildDrawerBox(box, meta)`: turn each `box.panels[i]` into a `PartDocument` (PanelFeature with its dims) + a `ComponentInstance` (role, pose) → assemble an `AssemblyDocument` → `packAssembly` → return bytes. Unique part ids/paths per panel.
  - `writeBoxSideBores(boxBytes, bores)`: unpack → locate the two `drawerBox-side` part docs → append the bores destined for each (match by which side) → repack → return bytes.
  - `restoreBoxSideBores(boxBytes, priorBoresMap)`: inverse for revert.
- [ ] **Step 4 — run, expect PASS.** This proves the highest-risk seam early.
- [ ] **Step 5 — commit:** `git commit -am "feat(drawer): buildDrawerBox pack + nested box-side bore write"`

---

## Chunk H — AddDrawerBankCommand (apply/revert)

### Task H1: apply

**Files:** Create `packages/app/src/commands/AddDrawerBankCommand.ts`; Test `__tests__/AddDrawerBankCommand.spec.ts` (`// @vitest-environment node`, FULL AssemblyDocument seed). Read `AddDoorCommand.ts` end-to-end as the template (opfs, KernelPartApi registerPart/deletePart, reloadCabinet, writePlateBores snapshot/restore, dedupeName).

- [ ] **Step 1 — failing test:**
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDrawerBankCommand } from '../AddDrawerBankCommand';
import { useAppStore } from '../../store/useAppStore';
// makeAsm seed helper as used by circular/door command tests

describe('AddDrawerBankCommand apply', () => {
  it('adds N fronts + N boxes and cabinet-side slide bores (N=3)', async () => {
    // seed: setActiveDocument({kind:'assembly', document: makeAsm([cabinet component])}), cabinet .ziasm in fake opfs
    const cmd = new AddDrawerBankCommand({ cabinetPath, params: { count: 3, overlay: 'full', thickness: 18 }, opfs, kernel, store: useAppStore });
    await cmd.apply();
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    expect(cab.components.filter((c) => c.role === 'drawerFront')).toHaveLength(3);
    expect(cab.components.filter((c) => c.role === 'drawerBox')).toHaveLength(3);
    // cabinet side panels gained drawerSlide-cabinet bores
    const sideBores = cab /* read left/right side parts */;
    expect(/* count of role drawerSlide-cabinet */).toBeGreaterThan(0);
    // each box .ziasm written to opfs and unique
    const boxPaths = cab.components.filter((c) => c.role === 'drawerBox').map((c) => c.partPath);
    expect(new Set(boxPaths).size).toBe(3);
    for (const p of boxPaths) expect(await opfs.exists(p)).toBe(true);
  });
  it('blocks degenerate cabinet (openW ≤ 57 or slotH ≤ 24)', async () => {
    // seed a tiny cabinet; expect apply to throw/return a guard error, no components added
  });
});
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `apply()` per spec §4 + §14: `deriveCabinetDims` → `drawerBankLayout` → per slot `drawerFrontMath` + write front `.zipt` (registerPart) + `drawerBoxMath` → `buildDrawerBox` + `drawerSlideMath` → `writeBoxSideBores` into box + append cabinet-side bores to the cabinet's left/right side parts (snapshot priors) → push front + box components (unique `dedupeName` paths) → `packAssembly`+write → `reloadCabinet`. Degenerate guard (§14.3) BEFORE writing anything.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit:** `git commit -am "feat(drawer): AddDrawerBankCommand.apply"`

### Task H2: revert

**Files:** same; extend test.

- [ ] **Step 1 — failing test:** after `apply()` then `revert()`: cabinet components back to baseline (0 fronts, 0 boxes); each box `.ziasm` + front `.zipt` blob absent (`opfs.exists === false`); cabinet-side prior bores restored (count back to original).
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `revert()`: remove created components, `restoreBoxSideBores`/restore cabinet-side prior bores from snapshot, `opfs.delete` all written blobs (best-effort), deletePart from kernel, repack+reload.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit:** `git commit -am "feat(drawer): AddDrawerBankCommand.revert (no blob leak)"`

---

## Chunk I — kernel real-OCCT bake guard (§14.10)

### Task I1: producer bores → bakeHoles → Ø5 volume drop

**Files:** Test `packages/kernel/src/.../DrawerSlideBake.integration.spec.ts`. Read slice-1/2 bake integration tests + `bakeHoles`/`atFace` HolePlacement.

- [ ] **Step 1 — failing test:** build a cabinet side panel + a box side panel solid; take the **producer's actual** emitted `BoreOp[]` (from `drawerSlideMath`, extracted as written by the command path or directly), bake via the real OCCT `atFace` pipeline, assert measured volume drops by ≈ N·π·2.5²·12 on BOTH panels (within tolerance). NO hand-authored u/v.
- [ ] **Step 2 — run (real OCCT), expect FAIL** (`cd packages/kernel && npx vitest run --config vitest.integration.config.ts <relpath>`).
- [ ] **Step 3 — wire** whatever bake glue is needed so `drawerSlide-*` roles route through the existing `atFace` blind-hole path (catalog entry from A2 should suffice; if a role→placement switch exists, add the two roles).
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit:** `git commit -am "test(drawer): real-OCCT Ø5 slide-bore volume guard"`

---

## Chunk J — UI: DrawerBankDialog + FurnitureTab + i18n (§14.8)

### Task J1: DrawerBankDialog (DOM + validation + bus.execute assertion)

**Files:** Create `packages/app/src/shell/DrawerBankDialog.tsx`; Test `__tests__/DrawerBankDialog.spec.tsx` (jsdom). Read `CircularPatternDialog.tsx` + the door dialog for the form/validation idiom.

- [ ] **Step 1 — failing test:** render dialog with a fake cabinet; `fireEvent.change` count→3, overlay→full; click commit; assert the supplied `onSubmit` was called with `{ count: 3, overlay: 'full', thickness: 18 }`; invalid count (1 or 999) + degenerate cabinet block commit and show error. **Plus:** a separate test wiring `onSubmit` to a fake `bus.execute` and asserting it's called with an `AddDrawerBankCommand` instance (proves dialog→command path, §14.10).
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `DrawerBankDialog`: count (int 2–10, `step={1}`, default 3), overlay select (full/half/inset, default full), thickness (default 18); validate bounds + degenerate (call a small `canFitDrawers(dims, count)` guard); `onSubmit(opts)` / `onCancel()`. i18n keys via `t()`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit:** `git commit -am "feat(drawer): DrawerBankDialog + validation"`

### Task J2: FurnitureTab wiring (door callback-object pattern)

**Files:** Modify `packages/app/src/shell/tabs/FurnitureTab.tsx`, `store/useAppStore.ts`. Read how "Add Door" wires `beginOneComponentPick` + `setAddDoorDialog`.

- [ ] **Step 1 — failing test** (controller-style or rendered): clicking "Add Drawers" calls `beginOneComponentPick`; selecting a cabinet sets `addDrawerBankDialog` callback-object; `onSubmit` dispatches `AddDrawerBankCommand` via the bus.
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:** store `addDrawerBankDialog: { cabinetPath; onSubmit; onCancel } | null` + setter; FurnitureTab "Add Drawers" button next to "Add Door" → `beginOneComponentPick` → on pick set the dialog callback-object → render `DrawerBankDialog` → `onSubmit` builds opts + `bus.execute(new AddDrawerBankCommand(...))`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit:** `git commit -am "feat(drawer): FurnitureTab Add Drawers wiring"`

### Task J3: i18n en/uk + BOM label

**Files:** Modify `packages/app/src/locales/en.json`, `uk.json`; Test the existing parity test + a BOM render test.

- [ ] **Step 1 — failing test:** parity test fails if `dialog.drawerBank.*`, `furniture.addDrawers` (or `tab.*`), `aria.add_drawers`, `bom.connector.drawerSlide`, and the two boring-map role labels are missing from either bundle. Plus a `ConnectorBomTable` render test asserting a `drawerSlide` group shows the localized label (not the raw key).
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — add keys** to BOTH en.json + uk.json (EN values English; UK values translated — drawer = «шухляда», slide = «напрямна»; lead reviews later).
- [ ] **Step 4 — run, expect PASS** (parity + BOM render).
- [ ] **Step 5 — commit:** `git commit -am "feat(drawer): i18n en/uk + drawerSlide BOM label"`

---

## Chunk K — e2e (real browser + WASM, §14.10)

### Task K1: command → N drawers, nested box, recursion-reach, undo

**Files:** Create `tests/e2e/prisadka-slice4-drawer-banks.spec.ts`. Model on `prisadka-slice2-doors-system32.spec.ts` + the circular-pattern e2e. Use `playwright.worktree.config.ts` (port 5182) — **manually start** `npx vite --port 5182` from the worktree's `packages/app` first, then `npx playwright test --config playwright.worktree.config.ts <relpath>`.

- [ ] **Step 1 — write e2e** (probe path): seed a base cabinet → `__zilventorStore` execute `AddDrawerBankCommand` with N=3 → assert:
  - cabinet component count grew by 6 (3 fronts + 3 boxes);
  - `viewport.getSceneManager().boreMarkerCount()` > 0;
  - OPFS-unpack one box `.ziasm` (`__zilventorUnpackProject`/`__zilventorGetOpfs`) → 5 panel components + box-side bores present;
  - `aggregateBoresRecursive(cabinet)` (via a probe) returns ≥1 bore with `role:'drawerSlide-box'` (recursion reaches nested level — §14.10);
  - undo → counts return to baseline.
- [ ] **Step 2 — start vite (worktree app dir, port 5182), run the e2e, expect PASS.** Headless viewport is BLACK — assert via probes, not screenshots.
- [ ] **Step 3 — commit:** `git commit -am "test(drawer): e2e drawer-bank command + nested box + recursion + undo"`

---

## Final gates (controller, after all chunks)

1. **FINAL whole-branch review** re-checking spec §-by-§ (esp. §14.10.7-class items): nested box actually written+referenced (not in-memory only); recursion ACTUALLY reaches box bores (render/BOM/boring-map); dialog handlers call the command for real; revert deletes blobs + restores bores; degenerate guard fires; collision-free fronts; rail alignment.
2. **FULL-package tsc** (source + tests): `cd packages/app && npx tsc --noEmit` and shared/kernel — 0 NEW errors vs the ~60 baseline.
3. **Full app suite** + shared + kernel integration green.
4. **§6 browser** e2e green (Chunk K).
5. `superpowers:finishing-a-development-branch` Option 1: merge `--no-ff` via `git -C MAIN_ROOT`, push, worktree remove, rewrite `next_session_resume.md`, write `project_prisadka_slice4*.md`, MEMORY.md line, .remember handoff. Verify `origin/master` advanced.

## Self-review (done by author)

- **Spec coverage:** §1–§13 + §14.1–14.11 each map to a task (constants A1; schema/exhaustiveness A2; bank division B1; front gap model C1; box axis/oracle D1; slide rail E1; deriveCabinetDims export F1; nested bore-write seam G1; command apply/revert H1/H2; bake guard I1; dialog/wiring/i18n J1-3; e2e recursion-reach K1). ✓
- **Placeholder scan:** the `u`-to-world-Z assertion in E1 and the bore fixtures in G1/H1 are marked as implementer-derived with explicit notes (the exact panel-frame transform must be read from real code) — not silent TODOs. Reference snippets per [[feedback_plan_snippets_are_reference]].
- **Type consistency:** `drawerBankLayout`→`Slot{index,bottomZ,topZ}` used in C/D/H; `drawerBoxMath`→`{panels:{role,dims,pose}[],outer}` used in G; `drawerSlideMath`→`{cabinetBores,boxBores}` used in G/H; `AddDrawerBankCommand({cabinetPath,params:{count,overlay,thickness},opfs,kernel,store})` consistent in H/J. ✓

---

## Plan Corrections v2 — AUTHORITATIVE (post 2-lens plan-verify, 2026-06-11)

Plan-verifiers confirmed all §14 GEOMETRY MATH correct by hand (front gaps exact, box axis sound, rail target=400, bake 235.6mm³/hole). These corrections OVERRIDE conflicting task text where noted. Apply them as you execute.

**C-1 (A2) — `connectorCatalog` object does NOT exist; no bake entry needed.** `packages/shared/src/connectorCatalog.ts` exports only functions (`generateConfirmat`/`generateMinifix`/`generateDowel`); shelfPin/hinge live in their own files. `BakeBoresCommand` is GENERIC (groups bores by `face.role|diameter|depth` → `atFace`), so `drawerSlide` needs NO catalog/bake entry. **DELETE** the `connectorCatalog.drawerSlide` assertion and the A2-step-4 "add connectorCatalog entry" + the A2-4 `connectorCatalog.ts` modify. Chunk I step 3 is then a **no-op** (bake already routes generically) — I1 just proves it.

**C-2 (A2) — migration API.** `fileFormat.ts` exports `migrateManifest` (NOT `migrateToCurrent`); `migrations` is internal. A2 test: `import { CURRENT_FORMAT_VERSION, migrateManifest } from '../fileFormat'` and call `migrateManifest(v23Doc)`.

**C-3 (paths) — SceneManager is at `packages/app/src/viewport/SceneManager.ts`** (NOT `scene/`); `BORE_COLORS` at ~line 114 with `satisfies Record<BoreConnectorKind, string>`. Fix the file-structure header + A2 step 6.

**C-4 (file structure header) — `cabinetDims.ts` lives in `packages/app/src/commands/`** (NOT `packages/shared/src`). `deriveCabinetDims` depends on `opfs.read` + `unpackProject` (app/kernel layer) and cannot live in shared. Task F1's location is correct; the header is wrong.

**C-5 (G1) — box is 5 separate panel `.zipt` files + 1 box `.ziasm` referencing them; `AssemblyDocument` has NO `.parts` field.** `unpackAssembly` returns `{ components: ComponentInstance[] }`; panel `bores[]` live in each panel's `PartDocument` (`.zipt`), not on the assembly. So: `buildDrawerBox` writes 5 panel `.zipt` (via `packProject({manifest:{formatVersion:CURRENT_FORMAT_VERSION,kind:'part',document:panelDoc},blobs:{}})` from `@zilventor/kernel/.../ProjectPacker`) to OPFS + 1 box `.ziasm` (via `packAssembly`) referencing them by `partPath`. `writeBoxSideBores` patches the two side-panel **`.zipt`** docs (unpack each via `unpackProject` → append bores → repack → opfs.write), NOT the `.ziasm`. G1 test reads bores back by iterating the box's components, `unpackProject(opfs.read(c.partPath))`, and reading `manifest.document.bores`.

**C-6 (H1/H2 seed) — use the FULL AddDoorCommand.spec seed, NOT bare `makeAsm`.** `AddDrawerBankCommand` reads the cabinet `.ziasm` + unpacks panel `.zipt`s for dims; a flat `makeAsm` throws on opfs read / `leftSide` lookup. Replicate `AddDoorCommand.spec.ts` (~lines 36–94): write panel `.zipt` bytes to a `MemOpfs`; `packAssembly(cabinetDoc, new Uint8Array())` → write cabinet `.ziasm`; build a top wrapper `AssemblyDocument` with `components:[{partPath:cabinetPath,...}]`; `setActiveDocument({kind:'assembly',document:topDoc})`; `setSubAssemblyDocs({[cabinetPath]:cabinetDoc})`. Read that spec first and clone its `MemOpfs` + `KernelPartApi` mocks.

**C-7 (E1) — fix comment + PRE-FILL the box-side alignment assertion (no skeleton).** The `// 410` comment is wrong → `// 400` (formula = 100+200+12+88). DELETE the placeholder `ctx.cabinet.Tc /* placeholder */ && b.u` line. Pre-fill BOTH rows asserted against the independent third constant: compute each side panel's LOCAL u that resolves to world-Z 400 — **note panel-local `u = worldZ − panelBottomZ`** (cabinet side panel bottom may sit at toekick height; box side panel bottom sits at the box origin), so derive each row's expected local-u from its own panel frame, NOT cabinet-row vs box-row against each other. This closes the §14.4 symmetric-bug false green.

**C-8 (H1) — PRE-FILL the degenerate-guard test (no empty body).** Seed a cabinet with `openW≈50` (< 57); assert `cmd.apply()` rejects with a message matching `drawerBank.error.tooSmall` and that NO components were added. (Mirrors the circular-pattern radius-guard gate that slice-3's final review caught when plan-deferred.)

**C-9 (H2 revert) — `OpfsRWD.delete` is optional** (`delete?(p)` in AddDoorCommand). Call `await opfs.delete?.(path)`; ensure the test `MemOpfs` implements `delete` so deletion is actually exercised.

**C-10 (K1 + boring-map reach) — explicitly prove the boring map/aggregate reaches NESTED box `.zipt` bores.** `aggregateBoresRecursive` checks `.endsWith('.ziasm')` and recurses, but the part-bore cache (`partBoresCacheRef`) populates from kernel-registered parts — ensure H1 `registerPart`s the box panel `.zipt`s so their bores are visible. K1 must assert a probe over the cabinet returns ≥1 `role:'drawerSlide-box'` bore (recursion + cache reach the nested level). If no `aggregateBoresRecursive` window probe exists, add one (`window.__zilventorBoringAggregate`) in the e2e harness, mirroring `__zilventorConnectorBomAggregate`.
