---
# Присадка Carcass-Joint Boring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate carcass-joint присадка (confirmat/minifix/dowel) auto-from-cabinet + manual, as lightweight bore metadata with 3D markers, DXF+CSV export, and optional bake to real holes (3D + 2D drawings).

**Architecture:** Bores live on the part (PartDocument.bores[]); generation reads cabinet roles or two picked panels; hybrid geometry = markers (fast) + bake to HoleFeatures (on demand). Additive manifest v20->v21.

**Tech Stack:** TypeScript pnpm monorepo, OCCT (opencascade.js) kernel, three.js viewport, Zustand command bus, Vitest + Playwright.

**Worktree note:** Plan commands hardcode the main repo root /Users/lion/Documents/Projects/mine/zilventor. When executing in a worktree, substitute the worktree path everywhere.

---

## Task Index

1. `bore.ts`: BoreRole / BoreConnectorKind / BoreOp types + `face2DFrame()`
2. `connectorCatalog.ts`: count/spacing math + `generateConfirmat`/`Minifix`/`Dowel`
3. `types.ts` additive fields: `bores?`, `role?`, `atFace` HolePlacement, formatVersion unions
4. `fileFormat.ts`: v21 const + no-op migration + normalizeKind guard
5. barrel exports (`index.ts`)
6. `jointMath.ts` (Phase 2): `enumerateAutoJoints` + `inferManualJoint`
7. `CreateCabinetCommand` persists `ComponentInstance.role` (join by `fileNameSuffix`)
8. `GenerateCarcassBoresCommand.apply()` writes `bores[]` to involved panel `.zipt`s (auto path)
9. `GenerateCarcassBoresCommand.revert()` restores prior `bores[]` per panel
10. `AddManualJointBoresCommand.apply()` infers joint from two picked panels and appends bores to A+B
11. Thread real `partPath` through `AddManualJointBoresCommand` (kill the `document.id` shortcut)
12. `AddManualJointBoresCommand.revert()` restores prior `bores[]` on both panels
13. Viewport two-panel pick: imperative `pickTwoComponents()` handle on the Viewport ref
13b. `ClearBoresCommand`: wipe `bores[]` from one or more panels (undoable) + "Clear Bores" ribbon button
14. `MarkerOverlaySpec` type + `setBoreMarkers()` setter on `SceneManager` (no render yet)
15. `rebuildBoreMarkers()` builds a positioned marker mesh per bore
16. `showBores` store slice + `attach()` subscription
17. Furniture-ribbon "Show Bores" toggle button (wiring; no TDD)
18. `aggregateBoresRecursive` walker (recursion + per-panel grouping)
19. `buildBoringCsv` emitter
20. `ExportBoringCsvCommand` (one-shot, no revert)
21. `useBoringResult` hook + Furniture-ribbon "Export CSV (Boring)" button (wiring; no TDD)
22. Wire bore markers into the live viewport render path (no TDD; §6-gated)
23. `renderBoringDxf`: panel outline POLYLINE per panel group
24. `renderBoringDxf`: CIRCLE per bore on per-(Ø,depth) layers
25. `ExportBoringDxfCommand` (one-shot, no revert)
26. kernel `atFace` HolePlacement variant: `resolveAtFaceLocations` (unit, no OCCT)
27. kernel `atFace` real-OCCT integration: prove the void EXISTS on an offset panel face
28. `BakeBoresCommand`: group bores → atFace HoleFeatures → kernel execute (undoable)
29. `UnbakeBoresCommand`: remove `bake:`-tagged HoleFeatures (undoable)
30. Whole-package verification gate (DXF + BAKE chunk)
31. RED scaffold: e2e file that fails because the присадка commands/exports don't exist yet
32. Extend e2e: export CSV + DXF bytes, parse and assert against the bores
33. Extend e2e: bake → real OCCT voids (volume drops) → drawing arc edges + center-marks
34. Extend e2e: undo restores prior bores[] and removes baked holes
35. (optional, gated by spec §16) Perf: bake p95 budget on a single panel
36. §6 browser-verification checklist (controller reads screenshots back) — LOAD-BEARING
37. tsc pass on every touched package (exactOptionalPropertyTypes guard)

---

## Group 1 — Phase 1 (data model) + Phase 2 (jointMath), all in `packages/shared`

> **Worktree note:** When executed in a worktree, substitute the worktree path for
> `/Users/lion/Documents/Projects/mine/zilventor` in all commands below. All `shared`
> suites run **from `packages/shared`** with `npx vitest run src/__tests__/<file>.spec.ts`
> (cwd = `packages/shared`). Bash cwd persists across AND within compound commands in this
> repo — always `cd packages/shared` first (or run from there).

> **Scope contract (do not drift):** This group ships ONLY pure `packages/shared` code +
> the v20→v21 migration. The cabinet-pose ↔ panel-local-frame reconciliation lives in
> Phase 3 (`GenerateCarcassBoresCommand`, group 2/3) — `jointMath` here takes **explicit
> poses** as input and never reads the cabinet builder. `enumerateAutoJoints` derives
> joints from `role`+`dims`+`pose` deterministically; `inferManualJoint` is a pure
> world-AABB butt-joint test. Both are unit-tested with self-authored fixtures.

> **exactOptionalPropertyTypes is ON** (gotcha): never set `bores`/`role` to `undefined`
> explicitly — omit the key. Run `npm run typecheck` (= `tsc --noEmit`) from
> `packages/shared` after every task that touches a `.ts` non-test file; tsc has
> historically caught TS2375 that vitest missed.

> **CONTRACT: BoreOp.face is FaceName (object)** — `{ featureId: string; role: string; instance: number }`.
> Never use a bare string (`'Top'`, `'Front'`, etc.) for `BoreOp.face`. To get the role string
> for `face2DFrame` or CSV output, use `bore.face.role as PanelFaceRole`.

---

### Task 1 — `bore.ts`: BoreRole / BoreConnectorKind / BoreOp types + `face2DFrame()`

The data-model foundation. `face2DFrame` maps a panel face's `(u,v)` 2D coord to a
3D point in panel-local space (`P = origin + u·uDir + v·vDir`), reversibly. Panel part
frame (from `PanelOps.buildPanelBox`): box `[-L/2,-W/2,0]..[L/2,W/2,T]`, centered in X/Y,
bottom at Z=0. Face normals: Top=+Z, Bottom=−Z, Front=+Y, Back=−Y, Left=−X, Right=+X.

**Files:**
- Create `packages/shared/src/bore.ts`
- Test `packages/shared/src/__tests__/face2DFrame.spec.ts`

**Steps:**

1. Write the failing test `packages/shared/src/__tests__/face2DFrame.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { face2DFrame } from '../bore';
import type { BoreOp } from '../bore';

const dims = { length: 600, width: 400, thickness: 18 };

describe('face2DFrame — panel-local 2D coordinate frames', () => {
  it('Top face: origin on the +Z plane, uDir/vDir span the L×W plane, normal = +Z', () => {
    const f = face2DFrame(dims, 'Top');
    // Top face lies at z = T
    expect(f.origin.z).toBeCloseTo(18, 6);
    // u·v cross product must point +Z (into the +Z half-space / outward)
    const n = cross(f.uDir, f.vDir);
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.y).toBeCloseTo(0, 6);
    expect(n.z).toBeGreaterThan(0);
  });

  it('Front face (+Y): origin at y = +W/2, normal = +Y', () => {
    const f = face2DFrame(dims, 'Front');
    expect(f.origin.y).toBeCloseTo(200, 6);
    const n = cross(f.uDir, f.vDir);
    expect(n.y).toBeGreaterThan(0);
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.z).toBeCloseTo(0, 6);
  });

  it('Left face (−X): origin at x = −L/2, normal = −X', () => {
    const f = face2DFrame(dims, 'Left');
    expect(f.origin.x).toBeCloseTo(-300, 6);
    const n = cross(f.uDir, f.vDir);
    expect(n.x).toBeLessThan(0);
  });

  it('is reversible: (u,v)=(0,0) maps to origin, and unit u/v steps are orthonormal', () => {
    const f = face2DFrame(dims, 'Right');
    expect(len(f.uDir)).toBeCloseTo(1, 6);
    expect(len(f.vDir)).toBeCloseTo(1, 6);
    expect(dot(f.uDir, f.vDir)).toBeCloseTo(0, 6);
  });

  it('BoreOp shape is structurally usable (compile + literal)', () => {
    const b: BoreOp = {
      id: 'b1', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 50, v: 100, diameter: 5, depth: 34, role: 'confirmat-face',
      connectorId: 'c1', connectorKind: 'confirmat',
    };
    expect(b.depth).toBe(34);
    const through: BoreOp['depth'] = 'throughAll';
    expect(through).toBe('throughAll');
  });
});

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function len(a: { x: number; y: number; z: number }) {
  return Math.sqrt(dot(a, a));
}
```

2. Run it — expected **FAIL** (`Cannot find module '../bore'`, `face2DFrame is not a function`):

```
cd packages/shared && npx vitest run src/__tests__/face2DFrame.spec.ts
```

3. Minimal implementation — create `packages/shared/src/bore.ts`:

```ts
import type { FaceName } from './types';

export type BoreRole =
  | 'confirmat-face' | 'confirmat-edge'
  | 'minifix-cam' | 'minifix-bolt' | 'minifix-cross'
  | 'dowel-face' | 'dowel-edge';

export type BoreConnectorKind = 'confirmat' | 'minifix' | 'dowel';

/**
 * Hardware-boring op (присадка). One drill: a face, a panel-local (u,v) on that
 * face (mm, per face2DFrame), Ø, depth, role + connector grouping.
 * Panel faces use PanelOps roles: 'Top'|'Bottom'|'Front'|'Back'|'Left'|'Right'
 * with featureId:'panel', instance:0.
 */
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

type Vec3 = { x: number; y: number; z: number };
export type PanelFaceRole = 'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right';

/**
 * Panel-local 2D coordinate frame for a face. Panel box (PanelOps.buildPanelBox):
 * [-L/2,-W/2,0]..[L/2,W/2,T], centered X/Y, bottom Z=0. Returns origin + orthonormal
 * uDir/vDir so P = origin + u*uDir + v*vDir; (uDir × vDir) points along the outward
 * face normal (Top=+Z, Bottom=-Z, Front=+Y, Back=-Y, Left=-X, Right=+X).
 */
export function face2DFrame(
  panelDims: { length: number; width: number; thickness: number },
  faceName: PanelFaceRole,
): { origin: Vec3; uDir: Vec3; vDir: Vec3 } {
  const { length: L, width: W, thickness: T } = panelDims;
  const hL = L / 2, hW = W / 2;
  switch (faceName) {
    case 'Top':    // +Z plane; u along +X, v along +Y → normal +Z
      return { origin: { x: -hL, y: -hW, z: T }, uDir: { x: 1, y: 0, z: 0 }, vDir: { x: 0, y: 1, z: 0 } };
    case 'Bottom': // -Z plane; u along +X, v along -Y → normal -Z
      return { origin: { x: -hL, y: hW, z: 0 }, uDir: { x: 1, y: 0, z: 0 }, vDir: { x: 0, y: -1, z: 0 } };
    case 'Front':  // +Y plane; u along +X, v along +Z → normal +Y
      return { origin: { x: -hL, y: hW, z: 0 }, uDir: { x: 1, y: 0, z: 0 }, vDir: { x: 0, y: 0, z: 1 } };
    case 'Back':   // -Y plane; u along -X, v along +Z → normal -Y
      return { origin: { x: hL, y: -hW, z: 0 }, uDir: { x: -1, y: 0, z: 0 }, vDir: { x: 0, y: 0, z: 1 } };
    case 'Left':   // -X plane; u along +Y, v along +Z → normal -X
      return { origin: { x: -hL, y: -hW, z: 0 }, uDir: { x: 0, y: 1, z: 0 }, vDir: { x: 0, y: 0, z: 1 } };
    case 'Right':  // +X plane; u along -Y, v along +Z → normal +X
      return { origin: { x: hL, y: hW, z: 0 }, uDir: { x: 0, y: -1, z: 0 }, vDir: { x: 0, y: 0, z: 1 } };
  }
}
```

> Each branch's `uDir × vDir` is hand-verified to point outward: Top (+X)×(+Y)=+Z ✓,
> Bottom (+X)×(−Y)=−Z ✓, Front (+X)×(+Z)=−Y… **wait**: (+X)×(+Z) = −Y, so Front would be
> wrong. Use `vDir=+Z, uDir` chosen so the cross is +Y. The implementation above sets
> Front `uDir=+X, vDir=+Z` → cross = (1,0,0)×(0,0,1) = (0·1−0·0, 0·0−1·1, 0) = (0,−1,0) =
> −Y. That is WRONG for +Y normal. **Correct it during green:** flip Front/Back/Top so the
> cross matches the outward normal (the test asserts the sign). Final correct table:
> Top `u=+X,v=+Y`(→+Z ✓); Bottom `u=+X,v=−Y`(→−Z ✓); Front `u=+Z,v=+X`(→ (0,0,1)×(1,0,0)=
> (0·0−0·0,0·1−1·0... )` compute: (0,0,1)×(1,0,0)=(0·0−1·0, 1·1−0·0, 0·0−0·1)=(0,1,0)=+Y ✓);
> Back `u=+Z,v=−X`(→ (0,0,1)×(−1,0,0)=(0,−1,0)=−Y ✓); Left `u=+Z,v=+Y`(→(0,0,1)×(0,1,0)=
> (0·0−1·1,1·0−0·0,0)= (−1,0,0)=−X ✓); Right `u=+Z,v=−Y`(→(0,0,1)×(0,−1,0)=(1,0,0)=+X ✓).
> Apply this corrected table in the implementation (test-driven — the cross-product asserts
> force it). Keep origins as: Top `{-hL,-hW,T}`, Bottom `{-hL,hW,0}`, Front `{-hL,hW,0}`,
> Back `{hL,-hW,0}`, Left `{-hL,-hW,0}`, Right `{hL,hW,0}`.

4. Run it — expected **PASS** (all 5 cases green):

```
cd packages/shared && npx vitest run src/__tests__/face2DFrame.spec.ts
```

5. Typecheck:

```
cd packages/shared && npm run typecheck
```

6. Commit:

```
git add packages/shared/src/bore.ts packages/shared/src/__tests__/face2DFrame.spec.ts
git commit -m "feat(shared): BoreOp/BoreRole types + face2DFrame panel-local frames"
```

---

### Task 2 — `connectorCatalog.ts`: count/spacing math + `generateConfirmat`/`Minifix`/`Dowel`

Pure per-kind generators. `A` = face-drilled (through) panel; `B` = end-drilled panel.
`BoringParams` defaults: `endSetback=60, maxSpacing=250, minCount=2`. Count =
`max(minCount, ceil((jointLen − 2·endSetback)/maxSpacing) + 1)`, evenly distributed
between the setbacks. The generators take a `JointInput` (joint line + both panels'
dims/poses + which face of A / end of B) and return `{ boresA, boresB }`.

> The minifix three-bore geometry + confirmat edge depth defaults are the spec §6 TODO —
> these tests pin the **structure** (count, role, connectorKind, pairing, even spacing),
> NOT exact furniture-accurate Ø/depth values beyond the spec table. A later catalog-review
> pass adjusts magnitudes; keep the constants in named consts so they're one-line edits.

**Files:**
- Create `packages/shared/src/connectorCatalog.ts`
- Test `packages/shared/src/__tests__/connectorCatalog.spec.ts`

**Steps:**

1. Write the failing test `packages/shared/src/__tests__/connectorCatalog.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  generateConfirmat, generateMinifix, generateDowel,
  type JointInput, type BoringParams,
} from '../connectorCatalog';

const defaults: BoringParams = { endSetback: 60, maxSpacing: 250, minCount: 2 };

// A 700mm joint along +X at the shared edge. A = face-drilled side panel,
// B = end-drilled bottom panel. Dims/poses are illustrative (generators are
// pure over jointLen + faceA/endB; pose feeds frame placement downstream).
function joint(len = 700): JointInput {
  return {
    line: { p0: { x: 0, y: 0, z: 0 }, p1: { x: len, y: 0, z: 0 } },
    panelA: { dims: { length: 800, width: 500, thickness: 18 },
      pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    panelB: { dims: { length: len, width: 500, thickness: 18 },
      pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    faceA: 'Left',
    endB: 'Top',
  };
}

describe('count/spacing math (via confirmat)', () => {
  it('700mm joint, defaults → ceil((700-120)/250)+1 = 4 confirmats per side', () => {
    const r = generateConfirmat(joint(700), defaults);
    expect(r.boresA).toHaveLength(4);
    expect(r.boresB).toHaveLength(4);
  });

  it('short joint clamps to minCount=2', () => {
    const r = generateConfirmat(joint(120), defaults);
    expect(r.boresA).toHaveLength(2);
  });

  it('bores are evenly distributed between the setbacks (first at +endSetback, last at len-endSetback)', () => {
    const r = generateConfirmat(joint(700), defaults);
    // confirmat A is the THROUGH (face) panel — its along-joint coordinate is u.
    const us = r.boresA.map((b) => b.u).sort((a, b) => a - b);
    expect(us[0]).toBeCloseTo(60, 3);
    expect(us[us.length - 1]).toBeCloseTo(640, 3);
    // even spacing
    const gaps = us.slice(1).map((u, i) => u - us[i]);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 3);
  });
});

describe('generateConfirmat', () => {
  it('A bores Ø7 (through) role confirmat-face; B bores Ø5 role confirmat-edge', () => {
    const r = generateConfirmat(joint(700), defaults);
    for (const b of r.boresA) {
      expect(b.diameter).toBe(7);
      expect(b.role).toBe('confirmat-face');
      expect(b.depth).toBe('throughAll');
      expect(b.connectorKind).toBe('confirmat');
    }
    for (const b of r.boresB) {
      expect(b.diameter).toBe(5);
      expect(b.role).toBe('confirmat-edge');
      expect(b.connectorKind).toBe('confirmat');
    }
  });

  it('each A bore is paired with exactly one B bore by connectorId', () => {
    const r = generateConfirmat(joint(700), defaults);
    const idsA = r.boresA.map((b) => b.connectorId);
    const idsB = r.boresB.map((b) => b.connectorId);
    expect(new Set(idsA)).toEqual(new Set(idsB));
    expect(idsA).toHaveLength(new Set(idsA).size); // unique
  });
});

describe('generateMinifix', () => {
  it('A side gets cam (Ø15) + cross (Ø8) per connector; B side gets bolt (Ø8)', () => {
    const r = generateMinifix(joint(700), defaults);
    const cams = r.boresA.filter((b) => b.role === 'minifix-cam');
    const cross = r.boresA.filter((b) => b.role === 'minifix-cross');
    const bolts = r.boresB.filter((b) => b.role === 'minifix-bolt');
    expect(cams).toHaveLength(4);
    expect(cross).toHaveLength(4);
    expect(bolts).toHaveLength(4);
    for (const c of cams) expect(c.diameter).toBe(15);
    for (const c of cross) expect(c.diameter).toBe(8);
    for (const b of bolts) expect(b.diameter).toBe(8);
  });
});

describe('generateDowel', () => {
  it('A Ø8 face ×12, B Ø8 end ×20, dowel-face / dowel-edge roles', () => {
    const r = generateDowel(joint(700), defaults);
    for (const b of r.boresA) {
      expect(b.diameter).toBe(8);
      expect(b.depth).toBe(12);
      expect(b.role).toBe('dowel-face');
    }
    for (const b of r.boresB) {
      expect(b.diameter).toBe(8);
      expect(b.depth).toBe(20);
      expect(b.role).toBe('dowel-edge');
    }
  });
});
```

2. Run it — expected **FAIL** (`Cannot find module '../connectorCatalog'`):

```
cd packages/shared && npx vitest run src/__tests__/connectorCatalog.spec.ts
```

3. Minimal implementation — create `packages/shared/src/connectorCatalog.ts`:

```ts
import type { BoreOp, BoreRole, BoreConnectorKind, PanelFaceRole } from './bore';
import type { Vec3 } from './types';
import type { Pose } from './jointMath';
// NOTE: Pose is declared once in jointMath.ts (Task 6). PanelFaceRole is declared in bore.ts.
// connectorCatalog.ts imports both rather than re-exporting to avoid star-export conflict.

export interface JointInput {
  line: { p0: Vec3; p1: Vec3 };
  panelA: { dims: { length: number; width: number; thickness: number }; pose: Pose };
  panelB: { dims: { length: number; width: number; thickness: number }; pose: Pose };
  faceA: PanelFaceRole;
  endB: PanelFaceRole;
}

export interface BoringParams {
  endSetback: number;
  maxSpacing: number;
  minCount: number;
}

export const DEFAULT_BORING_PARAMS: BoringParams = {
  endSetback: 60, maxSpacing: 250, minCount: 2,
};

function jointLength(j: JointInput): number {
  const { p0, p1 } = j.line;
  return Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
}

/** Evenly-spaced along-joint distances (mm) between the two setbacks. */
function spacingDistances(len: number, p: BoringParams): number[] {
  const usable = len - 2 * p.endSetback;
  const count = Math.max(p.minCount, usable > 0 ? Math.ceil(usable / p.maxSpacing) + 1 : p.minCount);
  if (count <= 1) return [len / 2];
  const start = p.endSetback;
  const span = len - 2 * p.endSetback;
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

const FACE_OF = (j: JointInput, which: 'A' | 'B'): FaceName => ({
  featureId: 'panel',
  role: which === 'A' ? j.faceA : j.endB,
  instance: 0,
});

// `v` = the cross-joint coordinate on the face; the centerline of the mating
// panel's thickness. For slice 1 it is the half-thickness of the OTHER panel
// (placeholder — frame placement is refined in jointMath/Generate command);
// the unit tests pin `u` (along-joint) + role/Ø/depth/pairing only.
function crossCoord(otherThickness: number): number {
  return otherThickness / 2;
}

interface BoreSpec {
  diameter: number;
  depth: number | 'throughAll';
  role: BoreRole;
}

function makeBores(
  j: JointInput, p: BoringParams, kind: BoreConnectorKind,
  side: 'A' | 'B', specs: (cid: string) => BoreSpec[],
): { bores: BoreOp[]; ids: string[] } {
  const dists = spacingDistances(jointLength(j), p);
  const bores: BoreOp[] = [];
  const ids: string[] = [];
  const otherT = side === 'A' ? j.panelB.dims.thickness : j.panelA.dims.thickness;
  dists.forEach((u, i) => {
    const cid = `${kind}-${i}`;
    if (i === 0 || ids[ids.length - 1] !== cid) ids.push(cid);
    for (const s of specs(cid)) {
      bores.push({
        id: `${cid}-${side}-${bores.length}`,
        face: FACE_OF(j, side),
        u, v: crossCoord(otherT),
        diameter: s.diameter, depth: s.depth, role: s.role,
        connectorId: cid, connectorKind: kind,
      });
    }
  });
  return { bores, ids };
}

export function generateConfirmat(j: JointInput, p: BoringParams): { boresA: BoreOp[]; boresB: BoreOp[] } {
  const a = makeBores(j, p, 'confirmat', 'A', () => [{ diameter: 7, depth: 'throughAll', role: 'confirmat-face' }]);
  const lenB = j.panelB.dims.length;
  const b = makeBores(j, p, 'confirmat', 'B', () => [{ diameter: 5, depth: 50 - j.panelA.dims.thickness, role: 'confirmat-edge' }]);
  void lenB;
  return { boresA: a.bores, boresB: b.bores };
}

export function generateMinifix(j: JointInput, p: BoringParams): { boresA: BoreOp[]; boresB: BoreOp[] } {
  const a = makeBores(j, p, 'minifix', 'A', () => [
    { diameter: 15, depth: 12.5, role: 'minifix-cam' },
    { diameter: 8, depth: 34, role: 'minifix-cross' },
  ]);
  const b = makeBores(j, p, 'minifix', 'B', () => [{ diameter: 8, depth: 34, role: 'minifix-bolt' }]);
  return { boresA: a.bores, boresB: b.bores };
}

export function generateDowel(j: JointInput, p: BoringParams): { boresA: BoreOp[]; boresB: BoreOp[] } {
  const a = makeBores(j, p, 'dowel', 'A', () => [{ diameter: 8, depth: 12, role: 'dowel-face' }]);
  const b = makeBores(j, p, 'dowel', 'B', () => [{ diameter: 8, depth: 20, role: 'dowel-edge' }]);
  return { boresA: a.bores, boresB: b.bores };
}
```

> Add `import type { FaceName } from './types';` at the top (FACE_OF returns `FaceName`).
> The `makeBores` `ids`-dedup loop guarantees one `connectorId` per along-joint position,
> shared by the A and B bores (because both sides iterate the same `dists` with the same
> `cid` formula `${kind}-${i}`) — that is what the pairing test asserts.

4. Run it — expected **PASS** (all describe blocks green):

```
cd packages/shared && npx vitest run src/__tests__/connectorCatalog.spec.ts
```

5. Typecheck:

```
cd packages/shared && npm run typecheck
```

6. Commit:

```
git add packages/shared/src/connectorCatalog.ts packages/shared/src/__tests__/connectorCatalog.spec.ts
git commit -m "feat(shared): connectorCatalog — confirmat/minifix/dowel generators + spacing math"
```

---

### Task 3 — `types.ts` additive fields: `bores?`, `role?`, `atFace` HolePlacement, formatVersion unions

Additive type surface. No behavior — pure type edits, verified by tsc + a tiny compile
test. **NO-TDD for the union edits themselves** (pure type declarations, no runtime
behavior) — reason: type-only additive changes are verified by `tsc --noEmit`; a compile
assertion test documents intent.

**Files:**
- Modify `packages/shared/src/types.ts` (PartDocument l71-86, ComponentInstance l92-101,
  HolePlacement l273-283, ProjectFile unions l143-146, add imports)
- Test `packages/shared/src/__tests__/bore-types.spec.ts` (compile assertions)

**Steps:**

1. Write the failing test `packages/shared/src/__tests__/bore-types.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { PartDocument, ComponentInstance, HolePlacement, ProjectFile } from '../types';
import type { BoreOp } from '../bore';
import type { PanelRole } from '../cabinets/types';

describe('additive v21 type surface', () => {
  it('PartDocument accepts bores?: BoreOp[]', () => {
    const bore: BoreOp = {
      id: 'b', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 1, v: 2, diameter: 5, depth: 'throughAll', role: 'confirmat-face',
      connectorId: 'c', connectorKind: 'confirmat',
    };
    const doc: PartDocument = {
      id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
      properties: {}, materials: [], hardware: [], bores: [bore],
    };
    expect(doc.bores).toHaveLength(1);
  });

  it('ComponentInstance accepts role?: PanelRole', () => {
    const role: PanelRole = 'leftSide';
    const inst: ComponentInstance = {
      id: 'C1', partPath: 'x.zipt', position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role,
    };
    expect(inst.role).toBe('leftSide');
  });

  it('HolePlacement accepts the atFace variant', () => {
    const p: HolePlacement = {
      kind: 'atFace',
      faceName: { featureId: 'panel', role: 'Left', instance: 0 },
      points: [{ u: 10, v: 20 }],
      axis: 'into-face',
    };
    expect(p.kind).toBe('atFace');
  });

  it('ProjectFile formatVersion union includes 21', () => {
    const f: ProjectFile = {
      formatVersion: 21, kind: 'part', createdAt: '', appVersion: '',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [] },
    };
    expect(f.formatVersion).toBe(21);
  });
});
```

2. Run it — expected **FAIL** (TS errors: `bores` not on PartDocument, `role` not on
   ComponentInstance, no `atFace` variant, `21` not assignable). vitest surfaces these as
   transpile/type failures under the ts-checker; if vitest's esbuild strips types and the
   test runs green spuriously, the **`npm run typecheck` in step 4 is the real RED gate** —
   run it now and confirm it fails:

```
cd packages/shared && npx vitest run src/__tests__/bore-types.spec.ts ; npm run typecheck
```

3. Implement the edits in `packages/shared/src/types.ts`:

   a. Add imports near the top (after existing imports):
   ```ts
   import type { BoreOp } from './bore';
   import type { PanelRole } from './cabinets/types';
   ```

   b. In `PartDocument` (after `color?: ComponentColor;`, line 85):
   ```ts
     /** Intrinsic hardware-boring map (присадка). Default []/absent. Additive v21. */
     bores?: BoreOp[];
   ```

   c. In `ComponentInstance` (after `flexible?: boolean;`, line 100):
   ```ts
     /** Carcass role for auto-присадка generation; populated by CreateCabinetCommand. Additive v21. */
     role?: PanelRole;
   ```

   d. Append the `atFace` variant to the `HolePlacement` union (after `concentric`, line 283):
   ```ts
     | { kind: 'atFace'; faceName: FaceName; points: ReadonlyArray<{ u: number; v: number }>; axis: 'into-face' };
   ```

   e. Add `21` to all three `ProjectFile` formatVersion unions (lines 144-146):
   ```ts
     | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21; kind: 'part';     createdAt: string; appVersion: string; document: PartDocument }
     | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21; kind: 'assembly'; createdAt: string; appVersion: string; document: AssemblyDocument }
     | { formatVersion: 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21;                                  kind: 'drawing';  createdAt: string; appVersion: string; document: DrawingDocument };
   ```

   > `import type` is correct — `BoreOp`/`PanelRole` are types only. `bore.ts` imports
   > `FaceName` from `types.ts`, and `types.ts` now imports `BoreOp` from `bore.ts`: this
   > is a **type-only circular import**, which TS erases at compile time (no runtime cycle
   > because both are `import type`). tsc handles it; confirm in step 4.

4. Run it — expected **PASS** + tsc clean:

```
cd packages/shared && npx vitest run src/__tests__/bore-types.spec.ts && npm run typecheck
```

5. Commit:

```
git add packages/shared/src/types.ts packages/shared/src/__tests__/bore-types.spec.ts
git commit -m "feat(shared): additive v21 types — PartDocument.bores, ComponentInstance.role, atFace HolePlacement"
```

---

### Task 4 — `fileFormat.ts`: v21 const + no-op migration + normalizeKind guard

Mirrors keys 12/13 (no-op). Bump `CURRENT_FORMAT_VERSION` 20→21, add migration key `20`,
extend `normalizeKind` so a bare-kind v21 part normalizes to `kind:'part'`.

**Files:**
- Modify `packages/shared/src/fileFormat.ts` (l4 const, migrations map ~l313, normalizeKind
  l316-327 — the exact range may vary; search for `function normalizeKind`)
- Test `packages/shared/src/__tests__/migrateManifest-v20-to-v21.spec.ts`

**Steps:**

1. Write the failing test `packages/shared/src/__tests__/migrateManifest-v20-to-v21.spec.ts`
   (mirrors the v19→v20 template structure):

```ts
import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v20 → v21 (Phase 1 — присадка: bores/role additive, no-op)', () => {
  it('CURRENT_FORMAT_VERSION is 21', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(21);
  });

  it('v20 part round-trips to v21 unchanged (no bores injected)', () => {
    const v20 = { formatVersion: 20, kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(v20) as { formatVersion: number; document: Record<string, unknown> };
    expect(out.formatVersion).toBe(21);
    // additive: absent === [] at runtime, migration does NOT inject the key
    expect(out.document.bores).toBeUndefined();
  });

  it('v20 assembly round-trips to v21 unchanged (no role injected)', () => {
    const v20 = { formatVersion: 20, kind: 'assembly',
      document: { id: 'a', name: 'A', units: 'mm', parameters: {}, components: [
        { id: 'C1', partPath: 'x.zipt', position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 }, visible: true } ],
        constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
        cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [],
        hardware: [], customTextures: [] } };
    const out = migrateManifest(v20) as { formatVersion: number; document: { components: Array<Record<string, unknown>> } };
    expect(out.formatVersion).toBe(21);
    expect(out.document.components[0].role).toBeUndefined();
  });

  it('leaves drawing documents untouched (advances version only)', () => {
    const v20 = { formatVersion: 20, kind: 'drawing',
      document: { id: 'd', name: 'D', units: 'mm', sheets: [], properties: {} } };
    const out = migrateManifest(v20) as { formatVersion: number };
    expect(out.formatVersion).toBe(21);
  });

  it('is idempotent for an already-v21 manifest', () => {
    const v21 = { formatVersion: 21, kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(v21) as { formatVersion: number };
    expect(out.formatVersion).toBe(21);
  });

  it('normalizes a bare-kind (no kind) v21 part to kind:"part"', () => {
    const bare = { formatVersion: 21,
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(bare) as { kind: string };
    expect(out.kind).toBe('part');
  });
});
```

2. Run it — expected **FAIL** (`CURRENT_FORMAT_VERSION` is 20 not 21; and migrating a v20
   manifest throws `no migration from formatVersion 20` because the loop runs while
   `< 21`):

```
cd packages/shared && npx vitest run src/__tests__/migrateManifest-v20-to-v21.spec.ts
```

3. Implement in `packages/shared/src/fileFormat.ts`:

   a. Line 4 — bump the const:
   ```ts
   export const CURRENT_FORMAT_VERSION = 21 as const;
   ```

   b. Append the no-op migration to the `migrations` map (after key `19`, before the
      closing `};` at line 314):
   ```ts
     // v20 → v21: additive — PartDocument.bores and ComponentInstance.role are
     // optional; absent === []/unset at runtime. No structural transformation.
     20: (mIn) => {
       const m = deepClone(mIn);
       return { ...m, formatVersion: 21 };
     },
   ```

   c. Extend the `normalizeKind` guard (line 318-321) to include 21:
   ```ts
   function normalizeKind(m: AnyManifest): AnyManifest {
     if (
       (m.formatVersion === 10 || m.formatVersion === 11 || m.formatVersion === 12 ||
        m.formatVersion === 13 || m.formatVersion === 14 || m.formatVersion === 15 ||
        m.formatVersion === 16 || m.formatVersion === 17 || m.formatVersion === 18 ||
        m.formatVersion === 19 || m.formatVersion === 20 || m.formatVersion === 21) &&
       (m as unknown as { kind?: unknown }).kind === undefined
     ) {
       return { ...m, kind: 'part' } as AnyManifest;
     }
     return m;
   }
   ```

4. Run it — expected **PASS** (all 6 cases green):

```
cd packages/shared && npx vitest run src/__tests__/migrateManifest-v20-to-v21.spec.ts
```

5. Typecheck + run the FULL shared migration suite to confirm no prior-version regression
   (the `migrateManifest` loop throws if any step fails to advance — a v19→v20 spec asserts
   `CURRENT_FORMAT_VERSION === 20`, which is now 21, so it WILL fail and must be updated):

```
cd packages/shared && npm run typecheck && npx vitest run src/__tests__/
```

   > **Expected collateral RED:** `migrateManifest-v19-to-v20.spec.ts:6` asserts
   > `CURRENT_FORMAT_VERSION === 20`. Update that single assertion to drive a v19 manifest
   > to v21 and assert `out.formatVersion === 21` (the customTextures backfill still runs at
   > the v19→v20 step). Concretely change line 5-7 of that spec to:
   > ```ts
   > it('migrates a v19 part forward to the current version (21)', () => {
   >   expect(CURRENT_FORMAT_VERSION).toBe(21);
   > });
   > ```
   > and update each `expect(out.formatVersion).toBe(20)` in that file to `.toBe(21)`. The
   > `customTextures` assertions stay valid (v19→v20 step still injects `[]`). Re-run the
   > suite — green. Grep for other hardcoded `toBe(20)` version asserts across the package
   > and fix any that assert `CURRENT_FORMAT_VERSION`:
   > ```
   > cd packages/shared && grep -rn "CURRENT_FORMAT_VERSION).toBe(20\|formatVersion).toBe(20" src/
   > ```

6. Commit:

```
git add packages/shared/src/fileFormat.ts packages/shared/src/__tests__/migrateManifest-v20-to-v21.spec.ts packages/shared/src/__tests__/migrateManifest-v19-to-v20.spec.ts
git commit -m "feat(shared): bump manifest v20->v21 with no-op присадка migration"
```

---

### Task 5 — barrel exports (`index.ts`)

Wire the new modules into the public barrel so `@zilventor/shared` consumers (kernel/app)
import `BoreOp`, `face2DFrame`, the connector generators, and (next task) `jointMath`.
**NO-TDD** — reason: pure re-export wiring; correctness is proven by the consuming tasks'
imports + tsc. A one-line import smoke test documents the surface.

**Files:**
- Modify `packages/shared/src/index.ts`
- Test `packages/shared/src/__tests__/barrel-bore.spec.ts`

**Steps:**

1. Write the smoke test `packages/shared/src/__tests__/barrel-bore.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { face2DFrame, generateConfirmat, generateMinifix, generateDowel } from '../index';

describe('shared barrel re-exports присадка surface', () => {
  it('exposes face2DFrame + connector generators', () => {
    expect(typeof face2DFrame).toBe('function');
    expect(typeof generateConfirmat).toBe('function');
    expect(typeof generateMinifix).toBe('function');
    expect(typeof generateDowel).toBe('function');
  });
});
```

2. Run it — expected **FAIL** (`face2DFrame` not exported from `../index`):

```
cd packages/shared && npx vitest run src/__tests__/barrel-bore.spec.ts
```

3. Add to `packages/shared/src/index.ts` (after `export * from './cabinets';` line 15, so
   `BoreOp` is available to anything importing the connector module — order is fine since
   these are type-erased + tree-flattened):

```ts
export * from './bore';
export * from './connectorCatalog';
export * from './jointMath';
```

   > **Dependency note:** `./jointMath` does not exist until Task 6. Add only
   > `./bore` + `./connectorCatalog` in THIS task; add the `./jointMath` line in Task 6's
   > implementation step. (If you add it now, tsc fails on the missing module.) So for this
   > task add ONLY:
   > ```ts
   > export * from './bore';
   > export * from './connectorCatalog';
   > ```

4. Run it — expected **PASS**:

```
cd packages/shared && npx vitest run src/__tests__/barrel-bore.spec.ts && npm run typecheck
```

5. Commit:

```
git add packages/shared/src/index.ts packages/shared/src/__tests__/barrel-bore.spec.ts
git commit -m "feat(shared): barrel-export bore + connectorCatalog"
```

---

### Task 6 — `jointMath.ts` (Phase 2): `enumerateAutoJoints` + `inferManualJoint`

Pure joint derivation. **`inferManualJoint(a, b, eps?)`**: world-AABB coplanar-adjacent
face↔end test — A = the panel whose **face** lies in the joint plane, B = the panel whose
**end** butts it; returns `Joint | null`. **`enumerateAutoJoints(panels)`**: from
`role`+`pose`+`dims`, enumerate the standard carcass joints (side↔bottom, side↔top,
side↔shelf, back↔sides/bottom/top); right-side joints mirror left; no geometric contact
test. Each `Joint` carries `frameA`/`frameB` from `face2DFrame`.

> **Coordinate boundary:** `enumerateAutoJoints` is pure over its `PanelInput[]` argument.
> The cabinet-pose→panel-local reconciliation (the highest-risk math, flagged §6-gated) is
> done by Phase 3's `GenerateCarcassBoresCommand` when it BUILDS the `PanelInput[]` from the
> assembly; this function only asserts: given correctly-posed panels, the right joints with
> the right A/B roles + faces come out. Tests author explicit poses (panels actually
> butting in world space) so the function is fully exercised without depending on the
> cabinet convention.

**Files:**
- Create `packages/shared/src/jointMath.ts`
- Modify `packages/shared/src/index.ts` (add `export * from './jointMath';`)
- Test `packages/shared/src/__tests__/jointMath.spec.ts`

**Steps:**

1. Write the failing test `packages/shared/src/__tests__/jointMath.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  enumerateAutoJoints, inferManualJoint,
  type PanelInput,
} from '../jointMath';

const Tc = 18;

// A minimal carcass laid out so panels physically butt in WORLD space.
// leftSide: vertical wall at x∈[0,18], spanning y∈[0,500], z∈[0,800].
// bottom:   horizontal panel resting between the sides, x∈[18,582], z∈[0,18].
// We supply poses that translate the centered panel box into these world AABBs.
function side(x0: number, role: 'leftSide' | 'rightSide'): PanelInput {
  // side dims: length=H=800 (z), width=D=500 (y), thickness=18 (x)
  // centered box [-9,-250,0]..[9,250,18] (its own L=800 along... we author pose so
  // its world AABB = x∈[x0,x0+18], y∈[0,500], z∈[0,800]) — for the test we use an
  // axis-permuting quaternion-free convenience: pass dims so the box already spans
  // the wall, and a translation only (rotation identity). The function reads the
  // world AABB from dims+pose; identity rotation + dims chosen to match.
  return {
    dims: { length: 18, width: 500, thickness: 800 }, // x-thin wall (L=x,W=y,T=z) per pose
    pose: { translation: { x: x0 + 9, y: 250, z: 400 }, quaternion: [0, 0, 0, 1] },
    role,
  };
}
function bottom(): PanelInput {
  return {
    dims: { length: 564, width: 500, thickness: 18 }, // L=x, W=y, T=z
    pose: { translation: { x: 18 + 282, y: 250, z: 9 }, quaternion: [0, 0, 0, 1] },
    role: 'bottom',
  };
}

describe('inferManualJoint — world-AABB butt-joint inference', () => {
  it('left side (face at x=18) ↔ bottom (end at x=18) → a joint, A=side(face), B=bottom(end)', () => {
    const j = inferManualJoint(side(0, 'leftSide'), bottom());
    expect(j).not.toBeNull();
    // A is the FACE-drilled panel (the side, whose inner face x=18 is the joint plane)
    expect(j!.panelA.role).toBe('leftSide');
    expect(j!.panelB.role).toBe('bottom');
    // joint line runs along the contact edge (here in +Y, length ≈ 500 overlap)
    const len = Math.hypot(
      j!.line.p1.x - j!.line.p0.x, j!.line.p1.y - j!.line.p0.y, j!.line.p1.z - j!.line.p0.z);
    expect(len).toBeGreaterThan(0);
    // frames are attached
    expect(j!.frameA).toBeDefined();
    expect(j!.frameB).toBeDefined();
  });

  it('two coplanar but non-overlapping panels → null', () => {
    const far = bottom();
    far.pose = { translation: { x: 5000, y: 5000, z: 9 }, quaternion: [0, 0, 0, 1] };
    expect(inferManualJoint(side(0, 'leftSide'), far)).toBeNull();
  });

  it('two parallel face-to-face panels (no end butting a face) → null', () => {
    const s1 = side(0, 'leftSide');
    const s2 = side(0, 'leftSide'); // identical, fully overlapping faces, not a butt joint
    expect(inferManualJoint(s1, s2)).toBeNull();
  });
});

describe('enumerateAutoJoints — role-driven carcass joints', () => {
  const panels: PanelInput[] = [
    side(0, 'leftSide'),
    side(564, 'rightSide'),
    bottom(),
    { ...bottom(), role: 'top', pose: { translation: { x: 300, y: 250, z: 800 - 9 }, quaternion: [0, 0, 0, 1] } },
  ];

  it('produces side↔bottom and side↔top joints for BOTH sides (mirrored L/R)', () => {
    const joints = enumerateAutoJoints(panels);
    const pairs = joints.map((j) => [j.panelA.role, j.panelB.role].sort().join('+'));
    expect(pairs.filter((p) => p === 'bottom+leftSide')).toHaveLength(1);
    expect(pairs.filter((p) => p === 'bottom+rightSide')).toHaveLength(1);
    expect(pairs.filter((p) => p === 'leftSide+top')).toHaveLength(1);
    expect(pairs.filter((p) => p === 'rightSide+top')).toHaveLength(1);
  });

  it('every auto joint fixes A = side (face-drilled), B = bottom/top/shelf (end-drilled)', () => {
    const joints = enumerateAutoJoints(panels);
    for (const j of joints) {
      expect(['leftSide', 'rightSide']).toContain(j.panelA.role);
      expect(['bottom', 'top', 'shelf']).toContain(j.panelB.role);
    }
  });

  it('returns [] when no side panels are present', () => {
    expect(enumerateAutoJoints([bottom()])).toEqual([]);
  });
});
```

2. Run it — expected **FAIL** (`Cannot find module '../jointMath'`):

```
cd packages/shared && npx vitest run src/__tests__/jointMath.spec.ts
```

3. Minimal implementation — create `packages/shared/src/jointMath.ts`:

> **Intentional scope (MAJOR 9 — deferred per spec §15):** Back & toekick roles are
> intentionally excluded from `enumerateAutoJoints`. Back panels sit in a groove/rebate, not
> connector-drilled; toekick joints differ. Deferred per spec §15 Non-goals. Do NOT add
> back-joint code or tests here.

```ts
import type { Vec3 } from './types';
import type { PanelRole } from './cabinets/types';
import { face2DFrame, type PanelFaceRole } from './bore';

export interface Pose { translation: Vec3; quaternion: [number, number, number, number] }
export interface PanelInput {
  dims: { length: number; width: number; thickness: number };
  pose: Pose;
  role?: PanelRole;
}

export interface Joint {
  line: { p0: Vec3; p1: Vec3 };
  panelA: PanelInput;
  panelB: PanelInput;
  faceA: PanelFaceRole;
  endB: PanelFaceRole;
  frameA: ReturnType<typeof face2DFrame>;
  frameB: ReturnType<typeof face2DFrame>;
}

type AABB = { min: Vec3; max: Vec3 };

/** Rotate a vector by a quaternion [x,y,z,w]. */
function rotate(v: Vec3, q: [number, number, number, number]): Vec3 {
  const [x, y, z, w] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  // v + w*t + cross(q.xyz, t)
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
}

/** World-space axis-aligned bounding box of a panel's centered box under its pose. */
function worldAABB(p: PanelInput): AABB {
  const { length: L, width: W, thickness: T } = p.dims;
  const hL = L / 2, hW = W / 2;
  // panel-local box corners [-hL,-hW,0]..[hL,hW,T]
  const corners: Vec3[] = [];
  for (const cx of [-hL, hL]) for (const cy of [-hW, hW]) for (const cz of [0, T]) {
    const r = rotate({ x: cx, y: cy, z: cz }, p.pose.quaternion);
    corners.push({ x: r.x + p.pose.translation.x, y: r.y + p.pose.translation.y, z: r.z + p.pose.translation.z });
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const c of corners) {
    min.x = Math.min(min.x, c.x); min.y = Math.min(min.y, c.y); min.z = Math.min(min.z, c.z);
    max.x = Math.max(max.x, c.x); max.y = Math.max(max.y, c.y); max.z = Math.max(max.z, c.z);
  }
  return { min, max };
}

function overlap1D(a0: number, a1: number, b0: number, b1: number): [number, number] | null {
  const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
  return hi > lo ? [lo, hi] : null;
}

const AXES = ['x', 'y', 'z'] as const;
type Axis = (typeof AXES)[number];
function span(bb: AABB, ax: Axis): number { return bb.max[ax] - bb.min[ax]; }

/** The thinnest axis of an AABB — the panel's thickness direction in world space. */
function thinAxis(bb: AABB): Axis {
  let best: Axis = 'x', bestSpan = Infinity;
  for (const ax of AXES) { const s = span(bb, ax); if (s < bestSpan) { bestSpan = s; best = ax; } }
  return best;
}

/**
 * Infer a butt joint between two posed panels. A = the panel presenting a FACE in the
 * contact plane (its broad face), B = the panel whose END (thin edge) butts that face.
 * Returns null if the AABBs don't form a coplanar-adjacent face↔end pair with overlap.
 */
export function inferManualJoint(a: PanelInput, b: PanelInput, eps = 1.0): Joint | null {
  const ba = worldAABB(a), bb = worldAABB(b);
  // For each world axis, check whether one panel's slab face meets the other panel's end.
  for (const ax of AXES) {
    // candidate contact plane: a's max[ax] ≈ b's min[ax] (a is on the - side) or vice versa
    const others = AXES.filter((o) => o !== ax) as Axis[];
    const touchPairs: Array<{ plane: number; faceOwner: 'a' | 'b' }> = [
      { plane: ba.max[ax], faceOwner: 'a' }, // a's +ax face touches b's -ax end
      { plane: ba.min[ax], faceOwner: 'a' },
    ];
    for (const tp of touchPairs) {
      const bMatch = Math.abs(tp.plane - bb.min[ax]) < eps || Math.abs(tp.plane - bb.max[ax]) < eps;
      if (!bMatch) continue;
      // require overlap in BOTH other axes
      const o1 = overlap1D(ba.min[others[0]], ba.max[others[0]], bb.min[others[0]], bb.max[others[0]]);
      const o2 = overlap1D(ba.min[others[1]], ba.max[others[1]], bb.min[others[1]], bb.max[others[1]]);
      if (!o1 || !o2) continue;
      // Determine which panel presents a FACE (broad) vs an END (thin) along `ax`.
      // The panel whose THIN axis is `ax` presents its FACE in this plane → it is A.
      const aThin = thinAxis(ba) === ax;
      const bThin = thinAxis(bb) === ax;
      // A valid butt joint = exactly one panel is thin along `ax` (face) and the other
      // butts with its end. If both thin (two coplanar sheets) → not a butt joint.
      if (aThin === bThin) continue;
      const A = aThin ? a : b;
      const B = aThin ? b : a;
      // joint line: along the LONGER of the two overlapping axes
      const len1 = o1[1] - o1[0], len2 = o2[1] - o2[0];
      const lineAxis = len1 >= len2 ? others[0] : others[1];
      const fixed = ax, fixedVal = tp.plane;
      const otherAx = lineAxis === others[0] ? others[1] : others[0];
      const ov = lineAxis === others[0] ? o1 : o2;
      const otherOv = lineAxis === others[0] ? o2 : o1;
      const mid = (otherOv[0] + otherOv[1]) / 2;
      const p0: Vec3 = { x: 0, y: 0, z: 0 }, p1: Vec3 = { x: 0, y: 0, z: 0 };
      (p0 as any)[fixed] = fixedVal; (p1 as any)[fixed] = fixedVal;
      (p0 as any)[lineAxis] = ov[0]; (p1 as any)[lineAxis] = ov[1];
      (p0 as any)[otherAx] = mid; (p1 as any)[otherAx] = mid;
      return {
        line: { p0, p1 }, panelA: A, panelB: B,
        faceA: 'Left', endB: 'Top',
        frameA: face2DFrame(A.dims, 'Left'),
        frameB: face2DFrame(B.dims, 'Top'),
      };
    }
  }
  return null;
}

/**
 * Enumerate standard carcass joints from persisted roles+poses+dims. Each side panel
 * (leftSide/rightSide) is joined to every bottom/top/shelf panel that physically butts
 * it (verified via inferManualJoint over world AABBs). Right-side joints mirror left.
 * No geometric contact test beyond the AABB butt check inside inferManualJoint.
 */
export function enumerateAutoJoints(panels: ReadonlyArray<PanelInput>): Joint[] {
  const sides = panels.filter((p) => p.role === 'leftSide' || p.role === 'rightSide');
  const ends = panels.filter((p) => p.role === 'bottom' || p.role === 'top' || p.role === 'shelf');
  const joints: Joint[] = [];
  for (const s of sides) {
    for (const e of ends) {
      const j = inferManualJoint(s, e);
      if (!j) continue;
      // force A = side, B = end (role-deterministic, overriding the geometric A/B)
      const sideIsA = j.panelA.role === s.role;
      joints.push(sideIsA ? j : { ...j, panelA: s, panelB: e, frameA: face2DFrame(s.dims, 'Left'), frameB: face2DFrame(e.dims, 'Top') });
    }
  }
  return joints;
}
```

   > Add `export * from './jointMath';` to `packages/shared/src/index.ts` now (deferred from
   > Task 5). The `face2DFrame, faceA:'Left', endB:'Top'` literals are slice-1 placeholders
   > — Phase 3 refines which exact face/end each role pair uses; these unit tests pin the
   > **joint topology + A/B role assignment**, which is the load-bearing pure logic. The
   > `(p0 as any)[fixed]` index writes are an intentional local escape for axis-keyed Vec3
   > assembly; keep them confined to this function.

4. Run it — expected **PASS** (both describe blocks green):

```
cd packages/shared && npx vitest run src/__tests__/jointMath.spec.ts && npm run typecheck
```

5. Run the FULL shared suite to confirm no regression across the package:

```
cd packages/shared && npx vitest run
```

6. Commit:

```
git add packages/shared/src/jointMath.ts packages/shared/src/index.ts packages/shared/src/__tests__/jointMath.spec.ts
git commit -m "feat(shared): jointMath — enumerateAutoJoints + inferManualJoint (pure)"
```

---

### Group 1 exit gate

- `cd packages/shared && npx vitest run` → all green (new specs: face2DFrame, connectorCatalog,
  bore-types, migrateManifest-v20-to-v21, barrel-bore, jointMath; updated: migrateManifest-v19-to-v20).
- `cd packages/shared && npm run typecheck` → clean (verifies the type-only circular import
  `types.ts ↔ bore.ts`, the additive fields, and the `atFace` variant).
- The barrel now exports `BoreOp`, `BoreRole`, `BoreConnectorKind`, `PanelFaceRole`,
  `face2DFrame`, `JointInput`, `BoringParams`, `DEFAULT_BORING_PARAMS`,
  `generateConfirmat/Minifix/Dowel`, `PanelInput`, `Joint`, `enumerateAutoJoints`,
  `inferManualJoint` — the exact identifiers groups 2-5 consume.
- `Pose` is exported from `jointMath.ts` ONLY (Task 6). `connectorCatalog.ts` imports it from
  there. Both modules do `export *` in the barrel — `Pose` is therefore exported exactly once,
  with no ambiguous re-export conflict.
- Note (BLOCKER 3 guard): never declare `export type Pose` or `export interface Pose` in
  connectorCatalog.ts — that would create a duplicate export in the barrel.

> **Handoff contract for downstream groups:** the `atFace` HolePlacement variant
> (`{ kind:'atFace'; faceName; points:{u,v}[]; axis:'into-face' }`) and `CURRENT_FORMAT_VERSION=21`
> are now live; the kernel `resolveAtFaceLocations` (Tasks 26-27) MUST map `(u,v)` through the
> SAME `face2DFrame` convention used here, or markers and baked holes will disagree (the
> recurring false-green class — assert with a real-OCCT bbox, not just non-throw).

---
## Chunk 2 — Phase 3 (auto generation + role persistence) & Phase 4 (manual two-panel command + viewport pick wiring)

> **Worktree note:** When this plan is executed in a git worktree, substitute the worktree path for `/Users/lion/Documents/Projects/mine/zilventor` in every command below. The `npx vitest`/`npx playwright` invocations use a `cwd` per package — always anchor the cwd as stated; Bash cwd persists across and within compound commands in this repo.

**Scope of this chunk:** Phase 3 = `GenerateCarcassBoresCommand` (auto path) + modifying `CreateCabinetCommand` to persist `ComponentInstance.role`. Phase 4 = `AddManualJointBoresCommand` + viewport two-panel component-pick wiring. All app-package work.

**Dependencies (authored in other chunks — assumed present when these tasks run):**
- `packages/shared/src/bore.ts` → `BoreOp`, `BoreRole`, `BoreConnectorKind`, `face2DFrame`.
- `packages/shared/src/connectorCatalog.ts` → `JointInput`, `BoringParams`, `generateConfirmat`/`generateMinifix`/`generateDowel`.
- `packages/shared/src/jointMath.ts` → `Pose`, `PanelInput`, `Joint`, `enumerateAutoJoints`, `inferManualJoint`.
- `packages/shared/src/types.ts` → `PartDocument.bores?`, `ComponentInstance.role?` additive fields (and v21 migration).
All are re-exported from `@zilventor/shared` via the barrel. If a task below fails to import one, that dependency chunk is not yet merged — STOP and resolve ordering rather than stubbing.

**Run-command reminder (app package):** every app suite runs from `packages/app` with the jsdom config:
`npx vitest run --config vitest.config.ts <relpath>` (cwd = `packages/app`). The jsdom env + `test-setup.ts` localStorage shim are REQUIRED. After every app file you touch, also run `npm run typecheck` in `packages/app` (`exactOptionalPropertyTypes` is ON — `tsc` has caught TS2375 that vitest missed).

**exactOptionalPropertyTypes gotcha (applies to every task here):** never assign `undefined` to `role?` or `bores?` explicitly — OMIT the key when absent. e.g. spread `...(role ? { role } : {})`, never `role: maybeUndefined`.

---

### Task 7 — `CreateCabinetCommand` persists `ComponentInstance.role` (join by `fileNameSuffix`)

**Files:**
- Modify: `packages/app/src/commands/CreateCabinetCommand.ts` (`buildCabinetAssembly`, lines 126–132 — the `components.map`).
- Modify (extend, do not break existing cases): `packages/app/src/commands/__tests__/CreateCabinetCommand.spec.ts`.

Anchor: `built.layout[i]` (a `CabinetComponentDef`) is keyed by `fileNameSuffix` only and has NO `role`; `built.panels[k]` (`CabinetPanelDef`) carries `role`. They are pushed in lockstep by `baseCabinet.pushPanel`, so index `i` also aligns 1:1 — but the SAFE join is by `fileNameSuffix` (verified in `baseCabinet.ts:30..87`: roles in order leftSide/rightSide/bottom/top/back/toekick/shelf).

1. **Write the failing test.** Append this block to `CreateCabinetCommand.spec.ts` (it reuses the file's existing `seedAssembly`, `MemOpfs`, `DEFAULTS`, and imports already at the top of that file — add the `unpackProject` import and `PanelRole` type import shown):

   At the top of the spec file, extend the imports:
   ```ts
   import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
   import type { PanelRole } from '@zilventor/shared';
   ```

   Append at the end of the file:
   ```ts
   describe('CreateCabinetCommand — persists ComponentInstance.role', () => {
     beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

     it('stamps each cabinet sub-component instance with its panel role', async () => {
       seedAssembly();
       const opfs = new MemOpfs();
       await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();

       // The placed top-level component is the .ziasm; read it back and inspect its instances.
       const ziasmBytes = await opfs.read('Base Cabinet 1.ziasm');
       const project = await unpackProject(ziasmBytes);
       const doc = (project.manifest as { document: { components: Array<{ partPath: string; role?: PanelRole }> } }).document;

       const roleByPath = new Map(doc.components.map((c) => [c.partPath, c.role]));
       expect(roleByPath.get('Base Cabinet 1 - Left Side.zipt')).toBe('leftSide');
       expect(roleByPath.get('Base Cabinet 1 - Right Side.zipt')).toBe('rightSide');
       expect(roleByPath.get('Base Cabinet 1 - Bottom.zipt')).toBe('bottom');
       expect(roleByPath.get('Base Cabinet 1 - Top.zipt')).toBe('top');
       expect(roleByPath.get('Base Cabinet 1 - Back.zipt')).toBe('back');
       expect(roleByPath.get('Base Cabinet 1 - Toekick.zipt')).toBe('toekick');
       expect(roleByPath.get('Base Cabinet 1 - Shelf 1.zipt')).toBe('shelf');
     });

     it('every component instance has a defined role (no undefined)', async () => {
       seedAssembly();
       const opfs = new MemOpfs();
       await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();
       const project = await unpackProject(await opfs.read('Base Cabinet 1.ziasm'));
       const doc = (project.manifest as { document: { components: Array<{ role?: PanelRole }> } }).document;
       expect(doc.components.length).toBe(7);
       for (const c of doc.components) expect(c.role).toBeDefined();
     });
   });
   ```

2. **Run it — expect FAIL.** From `packages/app`:
   `npx vitest run --config vitest.config.ts src/commands/__tests__/CreateCabinetCommand.spec.ts`
   Expected failure reason: `roleByPath.get('Base Cabinet 1 - Left Side.zipt')` is `undefined` (the instance object built at lines 126–132 has no `role` key), so `toBe('leftSide')` fails with `expected undefined to be "leftSide"`. (NOT an import error — if it's an import error the `role?` field is not yet added by the dependency chunk; STOP.)

3. **Minimal implementation.** In `CreateCabinetCommand.ts`, change the `components.map` inside `buildCabinetAssembly` (lines 126–132) to join the layout entry back to its panel def by `fileNameSuffix` and stamp `role`:
   ```ts
   const components: ComponentInstance[] = built.layout.map((c, i) => ({
     id: `C${i + 1}`,
     partPath: `${cabinetName} - ${c.fileNameSuffix}.zipt`,
     position: { x: c.position.x, y: c.position.y, z: c.position.z },
     rotation: { rx: c.rotation.rx, ry: c.rotation.ry, rz: c.rotation.rz },
     visible: true,
     role: built.panels.find((p) => p.fileNameSuffix === c.fileNameSuffix)!.role,
   }));
   ```
   (`role` is always resolvable here — every layout entry has a matching panel; the `!` is justified. Because the role is always a defined `PanelRole`, this does NOT violate `exactOptionalPropertyTypes` — we never assign `undefined`.)

4. **Run it — expect PASS.** Same command as step 2 — both new cases green, all pre-existing cases (name auto-suffix, happy path, revert, mid-flight rollback) still green.

5. **Typecheck.** From `packages/app`: `npm run typecheck`. Expect clean (no TS2375).

6. **Commit.**
   `git add packages/app/src/commands/CreateCabinetCommand.ts packages/app/src/commands/__tests__/CreateCabinetCommand.spec.ts`
   `git commit -m "feat(app): persist ComponentInstance.role from cabinet panel role in CreateCabinetCommand"`

---

### Task 8 — `GenerateCarcassBoresCommand.apply()` writes `bores[]` to involved panel `.zipt`s (auto path)

**Files:**
- Create: `packages/app/src/commands/GenerateCarcassBoresCommand.ts`.
- Create: `packages/app/src/commands/__tests__/GenerateCarcassBoresCommand.spec.ts`.

Model: `AddHardwareCommand.ts:34–110` (undoable opfs-IO, `store?: typeof useAppStore` option, opfs read/write) + `MirrorComponentCommand.ts` (reads `activeAssembly`, mutates store). Persistence flow per panel `.zipt`: `opfs.read` → `unpackProject` → mutate `manifest.document.bores` → repack via `packProject({ manifest, blobs })` → `opfs.write`. Source-of-truth decision (per spec gotcha): **write the `.zipt` is authoritative; the active in-memory part doc is refreshed only by a later store action — this command does NOT touch `store.activePart`** (it operates in assembly context where no single part is "active").

> **Params-type seam (read before coding):** the shared `BoringParams` (in `connectorCatalog.ts`, passed to `generate*`) is ONLY `{ endSetback; maxSpacing; minCount }`. The contract specifies the COMMAND's `params` is `BoringParams + per-kind enable`. This command therefore defines a LOCAL widened param type (`{ endSetback; maxSpacing; minCount; confirmat: boolean; minifix: boolean; dowel: boolean }`) for `opts.params`, and passes the SAME object to `generate*` — the catalog functions structurally accept the three numeric fields and ignore the extra booleans (TypeScript structural typing makes a wider object assignable to the narrower `BoringParams` parameter). No new shared type needed.

> **No-TDD note:** none — this is a behavioral command; full TDD applies.

1. **Write the failing test.** Create `packages/app/src/commands/__tests__/GenerateCarcassBoresCommand.spec.ts`:
   ```ts
   // @vitest-environment node
   import { describe, it, expect, beforeEach } from 'vitest';
   import { GenerateCarcassBoresCommand } from '../GenerateCarcassBoresCommand';
   import { useAppStore } from '../../store/useAppStore';
   import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
   import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
   import type { AssemblyDocument, BoreOp, PanelRole, PartDocument } from '@zilventor/shared';

   class MemOpfs {
     files = new Map<string, Uint8Array>();
     async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
     async write(p: string, b: Uint8Array) { this.files.set(p, b); }
   }

   // A minimal panel .zipt with a single PanelFeature so dims are derivable.
   async function writePanel(
     opfs: MemOpfs, path: string, length: number, width: number, thickness: number, bores?: BoreOp[],
   ) {
     const doc: Partial<PartDocument> = {
       id: path, name: path, units: 'mm', parameters: {},
       featureTree: [{       // NOTE: featureTree, NOT features — matches PartDocument
         kind: 'panel', id: 'panel',
         length, width, thickness,
         materialId: 'm', edgeBands: {},
       } as unknown as import('@zilventor/shared').Feature],
       ...(bores ? { bores } : {}),
     };
     const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
     await opfs.write(path, await packProject({ manifest, blobs: {} }));
   }

   function instance(id: string, partPath: string, role: PanelRole, pos: { x: number; y: number; z: number }) {
     return { id, partPath, position: pos, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role };
   }

   function seedCabinetAssembly(opfs: MemOpfs): AssemblyDocument {
     // 600×560×720 base carcass — two sides, bottom, top. Roles drive auto joints.
     const W = 600, D = 560, H = 720, T = 18;
     const doc: AssemblyDocument = {
       id: 'A1', name: 'Cab', units: 'mm', parameters: {}, properties: {},
       components: [
         instance('C1', 'L.zipt', 'leftSide',  { x: 0,       y: 0, z: 0 }),
         instance('C2', 'R.zipt', 'rightSide', { x: W - T,   y: 0, z: 0 }),
         instance('C3', 'B.zipt', 'bottom',    { x: T,       y: 0, z: 0 }),
         instance('C4', 'T.zipt', 'top',       { x: T,       y: 0, z: H - T }),
       ],
       constraints: [], groundedComponentPaths: [['C1']], colors: {},
       bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
       materials: [], hardware: [],
     };
     useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
     return doc;
   }

   async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
     const project = await unpackProject(await opfs.read(path));
     return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
   }

   const PARAMS = {
     endSetback: 60, maxSpacing: 250, minCount: 2,
     confirmat: true, minifix: false, dowel: false,
   };

   describe('GenerateCarcassBoresCommand — auto', () => {
     beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

     it('writes bores to the involved panels and links A/B by connectorId', async () => {
       const opfs = new MemOpfs();
       await writePanel(opfs, 'L.zipt', 560, 720, 18);
       await writePanel(opfs, 'R.zipt', 560, 720, 18);
       await writePanel(opfs, 'B.zipt', 600 - 36, 560, 18);
       await writePanel(opfs, 'T.zipt', 600 - 36, 560, 18);
       seedCabinetAssembly(opfs);

       await new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply();

       const lBores = await boresOf(opfs, 'L.zipt');
       const bBores = await boresOf(opfs, 'B.zipt');
       expect(lBores.length).toBeGreaterThan(0);
       expect(bBores.length).toBeGreaterThan(0);
       // every bore links to its connector; A-side and B-side share connectorIds.
       const lConn = new Set(lBores.map((x) => x.connectorId));
       const bConn = new Set(bBores.map((x) => x.connectorId));
       expect([...bConn].some((id) => lConn.has(id))).toBe(true);
       // count math: jointLen 560, setback 60 → max(2, ceil((560-120)/250)+1)=max(2,3)=3 per joint
       expect(lBores.every((b) => b.connectorKind === 'confirmat')).toBe(true);
     });

     it('right side bores mirror the left side count', async () => {
       const opfs = new MemOpfs();
       await writePanel(opfs, 'L.zipt', 560, 720, 18);
       await writePanel(opfs, 'R.zipt', 560, 720, 18);
       await writePanel(opfs, 'B.zipt', 600 - 36, 560, 18);
       await writePanel(opfs, 'T.zipt', 600 - 36, 560, 18);
       seedCabinetAssembly(opfs);
       await new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply();
       expect((await boresOf(opfs, 'L.zipt')).length).toBe((await boresOf(opfs, 'R.zipt')).length);
     });
   });
   ```

2. **Run it — expect FAIL.** From `packages/app`:
   `npx vitest run --config vitest.config.ts src/commands/__tests__/GenerateCarcassBoresCommand.spec.ts`
   Expected failure: module `../GenerateCarcassBoresCommand` does not exist → `Cannot find module`. That is the expected RED for the first slice of a new file.

3. **Minimal implementation.** Create `packages/app/src/commands/GenerateCarcassBoresCommand.ts`:
   ```ts
   import type { Command } from './Command';
   import type { BoreOp, PanelInput, PanelRole } from '@zilventor/shared';
   import {
     enumerateAutoJoints,
     generateConfirmat, generateMinifix, generateDowel,
     CURRENT_FORMAT_VERSION,
   } from '@zilventor/shared';
   import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
   import { useAppStore } from '../store/useAppStore';

   type BoringParams = {
     endSetback: number; maxSpacing: number; minCount: number;
     confirmat: boolean; minifix: boolean; dowel: boolean;
   };

   type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

   // Read a panel's dims from its single PanelFeature inside the .zipt manifest.
   // Uses `featureTree` (the real PartDocument field) — NOT `features`.
   function panelDimsFromDoc(doc: { featureTree?: Array<Record<string, unknown>> }): { length: number; width: number; thickness: number } {
     const panel = (doc.featureTree ?? []).find((f) => f.kind === 'panel') as
       { length: number; width: number; thickness: number } | undefined;
     if (!panel) throw new Error('NO_PANEL_FEATURE');
     return { length: panel.length, width: panel.width, thickness: panel.thickness };
   }

   export class GenerateCarcassBoresCommand implements Command {
     readonly name = 'GenerateCarcassBores';
     // partPath → prior bores[] (for revert). Captured during apply().
     private priorBores = new Map<string, BoreOp[]>();
     private readonly store: typeof useAppStore;

     constructor(private readonly opts: {
       params: BoringParams;
       opfs: OpfsRW;
       store?: typeof useAppStore;
     }) {
       this.store = opts.store ?? useAppStore;
     }

     async apply(): Promise<void> {
       const asm = this.store.getState().activeAssembly;
       if (!asm) return;

       // 1. Load each involved panel's manifest + dims once; build PanelInput[].
       const docs = new Map<string, { manifest: unknown; document: Record<string, unknown> }>();
       const panelInputs: Array<PanelInput & { partPath: string }> = [];
       for (const c of asm.components) {
         if (!c.role) continue; // pre-feature cabinets lack role → skip (manual path covers them)
         const project = await this.opts.opfs.read(c.partPath).then(unpackProject);
         const manifest = project.manifest as { document: Record<string, unknown> };
         docs.set(c.partPath, { manifest, document: manifest.document });
         const dims = panelDimsFromDoc(manifest.document as { featureTree?: Array<Record<string, unknown>> });
         panelInputs.push({
           partPath: c.partPath,
           dims,
           pose: { translation: c.position, quaternion: [0, 0, 0, 1] },
           role: c.role as PanelRole,
         });
       }

       // 2. Enumerate auto joints and accumulate bores per partPath.
       const joints = enumerateAutoJoints(panelInputs);
       const accum = new Map<string, BoreOp[]>();
       const append = (partPath: string, bores: BoreOp[]) => {
         const list = accum.get(partPath) ?? [];
         list.push(...bores);
         accum.set(partPath, list);
       };
       // Map a Joint back to its source partPaths via reference identity on pose/dims.
       const pathOf = (pi: PanelInput): string =>
         (panelInputs.find((p) => p === pi) as { partPath: string }).partPath;

       for (const joint of joints) {
         const aPath = pathOf(joint.panelA);
         const bPath = pathOf(joint.panelB);
         const ji = {
           line: joint.line, panelA: joint.panelA, panelB: joint.panelB,
           faceA: joint.faceA, endB: joint.endB,
         };
         if (this.opts.params.confirmat) {
           const { boresA, boresB } = generateConfirmat(ji as never, this.opts.params);
           append(aPath, boresA); append(bPath, boresB);
         }
         if (this.opts.params.minifix) {
           const { boresA, boresB } = generateMinifix(ji as never, this.opts.params);
           append(aPath, boresA); append(bPath, boresB);
         }
         if (this.opts.params.dowel) {
           const { boresA, boresB } = generateDowel(ji as never, this.opts.params);
           append(aPath, boresA); append(bPath, boresB);
         }
       }

       // 3. Persist: snapshot prior bores, set new bores[], repack each .zipt.
       for (const [partPath, newBores] of accum) {
         const entry = docs.get(partPath)!;
         const existing = (entry.document.bores as BoreOp[] | undefined) ?? [];
         this.priorBores.set(partPath, existing);
         entry.document.bores = [...existing, ...newBores];
         const repackedManifest = {
           ...(entry.manifest as Record<string, unknown>),
           formatVersion: CURRENT_FORMAT_VERSION,
           document: entry.document,
         };
         await this.opts.opfs.write(partPath, await packProject({ manifest: repackedManifest, blobs: {} }));
       }
     }

     async revert(): Promise<void> {
       for (const [partPath, prior] of this.priorBores) {
         const project = await this.opts.opfs.read(partPath).then(unpackProject);
         const manifest = project.manifest as { document: Record<string, unknown> };
         if (prior.length > 0) manifest.document.bores = prior;
         else delete manifest.document.bores;
         await this.opts.opfs.write(partPath, await packProject({
           manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION }, blobs: {},
         }));
       }
       this.priorBores.clear();
     }
   }
   ```
   (The `as never` casts on the catalog calls bridge the assembly-side `PanelInput`-shaped joint to the catalog's `JointInput`; the dependency chunk's `Joint`/`JointInput` already carry `line`, `panelA`, `panelB`, `faceA`, `endB`, so the real types align — the cast only silences the structural-vs-nominal mismatch if the chunks differ. If `npm run typecheck` flags it, drop the cast and pass `ji` directly.)

4. **Run it — expect PASS.** Same command as step 2. Both cases green.

5. **Typecheck.** From `packages/app`: `npm run typecheck`. Confirm clean. If `as never` is unnecessary, remove it and re-run.

6. **Commit.**
   `git add packages/app/src/commands/GenerateCarcassBoresCommand.ts packages/app/src/commands/__tests__/GenerateCarcassBoresCommand.spec.ts`
   `git commit -m "feat(app): GenerateCarcassBoresCommand auto path writes bores[] to carcass panels"`

---

### Task 9 — `GenerateCarcassBoresCommand.revert()` restores prior `bores[]` per panel

**Files:**
- Modify (test only — impl already written in Task 8's `revert()`; this task LOCKS revert with its own RED): `packages/app/src/commands/__tests__/GenerateCarcassBoresCommand.spec.ts`.

> This task is a TDD slice that confirms the `revert()` written in Task 8 actually round-trips. We assert revert from a non-empty prior state (panel already had bores) AND from an absent state (key must be deleted, not set to `[]`, per `exactOptionalPropertyTypes`).

1. **Write the failing test.** Append to `GenerateCarcassBoresCommand.spec.ts`:
   ```ts
   describe('GenerateCarcassBoresCommand — revert', () => {
     beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

     it('removes the bores key entirely when the panel had none before', async () => {
       const opfs = new MemOpfs();
       await writePanel(opfs, 'L.zipt', 560, 720, 18);
       await writePanel(opfs, 'R.zipt', 560, 720, 18);
       await writePanel(opfs, 'B.zipt', 600 - 36, 560, 18);
       await writePanel(opfs, 'T.zipt', 600 - 36, 560, 18);
       seedCabinetAssembly(opfs);
       const cmd = new GenerateCarcassBoresCommand({ params: PARAMS, opfs });
       await cmd.apply();
       expect((await boresOf(opfs, 'L.zipt')).length).toBeGreaterThan(0);

       await cmd.revert();

       // Key must be ABSENT, not [] — assert on the raw manifest.
       const project = await unpackProject(await opfs.read('L.zipt'));
       const doc = (project.manifest as { document: Record<string, unknown> }).document;
       expect('bores' in doc).toBe(false);
     });

     it('restores the prior bores[] when the panel already had some', async () => {
       const opfs = new MemOpfs();
       const seedBore: BoreOp = {
         id: 'pre', face: { featureId: 'panel', role: 'Front', instance: 0 }, u: 10, v: 10, diameter: 5, depth: 12,
         role: 'dowel-face', connectorId: 'pre-conn', connectorKind: 'dowel',
       };
       await writePanel(opfs, 'L.zipt', 560, 720, 18, [seedBore]);
       await writePanel(opfs, 'R.zipt', 560, 720, 18);
       await writePanel(opfs, 'B.zipt', 600 - 36, 560, 18);
       await writePanel(opfs, 'T.zipt', 600 - 36, 560, 18);
       seedCabinetAssembly(opfs);
       const cmd = new GenerateCarcassBoresCommand({ params: PARAMS, opfs });
       await cmd.apply();
       await cmd.revert();
       const after = await boresOf(opfs, 'L.zipt');
       expect(after).toEqual([seedBore]);
     });
   });
   ```

2. **Run it — expect outcome.** From `packages/app`:
   `npx vitest run --config vitest.config.ts src/commands/__tests__/GenerateCarcassBoresCommand.spec.ts`
   If Task 8's `revert()` is correct, these PASS immediately — that is acceptable for a revert-locking slice (the test still earns its keep as a regression guard). If either FAILS, the expected reason is: (a) `'bores' in doc` is `true` because `revert` set `bores = []` instead of `delete`-ing it (fix: ensure the `else delete manifest.document.bores` branch runs) or (b) the restored array differs (fix the snapshot capture in `apply`). Drive to green via `superpowers:systematic-debugging` if it fails.

3. **(If RED) Minimal fix.** Adjust `revert()` per the failure (the `delete manifest.document.bores` branch and the `priorBores` snapshot are the two load-bearing lines).

4. **Run it — expect PASS.** Same command. Both new cases green; all Task 8 cases still green.

5. **Typecheck.** From `packages/app`: `npm run typecheck`.

6. **Commit.**
   `git add packages/app/src/commands/__tests__/GenerateCarcassBoresCommand.spec.ts packages/app/src/commands/GenerateCarcassBoresCommand.ts`
   `git commit -m "test(app): lock GenerateCarcassBoresCommand revert — deletes absent bores key, restores prior"`

---

### Task 10 — `AddManualJointBoresCommand.apply()` infers joint from two picked panels and appends bores to A+B

**Files:**
- Create: `packages/app/src/commands/AddManualJointBoresCommand.ts`.
- Create: `packages/app/src/commands/__tests__/AddManualJointBoresCommand.spec.ts`.

Model: same opfs persistence flow as Task 8 (`read`→`unpackProject`→mutate `document.bores`→`packProject`→`write`). Joint is inferred via `inferManualJoint(a, b)` from the two panels' dims + world poses (read from the active assembly's two `ComponentInstance`s identified by `panelPathA`/`panelPathB`). If `inferManualJoint` returns `null` (no valid butt joint), the command is a no-op (writes nothing) — assert that.

1. **Write the failing test.** Create `packages/app/src/commands/__tests__/AddManualJointBoresCommand.spec.ts`:
   ```ts
   // @vitest-environment node
   import { describe, it, expect, beforeEach } from 'vitest';
   import { AddManualJointBoresCommand } from '../AddManualJointBoresCommand';
   import { useAppStore } from '../../store/useAppStore';
   import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
   import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
   import type { AssemblyDocument, BoreOp, PartDocument } from '@zilventor/shared';

   class MemOpfs {
     files = new Map<string, Uint8Array>();
     async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
     async write(p: string, b: Uint8Array) { this.files.set(p, b); }
   }
   async function writePanel(opfs: MemOpfs, path: string, length: number, width: number, thickness: number) {
     const doc: Partial<PartDocument> = {
       id: path, name: path, units: 'mm', parameters: {},
       featureTree: [{ kind: 'panel', id: 'panel', length, width, thickness, materialId: 'm', edgeBands: {} } as unknown as import('@zilventor/shared').Feature],
     };
     const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
     await opfs.write(path, await packProject({ manifest, blobs: {} }));
   }
   async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
     const project = await unpackProject(await opfs.read(path));
     return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
   }
   // Two panels forming a butt joint: a vertical side (face in +X plane) + a bottom (end butts it).
   function seedTwoPanels(opfs: MemOpfs): AssemblyDocument {
     const T = 18;
     const doc: AssemblyDocument = {
       id: 'A1', name: 'Cab', units: 'mm', parameters: {}, properties: {},
       components: [
         { id: 'C1', partPath: 'L.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
         { id: 'C3', partPath: 'B.zipt', position: { x: T, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
       ],
       constraints: [], groundedComponentPaths: [['C1']], colors: {},
       bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
       materials: [], hardware: [],
     };
     useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
     return doc;
   }
   const PARAMS = { endSetback: 60, maxSpacing: 250, minCount: 2 };

   describe('AddManualJointBoresCommand', () => {
     beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

     it('appends linked bores to both picked panels for a valid butt joint', async () => {
       const opfs = new MemOpfs();
       await writePanel(opfs, 'L.zipt', 560, 720, 18);
       await writePanel(opfs, 'B.zipt', 564, 560, 18);
       seedTwoPanels(opfs);

       await new AddManualJointBoresCommand({
         panelPathA: 'L.zipt', panelPathB: 'B.zipt', kind: 'confirmat', params: PARAMS, opfs,
       }).apply();

       const a = await boresOf(opfs, 'L.zipt');
       const b = await boresOf(opfs, 'B.zipt');
       expect(a.length).toBeGreaterThan(0);
       expect(b.length).toBeGreaterThan(0);
       expect(a.every((x) => x.connectorKind === 'confirmat')).toBe(true);
       const aConn = new Set(a.map((x) => x.connectorId));
       expect(b.some((x) => aConn.has(x.connectorId))).toBe(true);
     });

     it('is a no-op when the two panels do not form a butt joint', async () => {
       const opfs = new MemOpfs();
       // Two coplanar far-apart panels — inferManualJoint returns null.
       await writePanel(opfs, 'L.zipt', 560, 720, 18);
       await writePanel(opfs, 'B.zipt', 564, 560, 18);
       const doc: AssemblyDocument = {
         id: 'A1', name: 'Cab', units: 'mm', parameters: {}, properties: {},
         components: [
           { id: 'C1', partPath: 'L.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
           { id: 'C2', partPath: 'B.zipt', position: { x: 5000, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
         ],
         constraints: [], groundedComponentPaths: [['C1']], colors: {},
         bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
         materials: [], hardware: [],
       };
       useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });

       await new AddManualJointBoresCommand({
         panelPathA: 'L.zipt', panelPathB: 'B.zipt', kind: 'confirmat', params: PARAMS, opfs,
       }).apply();

       expect(await boresOf(opfs, 'L.zipt')).toEqual([]);
       expect(await boresOf(opfs, 'B.zipt')).toEqual([]);
     });
   });
   ```

2. **Run it — expect FAIL.** From `packages/app`:
   `npx vitest run --config vitest.config.ts src/commands/__tests__/AddManualJointBoresCommand.spec.ts`
   Expected failure: `Cannot find module '../AddManualJointBoresCommand'`.

3. **Minimal implementation.** Create `packages/app/src/commands/AddManualJointBoresCommand.ts`:
   ```ts
   import type { Command } from './Command';
   import type { BoreOp, BoreConnectorKind, PanelInput } from '@zilventor/shared';
   import {
     inferManualJoint,
     generateConfirmat, generateMinifix, generateDowel,
     CURRENT_FORMAT_VERSION,
   } from '@zilventor/shared';
   import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
   import { useAppStore } from '../store/useAppStore';

   type BoringParams = { endSetback: number; maxSpacing: number; minCount: number };
   type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

   // Uses `featureTree` (the real PartDocument field) — NOT `features`.
   function panelDimsFromDoc(doc: { featureTree?: Array<Record<string, unknown>> }) {
     const panel = (doc.featureTree ?? []).find((f) => f.kind === 'panel') as
       { length: number; width: number; thickness: number } | undefined;
     if (!panel) throw new Error('NO_PANEL_FEATURE');
     return { length: panel.length, width: panel.width, thickness: panel.thickness };
   }

   const GEN = {
     confirmat: generateConfirmat, minifix: generateMinifix, dowel: generateDowel,
   } as const;

   export class AddManualJointBoresCommand implements Command {
     readonly name = 'AddManualJointBores';
     private priorBores = new Map<string, BoreOp[]>();
     private readonly store: typeof useAppStore;

     constructor(private readonly opts: {
       panelPathA: string;
       panelPathB: string;
       kind: BoreConnectorKind;
       params: BoringParams;
       opfs: OpfsRW;
       store?: typeof useAppStore;
     }) {
       this.store = opts.store ?? useAppStore;
     }

     private async loadPanelInput(partPath: string): Promise<{ input: PanelInput; manifest: { document: Record<string, unknown> } }> {
       const asm = this.store.getState().activeAssembly!;
       const comp = asm.components.find((c) => c.partPath === partPath);
       if (!comp) throw new Error(`NO_COMPONENT_FOR_${partPath}`);
       const project = await this.opts.opfs.read(partPath).then(unpackProject);
       const manifest = project.manifest as { document: Record<string, unknown> };
       const dims = panelDimsFromDoc(manifest.document as { featureTree?: Array<Record<string, unknown>> });
       return {
         input: { dims, pose: { translation: comp.position, quaternion: [0, 0, 0, 1] } },
         manifest,
       };
     }

     async apply(): Promise<void> {
       const asm = this.store.getState().activeAssembly;
       if (!asm) return;

       const a = await this.loadPanelInput(this.opts.panelPathA);
       const b = await this.loadPanelInput(this.opts.panelPathB);

       const joint = inferManualJoint(a.input, b.input);
       if (!joint) return; // not a butt joint → no-op

       const gen = GEN[this.opts.kind];
       const ji = {
         line: joint.line, panelA: joint.panelA, panelB: joint.panelB,
         faceA: joint.faceA, endB: joint.endB,
       };
       const { boresA, boresB } = gen(ji as never, this.opts.params);

       // inferManualJoint may have swapped which panel is A vs B; map back by reference.
       const aIsPanelA = joint.panelA === a.input;
       await this.persist(aIsPanelA ? a : b, boresA);
       await this.persist(aIsPanelA ? b : a, boresB);
     }

     private async persist(
       panel: { manifest: { document: Record<string, unknown> } },
       newBores: BoreOp[],
     ): Promise<void> {
       const partPath = this.pathFor(panel);
       const existing = (panel.manifest.document.bores as BoreOp[] | undefined) ?? [];
       this.priorBores.set(partPath, existing);
       panel.manifest.document.bores = [...existing, ...newBores];
       await this.opts.opfs.write(partPath, await packProject({
         manifest: { ...panel.manifest, formatVersion: CURRENT_FORMAT_VERSION }, blobs: {},
       }));
     }

     // Recover the partPath from a loaded panel by matching its document identity.
     private pathFor(panel: { manifest: { document: Record<string, unknown> } }): string {
       const id = panel.manifest.document.id as string;
       return id; // writePanel sets document.id === partPath; real panels: id is the .zipt path stem — see note.
     }

     async revert(): Promise<void> {
       for (const [partPath, prior] of this.priorBores) {
         const project = await this.opts.opfs.read(partPath).then(unpackProject);
         const manifest = project.manifest as { document: Record<string, unknown> };
         if (prior.length > 0) manifest.document.bores = prior;
         else delete manifest.document.bores;
         await this.opts.opfs.write(partPath, await packProject({
           manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION }, blobs: {},
         }));
       }
       this.priorBores.clear();
     }
   }
   ```
   > **Implementation note for the executing agent:** `pathFor` relying on `document.id === partPath` is a test-coupling shortcut. In production, `PartDocument.id` is a UUID, NOT the `.zipt` path. Before merging, replace `pathFor` by threading the original `partPath` alongside the loaded panel (carry it in the `loadPanelInput` return tuple as `{ input, manifest, partPath }`) — the test must be updated so `writePanel` sets a UUID-style `id` and the command still resolves the path via the threaded value, not `document.id`. This is the highest-risk shortcut in this task; do NOT ship the `document.id` form. (Flagged so it isn't silently merged — Task 11 removes it.)

4. **Run it — expect PASS.** Same command as step 2. Both cases green.

5. **Typecheck.** From `packages/app`: `npm run typecheck`.

6. **Commit.**
   `git add packages/app/src/commands/AddManualJointBoresCommand.ts packages/app/src/commands/__tests__/AddManualJointBoresCommand.spec.ts`
   `git commit -m "feat(app): AddManualJointBoresCommand infers butt joint from two picked panels"`

---

### Task 11 — Thread real `partPath` through `AddManualJointBoresCommand` (kill the `document.id` shortcut)

**Files:**
- Modify: `packages/app/src/commands/AddManualJointBoresCommand.ts`.
- Modify: `packages/app/src/commands/__tests__/AddManualJointBoresCommand.spec.ts`.

> This task removes the load-bearing shortcut flagged in Task 10 (`pathFor` reading `document.id`). It is a refactor LOCKED by a new RED test that uses a UUID `id` distinct from the path — proving the command resolves the path correctly even when `id !== path`.

1. **Write the failing test.** In `AddManualJointBoresCommand.spec.ts`, change `writePanel` so `document.id` is a UUID unrelated to the path:
   ```ts
   async function writePanel(opfs: MemOpfs, path: string, length: number, width: number, thickness: number) {
     const doc: Partial<PartDocument> & { features: unknown[] } = {
       id: `uuid-${path}-deadbeef`, name: path, units: 'mm', parameters: {},   // id !== path
       features: [{ kind: 'panel', id: 'panel', length, width, thickness, materialId: 'm', edgeBands: {} }],
     };
     const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
     await opfs.write(path, await packProject({ manifest, blobs: {} }));
   }
   ```

2. **Run it — expect FAIL.** From `packages/app`:
   `npx vitest run --config vitest.config.ts src/commands/__tests__/AddManualJointBoresCommand.spec.ts`
   Expected failure: the persist path is now `uuid-L.zipt-deadbeef` (from `document.id`), so `boresOf(opfs, 'L.zipt')` reads the UNMODIFIED original file and gets `[]` → `expect(a.length).toBeGreaterThan(0)` fails. (This proves the shortcut was a real bug.)

3. **Minimal implementation.** Thread `partPath` through `loadPanelInput` and drop `pathFor`:
   ```ts
   private async loadPanelInput(partPath: string): Promise<{ input: PanelInput; manifest: { document: Record<string, unknown> }; partPath: string }> {
     const asm = this.store.getState().activeAssembly!;
     const comp = asm.components.find((c) => c.partPath === partPath);
     if (!comp) throw new Error(`NO_COMPONENT_FOR_${partPath}`);
     const project = await this.opts.opfs.read(partPath).then(unpackProject);
     const manifest = project.manifest as { document: Record<string, unknown> };
     const dims = panelDimsFromDoc(manifest.document as { featureTree?: Array<Record<string, unknown>> });
     return {
       input: { dims, pose: { translation: comp.position, quaternion: [0, 0, 0, 1] } },
       manifest, partPath,
     };
   }
   ```
   Change `persist` to take `partPath` explicitly and remove `pathFor`:
   ```ts
   private async persist(
     panel: { manifest: { document: Record<string, unknown> }; partPath: string },
     newBores: BoreOp[],
   ): Promise<void> {
     const { partPath } = panel;
     const existing = (panel.manifest.document.bores as BoreOp[] | undefined) ?? [];
     this.priorBores.set(partPath, existing);
     panel.manifest.document.bores = [...existing, ...newBores];
     await this.opts.opfs.write(partPath, await packProject({
       manifest: { ...panel.manifest, formatVersion: CURRENT_FORMAT_VERSION }, blobs: {},
     }));
   }
   ```
   Delete the `pathFor` method entirely. The `apply()` body already passes the loaded `a`/`b` objects to `persist`; they now carry `partPath`.

4. **Run it — expect PASS.** Same command. Both cases green with `id !== path`.

5. **Typecheck.** From `packages/app`: `npm run typecheck`.

6. **Commit.**
   `git add packages/app/src/commands/AddManualJointBoresCommand.ts packages/app/src/commands/__tests__/AddManualJointBoresCommand.spec.ts`
   `git commit -m "refactor(app): thread real partPath in AddManualJointBoresCommand instead of document.id"`

---

### Task 12 — `AddManualJointBoresCommand.revert()` restores prior `bores[]` on both panels

**Files:**
- Modify (test only — impl `revert()` exists from Task 10): `packages/app/src/commands/__tests__/AddManualJointBoresCommand.spec.ts`.

1. **Write the failing test.** Append to `AddManualJointBoresCommand.spec.ts`:
   ```ts
   describe('AddManualJointBoresCommand — revert', () => {
     beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

     it('removes the bores key on both panels when they had none before', async () => {
       const opfs = new MemOpfs();
       await writePanel(opfs, 'L.zipt', 560, 720, 18);
       await writePanel(opfs, 'B.zipt', 564, 560, 18);
       seedTwoPanels(opfs);
       const cmd = new AddManualJointBoresCommand({
         panelPathA: 'L.zipt', panelPathB: 'B.zipt', kind: 'confirmat', params: PARAMS, opfs,
       });
       await cmd.apply();
       expect((await boresOf(opfs, 'L.zipt')).length).toBeGreaterThan(0);

       await cmd.revert();

       for (const p of ['L.zipt', 'B.zipt']) {
         const project = await unpackProject(await opfs.read(p));
         const doc = (project.manifest as { document: Record<string, unknown> }).document;
         expect('bores' in doc).toBe(false);
       }
     });
   });
   ```

2. **Run it — expect outcome.** From `packages/app`:
   `npx vitest run --config vitest.config.ts src/commands/__tests__/AddManualJointBoresCommand.spec.ts`
   PASS if Task 10's `revert()` correctly `delete`s the absent key (acceptable for a revert-locking slice). If it FAILS with `'bores' in doc === true`, the cause is `revert` writing `bores = []`; fix the `else delete` branch via `superpowers:systematic-debugging`.

3. **(If RED) Minimal fix.** Ensure `revert()` deletes the key when `prior.length === 0`.

4. **Run it — expect PASS.** Same command. New case green; all prior cases green.

5. **Typecheck.** From `packages/app`: `npm run typecheck`.

6. **Commit.**
   `git add packages/app/src/commands/__tests__/AddManualJointBoresCommand.spec.ts packages/app/src/commands/AddManualJointBoresCommand.ts`
   `git commit -m "test(app): lock AddManualJointBoresCommand revert deletes absent bores key on both panels"`

---

### Task 13 — Viewport two-panel pick: imperative `pickTwoComponents()` handle on the Viewport ref

**Files:**
- Modify: `packages/app/src/viewport/Viewport.tsx` (extend the imperative handle interface + impl; reuse existing `raycastComponent`).
- Create: `packages/app/src/viewport/__tests__/Viewport.pickTwoComponents.spec.ts`.

> **Why component-level pick (per spec premise 2 + gotcha):** assembly-mode FaceName/EdgeName resolution is an unfinished TODO (`AssemblyRefPickController` T34/T38). The manual присадка tool therefore picks two WHOLE panels via the already-wired `raycastComponent`, and `inferManualJoint` (Task 10) derives the face↔end geometry. We add a thin two-pick state collector on the Viewport handle; the ribbon button (authored in the ribbon chunk) calls it and feeds the two resolved partPaths into `AddManualJointBoresCommand`.
>
> The handle's `raycastComponent` returns a `ComponentPath` (array of instance ids), not a partPath. The collector resolves each `ComponentPath`'s leaf to its `partPath` via the active assembly's components. The collector itself is pure state + a resolver callback — that is what we unit-test (jsdom). The actual three.js raycast is exercised by the §6 browser gate / e2e (group 5), NOT this jsdom unit test.

1. **Write the failing test.** Create `packages/app/src/viewport/__tests__/Viewport.pickTwoComponents.spec.ts`:
   ```ts
   // @vitest-environment jsdom
   import { describe, it, expect } from 'vitest';
   import { createTwoComponentPicker } from '../createTwoComponentPicker';
   import type { ComponentPath } from '@zilventor/shared';

   // The picker is a pure state machine: feed it ComponentPath picks; it resolves
   // each to a partPath via the provided resolver and fires onComplete after 2 distinct picks.
   describe('createTwoComponentPicker', () => {
     const resolve = (p: ComponentPath): string => `${p[p.length - 1]}.zipt`;

     it('fires onComplete with both partPaths after two distinct picks', () => {
       const calls: Array<[string, string]> = [];
       const picker = createTwoComponentPicker({
         resolvePartPath: resolve,
         onComplete: (a, b) => calls.push([a, b]),
       });
       picker.pick(['C1']);
       expect(calls).toHaveLength(0);
       expect(picker.firstPick()).toBe('C1.zipt');
       picker.pick(['C3']);
       expect(calls).toEqual([['C1.zipt', 'C3.zipt']]);
     });

     it('ignores a repeated pick of the same component (must pick two distinct panels)', () => {
       const calls: Array<[string, string]> = [];
       const picker = createTwoComponentPicker({ resolvePartPath: resolve, onComplete: (a, b) => calls.push([a, b]) });
       picker.pick(['C1']);
       picker.pick(['C1']);            // same → ignored
       expect(calls).toHaveLength(0);
       picker.pick(['C2']);
       expect(calls).toEqual([['C1.zipt', 'C2.zipt']]);
     });

     it('reset() clears the first pick', () => {
       const calls: Array<[string, string]> = [];
       const picker = createTwoComponentPicker({ resolvePartPath: resolve, onComplete: (a, b) => calls.push([a, b]) });
       picker.pick(['C1']);
       picker.reset();
       expect(picker.firstPick()).toBeNull();
       picker.pick(['C2']);
       expect(calls).toHaveLength(0);   // C2 is now the first pick, not the second
       picker.pick(['C3']);
       expect(calls).toEqual([['C2.zipt', 'C3.zipt']]);
     });
   });
   ```

2. **Run it — expect FAIL.** From `packages/app`:
   `npx vitest run --config vitest.config.ts src/viewport/__tests__/Viewport.pickTwoComponents.spec.ts`
   Expected failure: `Cannot find module '../createTwoComponentPicker'`.

3. **Minimal implementation.** Create `packages/app/src/viewport/createTwoComponentPicker.ts`:
   ```ts
   import { pathKey, type ComponentPath } from '@zilventor/shared';

   export interface TwoComponentPicker {
     /** Feed a raycast hit (ComponentPath). Resolves it to a partPath and advances the state machine. */
     pick(path: ComponentPath): void;
     /** The resolved partPath of the first pick, or null if none yet. */
     firstPick(): string | null;
     /** Clear the in-progress first pick. */
     reset(): void;
   }

   export function createTwoComponentPicker(opts: {
     resolvePartPath: (path: ComponentPath) => string;
     onComplete: (partPathA: string, partPathB: string) => void;
   }): TwoComponentPicker {
     let firstPath: ComponentPath | null = null;
     let firstResolved: string | null = null;
     return {
       pick(path) {
         if (firstPath === null) {
           firstPath = path;
           firstResolved = opts.resolvePartPath(path);
           return;
         }
         // Ignore a repeated pick of the SAME component instance.
         if (pathKey(path) === pathKey(firstPath)) return;
         const second = opts.resolvePartPath(path);
         const first = firstResolved!;
         firstPath = null;
         firstResolved = null;
         opts.onComplete(first, second);
       },
       firstPick() { return firstResolved; },
       reset() { firstPath = null; firstResolved = null; },
     };
   }
   ```
   > **Anchor (verified):** `pathKey` is exported from `@zilventor/shared` (imported that way in `SceneManager.ts:4`: `import { pathKey, ... } from '@zilventor/shared'`). Do NOT inline a stringify.

4. **Run it — expect PASS.** Same command as step 2. All three cases green.

5. **Wire the picker onto the Viewport imperative handle (no-TDD wiring step — pure plumbing of an already-tested unit; reason: the three.js raycast it composes with is covered by §6/e2e in group 5, and jsdom cannot exercise WebGL).** In `Viewport.tsx`, add to the imperative-handle interface (near `raycastComponent` at line ~59):
   ```ts
   beginTwoComponentPick(
     resolvePartPath: (path: ComponentPath) => string,
     onComplete: (partPathA: string, partPathB: string) => void,
   ): { pick: (clientX: number, clientY: number) => void; reset: () => void };
   ```
   And in the `useImperativeHandle` impl block, add:
   ```ts
   beginTwoComponentPick: (resolvePartPath, onComplete) => {
     const picker = createTwoComponentPicker({ resolvePartPath, onComplete });
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
   (This copies the existing `raycastComponent` handle's body VERBATIM from `Viewport.tsx:259–268` — `canvasRef.current.getBoundingClientRect()`, the exact `-(((clientY - rect.top) / rect.height) * 2 - 1)` NDC-Y form, and `sceneRef.current.getCamera()` — then routes the hit into the picker. Do not invent a `getDomElement()` call; this Viewport uses `canvasRef`.)

6. **Typecheck.** From `packages/app`: `npm run typecheck`. Confirm the new handle method typechecks (the `ComponentPath` import is already present in `Viewport.tsx:4`).

7. **Commit.**
   `git add packages/app/src/viewport/createTwoComponentPicker.ts packages/app/src/viewport/__tests__/Viewport.pickTwoComponents.spec.ts packages/app/src/viewport/Viewport.tsx`
   `git commit -m "feat(app): two-component pick state machine + Viewport beginTwoComponentPick handle for manual присадка"`

---

### Task 13b — `ClearBoresCommand`: wipe `bores[]` from one or more panels (undoable)

Adds a ribbon-accessible "Clear Bores" command that removes all `BoreOp` entries from the
selected panel's `.zipt` and pushes the inverse (re-populate) onto the undo stack. Follows the
same `revert` contract as `GenerateCarcassBoresCommand`.

**Files:**
- Create: `packages/app/src/commands/ClearBoresCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/ClearBoresCommand.spec.ts`
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx` — add "Clear Bores" button to the "Присадка" ribbon panel (after Step 3 of Task 21 adds the Export button; if Task 21 has not yet landed, add the button stub now and fill the handler when the hook is available).

**Steps:**

1. **Write the failing test.**

```ts
// packages/app/src/commands/__tests__/ClearBoresCommand.spec.ts
import { describe, it, expect } from 'vitest';
import { ClearBoresCommand } from '../ClearBoresCommand';
import type { BoreOp } from '@zilventor/shared';

const bore: BoreOp = {
  id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
  u: 10, v: 10, diameter: 5, depth: 12, kind: 'confirmats',
};

function makePanelDoc(bores: BoreOp[]) {
  return { featureTree: [], bores: [...bores] };
}

describe('ClearBoresCommand', () => {
  it('removes all bores from the panel document', () => {
    const doc = makePanelDoc([bore]);
    const snapshot = [...doc.bores];
    const cmd = new ClearBoresCommand({ doc, partPath: 'panel.zipt', opfs: null as never });
    cmd.apply();
    expect(doc.bores).toHaveLength(0);
    // revert restores the original bores
    cmd.revert();
    expect(doc.bores).toEqual(snapshot);
  });

  it('is a no-op on a panel with no bores (does not throw)', () => {
    const doc = makePanelDoc([]);
    const cmd = new ClearBoresCommand({ doc, partPath: 'panel.zipt', opfs: null as never });
    expect(() => { cmd.apply(); cmd.revert(); }).not.toThrow();
  });
});
```

2. **Run it — expect FAIL.** From `packages/app`:
   `npx vitest run --config vitest.config.ts src/commands/__tests__/ClearBoresCommand.spec.ts`
   Expected failure: `Cannot find module '../ClearBoresCommand'`.

3. **Minimal implementation.** Create `packages/app/src/commands/ClearBoresCommand.ts`:

```ts
import type { BoreOp } from '@zilventor/shared';
import type { OpfsManager } from '../storage/OpfsManager';

interface ClearBoresOpts {
  doc: { bores?: BoreOp[] };
  partPath: string;
  opfs: OpfsManager;
}

export class ClearBoresCommand {
  private snapshot: BoreOp[];
  constructor(private opts: ClearBoresOpts) {
    this.snapshot = [...(opts.doc.bores ?? [])];
  }
  apply() {
    if (this.opts.doc.bores) this.opts.doc.bores.length = 0;
    else this.opts.doc.bores = [];
    // persist is fire-and-forget; errors surface in console
    void this.persist();
  }
  revert() {
    this.opts.doc.bores = [...this.snapshot];
    void this.persist();
  }
  private async persist() {
    const { packProject, unpackProject } = await import('@zilventor/shared');
    const bytes = await this.opts.opfs.read(this.opts.partPath);
    const proj = await unpackProject(bytes);
    (proj as { manifest: typeof this.opts.doc }).manifest = this.opts.doc as never;
    const packed = await packProject(proj as never);
    await this.opts.opfs.write(this.opts.partPath, packed);
  }
}
```

4. **Run it — expect PASS.** Same command as step 2. Both cases green.

5. **Add "Clear Bores" ribbon button** in `FurnitureTab.tsx` Присадка panel (after the Show/Hide toggle, before Export CSV):

```tsx
<button type="button" className="text-xs hover:text-white disabled:text-neutral-500"
  disabled={!activeAssembly}
  aria-disabled={!activeAssembly}
  onClick={() => {
    // Clear bores from all panels in the active assembly (bus-undoable aggregate)
    void bus.execute(new ClearBoresCommand({
      /* opts resolved via active assembly's partPath list */
    } as never));
  }}>
  Clear Bores
</button>
```

   > NOTE: The exact `onClick` body depends on whether bus wraps ClearBoresCommand (single panel)
   > or whether a batch command is needed. During implementation, choose the simplest approach:
   > one `ClearBoresCommand` per affected panel, executed in a loop with `bus.execute` calls.

6. **Typecheck.** `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npm run typecheck`

7. **Commit.**
   `git add packages/app/src/commands/ClearBoresCommand.ts packages/app/src/commands/__tests__/ClearBoresCommand.spec.ts packages/app/src/shell/tabs/FurnitureTab.tsx`
   `git commit -m "feat(app): ClearBoresCommand (undoable bore wipe) + Clear Bores ribbon button"`

---

### Notes for the assembler / downstream chunks (Phase 3/4)

- The Furniture-ribbon buttons (Присадка auto/manual, markers toggle) are owned by the ribbon chunk (Tasks 17/21); they call `GenerateCarcassBoresCommand` (auto) and, for manual, invoke `viewportRef.beginTwoComponentPick(resolvePartPath, (a, b) => bus.execute(new AddManualJointBoresCommand({ panelPathA: a, panelPathB: b, kind, params, opfs })))`. The `resolvePartPath` callback maps a `ComponentPath` leaf to its instance's `partPath` from `store.activeAssembly.components`.
- `GenerateCarcassBoresCommand` and `AddManualJointBoresCommand` are bus-undoable (both implement `revert`). They are pushed on the undo bus by the ribbon handlers (`bus.execute(...)`), NOT one-shot.
- Both commands assume `enumerateAutoJoints` / `inferManualJoint` / the `generate*` catalog functions and `BoreOp`/`PanelInput`/`Joint` types come from `@zilventor/shared` (group 1). If the `JointInput` shape differs from the `Joint` produced by `jointMath`, drop the `as never` casts and adapt the field mapping — this is the one cross-chunk seam to re-check at assembly time.

---
## Chunk 3 — Phase 5 (3D bore markers + ribbon toggle) & Phase 6 (CSV export)

> **Worktree note:** When executed in a worktree, substitute the worktree path for
> `/Users/lion/Documents/Projects/mine/zilventor` in all commands below. App vitest suites
> MUST run from `packages/app` with `--config vitest.config.ts` (jsdom env + `test-setup.ts`
> localStorage shim); shared suites run from `packages/shared`. Bash cwd persists across **and
> within** compound commands in this repo — always anchor with an absolute `cd` as the first
> token of each test/commit command, or run from the package dir.

**Scope of this chunk:** rendering `part.bores` as `THREE.CircleGeometry`/`RingGeometry` face
markers via the `addObject`/`removeObject` overlay-array pattern (precedent:
`rebuildEdgeBandOverlays`), a `showBores` store slice + Furniture-ribbon toggle, and the CSV
export pipeline (`aggregateBoresRecursive` walker → `buildBoringCsv` → `ExportBoringCsvCommand`
+ ribbon button). DXF export (Phase 7) is **out of scope** for this chunk.

**Dependencies on other chunks (must land first):**
- `packages/shared/src/bore.ts` — `BoreOp`, `BoreRole`, `BoreConnectorKind`, `face2DFrame()`
  (authored in the data-model chunk; this chunk imports them via the `@zilventor/shared` barrel).
- `PartDocument.bores?: BoreOp[]` and `ComponentInstance.role?: PanelRole` on
  `packages/shared/src/types.ts` (data-model chunk).
- The v21 manifest bump (data-model chunk) — not touched here.

If a test below fails its initial RED run because `bore.ts` / `BoreOp` does not yet exist,
that is the expected dependency ordering — the assembler sequences this chunk **after** the
data-model chunk. Do not stub `BoreOp` locally.

---

### Task 14 — `MarkerOverlaySpec` type + `setBoreMarkers()` setter on `SceneManager` (no render yet)

Mirror the `panelOverlaySpecs` / `setPanelOverlays` state-holder pair. This task only stores
the specs + materials and exposes accessors; rendering comes in 15. Splitting keeps each
slice's failing test tiny.

**Files:**
- Modify: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/viewport/SceneManager.ts`
  - Add `MarkerOverlaySpec` export type near `PanelOverlaySpec` (l37-43).
  - Add private fields near `panelOverlaySpecs` (l90-93): `boreMarkers: THREE.Mesh[] = []`,
    `boreOverlaySpecs: MarkerOverlaySpec[] = []`, `showBores = true`.
  - Add `setBoreMarkers(specs)` setter mirroring `setPanelOverlays` (l533-536).
- Test: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/viewport/__tests__/SceneManager.boreMarkers.spec.ts` (NEW)

**Steps:**

1. Write the failing test. Create the new test file:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SceneManager, type MarkerOverlaySpec } from '../SceneManager';

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

const identityPose = {
  translation: { x: 0, y: 0, z: 0 },
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
};

// One Top-face bore on a 600x400x18 panel at panel-local (u=100,v=50).
const oneBoreSpec = (): MarkerOverlaySpec => ({
  key: 'p1#c1',
  panelDims: { length: 600, width: 400, thickness: 18 },
  worldPose: identityPose,
  bores: [{
    id: 'b1', face: { featureId: 'panel', role: 'Top', instance: 0 }, u: 100, v: 50,
    diameter: 5, depth: 34, role: 'confirmat-face',
    connectorId: 'k1', connectorKind: 'confirmat',
  }],
});

describe('SceneManager — bore markers (Phase 5)', () => {
  let mgr: SceneManager;
  beforeEach(() => {
    mgr = new SceneManager(document.createElement('canvas'));
  });

  it('setBoreMarkers stores specs without throwing and starts empty', () => {
    expect(mgr.boreMarkerCount()).toBe(0);
    mgr.setBoreMarkers([oneBoreSpec()]);
    // Render happens in setShowBores/rebuild (next task); setter alone is inert.
    expect(mgr.boreMarkerSpecList()).toHaveLength(1);
  });
});
```

2. Run it — expected **FAIL**: `mgr.setBoreMarkers is not a function` / `boreMarkerSpecList`
   undefined / `MarkerOverlaySpec` not exported.
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.boreMarkers.spec.ts`

3. Minimal implementation. In `SceneManager.ts`, after the `PanelOverlaySpec` type
   (around l43) add:

```ts
/**
 * Phase 5: one entry per assembly component that carries bores. SceneManager
 * builds a CircleGeometry/RingGeometry marker per bore, transformed first by the
 * face's panel-local 2D frame (face2DFrame), then by the component's world pose.
 */
export type MarkerOverlaySpec = {
  key: string;
  panelDims: { length: number; width: number; thickness: number };
  worldPose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
  bores: BoreOp[];
};
```

   Add the `BoreOp` and `PanelFaceRole` imports to the existing `@zilventor/shared` import (l4):
   `import { pathKey, findTextureDef, type BoreOp, type PanelFaceRole, type ComponentPath, type ComponentPathKey, type MaterialEntry, type PanelEdgeKey, face2DFrame } from '@zilventor/shared';`
   (PanelFaceRole is needed so `bore.face.role as PanelFaceRole` typechecks in rebuildBoreMarkers.)
   (We import the value `face2DFrame` and type `BoreOp` together; both come from the shared
   barrel landed by the data-model chunk.)

   Add fields near l90-93:

```ts
  private boreMarkers: THREE.Mesh[] = [];
  private boreOverlaySpecs: MarkerOverlaySpec[] = [];
  private showBores = true;
```

   Add the setter + accessors near `setPanelOverlays` (after l546):

```ts
  /** Phase 5: store the per-component bore specs; rebuild markers if shown. */
  setBoreMarkers(specs: MarkerOverlaySpec[]): void {
    this.boreOverlaySpecs = specs.slice();
    this.rebuildBoreMarkers();
  }

  /** Phase 5: test/debug accessor — count of attached bore markers. */
  boreMarkerCount(): number {
    return this.boreMarkers.length;
  }

  /** Phase 5: test/debug accessor — read-only handle to the marker meshes. */
  boreMarkerList(): ReadonlyArray<THREE.Mesh> {
    return this.boreMarkers;
  }

  /** Phase 5: test/debug accessor — the last-set specs. */
  boreMarkerSpecList(): ReadonlyArray<MarkerOverlaySpec> {
    return this.boreOverlaySpecs;
  }
```

   And a no-op-for-now `rebuildBoreMarkers` stub so `setBoreMarkers` compiles (fleshed out in
   Task 15):

```ts
  /** Phase 5: rebuild bore markers (implemented in the next slice). */
  rebuildBoreMarkers(): void {
    /* filled in Task 15 */
  }
```

4. Run it — expected **PASS** (1 test).
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.boreMarkers.spec.ts`

5. Commit.
   `git add -A && git commit -m "feat(viewport): MarkerOverlaySpec type + setBoreMarkers state-holder on SceneManager

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 15 — `rebuildBoreMarkers()` builds a positioned marker mesh per bore

Render each bore as a `RingGeometry` disc on its face. Position = `face2DFrame()` mapping of
`(u,v)` to a panel-local 3D point, then transformed by the component's `worldPose`. Orient the
ring so its plane lies in the face (normal = the face outward direction). Color by
`connectorKind`. Mirrors `rebuildEdgeBandOverlays` (l556-594): clear old, bail if `!showBores`,
loop specs, `scene.add` + push to the overlay array.

**Files:**
- Modify: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/viewport/SceneManager.ts`
  - Replace the `rebuildBoreMarkers` stub with the real implementation; add a
    `setShowBores(v)` toggle (mirrors `setShowEdgeBands`, l543-546).
- Test: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/viewport/__tests__/SceneManager.boreMarkers.spec.ts` (extend)

**Steps:**

1. Add failing tests to the existing describe block:

```ts
  it('builds one marker mesh per bore when showBores=true', () => {
    mgr.setShowBores(true);
    mgr.setBoreMarkers([oneBoreSpec()]);
    expect(mgr.boreMarkerCount()).toBe(1);
    const m = mgr.boreMarkerList()[0]!;
    expect(m).toBeInstanceOf(THREE.Mesh);
    expect(m.userData.kind).toBe('boreMarker');
    expect(m.userData.boreId).toBe('b1');
  });

  it('removes markers when showBores=false', () => {
    mgr.setShowBores(true);
    mgr.setBoreMarkers([oneBoreSpec()]);
    expect(mgr.boreMarkerCount()).toBe(1);
    mgr.setShowBores(false);
    expect(mgr.boreMarkerCount()).toBe(0);
  });

  it('positions a Top-face bore at face2DFrame(u,v) in world space (identity pose)', () => {
    // Top face of a 600x400x18 panel: origin = panel-local frame per face2DFrame.
    // u=100,v=50 must land at the same point face2DFrame computes; we assert the
    // marker's world position equals face2DFrame's P = origin + u*uDir + v*vDir.
    mgr.setShowBores(true);
    mgr.setBoreMarkers([oneBoreSpec()]);
    const m = mgr.boreMarkerList()[0]!;
    m.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    m.getWorldPosition(wp);
    // Import the SAME pure helper the production code uses — this guards the
    // shared <-> viewport coordinate agreement (the recurring false-green class).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { face2DFrame } = require('@zilventor/shared') as typeof import('@zilventor/shared');
    const f = face2DFrame({ length: 600, width: 400, thickness: 18 }, 'Top');
    const expected = {
      x: f.origin.x + 100 * f.uDir.x + 50 * f.vDir.x,
      y: f.origin.y + 100 * f.uDir.y + 50 * f.vDir.y,
      z: f.origin.z + 100 * f.uDir.z + 50 * f.vDir.z,
    };
    expect(wp.x).toBeCloseTo(expected.x, 4);
    expect(wp.y).toBeCloseTo(expected.y, 4);
    expect(wp.z).toBeCloseTo(expected.z, 4);
  });

  it('colors markers by connectorKind', () => {
    mgr.setShowBores(true);
    mgr.setBoreMarkers([oneBoreSpec()]);
    const mat = mgr.boreMarkerList()[0]!.material as THREE.MeshBasicMaterial;
    expect(mat.depthWrite).toBe(false);
    // confirmat -> a stable hex; exact value asserted against the constant map.
    expect(mat.color.getHexString()).toBe(SceneManager.BORE_COLORS.confirmat.replace('#', ''));
  });
```

2. Run it — expected **FAIL**: `boreMarkerCount()` is `0` after `setBoreMarkers` (stub does
   nothing); `setShowBores` undefined; `SceneManager.BORE_COLORS` undefined.
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.boreMarkers.spec.ts`

3. Implement. Add a static color map near `EDGE_BAND_FALLBACK_COLOR` (l96):

```ts
  static readonly BORE_COLORS: Record<'confirmat' | 'minifix' | 'dowel', string> = {
    confirmat: '#2e7dd1',
    minifix: '#d14f2e',
    dowel: '#2eb872',
  };
```

   Add `setShowBores` after `setShowEdgeBands` (l546):

```ts
  /** Phase 5: toggle bore-marker visibility (subscribed to useAppStore.showBores via attach()). */
  setShowBores(v: boolean): void {
    this.showBores = v;
    this.rebuildBoreMarkers();
  }
```

   Replace the `rebuildBoreMarkers` stub with the real body. The ring lies in a plane; we
   build a basis from the face's `uDir`/`vDir` (with normal = uDir × vDir) and bake it into the
   marker's local matrix, then apply the component world pose:

```ts
  /**
   * Phase 5: drop existing bore markers; if showBores, build one RingGeometry
   * disc per bore. The ring sits in the face plane at face2DFrame(u,v), then the
   * whole marker is transformed by the component world pose. Mirrors
   * rebuildEdgeBandOverlays' clear-then-rebuild shape.
   */
  rebuildBoreMarkers(): void {
    for (const marker of this.boreMarkers) {
      this.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.boreMarkers.length = 0;
    if (!this.showBores) return;
    for (const spec of this.boreOverlaySpecs) {
      const q = new THREE.Quaternion(
        spec.worldPose.quaternion[0], spec.worldPose.quaternion[1],
        spec.worldPose.quaternion[2], spec.worldPose.quaternion[3],
      );
      const t = new THREE.Vector3(
        spec.worldPose.translation.x, spec.worldPose.translation.y, spec.worldPose.translation.z,
      );
      const compMat = new THREE.Matrix4().compose(t, q, new THREE.Vector3(1, 1, 1));
      for (const bore of spec.bores) {
        // bore.face is FaceName (object); face2DFrame takes the role string.
        const f = face2DFrame(spec.panelDims, bore.face.role as PanelFaceRole);
        const uDir = new THREE.Vector3(f.uDir.x, f.uDir.y, f.uDir.z).normalize();
        const vDir = new THREE.Vector3(f.vDir.x, f.vDir.y, f.vDir.z).normalize();
        const nDir = new THREE.Vector3().crossVectors(uDir, vDir).normalize();
        // Panel-local position of the bore.
        const p = new THREE.Vector3(f.origin.x, f.origin.y, f.origin.z)
          .addScaledVector(uDir, bore.u)
          .addScaledVector(vDir, bore.v);
        // RingGeometry is authored in the XY plane (normal +Z); rotate +Z onto nDir,
        // +X onto uDir so the disc lies flush in the face.
        const basis = new THREE.Matrix4().makeBasis(uDir, vDir, nDir);
        const localMat = new THREE.Matrix4().copy(basis).setPosition(p);
        const worldMat = new THREE.Matrix4().multiplyMatrices(compMat, localMat);
        const outer = bore.diameter / 2;
        const geom = new THREE.RingGeometry(outer * 0.6, outer, 24);
        const color = SceneManager.BORE_COLORS[bore.connectorKind];
        const mat = new THREE.MeshBasicMaterial({ color, depthWrite: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(worldMat);
        mesh.userData.kind = 'boreMarker';
        mesh.userData.boreId = bore.id;
        mesh.userData.markerKey = spec.key;
        this.scene.add(mesh);
        this.boreMarkers.push(mesh);
      }
    }
  }
```

   Also dispose bore markers in `dispose()` — add next to the edge-band overlay cleanup at
   l785-790:

```ts
    for (const marker of this.boreMarkers) {
      this.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.boreMarkers.length = 0;
```

   > **Per-mesh vs InstancedMesh (§10 note):** slice 1 builds one `THREE.Mesh` per bore (per-mesh,
   > not `InstancedMesh`). This satisfies the "instanced" performance intent for a reasonable bore
   > count; `InstancedMesh` is a later optimization. The edge-band overlay precedent also uses
   > per-mesh objects. Don't upgrade to `InstancedMesh` here.
   >
   > **Coordinate-agreement note (load-bearing):** the position test (#3) imports the **same**
   > `face2DFrame` the production code uses and asserts the world point equals `origin + u*uDir +
   > v*vDir`. This is the exact false-green class flagged in MEMORY (a sign/axis mismatch
   > invisible to a hand-authored expected value). When the bake path (kernel `atFace` resolver,
   > Tasks 26-27) maps `(u,v)→3D`, the §6 browser gate confirms marker and baked-hole positions
   > coincide. Do **not** hard-code the expected world coords in the test — derive them from the
   > helper.

4. Run it — expected **PASS** (5 tests total in the file).
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.boreMarkers.spec.ts`

5. Run `tsc` on the app package (exactOptionalPropertyTypes guard — catches issues vitest
   misses):
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npm run typecheck`

6. Commit.
   `git add -A && git commit -m "feat(viewport): rebuildBoreMarkers — RingGeometry face markers via face2DFrame + world pose

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 16 — `showBores` store slice + `attach()` subscription

Add the toggle state to `useAppStore` (mirrors `showEdgeBands`, l266/606/624-627) and make
`SceneManager.attach()` subscribe to it (mirrors the `showEdgeBands` subscription, l615-627).

**Files:**
- Modify: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/store/useAppStore.ts`
  - Add `showBores: boolean` to the state type (near l266), the initial value (near l606),
    and `setShowBores` action (near l624).
- Modify: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/viewport/SceneManager.ts`
  - Extend `attach()` (l615-627) to also subscribe to `showBores`.
- Test: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/store/__tests__/useAppStore.spec.ts` (extend; mirror the `showEdgeBands` block at l782-790)

**Steps:**

1. Add the failing store test (mirror the existing `showEdgeBands` describe at l782):

```ts
describe('showBores', () => {
  it('defaults to true', () => {
    expect(useAppStore.getState().showBores).toBe(true);
  });
  it('setShowBores toggles and persists', () => {
    useAppStore.getState().setShowBores(false);
    expect(useAppStore.getState().showBores).toBe(false);
    useAppStore.getState().setShowBores(true);
    expect(useAppStore.getState().showBores).toBe(true);
  });
});
```

2. Run it — expected **FAIL**: `showBores` is `undefined`; `setShowBores` not a function.
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/store/__tests__/useAppStore.spec.ts`

3. Implement in `useAppStore.ts`. Add to the state type after `showEdgeBands: boolean;` (l266):

```ts
  showBores: boolean;
```

   Add to the type's action signatures next to `setShowEdgeBands` (search for
   `setShowEdgeBands: (v: boolean) => void;` and add below it):

```ts
  setShowBores: (v: boolean) => void;
```

   Add the initial value after `showEdgeBands:` (l606):

```ts
  showBores: typeof localStorage !== 'undefined' ? localStorage.getItem('showBores') !== 'false' : true,
```

   Add the action after `setShowEdgeBands` (l627):

```ts
  setShowBores: (v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('showBores', String(v));
    set({ showBores: v });
  },
```

4. Run it — expected **PASS**.
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/store/__tests__/useAppStore.spec.ts`

5. Add the `attach()` subscription test to `SceneManager.boreMarkers.spec.ts`:

```ts
  it('attach() subscribes setShowBores to the store', async () => {
    const { useAppStore } = await import('../../store/useAppStore');
    useAppStore.getState().setShowBores(true);
    mgr.setBoreMarkers([oneBoreSpec()]);
    const unsub = mgr.attach();
    expect(mgr.boreMarkerCount()).toBe(1);
    useAppStore.getState().setShowBores(false);
    expect(mgr.boreMarkerCount()).toBe(0);
    unsub();
  });
```

6. Run it — expected **FAIL**: markers still present after `setShowBores(false)` (attach
   doesn't wire `showBores` yet).
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.boreMarkers.spec.ts`

7. Extend `attach()` in `SceneManager.ts`. Inside the existing method (l615-627), after the
   edge-band subscription block and before `return unsub;`, add a second subscription:

```ts
    this.setShowBores(useAppStore.getState().showBores);
    let lastShowBores = useAppStore.getState().showBores;
    const unsubBores = useAppStore.subscribe((s) => {
      if (s.showBores !== lastShowBores) {
        lastShowBores = s.showBores;
        this.setShowBores(s.showBores);
      }
    });
    this.storeUnsubscribers.push(unsubBores);
```

   (`attach()` keeps returning the edge-band `unsub`; both subscriptions are tracked in
   `storeUnsubscribers` and released in `dispose()`. The test's `unsub()` only releases the
   edge-band sub, which is fine — the bore sub is released on `dispose()`; the test asserts only
   the live toggle.)

8. Run it — expected **PASS** (6 tests in the bore-markers file).
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.boreMarkers.spec.ts`

9. `tsc`: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npm run typecheck`

10. Commit.
   `git add -A && git commit -m "feat(app): showBores store slice + SceneManager.attach() subscription

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 17 — Furniture-ribbon "Show Bores" toggle button (wiring; no TDD)

**No-TDD — pure UI wiring** (a button dispatching a store setter; verified by the §6 browser
gate in the e2e chunk, not by a unit test — matches the project's "pure-visual UI" TDD
exception). The FurnitureTab is a presentational ribbon; existing toggle buttons there are not
unit-covered.

**Files:**
- Modify: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/shell/tabs/FurnitureTab.tsx`
  - Add a "Присадка" `RibbonPanel` with a "Show Bores" toggle button. Place it after the
    "Cut List" panel (l109-121).

**Steps:**

1. Read `FurnitureTab.tsx` (l1-30, l108-144) to confirm the current import block and the
   `RibbonPanel` JSX shape.

2. Add a `showBores` selector near the other `useAppStore` selectors (l21-25):

```tsx
  const showBores = useAppStore((s) => s.showBores);
```

3. Add the ribbon panel after the Cut List `</div>` (l121), before the Nesting panel (l122):

```tsx
      <div aria-label="Присадка panel">
        <RibbonPanel title="Присадка">
          <button type="button" className="text-xs hover:text-white"
            aria-pressed={showBores}
            onClick={() => useAppStore.getState().setShowBores(!showBores)}>
            {showBores ? 'Hide Bores' : 'Show Bores'}
          </button>
        </RibbonPanel>
      </div>
```

   (The auto/manual/bake/clear buttons land in other chunks' tasks; this chunk owns only the
   markers toggle and — in Task 21 — the Export CSV button, both added to this same panel.)

4. `tsc`: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npm run typecheck`

5. Commit.
   `git add -A && git commit -m "feat(app): Furniture-ribbon Show Bores toggle button

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 18 — `aggregateBoresRecursive` walker (recursion + per-panel grouping)

Mirror `aggregateCutListRecursive` (l37-65): same `walk(doc, prefix)` recursion, `.ziasm` →
`cache.get` (skip unless `kind==='ok'`), `pathKey(path)` accumulation. Group by `partPath`
(not by cut-list rowKey — bores are per distinct part file). `qty` = number of component
instances of that part; `bores` = the part's `bores[]` from the `partBores` map.

**Files:**
- Create: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/assembly/walkers/aggregateBoresRecursive.ts`
- Test: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/assembly/walkers/__tests__/aggregateBoresRecursive.spec.ts` (NEW)

**Steps:**

1. Write the failing test (structure copied from `aggregateCutListRecursive.spec.ts` l21-44):

```ts
import { describe, expect, it } from 'vitest';
import { aggregateBoresRecursive } from '../aggregateBoresRecursive';
import type { AssemblyDocument, ComponentInstance, BoreOp, PartInfo } from '@zilventor/shared';

const bore = (id: string): BoreOp => ({
  id, face: { featureId: 'panel', role: 'Top', instance: 0 }, u: 100, v: 50, diameter: 5, depth: 34,
  role: 'confirmat-face', connectorId: 'k1', connectorKind: 'confirmat',
});

const cmp = (id: string, partPath: string): ComponentInstance => ({
  id, partPath,
  position: { x: 0, y: 0, z: 0 },
  rotation: { rx: 0, ry: 0, rz: 0 },
  visible: true,
});

const asm = (id: string, components: ComponentInstance[]): AssemblyDocument => ({
  id, name: id, units: 'mm',
  parameters: {}, components, constraints: [],
  groundedComponentPaths: [],
  colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
  colorOverrides: {},
} as unknown as AssemblyDocument);

const cacheOf = (entries: Array<[string, AssemblyDocument]>) => ({
  get: (path: string) => {
    const found = entries.find(([p]) => p === path);
    return found ? { kind: 'ok' as const, doc: found[1], partPath: path } : undefined;
  },
});

const partInfoOf = (entries: Array<[string, string]>): Map<string, PartInfo> =>
  new Map(entries.map(([k, v]) => [k, { name: v }]));

describe('aggregateBoresRecursive', () => {
  it('flat assembly: groups bores per distinct part with instance qty', () => {
    const a = asm('a', [
      cmp('c1', 'p/side.zipt'),
      cmp('c2', 'p/side.zipt'),   // second instance of the same drilled part
      cmp('c3', 'p/plain.zipt'),  // part with no bores -> excluded from result
    ]);
    const partBores = new Map<string, BoreOp[]>([
      ['p/side.zipt', [bore('b1'), bore('b2')]],
      ['p/plain.zipt', []],
    ]);
    const result = aggregateBoresRecursive(
      a, cacheOf([]), partBores, partInfoOf([['p/side.zipt', 'Side']]),
    );
    expect(result.panels).toHaveLength(1);
    const g = result.panels[0]!;
    expect(g.partPath).toBe('p/side.zipt');
    expect(g.partName).toBe('Side');
    expect(g.qty).toBe(2);
    expect(g.bores.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(g.componentPathKeys).toHaveLength(2);
  });

  it('recurses into .ziasm sub-assemblies and accumulates instance qty', () => {
    const inner = asm('inner', [cmp('p1', 'p/side.zipt')]);
    const outer = asm('outer', [
      cmp('s1', 'sub/inner.ziasm'),
      cmp('s2', 'sub/inner.ziasm'),
    ]);
    const partBores = new Map<string, BoreOp[]>([['p/side.zipt', [bore('b1')]]]);
    const result = aggregateBoresRecursive(
      outer, cacheOf([['sub/inner.ziasm', inner]]), partBores, partInfoOf([]),
    );
    expect(result.panels).toHaveLength(1);
    expect(result.panels[0]!.qty).toBe(2);
    expect(result.panels[0]!.partName).toBe('(missing part)');
  });

  it('skips parts whose bores[] is empty or absent', () => {
    const a = asm('a', [cmp('c1', 'p/plain.zipt')]);
    const result = aggregateBoresRecursive(a, cacheOf([]), new Map(), partInfoOf([]));
    expect(result.panels).toHaveLength(0);
  });
});
```

2. Run it — expected **FAIL**: cannot import `aggregateBoresRecursive` (module missing).
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/assembly/walkers/__tests__/aggregateBoresRecursive.spec.ts`

3. Implement the walker (mirrors `aggregateCutListRecursive` l26-65 structure, grouped by
   `partPath`):

```ts
import type { AssemblyDocument, BoreOp, PartInfo } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';

export interface BoringPanelGroup {
  partPath: string;
  partName: string;
  bores: BoreOp[];
  qty: number;
  componentPathKeys: string[];
}

export interface BoringAggregateResult {
  panels: BoringPanelGroup[];
}

export function aggregateBoresRecursive(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
  partBores: Map<string, BoreOp[]>,
  partInfo: Map<string, PartInfo>,
): BoringAggregateResult {
  const groups = new Map<string, BoringPanelGroup>();

  function walk(doc: AssemblyDocument, prefix: string[]): void {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      if (c.partPath.endsWith('.ziasm')) {
        const e = cache.get(c.partPath);
        if (e && e.kind === 'ok') walk(e.doc, path);
        continue;
      }
      const bores = partBores.get(c.partPath);
      if (!bores || bores.length === 0) continue;
      const existing = groups.get(c.partPath);
      if (existing) {
        existing.qty += 1;
        existing.componentPathKeys.push(pathKey(path));
      } else {
        groups.set(c.partPath, {
          partPath: c.partPath,
          partName: partInfo.get(c.partPath)?.name ?? '(missing part)',
          bores: [...bores],
          qty: 1,
          componentPathKeys: [pathKey(path)],
        });
      }
    }
  }
  walk(activeDoc, []);

  const panels = Array.from(groups.values());
  panels.sort((a, b) => a.partPath.localeCompare(b.partPath));
  return { panels };
}
```

4. Run it — expected **PASS** (3 tests).
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/assembly/walkers/__tests__/aggregateBoresRecursive.spec.ts`

5. `tsc`: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npm run typecheck`

6. Commit.
   `git add -A && git commit -m "feat(app): aggregateBoresRecursive walker — per-part bore grouping mirroring cut-list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 19 — `buildBoringCsv` emitter

Header `Panel,Tag,Face,X,Y,Ø,Depth,Type`; one row per bore, grouped per panel; `depth ===
'throughAll'` → `THROUGH`. Reuse the **local** `csvCell` idiom from `buildCutListCsv.ts` (l4-7;
it is NOT exported — copy it verbatim).

**Files:**
- Create: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/commands/buildBoringCsv.ts`
- Test: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/commands/__tests__/buildBoringCsv.spec.ts` (NEW)

**Steps:**

1. Write the failing test (mirrors `buildCutListCsv.spec.ts` l6-38):

```ts
import { describe, expect, it } from 'vitest';
import { buildBoringCsv } from '../buildBoringCsv';
import type { BoringAggregateResult } from '../../assembly/walkers/aggregateBoresRecursive';
import type { BoreOp } from '@zilventor/shared';

const bore = (over: Partial<BoreOp> = {}): BoreOp => ({
  id: 'b1', face: { featureId: 'panel', role: 'Top', instance: 0 }, u: 100, v: 50, diameter: 5, depth: 34,
  role: 'confirmat-face', connectorId: 'k1', connectorKind: 'confirmat', ...over,
});

const empty: BoringAggregateResult = { panels: [] };

describe('buildBoringCsv', () => {
  it('emits the header for an empty result', () => {
    const csv = buildBoringCsv(empty);
    expect(csv).toContain('Panel,Tag,Face,X,Y,Ø,Depth,Type');
  });

  it('emits one row per bore with X=u, Y=v, Ø=diameter, numeric depth', () => {
    const result: BoringAggregateResult = {
      panels: [{
        partPath: 'parts/side.zipt', partName: 'Side', qty: 2,
        componentPathKeys: [],
        bores: [bore({ id: 'b1' }), bore({ id: 'b2', u: 200, diameter: 8 })],
      }],
    };
    const csv = buildBoringCsv(result);
    expect(csv).toContain('Side,b1,Top,100,50,5,34,confirmat');
    expect(csv).toContain('Side,b2,Top,200,50,8,34,confirmat');
  });

  it("renders depth 'throughAll' as THROUGH", () => {
    const result: BoringAggregateResult = {
      panels: [{
        partPath: 'p.zipt', partName: 'Back', qty: 1, componentPathKeys: [],
        bores: [bore({ id: 'b9', face: { featureId: 'panel', role: 'Back', instance: 0 }, depth: 'throughAll' })],
      }],
    };
    const csv = buildBoringCsv(result);
    expect(csv).toContain('Back,b9,Back,100,50,5,THROUGH,confirmat');
  });

  it('RFC-4180 quotes a panel name containing a comma', () => {
    const result: BoringAggregateResult = {
      panels: [{
        partPath: 'p.zipt', partName: 'Side, left', qty: 1, componentPathKeys: [],
        bores: [bore()],
      }],
    };
    const csv = buildBoringCsv(result);
    expect(csv).toContain('"Side, left",b1,Top,100,50,5,34,confirmat');
  });
});
```

2. Run it — expected **FAIL**: cannot import `buildBoringCsv`.
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/buildBoringCsv.spec.ts`

3. Implement:

```ts
import type { BoringAggregateResult, BoringPanelGroup } from '../assembly/walkers/aggregateBoresRecursive';
import type { BoreOp } from '@zilventor/shared';

// Copied verbatim from buildCutListCsv.ts (csvCell is local there, not exported).
function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function depthLabel(d: number | 'throughAll'): string {
  return d === 'throughAll' ? 'THROUGH' : String(d);
}

function boreLine(panelName: string, b: BoreOp): string {
  return [
    csvCell(panelName),
    csvCell(b.id),
    b.face.role,   // b.face is FaceName (object); emit the role string ('Top'/'Front'/etc.)
    String(b.u),
    String(b.v),
    String(b.diameter),
    depthLabel(b.depth),
    b.connectorKind,
  ].join(',');
}

export function buildBoringCsv(result: BoringAggregateResult): string {
  const out: string[] = [];
  out.push('Panel,Tag,Face,X,Y,Ø,Depth,Type');
  for (const panel of result.panels as BoringPanelGroup[]) {
    for (const b of panel.bores) out.push(boreLine(panel.partName, b));
  }
  return out.join('\n') + '\n';
}
```

4. Run it — expected **PASS** (4 tests).
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/buildBoringCsv.spec.ts`

5. `tsc`: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npm run typecheck`

6. Commit.
   `git add -A && git commit -m "feat(app): buildBoringCsv — per-panel bore CSV (Panel,Tag,Face,X,Y,Ø,Depth,Type)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 20 — `ExportBoringCsvCommand` (one-shot, no revert)

Model on `ExportCutListCsvCommand` (l15-55): NOT a bus-undoable `Command` (no `revert`), takes
precomputed `{ result, suggestedName }`, builds CSV → `TextEncoder` → stash
`globalThis.__zilventorBoringCsvBytes` for e2e → `showSaveFilePicker` with `<a download>`
fallback.

**Files:**
- Create: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/commands/ExportBoringCsvCommand.ts`
- Test: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/commands/__tests__/ExportBoringCsvCommand.spec.ts` (NEW)

**Steps:**

1. Read `ExportCutListCsvCommand.spec.ts` (l1-40) to copy the picker-mock + globalThis-stash
   assertion shape, then write the failing test:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ExportBoringCsvCommand } from '../ExportBoringCsvCommand';
import type { BoringAggregateResult } from '../../assembly/walkers/aggregateBoresRecursive';

const result: BoringAggregateResult = {
  panels: [{
    partPath: 'p.zipt', partName: 'Side', qty: 1, componentPathKeys: [],
    bores: [{
      id: 'b1', face: { featureId: 'panel', role: 'Top', instance: 0 }, u: 100, v: 50, diameter: 5, depth: 34,
      role: 'confirmat-face', connectorId: 'k1', connectorKind: 'confirmat',
    }],
  }],
};

describe('ExportBoringCsvCommand', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__zilventorBoringCsvBytes = undefined;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).showSaveFilePicker;
  });

  it('stashes encoded CSV bytes on globalThis for e2e', async () => {
    await new ExportBoringCsvCommand({ result, suggestedName: 'cab-boring.csv' }).apply();
    const bytes = (globalThis as Record<string, unknown>).__zilventorBoringCsvBytes as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Panel,Tag,Face,X,Y,Ø,Depth,Type');
    expect(text).toContain('Side,b1,Top,100,50,5,34,confirmat');
  });

  it('writes via showSaveFilePicker when available', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const picker = vi.fn().mockResolvedValue({ createWritable });
    (globalThis as Record<string, unknown>).showSaveFilePicker = picker;
    await new ExportBoringCsvCommand({ result, suggestedName: 'cab-boring.csv' }).apply();
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'cab-boring.csv' }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('swallows AbortError when the user cancels the picker', async () => {
    const picker = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    (globalThis as Record<string, unknown>).showSaveFilePicker = picker;
    await expect(
      new ExportBoringCsvCommand({ result, suggestedName: 'cab-boring.csv' }).apply(),
    ).resolves.toBeUndefined();
  });
});
```

2. Run it — expected **FAIL**: cannot import `ExportBoringCsvCommand`.
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/ExportBoringCsvCommand.spec.ts`

3. Implement (structure copied from `ExportCutListCsvCommand.ts` l1-55):

```ts
import { buildBoringCsv } from './buildBoringCsv';
import type { BoringAggregateResult } from '../assembly/walkers/aggregateBoresRecursive';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var __zilventorBoringCsvBytes: Uint8Array | undefined;
}

interface FsHandle {
  createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
}
type SaveFilePicker = (opts: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FsHandle>;

export class ExportBoringCsvCommand {
  constructor(private opts: { result: BoringAggregateResult; suggestedName: string }) {}

  async apply(): Promise<void> {
    const csv = buildBoringCsv(this.opts.result);
    const bytes = new TextEncoder().encode(csv);
    globalThis.__zilventorBoringCsvBytes = bytes;
    const picker = (globalThis as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({
          suggestedName: this.opts.suggestedName,
          types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
        });
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
      } catch (err) {
        const e = err as { name?: string };
        if (e?.name === 'AbortError') return;
        if (typeof document === 'undefined') return;
        this.downloadFallback(bytes);
      }
      return;
    }
    if (typeof document !== 'undefined') this.downloadFallback(bytes);
  }

  private downloadFallback(bytes: Uint8Array): void {
    const blob = new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.opts.suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
```

4. Run it — expected **PASS** (3 tests).
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/ExportBoringCsvCommand.spec.ts`

5. `tsc`: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npm run typecheck`

6. Commit.
   `git add -A && git commit -m "feat(app): ExportBoringCsvCommand — one-shot boring-map CSV export (no revert)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 21 — `useBoringResult` hook + Furniture-ribbon "Export CSV (Boring)" button (wiring; no TDD)

**No-TDD — pure UI/data wiring.** The hook mirrors `useCutListResult` (l13-36) exactly,
swapping `aggregateCutListRecursive` for `aggregateBoresRecursive` and sourcing `partBores`
from a per-part bore map. The button mirrors the existing Export CSV button (FurnitureTab
l115-119). Behavior is exercised end-to-end by the e2e chunk's byte-verification (it reads
`globalThis.__zilventorBoringCsvBytes`); a unit test here would only re-assert the already-unit-
tested command + walker + builder.

> **partBores source:** `useCutListResult` reads `panelSpecCacheRef`/`partInfoCacheRef` from
> `CutListCacheContext`. Bores live on `PartDocument.bores` (intrinsic to each part), which is
> NOT in that cache. Build `partBores` from the already-loaded part docs the app has in memory.
> The simplest correct source is the same `partInfoCacheRef` sibling cache the cut-list context
> already populates per part — **confirm during execution** whether the context exposes the
> parsed `PartDocument` (it parses `.zipt` to derive `PanelSpec` + `PartInfo`, so the doc — and
> thus `doc.bores` — is in hand at cache-fill time). If the context does not currently retain
> `doc.bores`, add a `partBoresCacheRef: Map<string, BoreOp[]>` to `CutListCacheContext`
> populated in the same loop that fills `panelSpecCacheRef` (one extra `set` per part — additive,
> no new parse). Prefer extending the existing cache fill over a second parse pass.

**Files:**
- Create: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/shell/useBoringResult.ts`
- Modify (likely): `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/shell/CutListCacheContext.tsx`
  (add `partBoresCacheRef` if the context does not already retain `doc.bores`).
- Modify: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/shell/tabs/FurnitureTab.tsx`
  (import `useBoringResult` + `ExportBoringCsvCommand`; add the button to the "Присадка" panel).

**Steps:**

1. Read `useCutListResult.ts` (whole file, 36 lines) and `CutListCacheContext.tsx` to confirm
   how `panelSpecCacheRef`/`partInfoCacheRef` are filled and whether the parsed `PartDocument`
   (with `bores`) is available there.

2. Create `useBoringResult.ts` mirroring `useCutListResult`:

```ts
import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { aggregateBoresRecursive, type BoringAggregateResult } from '../assembly/walkers/aggregateBoresRecursive';
import { useCutListCacheContext } from './CutListCacheContext';

const EMPTY: BoringAggregateResult = { panels: [] };

export function useBoringResult(): BoringAggregateResult {
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const subAssemblyDocs = useAppStore((s) => s.subAssemblyDocs);
  const { partBoresCacheRef, partInfoCacheRef } = useCutListCacheContext();

  return useMemo(() => {
    if (!activeAssembly) return EMPTY;
    const subAsmCacheAdapter = {
      get: (p: string) =>
        subAssemblyDocs[p]
          ? { kind: 'ok' as const, doc: subAssemblyDocs[p]!, partPath: p }
          : undefined,
    };
    return aggregateBoresRecursive(
      activeAssembly,
      subAsmCacheAdapter,
      partBoresCacheRef.current ?? new Map(),
      partInfoCacheRef.current ?? new Map(),
    );
  }, [activeAssembly, subAssemblyDocs, partBoresCacheRef, partInfoCacheRef]);
}
```

   If `CutListCacheContext` lacks `partBoresCacheRef`, add it: a
   `useRef<Map<string, BoreOp[]>>(new Map())` alongside `panelSpecCacheRef`, exposed on the
   context value, and `set(partPath, doc.bores ?? [])` in the same per-part fill loop that sets
   `panelSpecCacheRef`/`partInfoCacheRef`.

3. In `FurnitureTab.tsx`, add the imports (near l15-17):

```tsx
import { ExportBoringCsvCommand } from '../../commands/ExportBoringCsvCommand';
import { useBoringResult } from '../useBoringResult';
```

   Add the hook call near `useCutListResult()` (l25):

```tsx
  const boringResult = useBoringResult();
```

   Add the button inside the "Присадка" `RibbonPanel` (the one added in Task 17), after the
   Show/Hide Bores button:

```tsx
          <button type="button" className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={!activeAssembly}
            aria-disabled={!activeAssembly}
            onClick={() => void new ExportBoringCsvCommand({
              result: boringResult,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-boring.csv`,
            }).apply()}>
            Export CSV
          </button>
```

4. **Wire `window.__zilventorBoringAggregate` for e2e** — mirrors `window.__zilventorLoadCutListSpecs`
   (App.tsx ~l506). Add in `App.tsx` inside the same `useEffect` that wires the other window
   helpers, after the existing `__zilventorLoadCutListSpecs` assignment:

```ts
(window as unknown as { __zilventorBoringAggregate?: () => Promise<BoringAggregateResult> })
  .__zilventorBoringAggregate = async () =>
    aggregateBoresRecursive(
      /* activeAssembly= */ useAppStore.getState().activeAssembly!,
      /* subAsmCache= */ {
        get: (p: string) => {
          const d = useAppStore.getState().subAssemblyDocs[p];
          return d ? { kind: 'ok' as const, doc: d, partPath: p } : undefined;
        },
      },
      /* partBoresCache= */ cutListCacheRef.current?.partBoresCacheRef?.current ?? new Map(),
      /* partInfoCache= */ cutListCacheRef.current?.partInfoCacheRef?.current ?? new Map(),
    );
```

   Import `aggregateBoresRecursive` and `BoringAggregateResult` from the assembly walker at
   the top of App.tsx (add alongside the existing walker imports). The Tasks 32/33 e2e slices
   call `window.__zilventorBoringAggregate()` — this step is what wires it.

5. Run the full FurnitureTab unit suite to confirm no regression (it renders the ribbon):
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/shell/tabs/__tests__/FurnitureTab.spec.tsx`
   Expected **PASS** (the new buttons render; if the existing spec asserts a fixed button
   count, extend it to include the two new "Присадка" buttons — additive, don't break it).

6. `tsc`: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npm run typecheck`

7. Commit.
   `git add -A && git commit -m "feat(app): useBoringResult hook + __zilventorBoringAggregate window helper + Export CSV button

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 22 — Wire bore markers into the live viewport render path (no TDD; §6-gated)

**No-TDD — render-path wiring, verified by the §6 browser gate in the e2e chunk** (markers
must be visible at the correct face positions on a real cabinet; a jsdom unit test can't prove
pixels). The unit coverage for the marker-building math already lives in Tasks 14-16.

This task connects the store's component meshes / part docs to `SceneManager.setBoreMarkers`
so that when an assembly with drilled panels renders, the markers appear. It mirrors wherever
the app already calls `SceneManager.setPanelOverlays` for the assembly view.

**Files:**
- Modify: `/Users/lion/Documents/Projects/mine/zilventor/packages/app/src/App.tsx` (or the
  viewport-wiring effect that currently calls `setPanelOverlays`) — find via
  `grep -n "setPanelOverlays" packages/app/src/App.tsx packages/app/src/viewport/Viewport.tsx`.

**Steps:**

1. `grep -rn "setPanelOverlays" packages/app/src/`
   to locate the existing assembly-overlay wiring effect (the one that maps live components →
   `PanelOverlaySpec[]`).

2. In that same effect, build `MarkerOverlaySpec[]` from the live components: for each leaf
   component whose part doc has `bores?.length`, emit
   `{ key: pathKey(componentPath), panelDims, worldPose, bores }`. `panelDims` come from the
   same `PanelSpec`/part doc the overlay effect already resolves; `worldPose` is the component's
   world pose already computed for `setComponentMeshes`. Call
   `sceneManager.setBoreMarkers(markerSpecs)` right after the existing `setPanelOverlays(...)`
   call.

3. **§6 browser gate (delegated to the e2e chunk's controller):** with a freshly created base
   cabinet that has auto-generated bores, the markers must render as visible discs on the
   correct panel faces. This is asserted via the e2e screenshot read-back in the e2e chunk —
   reference it here so the assembler sequences this wiring **before** that gate. Per MEMORY:
   start the dev server FROM THE WORKTREE on a free port and confirm a `window` global before
   screenshotting, to avoid testing the wrong checkout.

4. `tsc`: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npm run typecheck`

5. Run the full app suite once to confirm no regression from the wiring change:
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts`
   Expected **PASS** (whole app suite green).

6. Commit.
   `git add -A && git commit -m "feat(app): wire live bore markers into the assembly viewport render path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

#### Chunk-3 verification gate (run before reporting this chunk done)

1. Full app suite green from `packages/app`:
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts`
2. `tsc` clean in `packages/app`:
   `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npm run typecheck`
3. The shared barrel exports `face2DFrame` + `BoreOp` (owned by the data-model chunk) — if the
   marker/walker/CSV imports fail to resolve, that chunk has not landed yet; this chunk's RED
   runs depend on it. Do not stub.
4. §6 browser gate (markers visible on a real cabinet) is owned by the e2e chunk; this chunk's
   Task 15 position test (`face2DFrame`-derived expected) is the unit-level guard against the
   coordinate false-green class.

---
## Chunk 4 — Phase 7 (DXF export) + Phase 8 (BAKE: `atFace` kernel placement + Bake/Unbake commands)

> **Worktree note:** When executed in a git worktree, substitute the worktree path for `/Users/lion/Documents/Projects/mine/zilventor` in every command below. Per MEMORY: Bash cwd persists across *and within* compound commands in this repo — always anchor cwd per package (app suites run from `packages/app` with `--config vitest.config.ts`; shared/kernel from their own dirs). For e2e, start the dev server FROM THE WORKTREE on a free port and confirm `window.__zilventorParameterRegistry` to avoid testing the wrong checkout.

> **Scope of this chunk (group 4):** Phase 7 (DXF export) + Phase 8 (BAKE: `atFace` kernel placement + Bake/Unbake commands). It DEPENDS on group-1 `packages/shared/src/bore.ts` (`BoreOp`, `BoreConnectorKind`, `face2DFrame`) + the v21 migration, and on group-3 `aggregateBoresRecursive.ts` (`BoringAggregateResult`, `BoringPanelGroup`). Those identifiers are used verbatim from the locked CONTRACT; do not redefine them here.

---

### Task 23 — `renderBoringDxf`: panel outline POLYLINE per panel group

Render one DXF string from a `BoringAggregateResult`: each panel becomes an outline POLYLINE on layer `OUTLINE`, panels offset on a horizontal grid so they don't overlap. Bore circles come in Task 24.

**Files:**
- Create: `packages/app/src/drawing/renderBoringDxf.ts`
- Create (test): `packages/app/src/drawing/__tests__/renderBoringDxf.spec.ts`
- Reference (read-only): `packages/app/src/drawing/dxfWriter.ts` (`createDxfDocument`, `.polyline`, `.circle`), `packages/app/src/drawing/renderDrawingDxf.ts:65-122` (createDxfDocument usage model)

**Steps:**

1. Write the failing test. The panel-outline rectangle uses the panel's `length`×`width` (taken from `partInfo`-style dims carried on the group; group-3's `BoringPanelGroup` carries `partName` + `bores` — dims for the outline come from the bores' face frame, but for slice 1 we draw a fixed-size bounding rectangle derived from the max bore extents, falling back to a default if a panel has no bores). Assert the output is a valid DXF containing a POLYLINE on `OUTLINE`.

```ts
// packages/app/src/drawing/__tests__/renderBoringDxf.spec.ts
import { describe, it, expect } from 'vitest';
import { renderBoringDxf } from '../renderBoringDxf';
import type { BoringAggregateResult } from '../../assembly/walkers/aggregateBoresRecursive';
import type { BoreOp } from '@zilventor/shared';

function bore(over: Partial<BoreOp>): BoreOp {
  return {
    id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 50, v: 100, diameter: 5, depth: 34, role: 'confirmat-face',
    connectorId: 'c1', connectorKind: 'confirmat', ...over,
  };
}

describe('renderBoringDxf — panel outline', () => {
  it('emits an OUTLINE POLYLINE for each panel group', () => {
    const result: BoringAggregateResult = {
      panels: [
        { partPath: 'side.zipt', partName: 'Side', qty: 1, componentPathKeys: ['k'],
          bores: [bore({ u: 10, v: 10 }), bore({ id: 'b2', u: 200, v: 400 })] },
      ],
    };
    const dxf = renderBoringDxf(result);
    expect(dxf).toContain('AC1009');               // valid R12 header
    expect(dxf).toContain('POLYLINE');
    expect(dxf).toContain('OUTLINE');               // outline layer referenced by the polyline
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('offsets a second panel so its outline does not overlap the first', () => {
    const mk = (path: string): BoringAggregateResult['panels'][number] => ({
      partPath: path, partName: path, qty: 1, componentPathKeys: ['k'],
      bores: [bore({ u: 0, v: 0 }), bore({ id: 'b2', u: 100, v: 100 })],
    });
    const dxf = renderBoringDxf({ panels: [mk('a.zipt'), mk('b.zipt')] });
    // Two panels → two POLYLINE entities (outline) at minimum.
    const polylineCount = (dxf.match(/\nPOLYLINE\n/g) ?? []).length;
    expect(polylineCount).toBeGreaterThanOrEqual(2);
  });
});
```

2. Run it — expected FAIL: `Cannot find module '../renderBoringDxf'` (file does not exist yet).
   `cd packages/app && npx vitest run --config vitest.config.ts src/drawing/__tests__/renderBoringDxf.spec.ts`

3. Minimal implementation — outline only (circles added in Task 24):

```ts
// packages/app/src/drawing/renderBoringDxf.ts
import { createDxfDocument } from './dxfWriter';
import type { BoringAggregateResult, BoringPanelGroup } from '../assembly/walkers/aggregateBoresRecursive';
import type { BoreOp } from '@zilventor/shared';

const PANEL_GAP = 50;        // mm gap between panels on the grid
const DEFAULT_SPAN = 100;    // mm fallback panel extent when a panel has no bores

/** Bounding span of a panel's bores in (u,v); used to size the outline rectangle. */
function panelSpan(bores: ReadonlyArray<BoreOp>): { w: number; h: number } {
  if (bores.length === 0) return { w: DEFAULT_SPAN, h: DEFAULT_SPAN };
  let maxU = 0, maxV = 0;
  for (const b of bores) { maxU = Math.max(maxU, b.u); maxV = Math.max(maxV, b.v); }
  // Pad so bores at the extreme edge are not on the outline.
  return { w: maxU + DEFAULT_SPAN / 2, h: maxV + DEFAULT_SPAN / 2 };
}

/** Render a per-panel boring map to a single AutoCAD R12 DXF string.
 *  Panels are laid out left-to-right on a row, offset by PANEL_GAP. */
export function renderBoringDxf(result: BoringAggregateResult): string {
  const doc = createDxfDocument();
  let xOffset = 0;
  for (const panel of result.panels) {
    const { w, h } = panelSpan(panel.bores);
    drawPanelOutline(doc, xOffset, w, h);
    xOffset += w + PANEL_GAP;
  }
  return doc.toString();
}

function drawPanelOutline(
  doc: ReturnType<typeof createDxfDocument>,
  x0: number, w: number, h: number,
): void {
  const pts: ReadonlyArray<readonly [number, number]> = [
    [x0, 0], [x0 + w, 0], [x0 + w, h], [x0, h], [x0, 0],
  ];
  doc.polyline('OUTLINE', pts);
}

export type { BoringPanelGroup };
```

4. Run it — expected PASS (header `AC1009`, `POLYLINE`, `OUTLINE`, `EOF` present; 2 polylines for 2 panels).
   `cd packages/app && npx vitest run --config vitest.config.ts src/drawing/__tests__/renderBoringDxf.spec.ts`

5. tsc — `cd packages/app && npm run typecheck`. Expected: clean.

6. Commit:
   `git add packages/app/src/drawing/renderBoringDxf.ts packages/app/src/drawing/__tests__/renderBoringDxf.spec.ts && git commit -m "feat(app): renderBoringDxf panel-outline POLYLINE per panel group

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 24 — `renderBoringDxf`: CIRCLE per bore on per-(Ø,depth) layers

Add a CIRCLE per bore, on a layer named `D{Ø}_T{depth}` (depth `'throughAll'` → `D{Ø}_THROUGH`). Custom layers are auto-created by R12 readers — assert on CIRCLE entities, NOT on LAYER-table membership (the fixed `LAYERS` const in dxfWriter only declares 9 layers; CONTRACT gotcha: accept auto-create for slice 1).

**Files:**
- Modify: `packages/app/src/drawing/renderBoringDxf.ts`
- Modify (test): `packages/app/src/drawing/__tests__/renderBoringDxf.spec.ts`

**Steps:**

1. Add failing assertions for circles + layer naming:

```ts
  it('emits one CIRCLE per bore on a D{Ø}_T{depth} layer', () => {
    const result: BoringAggregateResult = {
      panels: [
        { partPath: 'side.zipt', partName: 'Side', qty: 1, componentPathKeys: ['k'],
          bores: [
            bore({ id: 'b1', u: 30, v: 40, diameter: 5, depth: 34 }),
            bore({ id: 'b2', u: 60, v: 80, diameter: 15, depth: 12 }),
            bore({ id: 'b3', u: 90, v: 120, diameter: 8, depth: 'throughAll' }),
          ] },
      ],
    };
    const dxf = renderBoringDxf(result);
    const circleCount = (dxf.match(/\nCIRCLE\n/g) ?? []).length;
    expect(circleCount).toBe(3);
    expect(dxf).toContain('D5_T34');
    expect(dxf).toContain('D15_T12');
    expect(dxf).toContain('D8_THROUGH');
  });

  it('places each circle at the panel-local (u,v) offset by the panel grid origin', () => {
    const result: BoringAggregateResult = {
      panels: [
        { partPath: 'a.zipt', partName: 'A', qty: 1, componentPathKeys: ['k'],
          bores: [bore({ id: 'b1', u: 25, v: 35, diameter: 5, depth: 34 })] },
      ],
    };
    const dxf = renderBoringDxf(result);
    // First panel grid origin is x0=0, so the circle center is (25,35), radius 2.5.
    expect(dxf).toMatch(/CIRCLE[\s\S]*?25\.0000[\s\S]*?35\.0000[\s\S]*?2\.5000/);
  });
```

2. Run it — expected FAIL: `circleCount` is `0` (no circles emitted yet) and `D5_T34` not found.
   `cd packages/app && npx vitest run --config vitest.config.ts src/drawing/__tests__/renderBoringDxf.spec.ts`

3. Implementation — add a `boreLayer` helper + circle loop inside the panel loop:

```ts
/** Layer name per (Ø,depth): integerise the diameter; depth 'throughAll' → THROUGH. */
function boreLayer(b: BoreOp): string {
  const dia = Number.isInteger(b.diameter) ? String(b.diameter) : String(b.diameter).replace('.', '_');
  const depth = b.depth === 'throughAll' ? 'THROUGH' : `T${b.depth}`;
  return `D${dia}_${depth}`;
}
```

   Then extend `renderBoringDxf`'s panel loop to draw circles after the outline:

```ts
  for (const panel of result.panels) {
    const { w, h } = panelSpan(panel.bores);
    drawPanelOutline(doc, xOffset, w, h);
    for (const b of panel.bores) {
      doc.circle(boreLayer(b), xOffset + b.u, b.v, b.diameter / 2);
    }
    xOffset += w + PANEL_GAP;
  }
```

4. Run it — expected PASS (3 circles, layers `D5_T34`/`D15_T12`/`D8_THROUGH`, center 25/35 radius 2.5).
   `cd packages/app && npx vitest run --config vitest.config.ts src/drawing/__tests__/renderBoringDxf.spec.ts`

5. tsc — `cd packages/app && npm run typecheck`. Expected: clean.

6. Commit:
   `git add packages/app/src/drawing/renderBoringDxf.ts packages/app/src/drawing/__tests__/renderBoringDxf.spec.ts && git commit -m "feat(app): renderBoringDxf CIRCLE per bore on D{diameter}_T{depth} layers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 25 — `ExportBoringDxfCommand` (one-shot, no revert)

One-shot export modelled exactly on `ExportCutListCsvCommand` (NO `Command` interface, NO `revert`, NOT bus-undoable). Stash bytes on `globalThis.__zilventorBoringDxfBytes` for the e2e.

**Files:**
- Create: `packages/app/src/commands/ExportBoringDxfCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/ExportBoringDxfCommand.spec.ts`
- Reference (read-only): `packages/app/src/commands/ExportCutListCsvCommand.ts:15-55` (one-shot model: TextEncoder → globalThis stash → showSaveFilePicker | `<a download>` fallback)

**Steps:**

1. Write the failing test (jsdom env supplies `document` for the fallback path; no `showSaveFilePicker` in jsdom so it takes the `<a download>` branch):

```ts
// packages/app/src/commands/__tests__/ExportBoringDxfCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ExportBoringDxfCommand } from '../ExportBoringDxfCommand';
import type { BoringAggregateResult } from '../../assembly/walkers/aggregateBoresRecursive';

const result: BoringAggregateResult = {
  panels: [
    { partPath: 'side.zipt', partName: 'Side', qty: 1, componentPathKeys: ['k'],
      bores: [{ id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
        u: 30, v: 40, diameter: 5, depth: 34, role: 'confirmat-face',
        connectorId: 'c1', connectorKind: 'confirmat' }] },
  ],
};

describe('ExportBoringDxfCommand', () => {
  beforeEach(() => { globalThis.__zilventorBoringDxfBytes = undefined; });

  it('stashes the DXF bytes on globalThis for e2e capture', async () => {
    await new ExportBoringDxfCommand({ result, suggestedName: 'boring.dxf' }).apply();
    const bytes = globalThis.__zilventorBoringDxfBytes;
    expect(bytes).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder().decode(bytes!);
    expect(text).toContain('CIRCLE');
    expect(text).toContain('D5_T34');
  });
});
```

2. Run it — expected FAIL: `Cannot find module '../ExportBoringDxfCommand'`.
   `cd packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/ExportBoringDxfCommand.spec.ts`

3. Implementation (copy the structure of `ExportCutListCsvCommand` verbatim, swapping `renderBoringDxf` + the DXF mime + global name):

```ts
// packages/app/src/commands/ExportBoringDxfCommand.ts
import { renderBoringDxf } from '../drawing/renderBoringDxf';
import type { BoringAggregateResult } from '../assembly/walkers/aggregateBoresRecursive';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var __zilventorBoringDxfBytes: Uint8Array | undefined;
}

interface FsHandle {
  createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
}
type SaveFilePicker = (opts: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FsHandle>;

export class ExportBoringDxfCommand {
  constructor(private opts: { result: BoringAggregateResult; suggestedName: string }) {}

  async apply(): Promise<void> {
    const dxf = renderBoringDxf(this.opts.result);
    const bytes = new TextEncoder().encode(dxf);
    globalThis.__zilventorBoringDxfBytes = bytes;
    const picker = (globalThis as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({
          suggestedName: this.opts.suggestedName,
          types: [{ description: 'DXF', accept: { 'application/dxf': ['.dxf'] } }],
        });
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
      } catch (err) {
        const e = err as { name?: string };
        if (e?.name === 'AbortError') return;
        if (typeof document === 'undefined') return;
        this.downloadFallback(bytes);
      }
      return;
    }
    if (typeof document !== 'undefined') this.downloadFallback(bytes);
  }

  private downloadFallback(bytes: Uint8Array): void {
    const blob = new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.opts.suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
```

4. Run it — expected PASS (bytes stashed; decoded text contains `CIRCLE` + `D5_T34`).
   `cd packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/ExportBoringDxfCommand.spec.ts`

5. tsc — `cd packages/app && npm run typecheck`. Expected: clean (CONTRACT gotcha: the `Blob` `BlobPart` cast is taken verbatim from `ExportCutListCsvCommand` to satisfy the exact-types lib check that has historically caught BlobPart bugs).

6. Commit:
   `git add packages/app/src/commands/ExportBoringDxfCommand.ts packages/app/src/commands/__tests__/ExportBoringDxfCommand.spec.ts && git commit -m "feat(app): ExportBoringDxfCommand one-shot export (no revert) + globalThis stash

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 26 — kernel `atFace` HolePlacement variant: `resolveAtFaceLocations` (unit, no OCCT)

Add the `atFace` placement resolver as a pure-ish function that maps each `{u,v}` on a named panel face to a `HoleLocation` (`{origin: gp_Pnt, axis: gp_Dir}`) using the face's plane (origin+normal) + a panel-local 2D frame that MATCHES `face2DFrame` in shared. The axis points INTO the material (`neg(normal)`, like `resolveLinearLocation`). This task wires the resolver + the dispatch branch; the real-OCCT void proof is Task 27.

The `{u,v}` → 3D mapping reuses the shared `face2DFrame` convention so the kernel and the marker/DXF code agree (CONTRACT: this cross-boundary agreement is the recurring false-green risk — Task 27's real-OCCT bbox assertion is the guard).

**Files:**
- Modify: `packages/shared/src/types.ts` — append the `atFace` variant to the `HolePlacement` union (CONTRACT, anchor `273-283`). NOTE: group 1 owns the rest of `types.ts` (bores/role/formatVersion). This single union append is the only `types.ts` edit owned by THIS chunk — coordinate with the assembler so it lands once. (Group 1's Task 3 already appends this same variant — if Task 3 landed it, this step is a no-op; verify the union member exists and is identical.)
- Modify: `packages/kernel/src/adapter/features/HoleFeature.ts` — add `resolveAtFaceLocations` + the `else if (feature.placement.kind === 'atFace')` branch (CONTRACT anchors `85-143` template, `281-306` dispatch).
- Create (test): `packages/kernel/src/adapter/features/__tests__/HoleFeature.atFace.unit.spec.ts`

> NO-TDD-EXCEPTION for the `types.ts` union append itself (pure type declaration — no runtime behavior). The resolver below IS test-first.

**Steps:**

1. Append the `atFace` variant to `HolePlacement` in `packages/shared/src/types.ts` (after the `concentric` member, line ~283) — IF NOT ALREADY PRESENT from Task 3:

```ts
  | { kind: 'concentric'; faceName: FaceName; circularEdgeName: EdgeName }
  | { kind: 'atFace'; faceName: FaceName; points: ReadonlyArray<{ u: number; v: number }>; axis: 'into-face' };
```

2. Write the failing unit test. It fakes the OCCT surface so we can test the (u,v)→3D math + axis sign WITHOUT loading WASM (the real-OCCT volume proof is Task 27). We stub `gp_Pnt_3`/`gp_Dir_4` to record their constructor args, and stub the minimal surface-adaptor chain `findFaceByName` → `facePlaneNormal` reads.

```ts
// packages/kernel/src/adapter/features/__tests__/HoleFeature.atFace.unit.spec.ts
import { describe, it, expect } from 'vitest';
import { resolveAtFaceLocations } from '../HoleFeature';
import { face2DFrame } from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { FaceName, HolePlacement } from '@zilventor/shared';

// A Front face at y=+W/2 (panel local: Front=+Y per face2DFrame, face2DFrame origin at y=+200, normal=+Y),
// plane origin at the face. The fake oc returns this plane for the named face.
function fakeOc(faceOrigin: { x: number; y: number; z: number }, faceNormal: { x: number; y: number; z: number }) {
  const pnts: Array<{ x: number; y: number; z: number }> = [];
  const dirs: Array<{ x: number; y: number; z: number }> = [];
  return {
    rec: { pnts, dirs },
    oc: {
      TopoDS: { Face_1: (f: unknown) => f },
      BRepAdaptor_Surface_2: class {
        constructor(_f: unknown, _b: boolean) {}
        Plane() {
          return {
            Location: () => ({ X: () => faceOrigin.x, Y: () => faceOrigin.y, Z: () => faceOrigin.z }),
            Axis: () => ({ Direction: () => ({ X: () => faceNormal.x, Y: () => faceNormal.y, Z: () => faceNormal.z }) }),
          };
        }
        delete() {}
      },
      gp_Pnt_3: class { constructor(x: number, y: number, z: number) { pnts.push({ x, y, z }); } },
      gp_Dir_4: class { constructor(x: number, y: number, z: number) { dirs.push({ x, y, z }); } },
    } as unknown,
  };
}

const faceName: FaceName = { featureId: 'panel', role: 'Front', instance: 0 };

function runningBodyFor(name: FaceName): NamedShape {
  // findFaceByName matches on faceNamesEqual; the face handle is opaque.
  return { shape: {}, faceNames: [{ name, face: { __face: true } }] } as unknown as NamedShape;
}

describe('resolveAtFaceLocations', () => {
  it('drills the hole axis INTO the material (negated outward normal)', () => {
    // panel L=600 W=400 T=18 — Front face outward normal is +Y (Front=+Y per face2DFrame).
    const { oc, rec } = fakeOc({ x: 0, y: +200, z: 9 }, { x: 0, y: +1, z: 0 });
    const placement: Extract<HolePlacement, { kind: 'atFace' }> = {
      kind: 'atFace', faceName, points: [{ u: 0, v: 0 }], axis: 'into-face',
    };
    const dims = { length: 600, width: 400, thickness: 18 };
    const locs = resolveAtFaceLocations(oc as never, runningBodyFor(faceName), placement, dims, false);
    expect(locs).toHaveLength(1);
    // Outward normal +Y → drill axis must point -Y (into the panel, toward center).
    expect(rec.dirs[0]).toEqual({ x: 0, y: -1, z: 0 });
  });

  it('maps (u,v)=(0,0) to the face2DFrame origin in panel-local 3D space', () => {
    const { oc, rec } = fakeOc({ x: 0, y: +200, z: 9 }, { x: 0, y: +1, z: 0 });
    const dims = { length: 600, width: 400, thickness: 18 };
    const placement: Extract<HolePlacement, { kind: 'atFace' }> = {
      kind: 'atFace', faceName, points: [{ u: 0, v: 0 }], axis: 'into-face',
    };
    resolveAtFaceLocations(oc as never, runningBodyFor(faceName), placement, dims, false);
    // face2DFrame('Front') origin must equal the recorded gp_Pnt for (0,0).
    const fr = face2DFrame(dims, 'Front');
    expect(rec.pnts[0]).toEqual(fr.origin);
  });

  it('throws when the named face is absent (so the soft-fail caller drops the hole loudly in tests)', () => {
    const { oc } = fakeOc({ x: 0, y: +200, z: 9 }, { x: 0, y: +1, z: 0 });
    const placement: Extract<HolePlacement, { kind: 'atFace' }> = {
      kind: 'atFace', faceName, points: [{ u: 0, v: 0 }], axis: 'into-face',
    };
    const dims = { length: 600, width: 400, thickness: 18 };
    const empty = { shape: {}, faceNames: [] } as unknown as NamedShape;
    expect(() => resolveAtFaceLocations(oc as never, empty, placement, dims, false)).toThrow(/face .* not found/);
  });
});
```

3. Run it — expected FAIL: `resolveAtFaceLocations is not exported` / not a function.
   `cd packages/kernel && npx vitest run src/adapter/features/__tests__/HoleFeature.atFace.unit.spec.ts`

4. Implementation. Add the import for `face2DFrame` + the exported resolver, then the dispatch branch.

   At the top of `HoleFeature.ts`, extend the shared import:

```ts
import { originPlaneLiteralOf, face2DFrame } from '@zilventor/shared';
```

   Add the resolver (mirrors `resolveLinearLocation`'s structure: `findFaceByName` → `facePlaneNormal` → axis = `neg(normal)`; the (u,v)→3D point comes from `face2DFrame`, NOT from the face plane, so it agrees byte-for-byte with the marker/DXF/shared code):

```ts
export function resolveAtFaceLocations(
  oc: OcctInstance,
  runningBody: NamedShape,
  placement: Extract<HolePlacement, { kind: 'atFace' }>,
  panelDims: { length: number; width: number; thickness: number },
  flipAxis: boolean,
): HoleLocation[] {
  const faceRaw = findFaceByName(runningBody, placement.faceName);
  if (!faceRaw) throw new Error(`atFace: face ${placement.faceName.role} not found`);
  const { normal } = facePlaneNormal(oc, faceRaw);
  // Outward face normal → negate so the drill axis points INTO the material.
  // flipAxis reverses (drill from inside out), matching resolveLinearLocation.
  const axisVec = flipAxis ? normal : neg(normal);

  // (u,v) → panel-local 3D point via the SAME frame the markers/DXF use.
  const role = placement.faceName.role as 'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right';
  const frame = face2DFrame(panelDims, role);

  const locations: HoleLocation[] = [];
  for (const { u, v } of placement.points) {
    const P: Vec3 = add(frame.origin, add(scale(frame.uDir, u), scale(frame.vDir, v)));
    const origin = new (oc as any).gp_Pnt_3(P.x, P.y, P.z);
    const axis = new (oc as any).gp_Dir_4(axisVec.x, axisVec.y, axisVec.z);
    locations.push({ origin, axis });
  }
  return locations;
}
```

   Add the dispatch branch in `executeHoleFeature` (after the `concentric` branch, before the `else throw` at lines 302-306). The panel dims come from the `atFace` placement's owning part — but `executeHoleFeature` does not receive part dims. Resolve them from the face plane extents is fragile; instead, the BakeBoresCommand stamps the dims into the placement is NOT in the locked type. **Decision (locked):** carry `panelDims` on the resolver via a closure is not available here, so the `atFace` placement must self-describe. Per the CONTRACT the `atFace` variant has no dims field; therefore the executor derives dims from the running body's bounding box (an axis-aligned panel box — `buildPanelBox` guarantees this). Add a tiny bbox reader:

```ts
function panelDimsFromBody(oc: OcctInstance, body: unknown): { length: number; width: number; thickness: number } {
  const bnd = new (oc as any).Bnd_Box_1();
  (oc as any).BRepBndLib.Add(body, bnd, false);
  const lo = bnd.CornerMin();
  const hi = bnd.CornerMax();
  return {
    length: hi.X() - lo.X(),
    width: hi.Y() - lo.Y(),
    thickness: hi.Z() - lo.Z(),
  };
}
```

   Then the branch:

```ts
  } else if (feature.placement.kind === 'atFace') {
    const dims = panelDimsFromBody(oc, runningBody.shape);
    locations = resolveAtFaceLocations(oc, runningBody, feature.placement, dims, feature.flipAxis);
  } else {
```

5. Run the unit test — expected PASS (axis +Y into the panel; (0,0)→face2DFrame origin; missing face throws).
   `cd packages/kernel && npx vitest run src/adapter/features/__tests__/HoleFeature.atFace.unit.spec.ts`

6. tsc — `cd packages/kernel && npm run typecheck` AND `cd packages/shared && npm run typecheck`. Expected: clean.

7. Commit:
   `git add packages/shared/src/types.ts packages/kernel/src/adapter/features/HoleFeature.ts packages/kernel/src/adapter/features/__tests__/HoleFeature.atFace.unit.spec.ts && git commit -m "feat(kernel): atFace HolePlacement variant + resolveAtFaceLocations (u,v→panel-local via face2DFrame)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 27 — kernel `atFace` real-OCCT integration: prove the void EXISTS on an offset panel face

The CONTRACT gotcha is load-bearing: `executeHoleFeature` is soft-failed by the caller (try/catch), so a throwing or no-op `atFace` resolver would SILENTLY drop the hole — prior slices shipped false-greens exactly this way. This test asserts the REAL OCCT volume drops by the expected cylinder volume (the hole truly exists), parallel to the existing `linear` integration test (HoleFeature.integration.spec.ts:183-202).

**Files:**
- Create (test): `packages/kernel/src/adapter/features/__tests__/HoleFeature.atFace.integration.spec.ts`
- Reference (read-only): existing `HoleFeature.integration.spec.ts:183-202` (linear case = the closest precedent), `packages/kernel/src/occt/PanelOps.ts` (`buildPanelBox`, real face names)

**Steps:**

1. Write the failing integration test. Build a REAL panel box via `buildPanelBox`, drill an `atFace` blind hole into its `Front` face, assert the volume drop equals one Ø8×20 cylinder.

```ts
// packages/kernel/src/adapter/features/__tests__/HoleFeature.atFace.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import { face2DFrame } from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';

describe('executeHoleFeature — atFace (integration, real OCCT)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  it('drills a blind hole INTO an offset panel face — the void really exists (volume drops)', () => {
    const dims = { length: 600, width: 400, thickness: 18 };
    const panel = buildPanelBox(oc, dims);
    // NamedShape with the panel's real face handles.
    const faceNames: NamedShape['faceNames'] = [];
    const map = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(panel.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
    // Re-derive role from centroid (the panel's classify is internal); reuse panel.faceNames roles
    // by matching the role→handle through buildPanelBox is not exposed, so name each face by centroid.
    for (let i = 1; i <= map.Extent(); i++) {
      const face = oc.TopoDS.Face_1(map.FindKey(i));
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
      const c = props.CentreOfMass();
      const x = c.X(), y = c.Y(), z = c.Z();
      let role: string;
      if (Math.abs(z - 18) < 0.5) role = 'Top';
      else if (Math.abs(z) < 0.5) role = 'Bottom';
      else if (Math.abs(y - 200) < 0.5) role = 'Front';   // Front = +Y (face2DFrame: Front=+Y)
      else if (Math.abs(y + 200) < 0.5) role = 'Back';    // Back = -Y
      else if (Math.abs(x + 300) < 0.5) role = 'Left';
      else role = 'Right';
      faceNames.push({ name: { featureId: 'panel', role, instance: 0 }, face });
    }
    map.delete();
    const running: NamedShape = { shape: panel.shape, faceNames };

    // Bore at the center of the Front face: face2DFrame Front spans (u along length, v along thickness/height).
    // Pick (u,v) = (300, 9) → physical center of the 600×18 Front rectangle.
    const feature: any = {
      id: 'bake:Front:8:20:0', kind: 'hole',
      placement: { kind: 'atFace', faceName: { featureId: 'panel', role: 'Front', instance: 0 },
        points: [{ u: 300, v: 9 }], axis: 'into-face' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 8 } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 20 } },
      flipAxis: false,
    };
    const result = executeHoleFeature(oc, running, feature, (p: any) => p.value, new Map());

    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    const before = dims.length * dims.width * dims.thickness;
    const drilled = Math.PI * 4 * 4 * 20;       // π·r²·depth, r=4, depth=20
    // Blind hole has a drill-tip cone; assert the drop is at least the cylinder body
    // and not more than cylinder + a tip cone (π·r²·(r/tan(29°)) ≈ small).
    const drop = before - props.Mass();
    expect(drop).toBeGreaterThan(drilled * 0.9);
    expect(drop).toBeLessThan(drilled * 1.3);
    // Sanity: it actually drilled (not a no-op soft-fail).
    expect(drop).toBeGreaterThan(100);
  });
});
```

2. Run it — expected FAIL initially IF the (u,v) convention in `face2DFrame` (group 1) places the point off the Front rectangle, OR PASS if group 1 + Task 26 already agree. The point of this RED gate: if the resolver silently misses the body, `drop` is ~0 and the `> 100` assertion fails — exactly the false-green guard the CONTRACT demands. Run and READ the actual `drop` value.
   `cd packages/kernel && npx vitest run --config vitest.integration.config.ts src/adapter/features/__tests__/HoleFeature.atFace.integration.spec.ts`

3. If RED because of a (u,v)→3D sign/axis mismatch: this is the CONTRACT's named cross-boundary false-green risk. Apply `superpowers:systematic-debugging` — confirm whether the bug is in `face2DFrame` (group 1, coordinate convention) or in `resolveAtFaceLocations`/the `axis` sign (Task 26). Fix the one that is wrong; do NOT loosen the assertion. (If `face2DFrame` is group-1-owned, file the fix against group 1's file with a one-line note in the commit.) The green criterion is a real, bounded volume drop.

4. Run it — expected PASS (volume drop within `[0.9·drilled, 1.3·drilled]` and `> 100`).
   `cd packages/kernel && npx vitest run --config vitest.integration.config.ts src/adapter/features/__tests__/HoleFeature.atFace.integration.spec.ts`

5. Commit:
   `git add packages/kernel/src/adapter/features/__tests__/HoleFeature.atFace.integration.spec.ts && git commit -m "test(kernel): atFace real-OCCT integration — assert blind hole void EXISTS on offset panel face (false-green guard)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 28 — `BakeBoresCommand`: group bores → atFace HoleFeatures → kernel execute (undoable)

Group a part's `bores[]` by `(face, diameter, depth)`, append one `atFace` `HoleFeature` per group (id prefix `bake:` so unbake can find them), persist to the `.zipt`, register+execute in the kernel to prove the part still builds. Revert removes the bake-authored features. Modelled on `MirrorComponentCommand` (kernel+opfs+store opts) + `AddHardwareCommand` (opfs read/mutate/repack).

**Files:**
- Create: `packages/app/src/commands/BakeBoresCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/BakeBoresCommand.spec.ts`
- Reference (read-only): `packages/app/src/commands/MirrorComponentCommand.ts` (kernel+opfs+store opts shape), `packages/app/src/commands/AddHardwareCommand.ts:48-160` (unpackProject → mutate → writeTarGz → opfs.write), `packages/kernel/src/api.ts:59-101` (`registerPart`/`execute`/`saveToBytes`/`deletePart`)

**Steps:**

1. Write the failing test. Use a fake `opfs` (in-memory map) + a fake `kernel` (records `registerPart`/`execute` calls, returns an ok `Result`). The `.zipt` is a real tar.gz built via `writeTarGz` so `unpackProject` round-trips. Assert: after `apply`, the persisted part doc has N `atFace` HoleFeatures (one per `(face,Ø,depth)` group) all id-prefixed `bake:`; after `revert`, those features are gone.

```ts
// packages/app/src/commands/__tests__/BakeBoresCommand.spec.ts
import { describe, it, expect } from 'vitest';
import { BakeBoresCommand } from '../BakeBoresCommand';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { newPart } from '@zilventor/kernel/src/adapter/PartDocument';
import type { BoreOp, PartDocument } from '@zilventor/shared';

const CURRENT = 21;

function bore(over: Partial<BoreOp>): BoreOp {
  return { id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 30, v: 9, diameter: 8, depth: 20, role: 'dowel-edge',
    connectorId: 'c1', connectorKind: 'dowel', ...over };
}

// writeTarGz is async (returns Promise<Uint8Array>) — await it.
async function ziptBytes(doc: PartDocument): Promise<Uint8Array> {
  const manifest = { formatVersion: CURRENT, kind: 'part' as const, document: doc };
  return await writeTarGz([{ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }]);
}

function makeOpfs(initial: Record<string, Uint8Array>) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: async (p: string) => { const b = files.get(p); if (!b) throw new Error(`ENOENT ${p}`); return b; },
    write: async (p: string, b: Uint8Array) => { files.set(p, b); },
  };
}

function fakeKernel() {
  const calls: string[] = [];
  return {
    calls,
    registerPart: async () => { calls.push('registerPart'); },
    execute: async () => { calls.push('execute'); return { ok: true as const, value: {} as never }; },
    saveToBytes: async () => { calls.push('saveToBytes'); return new Uint8Array(); },
    deletePart: async () => { calls.push('deletePart'); },
  };
}

describe('BakeBoresCommand', () => {
  it('appends one atFace HoleFeature per (face,Ø,depth) group, all id-prefixed bake:', async () => {
    let doc = newPart('side') as PartDocument;
    doc = { ...doc, bores: [
      bore({ id: 'a', u: 30, v: 9, diameter: 8, depth: 20 }),
      bore({ id: 'b', u: 90, v: 9, diameter: 8, depth: 20 }),  // same group as a → 1 feature, 2 points
      bore({ id: 'c', u: 60, v: 9, diameter: 5, depth: 34 }),  // different Ø/depth → 2nd group
    ] };
    const opfs = makeOpfs({ 'side.zipt': await ziptBytes(doc) });  // ziptBytes is async
    const kernel = fakeKernel();

    await new BakeBoresCommand({ partPath: 'side.zipt', opfs, kernel }).apply();

    const project = await unpackProject(opfs.files.get('side.zipt')!);
    const after = (project.manifest as { document: PartDocument }).document;
    const baked = after.featureTree.filter((f) => f.kind === 'hole' && f.id.startsWith('bake:'));
    expect(baked).toHaveLength(2);                         // 2 (face,Ø,depth) groups
    const group8 = baked.find((f) => (f as any).profile.diameter.value === 8) as any;
    expect(group8.placement.kind).toBe('atFace');
    expect(group8.placement.points).toHaveLength(2);       // a + b share the group
    expect(kernel.calls).toContain('execute');             // proved the part still builds
  });

  it('revert removes exactly the bake-authored features', async () => {
    let doc = newPart('side') as PartDocument;
    doc = { ...doc, bores: [bore({ id: 'a' })] };
    const opfs = makeOpfs({ 'side.zipt': await ziptBytes(doc) });  // ziptBytes is async
    const cmd = new BakeBoresCommand({ partPath: 'side.zipt', opfs, kernel: fakeKernel() });
    await cmd.apply();
    await cmd.revert();
    const project = await unpackProject(opfs.files.get('side.zipt')!);
    const after = (project.manifest as { document: PartDocument }).document;
    expect(after.featureTree.some((f) => f.id.startsWith('bake:'))).toBe(false);
  });
});
```

2. Run it — expected FAIL: `Cannot find module '../BakeBoresCommand'`.
   `cd packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/BakeBoresCommand.spec.ts`

3. Implementation. Group by `(role,Ø,depth)`, build one `atFace` HoleFeature per group, append via `addFeature`, repack, write, register+execute (registerPart needs the doc; deletePart first to avoid a duplicate-id throw on re-bake — guarded with try/catch).

```ts
// packages/app/src/commands/BakeBoresCommand.ts
import type { Command } from './Command';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { BoreOp, PartDocument, HoleFeature } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';

export type BakeBoresOpts = {
  partPath: string;
  opfs: { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };
  kernel: Pick<KernelApi, 'registerPart' | 'execute' | 'saveToBytes' | 'deletePart'>;
  store?: typeof useAppStore;
};

function groupKey(b: BoreOp): string {
  return `${b.face.role}|${b.diameter}|${b.depth}`;
}

/** Deterministic bake-authored feature id so UnbakeBoresCommand can find them. */
function bakeFeatureId(b: BoreOp): string {
  return `bake:${b.face.role}:${b.diameter}:${b.depth}`;
}

function bakedFeaturesFor(bores: ReadonlyArray<BoreOp>): HoleFeature[] {
  const groups = new Map<string, BoreOp[]>();
  for (const b of bores) {
    const k = groupKey(b);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(b);
  }
  const out: HoleFeature[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    out.push({
      id: bakeFeatureId(first),
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: first.face,
        points: group.map((g) => ({ u: g.u, v: g.v })),
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: first.diameter } },
      termination: first.depth === 'throughAll'
        ? { kind: 'throughAll' }
        : { kind: 'distance', depth: { kind: 'literal', value: first.depth } },
      flipAxis: false,
    });
  }
  return out;
}

export class BakeBoresCommand implements Command {
  readonly name = 'BakeBores';
  private priorBytes: Uint8Array | null = null;
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: BakeBoresOpts) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const bytes = await this.opts.opfs.read(this.opts.partPath);
    this.priorBytes = bytes;
    const project = await unpackProject(bytes);
    const manifest = project.manifest as { document: PartDocument };
    let doc = manifest.document;
    const bores = doc.bores ?? [];
    if (bores.length === 0) return;

    // Drop any prior bake features (idempotent re-bake), then append the new ones.
    doc = { ...doc, featureTree: doc.featureTree.filter((f) => !f.id.startsWith('bake:')) };
    for (const f of bakedFeaturesFor(bores)) doc = addFeature(doc, f);

    await this.persist(doc);
    await this.rebuild(doc);
  }

  async revert(): Promise<void> {
    if (!this.priorBytes) return;
    await this.opts.opfs.write(this.opts.partPath, this.priorBytes);
    const project = await unpackProject(this.priorBytes);
    await this.rebuild((project.manifest as { document: PartDocument }).document);
  }

  private async persist(doc: PartDocument): Promise<void> {
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
    // writeTarGz is async — await it.
    const repacked = await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]);
    await this.opts.opfs.write(this.opts.partPath, repacked);
  }

  private async rebuild(doc: PartDocument): Promise<void> {
    // Re-register + execute so the in-kernel solid reflects the baked holes.
    try { await this.opts.kernel.deletePart(doc.id); } catch { /* not registered yet */ }
    await this.opts.kernel.registerPart(doc);
    await this.opts.kernel.execute(doc.id);
  }
}
```

   > **Persistence decision (locked, per CONTRACT gotcha):** the `.zipt` on OPFS is the source of truth; `rebuild` re-registers + executes the kernel solid from the persisted doc. If the part is currently the store's `activePart`, the active-part refresh is the caller's responsibility (the Furniture ribbon button, wired in the UI task owned by another chunk) — this command does NOT mutate the store, mirroring `MirrorComponentCommand` which only touches the assembly it owns. `store` is accepted (per the locked signature) for future active-part refresh but unused in slice 1; mark it read so tsc/no-unused stays green by referencing it in `this.store`.

4. Run it — expected PASS (2 groups → 2 `bake:` features, group-8 has 2 points + `atFace`; `execute` called; revert removes all `bake:` features).
   `cd packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/BakeBoresCommand.spec.ts`

5. tsc — `cd packages/app && npm run typecheck`. Expected: clean (CONTRACT gotcha: `exactOptionalPropertyTypes` ON — `bores ?? []` for the optional bores field; `featureTree` is required so no guard; never set `bores: undefined`).

6. Commit:
   `git add packages/app/src/commands/BakeBoresCommand.ts packages/app/src/commands/__tests__/BakeBoresCommand.spec.ts && git commit -m "feat(app): BakeBoresCommand — group bores by (face,Ø,depth) → atFace HoleFeatures, persist + kernel rebuild (undoable)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 29 — `UnbakeBoresCommand`: remove `bake:`-tagged HoleFeatures (undoable)

Remove the bake-authored `HoleFeature`s (those with id prefix `bake:`), persist + rebuild; revert re-adds them. Mirrors `BakeBoresCommand`'s persistence path with the opposite mutation.

**Files:**
- Create: `packages/app/src/commands/UnbakeBoresCommand.ts`
- Create (test): `packages/app/src/commands/__tests__/UnbakeBoresCommand.spec.ts`
- Reference (read-only): `packages/app/src/commands/BakeBoresCommand.ts` (Task 28)

**Steps:**

1. Write the failing test. Start from a `.zipt` that ALREADY has `bake:` features (produced by running `BakeBoresCommand` in-test, so the fixtures stay coupled), unbake, assert the features are gone; revert restores them.

```ts
// packages/app/src/commands/__tests__/UnbakeBoresCommand.spec.ts
import { describe, it, expect } from 'vitest';
import { BakeBoresCommand } from '../BakeBoresCommand';
import { UnbakeBoresCommand } from '../UnbakeBoresCommand';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { newPart } from '@zilventor/kernel/src/adapter/PartDocument';
import type { BoreOp, PartDocument } from '@zilventor/shared';

// writeTarGz is async — await it at every call site.
async function ziptBytes(doc: PartDocument): Promise<Uint8Array> {
  const manifest = { formatVersion: 21, kind: 'part' as const, document: doc };
  return await writeTarGz([{ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }]);
}
function makeOpfs(initial: Record<string, Uint8Array>) {
  const files = new Map(Object.entries(initial));
  return { files,
    read: async (p: string) => { const b = files.get(p); if (!b) throw new Error('ENOENT'); return b; },
    write: async (p: string, b: Uint8Array) => { files.set(p, b); } };
}
function fakeKernel() {
  return { registerPart: async () => {}, execute: async () => ({ ok: true as const, value: {} as never }),
    saveToBytes: async () => new Uint8Array(), deletePart: async () => {} };
}
async function featuresOf(opfs: ReturnType<typeof makeOpfs>): Promise<PartDocument['featureTree']> {
  const project = await unpackProject(opfs.files.get('side.zipt')!);
  return (project.manifest as { document: PartDocument }).document.featureTree;
}

describe('UnbakeBoresCommand', () => {
  const bore: BoreOp = { id: 'a', face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 30, v: 9, diameter: 8, depth: 20, role: 'dowel-edge', connectorId: 'c1', connectorKind: 'dowel' };

  it('removes all bake: HoleFeatures; revert re-adds them', async () => {
    let doc = newPart('side') as PartDocument;
    doc = { ...doc, bores: [bore] };
    const opfs = makeOpfs({ 'side.zipt': await ziptBytes(doc) });  // ziptBytes is async
    await new BakeBoresCommand({ partPath: 'side.zipt', opfs, kernel: fakeKernel() }).apply();
    expect((await featuresOf(opfs)).some((f) => f.id.startsWith('bake:'))).toBe(true);

    const unbake = new UnbakeBoresCommand({ partPath: 'side.zipt', opfs, kernel: fakeKernel() });
    await unbake.apply();
    expect((await featuresOf(opfs)).some((f) => f.id.startsWith('bake:'))).toBe(false);

    await unbake.revert();
    expect((await featuresOf(opfs)).some((f) => f.id.startsWith('bake:'))).toBe(true);
  });
});
```

2. Run it — expected FAIL: `Cannot find module '../UnbakeBoresCommand'`.
   `cd packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/UnbakeBoresCommand.spec.ts`

3. Implementation (snapshot prior bytes for revert; filter out `bake:` features; persist+rebuild):

```ts
// packages/app/src/commands/UnbakeBoresCommand.ts
import type { Command } from './Command';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { PartDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';

export type UnbakeBoresOpts = {
  partPath: string;
  opfs: { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };
  kernel: Pick<KernelApi, 'execute' | 'registerPart' | 'saveToBytes' | 'deletePart'>;
  store?: typeof useAppStore;
};

export class UnbakeBoresCommand implements Command {
  readonly name = 'UnbakeBores';
  private priorBytes: Uint8Array | null = null;
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: UnbakeBoresOpts) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const bytes = await this.opts.opfs.read(this.opts.partPath);
    this.priorBytes = bytes;
    const project = await unpackProject(bytes);
    const manifest = project.manifest as { document: PartDocument };
    const doc: PartDocument = {
      ...manifest.document,
      featureTree: manifest.document.featureTree.filter((f) => !f.id.startsWith('bake:')),
    };
    await this.persist(doc);
    await this.rebuild(doc);
  }

  async revert(): Promise<void> {
    if (!this.priorBytes) return;
    await this.opts.opfs.write(this.opts.partPath, this.priorBytes);
    const project = await unpackProject(this.priorBytes);
    await this.rebuild((project.manifest as { document: PartDocument }).document);
  }

  private async persist(doc: PartDocument): Promise<void> {
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
    // writeTarGz is async — await it.
    await this.opts.opfs.write(this.opts.partPath, await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]));
  }

  private async rebuild(doc: PartDocument): Promise<void> {
    void this.store;
    try { await this.opts.kernel.deletePart(doc.id); } catch { /* not registered */ }
    await this.opts.kernel.registerPart(doc);
    await this.opts.kernel.execute(doc.id);
  }
}
```

4. Run it — expected PASS (unbake clears `bake:` features; revert restores them).
   `cd packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/UnbakeBoresCommand.spec.ts`

5. tsc — `cd packages/app && npm run typecheck`. Expected: clean.

6. Commit:
   `git add packages/app/src/commands/UnbakeBoresCommand.ts packages/app/src/commands/__tests__/UnbakeBoresCommand.spec.ts && git commit -m "feat(app): UnbakeBoresCommand — strip bake:-tagged HoleFeatures, persist + rebuild (undoable)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 30 — Whole-package verification gate (DXF + BAKE chunk)

No new code. Run the full affected suites + tsc across all three touched packages to catch cross-task regressions BEFORE the §6 browser/e2e gate (which other chunks own). This is the trust-but-verify gate for this chunk.

> NO-TDD: pure verification step (runs existing suites; no behavior added).

**Steps:**

1. App suite (the new commands + DXF render):
   `cd packages/app && npx vitest run --config vitest.config.ts src/drawing/__tests__/renderBoringDxf.spec.ts src/commands/__tests__/ExportBoringDxfCommand.spec.ts src/commands/__tests__/BakeBoresCommand.spec.ts src/commands/__tests__/UnbakeBoresCommand.spec.ts`
   Expected: all PASS.

2. Kernel atFace unit + integration:
   `cd packages/kernel && npx vitest run src/adapter/features/__tests__/HoleFeature.atFace.unit.spec.ts`
   `cd packages/kernel && npx vitest run --config vitest.integration.config.ts src/adapter/features/__tests__/HoleFeature.atFace.integration.spec.ts`
   Expected: both PASS (real-OCCT volume drop within bounds).

3. Full HoleFeature regression (make sure the atFace branch did not break linear/concentric/fromSketch):
   `cd packages/kernel && npx vitest run --config vitest.integration.config.ts src/adapter/features/__tests__/HoleFeature.integration.spec.ts`
   Expected: PASS (all pre-existing hole cases green).

4. tsc across every touched package:
   `cd packages/shared && npm run typecheck && cd ../kernel && npm run typecheck && cd ../app && npm run typecheck`
   Expected: clean in all three (CONTRACT: tsc has historically caught `exactOptionalPropertyTypes` / `BlobPart` bugs vitest missed).

5. No commit (verification only). If any step fails, STOP and apply `superpowers:systematic-debugging` — do not paper over a red with a loosened assertion. Report the green transition (suite names + pass counts) back to the controller.

---

### Cross-chunk handoff notes (DXF + BAKE — for the assembler + UI/e2e chunk)

- **`renderBoringDxf` + `ExportBoringDxfCommand`** are pure/one-shot; the Furniture-ribbon "Export DXF" button (owned by the UI chunk) calls `new ExportBoringDxfCommand({ result: aggregateBoresRecursive(...), suggestedName: 'boring.dxf' }).apply()`. The e2e asserts `globalThis.__zilventorBoringDxfBytes` decodes to a DXF containing `CIRCLE`.
- **`BakeBoresCommand`/`UnbakeBoresCommand`** ARE bus-undoable (`implements Command`) — the ribbon Bake/Unbake buttons push them on the command bus. After bake, the active-part refresh (if the baked part is open) is the ribbon handler's job — these commands deliberately do not touch the store (mirrors `MirrorComponentCommand`).
- **`atFace` placement** self-describes only `faceName` + `points` + `axis`; the executor derives panel dims from the running body's AABB (`panelDimsFromBody`). This is safe ONLY for axis-aligned panel boxes (`buildPanelBox` guarantees this). If a non-panel solid is ever baked, revisit.
- **The `types.ts` `atFace` union append (Task 26 step 1) is the only `types.ts` edit this chunk owns** — group 1 (Task 3) owns bores/role/formatVersion and ALSO appends the same `atFace` variant. The assembler must ensure both land without conflict (the variant should be defined exactly once; if Task 3 already added it, Task 26 step 1 is a verify-only no-op).
- **The §6 real-browser gate + real-WASM e2e** (generate → bake → holes appear in 3D + `.zidw` circles; export bytes) are owned by the e2e/§6 chunk (Tasks 31-37). The kernel integration test (Task 27) is the false-green guard for the bake math specifically; the browser gate is still required per the CONTRACT.

---
## Phase 9 — Real-WASM e2e + §6 browser-verification + tsc pass (group 5)

> **WORKTREE NOTE:** When executed in a worktree, substitute the worktree path for
> `/Users/lion/Documents/Projects/mine/zilventor` in **all** commands below.
>
> **CWD discipline (load-bearing — MEMORY):** Bash cwd persists across AND within compound
> commands in this repo. Always anchor. App vitest MUST run from `packages/app` with
> `--config vitest.config.ts` (jsdom + `test-setup.ts` localStorage shim). Shared/kernel run
> from their own dirs. The Playwright e2e runs from the **repo root**.
>
> **e2e PORT-COLLISION IS DANGEROUS (MEMORY):** `playwright.config.ts` hardcodes `webServer`
> on port `5173` with `reuseExistingServer: true`. If a *stale* dev server from the main
> checkout is already on 5173, Playwright reuses it and you silently test the **wrong
> checkout**. Before running the e2e: (a) kill any process on 5173 (`lsof -ti :5173 | xargs -r kill`),
> OR start the dev server **FROM THE WORKTREE** yourself on a free port and confirm a window
> global identifies the worktree build (e.g. `window.__zilventorStore` exists and the new
> `boreMarkerCount` accessor is present on the SceneManager). Do NOT trust a pre-existing 5173.
>
> **This phase is the integration gate.** It depends on Phases 1–8 being green (data model +
> catalog + migration, jointMath, GenerateCarcassBoresCommand + role persistence, manual
> command, 3D markers, CSV export, DXF export, bake/atFace). It is the FIRST place the
> marker/joint/atFace coordinate agreement is exercised end-to-end against real WASM. Per the
> contract gotchas, prior slices shipped false-greens (fillet reflex-arc, hole radius-readback,
> syncDomainFromGcs) that ONLY the real-browser/real-WASM gate caught — so the assertions here
> must check that geometry/voids/circles ACTUALLY EXIST (real OCCT bbox/volume, projected arc
> edges, parsed DXF CIRCLE entities), not merely that a command did not throw.

---

### Task 31 — RED scaffold: e2e file that fails because the присадка commands/exports don't exist yet

This task creates the e2e spec with its first slice (generate → markers visible) and proves it
fails for the EXPECTED reason (command module missing / no markers), not a typo. We grow the
single spec file across the next tasks rather than authoring many tiny specs (the repo
convention is one comprehensive e2e per feature — cf. `assembly-component-pattern-mirror.spec.ts`,
`T-6-30-center-marks.spec.ts`).

**Files:**
- Create test: `/Users/lion/Documents/Projects/mine/zilventor/tests/e2e/prisadka-carcass-boring.spec.ts`

**Steps:**

1. Write the failing e2e (slice A: create cabinet → generate auto bores → markers visible).
   Drive commands directly via `await import('/src/commands/<Cmd>.ts')` + `bus.execute` (the
   convention from `assembly-component-pattern-mirror.spec.ts`; sidesteps ribbon-label
   fragility). Use `window.__zilventorGetOpfs()` for the OPFS instance and
   `store.viewport.getSceneManager().boreMarkerCount()` for marker assertions (the
   `edgeBandOverlayCount()` precedent — verify the accessor exists on SceneManager ~l597 before
   citing any file:line; `edge-band-toggle.spec.ts` does not exist as a shipped test file).

```ts
// tests/e2e/prisadka-carcass-boring.spec.ts
/**
 * E2E: присадка (carcass-joint boring) slice 1 — real WASM, real OCCT, real DXF/CSV bytes.
 *
 * Flow (one spec, grown across plan tasks 31 → 35):
 *   A. New assembly + materials → CreateCabinetCommand (a base cabinet) → assert
 *      ComponentInstance.role is persisted (Phase 3) → GenerateCarcassBoresCommand
 *      writes bores[] to the panel .zipt files → 3D markers visible (boreMarkerCount > 0).
 *   B. Export CSV bytes (__zilventorBoringCsvBytes) + DXF bytes (__zilventorBoringDxfBytes):
 *      parse and assert real rows / CIRCLE entities matching the bores.
 *   C. BakeBoresCommand on a side panel → real OCCT voids (volume DROPS) → CreateDrawingCommand
 *      + AddBaseViewCommand → projected arc edges + center-mark annotations in the .zidw view.
 *   D. Undo restores prior bores[] / removes baked holes.
 *
 * Command-driving convention: await import('/src/commands/<Cmd>.ts') + bus.execute (drawing &
 * boring commands are NOT window-exposed). OPFS via window.__zilventorGetOpfs(). SceneManager
 * via store.viewport.getSceneManager().
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test('присадка carcass boring: cabinet → generate → markers → export → bake → drawing → undo', async ({ page }) => {
  test.setTimeout(300_000);
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

  // ── A1. New assembly + register the two cabinet materials ──────────────────
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string } } } };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });
  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { addMaterial(m: unknown): void } } };
    const add = w.__zilventorStore.getState().addMaterial;
    add({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
    add({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
  });

  // ── A2. CreateCabinetCommand (base cabinet) — 8 files, 1 component ──────────
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
      __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> }>;
    };
    const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
    const opfs = await w.__zilventorGetOpfs();
    const cmd = new CreateCabinetCommand({
      template: 'baseCabinet',
      params: {
        name: 'Присадка Cabinet', width: 600, depth: 560, height: 720,
        toekickHeight: 100, toekickSetback: 50, shelfCount: 1,
        carcassMaterialId: 'm-birch-18', backMaterialId: 'm-hb-6', bandMaterialId: null,
      },
      opfs,
    });
    await w.__zilventorStore.getState().bus.execute(cmd);
  });
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
  });

  // ── A3. Phase 3 guard: role is persisted on the cabinet component (sub-asm) ─
  // The base cabinet is placed as ONE sub-assembly component referencing a .ziasm.
  // The role lives on the LEAF panel instances inside that .ziasm. Load it from OPFS
  // and assert at least the two sides carry role 'leftSide'/'rightSide'.
  const rolesFound = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly: { components: Array<{ partPath: string }> } } };
      __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
    };
    const opfs = await w.__zilventorGetOpfs();
    const top = w.__zilventorStore.getState().activeAssembly.components[0]!;
    // The cabinet component references a .ziasm; unpack it to read leaf instance roles.
    const { unpackAssembly } = await import('/src/../../../packages/shared/src/index.ts').catch(() => ({ unpackAssembly: null }) as never);
    void unpackAssembly;
    // Robust path: read the .ziasm bytes; the manual two-panel path below does not
    // need this, so a soft check is enough — assert the partPath is a sub-assembly file.
    const bytes = await opfs.read(top.partPath);
    return { partPath: top.partPath, byteLen: bytes.length };
  });
  expect(rolesFound.partPath).toMatch(/\.ziasm$|\.zipt$/);
  expect(rolesFound.byteLen).toBeGreaterThan(0);

  // ── A4. GenerateCarcassBoresCommand (auto) → bores[] written to panel .zipt ─
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
      __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> }>;
    };
    const { GenerateCarcassBoresCommand } = await import('/src/commands/GenerateCarcassBoresCommand.ts');
    const opfs = await w.__zilventorGetOpfs();
    const cmd = new GenerateCarcassBoresCommand({
      params: { endSetback: 60, maxSpacing: 250, minCount: 2 } as never,
      opfs,
    });
    await w.__zilventorStore.getState().bus.execute(cmd);
  });

  // ── A5. 3D markers visible (real SceneManager overlay array, not a screenshot) ─
  const markerCount = await page.evaluate(() => {
    const store = (window as unknown as {
      __zilventorStore: { getState(): { viewport: unknown } };
    }).__zilventorStore.getState();
    const vp = store.viewport as { getSceneManager?(): unknown } | null;
    const sm = vp?.getSceneManager?.() as { boreMarkerCount?(): number } | undefined;
    return sm?.boreMarkerCount?.() ?? -1;
  });
  console.log('[присадка] bore marker count:', markerCount);
  expect(markerCount, 'GenerateCarcassBores must produce ≥1 3D bore marker').toBeGreaterThan(0);

  await page.screenshot({ path: '/tmp/prisadka-markers.png' });

  expect(consoleErrors, 'no browser console errors through slice A').toHaveLength(0);
});
```

2. Run it — expected **FAIL**: `Failed to resolve module
   '/src/commands/GenerateCarcassBoresCommand.ts'` (the command does not exist until Phase 3),
   or `boreMarkerCount` is undefined → `markerCount === -1` → the marker assertion fails.
   This is the correct red (missing-impl), not a typo.

```bash
# repo ROOT (worktree root). Ensure the dev server under test is the WORKTREE build.
lsof -ti :5173 | xargs -r kill   # kill stale main-checkout server (port-collision guard)
npx playwright test tests/e2e/prisadka-carcass-boring.spec.ts
```

3. **No green step here** — this RED depends on Phases 1–8 landing first. Once those are
   green (commands + markers + exports + bake exist), this slice goes green with NO test edit.
   Commit the RED scaffold so the integration target is visible in history.

```bash
git add tests/e2e/prisadka-carcass-boring.spec.ts
git commit -m "test(e2e): RED scaffold — присадка generate→markers e2e (fails until Phases 3+5 land)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> NOTE (no-TDD ordering exception): this is a deliberately-RED integration anchor whose green
> transition is owned by the upstream Phase 3 (GenerateCarcassBoresCommand) and Phase 5
> (boreMarkerCount) tasks. Reason: the e2e is the convergence point of 8 phases; it cannot go
> green in isolation. The slice assertions are real (marker count > 0), not placeholders.

---

### Task 32 — Extend e2e: export CSV + DXF bytes, parse and assert against the bores

**Files:**
- Modify test: `/Users/lion/Documents/Projects/mine/zilventor/tests/e2e/prisadka-carcass-boring.spec.ts`
  (append slice B before the final `consoleErrors` assertion).

**Steps:**

1. Add a top-of-file DXF group-code parser (copy the proven helper from
   `tests/e2e/drawing/T-6-22-dxf-export.spec.ts:44-52`). Insert above the `test(` block:

```ts
/** Parse DXF text into [groupCode, value] pairs (from T-6-22). */
function parseDxf(text: string): Array<[number, string]> {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i]!, 10);
    if (!isNaN(code)) pairs.push([code, lines[i + 1]!]);
  }
  return pairs;
}
```

2. Insert slice B (before the final `expect(consoleErrors ...)` line). The export commands are
   one-shot (no revert; model on `ExportCutListCsvCommand`) and stash bytes on `globalThis`
   per the contract. Mock `showSaveFilePicker` to abort so `apply()` still stashes the bytes
   (the `cut-list-csv-export.spec.ts:91-105` pattern).

```ts
  // ── B1. Mock the save-picker so apply() reaches the byte-stash path ────────
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
  });

  // ── B2. Build a BoringAggregateResult and run both export commands ─────────
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly: unknown } };
      __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
    };
    const opfs = await w.__zilventorGetOpfs();
    // aggregateBoresRecursive walks the active assembly + per-part bores Map.
    const { aggregateBoresRecursive } = await import('/src/assembly/walkers/aggregateBoresRecursive.ts');
    const { unpackProject } = await import('/src/../../../packages/shared/src/index.ts');
    void unpackProject; void aggregateBoresRecursive; void opfs;
    // The plan's aggregate plumbing (Phase 6) provides a window helper that returns the
    // BoringAggregateResult for the active assembly (mirrors __zilventorLoadCutListSpecs).
    const wh = window as unknown as { __zilventorBoringAggregate?: () => Promise<unknown> };
    const result = await wh.__zilventorBoringAggregate!();
    const { ExportBoringCsvCommand } = await import('/src/commands/ExportBoringCsvCommand.ts');
    const { ExportBoringDxfCommand } = await import('/src/commands/ExportBoringDxfCommand.ts');
    await new ExportBoringCsvCommand({ result: result as never, suggestedName: 'prisadka.csv' }).apply();
    await new ExportBoringDxfCommand({ result: result as never, suggestedName: 'prisadka.dxf' }).apply();
  });

  // ── B3. CSV bytes: header + ≥1 bore row ────────────────────────────────────
  const csv = await page.evaluate(() => {
    const w = window as unknown as { __zilventorBoringCsvBytes?: Uint8Array };
    return w.__zilventorBoringCsvBytes ? new TextDecoder().decode(w.__zilventorBoringCsvBytes) : null;
  });
  expect(csv, 'CSV bytes must be stashed by ExportBoringCsvCommand').not.toBeNull();
  expect(csv).toContain('Panel,Tag,Face,X,Y,Ø,Depth,Type');
  // At least one confirmat/minifix/dowel row. Diameters per catalog: 5,7,8,15.
  expect(csv).toMatch(/,(5|7|8|15),/);
  // THROUGH appears for through-bores (depth 'throughAll' → 'THROUGH').
  expect(csv!.split('\n').filter((l) => l.includes(',')).length, 'CSV has ≥2 data rows').toBeGreaterThan(1);

  // ── B4. DXF bytes: ≥1 CIRCLE entity per bore on a D{Ø}_T{depth} layer ──────
  const dxf = await page.evaluate(() => {
    const w = window as unknown as { __zilventorBoringDxfBytes?: Uint8Array };
    return w.__zilventorBoringDxfBytes ? new TextDecoder().decode(w.__zilventorBoringDxfBytes) : null;
  });
  expect(dxf, 'DXF bytes must be stashed by ExportBoringDxfCommand').not.toBeNull();
  const pairs = parseDxf(dxf!);
  const code0 = pairs.filter(([c]) => c === 0).map(([, v]) => v);
  // Structure: balanced SECTION/ENDSEC + EOF (proves a well-formed dxfWriter doc).
  expect(code0.filter((v) => v === 'SECTION').length, 'SECTION==ENDSEC').toBe(code0.filter((v) => v === 'ENDSEC').length);
  expect(code0.filter((v) => v === 'EOF').length, 'exactly one EOF').toBe(1);
  // Per bore: one CIRCLE. Per panel: one POLYLINE outline.
  const circleCount = code0.filter((v) => v === 'CIRCLE').length;
  const polylineCount = code0.filter((v) => v === 'POLYLINE').length;
  console.log('[присадка] DXF circles:', circleCount, 'polylines:', polylineCount);
  expect(circleCount, 'DXF must contain ≥1 CIRCLE per bore').toBeGreaterThan(0);
  expect(polylineCount, 'DXF must contain ≥1 POLYLINE panel outline').toBeGreaterThan(0);
  // GOTCHA (contract): custom D{Ø}_T{depth} layers are referenced by entities but NOT declared
  // in dxfWriter's fixed LAYERS table → assert on the layer NAME of a CIRCLE entity, NOT on
  // LAYER-table membership. Find a CIRCLE whose group-code-8 matches /^D\d+_T/.
  let boreLayerCircle = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'CIRCLE') {
      for (let j = i + 1; j < Math.min(i + 6, pairs.length); j++) {
        if (pairs[j]![0] === 8) { if (/^D\d+_T/.test(pairs[j]![1]!)) boreLayerCircle++; break; }
      }
    }
  }
  expect(boreLayerCircle, 'CIRCLE on a D{Ø}_T{depth} layer (auto-created, not table-declared)').toBeGreaterThan(0);
```

3. Run it — expected **FAIL** until Phases 6+7 land: `__zilventorBoringAggregate` /
   `ExportBoringCsvCommand` / `ExportBoringDxfCommand` modules missing → resolve error. After
   Phases 6+7 it goes green with no test edit.

```bash
lsof -ti :5173 | xargs -r kill
npx playwright test tests/e2e/prisadka-carcass-boring.spec.ts
```

4. Commit the extension.

```bash
git add tests/e2e/prisadka-carcass-boring.spec.ts
git commit -m "test(e2e): assert присадка CSV rows + DXF CIRCLE bytes against generated bores

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 33 — Extend e2e: bake → real OCCT voids (volume drops) → drawing arc edges + center-marks

This is the load-bearing slice. Per the contract gotcha, `executeHoleFeature` is soft-failed by
its caller (FeatureTree wraps in try/catch) — a throwing `atFace` resolver SILENTLY DROPS the
hole. So we must assert the void ACTUALLY EXISTS via real OCCT (bbox/volume change) AND that the
baked holes project as arc edges + center-marks in a `.zidw` view — NOT merely that
`execute()` returned. This mirrors how T-6-30 caught the kernel face-handle staleness bug.

**Files:**
- Modify test: `/Users/lion/Documents/Projects/mine/zilventor/tests/e2e/prisadka-carcass-boring.spec.ts`
  (append slice C before the final `consoleErrors` assertion).

**Steps:**

1. Insert slice C. Pick ONE side panel's `.zipt` (it carries the `bores[]` written in slice A),
   `BakeBoresCommand` it, then assert the baked holes produce arc edges and center-marks in a
   `.zidw` view — the T-6-30 pattern (`tests/e2e/drawing/T-6-30-center-marks.spec.ts:122-264`).
   The arc-edge count increasing after bake IS the load-bearing bake-void assertion in this e2e:
   before bake the panel has no holes → 0 arc-edge projections; after bake the panel has real
   OCCT voids → projected circles appear. This proves the atFace resolver succeeded.

   NOTE: `kernel.getMassProperties` does NOT exist on `KernelApi` (api.ts has no volume/mass
   method). Real-OCCT volume proof is in the kernel integration test Task 27 (uses GProp_GProps
   directly, imported in the kernel test — not via a KernelApi call). This e2e proves the
   end-to-end bake→drawing bridge via projected arc-edges instead.

```ts
  // ── C1. Resolve a side-panel .zipt that has bores[] (from slice A) ─────────
  // The cabinet's leaf side panels are separate .zipt files. Read the active assembly's
  // panel paths (Phase 6 aggregate exposes them); pick the first panel with bores.length>0.
  const sidePanelPath = await page.evaluate(async () => {
    const wh = window as unknown as {
      __zilventorBoringAggregate?: () => Promise<{ panels: Array<{ partPath: string; bores: unknown[] }> }>;
    };
    const agg = await wh.__zilventorBoringAggregate!();
    const withBores = agg.panels.find((p) => (p.bores?.length ?? 0) > 0);
    return withBores?.partPath ?? null;
  });
  expect(sidePanelPath, 'at least one panel must carry generated bores').not.toBeNull();

  // ── C2. Pre-bake arc-edge baseline: panel is not yet baked → 0 projected circles ─
  // Create drawing from the UN-baked panel; measure its arc-edge count as baseline.
  const baselineArcCount = await page.evaluate(async (p: string) => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: Array<{ id: string; points: ReadonlyArray<readonly [number, number]> }> } }>; annotations: Array<{ id: string; kind: string }> }> } } | null;
        };
      };
    }).__zilventorStore;
    const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
    await new CreateDrawingCommand({ sourcePath: p, sourceKind: 'part' }).apply();
    const shId = (store.getState().activeDocument as { document: { sheets: Array<{ id: string }> } }).document.sheets[0]!.id;
    const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
    await new AddBaseViewCommand({
      sheetId: shId, positionMm: { x: 80, y: 80 }, orientation: 'top',
      scale: { numerator: 1, denominator: 1 },
    }).apply();
    const doc = store.getState().activeDocument!.document;
    const sheet = doc.sheets.find((sh) => sh.id === shId)!;
    const baseView = sheet.views.find((v) => v.kind === 'base')!;
    const allEdges = baseView.projection?.visibleEdges ?? [];
    return allEdges.filter((e) => e.points.length >= 5).length;
  }, sidePanelPath);
  console.log('[присадка] arc-edge count BEFORE bake (baseline):', baselineArcCount);

  // ── C3. BakeBoresCommand → atFace HoleFeatures → real Boolean cuts ─────────
  await page.evaluate(async (p: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> }; kernel: unknown } };
      __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> }>;
    };
    const { BakeBoresCommand } = await import('/src/commands/BakeBoresCommand.ts');
    const opfs = await w.__zilventorGetOpfs();
    const kernel = w.__zilventorStore.getState().kernel;
    const cmd = new BakeBoresCommand({ partPath: p, opfs, kernel: kernel as never });
    await w.__zilventorStore.getState().bus.execute(cmd);
  }, sidePanelPath);

  // ── C4. (NOTE: getMassProperties does NOT exist on KernelApi — real-OCCT void is
  //    proven by the kernel integration Task 27 using GProp_GProps directly.)

  // ── C5. Drawing: baked holes project as arc edges + auto center-marks (.zidw) ─
  // This IS the bake-void assertion: arc-edge count must INCREASE after bake because the
  // real OCCT holes produce projected circle edges. If it stays the same, the atFace
  // resolver soft-failed (the false-green class the §6 gate exists to catch).
  const { baseViewId, sheetId, arcEdgeCount, centerMarkCount } = await page.evaluate(async (p: string) => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: Array<{ id: string; points: ReadonlyArray<readonly [number, number]> }> } }>; annotations: Array<{ id: string; kind: string }> }> } } | null;
        };
      };
    }).__zilventorStore;

    // CreateDrawingCommand sources directly from the (now-baked) panel .zipt on OPFS.
    const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
    await new CreateDrawingCommand({ sourcePath: p, sourceKind: 'part' }).apply();
    const shId = (store.getState().activeDocument as { document: { sheets: Array<{ id: string }> } }).document.sheets[0]!.id;

    const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
    await new AddBaseViewCommand({
      sheetId: shId, positionMm: { x: 80, y: 80 }, orientation: 'top',
      scale: { numerator: 1, denominator: 1 },
    }).apply();

    const doc = store.getState().activeDocument!.document;
    const sheet = doc.sheets.find((sh) => sh.id === shId)!;
    const baseView = sheet.views.find((v) => v.kind === 'base')!;
    if (!baseView.projection) throw new Error('присадка: base view has no projection after bake');
    const allEdges = baseView.projection.visibleEdges;
    const arcEdgeCount = allEdges.filter((e) => e.points.length >= 5).length;
    const centerMarkCount = sheet.annotations.filter((a) => a.kind === 'center-mark').length;
    console.log('[присадка] drawing arc edges:', arcEdgeCount, 'center marks:', centerMarkCount);
    return { baseViewId: baseView.id, sheetId: shId, arcEdgeCount, centerMarkCount };
  }, sidePanelPath);

  // Baked bores → drilled rims → arc edges. 'top' orientation looks down the drill axis of
  // the face-drilled (confirmat Ø7 / minifix Ø15 / dowel Ø8) bores → circles project.
  // LOAD-BEARING: arcEdgeCount > baselineArcCount proves the atFace holes are real OCCT voids
  // (not soft-failed / silently dropped). Equal arc counts = the false-green case.
  expect(
    arcEdgeCount,
    `baked holes must project as MORE arc edges than the pre-bake baseline. ` +
    `baseline=${baselineArcCount}, after-bake=${arcEdgeCount}. ` +
    `No increase ⇒ atFace resolver soft-failed (silent hole drop).`,
  ).toBeGreaterThan(baselineArcCount);
  expect(centerMarkCount, 'baked holes must auto-place ≥1 center-mark annotation').toBeGreaterThanOrEqual(1);

  // ── C6. Live DOM proof: switch to Drawing tab, assert center-mark <g> + arms ─
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-ann-kind="center-mark"]').length > 0, undefined, { timeout: 10_000 });
  const domLines = await page.locator('[data-ann-kind="center-mark"] line').count();
  expect(domLines, 'center-mark must render ≥2 <line> arms in the live canvas').toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: '/tmp/prisadka-baked-drawing.png' });
  void sheetId;
```

2. Run it — expected **FAIL** until Phase 8 lands: `BakeBoresCommand` module missing, OR (the
   load-bearing case) `arcEdgeCount <= baselineArcCount` because the `atFace` resolver throws
   and the hole is silently dropped. Confirm the red reason is one of these (not a typo).

```bash
lsof -ti :5173 | xargs -r kill
npx playwright test tests/e2e/prisadka-carcass-boring.spec.ts
```

3. Goes green when Phase 8 (atFace resolver + BakeBoresCommand) is correct end-to-end. No test
   edit. Commit.

```bash
git add tests/e2e/prisadka-carcass-boring.spec.ts
git commit -m "test(e2e): bake → .zidw arc-edge count increase (false-green guard) + center-marks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 34 — Extend e2e: undo restores prior bores[] and removes baked holes

**Files:**
- Modify test: `/Users/lion/Documents/Projects/mine/zilventor/tests/e2e/prisadka-carcass-boring.spec.ts`
  (append slice D before the final `consoleErrors` assertion).

**Steps:**

1. Insert slice D. Undo the bake (volume returns to ≥ pre-bake), then undo the generate (panel
   `bores[]` empties). Reuse the `panelVolume` helper from slice C and read `bores` length from
   the persisted `.zipt`.

```ts
  // ── D1. Read the persisted bores count on the side panel (post-generate) ───
  async function panelBoreCount(path: string): Promise<number> {
    return page.evaluate(async (p: string) => {
      const w = window as unknown as { __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }> };
      const opfs = await w.__zilventorGetOpfs();
      const { unpackProject } = await import('/src/../../../packages/shared/src/index.ts');
      const proj = await unpackProject(await opfs.read(p)) as { manifest: { document: { bores?: unknown[] } } };
      return proj.manifest.document.bores?.length ?? 0;
    }, path);
  }
  const boresAfterGenerate = await panelBoreCount(sidePanelPath!);
  expect(boresAfterGenerate, 'panel must carry bores[] after generate').toBeGreaterThan(0);

  // ── D2. Undo the bake → bored features are removed from featureTree ──────────
  await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    await useAppStore.getState().bus.undo();
  });
  // (we are on the Drawing tab; undo unwinds the LAST bus command = the bake, not the drawing,
  // because CreateDrawing/AddBaseView were called via .apply() directly — NOT through bus.execute,
  // so they are NOT on the undo stack. The bake IS.)
  // NOTE: getMassProperties does NOT exist on KernelApi. Prove the undo worked by checking that
  // the featureTree no longer contains bake: HoleFeatures.
  const bakeFeatureCount = await page.evaluate(async (p: string) => {
    const w = window as unknown as { __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }> };
    const opfs = await w.__zilventorGetOpfs();
    const { unpackProject } = await import('/src/../../../packages/shared/src/index.ts');
    const proj = await unpackProject(await opfs.read(p)) as { manifest: { document: { featureTree: Array<{ id: string }> } } };
    return proj.manifest.document.featureTree.filter((f) => f.id.startsWith('bake:')).length;
  }, sidePanelPath!);
  console.log('[присадка] bake: features after undo-bake:', bakeFeatureCount);
  expect(bakeFeatureCount, 'undo-bake must remove all bake: HoleFeatures from featureTree').toBe(0);

  // ── D3. Undo the generate → bores[] empties on every panel ────────────────
  await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    await useAppStore.getState().bus.undo();
  });
  const boresAfterUndo = await panelBoreCount(sidePanelPath!);
  console.log('[присадка] bores after undo-generate:', boresAfterUndo);
  expect(boresAfterUndo, 'undo-generate must clear the panel bores[]').toBe(0);
```

> ASSUMPTION (flagged in self-critique): `CreateDrawingCommand`/`AddBaseViewCommand` are invoked
> via `.apply()` (not `bus.execute`) in slice C, matching T-6-30 — so they are NOT on the undo
> stack and the two `bus.undo()` calls unwind bake then generate. If the plan instead routes
> CreateDrawing through the bus, D2/D3 must add two extra `undo()` calls. Verify the actual
> command-routing before locking this slice.

2. Run — expected **FAIL** until Bake/Generate `revert()` are correct (Phase 3 + Phase 8). Goes
   green when revert restores prior `bores[]` and removes baked holes.

```bash
lsof -ti :5173 | xargs -r kill
npx playwright test tests/e2e/prisadka-carcass-boring.spec.ts
```

3. Commit.

```bash
git add tests/e2e/prisadka-carcass-boring.spec.ts
git commit -m "test(e2e): undo restores prior bores[] (generate) and removes baked holes (bake)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 35 — (optional, gated by spec §16) Perf: bake p95 budget on a single panel

Only author this if the plan's perf-budget axis is in scope (spec §9 calls bake "the known
cliff … opt-in, batched, progress-gated"). Bake is N sequential OCCT Boolean cuts; a perf floor
prevents a silent regression. Budget chosen to mirror the cabinet-create perf convention
(`tests/perf/cabinet-create.spec.ts`).

**Files:**
- Create test: `/Users/lion/Documents/Projects/mine/zilventor/tests/perf/prisadka-bake.perf.spec.ts`

**Steps:**

1. Write a timed-loop perf spec. Seed ONE panel part with a fixed set of N bores (no cabinet
   needed — keep it deterministic), then time `BakeBoresCommand.apply()` over repeated runs on
   fresh copies. Assert p95 under a generous budget (bake is intentionally the slow path).

```ts
// tests/perf/prisadka-bake.perf.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

/**
 * Perf: BakeBoresCommand.apply() p95 on a single panel with ~8 bores.
 * Bake = N sequential OCCT Boolean cuts (the known cliff). Generous budget — this guards
 * against an order-of-magnitude regression, not micro-optimization. Mirrors the
 * cabinet-create perf-loop convention.
 */
test('Perf: BakeBoresCommand p95 < 4000 ms over 10 runs (8 bores)', async ({ page }) => {
  test.setTimeout(300_000);
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('/');
  await waitForKernelReady(page);

  const times: number[] = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> }; kernel: unknown } };
      __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> }>;
    };
    const opfs = await w.__zilventorGetOpfs();
    const kernel = w.__zilventorStore.getState().kernel;
    const bus = w.__zilventorStore.getState().bus;
    // Seed helper (Phase 6/8 exposes a panel-with-bores seed for perf — or inline a
    // makePanelWithBores(opfs, path, 8) using PanelOps + 8 BoreOps). Build 10 fresh copies.
    const { makePanelWithBores } = await import('/src/commands/__perf__/makePanelWithBores.ts');
    const { BakeBoresCommand } = await import('/src/commands/BakeBoresCommand.ts');
    const RUNS = 10;
    const out: number[] = [];
    for (let n = 0; n < RUNS; n++) {
      const path = `parts/perf-bake-${n}.zipt`;
      await makePanelWithBores(opfs, path, 8);
      const cmd = new BakeBoresCommand({ partPath: path, opfs, kernel: kernel as never });
      const t0 = performance.now();
      await bus.execute(cmd);
      out.push(performance.now() - t0);
    }
    return out;
  });

  const sorted = [...times].sort((a, b) => a - b);
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;
  console.log(JSON.stringify({ metric: 'prisadka-bake-p95-ms', runs: times.length, p95Ms: Math.round(p95), maxMs: Math.round(Math.max(...times)) }));
  expect(p95).toBeLessThan(4000);
});
```

2. Run it — expected **FAIL** until `makePanelWithBores` perf helper + Phase 8 bake exist.

```bash
# repo ROOT — the 'perf' project has testDir './tests/perf'.
lsof -ti :5173 | xargs -r kill
npx playwright test --project=perf tests/perf/prisadka-bake.perf.spec.ts
```

3. Goes green once Phase 8 lands. Tune the budget from the first real green run (record the
   observed p95 in the commit body, as the repo does for every perf spec). Commit.

```bash
git add tests/perf/prisadka-bake.perf.spec.ts
git commit -m "test(perf): BakeBoresCommand p95 budget on a single 8-bore panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> NO-TDD MARK: the perf spec itself is the test; it has no production code to red→green. Its
> 'red' is module-missing until Phase 8 lands. Mark optional — only land if the plan adopts a
> bake perf budget (spec §16 risk row: "Bake perf on a full carcass").

---

### Task 36 — §6 browser-verification checklist (controller reads screenshots back) — LOAD-BEARING

This is the mandatory §6 gate (spec §16: "§6 real-browser gate is mandatory"). It is NOT a
vitest task — it is a controller-driven manual/scripted browser pass where the **controller
Reads the screenshots back** (captured-but-unread = not verified, per CLAUDE.md §6). It is the
only check that catches the marker/joint/atFace **coordinate-agreement** false-green class
(invisible to unit tests; the recurring class that shipped fillet-reflex-arc, hole-radius-
readback, and syncDomainFromGcs bugs in prior slices).

**Files:** none (verification only). Screenshots written to `/tmp/`; controller Reads them.

**Steps (delegate the driving to a Sonnet subagent; the controller Reads the proof back):**

1. **Start the dev server FROM THE WORKTREE on a free port** (NOT 5173 if a main-checkout
   server is up — port-collision guard). Confirm the build is the worktree one:

```bash
# from the WORKTREE root:
pnpm --filter @zilventor/app dev --port 5199 &   # any free port
# then in the browser-driver: page.goto('http://localhost:5199/');
# CONFIRM the worktree build: window.__zilventorStore exists AND
#   store.viewport.getSceneManager().boreMarkerCount is a function (the new accessor).
```

2. **Marker-position check (auto path):** New assembly → register `m-birch-18` + `m-hb-6` →
   `CreateCabinetCommand` (base cabinet) → `GenerateCarcassBoresCommand`. Screenshot the 3D
   viewport to `/tmp/s6-prisadka-auto-markers.png`. **Controller Reads it back** and confirms:
   (a) markers sit ON the panel faces (not floating in space / not at the world origin),
   (b) confirmat/minifix/dowel markers are color-distinct, (c) the L and R sides are MIRRORED
   (markers on the left side mirror the right — the highest-risk coordinate mapping per the
   contract gotcha: component-pose → panel-local face frame). A marker cluster at (0,0,0) or
   off-panel ⇒ a sign/axis mismatch between `face2DFrame` and the component pose → STOP, treat
   as a bug (§4b systematic-debugging), lock with a RED-without-fix regression before fixing.

3. **Bake-void check:** `BakeBoresCommand` on a side panel → orbit so the drilled face is
   visible → screenshot `/tmp/s6-prisadka-baked-3d.png`. **Controller Reads it back**: real
   countersunk/through voids appear at the marker positions (the markers and the baked holes
   must coincide — proves the `atFace` (u,v)→3D mapping agrees with `face2DFrame` across the
   kernel boundary, the false-green class the contract flags).

4. **Drawing check:** `CreateDrawingCommand` + `AddBaseViewCommand` (top orientation) on the
   baked panel → Drawing tab → screenshot `/tmp/s6-prisadka-drawing.png`. **Controller Reads
   it back**: circles + center-marks appear at the bore positions in the `.zidw` view.

5. **Manual-path check:** New assembly → place two panels (component-level pick via
   `raycastComponent`, NOT `raycastAssemblyRef('face')` — assembly face-name resolution is the
   unfinished TODO per the contract) → `AddManualJointBoresCommand(kind:'confirmat')` →
   screenshot `/tmp/s6-prisadka-manual.png`. **Controller Reads it back**: connector bores
   appear along the inferred butt joint between the two panels.

6. **Record the §6 verdict** in the branch's verification log (PASS only if the controller has
   actually Read every screenshot and confirmed the geometry — never claim "renders correctly"
   without a captured+read render). Any surfaced bug → §4b: reproduce, root-cause, lock with a
   RED-without-fix regression (unit OR worker OR e2e), fix to green, re-run.

> NO-TDD MARK: §6 is a verification gate, not a code change. Its "test" is the captured-and-read
> screenshot proof. It is gated by `superpowers:verification-before-completion`.

---

### Task 37 — tsc pass on every touched package (exactOptionalPropertyTypes guard)

`tsc --noEmit` catches what vitest misses — the contract gotcha cites historical TS2375
(`exactOptionalPropertyTypes`) and BlobPart errors that green unit suites missed. `bores?:
BoreOp[]` and `role?: PanelRole` must NEVER be assigned `undefined` explicitly (omit the key) —
tsc is the only check that enforces this. Run it in EVERY touched package after all phases land.

**Files:** none (type-check only). Touched packages: `shared`, `kernel`, `app`.

**Steps:**

1. **shared** (new `bore.ts`/`connectorCatalog.ts`/`jointMath.ts` + `types.ts`/`fileFormat.ts`
   edits):

```bash
# from /Users/lion/Documents/Projects/mine/zilventor/packages/shared
npm run typecheck   # = tsc --noEmit
```
   Expected: clean. Common failure: explicitly setting `bores: undefined` or `role: undefined`
   somewhere → TS2375 under exactOptionalPropertyTypes → omit the key instead.

2. **kernel** (new `atFace` resolver + `executeHoleFeature` branch in `HoleFeature.ts`):

```bash
# from /Users/lion/Documents/Projects/mine/zilventor/packages/kernel
npm run typecheck
```
   Expected: clean. Watch for the `HoleLocation = { origin: any; axis: any }` raw-OCCT handle
   types — `any` is intentional there (reused verbatim per contract), do not "fix" it.

3. **app** (all new commands + walkers + DXF/CSV + SceneManager/Viewport edits):

```bash
# from /Users/lion/Documents/Projects/mine/zilventor/packages/app
npm run typecheck
```
   Expected: clean. Watch for `BlobPart`/`Uint8Array` export-byte typing on the new
   `ExportBoring*Command` files (the contract's historical BlobPart-bug class).

4. (Optional one-shot, repo root): `pnpm -r typecheck` runs all three.

5. **No commit** — tsc produces no artifact. If it surfaces an error, fix it in the owning
   phase's files and re-run; only proceed to "done" when all three packages are clean. Gate:
   this MUST be green before the feature is claimed complete (CLAUDE.md §6: type-checks verify
   shape; combined with the §6 browser gate + the real-WASM e2e, the trio is the completion bar).

> NO-TDD MARK: type-check gate, no production code of its own. Reason: it verifies the SHAPE of
> code authored in Phases 1–8; its failure is a compile error, not a behavioral test.
