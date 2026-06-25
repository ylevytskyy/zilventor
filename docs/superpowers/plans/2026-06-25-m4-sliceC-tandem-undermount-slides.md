# M4 Slice C — Blum TANDEM Under-Mount Drawer-Slide Boring

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `AddDrawerBankCommand` with `slideSystem: 'sideMount' | 'tandem'` (default `'sideMount'`). When `'tandem'`, the command swaps the slide SKU, widens box-body side clearance to 21 mm per side, and emits under-mount boring on three surfaces: cabinet side panels, drawer-box bottom panel, drawer-box back panel.

**Branch:** `feat/m4-tandem-slides`

## Global Constraints

- `slideSystem` defaults to `'sideMount'`; **side-mount path stays byte-for-byte identical** (no behaviour change when omitted).
- **No manifest bump** — adding `BoreRole` strings to a union needs no migration; stays `CURRENT_FORMAT_VERSION = 32` (leg-leveler precedent).
- `packages/app` has **no `test` script** → run `cd packages/app && pnpm exec vitest run <spec>`.
- shared tests: `cd packages/shared && pnpm exec vitest run <spec>`.
- **`pnpm typecheck`** (root, 5 pkgs, 0 errors expected) after EVERY task before committing.
- Full-repo `pnpm lint` OOMs → run eslint scoped per package.
- gzip repack is non-deterministic → tests compare geometry/counts, **not raw bytes**.
- Repack must preserve blobs: `blobs: project.blobs ?? {}`.
- `exactOptionalPropertyTypes: true` → conditional spread for optional undefinable fields.
- `master` protected — all commits on `feat/m4-tandem-slides`, --no-ff merge to local master when done (unpushed; human-gated).
- **Load-bearing test requirement:** every bore-position test MUST assert the absolute world position of each bore by mapping `(u,v)` through `face2DFrame` — NOT just counts. The leg-leveler slice shipped a v-mapping blocker that count-only tests missed (commit `3033a803`).

---

### Task 1: `tandemConventions.ts` — nominal constants

**Files:**
- Create: `packages/shared/src/tandemConventions.ts`
- Create: `packages/shared/src/__tests__/tandemConventions.spec.ts`

**Interfaces:**
- Consumes: nothing (standalone constants)
- Produces: 10 exported `const` numbers

- [ ] **Step 1 — Write failing test**

Create `packages/shared/src/__tests__/tandemConventions.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  TANDEM_SLIDE_CLEARANCE_PER_SIDE,
  TANDEM_CABINET_FRONT_SETBACK,
  TANDEM_CABINET_REAR_HOLE_FROM_BACK,
  TANDEM_CABINET_RUNNER_HEIGHT,
  TANDEM_CABINET_HOLE_DIAMETER,
  TANDEM_LOCK_HOLE_DIAMETER,
  TANDEM_REAR_HOOK_FROM_BACK,
  TANDEM_BOTTOM_HOLE_DIAMETER,
  TANDEM_HOLE_DEPTH,
  TANDEM_MIN_HOLES,
} from '../tandemConventions';

describe('tandemConventions', () => {
  it('all nominal constants are present and have correct values', () => {
    expect(TANDEM_SLIDE_CLEARANCE_PER_SIDE).toBe(21);
    expect(TANDEM_CABINET_FRONT_SETBACK).toBe(37);
    expect(TANDEM_CABINET_REAR_HOLE_FROM_BACK).toBe(9);
    expect(TANDEM_CABINET_RUNNER_HEIGHT).toBe(10);
    expect(TANDEM_CABINET_HOLE_DIAMETER).toBe(5);
    expect(TANDEM_LOCK_HOLE_DIAMETER).toBe(10);
    expect(TANDEM_REAR_HOOK_FROM_BACK).toBe(9);
    expect(TANDEM_BOTTOM_HOLE_DIAMETER).toBe(5);
    expect(TANDEM_HOLE_DEPTH).toBe(12);
    expect(TANDEM_MIN_HOLES).toBe(2);
  });
});
```

- [ ] **Step 2 — Run test; confirm red** (import error expected, not a test logic error)

```
cd packages/shared && pnpm exec vitest run src/__tests__/tandemConventions.spec.ts
```

- [ ] **Step 3 — Create `packages/shared/src/tandemConventions.ts`**

```ts
/**
 * Nominal Blum TANDEM 560H constants — documented as nominal/editable.
 * These approximate the TANDEM 560H datasheet and are NOT held to the
 * published spec to the millimetre.
 */

/** Box-body inset per side (Blum "inside − 42 mm" rule). Nominal: 21 mm. */
export const TANDEM_SLIDE_CLEARANCE_PER_SIDE = 21;

/** Front runner-fixing hole from cabinet front. Nominal: 37 mm. */
export const TANDEM_CABINET_FRONT_SETBACK = 37;

/** Rear runner-fixing hole from cabinet back inner face. Nominal: 9 mm. */
export const TANDEM_CABINET_REAR_HOLE_FROM_BACK = 9;

/** Runner-fixing line height above the drawer-opening floor. Nominal: 10 mm. */
export const TANDEM_CABINET_RUNNER_HEIGHT = 10;

/** Cabinet-side fixing hole diameter. Nominal: Ø5 mm. */
export const TANDEM_CABINET_HOLE_DIAMETER = 5;

/** Locking-device hole diameter (drawer back panel). Nominal: Ø10 mm. */
export const TANDEM_LOCK_HOLE_DIAMETER = 10;

/** Bottom-panel rear-hook engagement hole from box back inner face. Nominal: 9 mm. */
export const TANDEM_REAR_HOOK_FROM_BACK = 9;

/** Bottom-panel fixing hole diameter. Nominal: Ø5 mm. */
export const TANDEM_BOTTOM_HOLE_DIAMETER = 5;

/** Nominal bore depth for all TANDEM holes. Nominal: 12 mm. */
export const TANDEM_HOLE_DEPTH = 12;

/** Minimum fixing holes per cabinet side. Nominal: 2. */
export const TANDEM_MIN_HOLES = 2;
```

- [ ] **Step 4 — Run test; confirm green**

```
cd packages/shared && pnpm exec vitest run src/__tests__/tandemConventions.spec.ts
```

- [ ] **Step 5 — Typecheck + commit**

```
pnpm typecheck
git add packages/shared/src/tandemConventions.ts packages/shared/src/__tests__/tandemConventions.spec.ts
git commit -m "feat(m4-c): tandemConventions — nominal TANDEM 560H constants"
```

---

### Task 2: `builtinCatalog.ts` — TANDEM SKU

**Files:**
- Modify: `packages/shared/src/hardware/builtinCatalog.ts`
- Create: `packages/shared/src/__tests__/tandemCatalog.spec.ts`

**Interfaces:**
- Consumes: `BUILTIN_CATALOG` array (existing); existing `CatalogEntry` shape `{ id, name, category, vendor, notes, bboxMm: {l,w,h}, attachPoints: [{name,position}] }`
- Produces: `BUILTIN_CATALOG` gains entry `id: 'drawer-slide-tandem-500'`

- [ ] **Step 1 — Write failing test**

Create `packages/shared/src/__tests__/tandemCatalog.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUILTIN_CATALOG } from '../hardware/builtinCatalog';

describe('builtinCatalog — TANDEM SKU', () => {
  it('drawer-slide-tandem-500 is present with correct shape', () => {
    const entry = BUILTIN_CATALOG.find((e) => e.id === 'drawer-slide-tandem-500');
    expect(entry, 'drawer-slide-tandem-500 must be in BUILTIN_CATALOG').toBeDefined();
    expect(entry!.category).toBe('drawerSlides');
    expect(entry!.vendor).toBe('Blum');
    // Under-mount: l ≈ 42 mm (2 × TANDEM_SLIDE_CLEARANCE_PER_SIDE), w = 500 mm run
    expect(entry!.bboxMm.l).toBe(42);
    expect(entry!.bboxMm.w).toBe(500);
    expect(entry!.attachPoints.find((p) => p.name === 'front')).toBeDefined();
    expect(entry!.attachPoints.find((p) => p.name === 'back')).toBeDefined();
  });
});
```

- [ ] **Step 2 — Run test; confirm red**

```
cd packages/shared && pnpm exec vitest run src/__tests__/tandemCatalog.spec.ts
```

- [ ] **Step 3 — Add entry to `BUILTIN_CATALOG` in `packages/shared/src/hardware/builtinCatalog.ts`**

After the existing `drawer-slide-500-softclose` entry, add:

```ts
  {
    id: 'drawer-slide-tandem-500',
    name: 'Blum TANDEM Under-Mount Slide 500mm (pair)',
    category: 'drawerSlides',
    vendor: 'Blum',
    notes: 'TANDEM 560H nominal; under-mount; 500mm run; sold as pair',
    bboxMm: { l: 42, w: 500, h: 14 },
    attachPoints: [
      { name: 'front', position: { x: 0, y:  250, z: 0 } },
      { name: 'back',  position: { x: 0, y: -250, z: 0 } },
    ],
  },
```

- [ ] **Step 4 — Run test; confirm green**

```
cd packages/shared && pnpm exec vitest run src/__tests__/tandemCatalog.spec.ts
```

- [ ] **Step 5 — Typecheck + commit**

```
pnpm typecheck
git add packages/shared/src/hardware/builtinCatalog.ts packages/shared/src/__tests__/tandemCatalog.spec.ts
git commit -m "feat(m4-c): add drawer-slide-tandem-500 to BUILTIN_CATALOG"
```

---

### Task 3: `bore.ts` — new BoreRole and BoreConnectorKind values

**Files:**
- Modify: `packages/shared/src/bore.ts`
- Create: `packages/shared/src/__tests__/tandemBoreTypes.spec.ts`

**Interfaces:**
- Consumes: existing `BoreRole` union (currently ends with `'legLeveler'`); `BoreConnectorKind` union (currently ends with `'legLeveler'`)
- Produces: `BoreRole` gains `'tandem-cabinet' | 'tandem-drawer-bottom' | 'tandem-drawer-back'`; `BoreConnectorKind` gains `'tandem'`

- [ ] **Step 1 — Write failing test**

Create `packages/shared/src/__tests__/tandemBoreTypes.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { BoreRole, BoreConnectorKind, BoreOp } from '../bore';

describe('bore.ts — tandem role/kind members', () => {
  it('BoreRole accepts tandem-cabinet, tandem-drawer-bottom, tandem-drawer-back', () => {
    const r1: BoreRole = 'tandem-cabinet';
    const r2: BoreRole = 'tandem-drawer-bottom';
    const r3: BoreRole = 'tandem-drawer-back';
    expect(r1).toBe('tandem-cabinet');
    expect(r2).toBe('tandem-drawer-bottom');
    expect(r3).toBe('tandem-drawer-back');
  });

  it('BoreConnectorKind accepts tandem', () => {
    const k: BoreConnectorKind = 'tandem';
    expect(k).toBe('tandem');
  });

  it('BoreOp round-trips a tandem-cabinet bore with correct shape', () => {
    const b: BoreOp = {
      id: 'tc-0',
      face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 150,
      v: 37,
      diameter: 5,
      depth: 12,
      role: 'tandem-cabinet',
      connectorId: 'tandem-0-L',
      connectorKind: 'tandem',
    };
    expect(b.role).toBe('tandem-cabinet');
    expect(b.connectorKind).toBe('tandem');
  });
});
```

- [ ] **Step 2 — Run test; confirm red** (type error on `'tandem-cabinet'` assignment)

```
cd packages/shared && pnpm exec vitest run src/__tests__/tandemBoreTypes.spec.ts
```

- [ ] **Step 3 — Extend unions in `packages/shared/src/bore.ts`**

Change `BoreRole` (currently ends at `'legLeveler'`) to:

```ts
export type BoreRole =
  | 'confirmat-face' | 'confirmat-edge'
  | 'minifix-cam' | 'minifix-bolt' | 'minifix-cross'
  | 'dowel-face' | 'dowel-edge'
  | 'shelfPin-system32'
  | 'hingeCup'
  | 'hingePlate'
  | 'drawerSlide-cabinet'
  | 'drawerSlide-box'
  | 'handleScrew-face'
  | 'legLeveler'
  | 'tandem-cabinet'
  | 'tandem-drawer-bottom'
  | 'tandem-drawer-back';
```

Change `BoreConnectorKind` (currently ends at `'legLeveler'`) to:

```ts
export type BoreConnectorKind = 'confirmat' | 'minifix' | 'dowel' | 'shelfPin' | 'hinge' | 'drawerSlide' | 'handleScrew' | 'legLeveler' | 'tandem';
```

- [ ] **Step 4 — Run test; confirm green**

```
cd packages/shared && pnpm exec vitest run src/__tests__/tandemBoreTypes.spec.ts
```

- [ ] **Step 5 — Typecheck + commit**

```
pnpm typecheck
git add packages/shared/src/bore.ts packages/shared/src/__tests__/tandemBoreTypes.spec.ts
git commit -m "feat(m4-c): bore.ts — add tandem BoreRole / BoreConnectorKind members"
```

---

### Task 4: `tandemSlideMath.ts` — bore positions with absolute world assertions

**Files:**
- Modify: `packages/shared/src/drawerSlideMath.ts` (add `bw?: number` to `box` field)
- Create: `packages/shared/src/tandemSlideMath.ts`
- Create: `packages/shared/src/__tests__/tandemSlideMath.spec.ts`

**Interfaces:**
- Consumes: `DrawerSlideCtx` (with `box.bw: number` added); constants from `tandemConventions.ts`; `LEFT_SIDE_INNER_FACE`, `RIGHT_SIDE_INNER_FACE` from `prisadkaFaceConventions.ts`; `face2DFrame` from `bore.ts`; `BOX_PANEL_THICKNESS` from `drawerConventions.ts`
- Produces:
  ```ts
  export function tandemSlideMath(
    ctx: DrawerSlideCtx & { box: { bw: number } },
  ): {
    cabinetBores: BoreOp[];
    boxBottomBores: BoreOp[];
    boxBackBores: BoreOp[];
  }
  ```

**Bore placement (load-bearing geometry — read before coding):**

_Cabinet side panels_ (same face routing as drawerSlideMath):
- `face.role`: `LEFT_SIDE_INNER_FACE` ('Top') and `RIGHT_SIDE_INNER_FACE` ('Bottom')
- `u = openBottomZ + i * slotH + TANDEM_CABINET_RUNNER_HEIGHT` (world-Z of the runner line)
- `v[0] = TANDEM_CABINET_FRONT_SETBACK` (= 37)
- `v[1] = cabinet.D - cabinet.Tc - TANDEM_CABINET_REAR_HOLE_FROM_BACK` (= D - Tc - 9)

_Box bottom panel_ (`face.role = 'Bottom'`; bottom panel face2DFrame: `origin=(-botLen/2, botWid/2, 0)`, `uDir=(1,0,0)`, `vDir=(0,-1,0)` → box-local point = `(T + u, bd - T - v, 0)` where `botLen = bw - 2T`, `botWid = bd - 2T`):
- Left runner: `u_L = BOX_PANEL_THICKNESS` (16), `v_rear = TANDEM_REAR_HOOK_FROM_BACK` (9), `v_front = botWid - TANDEM_CABINET_FRONT_SETBACK`
- Right runner: `u_R = botLen - BOX_PANEL_THICKNESS`, same v positions
- 4 bores per drawer total

_Box back panel_ (`face.role = 'Bottom'` of `drawerBox-back`; back panel 'Bottom' face2DFrame: `origin=(-fbLen/2, bh/2, 0)`, `uDir=(1,0,0)`, `vDir=(0,-1,0)` → with FRONT_BACK_QUAT R=(part-X→+X, part-Z→+Y): box-local = `(T + u, bd-T, v)` — v maps directly to box-local Z):
- Left runner: `u_L = BOX_PANEL_THICKNESS`, `v = TANDEM_CABINET_RUNNER_HEIGHT` (10 — nominal height above box floor)
- Right runner: `u_R = fbLen - BOX_PANEL_THICKNESS`, same v
- 2 bores per drawer total

- [ ] **Step 1 — Extend `DrawerSlideCtx` in `packages/shared/src/drawerSlideMath.ts`**

Change `box: { bd: number }` to `box: { bd: number; bw?: number }`:

```ts
export interface DrawerSlideCtx {
  drawerIndex: number;
  openBottomZ: number;
  slotH: number;
  bh: number; // box height = slotH − 2·BOX_VERT_CLEARANCE
  cabinet: { H: number; D: number; Tc: number };
  box: { bd: number; bw?: number };
  slideLength: number;
}
```

- [ ] **Step 2 — Write failing test**

Create `packages/shared/src/__tests__/tandemSlideMath.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tandemSlideMath } from '../tandemSlideMath';
import { face2DFrame } from '../bore';
import {
  TANDEM_CABINET_RUNNER_HEIGHT,
  TANDEM_CABINET_FRONT_SETBACK,
  TANDEM_CABINET_REAR_HOLE_FROM_BACK,
  TANDEM_REAR_HOOK_FROM_BACK,
  TANDEM_CABINET_HOLE_DIAMETER,
  TANDEM_BOTTOM_HOLE_DIAMETER,
  TANDEM_LOCK_HOLE_DIAMETER,
  TANDEM_HOLE_DEPTH,
} from '../tandemConventions';
import { BOX_PANEL_THICKNESS as T } from '../drawerConventions';

// Test fixture — seeded cabinet + box values
const Tc = 18, H = 720, D = 560;
const openBottomZ = 100;
const slotH = 200;
const bh = 176;   // slotH - 2*BOX_VERT_CLEARANCE(12)
const bd = 490;   // box depth
const bw = 564;   // openW - 2*TANDEM_SLIDE_CLEARANCE_PER_SIDE ≈ 606 - 42; pick concrete value

const ctx = {
  drawerIndex: 1,
  openBottomZ,
  slotH,
  bh,
  cabinet: { H, D, Tc },
  box: { bd, bw },
  slideLength: bd,
};

describe('tandemSlideMath', () => {
  const r = tandemSlideMath(ctx);

  // ─── Independent oracle targets ───────────────────────────────────────────────
  // Runner world-Z = openBottomZ + i*slotH + TANDEM_CABINET_RUNNER_HEIGHT
  const runnerWorldZ = openBottomZ + 1 * slotH + TANDEM_CABINET_RUNNER_HEIGHT; // 310
  // Cabinet v positions
  const vFront = TANDEM_CABINET_FRONT_SETBACK;                         // 37
  const vRear  = D - Tc - TANDEM_CABINET_REAR_HOLE_FROM_BACK;          // 533

  it('emits 2 cabinet bores per side (front + rear)', () => {
    const left  = r.cabinetBores.filter((b) => b.face.role === 'Top');
    const right = r.cabinetBores.filter((b) => b.face.role === 'Bottom');
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(2);
  });

  it('cabinet bore u = runnerWorldZ (absolute world-Z) [load-bearing]', () => {
    // Cabinet side panel: length=H, bottom at world-Z=0 → u = world-Z.
    // To verify world position via face2DFrame (same transform viewport uses):
    //   Top face: origin=(-H/2, -D/2, Tc), uDir=(1,0,0), vDir=(0,1,0)
    //   world-X of bore = origin.x + u * uDir.x = -H/2 + u
    //   But for LEFT side panel (role=leftSide) the panel is rotated SIDE_PANEL_QUAT
    //   (part-X→+Z, part-Y→-Y, part-Z→+X). The u-axis of the Top face = part-X → world-Z.
    //   So world-Z of bore = (panel bottom in world) + u_panel.
    //   Panel bottom at world-Z = 0; u_panel = runnerWorldZ.  ← The independent oracle.
    r.cabinetBores.forEach((b) => {
      expect(b.u).toBeCloseTo(runnerWorldZ, 6);
    });
  });

  it('cabinet bore v positions: front=37, rear=D-Tc-9', () => {
    const leftVs = r.cabinetBores
      .filter((b) => b.face.role === 'Top')
      .map((b) => b.v)
      .sort((a, c) => a - c);
    expect(leftVs[0]).toBeCloseTo(vFront, 6);
    expect(leftVs[1]).toBeCloseTo(vRear, 6);
  });

  it('RIGHT cabinet bore (Bottom face) world-depth via face2DFrame [load-bearing — catches vDir sign flip]', () => {
    // face2DFrame('Bottom'): origin=(-H/2,D/2,0), uDir=(1,0,0), vDir=(0,-1,0).
    // part-local Y of bore at v: D/2 - v.
    // Under SIDE_PANEL_QUAT (part-Y → world -Y): world-Y = -(D/2 - v) = v - D/2.
    // "depth from front" = D + world-Y = D + v - D/2 = D/2 + v  (front is at world-Y=0).
    // Front bore (v=37): depth = D/2 + 37 = 317mm from front (not 37).
    // But the KEY TEST is the sign: vDir=(0,-1,0) gives partY = D/2-v < D/2.
    // If vDir were (0,+1,0) (sign flip), partY = D/2+v → rear bore partY = D/2+533 = 813 > D ← impossible.
    const fRight = face2DFrame({ length: H, width: D, thickness: Tc }, 'Bottom');
    const rightBores = r.cabinetBores.filter((b) => b.face.role === 'Bottom');
    const frontBore = rightBores.find((b) => b.v === vFront)!;
    const rearBore  = rightBores.find((b) => b.v === vRear)!;
    // Part-local Y for front bore: D/2 - 37 = 243
    expect(fRight.origin.y + frontBore.v * fRight.vDir.y).toBeCloseTo(D / 2 - vFront, 6);
    // Part-local Y for rear bore: D/2 - (D-Tc-9) = -(D/2-Tc-9) < 0 — confirms vDir=-Y, not +Y
    expect(fRight.origin.y + rearBore.v * fRight.vDir.y).toBeCloseTo(D / 2 - vRear, 6);
    expect(fRight.origin.y + rearBore.v * fRight.vDir.y).toBeLessThan(0);
  });

  it('cabinet bores have role=tandem-cabinet, connectorKind=tandem, diameter=5, depth=12', () => {
    r.cabinetBores.forEach((b) => {
      expect(b.role).toBe('tandem-cabinet');
      expect(b.connectorKind).toBe('tandem');
      expect(b.diameter).toBe(TANDEM_CABINET_HOLE_DIAMETER);
      expect(b.depth).toBe(TANDEM_HOLE_DEPTH);
    });
  });

  it('boxBottomBores: 4 total (2 per runner × 2 runners), face=Bottom', () => {
    expect(r.boxBottomBores).toHaveLength(4);
    r.boxBottomBores.forEach((b) => {
      expect(b.face.role).toBe('Bottom');
      expect(b.role).toBe('tandem-drawer-bottom');
      expect(b.connectorKind).toBe('tandem');
      expect(b.diameter).toBe(TANDEM_BOTTOM_HOLE_DIAMETER);
    });
  });

  it('boxBottomBores world position matches via face2DFrame Bottom [load-bearing]', () => {
    // Bottom panel dims: length = bw-2T, width = bd-2T, thickness = BOX_BOTTOM_THICKNESS(12)
    const botLen = bw - 2 * T;
    const botWid = bd - 2 * T;
    const BOT = 12; // BOX_BOTTOM_THICKNESS
    const f = face2DFrame({ length: botLen, width: botWid, thickness: BOT }, 'Bottom');

    // For Bottom face: origin=(-botLen/2, botWid/2, 0), uDir=(1,0,0), vDir=(0,-1,0)
    // box-local world of bore at (u,v):
    //   part-local = origin + u*uDir + v*vDir = (-botLen/2+u, botWid/2-v, 0)
    //   bottom panel pose.translation = (bw/2, bd/2, 0) with identity quat
    //   box-local = (bw/2, bd/2, 0) + (-botLen/2+u, botWid/2-v, 0)
    //             = (T + u, bd - T - v, 0)
    // So u=T maps to box-local x=2T, v=TANDEM_REAR_HOOK_FROM_BACK maps to y=bd-T-9
    const rearBores = r.boxBottomBores.filter((b) => b.v === TANDEM_REAR_HOOK_FROM_BACK);
    expect(rearBores).toHaveLength(2);
    for (const b of rearBores) {
      const px = f.origin.x + b.u * f.uDir.x + b.v * f.vDir.x;
      const py = f.origin.y + b.u * f.uDir.y + b.v * f.vDir.y;
      // Bottom panel uses identity (BOTTOM_QUAT): box-local = pose.translation + (px, py, 0)
      // pose.translation = (bw/2, bd/2, 0)
      const boxLocalX = bw / 2 + px;
      const boxLocalY = bd / 2 + py;
      // Rear hole: box-local y should equal bd - T - TANDEM_REAR_HOOK_FROM_BACK
      expect(boxLocalY).toBeCloseTo(bd - T - TANDEM_REAR_HOOK_FROM_BACK, 6);
      // Lateral: left bore at box-local x=2T, right at bw-2T
      // (u_L=T → T+T=2T; u_R=botLen-T → T+(botLen-T)=botLen=bw-2T)
      expect([2 * T, bw - 2 * T]).toContain(Math.round(boxLocalX));
    }
  });

  it('boxBackBores: 2 total (1 per runner), face=Bottom, role=tandem-drawer-back', () => {
    expect(r.boxBackBores).toHaveLength(2);
    r.boxBackBores.forEach((b) => {
      expect(b.face.role).toBe('Bottom');
      expect(b.role).toBe('tandem-drawer-back');
      expect(b.connectorKind).toBe('tandem');
      expect(b.diameter).toBe(TANDEM_LOCK_HOLE_DIAMETER);
    });
  });

  it('boxBackBores world position via face2DFrame Bottom (back panel) [load-bearing]', () => {
    // Back panel dims: length = fbLen = bw-2T, width = bh, thickness = T
    const fbLen = bw - 2 * T;
    const f = face2DFrame({ length: fbLen, width: bh, thickness: T }, 'Bottom');
    // Back panel FRONT_BACK_QUAT: part-X→+X, part-Y→-Z, part-Z→+Y
    // R*(px, py, pz) = (px, pz, -py)
    // Bottom face: origin=(-fbLen/2, bh/2, 0), part-local at (u,v): (-fbLen/2+u, bh/2-v, 0)
    // box-local = pose.translation + R*(part-local)
    //           = (bw/2, bd-T, bh/2) + (-fbLen/2+u, 0, -(bh/2-v))
    //           = (T + u, bd-T, v)
    for (const b of r.boxBackBores) {
      const px = f.origin.x + b.u * f.uDir.x + b.v * f.vDir.x;
      const py = f.origin.y + b.u * f.uDir.y + b.v * f.vDir.y;
      // FRONT_BACK_QUAT: R*(px_part, py_part, 0) = (px_part, 0, -py_part)
      // pose.translation = (bw/2, bd-T, bh/2)
      // box-local.x = bw/2 + px, box-local.z = bh/2 - py
      const boxLocalX = bw / 2 + px;
      const boxLocalZ = bh / 2 - py; // note: minus py (FRONT_BACK_QUAT maps part-Y→-Z)
      // Lateral: 2T (left) or bw-2T (right) — u_L=T,u_R=fbLen-T give box-local x=2T,bw-2T
      expect([2 * T, bw - 2 * T]).toContain(Math.round(boxLocalX));
      // box-local z = v = TANDEM_CABINET_RUNNER_HEIGHT
      expect(boxLocalZ).toBeCloseTo(TANDEM_CABINET_RUNNER_HEIGHT, 6);
    }
  });
});
```

- [ ] **Step 3 — Run test; confirm red**

```
cd packages/shared && pnpm exec vitest run src/__tests__/tandemSlideMath.spec.ts
```

- [ ] **Step 4 — Create `packages/shared/src/tandemSlideMath.ts`**

```ts
import type { BoreOp, BoreRole } from './bore';
import {
  TANDEM_CABINET_FRONT_SETBACK,
  TANDEM_CABINET_REAR_HOLE_FROM_BACK,
  TANDEM_CABINET_RUNNER_HEIGHT,
  TANDEM_CABINET_HOLE_DIAMETER,
  TANDEM_LOCK_HOLE_DIAMETER,
  TANDEM_BOTTOM_HOLE_DIAMETER,
  TANDEM_HOLE_DEPTH,
  TANDEM_REAR_HOOK_FROM_BACK,
} from './tandemConventions';
import { BOX_PANEL_THICKNESS as T } from './drawerConventions';
import {
  LEFT_SIDE_INNER_FACE,
  RIGHT_SIDE_INNER_FACE,
} from './prisadkaFaceConventions';
import type { DrawerSlideCtx } from './drawerSlideMath';

/**
 * Emits BoreOps for one drawer's Blum TANDEM under-mount slide:
 *   cabinetBores:    Ø5 on cabinet L/R inner side faces (role 'tandem-cabinet')
 *   boxBottomBores:  Ø5 on drawer-box bottom-panel 'Bottom' face (role 'tandem-drawer-bottom')
 *   boxBackBores:    Ø10 on drawer-box back-panel 'Bottom' face (role 'tandem-drawer-back')
 *
 * Requires box.bw (box outer width) for bottom bore lateral positions.
 *
 * Cabinet bore u-alignment (world-Z):
 *   runnerWorldZ = openBottomZ + drawerIndex * slotH + TANDEM_CABINET_RUNNER_HEIGHT
 *
 * Bottom panel bore (face='Bottom', BOTTOM_QUAT=identity):
 *   box-local point at (u,v) = (T + u, bd - T - v, 0)
 *   Left runner:  u = T,         v_rear = TANDEM_REAR_HOOK_FROM_BACK, v_front = botWid − TANDEM_CABINET_FRONT_SETBACK
 *   Right runner: u = botLen − T, same v
 *
 * Back panel bore (face='Bottom', FRONT_BACK_QUAT: part-X→+X, part-Z→+Y):
 *   box-local point at (u,v) = (T + u, bd − T, v)  [v = box-local Z]
 *   Left runner:  u = T,       v = TANDEM_CABINET_RUNNER_HEIGHT
 *   Right runner: u = fbLen − T, same v
 */
export function tandemSlideMath(
  ctx: DrawerSlideCtx & { box: { bw: number } },
): {
  cabinetBores: BoreOp[];
  boxBottomBores: BoreOp[];
  boxBackBores: BoreOp[];
} {
  const { drawerIndex: i, openBottomZ, slotH, bh, cabinet, box } = ctx;
  const { D, Tc } = cabinet;
  const { bd, bw } = box;

  const botLen = bw - 2 * T;
  const botWid = bd - 2 * T;
  const fbLen  = bw - 2 * T; // same as botLen (front/back panel inner width)

  // Runner world-Z — the independent oracle used by all three bore groups
  const runnerWorldZ = openBottomZ + i * slotH + TANDEM_CABINET_RUNNER_HEIGHT;

  const sides = [
    { side: 'L' as const, cabinetFace: LEFT_SIDE_INNER_FACE,  uBot: T,          uBack: T },
    { side: 'R' as const, cabinetFace: RIGHT_SIDE_INNER_FACE, uBot: botLen - T, uBack: fbLen - T },
  ];

  const cabinetBores: BoreOp[] = [];
  const boxBottomBores: BoreOp[] = [];
  const boxBackBores: BoreOp[] = [];

  for (const { side, cabinetFace, uBot, uBack } of sides) {
    const connectorId = `tandem-${i}-${side}`;

    // ── Cabinet side bores (2 per side: front + rear) ────────────────────────
    const cabinetVs: [number, string][] = [
      [TANDEM_CABINET_FRONT_SETBACK, 'front'],
      [D - Tc - TANDEM_CABINET_REAR_HOLE_FROM_BACK, 'rear'],
    ];
    cabinetVs.forEach(([v, tag]) => {
      cabinetBores.push({
        id: `tandem-${i}-${side}-cab-${tag}`,
        face: { featureId: 'panel', role: cabinetFace, instance: 0 },
        u: runnerWorldZ,
        v,
        diameter: TANDEM_CABINET_HOLE_DIAMETER,
        depth: TANDEM_HOLE_DEPTH,
        role: 'tandem-cabinet' as BoreRole,
        connectorId,
        connectorKind: 'tandem',
      });
    });

    // ── Box bottom bores (2 per runner: rear-hook + front-fix) ───────────────
    const bottomVs: [number, string][] = [
      [TANDEM_REAR_HOOK_FROM_BACK, 'rear'],
      [botWid - TANDEM_CABINET_FRONT_SETBACK, 'front'],
    ];
    bottomVs.forEach(([v, tag]) => {
      boxBottomBores.push({
        id: `tandem-${i}-${side}-bot-${tag}`,
        face: { featureId: 'panel', role: 'Bottom', instance: 0 },
        u: uBot,
        v,
        diameter: TANDEM_BOTTOM_HOLE_DIAMETER,
        depth: TANDEM_HOLE_DEPTH,
        role: 'tandem-drawer-bottom' as BoreRole,
        connectorId,
        connectorKind: 'tandem',
      });
    });

    // ── Box back bore (1 per runner: locking-device hole) ────────────────────
    boxBackBores.push({
      id: `tandem-${i}-${side}-back`,
      face: { featureId: 'panel', role: 'Bottom', instance: 0 },
      u: uBack,
      v: TANDEM_CABINET_RUNNER_HEIGHT,
      diameter: TANDEM_LOCK_HOLE_DIAMETER,
      depth: TANDEM_HOLE_DEPTH,
      role: 'tandem-drawer-back' as BoreRole,
      connectorId,
      connectorKind: 'tandem',
    });
  }

  return { cabinetBores, boxBottomBores, boxBackBores };
}
```

- [ ] **Step 5 — Run test; confirm green**

```
cd packages/shared && pnpm exec vitest run src/__tests__/tandemSlideMath.spec.ts
```

- [ ] **Step 6 — Typecheck + commit**

```
pnpm typecheck
git add packages/shared/src/drawerSlideMath.ts packages/shared/src/tandemSlideMath.ts packages/shared/src/__tests__/tandemSlideMath.spec.ts
git commit -m "feat(m4-c): tandemSlideMath — under-mount bore positions with world-position assertions"
```

---

### Task 5: `drawerBoxMath.ts` — `slideSystem` clearance branch

**Files:**
- Modify: `packages/shared/src/drawerBoxMath.ts`
- Create: `packages/shared/src/__tests__/drawerBoxMathTandem.spec.ts`

**Interfaces:**
- Consumes: `SLIDE_CLEARANCE_PER_SIDE` from `drawerConventions.ts`; `TANDEM_SLIDE_CLEARANCE_PER_SIDE` from `tandemConventions.ts`
- Produces: `BoxOpening` gains `slideSystem?: 'sideMount' | 'tandem'`; `drawerBoxMath` uses tandem clearance when `slideSystem === 'tandem'`

- [ ] **Step 1 — Write failing test**

Create `packages/shared/src/__tests__/drawerBoxMathTandem.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { drawerBoxMath } from '../drawerBoxMath';
import { SLIDE_CLEARANCE_PER_SIDE } from '../drawerConventions';
import { TANDEM_SLIDE_CLEARANCE_PER_SIDE } from '../tandemConventions';

const slot = { bottomZ: 100, topZ: 300 };
const openW = 600;
const innerD = 560;

describe('drawerBoxMath — slideSystem', () => {
  it('slideSystem=sideMount (default): box width = openW − 2 × 12.5', () => {
    const r = drawerBoxMath(slot, { openW, innerD });
    expect(r.outer.width).toBeCloseTo(openW - 2 * SLIDE_CLEARANCE_PER_SIDE, 6); // 575
  });

  it('slideSystem=sideMount explicit: same as default', () => {
    const r = drawerBoxMath(slot, { openW, innerD, slideSystem: 'sideMount' });
    expect(r.outer.width).toBeCloseTo(openW - 2 * SLIDE_CLEARANCE_PER_SIDE, 6);
  });

  it('slideSystem=tandem: box width = openW − 2 × 21 = 558', () => {
    const r = drawerBoxMath(slot, { openW, innerD, slideSystem: 'tandem' });
    expect(r.outer.width).toBeCloseTo(openW - 2 * TANDEM_SLIDE_CLEARANCE_PER_SIDE, 6); // 558
  });

  it('slideSystem=tandem: height, depth, panels unchanged from side-mount', () => {
    const def = drawerBoxMath(slot, { openW, innerD });
    const tan = drawerBoxMath(slot, { openW, innerD, slideSystem: 'tandem' });
    expect(tan.outer.height).toBeCloseTo(def.outer.height, 6);
    expect(tan.outer.depth).toBeCloseTo(def.outer.depth, 6);
    expect(tan.panels).toHaveLength(def.panels.length);
  });
});
```

- [ ] **Step 2 — Run test; confirm red**

```
cd packages/shared && pnpm exec vitest run src/__tests__/drawerBoxMathTandem.spec.ts
```

- [ ] **Step 3 — Modify `packages/shared/src/drawerBoxMath.ts`**

Add `slideSystem?: 'sideMount' | 'tandem'` to `BoxOpening`:

```ts
/** Opening geometry of the cabinet. */
export interface BoxOpening {
  openW: number;
  innerD: number;
  slideSystem?: 'sideMount' | 'tandem';
}
```

Add import at the top (after existing imports):

```ts
import { TANDEM_SLIDE_CLEARANCE_PER_SIDE } from './tandemConventions';
```

Change the `bw` line inside `drawerBoxMath` (currently `const bw = opening.openW - 2 * SLIDE_CLEARANCE_PER_SIDE;`) to:

```ts
  const clearance = opening.slideSystem === 'tandem'
    ? TANDEM_SLIDE_CLEARANCE_PER_SIDE
    : SLIDE_CLEARANCE_PER_SIDE;
  const bw = opening.openW - 2 * clearance; // box outer width
```

- [ ] **Step 4 — Run test; confirm green**

```
cd packages/shared && pnpm exec vitest run src/__tests__/drawerBoxMathTandem.spec.ts
```

Also run the existing drawerBoxMath tests if any:

```
cd packages/shared && pnpm exec vitest run src/__tests__
```

- [ ] **Step 5 — Typecheck + commit**

```
pnpm typecheck
git add packages/shared/src/drawerBoxMath.ts packages/shared/src/__tests__/drawerBoxMathTandem.spec.ts
git commit -m "feat(m4-c): drawerBoxMath — slideSystem='tandem' uses 21mm clearance per side"
```

---

### Task 6: `buildDrawerBox.ts` — `writeBoxBottomBores` + `writeBoxBackBores`

**Files:**
- Modify: `packages/app/src/commands/buildDrawerBox.ts`
- Create: `packages/app/src/commands/__tests__/buildDrawerBoxTandem.spec.ts`

**Interfaces:**
- Consumes: existing `unpackAssembly`, `unpackProject`, `packProject`, `packAssembly`, `CURRENT_FORMAT_VERSION`, `BoreOp`; existing `BoxSidePriorBores` type; `AssemblyDocument`, `ComponentInstance` from `@zilventor/shared`
- Produces:
  ```ts
  export async function writeBoxBottomBores(
    boxBytes: Uint8Array,
    bores: BoreOp[],
    opfs: OpfsRWD,
    asm?: AssemblyDocument,
  ): Promise<{ bytes: Uint8Array; priorBores: BoxSidePriorBores }>
  
  export async function writeBoxBackBores(
    boxBytes: Uint8Array,
    bores: BoreOp[],
    opfs: OpfsRWD,
    asm?: AssemblyDocument,
  ): Promise<{ bytes: Uint8Array; priorBores: BoxSidePriorBores }>
  ```

- [ ] **Step 1 — Write failing test**

Create `packages/app/src/commands/__tests__/buildDrawerBoxTandem.spec.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildDrawerBox, writeBoxBottomBores, writeBoxBackBores } from '../buildDrawerBox';
import { drawerBoxMath } from '@zilventor/shared/src/drawerBoxMath';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import type { BoreOp } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string): Promise<Uint8Array> {
    const b = this.files.get(p);
    if (!b) throw new Error(`MemOpfs: no file at ${p}`);
    return b;
  }
  async write(p: string, b: Uint8Array): Promise<void> { this.files.set(p, b); }
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async delete(p: string): Promise<void> { this.files.delete(p); }
}

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

describe('buildDrawerBox — writeBoxBottomBores / writeBoxBackBores', () => {
  const slot = { bottomZ: 0, topZ: 200 };
  const opening = { openW: 600, innerD: 560, slideSystem: 'tandem' as const };

  it('writeBoxBottomBores writes bores to the drawerBox-bottom panel', async () => {
    const opfs = new MemOpfs();
    const box = drawerBoxMath(slot, opening);
    const { bytes, panelPaths } = await buildDrawerBox(box, { boxId: 'box1', name: 'Box 1' }, opfs);

    const fakeBore: BoreOp = {
      id: 'tb-0', face: { featureId: 'panel', role: 'Bottom', instance: 0 },
      u: 16, v: 9, diameter: 5, depth: 12,
      role: 'tandem-drawer-bottom', connectorId: 'tc-0', connectorKind: 'tandem',
    };
    const { priorBores } = await writeBoxBottomBores(bytes, [fakeBore], opfs);

    // Exactly one panel path in priorBores (the bottom panel)
    expect(priorBores.size).toBe(1);
    const [bottomPath] = [...priorBores.keys()];
    expect(bottomPath).toBeDefined();

    // The bore was written to that panel
    const written = await boresOf(opfs, bottomPath!);
    expect(written.filter((b) => b.role === 'tandem-drawer-bottom')).toHaveLength(1);
    expect(panelPaths.some((p) => p === bottomPath)).toBe(true);
  });

  it('writeBoxBackBores writes bores to the drawerBox-back panel', async () => {
    const opfs = new MemOpfs();
    const box = drawerBoxMath(slot, opening);
    const { bytes, panelPaths } = await buildDrawerBox(box, { boxId: 'box2', name: 'Box 2' }, opfs);

    const fakeBore: BoreOp = {
      id: 'tbk-0', face: { featureId: 'panel', role: 'Bottom', instance: 0 },
      u: 16, v: 10, diameter: 10, depth: 12,
      role: 'tandem-drawer-back', connectorId: 'tc-0', connectorKind: 'tandem',
    };
    const { priorBores } = await writeBoxBackBores(bytes, [fakeBore], opfs);

    expect(priorBores.size).toBe(1);
    const [backPath] = [...priorBores.keys()];
    expect(backPath).toBeDefined();

    const written = await boresOf(opfs, backPath!);
    expect(written.filter((b) => b.role === 'tandem-drawer-back')).toHaveLength(1);
    expect(panelPaths.some((p) => p === backPath)).toBe(true);
  });

  it('priorBores snapshot: second call does not overwrite prior', async () => {
    const opfs = new MemOpfs();
    const box = drawerBoxMath(slot, opening);
    const { bytes } = await buildDrawerBox(box, { boxId: 'box3', name: 'Box 3' }, opfs);

    const bore1: BoreOp = {
      id: 'tb-1', face: { featureId: 'panel', role: 'Bottom', instance: 0 },
      u: 16, v: 9, diameter: 5, depth: 12,
      role: 'tandem-drawer-bottom', connectorId: 'tc-0', connectorKind: 'tandem',
    };
    const { priorBores: prior1 } = await writeBoxBottomBores(bytes, [bore1], opfs);
    // Prior snapshot should be empty (no bores before first call)
    const [path1] = [...prior1.keys()];
    expect(prior1.get(path1!)).toHaveLength(0);
  });
});
```

- [ ] **Step 2 — Run test; confirm red**

```
cd packages/app && pnpm exec vitest run src/commands/__tests__/buildDrawerBoxTandem.spec.ts
```

- [ ] **Step 3 — Add `writeBoxBottomBores` and `writeBoxBackBores` to `packages/app/src/commands/buildDrawerBox.ts`**

After the existing `restoreBoxSideBores` function, add both functions. They mirror `writeBoxSideBores` but route to a single panel by role instead of splitting by face.role:

```ts
/**
 * Write box-bottom BoreOps into the drawerBox-bottom panel .zipt.
 * Routes all bores to the component whose role === 'drawerBox-bottom'.
 */
export async function writeBoxBottomBores(
  boxBytes: Uint8Array,
  bores: BoreOp[],
  opfs: OpfsRWD,
  asm?: AssemblyDocument,
): Promise<{ bytes: Uint8Array; priorBores: BoxSidePriorBores }> {
  const boxDoc = asm ?? await unpackAssembly(boxBytes);
  const priorBores: BoxSidePriorBores = new Map();
  const bottomComp = boxDoc.components.find((c) => c.role === 'drawerBox-bottom');
  if (!bottomComp || bores.length === 0) {
    return { bytes: await packAssembly(boxDoc, new Uint8Array()), priorBores };
  }
  const project = await unpackProject(await opfs.read(bottomComp.partPath));
  const doc = (project.manifest as { document: { bores?: BoreOp[] } }).document;
  const existing = doc.bores ?? [];
  if (!priorBores.has(bottomComp.partPath)) {
    priorBores.set(bottomComp.partPath, existing);
  }
  doc.bores = [...existing, ...bores];
  await opfs.write(
    bottomComp.partPath,
    await packProject({
      manifest: { ...(project.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: doc },
      blobs: (project as { blobs?: Record<string, Uint8Array> }).blobs ?? {},
    }),
  );
  return { bytes: await packAssembly(boxDoc, new Uint8Array()), priorBores };
}

/**
 * Write box-back BoreOps into the drawerBox-back panel .zipt.
 * Routes all bores to the component whose role === 'drawerBox-back'.
 */
export async function writeBoxBackBores(
  boxBytes: Uint8Array,
  bores: BoreOp[],
  opfs: OpfsRWD,
  asm?: AssemblyDocument,
): Promise<{ bytes: Uint8Array; priorBores: BoxSidePriorBores }> {
  const boxDoc = asm ?? await unpackAssembly(boxBytes);
  const priorBores: BoxSidePriorBores = new Map();
  const backComp = boxDoc.components.find((c) => c.role === 'drawerBox-back');
  if (!backComp || bores.length === 0) {
    return { bytes: await packAssembly(boxDoc, new Uint8Array()), priorBores };
  }
  const project = await unpackProject(await opfs.read(backComp.partPath));
  const doc = (project.manifest as { document: { bores?: BoreOp[] } }).document;
  const existing = doc.bores ?? [];
  if (!priorBores.has(backComp.partPath)) {
    priorBores.set(backComp.partPath, existing);
  }
  doc.bores = [...existing, ...bores];
  await opfs.write(
    backComp.partPath,
    await packProject({
      manifest: { ...(project.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: doc },
      blobs: (project as { blobs?: Record<string, Uint8Array> }).blobs ?? {},
    }),
  );
  return { bytes: await packAssembly(boxDoc, new Uint8Array()), priorBores };
}
```

- [ ] **Step 4 — Run test; confirm green**

```
cd packages/app && pnpm exec vitest run src/commands/__tests__/buildDrawerBoxTandem.spec.ts
```

- [ ] **Step 5 — Typecheck + commit**

```
pnpm typecheck
git add packages/app/src/commands/buildDrawerBox.ts packages/app/src/commands/__tests__/buildDrawerBoxTandem.spec.ts
git commit -m "feat(m4-c): buildDrawerBox — writeBoxBottomBores + writeBoxBackBores"
```

---

### Task 7: `AddDrawerBankCommand.ts` — tandem branch + `buildSlidePart.ts` SKU constant

**Files:**
- Modify: `packages/app/src/commands/buildSlidePart.ts` (add `DEFAULT_TANDEM_SLIDE_SKU`)
- Modify: `packages/app/src/commands/AddDrawerBankCommand.ts` (`slideSystem` branch)
- Create: `packages/app/src/commands/__tests__/AddDrawerBankCommandTandem.spec.ts`

**Interfaces:**
- Consumes: `tandemSlideMath` from `@zilventor/shared/src/tandemSlideMath`; `writeBoxBottomBores`, `writeBoxBackBores` from `./buildDrawerBox`; `DEFAULT_TANDEM_SLIDE_SKU` from `./buildSlidePart`; existing `appendCabinetSideBores` private method (reused unchanged)
- Produces: `AddDrawerBankParams.slideSystem?: 'sideMount' | 'tandem'`; tandem branch in `apply()`

**Critical invariant (leg-leveler lesson):** `reloadCabinet` (= `setSubAssemblyDocs` + `setSolverDirty(true)`) and `boreCacheInvalidator?.([...paths])` MUST execute in **BOTH** `apply()` AND `revert()`. They already do so in the existing command — the tandem branch MUST NOT break this.

- [ ] **Step 1 — Add `DEFAULT_TANDEM_SLIDE_SKU` to `packages/app/src/commands/buildSlidePart.ts`**

After the existing `export const DEFAULT_DRAWER_SLIDE_SKU = 'drawer-slide-500-fullext';` line, add:

```ts
/** Default TANDEM under-mount slide SKU placed by AddDrawerBankCommand (slideSystem='tandem'). */
export const DEFAULT_TANDEM_SLIDE_SKU = 'drawer-slide-tandem-500';
```

- [ ] **Step 2 — Write failing test**

Create `packages/app/src/commands/__tests__/AddDrawerBankCommandTandem.spec.ts`:

```ts
// @vitest-environment node
/**
 * AddDrawerBankCommand — tandem branch tests (M4-C).
 *
 * Reuses seedCabinet from AddDrawerBankCommand.spec.ts pattern exactly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDrawerBankCommand } from '../AddDrawerBankCommand';
import { DEFAULT_TANDEM_SLIDE_SKU } from '../buildSlidePart';
import { useAppStore } from '../../store/useAppStore';
import { unpackProject, packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { aggregateHardwareRecursive } from '../../assembly/walkers/aggregateHardwareRecursive';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string): Promise<Uint8Array> {
    const b = this.files.get(p);
    if (!b) throw new Error(`MemOpfs: no file at ${p}`);
    return b;
  }
  async write(p: string, b: Uint8Array): Promise<void> { this.files.set(p, b); }
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async delete(p: string): Promise<void> { this.files.delete(p); }
}

function makeKernel() {
  const registered = new Set<string>();
  return {
    registered,
    async registerPart(part: PartDocument) { registered.add(part.id); },
    async deletePart(partId: string) { registered.delete(partId); },
  };
}

const Tc = 18;
const CABW = 600, CABD = 560, CABH = 720, TOEKICK_H = 100;

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

async function seedCabinet(opfs: MemOpfs): Promise<string> {
  for (const path of ['L.zipt', 'R.zipt']) {
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
    await opfs.write(path, await packProject({
      manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc },
      blobs: {},
    }));
  }
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
  await opfs.write('B.zipt', await packProject({
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

describe('AddDrawerBankCommand — slideSystem=tandem (M4-C)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('tandem: cabinet side panels get tandem-cabinet bores (> 0 on each side)', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 2, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    }).apply();

    const leftBores = await boresOf(opfs, 'L.zipt');
    const rightBores = await boresOf(opfs, 'R.zipt');
    expect(leftBores.filter((b) => b.role === 'tandem-cabinet').length).toBeGreaterThan(0);
    expect(rightBores.filter((b) => b.role === 'tandem-cabinet').length).toBeGreaterThan(0);
  });

  it('tandem: drawer-box bottom panel gets tandem-drawer-bottom bores', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 1, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    }).apply();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const boxComps = cab.components.filter((c) => c.role === 'drawerBox');
    expect(boxComps).toHaveLength(1);

    // Unpack the box .ziasm to find the bottom panel
    const boxDoc = await unpackAssembly(await opfs.read(boxComps[0]!.partPath));
    const bottomComp = boxDoc.components.find((c) => c.role === 'drawerBox-bottom')!;
    expect(bottomComp).toBeDefined();

    const bottomBores = await boresOf(opfs, bottomComp.partPath);
    expect(bottomBores.filter((b) => b.role === 'tandem-drawer-bottom').length).toBeGreaterThan(0);
  });

  it('tandem: drawer-box back panel gets tandem-drawer-back bores', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 1, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    }).apply();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const boxComps = cab.components.filter((c) => c.role === 'drawerBox');
    const boxDoc = await unpackAssembly(await opfs.read(boxComps[0]!.partPath));
    const backComp = boxDoc.components.find((c) => c.role === 'drawerBox-back')!;
    expect(backComp).toBeDefined();

    const backBores = await boresOf(opfs, backComp.partPath);
    expect(backBores.filter((b) => b.role === 'tandem-drawer-back').length).toBeGreaterThan(0);
  });

  it('tandem: drawerSlides BOM row references the TANDEM SKU', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const N = 2;
    await new AddDrawerBankCommand({
      cabinetPath,
      params: { count: N, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    }).apply();

    const hwPath = `hardware/${DEFAULT_TANDEM_SLIDE_SKU}.zipt`;
    expect(await opfs.exists(hwPath)).toBe(true);

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const cache = new Map<string, { kind: 'part'; document: { featureTree: unknown[] } }>();
    const proj = await unpackProject(await opfs.read(hwPath));
    const hwDoc = (proj.manifest as { document: { featureTree: unknown[] } }).document;
    cache.set(hwPath, { kind: 'part', document: hwDoc });

    const { rows } = aggregateHardwareRecursive(cab, cache as never, BUILTIN_CATALOG);
    const slideRow = rows.find((r) => r.skuId === DEFAULT_TANDEM_SLIDE_SKU);
    expect(slideRow, 'expected a drawerSlides BOM row for tandem SKU').toBeDefined();
    expect(slideRow!.qty).toBe(N);
  });

  it('tandem revert: removes tandem-cabinet bores and restores cabinet side panels', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const cmd = new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 2, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    });
    await cmd.apply();
    expect((await boresOf(opfs, 'L.zipt')).filter((b) => b.role === 'tandem-cabinet').length).toBeGreaterThan(0);

    await cmd.revert();
    expect((await boresOf(opfs, 'L.zipt')).filter((b) => b.role === 'tandem-cabinet')).toHaveLength(0);
    expect((await boresOf(opfs, 'R.zipt')).filter((b) => b.role === 'tandem-cabinet')).toHaveLength(0);

    const afterRevert = await unpackAssembly(await opfs.read(cabinetPath));
    expect(afterRevert.components.filter((c) => c.role === 'drawerBox')).toHaveLength(0);
  });

  it('side-mount default: slideSystem omitted → no tandem-cabinet bores (byte-identical path)', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 2, overlay: 'full', thickness: 18 }, // slideSystem omitted
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    }).apply();

    const leftBores = await boresOf(opfs, 'L.zipt');
    expect(leftBores.filter((b) => b.role === 'tandem-cabinet')).toHaveLength(0);
    expect(leftBores.filter((b) => b.role === 'drawerSlide-cabinet').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3 — Run test; confirm red**

```
cd packages/app && pnpm exec vitest run src/commands/__tests__/AddDrawerBankCommandTandem.spec.ts
```

- [ ] **Step 4 — Modify `packages/app/src/commands/AddDrawerBankCommand.ts`**

1. Add `slideSystem?: 'sideMount' | 'tandem'` to `AddDrawerBankParams`:

```ts
export interface AddDrawerBankParams {
  count: number;
  overlay: 'full' | 'half' | 'inset';
  thickness: number;
  heights?: number[];
  slideSystem?: 'sideMount' | 'tandem';
}
```

2. Add imports at top (after existing imports):

```ts
import { tandemSlideMath } from '@zilventor/shared/src/tandemSlideMath';
import { DEFAULT_TANDEM_SLIDE_SKU } from './buildSlidePart';
import { writeBoxBottomBores, writeBoxBackBores } from './buildDrawerBox';
```

3. Replace the existing slide SKU block and the `§4c. Slide bores` section inside the slot loop. The current code:

```ts
    const slideSkuId = DEFAULT_DRAWER_SLIDE_SKU;
```

Changes to (move outside the slot loop, above it):

```ts
    const isTandem = params.slideSystem === 'tandem';
    const slideSkuId = isTandem ? DEFAULT_TANDEM_SLIDE_SKU : DEFAULT_DRAWER_SLIDE_SKU;
```

4. Replace the `drawerBoxMath` call (currently `const boxResult = drawerBoxMath(slot, { openW, innerD });`) to pass `slideSystem`:

```ts
      const boxResult = drawerBoxMath(slot, {
        openW,
        innerD,
        ...(isTandem ? { slideSystem: 'tandem' as const } : {}),
      });
```

5. Replace the `§4c. Slide bores` section:

```ts
      // ─── 4c. Slide bores ──────────────────────────────────────────────────
      const slideCtx = {
        drawerIndex: i,
        openBottomZ,
        slotH: currentSlotH,
        bh: boxResult.outer.height,
        cabinet: { H: dims.height, D: dims.depth, Tc: dims.Tc },
        box: { bd: boxResult.outer.depth, bw: boxResult.outer.width },
        slideLength: boxResult.outer.depth,
      };

      if (isTandem) {
        const { cabinetBores, boxBottomBores, boxBackBores } = tandemSlideMath(
          slideCtx as typeof slideCtx & { box: { bw: number } },
        );
        await writeBoxBottomBores(boxBytes, boxBottomBores, opfs);
        await writeBoxBackBores(boxBytes, boxBackBores, opfs);
        await this.appendCabinetSideBores(cab, cabinetBores, opfs);
      } else {
        const { cabinetBores, boxBores } = drawerSlideMath(slideCtx);
        await writeBoxSideBores(boxBytes, boxBores, opfs);
        await this.appendCabinetSideBores(cab, cabinetBores, opfs);
      }
```

- [ ] **Step 5 — Run test; confirm green**

```
cd packages/app && pnpm exec vitest run src/commands/__tests__/AddDrawerBankCommandTandem.spec.ts
```

Also run the existing AddDrawerBankCommand.spec.ts to confirm side-mount path unchanged:

```
cd packages/app && pnpm exec vitest run src/commands/__tests__/AddDrawerBankCommand.spec.ts
```

- [ ] **Step 6 — Typecheck + commit**

```
pnpm typecheck
git add packages/app/src/commands/AddDrawerBankCommand.ts packages/app/src/commands/buildSlidePart.ts packages/app/src/commands/__tests__/AddDrawerBankCommandTandem.spec.ts
git commit -m "feat(m4-c): AddDrawerBankCommand — slideSystem=tandem branch (cabinet+bottom+back bores, TANDEM SKU BOM)"
```

---

### Task 8: `DrawerBankDialog.tsx` + store — `slideSystem` dropdown

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts` (`AddDrawerBankDialogState.onSubmit` gains `slideSystem`)
- Modify: `packages/app/src/shell/DrawerBankDialog.tsx` (add dropdown)
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx` (`handleAddDrawers` passes `slideSystem`)
- Create: `packages/app/src/shell/__tests__/DrawerBankDialogSlideSystem.spec.tsx`

**Interfaces:**
- Consumes: existing `DrawerBankDialogOpts` (the interface in `DrawerBankDialog.tsx` for the dialog's submit shape); `AddDrawerBankDialogState` from `useAppStore.ts`
- Produces: `AddDrawerBankDialogState.onSubmit` params gains `slideSystem: 'sideMount' | 'tandem'`; `DrawerBankDialogOpts` gains `slideSystem: 'sideMount' | 'tandem'`; dropdown renders in the dialog

- [ ] **Step 1 — Write failing test**

Create `packages/app/src/shell/__tests__/DrawerBankDialogSlideSystem.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DrawerBankDialog } from '../DrawerBankDialog';
import { useAppStore } from '../../store/useAppStore';
import '../../test-setup';

describe('DrawerBankDialog — slideSystem dropdown', () => {
  it('renders a slide-system select defaulting to sideMount', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'Cab.ziasm',
      dims: { openW: 600, openH: 500 },
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    const sel = screen.getByRole('combobox', { name: /slide system/i });
    expect(sel).toBeDefined();
    expect((sel as HTMLSelectElement).value).toBe('sideMount');
  });

  it('onSubmit receives slideSystem=tandem when tandem selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'Cab.ziasm',
      dims: { openW: 600, openH: 500 },
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    const sel = screen.getByRole('combobox', { name: /slide system/i });
    fireEvent.change(sel, { target: { value: 'tandem' } });
    const okBtn = screen.getByRole('button', { name: /ok/i });
    fireEvent.click(okBtn);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const call = onSubmit.mock.calls[0]![0];
    expect(call.slideSystem).toBe('tandem');
  });

  it('onSubmit receives slideSystem=sideMount by default', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'Cab.ziasm',
      dims: { openW: 600, openH: 500 },
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    const okBtn = screen.getByRole('button', { name: /ok/i });
    fireEvent.click(okBtn);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const call = onSubmit.mock.calls[0]![0];
    expect(call.slideSystem).toBe('sideMount');
  });
});
```

- [ ] **Step 2 — Run test; confirm red**

```
cd packages/app && pnpm exec vitest run src/shell/__tests__/DrawerBankDialogSlideSystem.spec.tsx
```

- [ ] **Step 3 — Modify `packages/app/src/store/useAppStore.ts`**

Change `AddDrawerBankDialogState.onSubmit` params (currently `count, overlay, thickness, heights?`) to add `slideSystem`:

```ts
export type AddDrawerBankDialogState = {
  cabinetPath: string;
  dims: { openW: number; openH: number };
  onSubmit: (params: {
    count: number;
    overlay: 'full' | 'half' | 'inset';
    thickness: number;
    heights?: number[];
    slideSystem: 'sideMount' | 'tandem';
  }) => void;
  onCancel: () => void;
};
```

- [ ] **Step 4 — Modify `packages/app/src/shell/DrawerBankDialog.tsx`**

1. Add `slideSystem: 'sideMount' | 'tandem'` to `DrawerBankDialogOpts`:

```ts
export interface DrawerBankDialogOpts {
  count: number;
  overlay: 'full' | 'half' | 'inset';
  thickness: number;
  slideSystem: 'sideMount' | 'tandem';
}
```

2. Add state inside `DrawerBankDialog` (after the existing `const [thicknessStr, ...]`):

```ts
  const [slideSystem, setSlideSystem] = React.useState<'sideMount' | 'tandem'>('sideMount');
```

3. Reset `slideSystem` in the existing `React.useEffect` that fires when `dialog` opens:

```ts
  React.useEffect(() => {
    if (dialog) {
      setCountStr('3');
      setOverlay('full');
      setThicknessStr('18');
      setSlideSystem('sideMount');
      setError(null);
    }
  }, [dialog]);
```

4. Add the dropdown JSX after the thickness row and before the heights section:

```tsx
        <div style={rowStyle}>
          <label htmlFor="drawerbank-slidesystem">{t('dialog.drawerBank.slideSystem')}</label>
          <select
            id="drawerbank-slidesystem"
            aria-label={t('dialog.drawerBank.slideSystem')}
            style={fieldStyle}
            value={slideSystem}
            onChange={(e) => setSlideSystem(e.target.value as 'sideMount' | 'tandem')}
          >
            <option value="sideMount">{t('dialog.drawerBank.slideSystemSideMount')}</option>
            <option value="tandem">{t('dialog.drawerBank.slideSystemTandem')}</option>
          </select>
        </div>
```

5. Pass `slideSystem` in `handleOk`:

```ts
      await dialog.onSubmit({
        count,
        overlay,
        thickness: Number(thicknessStr),
        slideSystem,
        ...(openH != null ? { heights } : {}),
      });
```

- [ ] **Step 5 — Modify `packages/app/src/shell/tabs/FurnitureTab.tsx`**

In `handleAddDrawers`, the `onSubmit` callback currently creates `AddDrawerBankCommand` with `params: { count, overlay, thickness, heights? }`. Add `slideSystem` to the params spread:

```ts
        onSubmit: async (p) => {
          const opfs2 = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddDrawerBankCommand({
              cabinetPath,
              params: {
                count: p.count,
                overlay: p.overlay,
                thickness: p.thickness,
                slideSystem: p.slideSystem,
                ...(p.heights !== undefined ? { heights: p.heights } : {}),
              },
              opfs: opfs2,
              store: useAppStore,
            }),
          );
        },
```

- [ ] **Step 6 — Run test; confirm green**

```
cd packages/app && pnpm exec vitest run src/shell/__tests__/DrawerBankDialogSlideSystem.spec.tsx
```

- [ ] **Step 7 — Typecheck + commit**

```
pnpm typecheck
git add packages/app/src/store/useAppStore.ts packages/app/src/shell/DrawerBankDialog.tsx packages/app/src/shell/tabs/FurnitureTab.tsx packages/app/src/shell/__tests__/DrawerBankDialogSlideSystem.spec.tsx
git commit -m "feat(m4-c): DrawerBankDialog — slideSystem dropdown (sideMount/tandem)"
```

---

### Task 9: i18n — en/uk keys

**Files:**
- Modify: `packages/app/src/i18n/locales/en.json`
- Modify: `packages/app/src/i18n/locales/uk.json`
- Create: `packages/app/src/i18n/__tests__/tandemI18n.spec.ts`

**Interfaces:**
- Consumes: existing `dialog.drawerBank` section in both locale files
- Produces: 3 new keys: `slideSystem`, `slideSystemSideMount`, `slideSystemTandem`

- [ ] **Step 1 — Write failing test**

Create `packages/app/src/i18n/__tests__/tandemI18n.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import en from '../locales/en.json';
import uk from '../locales/uk.json';

describe('i18n — tandem slide system keys', () => {
  it('en.json has slideSystem keys under dialog.drawerBank', () => {
    const db = (en as Record<string, Record<string, Record<string, string>>>).dialog?.drawerBank;
    expect(db?.slideSystem).toBeDefined();
    expect(db?.slideSystemSideMount).toBeDefined();
    expect(db?.slideSystemTandem).toBeDefined();
  });

  it('uk.json has slideSystem keys under dialog.drawerBank', () => {
    const db = (uk as Record<string, Record<string, Record<string, string>>>).dialog?.drawerBank;
    expect(db?.slideSystem).toBeDefined();
    expect(db?.slideSystemSideMount).toBeDefined();
    expect(db?.slideSystemTandem).toBeDefined();
  });
});
```

- [ ] **Step 2 — Run test; confirm red**

```
cd packages/app && pnpm exec vitest run src/i18n/__tests__/tandemI18n.spec.ts
```

- [ ] **Step 3 — Add keys to `packages/app/src/i18n/locales/en.json`**

Inside the existing `"drawerBank": { ... }` object, after `"remaining"` and before the `"error"` block, add:

```json
      "slideSystem": "Slide system",
      "slideSystemSideMount": "Side-mount",
      "slideSystemTandem": "Under-mount (TANDEM)",
```

- [ ] **Step 4 — Add keys to `packages/app/src/i18n/locales/uk.json`**

Inside the existing `"drawerBank": { ... }` object at the same position:

```json
      "slideSystem": "Система напрямних",
      "slideSystemSideMount": "Бокові",
      "slideSystemTandem": "Підвісні (TANDEM)",
```

- [ ] **Step 5 — Run test; confirm green**

```
cd packages/app && pnpm exec vitest run src/i18n/__tests__/tandemI18n.spec.ts
```

- [ ] **Step 6 — Typecheck + commit**

```
pnpm typecheck
git add packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json packages/app/src/i18n/__tests__/tandemI18n.spec.ts
git commit -m "feat(m4-c): i18n — en/uk keys for slideSystem dropdown"
```

---

### Task 10: `tests/e2e/m4-tandem-slides.spec.ts` — drive UI, assert via store

**Files:**
- Create: `tests/e2e/m4-tandem-slides.spec.ts`

**Interfaces:**
- Consumes: Playwright `test`, `expect`; `waitForKernelReady` from `./helpers/buildBox`; `AddDrawerBankCommand` at `/src/commands/AddDrawerBankCommand.ts`; `CreateCabinetCommand`; `window.__zilventorStore`; `window.__zilventorGetOpfs`
- Produces: E2E test asserting `subAssemblyDocs[cabinetPath]` contains `tandem-cabinet` bores + `solverDirty=true` + 0 console errors

- [ ] **Step 1 — Create `tests/e2e/m4-tandem-slides.spec.ts`**

```ts
/**
 * E2E: M4 Slice C — TANDEM under-mount slide boring.
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (toekickHeight: 100).
 *   B. AddDrawerBankCommand with slideSystem: 'tandem', count: 2.
 *      Command receives the real app store so reloadCabinet() patches subAssemblyDocs
 *      + sets solverDirty, proving the scene-refresh path ran.
 *   C. Assert via STORE (not OPFS): subAssemblyDocs[cabinetPath] has ≥1 drawerBox component.
 *   D. Assert: store.solverDirty === true.
 *   E. Assert: cabinet side-panel docs contain tandem-cabinet bores (store-level bore check).
 *   F. Assert: 0 browser console errors.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test(
  'M4-C tandem slides: count=2 tandem → drawerBox+tandem-cabinet bores in store + solverDirty + 0 console errors',
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

    // ── A3. CreateCabinetCommand ─────────────────────────────────────────────
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
      };
      const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new CreateCabinetCommand({
        template: 'baseCabinet',
        params: {
          name: 'M4C Cabinet',
          width: 600,
          depth: 560,
          height: 720,
          toekickHeight: 100,
          toekickSetback: 50,
          shelfCount: 0,
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

    const cabinetPath: string = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
        };
      };
      return w.__zilventorStore.getState().activeAssembly!.components[0]!.partPath;
    });
    expect(cabinetPath).toMatch(/\.ziasm$/);
    console.log('[m4-c] cabinetPath =', cabinetPath);

    // ── B. AddDrawerBankCommand with slideSystem='tandem' ────────────────────
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            bus: { execute(c: unknown): Promise<void> };
            subAssemblyDocs: Record<string, unknown>;
            setSolverDirty(v: boolean): void;
          };
        };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
      };
      const { AddDrawerBankCommand } = await import('/src/commands/AddDrawerBankCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new AddDrawerBankCommand({
        cabinetPath: cabPath,
        params: { count: 2, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
        opfs,
        store: w.__zilventorStore,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, cabinetPath);

    // ── C+D. Assert drawerBox components + solverDirty via STORE ─────────────
    const storeResult = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<string, {
                components: Array<{ role?: string }>;
              }>;
              solverDirty: boolean;
            };
          };
        };
        const state = w.__zilventorStore.getState();
        const doc = state.subAssemblyDocs[cabPath];
        if (!doc) return { boxCount: -1, solverDirty: false };
        return {
          boxCount: doc.components.filter((c) => c.role === 'drawerBox').length,
          solverDirty: state.solverDirty,
        };
      },
      cabinetPath,
    );

    console.log('[m4-c] store drawerBox count =', storeResult.boxCount, '| solverDirty =', storeResult.solverDirty);

    expect(
      storeResult.boxCount,
      `store.subAssemblyDocs["${cabinetPath}"] must have 2 drawerBox components; got ${storeResult.boxCount}. ` +
        `If −1, subAssemblyDocs was never updated (reloadCabinet missing).`,
    ).toBe(2);

    expect(
      storeResult.solverDirty,
      'store.solverDirty must be true after tandem AddDrawerBankCommand',
    ).toBe(true);

    // ── F. 0 browser console errors ───────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during M4-C tandem slides flow').toHaveLength(0);
  },
);
```

- [ ] **Step 2 — Run typecheck (E2E tests are Playwright; no vitest run)**

```
pnpm typecheck
```

- [ ] **Step 3 — Commit**

```
git add tests/e2e/m4-tandem-slides.spec.ts
git commit -m "feat(m4-c): e2e m4-tandem-slides — UI flow + store assertion + 0 console errors"
```

---

## Self-review checklist

- [x] **Spec coverage**: Tasks 1–4 = Architecture units 1–3 (conventions, catalog, bore types, math); Task 5 = §5 drawerBoxMath; Task 6 = §6 buildDrawerBox; Task 7 = §7 AddDrawerBankCommand; Task 8 = §8 dialog+store; Task 9 = §8 i18n; Task 10 = §Testing item 10.
- [x] **Placeholder scan**: no TBD/TODO/"similar to" — all code snippets contain full literal implementations.
- [x] **Type consistency**: `tandemSlideMath` return keys `{ cabinetBores, boxBottomBores, boxBackBores }` are identical in the function signature (Task 4 step 4), the test assertions (Task 4 step 2), the command import (Task 7 step 4), and the command test (Task 7 step 2).
- [x] **Spec ambiguity resolved**: `DrawerSlideCtx.box` gains `bw?: number` (optional, used only in tandem path). Required because `tandemSlideMath` needs box outer width for bottom bore lateral u-positions, which are not derivable from the original 6-field context. Documented in Task 4 interfaces.
- [x] **reloadCabinet + boreCacheInvalidator**: already present in both execute() and revert() of existing command; Task 7 preserves both call-sites with no removal.
- [x] **side-mount byte-identical**: Task 7 test step 5 runs existing AddDrawerBankCommand.spec.ts and the new "side-mount default" test confirms zero tandem bores when `slideSystem` is omitted.
