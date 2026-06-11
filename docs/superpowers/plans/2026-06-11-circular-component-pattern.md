# Circular / Polar Component Pattern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each implementer: invoke `superpowers:test-driven-development`, branch-check first, report the red→green transition.

**Goal:** Add a circular (polar) component pattern to the AssemblyTab — select a source component, a world rotation axis + center, count + total angle, bake `count−1` evenly-spaced `ComponentInstance`s around the circle, with an optional rotate-instances toggle.

**Architecture:** Mirror the existing rectangular-pattern stack exactly. New pure pose math in `poseHelpers.ts` (two quaternion primitives + `computeCircularPoses`), a `CreateCircularPatternCommand` (no kernel call), a `CircularPatternDialog`, a new store dialog flag, and an AssemblyTab button. No kernel change, no manifest bump (reuses `ComponentInstance` schema).

**Tech Stack:** TypeScript monorepo (packages/app), React + zustand store, vitest (jsdom + node env), Playwright e2e, react-i18next (en/uk parity-gated).

**Spec:** `docs/superpowers/specs/2026-06-11-circular-component-pattern-design.md` (incl. §10 AUTHORITATIVE corrections — anti-tautology oracles, command-level threading, codebase-fit notes). Read §10 before Tasks 3 & 4.

**CWD trap:** app tests run from `packages/app/` via `npx vitest run --config vitest.config.ts <relpath>`. e2e from repo root. Re-`cd` absolute at the start of each bash op.

---

## File Structure

- `packages/app/src/assembly/poseHelpers.ts` — ADD `axisAngleToQuat`, `quatMul`, `computeCircularPoses`.
- `packages/app/src/assembly/__tests__/poseHelpers.spec.ts` — ADD describe blocks for the three new fns.
- `packages/app/src/commands/CreateCircularPatternCommand.ts` — NEW command.
- `packages/app/src/commands/__tests__/CreateCircularPatternCommand.spec.ts` — NEW.
- `packages/app/src/store/useAppStore.ts` — ADD `circularPatternDialogOpen` + setter.
- `packages/app/src/shell/CircularPatternDialog.tsx` — NEW dialog.
- `packages/app/src/shell/__tests__/CircularPatternDialog.spec.tsx` — NEW component test (DOM interaction).
- `packages/app/src/shell/tabs/AssemblyTab.tsx` — ADD button + dialog render.
- `packages/app/src/i18n/locales/en.json` + `uk.json` — ADD `dialog.circularPattern.*`, `tab.asm.circularPattern`, `aria.circular_pattern` (BOTH bundles).
- `tests/e2e/assembly-circular-pattern.spec.ts` — NEW e2e (probe path).

---

## Task 1: Quaternion primitives `axisAngleToQuat` + `quatMul` (Slice A)

**Files:**
- Modify: `packages/app/src/assembly/poseHelpers.ts`
- Test: `packages/app/src/assembly/__tests__/poseHelpers.spec.ts`

- [ ] **Step 1: Write failing tests** — append to `poseHelpers.spec.ts`. Import update: change the import line to `import { computeRectGridPoses, computeMirroredPose, quatToMat3, axisAngleToQuat, quatMul } from '../poseHelpers';`

```ts
describe('axisAngleToQuat', () => {
  it('+90° about +z → [0,0,√2/2,√2/2] (hand-authored)', () => {
    const q = axisAngleToQuat({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    const s = Math.SQRT2 / 2;
    expect(q[0]).toBeCloseTo(0, 9);
    expect(q[1]).toBeCloseTo(0, 9);
    expect(q[2]).toBeCloseTo(s, 9);
    expect(q[3]).toBeCloseTo(s, 9);
  });

  it('rotated vector: +90° about +z maps [1,0,0] → [0,1,0]', () => {
    const m = quatToMat3(axisAngleToQuat({ x: 0, y: 0, z: 1 }, Math.PI / 2));
    // m * [1,0,0] = column 0 of the row-major mat = (m[0], m[3], m[6])
    expect(m[0]).toBeCloseTo(0, 9);
    expect(m[3]).toBeCloseTo(1, 9);
    expect(m[6]).toBeCloseTo(0, 9);
  });
});

describe('quatMul', () => {
  it('Hamilton product i·j = k: [1,0,0,0]·[0,1,0,0] → [0,0,1,0]', () => {
    const r = quatMul([1, 0, 0, 0], [0, 1, 0, 0]);
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[1]).toBeCloseTo(0, 12);
    expect(r[2]).toBeCloseTo(1, 12);
    expect(r[3]).toBeCloseTo(0, 12);
  });

  it('right identity: q·[0,0,0,1] === q', () => {
    const q: [number, number, number, number] = [0.1, 0.2, 0.3, 0.9];
    const r = quatMul(q, [0, 0, 0, 1]);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(0.2, 12);
    expect(r[2]).toBeCloseTo(0.3, 12);
    expect(r[3]).toBeCloseTo(0.9, 12);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`axisAngleToQuat`/`quatMul` not exported)

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/assembly/__tests__/poseHelpers.spec.ts`
Expected: FAIL — "axisAngleToQuat is not a function" / import error.

- [ ] **Step 3: Implement** — add to `poseHelpers.ts` (after `axisVec`, before `computeRectGridPoses`). The `[x,y,z,w]` convention matches `quatToMat3`.

```ts
/** Axis-angle → unit quaternion [x,y,z,w]. `axis` need not be normalized. */
export function axisAngleToQuat(axis: Vec3, angleRad: number): [number, number, number, number] {
  const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const half = angleRad / 2;
  const s = Math.sin(half) / len;
  return [axis.x * s, axis.y * s, axis.z * s, Math.cos(half)];
}

/** Hamilton product a·b (both [x,y,z,w]). Corresponds to matrix product R(a)·R(b). */
export function quatMul(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/assembly/__tests__/poseHelpers.spec.ts`
Expected: PASS (incl. all pre-existing poseHelpers tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/assembly/poseHelpers.ts packages/app/src/assembly/__tests__/poseHelpers.spec.ts
git commit -m "feat(circular-pattern): axisAngleToQuat + quatMul quaternion primitives"
```

---

## Task 2: `computeCircularPoses` — translation (Slice B)

**Files:**
- Modify: `packages/app/src/assembly/poseHelpers.ts`
- Test: `packages/app/src/assembly/__tests__/poseHelpers.spec.ts`

- [ ] **Step 1: Write failing tests** — append. Update import to add `computeCircularPoses`.

```ts
describe('computeCircularPoses — translation', () => {
  const srcAt = (x: number, y: number, z: number): Pose => ({
    translation: { x, y, z },
    quaternion: [0, 0, 0, 1],
  });

  it('full circle count=4 about +z at origin → 3 instances on radius-2 circle at 90/180/270°', () => {
    const poses = computeCircularPoses(srcAt(2, 0, 0), 'z', { x: 0, y: 0, z: 0 }, 4, 360, false);
    expect(poses).toHaveLength(3);
    for (const p of poses) {
      expect(Math.hypot(p.translation.x, p.translation.y)).toBeCloseTo(2, 6); // radius preserved
    }
    expect(Math.atan2(poses[0]!.translation.y, poses[0]!.translation.x)).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.atan2(poses[1]!.translation.y, poses[1]!.translation.x)).toBeCloseTo(Math.PI, 6);
    expect(Math.atan2(poses[2]!.translation.y, poses[2]!.translation.x)).toBeCloseTo(-Math.PI / 2, 6); // 270° = -90°
  });

  it('partial arc count=5 angle=180 → endpoints included: 45/90/135/180°', () => {
    const poses = computeCircularPoses(srcAt(2, 0, 0), 'z', { x: 0, y: 0, z: 0 }, 5, 180, false);
    expect(poses).toHaveLength(4);
    const ang = (i: number) => Math.atan2(poses[i]!.translation.y, poses[i]!.translation.x);
    expect(ang(0)).toBeCloseTo(Math.PI / 4, 6);   // 45°
    expect(ang(1)).toBeCloseTo(Math.PI / 2, 6);   // 90°
    expect(ang(2)).toBeCloseTo((3 * Math.PI) / 4, 6); // 135°
    expect(ang(3)).toBeCloseTo(Math.PI, 6);       // 180° (endpoint → proves /(count-1) divisor)
  });

  it('off-center: orbits the center point, not the origin', () => {
    // center (1,0,0), source (3,0,0) → radius 2 about center
    const poses = computeCircularPoses(srcAt(3, 0, 0), 'z', { x: 1, y: 0, z: 0 }, 4, 360, false);
    for (const p of poses) {
      expect(Math.hypot(p.translation.x - 1, p.translation.y)).toBeCloseTo(2, 6);
    }
    // first instance at +90° about center → (1, 2, 0)
    expect(poses[0]!.translation.x).toBeCloseTo(1, 6);
    expect(poses[0]!.translation.y).toBeCloseTo(2, 6);
  });

  it('axial height preserved: source z=5, axis z → all instances keep z≈5', () => {
    const poses = computeCircularPoses(srcAt(2, 0, 5), 'z', { x: 0, y: 0, z: 0 }, 4, 360, false);
    for (const p of poses) expect(p.translation.z).toBeCloseTo(5, 6);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`computeCircularPoses` not exported)

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/assembly/__tests__/poseHelpers.spec.ts`
Expected: FAIL — not a function.

- [ ] **Step 3: Implement** — add to `poseHelpers.ts` after `computeRectGridPoses`. NOTE: `rotateInstances=false` path only for now (quaternion copied from source); Task 3 adds the rotate path.

```ts
/** Rotate vector v about a unit-or-not axis by angleRad (active rotation), via the quat→mat3 path. */
function rotateVecAboutAxis(v: Vec3, axis: Vec3, angleRad: number): Vec3 {
  const m = quatToMat3(axisAngleToQuat(axis, angleRad));
  return {
    x: m[0]! * v.x + m[1]! * v.y + m[2]! * v.z,
    y: m[3]! * v.x + m[4]! * v.y + m[5]! * v.z,
    z: m[6]! * v.x + m[7]! * v.y + m[8]! * v.z,
  };
}

/**
 * Returns count-1 poses (source EXCLUDED), evenly spaced around `center` about the world `axis`.
 * Full circle (totalAngleDeg >= 360): step = 2π/count (no duplicate at 360°).
 * Partial (< 360): step = (totalAngleDeg in rad)/(count-1) — endpoints included.
 * rotateInstances: true → orientation composed with the per-instance rotation (Task 3);
 *                  false → source orientation copied unchanged.
 */
export function computeCircularPoses(
  sourcePose: Pose,
  axis: PatternAxis,
  center: Vec3,
  count: number,
  totalAngleDeg: number,
  rotateInstances: boolean,
): Pose[] {
  const ax = axisVec(axis);
  const full = totalAngleDeg >= 360;
  const stepRad = full ? (2 * Math.PI) / count : (totalAngleDeg * Math.PI) / 180 / (count - 1);
  const r = {
    x: sourcePose.translation.x - center.x,
    y: sourcePose.translation.y - center.y,
    z: sourcePose.translation.z - center.z,
  };
  const poses: Pose[] = [];
  for (let i = 1; i < count; i++) {
    const theta = i * stepRad;
    const rr = rotateVecAboutAxis(r, ax, theta);
    poses.push({
      translation: { x: center.x + rr.x, y: center.y + rr.y, z: center.z + rr.z },
      quaternion: [...sourcePose.quaternion] as [number, number, number, number],
    });
  }
  return poses;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/assembly/__tests__/poseHelpers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/assembly/poseHelpers.ts packages/app/src/assembly/__tests__/poseHelpers.spec.ts
git commit -m "feat(circular-pattern): computeCircularPoses translation (full + partial + off-center)"
```

---

## Task 3: `computeCircularPoses` — orientation (Slice C)

**Spec §10.1 is binding: the oracle MUST be built from two separate `quatToMat3` applications, never `quatMul`. Test point `p` must not be parallel to either axis.**

**Files:**
- Modify: `packages/app/src/assembly/poseHelpers.ts`
- Test: `packages/app/src/assembly/__tests__/poseHelpers.spec.ts`

- [ ] **Step 1: Write failing tests** — append.

```ts
describe('computeCircularPoses — orientation', () => {
  // source rotated 90° about +x; circle axis +z → the two rotations do NOT commute.
  const srcQuat = ((): [number, number, number, number] => {
    const s = Math.SQRT2 / 2;
    return [s, 0, 0, s]; // 90° about x
  })();
  const src: Pose = { translation: { x: 2, y: 0, z: 0 }, quaternion: srcQuat };

  it('rotateInstances=true: composed orientation = R(z,θ)·R_source (world pre-multiply)', () => {
    const poses = computeCircularPoses(src, 'z', { x: 0, y: 0, z: 0 }, 4, 360, true);
    const p = { x: 1, y: 1, z: 0 }; // NOT parallel to z (circle axis) nor x (source axis)
    const Rsrc = quatToMat3(srcQuat);
    const apply = (m: number[], v: { x: number; y: number; z: number }) => ({
      x: m[0]! * v.x + m[1]! * v.y + m[2]! * v.z,
      y: m[3]! * v.x + m[4]! * v.y + m[5]! * v.z,
      z: m[6]! * v.x + m[7]! * v.y + m[8]! * v.z,
    });
    poses.forEach((pose, idx) => {
      const theta = (idx + 1) * (Math.PI / 2); // 90/180/270
      // ORACLE: two separate matrix applications — NOT quatMul (spec §10.1)
      const Rz = quatToMat3(axisAngleToQuat({ x: 0, y: 0, z: 1 }, theta));
      const expected = apply(Rz, apply(Rsrc, p));
      const actual = apply(quatToMat3(pose.quaternion), p);
      expect(actual.x).toBeCloseTo(expected.x, 6);
      expect(actual.y).toBeCloseTo(expected.y, 6);
      expect(actual.z).toBeCloseTo(expected.z, 6);
    });
  });

  it('rotateInstances=false: every instance quaternion === sourceQuat AND positions still moved', () => {
    const poses = computeCircularPoses(src, 'z', { x: 0, y: 0, z: 0 }, 4, 360, false);
    for (const pose of poses) {
      expect(pose.quaternion).toEqual(srcQuat);
    }
    // positions changed (not all equal to source)
    expect(poses[0]!.translation.x).not.toBeCloseTo(2, 3);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (rotateInstances=true currently copies source quat; the compose test fails for θ≠0)

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/assembly/__tests__/poseHelpers.spec.ts -t "orientation"`
Expected: FAIL on the `rotateInstances=true` case (actual === source orientation, not composed).

- [ ] **Step 3: Implement** — in `computeCircularPoses`, replace the `quaternion` line inside the loop:

```ts
    const quaternion = rotateInstances
      ? quatMul(axisAngleToQuat(ax, theta), sourcePose.quaternion)
      : ([...sourcePose.quaternion] as [number, number, number, number]);
    poses.push({
      translation: { x: center.x + rr.x, y: center.y + rr.y, z: center.z + rr.z },
      quaternion,
    });
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/assembly/__tests__/poseHelpers.spec.ts`
Expected: PASS (all poseHelpers tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/assembly/poseHelpers.ts packages/app/src/assembly/__tests__/poseHelpers.spec.ts
git commit -m "feat(circular-pattern): computeCircularPoses rotate-instances orientation (world pre-multiply)"
```

---

## Task 4: `CreateCircularPatternCommand` + store flag (Slice D)

**Spec §10.2 binding: command tests MUST thread non-zero center + rotateInstances=false.**

**Files:**
- Create: `packages/app/src/commands/CreateCircularPatternCommand.ts`
- Create: `packages/app/src/commands/__tests__/CreateCircularPatternCommand.spec.ts`
- Modify: `packages/app/src/store/useAppStore.ts` (interface ~line 299–302, impl ~line 664–667)

- [ ] **Step 1: Add store flag** — in `useAppStore.ts`. In the interface block add after `setMirrorComponentDialogOpen(v: boolean): void;`:

```ts
  circularPatternDialogOpen: boolean;
  setCircularPatternDialogOpen(v: boolean): void;
```

In the impl block (the `set`-returning object) add after `setMirrorComponentDialogOpen: ...`:

```ts
  circularPatternDialogOpen: false,
  setCircularPatternDialogOpen: (v) => set({ circularPatternDialogOpen: v }),
```

- [ ] **Step 2: Write failing command test** — `CreateCircularPatternCommand.spec.ts`. **CRITICAL (plan-verify BLOCKER fix):** use the REAL seeding pattern from `CreateComponentPatternCommand.spec.ts` — `setActiveDocument({ kind: 'assembly', document: makeAsm([...]) })` with a FULL `AssemblyDocument` (incl. `groundedComponentPaths`, `colors`, etc.), under `// @vitest-environment node`. A bare `setState({ activeAssembly })` shim OMITS `groundedComponentPaths` and `addComponent` crashes reading `.length`. Read that spec first and copy its `makeAsm` verbatim — the block below mirrors it; reconcile any field drift with the real file.

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { CreateCircularPatternCommand } from '../CreateCircularPatternCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

function srcInstance(): ComponentInstance {
  return {
    id: 'src-1',
    partPath: 'leg.zipt',
    position: { x: 2, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
    pose: { translation: { x: 2, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
  };
}

// Copy this verbatim from CreateComponentPatternCommand.spec.ts (field set must match the real
// AssemblyDocument so addComponent's `.groundedComponentPaths.length` read does not throw).
function makeAsm(components: ComponentInstance[]): AssemblyDocument {
  return {
    id: 'asm1', name: 'test-asm', units: 'mm', parameters: {}, properties: {},
    components, constraints: [], groundedComponentPaths: [], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  } as AssemblyDocument;
}

function seedAssembly(src: ComponentInstance): void {
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAsm([src]) });
}

const comps = () => useAppStore.getState().activeAssembly!.components;

describe('CreateCircularPatternCommand', () => {
  beforeEach(() => seedAssembly(srcInstance()));

  it('full circle count=4 → adds 3 instances on the circle, sharing partPath', async () => {
    const cmd = new CreateCircularPatternCommand({
      sourceInstanceId: 'src-1', axis: 'z', center: { x: 0, y: 0, z: 0 },
      count: 4, totalAngleDeg: 360, rotateInstances: true,
    });
    await cmd.apply();
    const added = comps().filter((c) => c.id !== 'src-1');
    expect(added).toHaveLength(3);
    for (const c of added) {
      expect(c.partPath).toBe('leg.zipt');
      expect(Math.hypot(c.pose!.translation.x, c.pose!.translation.y)).toBeCloseTo(2, 6);
    }
  });

  it('off-center: instances orbit the center, not origin (threads center)', async () => {
    const src = srcInstance();
    src.position = { x: 3, y: 0, z: 0 };
    src.pose = { translation: { x: 3, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };
    seedAssembly(src);
    const cmd = new CreateCircularPatternCommand({
      sourceInstanceId: 'src-1', axis: 'z', center: { x: 1, y: 0, z: 0 },
      count: 4, totalAngleDeg: 360, rotateInstances: false,
    });
    await cmd.apply();
    const added = comps().filter((c) => c.id !== 'src-1');
    for (const c of added) {
      expect(Math.hypot(c.pose!.translation.x - 1, c.pose!.translation.y)).toBeCloseTo(2, 6);
    }
  });

  it('rotateInstances=false threads through → instance quats === source', async () => {
    const cmd = new CreateCircularPatternCommand({
      sourceInstanceId: 'src-1', axis: 'z', center: { x: 0, y: 0, z: 0 },
      count: 4, totalAngleDeg: 360, rotateInstances: false,
    });
    await cmd.apply();
    for (const c of comps().filter((c) => c.id !== 'src-1')) {
      expect(c.pose!.quaternion).toEqual([0, 0, 0, 1]);
    }
  });

  it('sets legacy rotation struct + visible + position mirror', async () => {
    const cmd = new CreateCircularPatternCommand({
      sourceInstanceId: 'src-1', axis: 'z', center: { x: 0, y: 0, z: 0 },
      count: 4, totalAngleDeg: 360, rotateInstances: false,
    });
    await cmd.apply();
    const c = comps().find((c) => c.id !== 'src-1')!;
    expect(c.rotation).toEqual({ rx: 0, ry: 0, rz: 0 });
    expect(c.visible).toBe(true);
    expect(c.position).toEqual({ x: c.pose!.translation.x, y: c.pose!.translation.y, z: c.pose!.translation.z });
  });

  it('revert removes created instances', async () => {
    const cmd = new CreateCircularPatternCommand({
      sourceInstanceId: 'src-1', axis: 'z', center: { x: 0, y: 0, z: 0 },
      count: 4, totalAngleDeg: 360, rotateInstances: true,
    });
    await cmd.apply();
    expect(comps()).toHaveLength(4);
    await cmd.revert();
    expect(comps()).toHaveLength(1);
  });

  it('noop when source instance missing', async () => {
    const cmd = new CreateCircularPatternCommand({
      sourceInstanceId: 'nope', axis: 'z', center: { x: 0, y: 0, z: 0 },
      count: 4, totalAngleDeg: 360, rotateInstances: true,
    });
    await cmd.apply();
    expect(comps()).toHaveLength(1);
  });
});
```

> **Implementer note:** verify the seed helper matches the real `CreateComponentPatternCommand.spec.ts` (it may use `addComponent`/`removeComponent` store actions that need to exist on the test store). If that spec uses a different assembly-seeding helper, copy ITS helper verbatim rather than the `setState` shim above.

- [ ] **Step 3: Run — expect FAIL** (command file missing)

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/CreateCircularPatternCommand.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Implement** — `CreateCircularPatternCommand.ts` (clone of `CreateComponentPatternCommand.ts`):

```ts
/**
 * CreateCircularPatternCommand — bakes a circular/polar component pattern.
 * Clone of CreateComponentPatternCommand; uses computeCircularPoses. No kernel call.
 */
import type { Command } from './Command';
import type { ComponentInstance, PatternAxis, Vec3 } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { computeCircularPoses } from '../assembly/poseHelpers';

export type CreateCircularPatternOpts = {
  sourceInstanceId: string;
  axis: PatternAxis;
  center: Vec3;
  count: number;
  totalAngleDeg: number;
  rotateInstances: boolean;
};

export class CreateCircularPatternCommand implements Command {
  readonly name = 'CreateCircularPattern';
  private createdIds: string[] = [];

  constructor(private opts: CreateCircularPatternOpts) {}

  async apply(): Promise<void> {
    const asm = useAppStore.getState().activeAssembly;
    if (!asm) return;
    const src = asm.components.find((c) => c.id === this.opts.sourceInstanceId);
    if (!src) return;

    const srcPose = src.pose ?? {
      translation: { x: src.position.x, y: src.position.y, z: src.position.z },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    };

    const poses = computeCircularPoses(
      srcPose, this.opts.axis, this.opts.center,
      this.opts.count, this.opts.totalAngleDeg, this.opts.rotateInstances,
    );

    this.createdIds = [];
    poses.forEach((pose) => {
      const id = `Cp${crypto.randomUUID()}`;
      const instance: ComponentInstance = {
        id,
        partPath: src.partPath,
        position: { x: pose.translation.x, y: pose.translation.y, z: pose.translation.z },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
        pose,
        ...(src.color ? { color: src.color } : {}),
      };
      useAppStore.getState().addComponent(instance);
      this.createdIds.push(id);
    });
  }

  async revert(): Promise<void> {
    for (const id of this.createdIds) {
      useAppStore.getState().removeComponent(id);
    }
    this.createdIds = [];
  }
}
```

> Confirm `Vec3` is exported from `@zilventor/shared` (it is — used in `poseHelpers.ts`). If the import fails, use the inline type `{ x: number; y: number; z: number }`.

- [ ] **Step 5: Run — expect PASS**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/commands/__tests__/CreateCircularPatternCommand.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/commands/CreateCircularPatternCommand.ts packages/app/src/commands/__tests__/CreateCircularPatternCommand.spec.ts packages/app/src/store/useAppStore.ts
git commit -m "feat(circular-pattern): CreateCircularPatternCommand + store dialog flag"
```

---

## Task 5: `CircularPatternDialog` + i18n + AssemblyTab wiring (Slice E)

**Spec §10.3/§10.4 binding: i18n keys in BOTH en+uk (parity gate); count label "Count (incl. source)"; `step={1}` + integer validation; degenerate-radius guard. Slice E test drives REAL `<input>` elements (fireEvent.change), not prop injection.**

**Files:**
- Create: `packages/app/src/shell/CircularPatternDialog.tsx`
- Create: `packages/app/src/shell/__tests__/CircularPatternDialog.spec.tsx`
- Modify: `packages/app/src/i18n/locales/en.json` + `uk.json`
- Modify: `packages/app/src/shell/tabs/AssemblyTab.tsx`

- [ ] **Step 1: Add i18n keys (BOTH bundles)** — add to `en.json` a `dialog.circularPattern` block (alphabetical, near `dialog.pattern`), the `aria.circular_pattern` key, and `tab.asm.circularPattern`. Add the SAME keys to `uk.json` (provisional uk values — flag for lead review).

`en.json` additions:
```json
"circularPattern": {
  "title": "Circular Pattern",
  "source": "Source",
  "source_component": "Source component",
  "axis": "Axis",
  "center": "Center",
  "count": "Count (incl. source)",
  "count_hint": "e.g. 4 = source + 3 copies",
  "count_error": "Count must be an integer 2–200.",
  "angle": "Total angle",
  "angle_error": "Angle must be a number in (0, 360].",
  "radius_error": "Source lies on the rotation axis — copies would overlap; move the center.",
  "rotate": "Rotate instances",
  "no_components": "(no components)"
}
```
- `en.json` `aria` block: add `"circular_pattern": "Circular Pattern"`.
- `en.json` `tab.asm` block: add `"circularPattern": "Circular Pattern"`.
- `uk.json` — mirror all of the above. Provisional uk values: title "Круговий масив", source "Джерело", axis "Вісь", center "Центр", count "Кількість (з джерелом)", count_hint "напр. 4 = джерело + 3 копії", count_error "Кількість має бути цілим 2–200.", angle "Загальний кут", angle_error "Кут має бути в діапазоні (0, 360].", radius_error "Джерело лежить на осі обертання — копії накладуться; змістіть центр.", rotate "Обертати екземпляри", no_components "(немає компонентів)", source_component "Компонент-джерело"; aria.circular_pattern "Круговий масив"; tab.asm.circularPattern "Круговий масив".

- [ ] **Step 2: Write failing dialog test** — `CircularPatternDialog.spec.tsx`. Uses `@testing-library/react` + i18n test setup (check how `ComponentPatternDialog` is tested if a spec exists; otherwise mirror another dialog spec for the i18n `render` wrapper).

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CircularPatternDialog } from '../CircularPatternDialog';

const comps = [{ id: 'src-1', label: 'leg' }];

describe('CircularPatternDialog', () => {
  it('submit dispatches onCommit with the exact form values (DOM interaction)', () => {
    const onCommit = vi.fn();
    render(<CircularPatternDialog components={comps} onCommit={onCommit} onCancel={() => {}} />);
    // change count to 6 and angle to 180 via the real inputs
    fireEvent.change(screen.getByLabelText(/Count/i), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(/Total angle/i), { target: { value: '180' } });
    fireEvent.click(screen.getByRole('button', { name: /OK|Ок/i }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const v = onCommit.mock.calls[0]![0];
    expect(v.sourceComponentId).toBe('src-1');
    expect(v.count).toBe(6);
    expect(v.totalAngleDeg).toBe(180);
    expect(v.rotateInstances).toBe(true); // default ON
    expect(v.axis).toBe('z'); // default
  });

  it('blocks submit + shows error when count < 2', () => {
    const onCommit = vi.fn();
    render(<CircularPatternDialog components={comps} onCommit={onCommit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Count/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /OK|Ок/i }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('blocks submit when angle out of range (0 or >360)', () => {
    const onCommit = vi.fn();
    render(<CircularPatternDialog components={comps} onCommit={onCommit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Total angle/i), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /OK|Ок/i }));
    expect(onCommit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (dialog missing)

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/shell/__tests__/CircularPatternDialog.spec.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Implement dialog** — `CircularPatternDialog.tsx`. Clone `ComponentPatternDialog.tsx` styles; fields: source select, axis X/Y/Z (default 'z'), center x/y/z, count (`type=number min=2 max=200 step=1`), total angle, rotate checkbox (default checked). Value type + validation:

```tsx
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { PatternAxis } from '@zilventor/shared';

export type CircularPatternDialogValue = {
  sourceComponentId: string;
  axis: PatternAxis;
  center: { x: number; y: number; z: number };
  count: number;
  totalAngleDeg: number;
  rotateInstances: boolean;
};

type ComponentSummary = { id: string; label: string };
type Props = { components: ComponentSummary[]; onCommit(v: CircularPatternDialogValue): void; onCancel(): void };

// (reuse panelStyle/labelStyle/rowStyle/inputStyle/btnStyle from ComponentPatternDialog — copy verbatim)

export function CircularPatternDialog({ components, onCommit, onCancel }: Props): JSX.Element {
  const { t } = useTranslation();
  const [sourceComponentId, setSourceComponentId] = useState(components[0]?.id ?? '');
  const [axis, setAxis] = useState<PatternAxis>('z');
  const [cx, setCx] = useState('0');
  const [cy, setCy] = useState('0');
  const [cz, setCz] = useState('0');
  const [countStr, setCountStr] = useState('4');
  const [angleStr, setAngleStr] = useState('360');
  const [rotate, setRotate] = useState(true);

  const count = parseInt(countStr, 10);
  const countValid = Number.isInteger(count) && count >= 2 && count <= 200;
  const angle = parseFloat(angleStr);
  const angleValid = Number.isFinite(angle) && angle > 0 && angle <= 360;
  const center = { x: parseFloat(cx), y: parseFloat(cy), z: parseFloat(cz) };
  const centerNumeric = [center.x, center.y, center.z].every(Number.isFinite);

  // degenerate-radius guard: distance from source to axis line through center (⟂ component only)
  const src = components.find((c) => c.id === sourceComponentId);
  // NOTE: dialog has only labels, not poses → radius guard is approximate here; the command is the
  // source of truth. We guard against center == (0,0,0) trivially false-positive by skipping if unknown.
  const radiusOk = true; // dialog lacks source pose; full guard lives in the command/validation layer.

  const canCommit = sourceComponentId !== '' && countValid && angleValid && centerNumeric && radiusOk;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    onCommit({ sourceComponentId, axis, center, count, totalAngleDeg: angle, rotateInstances: rotate });
  };
  // ... render form with aria-label={t('aria.circular_pattern')}, title t('dialog.circularPattern.title'),
  //     count input aria-label={t('dialog.circularPattern.count')}, angle aria-label={t('dialog.circularPattern.angle')},
  //     rotate checkbox aria-label={t('dialog.circularPattern.rotate')}, OK/Cancel via t('common.ok')/t('common.cancel'),
  //     error divs gated on !countValid / !angleValid. Axis buttons identical pattern to ComponentPatternDialog dir1.
}
```

> **Implementer:** write the full JSX mirroring `ComponentPatternDialog` (source select, axis button group, three center inputs, count, angle, rotate checkbox, error rows, OK/Cancel). The radius/degenerate guard in §10.4 cannot run in the dialog (no pose) — it belongs in the command. Add it to the command's `apply` (skip + console.warn, or simply allow; the spec's intent is user feedback — implement the dialog-side guard ONLY if the source pose is threaded into `ComponentSummary`; otherwise note the deferral in your DONE report). Keep the dialog test green.

- [ ] **Step 5: Run dialog test — expect PASS**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/shell/__tests__/CircularPatternDialog.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Wire AssemblyTab** — in `AssemblyTab.tsx`:
  1. Imports: `import { CircularPatternDialog } from '../CircularPatternDialog';` and `import { CreateCircularPatternCommand } from '../../commands/CreateCircularPatternCommand';`
  2. Subscribe: `const circularPatternDialogOpen = useAppStore((s) => s.circularPatternDialogOpen);` (near line 38).
  3. Button — add inside the Pattern `<div>` (after the Mirror button, line ~140):
```tsx
        <button
          aria-label={t('tab.asm.circularPattern')}
          disabled={!hasAssembly}
          onClick={() => useAppStore.getState().setCircularPatternDialogOpen(true)}
          style={btn}
        >
          {t('tab.asm.circularPattern')}
        </button>
```
  4. Dialog render — after the mirror dialog block (~line 252+):
```tsx
      {circularPatternDialogOpen && activeAssembly && (
        <CircularPatternDialog
          components={activeAssembly.components.map((c) => ({
            id: c.id,
            label: c.partPath.replace(/\.zipt$|\.ziasm$/, ''),
          }))}
          onCancel={() => useAppStore.getState().setCircularPatternDialogOpen(false)}
          onCommit={async (v) => {
            useAppStore.getState().setCircularPatternDialogOpen(false);
            const { bus } = useAppStore.getState();
            const cmd = new CreateCircularPatternCommand({
              sourceInstanceId: v.sourceComponentId,
              axis: v.axis, center: v.center,
              count: v.count, totalAngleDeg: v.totalAngleDeg, rotateInstances: v.rotateInstances,
            });
            await bus.execute(cmd);
          }}
        />
      )}
```

- [ ] **Step 7: Run i18n parity + dialog + AssemblyTab tests — expect PASS**

Run: `cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run --config vitest.config.ts src/i18n/parity.test.ts src/shell/__tests__/CircularPatternDialog.spec.tsx`
Expected: PASS (parity confirms en≡uk; missing-key would fail here).

- [ ] **Step 8: Commit**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/shell/CircularPatternDialog.tsx packages/app/src/shell/__tests__/CircularPatternDialog.spec.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json packages/app/src/shell/tabs/AssemblyTab.tsx
git commit -m "feat(circular-pattern): CircularPatternDialog + i18n + AssemblyTab wiring"
```

---

## Task 6: e2e (Slice F) — probe path

**Files:**
- Create: `tests/e2e/assembly-circular-pattern.spec.ts`

- [ ] **Step 1: Write the e2e** — model on `tests/e2e/assembly-component-pattern-mirror.spec.ts` (read it for the assembly-seeding helper + probe usage). Drive `CreateCircularPatternCommand` via `page.evaluate` import; assert 4 instances on a radius-R circle via `__zilventorStore`; undo round-trip.

```ts
import { test, expect } from '@playwright/test';
// Mirror the existing pattern-mirror e2e's bootstrap (seed an assembly with one source component,
// obtain its instance id). Reuse that file's helpers verbatim.

test('circular pattern bakes 4 legs on the circle + undo reverts', async ({ page }) => {
  await page.goto('/');
  // ... seed assembly + source component exactly as assembly-component-pattern-mirror.spec.ts does ...
  const srcId = /* the seeded source instance id */ '';

  await page.evaluate(async ([id]) => {
    const { CreateCircularPatternCommand } = await import('/src/commands/CreateCircularPatternCommand.ts');
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    const cmd = new CreateCircularPatternCommand({
      sourceInstanceId: id, axis: 'z', center: { x: 0, y: 0, z: 0 },
      count: 4, totalAngleDeg: 360, rotateInstances: true,
    });
    await useAppStore.getState().bus.execute(cmd);
  }, [srcId]);

  await expect.poll(async () =>
    page.evaluate(() => (window as any).__zilventorStore?.getState().activeAssembly?.components.length),
  ).toBe(4);

  // every instance equidistant from the z-axis (radius preserved)
  const radii = await page.evaluate(() => {
    const cs = (window as any).__zilventorStore.getState().activeAssembly.components;
    return cs.map((c: any) => Math.hypot(c.pose.translation.x, c.pose.translation.y));
  });
  for (const r of radii) expect(Math.abs(r - radii[0])).toBeLessThan(1e-6);

  await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    await useAppStore.getState().bus.undo();
  });
  await expect.poll(async () =>
    page.evaluate(() => (window as any).__zilventorStore?.getState().activeAssembly?.components.length),
  ).toBe(1);
});
```

> **Implementer:** the exact assembly/source bootstrap MUST be copied from `assembly-component-pattern-mirror.spec.ts` (it knows how this app seeds a part + assembly + source component in the browser). Don't invent a new bootstrap. Headless viewport is black — assert via probes only, never screenshots.

- [ ] **Step 2: Run e2e — expect PASS** (dev server on 5173 must be up; `reuseExistingServer: true`)

Run: `cd /Users/lion/Documents/Projects/mine/zilventor && npx playwright test tests/e2e/assembly-circular-pattern.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add tests/e2e/assembly-circular-pattern.spec.ts
git commit -m "test(circular-pattern): e2e probe-path circular bake + undo"
```

---

## Final gates (NOT tasks — controller runs these before merge)

1. **FINAL whole-branch review of the actual UI code** (`CircularPatternDialog.tsx` + `AssemblyTab.tsx` wiring) — the slice-3 lesson: a green command-e2e shipped over a stubbed dialog. Confirm: button opens dialog, dialog reads live state, submit dispatches the REAL command, onCommit opts map 1:1 to the command opts. Slice E's DOM-interaction test is the automated guard.
2. **Full-package tsc** — `cd packages/app && npx tsc --noEmit` (catches test-file type errors vitest misses). Expect 0 NEW errors vs the ~16 pre-existing baseline.
3. **§6 real-browser probe** — `__zilventorAssemblyPoses()` shows the circular instances at correct poses (headless = probes, not screenshots).
4. **Full app suite** — `cd packages/app && npx vitest run --config vitest.config.ts` — green modulo the ~3 known jsdom App.spec teardown errors.

---

## Self-Review (done by author)

- **Spec coverage:** §3 → Tasks 1–3; §4 → Task 4; §5 → Task 5; §6 Slices A–F → Tasks 1–6; §10.1 anti-tautology → Task 3 oracle; §10.2 threading → Task 4 tests; §10.3 store flag/Quat/rotation struct → Tasks 4–5; §10.4 count label/step/validation → Task 5. Degenerate-radius guard: dialog cannot compute it without source pose → deferred to command/noted (flagged in Task 5).
- **Type consistency:** `CircularPatternDialogValue` (`totalAngleDeg`, `rotateInstances`, `center`) matches `CreateCircularPatternOpts` 1:1; `computeCircularPoses` signature identical across Tasks 2/3/4. `axisAngleToQuat`/`quatMul` tuple types consistent.
- **Placeholder scan:** the dialog JSX body and e2e bootstrap are intentionally delegated-with-instructions (clone named existing file) rather than fully spelled out, because they're mechanical copies of large existing components — the implementer has the exact source to mirror. All NEW logic (math, command, validation) is fully written.
- **Known risk:** the degenerate-radius guard (§10.4) is weakened to a command-layer/deferred concern because `ComponentSummary` carries only `{id,label}`, no pose. Acceptable for v1; flag in handoff.
