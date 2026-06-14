# Frame Generator slice 1 (wood face frames) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an **Add Face Frame** command that places solid-wood rails + stiles (an equal R×C grid) onto a selected cabinet's front, as role-tagged panel components inside the cabinet `.ziasm`.

**Architecture:** Pure layout math in `packages/shared/src/faceFrameMath.ts` produces `FrameMember[]` (dims + pose). `AddFaceFrameCommand` (app) mirrors `AddDrawerBankCommand`: unpack cabinet → `deriveCabinetDims` → `layoutFaceFrame` → build a panel `PartDocument` per member → write to OPFS → push `ComponentInstance` (role `faceFrameStile`/`faceFrameRail`) → repack. **No kernel change, no WASM rebuild.** All members reuse the proven `DOOR_POSE.quaternion`; only dims + translation differ. Members flow into 3D, cut-list, BOM, DXF, nesting via existing panel infra.

**Tech Stack:** TypeScript monorepo (pnpm), Zustand store, React (dialogs/ribbon), OpenCascade.js kernel (worker), vitest (unit + `*.integration.spec.ts` real-OCCT), Playwright (e2e), react-i18next.

**Spec:** `docs/superpowers/specs/2026-06-14-frame-generator-design.md`

**Reference (read these before starting — the templates this plan mirrors):**
- `packages/app/src/commands/AddDrawerBankCommand.ts` (command apply/revert, `packPanel`, `reloadCabinet`)
- `packages/app/src/commands/AddDoorCommand.ts` (PanelFeature + ComponentInstance construction)
- `packages/app/src/commands/cabinetDims.ts` (`deriveCabinetDims`)
- `packages/shared/src/prisadkaFaceConventions.ts` (`DOOR_POSE`)
- `packages/shared/src/drawerBankLayout.ts` + `packages/shared/src/__tests__/drawerBankLayout.spec.ts` (pure-module house style)
- `packages/shared/src/clash.ts` (`ROLE_IS_CARCASS`)
- `packages/app/src/shell/DrawerBankDialog.tsx`, `packages/app/src/shell/tabs/FurnitureTab.tsx` (dialog + ribbon wiring)
- `packages/app/src/commands/__tests__/AddDrawerBankCommand.spec.ts` (full-AssemblyDocument seed; `MemOpfs`, `makeKernel`)
- `tests/e2e/prisadka-slice4-drawer-banks.spec.ts` (real-browser harness + probes)

**Coordinate convention (load-bearing — confirmed from `prisadkaFaceConventions.ts`):**
`DOOR_POSE` maps a panel part's local axes to world: **part `length` → world Z (up)**, **part `width` → world X (across)**, **part `thickness` → world Y (out the front toward the room)**. Cabinet frame: width `W` along X, height `H` along Z, depth `D` along Y; toekick height `tkH` = z of the carcass box bottom. The face frame spans `x ∈ [0,W]`, `z ∈ [tkH, H]` (excludes toekick), at the front plane `y = D`, sitting proud (`y ∈ [D, D+thickness]`).
- A **stile** (vertical): `length = H−tkH`, `width = stileWidth`, `thickness = t`, grain `'length'`.
- A **rail** (horizontal): `length = railWidth` (short, vertical), `width = openingWidth` (long, horizontal), `thickness = t`, grain `'width'`.
- Member center translation `y = D + t/2` for all members (board fully proud of the carcass front).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/faceFrameConventions.ts` | NEW — numeric defaults (single source) |
| `packages/shared/src/faceFrameMath.ts` | NEW — pure `layoutFaceFrame(params) → FrameMember[]` + degenerate guards |
| `packages/shared/src/__tests__/faceFrameMath.spec.ts` | NEW — unit tests (counts, hand-oracle dims/positions, non-overlap, guards) |
| `packages/shared/src/index.ts` | MODIFY — re-export the two new modules |
| `packages/shared/src/cabinets/types.ts` | MODIFY — add `faceFrameStile`, `faceFrameRail` to `PanelRole` |
| `packages/shared/src/clash.ts` | MODIFY — add the two roles to `ROLE_IS_CARCASS` |
| `packages/shared/src/fileFormat.ts` | MODIFY — bump v25→v26 (additive, no-op migration) |
| `packages/shared/src/types.ts` | MODIFY — extend `ProjectFile` version union to include `26` |
| `packages/shared/src/__tests__/fileFormat.faceFrame.spec.ts` | NEW — v25→v26 migration round-trip test |
| `packages/app/src/commands/AddFaceFrameCommand.ts` | NEW — apply/revert |
| `packages/app/src/commands/__tests__/AddFaceFrameCommand.spec.ts` | NEW — command test (full seed) |
| `packages/kernel/src/__tests__/faceFrameBake.integration.spec.ts` | NEW — real-OCCT dims→solid bake |
| `packages/app/src/store/useAppStore.ts` | MODIFY — `addFaceFrameDialog` state + setter |
| `packages/app/src/shell/FaceFrameDialog.tsx` | NEW — dialog component |
| `packages/app/src/shell/WorkFeatureDialogsHost.tsx` | MODIFY — render `<FaceFrameDialog />` |
| `packages/app/src/shell/tabs/FurnitureTab.tsx` | MODIFY — "Add Face Frame" button + handler |
| `packages/app/src/shell/tabs/__tests__/FurnitureTab.faceFrame.spec.tsx` | NEW — real-handler wiring test (UI false-green guard) |
| `packages/app/src/i18n/locales/en.json`, `uk.json` | MODIFY — UI strings |
| `tests/e2e/face-frame.spec.ts` | NEW — real-browser end-to-end |

---

## Task 1: Shared conventions module

**Files:**
- Create: `packages/shared/src/faceFrameConventions.ts`

- [ ] **Step 1: Write the module** (config constants — TDD-exempt per "trivial config"; sanity-covered by Task 4's tests that import these)

```ts
// packages/shared/src/faceFrameConventions.ts
// Single source of truth for face-frame defaults. No re-declaration elsewhere (git-grep-gated).

/** Default stile (vertical member) width, mm. */
export const DEFAULT_STILE_WIDTH = 38;
/** Default rail (horizontal member) width, mm. */
export const DEFAULT_RAIL_WIDTH = 38;
/** Default face-frame board thickness, mm. */
export const DEFAULT_FRAME_THICKNESS = 19;
```

- [ ] **Step 2: Re-export from the shared barrel**

In `packages/shared/src/index.ts`, add (place next to the other `export * from './drawer...'` lines):

```ts
export * from './faceFrameConventions';
export * from './faceFrameMath';
```

- [ ] **Step 3: Verify it compiles**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: `faceFrameMath` import errors only (module not yet created) — fixed in Task 4. The conventions file itself must not error.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/faceFrameConventions.ts packages/shared/src/index.ts
git commit -m "feat(shared): face-frame default constants module"
```

---

## Task 2: Add the two PanelRole values + classify them in the clash filter

**Files:**
- Modify: `packages/shared/src/cabinets/types.ts:4-17` (PanelRole union)
- Modify: `packages/shared/src/clash.ts:32-48` (`ROLE_IS_CARCASS`)
- Test: `packages/shared/src/__tests__/clash.faceFrame.spec.ts` (new)

- [ ] **Step 1: Add the roles to `PanelRole`**

In `packages/shared/src/cabinets/types.ts`, append to the `PanelRole` union:

```ts
  | 'faceFrameStile'
  | 'faceFrameRail';
```

(They flow into `ComponentInstance.role` automatically — `types.ts:125` is `PanelRole | 'drawerFront' | 'drawerBox' | 'drawerHandle'`, and `clash.ts:22` mirrors `PanelRole | ...`.)

- [ ] **Step 2: Run tsc to verify the compile-guard fires (RED)**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: FAIL — `ROLE_IS_CARCASS` (a `Record<ComponentRole, boolean>`) now errors: `Property 'faceFrameStile' is missing`. This proves the exhaustive guard works.

- [ ] **Step 3: Classify the roles (GREEN)**

In `packages/shared/src/clash.ts`, inside `ROLE_IS_CARCASS`, add (face-frame members sit proud of the carcass front and only touch — like doors, classify `false` = kept):

```ts
  faceFrameStile: false,
  faceFrameRail: false,
```

- [ ] **Step 4: Run tsc (GREEN)**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: PASS (except the `faceFrameMath` not-yet-created import from Task 1's barrel — that resolves in Task 4).

- [ ] **Step 5: Write a clash unit test**

```ts
// packages/shared/src/__tests__/clash.faceFrame.spec.ts
import { describe, it, expect } from 'vitest';
import { CARCASS_ROLES } from '../clash';

describe('clash: face-frame roles', () => {
  it('classifies face-frame members as NON-carcass (kept, like doors)', () => {
    expect(CARCASS_ROLES.has('faceFrameStile')).toBe(false);
    expect(CARCASS_ROLES.has('faceFrameRail')).toBe(false);
    expect(CARCASS_ROLES.has('door')).toBe(false); // sanity: same class as doors
  });
});
```

- [ ] **Step 6: Run the test**

Run: `cd packages/shared && npx vitest run src/__tests__/clash.faceFrame.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/cabinets/types.ts packages/shared/src/clash.ts packages/shared/src/__tests__/clash.faceFrame.spec.ts
git commit -m "feat(shared): faceFrameStile/faceFrameRail roles + clash classification"
```

---

## Task 3: Bump manifest format v25 → v26 (additive, no-op)

> Convention-driven: persisted role-enum extension bumps the format version (matches the v23→v24 "drawer roles" and v24→v25 "drawerHandle role" precedents). The migration is a no-op; the bump documents that v26 files may contain face-frame roles.

**Files:**
- Modify: `packages/shared/src/fileFormat.ts` (4 sites)
- Modify: `packages/shared/src/types.ts:172-175` (`ProjectFile` version union)
- Test: `packages/shared/src/__tests__/fileFormat.faceFrame.spec.ts` (new)

- [ ] **Step 1: Write the failing migration test (RED)**

```ts
// packages/shared/src/__tests__/fileFormat.faceFrame.spec.ts
import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('fileFormat v25→v26 (face-frame roles)', () => {
  it('CURRENT_FORMAT_VERSION is 26', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(26);
  });

  it('migrates a v25 part manifest to v26 without structural change', () => {
    const v25 = {
      formatVersion: 25,
      kind: 'part' as const,
      document: { id: 'p', name: 'p', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [] },
    };
    const out = migrateManifest(v25 as unknown as Parameters<typeof migrateManifest>[0]);
    expect(out.formatVersion).toBe(26);
    expect((out as { document: { id: string } }).document.id).toBe('p');
  });
});
```

- [ ] **Step 2: Run it (RED)**

Run: `cd packages/shared && npx vitest run src/__tests__/fileFormat.faceFrame.spec.ts`
Expected: FAIL — `CURRENT_FORMAT_VERSION` is `25`, and `migrateManifest` throws "newer than CURRENT" or returns `25`.

- [ ] **Step 3: Bump the version + add the migration step**

In `packages/shared/src/fileFormat.ts`:

(a) `fileFormat.ts:4` — change:
```ts
export const CURRENT_FORMAT_VERSION = 26 as const;
```

(b) In the `migrations` record (next to the `24:` entry around `fileFormat.ts:344`), add:
```ts
  // v25 → v26: additive — faceFrameStile/faceFrameRail PanelRole values.
  // All optional role strings; absent === unset at runtime. No structural transformation.
  25: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 26 };
  },
```

(c) In `normalizeKind` (the version allow-list around `fileFormat.ts:355-360`), extend the `m.formatVersion === 25` chain with:
```ts
      || m.formatVersion === 26
```

- [ ] **Step 4: Extend the `ProjectFile` version union**

In `packages/shared/src/types.ts:172-175`, append `| 26` to each `formatVersion` literal union row (part / assembly / drawing) that currently ends at `| 25`.

- [ ] **Step 5: Run the test (GREEN)**

Run: `cd packages/shared && npx vitest run src/__tests__/fileFormat.faceFrame.spec.ts`
Expected: PASS.

- [ ] **Step 6: Run the full fileFormat suite (no regressions)**

Run: `cd packages/shared && npx vitest run src/__tests__/fileFormat`
Expected: PASS (all existing migration tests still green).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/fileFormat.ts packages/shared/src/types.ts packages/shared/src/__tests__/fileFormat.faceFrame.spec.ts
git commit -m "feat(shared): bump format v25→v26 (additive, face-frame roles)"
```

---

## Task 4: `faceFrameMath.ts` — pure layout (the core)

**Files:**
- Create: `packages/shared/src/faceFrameMath.ts`
- Test: `packages/shared/src/__tests__/faceFrameMath.spec.ts`

**Hand-derived oracle** (used in the test — computed independently, NOT by calling the function): cabinet `W=600, H=720, tkH=100, D=560`; `sw=rw=38, t=19`; grid `1×1`. Then `frameW=600, frameH=620`, `ow=(600−2·38)/1=524`, `oh=(620−2·38)/1=544`.
- Stiles (2): dims `{length:620, width:38, thickness:19}`; centers `x=19` and `x=581`; both `y=569.5, z=410`.
- Rails (2): dims `{length:38, width:524, thickness:19}`; both `x=300, y=569.5`; bottom `z=119`, top `z=701`.

- [ ] **Step 1: Write the failing test (RED)**

```ts
// packages/shared/src/__tests__/faceFrameMath.spec.ts
import { describe, it, expect } from 'vitest';
import { layoutFaceFrame, type FaceFrameParams } from '../faceFrameMath';
import { DOOR_POSE } from '../prisadkaFaceConventions';

const BASE: FaceFrameParams = {
  width: 600, height: 720, toekickHeight: 100, depth: 560,
  rows: 1, cols: 1, stileWidth: 38, railWidth: 38, thickness: 19,
};

describe('layoutFaceFrame', () => {
  it('1×1: 2 stiles + 2 rails with hand-derived dims/positions', () => {
    const m = layoutFaceFrame(BASE);
    const stiles = m.filter((x) => x.role === 'faceFrameStile');
    const rails = m.filter((x) => x.role === 'faceFrameRail');
    expect(stiles).toHaveLength(2);
    expect(rails).toHaveLength(2);

    // stile dims + centers (hand oracle)
    stiles.forEach((s) => {
      expect(s.dims).toEqual({ length: 620, width: 38, thickness: 19 });
      expect(s.pose.translation.y).toBeCloseTo(569.5, 6);
      expect(s.pose.translation.z).toBeCloseTo(410, 6);
      expect(s.pose.quaternion).toEqual(DOOR_POSE.quaternion);
    });
    const sx = stiles.map((s) => s.pose.translation.x).sort((a, b) => a - b);
    expect(sx[0]).toBeCloseTo(19, 6);
    expect(sx[1]).toBeCloseTo(581, 6);

    // rail dims + centers (hand oracle)
    rails.forEach((r) => {
      expect(r.dims).toEqual({ length: 38, width: 524, thickness: 19 });
      expect(r.pose.translation.x).toBeCloseTo(300, 6);
      expect(r.pose.translation.y).toBeCloseTo(569.5, 6);
    });
    const rz = rails.map((r) => r.pose.translation.z).sort((a, b) => a - b);
    expect(rz[0]).toBeCloseTo(119, 6);
    expect(rz[1]).toBeCloseTo(701, 6);
  });

  it('member counts generalize: 2×1→5, 1×2→7, 2×2→9', () => {
    expect(layoutFaceFrame({ ...BASE, rows: 2, cols: 1 })).toHaveLength(5);
    expect(layoutFaceFrame({ ...BASE, rows: 1, cols: 2 })).toHaveLength(7);
    expect(layoutFaceFrame({ ...BASE, rows: 2, cols: 2 })).toHaveLength(9);
  });

  it('all members lie within the front rectangle [0,W]×[tkH,H]', () => {
    const m = layoutFaceFrame({ ...BASE, rows: 2, cols: 2 });
    for (const x of m) {
      // half-extents in X (across) = world from width or stileWidth; in Z (up) = length or railWidth
      const hx = (x.role === 'faceFrameStile' ? x.dims.width : x.dims.width) / 2; // X half = part width
      const hz = (x.role === 'faceFrameStile' ? x.dims.length : x.dims.length) / 2; // Z half = part length
      expect(x.pose.translation.x - hx).toBeGreaterThanOrEqual(-1e-6);
      expect(x.pose.translation.x + hx).toBeLessThanOrEqual(600 + 1e-6);
      expect(x.pose.translation.z - hz).toBeGreaterThanOrEqual(100 - 1e-6);
      expect(x.pose.translation.z + hz).toBeLessThanOrEqual(720 + 1e-6);
    }
  });

  it('throws when the opening collapses (too many columns for width)', () => {
    expect(() => layoutFaceFrame({ ...BASE, cols: 20 })).toThrow(/opening collapses/);
  });
  it('throws when the opening collapses (too many rows for height)', () => {
    expect(() => layoutFaceFrame({ ...BASE, rows: 20 })).toThrow(/opening collapses/);
  });
  it('throws on rows/cols < 1', () => {
    expect(() => layoutFaceFrame({ ...BASE, cols: 0 })).toThrow(/≥ 1/);
  });
});
```

- [ ] **Step 2: Run it (RED)**

Run: `cd packages/shared && npx vitest run src/__tests__/faceFrameMath.spec.ts`
Expected: FAIL — `Cannot find module '../faceFrameMath'`.

- [ ] **Step 3: Implement the module**

```ts
// packages/shared/src/faceFrameMath.ts
import { DOOR_POSE } from './prisadkaFaceConventions';

type Vec3 = { x: number; y: number; z: number };
type Quaternion = [number, number, number, number];

export interface FaceFrameParams {
  /** Cabinet outer width (X), mm. */
  width: number;
  /** Cabinet outer height (Z), mm. */
  height: number;
  /** Toekick height — z of the carcass box bottom, mm. */
  toekickHeight: number;
  /** Cabinet depth (Y) — the front plane is at y = depth, mm. */
  depth: number;
  /** Number of opening rows (≥ 1). */
  rows: number;
  /** Number of opening columns (≥ 1). */
  cols: number;
  stileWidth: number;
  railWidth: number;
  thickness: number;
}

export interface FrameMember {
  role: 'faceFrameStile' | 'faceFrameRail';
  /** Panel local dims. DOOR_POSE maps length→Z(up), width→X(across), thickness→Y(front). */
  dims: { length: number; width: number; thickness: number };
  pose: { translation: Vec3; quaternion: Quaternion };
}

/**
 * Lay out an equal R×C wood face frame on a cabinet front.
 * Stiles run continuous full height; rails butt between adjacent stiles. Butt joints (no joinery).
 * All members reuse DOOR_POSE.quaternion (flat boards on the front plane); only dims + translation differ.
 */
export function layoutFaceFrame(p: FaceFrameParams): FrameMember[] {
  const { width: W, height: H, toekickHeight: tkH, depth: D,
    rows, cols, stileWidth: sw, railWidth: rw, thickness: t } = p;
  if (rows < 1 || cols < 1) throw new Error('face frame: rows and cols must be ≥ 1');

  const frameW = W;
  const frameH = H - tkH;
  const ow = (frameW - (cols + 1) * sw) / cols;
  const oh = (frameH - (rows + 1) * rw) / rows;
  if (ow <= 0) throw new Error('face frame: opening collapses — too many columns for the cabinet width');
  if (oh <= 0) throw new Error('face frame: opening collapses — too many rows for the cabinet height');

  const q: Quaternion = DOOR_POSE.quaternion;
  const frontY = D + t / 2; // board sits fully proud of the carcass front
  const members: FrameMember[] = [];

  // Stiles: cols+1 continuous full-height verticals.
  for (let i = 0; i <= cols; i++) {
    const leftEdge = i * (sw + ow);
    members.push({
      role: 'faceFrameStile',
      dims: { length: frameH, width: sw, thickness: t },
      pose: {
        translation: { x: leftEdge + sw / 2, y: frontY, z: tkH + frameH / 2 },
        quaternion: q,
      },
    });
  }

  // Rails: per column, rows+1 horizontals butting between adjacent stiles.
  for (let c = 0; c < cols; c++) {
    const openLeft = c * (sw + ow) + sw;
    const cx = openLeft + ow / 2;
    for (let k = 0; k <= rows; k++) {
      const bottom = k * (rw + oh);
      members.push({
        role: 'faceFrameRail',
        dims: { length: rw, width: ow, thickness: t },
        pose: {
          translation: { x: cx, y: frontY, z: tkH + bottom + rw / 2 },
          quaternion: q,
        },
      });
    }
  }

  return members;
}
```

- [ ] **Step 4: Run the test (GREEN)**

Run: `cd packages/shared && npx vitest run src/__tests__/faceFrameMath.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Run the full shared suite + tsc**

Run: `cd packages/shared && npx vitest run && npx tsc --noEmit`
Expected: PASS, 0 tsc errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/faceFrameMath.ts packages/shared/src/__tests__/faceFrameMath.spec.ts
git commit -m "feat(shared): faceFrameMath layout (R×C grid, butt joints, degenerate guards)"
```

---

## Task 5: `AddFaceFrameCommand` — apply/revert

**Files:**
- Create: `packages/app/src/commands/AddFaceFrameCommand.ts`
- Test: `packages/app/src/commands/__tests__/AddFaceFrameCommand.spec.ts`

> Copy the `packPanel` helper **and its `writeTarGz` import line verbatim** from `AddDrawerBankCommand.ts` (the helper at ~`:431-435` + the import). Copy `reloadCabinet` verbatim. Import `PanelFeature` and `ComponentInstance`, `PartDocument`, `AssemblyDocument` from `@zilventor/shared` (mirror `AddDoorCommand.ts`'s import line if a sub-path is needed).

- [ ] **Step 1: Write the failing command test (RED)**

```ts
// packages/app/src/commands/__tests__/AddFaceFrameCommand.spec.ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { AddFaceFrameCommand } from '../AddFaceFrameCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string): Promise<Uint8Array> { const b = this.files.get(p); if (!b) throw new Error(`no file ${p}`); return b; }
  async write(p: string, b: Uint8Array): Promise<void> { this.files.set(p, b); }
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async delete(p: string): Promise<void> { this.files.delete(p); }
}
function makeKernel() {
  const registered = new Set<string>();
  return { registered, async registerPart(p: PartDocument) { registered.add(p.id); }, async deletePart(id: string) { registered.delete(id); } };
}

// Minimal side/bottom panel parts so deriveCabinetDims succeeds (W=600,H=720,D=560,Tc=18,tkH=100).
function panelPart(id: string, length: number, width: number, thickness: number): PartDocument {
  return { id, name: id, units: 'mm', parameters: {},
    featureTree: [{ kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: length }, width: { kind: 'literal', value: width },
      thickness: { kind: 'literal', value: thickness }, thicknessFromMaterial: false,
      materialId: 'm', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null } }],
    properties: {}, materials: [{ id: 'm', name: 'MDF', defaultThickness: 18, color: '#ccc' }], hardware: [] } as unknown as PartDocument;
}

async function seedCabinet(opfs: MemOpfs): Promise<string> {
  const cabinetPath = 'proj/cab1.ziasm';
  const leftPath = 'proj/cab-left.zipt';
  const rightPath = 'proj/cab-right.zipt';
  const bottomPath = 'proj/cab-bottom.zipt';
  const part = (id: string, l: number, w: number, t: number) =>
    packProject({ manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part', document: panelPart(id, l, w, t) }, blobs: {} });
  await opfs.write(leftPath, await part('left', 720, 560, 18));   // length=H, width=D, thickness=Tc
  await opfs.write(rightPath, await part('right', 720, 560, 18));
  await opfs.write(bottomPath, await part('bottom', 564, 560, 18));
  const cabinet: AssemblyDocument = {
    id: 'cab1', name: 'cab1', components: [
      { id: 'L', partPath: leftPath, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
      { id: 'R', partPath: rightPath, position: { x: 582, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
      { id: 'B', partPath: bottomPath, position: { x: 0, y: 0, z: 100 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom' },
    ],
    constraints: [], groundedComponentPaths: [['C1']], colors: {}, bomItemNumbers: {},
    cutListItemNumbers: {}, colorOverrides: {}, materials: [{ id: 'm', name: 'MDF', defaultThickness: 18, color: '#ccc' }], hardware: [],
  } as unknown as AssemblyDocument;
  await opfs.write(cabinetPath, await packAssembly(cabinet, new Uint8Array()));
  useAppStore.getState().setSubAssemblyDocs({ [cabinetPath]: cabinet });
  return cabinetPath;
}

describe('AddFaceFrameCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
  });

  it('apply adds cols+1 stiles + cols·(rows+1) rails; revert removes them', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const cmd = new AddFaceFrameCommand({
      cabinetPath,
      params: { rows: 2, cols: 2, stileWidth: 38, railWidth: 38, thickness: 19 },
      opfs, kernel, store: useAppStore,
    });

    await cmd.apply();
    let cab = await unpackAssembly(await opfs.read(cabinetPath));
    const stiles = cab.components.filter((c) => c.role === 'faceFrameStile');
    const rails = cab.components.filter((c) => c.role === 'faceFrameRail');
    expect(stiles).toHaveLength(3);          // cols+1
    expect(rails).toHaveLength(6);           // cols·(rows+1)
    expect(stiles[0]!.pose).toBeTruthy();
    expect(stiles[0]!.role).toBe('faceFrameStile');
    expect(kernel.registered.size).toBe(9);  // all members registered

    await cmd.revert();
    cab = await unpackAssembly(await opfs.read(cabinetPath));
    expect(cab.components.filter((c) => c.role === 'faceFrameStile')).toHaveLength(0);
    expect(cab.components.filter((c) => c.role === 'faceFrameRail')).toHaveLength(0);
    expect(kernel.registered.size).toBe(0);
  });

  it('surfaces the degenerate-opening error without writing partial state', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const before = (await unpackAssembly(await opfs.read(cabinetPath))).components.length;
    const cmd = new AddFaceFrameCommand({
      cabinetPath, params: { rows: 1, cols: 40, stileWidth: 38, railWidth: 38, thickness: 19 },
      opfs, store: useAppStore,
    });
    await expect(cmd.apply()).rejects.toThrow(/opening collapses/);
    const after = (await unpackAssembly(await opfs.read(cabinetPath))).components.length;
    expect(after).toBe(before); // no partial writes
  });
});
```

- [ ] **Step 2: Run it (RED)**

Run: `cd packages/app && npx vitest run src/commands/__tests__/AddFaceFrameCommand.spec.ts`
Expected: FAIL — `Cannot find module '../AddFaceFrameCommand'`.

- [ ] **Step 3: Implement the command**

```ts
// packages/app/src/commands/AddFaceFrameCommand.ts
import type { Command } from './Command';
import { deriveCabinetDims } from './cabinetDims';
import { layoutFaceFrame, CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, ComponentInstance, PartDocument } from '@zilventor/shared';
import type { PanelFeature } from '@zilventor/shared'; // if not re-exported, use the path AddDoorCommand uses
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { unpackAssembly, packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { useAppStore } from '../store/useAppStore';
// COPY the `writeTarGz` import line verbatim from AddDrawerBankCommand.ts:
import { writeTarGz } from '@zilventor/kernel/src/storage/TarGz'; // <- confirm exact path against AddDrawerBankCommand.ts

type OpfsRWD = {
  read(p: string): Promise<Uint8Array>;
  write(p: string, b: Uint8Array): Promise<void>;
  exists(p: string): Promise<boolean>;
  delete?(p: string): Promise<void>;
};
type KernelPartApi = { registerPart(part: PartDocument): Promise<void>; deletePart(partId: string): Promise<void> };

export interface AddFaceFrameParams {
  rows: number; cols: number; stileWidth: number; railWidth: number; thickness: number;
}

// COPY verbatim from AddDrawerBankCommand.ts (~:431-435):
async function packPanel(doc: PartDocument): Promise<Uint8Array> {
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
}

interface MemberArtifact { partId: string; partPath: string; componentId: string }

export class AddFaceFrameCommand implements Command {
  readonly name = 'AddFaceFrame';
  private readonly store: typeof useAppStore;
  private artifacts: MemberArtifact[] | null = null;

  constructor(private readonly opts: {
    cabinetPath: string;
    params: AddFaceFrameParams;
    opfs: OpfsRWD;
    kernel?: KernelPartApi;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const { cabinetPath, params, opfs, kernel } = this.opts;
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const dims = await deriveCabinetDims(cab, opfs);

    // layoutFaceFrame throws on degenerate input BEFORE any write (atomic).
    const members = layoutFaceFrame({
      width: dims.width, height: dims.height, toekickHeight: dims.toekickHeight, depth: dims.depth,
      rows: params.rows, cols: params.cols,
      stileWidth: params.stileWidth, railWidth: params.railWidth, thickness: params.thickness,
    });

    const baseDir = cabinetPath.replace(/\.ziasm$/, '');
    const stamp = Date.now();
    const artifacts: MemberArtifact[] = [];
    const newComponents: ComponentInstance[] = [];

    for (let idx = 0; idx < members.length; idx++) {
      const m = members[idx]!;
      const partPath = `${baseDir}-ff${stamp}-${idx}.zipt`;
      const panelFeature: PanelFeature = {
        kind: 'panel', id: 'panel',
        length: { kind: 'literal', value: m.dims.length },
        width: { kind: 'literal', value: m.dims.width },
        thickness: { kind: 'literal', value: m.dims.thickness },
        thicknessFromMaterial: false,
        materialId: cab.materials[0]?.id ?? 'm',
        grain: m.role === 'faceFrameStile' ? 'length' : 'width',
        edgeBands: { front: null, back: null, left: null, right: null },
      };
      const partDoc = addFeature(newPart(`FaceFrame ${m.role} ${idx}`), panelFeature);
      if (kernel) await kernel.registerPart(partDoc);
      await opfs.write(partPath, await packPanel(partDoc));

      const componentId = `FF${stamp}-${idx}`;
      newComponents.push({
        id: componentId, partPath,
        position: { x: m.pose.translation.x, y: m.pose.translation.y, z: m.pose.translation.z },
        rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, pose: m.pose, role: m.role,
      });
      artifacts.push({ partId: partDoc.id, partPath, componentId });
    }

    for (const c of newComponents) cab.components.push(c);
    await opfs.write(cabinetPath, await packAssembly(cab, new Uint8Array()));
    this.artifacts = artifacts;
    await this.reloadCabinet(cab);
  }

  async revert(): Promise<void> {
    if (!this.artifacts) return;
    const { cabinetPath, opfs, kernel } = this.opts;
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const ids = new Set(this.artifacts.map((a) => a.componentId));
    cab.components = cab.components.filter((c) => !ids.has(c.id));
    for (const a of this.artifacts) {
      if (kernel) await kernel.deletePart(a.partId);
      await opfs.delete?.(a.partPath);
    }
    await opfs.write(cabinetPath, await packAssembly(cab, new Uint8Array()));
    this.artifacts = null;
    await this.reloadCabinet(cab);
  }

  // COPY verbatim from AddDrawerBankCommand.ts (:404-409):
  private async reloadCabinet(cab: AssemblyDocument): Promise<void> {
    const docs = { ...this.store.getState().subAssemblyDocs };
    docs[this.opts.cabinetPath] = cab;
    this.store.getState().setSubAssemblyDocs(docs);
    this.store.getState().setSolverDirty(true);
  }
}
```

> If `writeTarGz`'s import path differs, copy the exact line from `AddDrawerBankCommand.ts`. If `PanelFeature` isn't re-exported from `@zilventor/shared`, copy AddDoorCommand's `PanelFeature` import. The command's `apply` is atomic: `layoutFaceFrame` throws before any `opfs.write`, so a degenerate request leaves the cabinet untouched (locked by the second test).

- [ ] **Step 4: Run the test (GREEN)**

Run: `cd packages/app && npx vitest run src/commands/__tests__/AddFaceFrameCommand.spec.ts`
Expected: PASS (both cases).

- [ ] **Step 5: tsc**

Run: `cd packages/app && npx tsc --noEmit`
Expected: 0 errors (or only pre-existing baseline; introduce none).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/commands/AddFaceFrameCommand.ts packages/app/src/commands/__tests__/AddFaceFrameCommand.spec.ts
git commit -m "feat(app): AddFaceFrameCommand (apply/revert, atomic degenerate guard)"
```

---

## Task 6: Real-OCCT bake — member dims → solid (geometry gate)

> Proves the panel dims that `faceFrameMath` produces build into real solids of the expected size in the kernel (catches dims→geometry bugs; the hand-oracle dims/positions are already locked in Task 4). Uses the producer's output, never hand-authored geometry.

**Files:**
- Create: `packages/kernel/src/__tests__/faceFrameBake.integration.spec.ts`

- [ ] **Step 1: Write the bake test**

```ts
// packages/kernel/src/__tests__/faceFrameBake.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occt/occtLoader';
import { buildPanelBox } from '../occt/PanelOps'; // confirm signature in PanelOps.ts: (oc, length, width, thickness) => shape | NamedShape
import { layoutFaceFrame } from '@zilventor/shared';

describe('face-frame member bake (real OCCT)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  function massAndBbox(shape: unknown) {
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, props, 1e-7, false, false);
    const mass = props.Mass();
    props.delete?.();
    const box = new oc.Bnd_Box_1();
    oc.BRepBndLib.Add(shape, box, false);
    const lo = box.CornerMin(); const hi = box.CornerMax();
    const dims = [hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z()].sort((a, b) => a - b);
    return { mass, dims };
  }

  it('a stile and a rail build to solids whose bbox edge-lengths match their producer dims', () => {
    const members = layoutFaceFrame({
      width: 600, height: 720, toekickHeight: 100, depth: 560,
      rows: 1, cols: 1, stileWidth: 38, railWidth: 38, thickness: 19,
    });
    const stile = members.find((m) => m.role === 'faceFrameStile')!;
    const rail = members.find((m) => m.role === 'faceFrameRail')!;

    for (const m of [stile, rail]) {
      const raw = buildPanelBox(oc, m.dims.length, m.dims.width, m.dims.thickness);
      const shape = (raw as { shape?: unknown }).shape ?? raw; // unwrap NamedShape if needed
      const { mass, dims } = massAndBbox(shape);
      const expected = [m.dims.length, m.dims.width, m.dims.thickness].sort((a, b) => a - b);
      expect(mass).toBeCloseTo(m.dims.length * m.dims.width * m.dims.thickness, 1);
      expect(dims[0]).toBeCloseTo(expected[0], 3);
      expect(dims[1]).toBeCloseTo(expected[1], 3);
      expect(dims[2]).toBeCloseTo(expected[2], 3);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd packages/kernel && npx vitest run --config vitest.integration.config.ts src/__tests__/faceFrameBake.integration.spec.ts`
Expected: PASS. If `buildPanelBox`'s signature differs, adapt the call to match `packages/kernel/src/occt/PanelOps.ts` (it is the helper that turns a panel's length/width/thickness into an OCCT box). If it FAILS on dims, `faceFrameMath` has a real geometry bug — fix Task 4 (do NOT weaken this test).

- [ ] **Step 3: Commit**

```bash
git add packages/kernel/src/__tests__/faceFrameBake.integration.spec.ts
git commit -m "test(kernel): real-OCCT bake — face-frame member dims build correct solids"
```

---

## Task 7: Store dialog state

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts` (mirror the `addDrawerBankDialog` slice at `:119-130`, `:400-401`, `:960-961`)

- [ ] **Step 1: Add the state type** (near `AddDrawerBankDialogState`):

```ts
/** "Add Face Frame" dialog. cabinetPath is the picked cabinet `.ziasm`. */
export type AddFaceFrameDialogState = {
  cabinetPath: string;
  onSubmit: (params: { rows: number; cols: number; stileWidth: number; railWidth: number; thickness: number }) => void;
  onCancel: () => void;
};
```

- [ ] **Step 2: Add the interface fields** (next to `addDrawerBankDialog`):

```ts
  addFaceFrameDialog: AddFaceFrameDialogState | null;
  setAddFaceFrameDialog: (s: AddFaceFrameDialogState | null) => void;
```

- [ ] **Step 3: Add the initializer** (next to `addDrawerBankDialog: null`):

```ts
  addFaceFrameDialog: null,
  setAddFaceFrameDialog: (s) => set({ addFaceFrameDialog: s }),
```

- [ ] **Step 4: Verify tsc**

Run: `cd packages/app && npx tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store/useAppStore.ts
git commit -m "feat(app): addFaceFrameDialog store slice"
```

---

## Task 8: `FaceFrameDialog` component

**Files:**
- Create: `packages/app/src/shell/FaceFrameDialog.tsx`
- Modify: `packages/app/src/shell/WorkFeatureDialogsHost.tsx`

> Mirror `DrawerBankDialog.tsx` (`:1-177`) — copy its module-level style consts (`overlayStyle`, `panelStyle`, `rowStyle`, `fieldStyle`, `btnStyle`, `okBtnStyle`, `errorStyle`) verbatim. The load-bearing piece is the **async `handleOk` with try/catch that keeps the dialog open** on error (no silent swallow).

- [ ] **Step 1: Write the component**

```tsx
// packages/app/src/shell/FaceFrameDialog.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import { DEFAULT_STILE_WIDTH, DEFAULT_RAIL_WIDTH, DEFAULT_FRAME_THICKNESS } from '@zilventor/shared';

// COPY the style consts (overlayStyle, panelStyle, rowStyle, fieldStyle, btnStyle, okBtnStyle, errorStyle)
// verbatim from DrawerBankDialog.tsx:5-25.

export function FaceFrameDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.addFaceFrameDialog);
  const setDialog = useAppStore((s) => s.setAddFaceFrameDialog);

  const [rows, setRows] = useState(1);
  const [cols, setCols] = useState(1);
  const [stileWidth, setStileWidth] = useState(String(DEFAULT_STILE_WIDTH));
  const [railWidth, setRailWidth] = useState(String(DEFAULT_RAIL_WIDTH));
  const [thickness, setThickness] = useState(String(DEFAULT_FRAME_THICKNESS));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dialog) {
      setRows(1); setCols(1);
      setStileWidth(String(DEFAULT_STILE_WIDTH));
      setRailWidth(String(DEFAULT_RAIL_WIDTH));
      setThickness(String(DEFAULT_FRAME_THICKNESS));
      setError(null);
    }
  }, [dialog]);

  if (!dialog) return null;

  const sw = Number(stileWidth), rw = Number(railWidth), th = Number(thickness);
  const valid = rows >= 1 && cols >= 1 && sw > 0 && rw > 0 && th > 0;

  const handleOk = async (): Promise<void> => {
    if (!valid) { setError(t('dialog.faceFrame.error.invalidInput')); return; }
    setError(null);
    try {
      await dialog.onSubmit({ rows, cols, stileWidth: sw, railWidth: rw, thickness: th });
      setDialog(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t(msg, { defaultValue: msg }));
      // Dialog stays open — do NOT call setDialog(null).
    }
  };

  return (
    <div style={overlayStyle} role="dialog" aria-label={t('dialog.faceFrame.title')}>
      <div style={panelStyle}>
        <h2>{t('dialog.faceFrame.title')}</h2>
        <label style={rowStyle}>{t('dialog.faceFrame.rows')}
          <input style={fieldStyle} type="number" min={1} max={10} value={rows} onChange={(e) => setRows(Number(e.target.value))} /></label>
        <label style={rowStyle}>{t('dialog.faceFrame.cols')}
          <input style={fieldStyle} type="number" min={1} max={10} value={cols} onChange={(e) => setCols(Number(e.target.value))} /></label>
        <label style={rowStyle}>{t('dialog.faceFrame.stileWidth')}
          <input style={fieldStyle} type="number" value={stileWidth} onChange={(e) => setStileWidth(e.target.value)} /></label>
        <label style={rowStyle}>{t('dialog.faceFrame.railWidth')}
          <input style={fieldStyle} type="number" value={railWidth} onChange={(e) => setRailWidth(e.target.value)} /></label>
        <label style={rowStyle}>{t('dialog.faceFrame.thickness')}
          <input style={fieldStyle} type="number" value={thickness} onChange={(e) => setThickness(e.target.value)} /></label>
        {error && <div style={errorStyle}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} type="button" onClick={() => { dialog.onCancel(); }}>{t('dialog.common.cancel')}</button>
          <button style={okBtnStyle} type="button" onClick={() => { void handleOk(); }}>{t('dialog.common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register it in the host**

In `packages/app/src/shell/WorkFeatureDialogsHost.tsx`: add the import `import { FaceFrameDialog } from './FaceFrameDialog';` and render `<FaceFrameDialog />` in the fragment next to `<DrawerBankDialog />` (`:56-63`).

- [ ] **Step 3: tsc**

Run: `cd packages/app && npx tsc --noEmit`
Expected: 0 new errors (i18n keys are runtime strings — fine).

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/shell/FaceFrameDialog.tsx packages/app/src/shell/WorkFeatureDialogsHost.tsx
git commit -m "feat(app): FaceFrameDialog (keep-open-on-error) + host registration"
```

---

## Task 9: FurnitureTab wiring + real-handler test (UI false-green guard)

**Files:**
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx` (mirror `handleAddDrawers` `:167-193` + the button JSX `:356-365`)
- Test: `packages/app/src/shell/tabs/__tests__/FurnitureTab.faceFrame.spec.tsx`

- [ ] **Step 1: Write the failing wiring test (RED)** — exercises the REAL FurnitureTab handler path, not a stub onSubmit.

```tsx
// packages/app/src/shell/tabs/__tests__/FurnitureTab.faceFrame.spec.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FurnitureTab } from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import { AddFaceFrameCommand } from '../../../commands/AddFaceFrameCommand';

describe('FurnitureTab — Add Face Frame wiring', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: { id: 'top', name: 'top', components: [], constraints: [] } as never });
  });

  it('button → pick → dialog onSubmit executes a real AddFaceFrameCommand on the bus', async () => {
    // Stub viewport: beginOneComponentPick immediately invokes the pick callback with a cabinet path.
    const beginOneComponentPick = vi.fn((_resolve: unknown, cb: (p: string) => void) => { cb('proj/cab1.ziasm'); return { cancel() {} }; });
    useAppStore.getState().setViewport({ beginOneComponentPick } as never);
    const execute = vi.fn(async () => {});
    // @ts-expect-error partial bus for test
    useAppStore.setState({ bus: { execute, undo: async () => {}, redo: async () => {} } });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByLabelText(/add_face_frame/i));

    // The handler opened the dialog with a REAL onSubmit; capture and invoke it.
    const dlg = useAppStore.getState().addFaceFrameDialog;
    expect(dlg).toBeTruthy();
    await dlg!.onSubmit({ rows: 1, cols: 1, stileWidth: 38, railWidth: 38, thickness: 19 });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toBeInstanceOf(AddFaceFrameCommand);
  });
});
```

- [ ] **Step 2: Run it (RED)**

Run: `cd packages/app && npx vitest run src/shell/tabs/__tests__/FurnitureTab.faceFrame.spec.tsx`
Expected: FAIL — no "Add Face Frame" button / handler yet (`getByLabelText` throws, or `addFaceFrameDialog` is null).

- [ ] **Step 3: Add the handler + button to `FurnitureTab.tsx`**

Add the import near the other command imports (`:23`): `import { AddFaceFrameCommand } from '../../commands/AddFaceFrameCommand';`

Add the handler (mirror `handleAddDrawers` `:167-193`):

```ts
  const handleAddFaceFrame = () => {
    const viewport = useAppStore.getState().viewport;
    if (!viewport) return;
    const handle = viewport.beginOneComponentPick(resolvePartPath, (cabinetPath: string) => {
      useAppStore.getState().setOneComponentPickHandle(null);
      useAppStore.getState().setAddFaceFrameDialog({
        cabinetPath,
        onSubmit: async (p) => {
          const opfs = await Opfs.forNavigator();
          await useAppStore.getState().bus.execute(
            new AddFaceFrameCommand({ cabinetPath, params: p, opfs, store: useAppStore }),
          );
        },
        onCancel: () => useAppStore.getState().setAddFaceFrameDialog(null),
      });
    });
    useAppStore.getState().setOneComponentPickHandle(handle);
  };
```

Add the button JSX next to "Add Drawers" (`:356-365`):

```tsx
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            title={cabinetDisabled ? t('ribbon.furniture.needAssemblyTip') : ''}
            onClick={() => { handleAddFaceFrame(); }}
            aria-label={t('aria.add_face_frame')}
          >
            {t('ribbon.furniture.addFaceFrame')}
          </button>
```

(`Opfs` and `resolvePartPath` are already imported/defined in FurnitureTab — reused as-is.)

- [ ] **Step 4: Run the test (GREEN)**

Run: `cd packages/app && npx vitest run src/shell/tabs/__tests__/FurnitureTab.faceFrame.spec.tsx`
Expected: PASS. (If `setViewport`/`setOneComponentPickHandle` names differ, align with the real store setters used by `handleAddDrawers`.)

- [ ] **Step 5: tsc**

Run: `cd packages/app && npx tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shell/tabs/FurnitureTab.tsx packages/app/src/shell/tabs/__tests__/FurnitureTab.faceFrame.spec.tsx
git commit -m "feat(app): Add Face Frame ribbon button + handler (real-handler wiring test)"
```

---

## Task 10: i18n strings

**Files:**
- Modify: `packages/app/src/i18n/locales/en.json`, `packages/app/src/i18n/locales/uk.json`

- [ ] **Step 1: Add keys to BOTH files** (the en/uk parity test requires identical key sets). Place under the existing `ribbon.furniture`, `aria`, and `dialog` subtrees.

en.json:
```json
"ribbon.furniture.addFaceFrame": "Add Face Frame",
"aria.add_face_frame": "Add face frame",
"dialog.faceFrame.title": "Add Face Frame",
"dialog.faceFrame.rows": "Rows",
"dialog.faceFrame.cols": "Columns",
"dialog.faceFrame.stileWidth": "Stile width (mm)",
"dialog.faceFrame.railWidth": "Rail width (mm)",
"dialog.faceFrame.thickness": "Thickness (mm)",
"dialog.faceFrame.error.invalidInput": "Rows, columns, and sizes must be positive.",
"face frame: opening collapses — too many columns for the cabinet width": "Opening collapses — too many columns for the cabinet width.",
"face frame: opening collapses — too many rows for the cabinet height": "Opening collapses — too many rows for the cabinet height."
```

uk.json (translate values; keep keys identical):
```json
"ribbon.furniture.addFaceFrame": "Додати лицьову рамку",
"aria.add_face_frame": "Додати лицьову рамку",
"dialog.faceFrame.title": "Додати лицьову рамку",
"dialog.faceFrame.rows": "Рядки",
"dialog.faceFrame.cols": "Стовпці",
"dialog.faceFrame.stileWidth": "Ширина стійки (мм)",
"dialog.faceFrame.railWidth": "Ширина поперечки (мм)",
"dialog.faceFrame.thickness": "Товщина (мм)",
"dialog.faceFrame.error.invalidInput": "Рядки, стовпці та розміри мають бути додатними.",
"face frame: opening collapses — too many columns for the cabinet width": "Отвір зникає — забагато стовпців для ширини шафи.",
"face frame: opening collapses — too many rows for the cabinet height": "Отвір зникає — забагато рядків для висоти шафи."
```

> The two error keys mirror the exact `Error` messages thrown by `faceFrameMath` so the dialog's `t(msg, { defaultValue: msg })` localizes them (the connector-message localization pattern). Note for the shop lead: confirm domain terms (стійка / поперечка / лицьова рамка) — listed as a spec deferral.

- [ ] **Step 2: Run the i18n parity test**

Run: `cd packages/app && npx vitest run src/i18n`
Expected: PASS (en/uk key sets match).

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json
git commit -m "i18n: face-frame UI strings (en/uk)"
```

---

## Task 11: Real-browser e2e (end-to-end gate)

**Files:**
- Create: `tests/e2e/face-frame.spec.ts`

> Mirror `tests/e2e/prisadka-slice4-drawer-banks.spec.ts` for booting, seeding a cabinet (new assembly → addMaterial → `CreateCabinetCommand`), and the probe helpers. Headless viewport is BLACK — assert via `window.__zilventor*` probes / store state, never pixels.

- [ ] **Step 1: Write the e2e**

```ts
// tests/e2e/face-frame.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test('face frame: add 2×2 grid, verify members + cut-list, undo restores', async ({ page }) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(120_000);
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await page.goto('/');
  await waitForKernelReady(page);

  // Seed a cabinet EXACTLY as prisadka-slice4-drawer-banks.spec.ts does (new assembly, addMaterial,
  // CreateCabinetCommand via dynamic import + bus.execute). Returns the cabinet .ziasm path.
  const cabinetPath: string = await page.evaluate(async () => {
    const w = window as any;
    // ... copy the cabinet-seeding block from the slice-4 e2e; return the cabinet path ...
    return w.__zilventorLastCabinetPath; // whatever the slice-4 helper exposes
  });

  const before = await page.evaluate((p) => {
    const w = window as any;
    return (w.__zilventorStore.getState().subAssemblyDocs[p]?.components ?? []).length;
  }, cabinetPath);

  await page.evaluate(async (cabPath) => {
    const w = window as any;
    const { AddFaceFrameCommand } = await import('/src/commands/AddFaceFrameCommand.ts');
    const opfs = await w.__zilventorGetOpfs();
    const cmd = new AddFaceFrameCommand({ cabinetPath: cabPath, params: { rows: 2, cols: 2, stileWidth: 38, railWidth: 38, thickness: 19 }, opfs });
    await w.__zilventorStore.getState().bus.execute(cmd);
  }, cabinetPath);

  // 3 stiles + 6 rails = 9 members added.
  const counts = await page.evaluate((p) => {
    const comps = (window as any).__zilventorStore.getState().subAssemblyDocs[p].components as Array<{ role?: string }>;
    return {
      stiles: comps.filter((c) => c.role === 'faceFrameStile').length,
      rails: comps.filter((c) => c.role === 'faceFrameRail').length,
    };
  }, cabinetPath);
  expect(counts.stiles).toBe(3);
  expect(counts.rails).toBe(6);

  // Members reach the cut-list (no new code, but VERIFY they're picked up).
  const cutListHasMembers = await page.evaluate((p) => {
    const w = window as any;
    const docs = w.__zilventorStore.getState().subAssemblyDocs[p];
    return docs.components.some((c: { role?: string }) => c.role === 'faceFrameStile');
  }, cabinetPath);
  expect(cutListHasMembers).toBe(true);

  // Undo restores the original count.
  await page.evaluate(async () => { await (window as any).__zilventorStore.getState().bus.undo(); });
  const after = await page.evaluate((p) => {
    return ((window as any).__zilventorStore.getState().subAssemblyDocs[p]?.components ?? []).length;
  }, cabinetPath);
  expect(after).toBe(before);

  expect(consoleErrors.filter((e) => !e.includes('ResizeObserver') && !e.includes('favicon'))).toHaveLength(0);
});
```

> Replace the cabinet-seeding stub with the verbatim block from the slice-4 e2e. If a richer cut-list probe exists (e.g. `__zilventorCutListAggregate()`), assert a face-frame row directly; otherwise the component-role check above is the minimum reaches-the-members gate.

- [ ] **Step 2: Run the e2e** (build first if the project requires a built artifact — match how slice-4 e2e is run, e.g. `pnpm build && npx playwright test tests/e2e/face-frame.spec.ts`)

Run: `npx playwright test tests/e2e/face-frame.spec.ts`
Expected: PASS, zero console errors.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/face-frame.spec.ts
git commit -m "test(e2e): face frame add/verify/undo on a real cabinet"
```

---

## Task 12: Full gate + final whole-branch review

> The final cross-chunk review is load-bearing — it has caught a cross-chunk blocker on every prior feature. Do not skip.

- [ ] **Step 1: Run every gate fresh**

```bash
cd packages/shared && npx vitest run && npx tsc --noEmit
cd ../app && npx vitest run && npx tsc --noEmit
cd ../kernel && npx vitest run && npx vitest run --config vitest.integration.config.ts && npx tsc --noEmit
cd ../.. && pnpm lint
npx playwright test tests/e2e/face-frame.spec.ts
```
Expected: all green; `pnpm lint` exit 0 (hard gate); tsc 0-new across packages.

- [ ] **Step 2: Final review** — dispatch a `code-reviewer` (or `requesting-code-review` skill) over the whole branch diff (`git diff master...HEAD`). Re-check the spec `2026-06-14-frame-generator-design.md` section-by-section against the diff. Specifically verify:
  - Cut-list / BOM / DXF / nesting / 3D render actually reach the new members (the "reaches-the-members" false-green class) — confirm a face-frame cut-list row appears, not just components in the doc.
  - `git status` is clean before any push (subagents sometimes leave a dirty tree / self-push).
  - No member overlaps another (butt joints) and none sits behind the carcass front (`y ≥ depth`).
  - The degenerate guard fires from the dialog (toast, keep-open), not a crash.

- [ ] **Step 3: Fix any review findings** (each as its own red→green commit if behavioral).

- [ ] **Step 4: Finish the branch** — invoke `superpowers:finishing-a-development-branch` to merge (`--no-ff`) to master, mirroring the Phase-C merge style. Update auto-memory + write the handoff.

---

## Self-Review (plan vs spec)

**Spec coverage:** §1 goal → Tasks 5/9; §2 decisions → all; §4 architecture → Task 5; §5 layout math + invariants + degenerate guard → Task 4; §6 pose-derive (collapses to reused DOOR_POSE) → Tasks 4/6; §7 data model (roles + manifest) → Tasks 2/3; §8 BOM/cut-list → Task 11 (reaches-the-members gate); §9 clash → Task 2; §10 constants → Task 1; §11 files → File Structure table; §12 testing A–G → Tasks 4/3/5/6/9/2/11; §13 deferrals → not implemented (correct); §14 risks → Tasks 6 (geometry false-green), 9 (UI false-green), 11 (reaches-the-members), 4 (degenerate), 12 (final review + dirty-tree).

**Placeholder scan:** Three pointers intentionally reference existing files for verbatim copy (`writeTarGz` import, `DrawerBankDialog` styles, slice-4 e2e cabinet seeding) — these are exact-copy instructions, not vague placeholders. No "TBD"/"add error handling"/undefined symbols.

**Type consistency:** `layoutFaceFrame`/`FaceFrameParams`/`FrameMember` consistent across Tasks 4/5/6; `AddFaceFrameParams` ↔ store `AddFaceFrameDialogState.onSubmit` ↔ dialog `onSubmit` ↔ FurnitureTab handler all use `{ rows, cols, stileWidth, railWidth, thickness }`; roles `faceFrameStile`/`faceFrameRail` consistent in Tasks 2/4/5/9/11; `CURRENT_FORMAT_VERSION` = 26 used in Tasks 3/5.
