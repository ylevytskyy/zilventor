# Plan: Component Pattern + Mirror (Assembly)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-08
**Spec:** `docs/superpowers/specs/2026-06-08-assembly-component-pattern-mirror-design.md`
**Track:** Tier-1 Inventor-2012 parity — furniture
**Predecessor commit:** `08cf120` (sketch tools slice 1)

## Goal
Add **Rectangular Component Pattern** and **Mirror Component** to the assembly ribbon.
Pattern bakes N×M independent `ComponentInstance`s (translation only, quat unchanged).
Mirror creates a new BREP-mirrored part + one instance at the geometrically correct reflected pose.

## Architecture
- No new shared types, no manifest bump (stays v20). D1–D6 from spec are locked.
- Pure pose-math helpers live in `packages/app/src/assembly/poseHelpers.ts` — they are app-level (use `Vec3`, `MirrorPlane`, `PatternAxis` from shared; no OCCT dependency).
  - Justification: Part-level pattern math lives entirely in kernel feature evaluators; the assembly bake is a pure JS translation. Placing it in app keeps kernel free of assembly topology knowledge. The existing `Pose` type (`flattenForSolver.ts:5`) is already in app.
- Kernel gains one new public method: `mirrorPart(sourcePartId: string): Promise<{ brepBlobId: string; partId: string }>`.
  - Added to the `KernelApi` type and `createKernelApi()` impl in `packages/kernel/src/api.ts`.
  - Reuses `mirrorShape(oc, shape, 'yz')` — local-YZ mirror = `S = diag(-1,1,1)`.
  - Returns a new `brepBlobId` (registered in `importedShapeCache`) and a new `PartDocument` id (registered in `parts`).
- Commands: `CreateComponentPatternCommand`, `MirrorComponentCommand` in `packages/app/src/commands/`.
- Dialogs: `ComponentPatternDialog`, `MirrorComponentDialog` in `packages/app/src/shell/`.
- Store: two new flags `componentPatternDialogOpen` / `mirrorComponentDialogOpen` + setters.
- AssemblyTab: new "Pattern" ribbon div between Component and Constraint panels.
- e2e: `tests/e2e/assembly-component-pattern-mirror.spec.ts`.

## Tech Stack
- TypeScript, Vitest (unit + kernel-integration), Playwright (e2e)
- OCCT via `packages/kernel/src/occt/TransformOps.mirrorShape`
- Existing helpers: `dedupeName`, `buildImportedPartDocument`, `registerPart`, `saveToBytes`, `deletePart`, `addComponent`, `removeComponent`

> **REQUIRED SUB-SKILL for agentic workers:** Load `superpowers:test-driven-development` before writing any implementation code. Each task below follows red→green→refactor. After all tasks, gate completion with `superpowers:verification-before-completion`.

---

## Tasks

### Task 1 — Pure helper `computeRectGridPoses` (app)

**Files:**
- Create: `packages/app/src/assembly/poseHelpers.ts`
- Create: `packages/app/src/assembly/__tests__/poseHelpers.spec.ts`

**Steps:**

1. **Write failing test** (`poseHelpers.spec.ts`):

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { computeRectGridPoses } from '../poseHelpers';
import type { PatternAxis, MirrorPlane } from '@zilventor/shared';

const identityPose = {
  translation: { x: 0, y: 0, z: 0 },
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
};

describe('computeRectGridPoses', () => {
  it('1D along X: count=3, spacing=10 → 2 poses at x=10 and x=20', () => {
    const poses = computeRectGridPoses(identityPose, 'x', 3, 10);
    expect(poses).toHaveLength(2);
    expect(poses[0]!.translation).toEqual({ x: 10, y: 0, z: 0 });
    expect(poses[1]!.translation).toEqual({ x: 20, y: 0, z: 0 });
  });

  it('1D along Y: count=2, spacing=15 → 1 pose at y=15', () => {
    const poses = computeRectGridPoses(identityPose, 'y', 2, 15);
    expect(poses).toHaveLength(1);
    expect(poses[0]!.translation).toEqual({ x: 0, y: 15, z: 0 });
  });

  it('1D along Z: count=4, spacing=5 → 3 poses', () => {
    const poses = computeRectGridPoses(identityPose, 'z', 4, 5);
    expect(poses).toHaveLength(3);
    expect(poses[2]!.translation).toEqual({ x: 0, y: 0, z: 15 });
  });

  it('2D grid: count1=3,spacing1=10 along X; count2=2,spacing2=8 along Y → 5 poses', () => {
    const poses = computeRectGridPoses(identityPose, 'x', 3, 10, 'y', 2, 8);
    // 3*2 - 1 = 5 (excludes origin cell i=0,j=0)
    expect(poses).toHaveLength(5);
  });

  it('2D grid: origin excluded, all (i=0,j=0) NOT in results', () => {
    const poses = computeRectGridPoses(identityPose, 'x', 2, 10, 'y', 2, 5);
    // cells: (0,0),(1,0),(0,1),(1,1) → exclude (0,0) → 3 poses
    expect(poses).toHaveLength(3);
    // No pose at (0,0,0)
    expect(poses.every((p) => p.translation.x !== 0 || p.translation.y !== 0)).toBe(true);
  });

  it('preserves source quaternion unchanged', () => {
    const srcPose = {
      translation: { x: 5, y: 5, z: 5 },
      quaternion: [0.1, 0.2, 0.3, 0.927] as [number, number, number, number],
    };
    const poses = computeRectGridPoses(srcPose, 'x', 2, 10);
    expect(poses[0]!.quaternion).toEqual(srcPose.quaternion);
  });

  it('source translation is base: pose at count=2 spacing=10 is src+(10,0,0)', () => {
    const src = { translation: { x: 3, y: 7, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] };
    const poses = computeRectGridPoses(src, 'x', 2, 10);
    expect(poses[0]!.translation).toEqual({ x: 13, y: 7, z: 0 });
  });
});
```

2. **Run — must fail** (helper does not exist yet):
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/assembly/__tests__/poseHelpers.spec.ts
   ```
   Expected failure: `Cannot find module '../poseHelpers'`

3. **Implement** (`poseHelpers.ts`):

```typescript
import type { PatternAxis, MirrorPlane, Vec3 } from '@zilventor/shared';

export type Pose = { translation: Vec3; quaternion: [number, number, number, number] };

function axisVec(axis: PatternAxis): Vec3 {
  return axis === 'x' ? { x: 1, y: 0, z: 0 }
       : axis === 'y' ? { x: 0, y: 1, z: 0 }
       :                { x: 0, y: 0, z: 1 };
}

/**
 * Returns count1*count2 - 1 poses (origin cell excluded).
 * Each pose = sourcePose.translation + i*spacing1*axis(dir1) + j*spacing2*axis(dir2).
 * Quaternion is copied unchanged from sourcePose.
 */
export function computeRectGridPoses(
  sourcePose: Pose,
  dir1: PatternAxis,
  count1: number,
  spacing1: number,
  dir2?: PatternAxis,
  count2?: number,
  spacing2?: number,
): Pose[] {
  const a1 = axisVec(dir1);
  const a2 = dir2 ? axisVec(dir2) : { x: 0, y: 0, z: 0 };
  const c2 = dir2 && count2 ? count2 : 1;
  const s2 = dir2 && spacing2 ? spacing2 : 0;
  const poses: Pose[] = [];
  for (let j = 0; j < c2; j++) {
    for (let i = 0; i < count1; i++) {
      if (i === 0 && j === 0) continue; // exclude origin
      poses.push({
        translation: {
          x: sourcePose.translation.x + i * spacing1 * a1.x + j * s2 * a2.x,
          y: sourcePose.translation.y + i * spacing1 * a1.y + j * s2 * a2.y,
          z: sourcePose.translation.z + i * spacing1 * a1.z + j * s2 * a2.z,
        },
        quaternion: [...sourcePose.quaternion] as [number, number, number, number],
      });
    }
  }
  return poses;
}
```

4. **Run — must pass**:
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/assembly/__tests__/poseHelpers.spec.ts
   ```

5. **Commit:**
   ```
   git commit -m "feat(app): computeRectGridPoses pure helper — assembly rectangular pattern poses"
   ```

---

### Task 2 — Pure helper `computeMirroredPose` (app) — Pure helper `computeMirroredPose` (app)

**Files:**
- Modify: `packages/app/src/assembly/poseHelpers.ts` (add exports)
- Modify: `packages/app/src/assembly/__tests__/poseHelpers.spec.ts` (add describe block)

**Steps:**

1. **Write failing tests** (append to `poseHelpers.spec.ts`):

```typescript
// --- imports at top already present; add these to the file ---
// Add after the computeRectGridPoses describe block:

describe('computeMirroredPose', () => {
  it('YZ plane: reflects translation X, leaves Y/Z unchanged', () => {
    const src: Pose = { translation: { x: 5, y: 3, z: 2 }, quaternion: [0, 0, 0, 1] };
    const result = computeMirroredPose(src, 'yz');
    expect(result.translation.x).toBeCloseTo(-5, 10);
    expect(result.translation.y).toBeCloseTo(3, 10);
    expect(result.translation.z).toBeCloseTo(2, 10);
  });

  it('XZ plane: reflects translation Y', () => {
    const src: Pose = { translation: { x: 4, y: -6, z: 1 }, quaternion: [0, 0, 0, 1] };
    const result = computeMirroredPose(src, 'xz');
    expect(result.translation.x).toBeCloseTo(4, 10);
    expect(result.translation.y).toBeCloseTo(6, 10);
    expect(result.translation.z).toBeCloseTo(1, 10);
  });

  it('XY plane: reflects translation Z', () => {
    const src: Pose = { translation: { x: 1, y: 2, z: -7 }, quaternion: [0, 0, 0, 1] };
    const result = computeMirroredPose(src, 'xy');
    expect(result.translation.x).toBeCloseTo(1, 10);
    expect(result.translation.y).toBeCloseTo(2, 10);
    expect(result.translation.z).toBeCloseTo(7, 10);
  });

  it('R\' is orthonormal (identity source rotation, YZ plane)', () => {
    const src: Pose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };
    const result = computeMirroredPose(src, 'yz');
    const m = quatToMat3(result.quaternion);
    // rows orthonormal: each row has unit length
    for (let i = 0; i < 3; i++) {
      const row = [m[i * 3]!, m[i * 3 + 1]!, m[i * 3 + 2]!];
      const len = Math.sqrt(row.reduce((s, v) => s + v * v, 0));
      expect(len).toBeCloseTo(1, 8);
    }
  });

  it('det(R\') = +1 (proper rotation) for YZ plane, non-trivial source rotation', () => {
    // 45° around Z
    const sqrt2_2 = Math.SQRT2 / 2;
    const src: Pose = {
      translation: { x: 3, y: 1, z: 0 },
      quaternion: [0, 0, sqrt2_2, sqrt2_2],
    };
    const result = computeMirroredPose(src, 'yz');
    const m = quatToMat3(result.quaternion);
    const det = m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!)
              - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!)
              + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    expect(det).toBeCloseTo(1, 6);
  });

  it('round-trip: world point of source maps to M * worldPoint', () => {
    // Source has 45° around Z rotation and offset (10, 0, 0)
    const sqrt2_2 = Math.SQRT2 / 2;
    const src: Pose = {
      translation: { x: 10, y: 0, z: 0 },
      quaternion: [0, 0, sqrt2_2, sqrt2_2],
    };
    // Local point (1, 0, 0). Source world = R*(1,0,0) + t = (0,1,0) + (10,0,0) = (10,1,0)
    // Mirror YZ: M = diag(-1,1,1). M*(10,1,0) = (-10,1,0)
    // Mirrored pose: t' = (-10,0,0); local point in mirrored part is S*(1,0,0) = (-1,0,0)
    // Mirrored world = R'*(-1,0,0) + t'. Should equal (-10,1,0).
    const result = computeMirroredPose(src, 'yz');
    const localPt = { x: -1, y: 0, z: 0 }; // S * (1,0,0)
    const m = quatToMat3(result.quaternion);
    const worldX = m[0]! * localPt.x + m[1]! * localPt.y + m[2]! * localPt.z + result.translation.x;
    const worldY = m[3]! * localPt.x + m[4]! * localPt.y + m[5]! * localPt.z + result.translation.y;
    const worldZ = m[6]! * localPt.x + m[7]! * localPt.y + m[8]! * localPt.z + result.translation.z;
    expect(worldX).toBeCloseTo(-10, 6);
    expect(worldY).toBeCloseTo(1, 6);
    expect(worldZ).toBeCloseTo(0, 6);
  });
});
```

Also add `import { computeMirroredPose, quatToMat3 } from '../poseHelpers';` at the top.

2. **Run — must fail:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/assembly/__tests__/poseHelpers.spec.ts
   ```
   Expected failure: `computeMirroredPose is not a function`

3. **Implement** (append to `poseHelpers.ts`):

```typescript
/**
 * Converts quaternion [x,y,z,w] → row-major 3×3 rotation matrix (9 elements).
 * Same convention as TransformOps.transformShapeByPose.
 * r[i*3+j] = R[i][j].
 */
export function quatToMat3(q: [number, number, number, number]): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z),     2 * (x * z + w * y),
    2 * (x * y + w * z),     1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y),     2 * (y * z + w * x),     1 - 2 * (x * x + y * y),
  ];
}

/**
 * Converts a row-major 3×3 rotation matrix to a quaternion [x,y,z,w].
 * Uses Shepperd's method (numerically stable).
 */
export function mat3ToQuat(m: number[]): [number, number, number, number] {
  const trace = m[0]! + m[4]! + m[8]!;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m[7]! - m[5]!) * s;
    y = (m[2]! - m[6]!) * s;
    z = (m[3]! - m[1]!) * s;
  } else if (m[0]! > m[4]! && m[0]! > m[8]!) {
    const s = 2 * Math.sqrt(1 + m[0]! - m[4]! - m[8]!);
    w = (m[7]! - m[5]!) / s;
    x = 0.25 * s;
    y = (m[1]! + m[3]!) / s;
    z = (m[2]! + m[6]!) / s;
  } else if (m[4]! > m[8]!) {
    const s = 2 * Math.sqrt(1 + m[4]! - m[0]! - m[8]!);
    w = (m[2]! - m[6]!) / s;
    x = (m[1]! + m[3]!) / s;
    y = 0.25 * s;
    z = (m[5]! + m[7]!) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[8]! - m[0]! - m[4]!);
    w = (m[3]! - m[1]!) / s;
    x = (m[2]! + m[6]!) / s;
    y = (m[5]! + m[7]!) / s;
    z = 0.25 * s;
  }
  const n = Math.sqrt(x * x + y * y + z * z + w * w);
  return [x / n, y / n, z / n, w / n];
}

/** Row-major 3×3 matrix multiply: C = A * B */
function mat3Mul(a: number[], b: number[]): number[] {
  const c: number[] = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += a[i * 3 + k]! * b[k * 3 + j]!;
      c[i * 3 + j] = v;
    }
  }
  return c;
}

/**
 * Reflection matrix M for world-plane mirror.
 * M_yz = diag(-1,1,1), M_xz = diag(1,-1,1), M_xy = diag(1,1,-1).
 */
function worldMirrorMat(plane: MirrorPlane): number[] {
  return [
    plane === 'yz' ? -1 : 1, 0, 0,
    0, plane === 'xz' ? -1 : 1, 0,
    0, 0, plane === 'xy' ? -1 : 1,
  ];
}

/** S = diag(-1,1,1): local-YZ reflection applied to the part geometry by mirrorPart. */
const S_MAT: number[] = [-1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Given a source pose and a world mirror plane, compute the mirrored placement pose
 * such that new_world = M * old_world for every point in the part.
 *
 * R' = M * R * S  (det = (-1)(+1)(-1) = +1 → proper rotation)
 * t' = M * t
 *
 * The mirrored part geometry has been reflected with S = diag(-1,1,1)
 * by kernel.mirrorPart (mirrorShape across local YZ / plane='yz').
 */
export function computeMirroredPose(sourcePose: Pose, worldPlane: MirrorPlane): Pose {
  const M = worldMirrorMat(worldPlane);
  const R = quatToMat3(sourcePose.quaternion);
  const Rprime = mat3Mul(mat3Mul(M, R), S_MAT);
  const { x: tx, y: ty, z: tz } = sourcePose.translation;
  return {
    translation: {
      x: M[0]! * tx + M[1]! * ty + M[2]! * tz,
      y: M[3]! * tx + M[4]! * ty + M[5]! * tz,
      z: M[6]! * tx + M[7]! * ty + M[8]! * tz,
    },
    quaternion: mat3ToQuat(Rprime),
  };
}
```

4. **Run — must pass:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/assembly/__tests__/poseHelpers.spec.ts
   ```

5. **Commit:**
   ```
   git commit -m "feat(app): computeMirroredPose + quatToMat3/mat3ToQuat helpers — geometrically correct assembly mirror pose"
   ```

---

### Task 3 — Kernel `mirrorPart` — real-OCCT integration test + impl

**Files:**
- Modify: `packages/kernel/src/api.ts` — add `mirrorPart` to `KernelApi` type + `createKernelApi()` impl
- Create: `packages/kernel/src/__tests__/mirrorPart.integration.spec.ts`

**Key design:** `mirrorPart(sourcePartId)` loads the source part's cached `NamedShape` (or executes it to warm the cache), mirrors the shape with `mirrorShape(oc, shape, 'yz')`, registers the mirrored blob in `importedShapeCache`, builds a new `PartDocument` with an `ImportedFeature` referencing it, registers and executes it, and returns `{ brepBlobId, partId }`. The new part is also stored in `parts`.

**⚠️ ANTI-PATTERN ALERT:** The real-OCCT test must query the actual bounding box from the kernel's `execute` output — never hand-author the mirrored bounding box. The slice-1 `computeFillet` false-green was caused by hand-authoring the expected value. Here: import cube-10mm.step (xMin=0..xMax=10); after `mirrorPart`, execute the new part; assert `xMin ≈ -10, xMax ≈ 0`. We derive this from the original part's bbox, not a constant.

**Steps:**

1. **Write failing integration test** (`mirrorPart.integration.spec.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createKernelApi } from '../api';
import { buildImportedPartDocument } from '../../../app/src/import/buildImportedPartDocument';
// NOTE: do NOT import stepFilenameBasename here — it is unused and will fail tsc/lint

const CUBE_STEP = resolve(
  __dirname,
  '../occt/__tests__/fixtures/step/cube-10mm.step',
);

describe('kernel.mirrorPart (real OCCT)', () => {
  it('mirrors an asymmetric solid: bbox xMax→-xMin, xMin→-xMax', async () => {
    const api = createKernelApi();
    await api.init();

    // 1. Import cube-10mm.step
    const stepRaw = readFileSync(CUBE_STEP);
    const stepBytes = stepRaw.buffer.slice(stepRaw.byteOffset, stepRaw.byteOffset + stepRaw.byteLength);
    const importResult = await api.importStep({ stepBytes, partName: 'cube-src' });
    const srcPart = buildImportedPartDocument('cube-src', importResult.brepBlobId, 'cube-10mm.step');
    await api.registerPart(srcPart);

    // 2. Get source bounding box (driven from actual execute output — NOT a constant)
    const srcExec = await api.execute(srcPart.id);
    expect(srcExec.ok).toBe(true);
    const srcBbox = importResult.boundingBox; // [xMin, yMin, zMin, xMax, yMax, zMax]
    const [srcXMin, , , srcXMax] = srcBbox;

    // 3. Mirror the part
    const { partId: mirrorPartId } = await api.mirrorPart(srcPart.id);

    // 4. Execute the mirrored part
    const mirExec = await api.execute(mirrorPartId);
    expect(mirExec.ok).toBe(true);
    if (!mirExec.ok) throw new Error('mirrorPart execute failed');

    // 5. Get mirrored bounding box from mesh
    const mirBbox = mirExec.value.mesh.boundingBox;
    // mirrorShape(oc, shape, 'yz') reflects X → new xMin = -srcXMax, new xMax = -srcXMin
    const [mxMin, , , mxMax] = mirBbox;
    expect(mxMin).toBeCloseTo(-srcXMax!, 4);
    expect(mxMax).toBeCloseTo(-srcXMin!, 4);
  });

  it('mirrorPart: new part id differs from source', async () => {
    const api = createKernelApi();
    await api.init();
    const stepRaw = readFileSync(CUBE_STEP);
    const stepBytes = stepRaw.buffer.slice(stepRaw.byteOffset, stepRaw.byteOffset + stepRaw.byteLength);
    const imp = await api.importStep({ stepBytes, partName: 'cube-src2' });
    const src = buildImportedPartDocument('cube-src2', imp.brepBlobId, 'cube-10mm.step');
    await api.registerPart(src);
    const { partId } = await api.mirrorPart(src.id);
    expect(partId).not.toBe(src.id);
  });

  it('throws if sourcePartId not registered', async () => {
    const api = createKernelApi();
    await api.init();
    await expect(api.mirrorPart('no-such-part')).rejects.toThrow();
  });
});
```

2. **Run — must fail:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run src/__tests__/mirrorPart.integration.spec.ts
   ```
   Expected failure: `api.mirrorPart is not a function`

3. **Implement** — add to `KernelApi` type in `api.ts` after `registerPart`:

```typescript
  /**
   * Create a new part whose geometry is `sourcePartId` mirrored across its
   * local YZ plane (S = diag(-1,1,1)). The mirrored BREP blob is registered
   * in importedShapeCache; the new PartDocument is registered in parts.
   * Returns the new partId and brepBlobId so the caller can save to OPFS.
   *
   * The source part must have been executed (namedShapeCache warm) or be
   * executable. Throws if sourcePartId is unknown or execute fails.
   */
  mirrorPart(sourcePartId: string): Promise<{ partId: string; brepBlobId: string }>;
```

Add to `createKernelApi()` impl after `registerPart`:

```typescript
    async mirrorPart(sourcePartId) {
      if (!occt) throw new Error('kernel not initialized');
      const srcPart = parts.get(sourcePartId);
      if (!srcPart) throw new Error(`mirrorPart: unknown part ${sourcePartId}`);

      // Ensure namedShape is warm
      let ns = namedShapeCache.get(sourcePartId);
      if (!ns) {
        const r = await executeTree(occt, srcPart, lookupImportedShape);
        if (!r.ok) throw new Error(`mirrorPart: execute failed: ${r.error.message}`);
        updateNamedShapeCache(sourcePartId, r.value.namedShape, r.value.workFeatures ?? []);
        ns = r.value.namedShape;
      }

      // Mirror the shape across local YZ (plane='yz' → negates X → S = diag(-1,1,1))
      // mirrorShape is statically imported at the top of api.ts — no dynamic import needed
      const mirrored = mirrorShape(occt, ns.shape, 'yz');

      // Register the mirrored BREP in importedShapeCache
      const brepBlobId = `mirror-${crypto.randomUUID()}`;
      registerImportedShape(brepBlobId, mirrored);

      // Build a new PartDocument referencing the blob
      // NOTE: kernel cannot import from app; inline the construction:

      const newId = crypto.randomUUID();
      const newPart: PartDocument = {
        id: newId,
        name: `${srcPart.name}_mirror`,
        units: 'mm' as const,
        parameters: {},
        featureTree: [
          ...ORIGIN_FEATURES,
          { kind: 'imported' as const, id: `mirror-body-${newId}`, sourceStep: `${srcPart.name}_mirror`, bodyRef: brepBlobId },
        ],
        properties: {},
        materials: [],
        hardware: [],
      };
      parts.set(newId, newPart);
      return { partId: newId, brepBlobId };
    },
```

**NOTE:** The kernel cannot import from app package. Replace the `buildImportedPartDocument` import with inline construction. Also: `ORIGIN_FEATURES` may not be in a kernel-internal module. Check: `packages/app/src/import/originFeatures.ts` exports `ORIGIN_FEATURES`. The kernel itself does NOT import from app. Instead inline the 7 origin work-feature entries directly in the `mirrorPart` impl (copy from `originFeatures.ts`).

**Correct impl for `mirrorPart` — no app imports:**

```typescript
    async mirrorPart(sourcePartId) {
      if (!occt) throw new Error('kernel not initialized');
      const srcPart = parts.get(sourcePartId);
      if (!srcPart) throw new Error(`mirrorPart: unknown part ${sourcePartId}`);

      let ns = namedShapeCache.get(sourcePartId);
      if (!ns) {
        const r = await executeTree(occt, srcPart, lookupImportedShape);
        if (!r.ok) throw new Error(`mirrorPart: execute failed for ${sourcePartId}: ${r.error.message}`);
        updateNamedShapeCache(sourcePartId, r.value.namedShape, r.value.workFeatures ?? []);
        ns = r.value.namedShape;
      }

      // mirrorShape(oc, shape, 'yz') → reflects X axis → S = diag(-1,1,1)
      // mirrorShape is statically imported (see line-22 import in api.ts) — call directly
      const mirrored = mirrorShape(occt, ns.shape, 'yz');
      const brepBlobId = `mirror-${crypto.randomUUID()}`;
      registerImportedShape(brepBlobId, mirrored);

      const newId = crypto.randomUUID();
      const featureId = `mirror-body-${newId}`;
      // Inline the 7 origin work-features (same as originFeatures.ts ORIGIN_FEATURES):
      const originFeatures: PartDocument['featureTree'] = [
        { kind: 'workAxis',  id: 'origin.X',  visible: false, source: { mode: 'origin', axis: 'X' } },
        { kind: 'workAxis',  id: 'origin.Y',  visible: false, source: { mode: 'origin', axis: 'Y' } },
        { kind: 'workAxis',  id: 'origin.Z',  visible: false, source: { mode: 'origin', axis: 'Z' } },
        { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
        { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
        { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
        { kind: 'workPoint', id: 'origin.O',  visible: false, source: { mode: 'origin' } },
      ];
      const mirrorPartDoc: PartDocument = {
        id: newId,
        name: `${srcPart.name}_mirror`,
        units: 'mm',
        parameters: {},
        featureTree: [
          ...originFeatures,
          { kind: 'imported', id: featureId, sourceStep: `${srcPart.name}_mirror`, bodyRef: brepBlobId },
        ],
        properties: {},
        materials: [],
        hardware: [],
      };
      parts.set(newId, mirrorPartDoc);
      return { partId: newId, brepBlobId };
    },
```

**Static import (required — no dynamic import):** Update the existing line-22 import in `api.ts` (currently `import { transformShapeByPose } from './occt/TransformOps'`) to:
```typescript
import { transformShapeByPose, mirrorShape } from './occt/TransformOps';
```
There are exactly **two** edit sites for `mirrorPart` in `api.ts`: (a) add the method signature to the `KernelApi` type, (b) add the impl in `createKernelApi()`'s return object. `worker.ts` needs NO change — Comlink.expose exposes the whole object automatically.

4. **Run — must pass:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run src/__tests__/mirrorPart.integration.spec.ts
   ```

5. **Commit:**
   ```
   git commit -m "feat(kernel): mirrorPart API — mirrors source part BREP across local YZ, returns new partId+brepBlobId"
   ```

---

### Task 4 — `CreateComponentPatternCommand` (app)

**Files:**
- Create: `packages/app/src/commands/CreateComponentPatternCommand.ts`
- Create: `packages/app/src/commands/__tests__/CreateComponentPatternCommand.spec.ts`

Clone structure from: `packages/app/src/commands/PlaceComponentCommand.ts` (the `apply`/`revert` + `addComponent`/`removeComponent` pattern, lines 39–91).

**Steps:**

1. **Write failing test** (`CreateComponentPatternCommand.spec.ts`):

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { CreateComponentPatternCommand } from '../CreateComponentPatternCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

function makeAsm(components: AssemblyDocument['components'] = []): AssemblyDocument {
  return {
    id: 'asm1', name: 'test-asm', units: 'mm', parameters: {}, properties: {},
    components, constraints: [], groundedComponentPaths: [], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
}

const srcInstance: ComponentInstance = {
  id: 'src-1',
  partPath: 'panel.zipt',
  position: { x: 0, y: 0, z: 0 },
  rotation: { rx: 0, ry: 0, rz: 0 },
  visible: true,
  pose: { translation: { x: 5, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
};

describe('CreateComponentPatternCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAsm([srcInstance]) });
  });

  it('apply() adds count1-1 instances for 1D pattern', async () => {
    const cmd = new CreateComponentPatternCommand({
      sourceInstanceId: 'src-1',
      dir1: 'x', count1: 3, spacing1: 10,
    });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    // source (1) + 2 new = 3 total
    expect(comps).toHaveLength(3);
  });

  it('apply() places instances at correct translated positions', async () => {
    const cmd = new CreateComponentPatternCommand({
      sourceInstanceId: 'src-1',
      dir1: 'x', count1: 3, spacing1: 10,
    });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    // src is at x=5; new ones at x=15, x=25
    const newComps = comps.filter((c) => c.id !== 'src-1');
    expect(newComps).toHaveLength(2);
    const xs = newComps.map((c) => c.pose!.translation.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(15, 6);
    expect(xs[1]).toBeCloseTo(25, 6);
  });

  it('apply() 2D grid: count1=2,count2=2 → 3 new instances', async () => {
    const cmd = new CreateComponentPatternCommand({
      sourceInstanceId: 'src-1',
      dir1: 'x', count1: 2, spacing1: 10,
      dir2: 'y', count2: 2, spacing2: 8,
    });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(4); // src + 3
  });

  it('revert() removes all added instances', async () => {
    const cmd = new CreateComponentPatternCommand({
      sourceInstanceId: 'src-1',
      dir1: 'x', count1: 3, spacing1: 10,
    });
    await cmd.apply();
    await cmd.revert();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(1); // only src remains
  });

  it('apply() noops if sourceInstanceId not found', async () => {
    const cmd = new CreateComponentPatternCommand({
      sourceInstanceId: 'no-such', dir1: 'x', count1: 3, spacing1: 10,
    });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(1);
  });
});
```

2. **Run — must fail:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/commands/__tests__/CreateComponentPatternCommand.spec.ts
   ```
   Expected failure: `Cannot find module '../CreateComponentPatternCommand'`

3. **Implement** (`CreateComponentPatternCommand.ts`):

```typescript
import type { Command } from './Command';
import type { ComponentInstance, PatternAxis } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { computeRectGridPoses } from '../assembly/poseHelpers';

export type CreateComponentPatternOpts = {
  sourceInstanceId: string;
  dir1: PatternAxis;
  count1: number;
  spacing1: number;
  dir2?: PatternAxis;
  count2?: number;
  spacing2?: number;
};

export class CreateComponentPatternCommand implements Command {
  readonly name = 'CreateComponentPattern';
  private createdIds: string[] = [];

  constructor(private opts: CreateComponentPatternOpts) {}

  async apply(): Promise<void> {
    const asm = useAppStore.getState().activeAssembly;
    if (!asm) return;
    const src = asm.components.find((c) => c.id === this.opts.sourceInstanceId);
    if (!src) return;

    const srcPose = src.pose ?? {
      translation: { x: src.position.x, y: src.position.y, z: src.position.z },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    };

    const poses = computeRectGridPoses(
      srcPose,
      this.opts.dir1, this.opts.count1, this.opts.spacing1,
      this.opts.dir2, this.opts.count2, this.opts.spacing2,
    );

    this.createdIds = [];
    poses.forEach((pose, idx) => {
      const id = `Cp${Date.now()}_${idx}`;
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

4. **Run — must pass:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/commands/__tests__/CreateComponentPatternCommand.spec.ts
   ```

5. **Commit:**
   ```
   git commit -m "feat(app): CreateComponentPatternCommand — bakes rectangular 1D/2D component grid as independent instances"
   ```

---

### Task 5 — `MirrorComponentCommand` (app)

**Files:**
- Create: `packages/app/src/commands/MirrorComponentCommand.ts`
- Create: `packages/app/src/commands/__tests__/MirrorComponentCommand.spec.ts`

Clone apply/revert structure from: `packages/app/src/commands/ImportStepAsComponentCommand.ts` (the `registerPart` + `saveToBytes` + `opfs.write` + `addComponent` pipeline, lines 64–145; and revert's `removeComponent` + `deletePart` + `opfs.delete`, lines 147–189).

**Steps:**

1. **Write failing test** (`MirrorComponentCommand.spec.ts`):

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { MirrorComponentCommand } from '../MirrorComponentCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async exists(p: string) { return this.files.has(p); }
  async delete(p: string) { this.files.delete(p); }
  async listAll() { return [...this.files.keys()]; }
}

function makeKernel() {
  return {
    mirrorPart: vi.fn(async () => ({ partId: 'mirror-part-id', brepBlobId: 'mirror-blob' })),
    registerPart: vi.fn(async () => undefined),
    deletePart: vi.fn(async () => undefined),
    saveToBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
}

const srcInstance: ComponentInstance = {
  id: 'src-comp',
  partPath: 'side-panel.zipt',
  position: { x: 10, y: 0, z: 0 },
  rotation: { rx: 0, ry: 0, rz: 0 },
  visible: true,
  pose: { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
};

function makeAsm(): AssemblyDocument {
  return {
    id: 'asm', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
    components: [srcInstance], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
}

describe('MirrorComponentCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAsm() });
  });

  it('apply() calls kernel.mirrorPart with sourcePartKernelId (NOT the instance id)', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'src-comp', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    expect(kernel.mirrorPart).toHaveBeenCalledWith('kernel-part-id');
  });

  it('apply() adds 1 new component to the assembly', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'src-comp', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(2);
  });

  it('apply() places mirrored instance at reflected translation (YZ plane negates X)', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'src-comp', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    const mirrored = comps.find((c) => c.id !== 'src-comp')!;
    // YZ mirror: x → -x
    expect(mirrored.pose!.translation.x).toBeCloseTo(-10, 6);
    expect(mirrored.pose!.translation.y).toBeCloseTo(0, 6);
  });

  it('apply() writes a .zipt file to opfs', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'src-comp', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    expect(opfs.files.size).toBe(1);
  });

  it('revert() removes the component and deletes the part', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'src-comp', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    await cmd.revert();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(1);
    expect(kernel.deletePart).toHaveBeenCalledWith('mirror-part-id');
    expect(opfs.files.size).toBe(0);
  });

  it('apply() noops if source instance not found', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'no-such', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(1);
    expect(kernel.mirrorPart).not.toHaveBeenCalled();
  });
});
```

2. **Run — must fail:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/commands/__tests__/MirrorComponentCommand.spec.ts
   ```
   Expected failure: `Cannot find module '../MirrorComponentCommand'`

3. **Implement** (`MirrorComponentCommand.ts`):

```typescript
import type { Command } from './Command';
import type { ComponentInstance, MirrorPlane } from '@zilventor/shared';
import type { KernelApi } from '@zilventor/kernel/src/api';
import { useAppStore } from '../store/useAppStore';
import { computeMirroredPose } from '../assembly/poseHelpers';
import { dedupeName } from '../import/dedupeName';

export type MirrorComponentOpts = {
  sourceInstanceId: string;
  /** Kernel-registered part ID for the source (UUID from PartDocument.id).
   *  Obtained by the caller via `kernel.loadFromBytes(await opfs.read(srcComp.partPath))`.
   *  Must NOT be the component/instance id — kernel.mirrorPart operates on part UUIDs. */
  sourcePartKernelId: string;
  plane: MirrorPlane;
  kernel: Pick<KernelApi, 'mirrorPart' | 'registerPart' | 'deletePart' | 'saveToBytes'>;
  opfs: {
    write(path: string, data: Uint8Array): Promise<void>;
    delete(path: string): Promise<void>;
    listAll(): Promise<string[]>;
  };
};

export class MirrorComponentCommand implements Command {
  readonly name = 'MirrorComponent';
  private placedId: string | null = null;
  private mirrorPartId: string | null = null;
  private mirrorPartPath: string | null = null;

  constructor(private opts: MirrorComponentOpts) {}

  async apply(): Promise<void> {
    const asm = useAppStore.getState().activeAssembly;
    if (!asm) return;
    const src = asm.components.find((c) => c.id === this.opts.sourceInstanceId);
    if (!src) return;

    const { kernel, opfs, plane } = this.opts;

    // 1. Mirror the BREP in the kernel (plane='yz' → S=diag(-1,1,1))
    // opts.sourcePartKernelId is the kernel PartDocument.id UUID — NOT the instance id
    const { partId: mirrorPartId } = await kernel.mirrorPart(this.opts.sourcePartKernelId);
    this.mirrorPartId = mirrorPartId;

    // 2. Name the mirrored part
    const srcName = src.partPath.replace(/\.zipt$/, '');
    const existingNames = (await opfs.listAll())
      .filter((p) => p.endsWith('.zipt'))
      .map((p) => p.replace(/\.zipt$/, ''));
    const mirrorName = dedupeName(`${srcName}_mirror`, existingNames);
    this.mirrorPartPath = `${mirrorName}.zipt`;

    // 3. Save mirrored part to OPFS
    const archiveBytes = await kernel.saveToBytes(mirrorPartId);
    await opfs.write(this.mirrorPartPath, archiveBytes);

    // 4. Compute mirrored pose
    const srcPose = src.pose ?? {
      translation: { x: src.position.x, y: src.position.y, z: src.position.z },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    };
    const mirroredPose = computeMirroredPose(srcPose, plane);

    // 5. Add the mirrored component instance
    const id = `Cm${Date.now()}`;
    const instance: ComponentInstance = {
      id,
      partPath: this.mirrorPartPath,
      position: { x: mirroredPose.translation.x, y: mirroredPose.translation.y, z: mirroredPose.translation.z },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
      pose: mirroredPose,
    };
    useAppStore.getState().addComponent(instance);
    this.placedId = id;
  }

  async revert(): Promise<void> {
    if (this.placedId) {
      useAppStore.getState().removeComponent(this.placedId);
      this.placedId = null;
    }
    if (this.mirrorPartId) {
      try { await this.opts.kernel.deletePart(this.mirrorPartId); } catch { /* best-effort */ }
      this.mirrorPartId = null;
    }
    if (this.mirrorPartPath) {
      try { await this.opts.opfs.delete(this.mirrorPartPath); } catch { /* best-effort */ }
      this.mirrorPartPath = null;
    }
  }
}
```


4. **Run — must pass:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/commands/__tests__/MirrorComponentCommand.spec.ts
   ```

5. **Commit:**
   ```
   git commit -m "feat(app): MirrorComponentCommand — apply creates mirrored BREP part + instance; revert removes both"
   ```

---

### Task 6 — Store flags + `ComponentPatternDialog` (app)

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts` — add `componentPatternDialogOpen` + `mirrorComponentDialogOpen` flags + setters
- Create: `packages/app/src/shell/ComponentPatternDialog.tsx`
- Create: `packages/app/src/shell/__tests__/ComponentPatternDialog.spec.tsx`

Clone from: `packages/app/src/shell/LinearPatternDialog.tsx` (lines 1–153) — adapts the `PatternableFeatureSummary` source to assembly components, adds Dir2/Count2/Spacing2 optional group.

**Steps:**

1. **Write failing dialog tests** (`ComponentPatternDialog.spec.tsx`):

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentPatternDialog } from '../ComponentPatternDialog';

const COMPONENTS = [
  { id: 'c1', label: 'shelf-panel' },
  { id: 'c2', label: 'side-panel' },
];

describe('ComponentPatternDialog', () => {
  it('renders with source dropdown and axis buttons', () => {
    render(
      <ComponentPatternDialog
        components={COMPONENTS}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Source component')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'X' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Y' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Z' })).toBeInTheDocument();
  });

  it('OK disabled when count < 2', () => {
    render(
      <ComponentPatternDialog
        components={COMPONENTS}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const countInput = screen.getByLabelText('Count 1');
    fireEvent.change(countInput, { target: { value: '1' } });
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });

  it('OK disabled when spacing is 0', () => {
    render(
      <ComponentPatternDialog
        components={COMPONENTS}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const spacingInput = screen.getByLabelText('Spacing 1');
    fireEvent.change(spacingInput, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });

  it('onCommit called with correct values on OK', () => {
    const onCommit = vi.fn();
    render(
      <ComponentPatternDialog
        components={COMPONENTS}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );
    // defaults: source=c1, dir1=x, count=3, spacing=10
    fireEvent.submit(screen.getByRole('dialog'));
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ sourceComponentId: 'c1', dir1: 'x', count1: expect.any(Number), spacing1: expect.any(Number) })
    );
  });

  it('dir2≠dir1 validation: same axis disables OK when second direction checkbox enabled', () => {
    render(
      <ComponentPatternDialog
        components={COMPONENTS}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const checkbox = screen.getByLabelText('Second direction');
    fireEvent.click(checkbox);
    // dir1 defaults to X; click X for dir2 as well
    const xButtons = screen.getAllByRole('button', { name: 'X' });
    fireEvent.click(xButtons[1]!); // second X button is dir2
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });
});
```

Also add to `useAppStore.ts`:
- In `AppState` interface: `componentPatternDialogOpen: boolean; mirrorComponentDialogOpen: boolean;`
- In `AppActions` interface: `setComponentPatternDialogOpen(v: boolean): void; setMirrorComponentDialogOpen(v: boolean): void;`
- In initial state: `componentPatternDialogOpen: false, mirrorComponentDialogOpen: false,`
- In actions: `setComponentPatternDialogOpen: (v) => set({ componentPatternDialogOpen: v }), setMirrorComponentDialogOpen: (v) => set({ mirrorComponentDialogOpen: v }),`

2. **Run — must fail:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/shell/__tests__/ComponentPatternDialog.spec.tsx
   ```
   Expected failure: `Cannot find module '../ComponentPatternDialog'`

3. **Implement** (`ComponentPatternDialog.tsx`) — clone `LinearPatternDialog.tsx` (~153 lines), replacing:
   - `patternableFeatures: PatternableFeatureSummary[]` → `components: { id: string; label: string }[]`
   - `sourceFeatureId` → `sourceComponentId`
   - Remove `validateExpression` (spacing is a numeric literal; use `parseFloat` + `> 0` check)
   - Add `dir2Enabled` state (boolean), `dir2`, `count2Str`, `spacing2Str` — gated by checkbox
   - Add `dir2 !== dir1` validation when `dir2Enabled`
   - `onCommit` value type: `ComponentPatternDialogValue { sourceComponentId, dir1, count1, spacing1, dir2?, count2?, spacing2? }`
   - `aria-label="Count 1"`, `aria-label="Spacing 1"`, `aria-label="Source component"`, `aria-label="Second direction"` (checkbox)

   **Key validation logic:**
   ```typescript
   const spacing1Val = parseFloat(spacing1);
   const spacing1Valid = Number.isFinite(spacing1Val) && spacing1Val !== 0;
   const count1 = parseInt(count1Str, 10);
   const count1Valid = Number.isFinite(count1) && count1 >= 2 && count1 <= 200;
   let dir2Valid = true;
   if (dir2Enabled) {
     dir2Valid = dir2 !== dir1
       && Number.isFinite(parseFloat(spacing2)) && parseFloat(spacing2) !== 0
       && Number.isFinite(parseInt(count2Str, 10)) && parseInt(count2Str, 10) >= 2 && parseInt(count2Str, 10) <= 200;
   }
   const canCommit = sourceComponentId !== '' && count1Valid && spacing1Valid && dir2Valid;
   ```

4. **Run — must pass:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/shell/__tests__/ComponentPatternDialog.spec.tsx
   ```

5. **Commit:**
   ```
   git commit -m "feat(app): ComponentPatternDialog + store flags for component pattern/mirror dialogs"
   ```

---

### Task 7 — `MirrorComponentDialog` (app)

**Files:**
- Create: `packages/app/src/shell/MirrorComponentDialog.tsx`
- Create: `packages/app/src/shell/__tests__/MirrorComponentDialog.spec.tsx`

Clone from: `packages/app/src/shell/MirrorDialog.tsx` (lines 1–115) — replace `patternableFeatures` with `components: { id: string; label: string }[]`, rename type `MirrorComponentDialogValue { sourceComponentId, plane }`.

**Steps:**

1. **Write failing test** (`MirrorComponentDialog.spec.tsx`):

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MirrorComponentDialog } from '../MirrorComponentDialog';

const COMPONENTS = [{ id: 'c1', label: 'side-panel' }];

describe('MirrorComponentDialog', () => {
  it('renders source dropdown and plane buttons YZ / XZ / XY', () => {
    render(<MirrorComponentDialog components={COMPONENTS} onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'YZ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'XZ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'XY' })).toBeInTheDocument();
  });

  it('OK is disabled when no component', () => {
    render(<MirrorComponentDialog components={[]} onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });

  it('onCommit called with sourceComponentId and plane', () => {
    const onCommit = vi.fn();
    render(<MirrorComponentDialog components={COMPONENTS} onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.submit(screen.getByRole('dialog'));
    expect(onCommit).toHaveBeenCalledWith({ sourceComponentId: 'c1', plane: 'yz' });
  });
});
```

2. **Run — must fail:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/shell/__tests__/MirrorComponentDialog.spec.tsx
   ```

3. **Implement** (`MirrorComponentDialog.tsx`) — directly clone `MirrorDialog.tsx` (packages/app/src/shell/MirrorDialog.tsx:1-115), replacing:
   - `patternableFeatures` → `components`; type `{ id: string; label: string }[]`
   - `sourceFeatureId` → `sourceComponentId`
   - `MirrorDialogValue.sourceFeatureId` → `MirrorComponentDialogValue.sourceComponentId`
   - `aria-label="Mirror Component"` on the form
   - `aria-label="Source component"` on select

4. **Run — must pass:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/shell/__tests__/MirrorComponentDialog.spec.tsx
   ```

5. **Commit:**
   ```
   git commit -m "feat(app): MirrorComponentDialog — source dropdown + plane buttons for assembly mirror"
   ```

---

### Task 8 — AssemblyTab "Pattern" ribbon panel wiring

**Files:**
- Modify: `packages/app/src/shell/tabs/AssemblyTab.tsx`
- Modify: `packages/app/src/shell/RibbonPanel.tsx` (**read first** to confirm the import path and props)
- Create: `packages/app/src/shell/tabs/__tests__/AssemblyTab.pattern.spec.tsx`

**Steps:**

1. **Write failing test** (`AssemblyTab.pattern.spec.tsx`):

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssemblyTab } from '../AssemblyTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

function makeAsm(): AssemblyDocument {
  return {
    id: 'a1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
    components: [{ id: 'c1', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
    constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
    cutListItemNumbers: {}, colorOverrides: {}, materials: [], hardware: [],
  };
}

describe('AssemblyTab — Pattern panel', () => {
  it('renders "Rectangular Pattern" button disabled when no assembly', () => {
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /rectangular pattern/i });
    expect(btn).toBeDisabled();
  });

  it('renders "Rectangular Pattern" button enabled when assembly is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAsm() });
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /rectangular pattern/i });
    expect(btn).toBeEnabled();
  });

  it('renders "Mirror" button in Pattern panel', () => {
    render(<AssemblyTab />);
    expect(screen.getByRole('button', { name: /^mirror$/i })).toBeInTheDocument();
  });

  it('Pattern panel section label is visible', () => {
    render(<AssemblyTab />);
    expect(screen.getByText('Pattern')).toBeInTheDocument();
  });
});
```

2. **Run — must fail:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/shell/tabs/__tests__/AssemblyTab.pattern.spec.tsx
   ```
   Expected failure: `getByRole button "rectangular pattern" not found`

3. **Implement** — modify `AssemblyTab.tsx`:

   a. Add import at top:
   ```typescript
   import { ComponentPatternDialog } from '../ComponentPatternDialog';
   import { MirrorComponentDialog } from '../MirrorComponentDialog';
   import { CreateComponentPatternCommand } from '../../commands/CreateComponentPatternCommand';
   import { MirrorComponentCommand } from '../../commands/MirrorComponentCommand';
   ```

   b. Add to component body (after `const activeAssembly = ...`):
   ```typescript
   const componentPatternDialogOpen = useAppStore((s) => s.componentPatternDialogOpen);
   const mirrorComponentDialogOpen = useAppStore((s) => s.mirrorComponentDialogOpen);
   ```

   c. Insert a new "Pattern" panel `div` between the Component div and the Constraint div (after the `</div>` that ends the Component panel, before the `<div style={{ marginRight: 12 }}>` that starts the Constraint panel):

   ```tsx
   <div style={{ marginRight: 12 }}>
     <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Pattern</div>
     <button
       aria-label="Rectangular Pattern"
       disabled={!hasAssembly}
       onClick={() => useAppStore.getState().setComponentPatternDialogOpen(true)}
       style={btn}
     >
       Rectangular Pattern
     </button>
     <button
       aria-label="Mirror"
       disabled={!hasAssembly}
       onClick={() => useAppStore.getState().setMirrorComponentDialogOpen(true)}
       style={btn}
     >
       Mirror
     </button>
   </div>
   ```

   d. Before the closing `</div>` of the return, add dialog rendering:

   ```tsx
   {componentPatternDialogOpen && activeAssembly && (
     <ComponentPatternDialog
       components={activeAssembly.components.map((c) => ({
         id: c.id,
         label: c.partPath.replace(/\.zipt$|\.ziasm$/, ''),
       }))}
       onCancel={() => useAppStore.getState().setComponentPatternDialogOpen(false)}
       onCommit={async (v) => {
         useAppStore.getState().setComponentPatternDialogOpen(false);
         const { bus } = useAppStore.getState();
         const cmd = new CreateComponentPatternCommand({
           sourceInstanceId: v.sourceComponentId,
           dir1: v.dir1, count1: v.count1, spacing1: v.spacing1,
           dir2: v.dir2, count2: v.count2, spacing2: v.spacing2,
         });
         await bus.execute(cmd);
       }}
     />
   )}
   {mirrorComponentDialogOpen && activeAssembly && (
     <MirrorComponentDialog
       components={activeAssembly.components.map((c) => ({
         id: c.id,
         label: c.partPath.replace(/\.zipt$|\.ziasm$/, ''),
       }))}
       onCancel={() => useAppStore.getState().setMirrorComponentDialogOpen(false)}
       onCommit={async (v) => {
         useAppStore.getState().setMirrorComponentDialogOpen(false);
         const { kernel, bus } = useAppStore.getState();
         if (!kernel) return;
         const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
         const opfs = await Opfs.forNavigator();
         // Load source part to get its kernel ID
         const srcComp = activeAssembly.components.find((c) => c.id === v.sourceComponentId);
         if (!srcComp) return;
         const srcBytes = await opfs.read(srcComp.partPath);
         const srcKernelId = await kernel.loadFromBytes(srcBytes);
         const cmd = new MirrorComponentCommand({
           sourceInstanceId: v.sourceComponentId,
           sourcePartKernelId: srcKernelId,
           plane: v.plane,
           kernel,
           opfs,
         });
         await bus.execute(cmd);
       }}
     />
   )}
   ```

   **`kernel.mirrorPart` call sequence:** `mirrorPart` takes the kernel's `PartDocument.id` UUID, not the instance/component id. The tab handler above loads the source part bytes from OPFS via `opfs.read(srcComp.partPath)` and calls `kernel.loadFromBytes(srcBytes)` to get the part UUID — the same pattern used by `ImportStepAsComponentCommand`. `MirrorComponentOpts.sourcePartKernelId` carries this UUID into the command (see Task 5 where `opts.sourcePartKernelId` is already used).

   **⚠️ OPFS typing caution:** The `opfs.read(srcComp.partPath)` call in the mirror handler uses `Opfs.forNavigator()` which returns a real `Opfs` instance (has `read()` at `packages/kernel/src/storage/Opfs.ts:39`). Do NOT type it as `OpfsLike` from `ImportStepAsComponentCommand` — that type only declares `write/delete/listAll` and has no `read`, causing a tsc error. Import the `Opfs` class directly: `import { Opfs } from '@zilventor/kernel/src/storage/Opfs'` and use the instance from `Opfs.forNavigator()`.

4. **Run — must pass:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run src/shell/tabs/__tests__/AssemblyTab.pattern.spec.tsx
   ```

5. **Full suite check** (from app dir):
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run
   ```
   Ignore the ~3 known jsdom App.spec.tsx teardown errors.

6. **Commit:**
   ```
   git commit -m "feat(app): AssemblyTab Pattern ribbon panel — Rectangular Pattern + Mirror buttons wired to dialogs"
   ```

---

### Task 9 — e2e: place component → rectangular pattern ×3 + mirror

**Files:**
- Create: `tests/e2e/assembly-component-pattern-mirror.spec.ts`

Clone harness from: `tests/e2e/step-explode-into-assembly.spec.ts` (lines 1–162) — `waitForKernelReady`, `showOpenFilePicker` override, store access via `window.__zilventorStore`, `page.evaluate` command import pattern.

**Steps:**

1. **Write e2e test** (`assembly-component-pattern-mirror.spec.ts`):

```typescript
/**
 * E2E: Place a component into an assembly via the real command bus,
 * then apply CreateComponentPatternCommand (×3 along X) and
 * MirrorComponentCommand (YZ plane) — both through the bus.
 *
 * Drives commands directly (not the UI buttons) to avoid dialog interaction
 * complexity, matching the assembly e2e convention.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const CUBE_STEP = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step',
);

test(
  'Component Pattern + Mirror: place → pattern ×3 → assert 3 new; place → mirror → assert reflected pose',
  async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('PAGEERROR:', e.message); });

    await page.goto('/');
    await waitForKernelReady(page);

    // ── 1. Create a new assembly ──────────────────────────────────────────────
    await page.evaluate(async () => {
      const { NewAssemblyCommand } = await import('/src/commands/NewAssemblyCommand.ts');
      // NewAssemblyCommand is a plain function (not a class) — call directly, returns void
      NewAssemblyCommand({ name: 'untitled-assembly' });
    });

    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeDocument?.kind === 'assembly',
      undefined, { timeout: 10_000 },
    );

    // ── 2. Import cube-10mm.step as a component ───────────────────────────────
    const cubeBytes = readFileSync(CUBE_STEP);
    await page.evaluate(
      async ([bytes]: [number[]]) => {
        const { useAppStore } = await import('/src/store/useAppStore.ts');
        const { ImportStepAsComponentCommand } = await import('/src/commands/ImportStepAsComponentCommand.ts');
        const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
        const kernel = useAppStore.getState().kernel;
        if (!kernel) throw new Error('no kernel');
        const opfs = await Opfs.forNavigator();
        const fakeFile = {
          name: 'cube-10mm.step',
          arrayBuffer: async () => new Uint8Array(bytes).buffer,
        };
        // Override showOpenFilePicker so ImportStepAsComponentCommand gets the file
        (window as any).__testStepBytes = new Uint8Array(bytes).buffer;
        const cmd = new ImportStepAsComponentCommand({
          stepBytes: (window as any).__testStepBytes,
          fileName: 'cube-10mm.step',
          kernel,
          opfs,
        });
        await useAppStore.getState().bus.execute(cmd);
      },
      [Array.from(cubeBytes)] as [number[]],
    );

    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length >= 1,
      undefined, { timeout: 30_000 },
    );

    // ── 3. Get the placed component id ───────────────────────────────────────
    const srcCompId = await page.evaluate(() => {
      const s = (window as any).__zilventorStore?.getState();
      return s?.activeAssembly?.components[0]?.id ?? null;
    });
    expect(srcCompId).toBeTruthy();

    // ── 4. Rectangular Pattern: count=4, spacing=15mm along X ─────────────────
    await page.evaluate(
      async ([srcId]: [string]) => {
        const { useAppStore } = await import('/src/store/useAppStore.ts');
        const { CreateComponentPatternCommand } = await import('/src/commands/CreateComponentPatternCommand.ts');
        const cmd = new CreateComponentPatternCommand({
          sourceInstanceId: srcId,
          dir1: 'x', count1: 4, spacing1: 15,
        });
        await useAppStore.getState().bus.execute(cmd);
      },
      [srcCompId] as [string],
    );

    // Assert 4 components total (source + 3 new)
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 4,
      undefined, { timeout: 10_000 },
    );

    const patternState = await page.evaluate(() => {
      const s = (window as any).__zilventorStore?.getState();
      const comps = s?.activeAssembly?.components ?? [];
      return {
        count: comps.length,
        xPositions: comps.map((c: any) => (c.pose?.translation.x ?? c.position.x)).sort((a: number, b: number) => a - b),
      };
    });
    expect(patternState.count).toBe(4);
    // Positions along X: 0, 15, 30, 45 (assuming source was placed at 0)
    expect(patternState.xPositions[1]).toBeCloseTo(15, 1);
    expect(patternState.xPositions[2]).toBeCloseTo(30, 1);
    expect(patternState.xPositions[3]).toBeCloseTo(45, 1);

    // ── 5. Screenshot the shelf array ─────────────────────────────────────────
    await page.screenshot({ path: '/tmp/pattern-shelf-array.png' });

    // ── 6. Mirror the first component across YZ plane ─────────────────────────
    await page.evaluate(
      async ([srcId]: [string]) => {
        const { useAppStore } = await import('/src/store/useAppStore.ts');
        const { MirrorComponentCommand } = await import('/src/commands/MirrorComponentCommand.ts');
        const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
        const kernel = useAppStore.getState().kernel;
        if (!kernel) throw new Error('no kernel');
        const opfs = await Opfs.forNavigator();
        const asm = useAppStore.getState().activeAssembly;
        const srcComp = asm?.components.find((c: any) => c.id === srcId);
        if (!srcComp) throw new Error('src component not found');
        // Load the source part to get its kernel part ID
        const srcBytes = await opfs.read(srcComp.partPath);
        const srcKernelId = await kernel.loadFromBytes(srcBytes);
        const cmd = new MirrorComponentCommand({
          sourceInstanceId: srcId,
          sourcePartKernelId: srcKernelId,
          plane: 'yz',
          kernel,
          opfs,
        });
        await useAppStore.getState().bus.execute(cmd);
      },
      [srcCompId] as [string],
    );

    // Assert 5 components total (4 from pattern + 1 mirrored)
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 5,
      undefined, { timeout: 15_000 },
    );

    const mirrorState = await page.evaluate(
      ([srcId]: [string]) => {
        const s = (window as any).__zilventorStore?.getState();
        const comps = s?.activeAssembly?.components ?? [];
        const mirrored = comps.find((c: any) => c.id !== srcId && !comps.slice(0, 4).map((x: any) => x.id).includes(c.id));
        return {
          count: comps.length,
          mirroredX: mirrored?.pose?.translation.x ?? null,
          mirroredPartPath: mirrored?.partPath ?? null,
        };
      },
      [srcCompId] as [string],
    );
    expect(mirrorState.count).toBe(5);
    // Source at x=0, mirror at x≈0 (YZ plane through origin reflects 0→0; source poses may vary)
    // Assert the mirrored part has a "_mirror" in its path
    expect(mirrorState.mirroredPartPath).toMatch(/_mirror/);

    // ── 7. Screenshot the mirrored assembly ──────────────────────────────────
    await page.screenshot({ path: '/tmp/pattern-mirror-assembly.png' });

    // ── 8. Undo mirror → back to 4 ───────────────────────────────────────────
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      await useAppStore.getState().bus.undo();
    });
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 4,
      undefined, { timeout: 10_000 },
    );

    // ── 9. Undo pattern → back to 1 ──────────────────────────────────────────
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      await useAppStore.getState().bus.undo();
    });
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 1,
      undefined, { timeout: 10_000 },
    );

    expect(pageErrors).toHaveLength(0);
  },
);
```

2. **Run — must fail** (commands not yet fully wired):
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor && npx playwright test tests/e2e/assembly-component-pattern-mirror.spec.ts
   ```

3. **Fix any integration gaps** surfaced by the e2e run. Common gaps:
   - `NewAssemblyCommand` — is a **plain function** (not a class). The e2e harness already calls `NewAssemblyCommand({ name: 'untitled-assembly' })` directly — do not use `new NewAssemblyCommand()`.
   - `kernel.mirrorPart` Comlink bridge — the Comlink worker adapter must expose `mirrorPart`. Add it to the worker proxy registration (search for where `KernelApi` methods are registered on the Comlink worker).
   - `opfs.read` — `ImportStepAsComponentCommand.OpfsLike` and the impl `Opfs.forNavigator()` may not have a `read` method. Check `packages/kernel/src/storage/Opfs.ts` for `read` method; add it if missing, or use `loadFromBytes` + `readFile` directly.

4. **Screenshot verification** — Read back both screenshots:
   - Read `/tmp/pattern-shelf-array.png` — should show 4 cube outlines in a row.
   - Read `/tmp/pattern-mirror-assembly.png` — should show mirrored component on the opposite side.

5. **Full suite pass:**
   ```
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && npx vitest run
   cd /Users/lion/Documents/Projects/mine/zilventor/packages/kernel && npx vitest run
   ```

6. **Commit:**
   ```
   git commit -m "feat(app): e2e — component rectangular-pattern ×4 + mirror across YZ, undo both"
   ```

---

## Verification Checklist (before marking complete)

- [ ] `packages/app && npx vitest run` — all app tests green (ignore 3 known jsdom teardown errors)
- [ ] `packages/kernel && npx vitest run` — all kernel tests green
- [ ] `npx playwright test tests/e2e/assembly-component-pattern-mirror.spec.ts` — passes
- [ ] Both screenshots read back and visually inspected
- [ ] `git log --oneline -10` — 9 commits present
- [ ] No manifest version bump (stays v20)
- [ ] `tsc --noEmit` from repo root — zero type errors

## Key identifiers (verified against real files)

| Identifier | File | Notes |
|---|---|---|
| `ComponentInstance` | `packages/shared/src/types.ts:92` | `pose?: { translation: Vec3; quaternion: [x,y,z,w] }` |
| `AssemblyDocument.components` | `packages/shared/src/types.ts:103` | |
| `PatternAxis` | `packages/shared/src/types.ts:232` | `'x' \| 'y' \| 'z'` |
| `MirrorPlane` | `packages/shared/src/types.ts:249` | `'xy' \| 'yz' \| 'xz'` |
| `addComponent` / `removeComponent` | `packages/app/src/store/useAppStore.ts:662/691` | Zuststand set calls |
| `linearPatternDialogOpen` / `setLinearPatternDialogOpen` | `useAppStore.ts:162/246/579` | Pattern to clone for new flags |
| `mirrorShape(oc, shape, 'yz')` | `packages/kernel/src/occt/TransformOps.ts:88` | Negates X = S=diag(-1,1,1) |
| `writeBRep` / `readBRep` | `packages/kernel/src/occt/BRepIO.ts:16/45` | Used in saveToBytes |
| `dedupeName(base, existingNames)` | `packages/app/src/import/dedupeName.ts:8` | |
| `quatMultiply` / `quatNormalize` | `packages/kernel/src/assembly/quat.ts` | Existing quat utils |
| `Pose` type | `packages/app/src/assembly/walkers/flattenForSolver.ts:5` | `{ translation: Vec3; quaternion: [x,y,z,w] }` |
| `LinearPatternDialog` (to clone) | `packages/app/src/shell/LinearPatternDialog.tsx:1` | |
| `MirrorDialog` (to clone) | `packages/app/src/shell/MirrorDialog.tsx:1` | |
| `AssemblyTab` ribbon | `packages/app/src/shell/tabs/AssemblyTab.tsx:73` | Insert Pattern div at line ~113 |
| `registerPart` | `packages/kernel/src/api.ts:90, 446` | |
| `saveToBytes` | `packages/kernel/src/api.ts:82, 348` | Executes + packages to .zipt |
| `deletePart` | `packages/kernel/src/api.ts:77, 292` | Clears namedShape cache + parts map |
| `buildImportedPartDocument` | `packages/app/src/import/buildImportedPartDocument.ts:15` | NOT importable from kernel |
| `cube-10mm.step` fixture | `packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step` | For real-OCCT tests |

## Confirmed: NO manifest bump (stays v20)
Pattern creates only ordinary `ComponentInstance`s. Mirror creates a new `PartDocument` + ordinary instance. `AssemblyDocument.components: ComponentInstance[]` is the only persisted data structure changed — both operations use the existing `addComponent` store action which updates the assembly doc in-memory and the bus persists it via OPFS as normal. No new fields on any type.


