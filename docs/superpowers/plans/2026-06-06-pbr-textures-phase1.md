# PBR Textures — Phase 1 (3D Viewport) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render furniture panels (and imported bodies) with grain-aligned PBR maps (albedo + normal + roughness) in the 3D viewport, from a built-in texture library, with color overrides tinting the texture; solid color remains the fallback when a material has no texture.

**Architecture:** UVs are baked in the kernel tessellator by the caller (`FeatureTree`), which supplies a `UvProjection` frame derived from the `PanelFeature.grain` field. The app layer loads textures lazily via a module-level cache, builds `MeshStandardMaterial` with `.map`/`.normalMap`/`.roughnessMap` and a tint color equal to the color override (or `#ffffff`), and keys the material cache as `${textureId ?? 'none'}|${tintHex}`. 2D drawings, nesting, cut-list, and exports are unchanged.

**Tech Stack:** TypeScript, Three.js (`MeshStandardMaterial`, `TextureLoader`, `RepeatWrapping`), OpenCASCADE (kernel tessellator), Vitest (unit + integration tests), Playwright (E2E).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `packages/shared/src/types.ts` | Add `uv?: Float32Array` to `Mesh` |
| Modify | `packages/shared/src/material.ts` | Add `textureId?: string` to `MaterialEntry`, extend `isMaterialEntry` |
| Modify | `packages/shared/src/__tests__/material.spec.ts` | Tests for `textureId` validation |
| Create | `packages/shared/src/uv-projection.ts` | `UvProjection` type + `panelUvProjection()` |
| Create | `packages/shared/src/__tests__/uv-projection.spec.ts` | Unit tests for `panelUvProjection` |
| Create | `packages/shared/src/texture-def.ts` | `TextureDef` interface + `BUILTIN_TEXTURE_DEFS` + `findTextureDef()` |
| Create | `packages/shared/src/__tests__/texture-def.spec.ts` | Unit tests for TextureDef registry |
| Modify | `packages/shared/src/index.ts` | Export `uv-projection` and `texture-def` modules |
| Modify | `packages/kernel/src/occt/Tessellator.ts` | `tessellate(oc, shape, opts, projection?)` → `Mesh.uv` |
| Modify | `packages/kernel/src/occt/__tests__/Tessellator.spec.ts` | Tests for UV planar + box + back-compat |
| Modify | `packages/kernel/src/adapter/FeatureTree.ts` | Pick projection at tessellate call site (~line 892) |
| Modify | `packages/kernel/src/adapter/features/__tests__/PanelFeature.integration.spec.ts` | UV present on panel mesh; grain swap rotates U |
| Modify | `packages/app/src/viewport/SceneManager.ts` | `setMesh` gains `uv?`+`textureId?`; `ComponentLeaf` gets `textureId?`; textured material build; unified cache key |
| Modify | `packages/app/src/viewport/__tests__/SceneManager.spec.ts` | Tests for uv attribute, textured material, cache key |
| Create | `packages/app/src/viewport/textureCache.ts` | `createTextureCache()` factory: lazy load + RepeatWrapping + repeat math + dispose |
| Create | `packages/app/src/viewport/__tests__/textureCache.spec.ts` | Unit tests: caching, repeat math, dispose |
| Modify | `packages/app/src/App.tsx` | Pipe `mesh.uv` into geometry (assembly + part paths); look up `textureId` from material registry |
| Create | `packages/app/public/textures/{oak,walnut,beech,white-melamine,black-melamine,laminate-light}/` | CC0 PBR asset files (Task 11) |
| Create | `tests/e2e/pbr-textures-panel.spec.ts` | E2E: textured panel renders; grain rotates 90°; tint visible |

---

## Task 1 — Mesh.uv + MaterialEntry.textureId + validator

**No kernel OCCT needed; the `Mesh` type change is additive (no existing consumers break). The `isMaterialEntry` validator change IS TDD.**

**Files:**
- Modify: `packages/shared/src/types.ts` (line 18–22)
- Modify: `packages/shared/src/material.ts`
- Modify: `packages/shared/src/__tests__/material.spec.ts`

- [ ] **Step 1: Write the failing tests for `textureId` validation**

Add to the END of `packages/shared/src/__tests__/material.spec.ts`:

```ts
describe('isMaterialEntry — textureId field', () => {
  const base = { id: 'm1', name: 'Oak', defaultThickness: 18, color: '#8b6914' };

  it('accepts entry without textureId (field absent)', () => {
    expect(isMaterialEntry(base)).toBe(true);
  });

  it('accepts entry with a non-empty string textureId', () => {
    expect(isMaterialEntry({ ...base, textureId: 'oak' })).toBe(true);
  });

  it('rejects entry with empty string textureId', () => {
    expect(isMaterialEntry({ ...base, textureId: '' })).toBe(false);
  });

  it('rejects entry with non-string textureId', () => {
    expect(isMaterialEntry({ ...base, textureId: 42 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests — expect failures**

```bash
npx vitest run packages/shared/src/__tests__/material.spec.ts
```

Expected: the three new "rejects" cases **PASS** (because `isMaterialEntry` currently ignores unknown fields — the false-positive proves the validator needs updating), and the "accepts" cases pass. Actually: the "rejects" tests will PASS because the validator ignores unknown fields entirely and returns `true`. This means the validation logic for `textureId` is missing — correct failure mode to fix.

Wait: the "accepts entry with empty string textureId" test PASSES (validator ignores the field). The "rejects entry with empty string textureId" test FAILS because the current validator returns `true` for it. Same for non-string. Confirm the three new failing tests fail for the right reason before proceeding.

Expected output: `FAIL — expected false, received true` on the two "rejects" cases.

- [ ] **Step 3: Add `uv?` to `Mesh` in `packages/shared/src/types.ts`**

Change lines 18–22:
```ts
export type Mesh = {
  positions: Float32Array;
  indices: Uint32Array;
  boundingBox: BoundingBox;
  uv?: Float32Array;
};
```

- [ ] **Step 4: Add `textureId?` to `MaterialEntry` and extend `isMaterialEntry`**

In `packages/shared/src/material.ts`:

Add to the `MaterialEntry` interface (after `hatchSpacingMm?`):
```ts
  readonly textureId?: string;
```

In `isMaterialEntry`, add before the final `return true`:
```ts
  if (m.textureId !== undefined) {
    if (typeof m.textureId !== 'string' || m.textureId.length === 0) return false;
  }
```

- [ ] **Step 5: Run the tests — expect all to pass**

```bash
npx vitest run packages/shared/src/__tests__/material.spec.ts
```

Expected: all existing tests + 4 new `textureId` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/material.ts packages/shared/src/__tests__/material.spec.ts
git commit -m "feat(shared): add uv? to Mesh and textureId? to MaterialEntry with validator"
```

---

## Task 2 — UvProjection type + panelUvProjection() helper

**Files:**
- Create: `packages/shared/src/uv-projection.ts`
- Create: `packages/shared/src/__tests__/uv-projection.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/__tests__/uv-projection.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { panelUvProjection } from '../uv-projection';
import type { PanelFeature } from '../panel-feature';

function mkPanel(grain: 'length' | 'width' | 'none'): PanelFeature {
  return {
    kind: 'panel', id: 'p1',
    length: { kind: 'literal', value: 600 },
    width: { kind: 'literal', value: 400 },
    thickness: { kind: 'literal', value: 18 },
    thicknessFromMaterial: true,
    materialId: 'm1',
    grain,
    edgeBands: { front: null, back: null, left: null, right: null },
  };
}

describe('panelUvProjection', () => {
  it('returns mode planar for all grain values', () => {
    expect(panelUvProjection(mkPanel('length')).mode).toBe('planar');
    expect(panelUvProjection(mkPanel('width')).mode).toBe('planar');
    expect(panelUvProjection(mkPanel('none')).mode).toBe('planar');
  });

  it('grain=length: uAxis along X (length), vAxis along Y (width)', () => {
    const proj = panelUvProjection(mkPanel('length'));
    if (proj.mode !== 'planar') throw new Error('not planar');
    expect(proj.uAxis).toEqual({ x: 1, y: 0, z: 0 });
    expect(proj.vAxis).toEqual({ x: 0, y: 1, z: 0 });
    expect(proj.origin).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('grain=width: uAxis along Y (width), vAxis along X — 90° swap from length', () => {
    const proj = panelUvProjection(mkPanel('width'));
    if (proj.mode !== 'planar') throw new Error('not planar');
    expect(proj.uAxis).toEqual({ x: 0, y: 1, z: 0 });
    expect(proj.vAxis).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('grain=none: identical result to grain=length', () => {
    const noneProj = panelUvProjection(mkPanel('none'));
    const lengthProj = panelUvProjection(mkPanel('length'));
    expect(noneProj).toEqual(lengthProj);
  });
});
```

- [ ] **Step 2: Run — expect import error (file doesn't exist)**

```bash
npx vitest run packages/shared/src/__tests__/uv-projection.spec.ts
```

Expected: `FAIL — Cannot find module '../uv-projection'`

- [ ] **Step 3: Create `packages/shared/src/uv-projection.ts`**

```ts
import type { Vec3 } from './types';
import type { PanelFeature } from './panel-feature';

export type UvProjection =
  | { mode: 'planar'; origin: Vec3; uAxis: Vec3; vAxis: Vec3 }
  | { mode: 'box' };

/**
 * Compute a planar UV projection frame for a panel.
 *
 * Panel local axes (PanelOps convention, confirmed from SceneManager edge-band overlay):
 *   X = length direction, Y = width direction, Z = thickness (up)
 *   Panel origin = (0, 0, 0) in part-local coordinates.
 *
 * UV assignment:
 *   grain='length' → U runs along X (length), V along Y (width).
 *   grain='width'  → U runs along Y (width), V along X (length). 90° swap.
 *   grain='none'   → same as 'length'.
 *
 * UVs are emitted in millimeters. The texture repeat (1/physicalWidthMm,
 * 1/physicalHeightMm) is applied in the app layer via Three.js texture.repeat.
 */
export function panelUvProjection(panel: PanelFeature): UvProjection {
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  if (panel.grain === 'width') {
    return {
      mode: 'planar',
      origin,
      uAxis: { x: 0, y: 1, z: 0 },
      vAxis: { x: 1, y: 0, z: 0 },
    };
  }
  // 'length' and 'none' both map U → X, V → Y
  return {
    mode: 'planar',
    origin,
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 1, z: 0 },
  };
}
```

- [ ] **Step 4: Export from `packages/shared/src/index.ts`**

Add after the existing panel-feature export:
```ts
export type { UvProjection } from './uv-projection';
export { panelUvProjection } from './uv-projection';
```

- [ ] **Step 5: Run — expect all tests pass**

```bash
npx vitest run packages/shared/src/__tests__/uv-projection.spec.ts
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/uv-projection.ts packages/shared/src/__tests__/uv-projection.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): UvProjection type + panelUvProjection helper (grain-aware UV frame)"
```

---

## Task 3 — Tessellator: planar projection → Mesh.uv

**Real OCCT integration test. `beforeAll(loadOcct)` already present in the existing file. Adds `projection?: UvProjection` param to `tessellate`.**

**Files:**
- Modify: `packages/kernel/src/occt/__tests__/Tessellator.spec.ts`
- Modify: `packages/kernel/src/occt/Tessellator.ts`

- [ ] **Step 1: Write the failing tests**

Add to the end of `packages/kernel/src/occt/__tests__/Tessellator.spec.ts`:

```ts
import type { UvProjection } from '@zilventor/shared';

// Append inside the describe('Tessellator') block, after the existing tests:

describe('Tessellator — UV projection', () => {
  it('no projection → mesh.uv is undefined (back-compat)', () => {
    const box = makeBox(occt, 100, 100, 100);
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 });
    expect(mesh.uv).toBeUndefined();
    disposeShape(box);
  });

  it('planar projection → uv.length equals (positions.length / 3) * 2', () => {
    const box = makeBox(occt, 600, 400, 18);
    const proj: UvProjection = {
      mode: 'planar',
      origin: { x: 0, y: 0, z: 0 },
      uAxis: { x: 1, y: 0, z: 0 },
      vAxis: { x: 0, y: 1, z: 0 },
    };
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 }, proj);
    expect(mesh.uv).toBeDefined();
    expect(mesh.uv!.length).toBe((mesh.positions.length / 3) * 2);
    disposeShape(box);
  });

  it('planar projection with uAxis=X: U range spans the box X extent (~600mm)', () => {
    const box = makeBox(occt, 600, 400, 18);
    const proj: UvProjection = {
      mode: 'planar',
      origin: { x: 0, y: 0, z: 0 },
      uAxis: { x: 1, y: 0, z: 0 },
      vAxis: { x: 0, y: 1, z: 0 },
    };
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 }, proj);
    let maxU = -Infinity, minU = Infinity;
    for (let i = 0; i < mesh.uv!.length; i += 2) {
      const u = mesh.uv![i]!;
      if (u > maxU) maxU = u;
      if (u < minU) minU = u;
    }
    // The box spans 0..600 along X. After dot-product with uAxis=(1,0,0), U spans ~600.
    expect(maxU - minU).toBeGreaterThan(550);
    disposeShape(box);
  });
});
```

- [ ] **Step 2: Run — expect failures because `tessellate` doesn't accept 4th arg yet**

```bash
npx vitest run packages/kernel/src/occt/__tests__/Tessellator.spec.ts
```

Expected: TypeScript compiler or runtime error on `tessellate(occt, box, opts, proj)` — "Expected 3 arguments, but got 4."

- [ ] **Step 3: Implement planar projection in `packages/kernel/src/occt/Tessellator.ts`**

Add import at the top:
```ts
import type { UvProjection } from '@zilventor/shared';
```

Change the `tessellate` function signature (line 47):
```ts
export function tessellate(
  oc: OcctInstance,
  shape: OcctShape,
  opts: TessellateOptions,
  projection?: UvProjection,
): Mesh {
```

After the loop that builds `positions[]` and `indices[]`, before the `return` statement, add:

```ts
  let uv: Float32Array | undefined;
  if (projection) {
    if (projection.mode === 'planar') {
      const { origin, uAxis, vAxis } = projection;
      const uvArr: number[] = [];
      for (let i = 0; i < positions.length; i += 3) {
        const px = positions[i]! - origin.x;
        const py = positions[i + 1]! - origin.y;
        const pz = positions[i + 2]! - origin.z;
        uvArr.push(
          px * uAxis.x + py * uAxis.y + pz * uAxis.z,
          px * vAxis.x + py * vAxis.y + pz * vAxis.z,
        );
      }
      uv = new Float32Array(uvArr);
    }
    // 'box' mode handled in Task 4
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    boundingBox: computeBoundingBox(oc, shape),
    ...(uv !== undefined ? { uv } : {}),
  };
```

**Note:** The existing `return` statement at the end of `tessellate` (line 113–118) must be replaced with the new one above. Remove the old `return { positions, indices, boundingBox }`.

- [ ] **Step 4: Run all Tessellator tests — expect all pass**

```bash
npx vitest run packages/kernel/src/occt/__tests__/Tessellator.spec.ts
```

Expected: all existing 4 tests + 3 new UV tests PASS. Timeout 120s (OCCT init).

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/Tessellator.ts packages/kernel/src/occt/__tests__/Tessellator.spec.ts
git commit -m "feat(kernel): tessellate gains optional planar UvProjection → Mesh.uv"
```

---

## Task 4 — Tessellator: box projection (de-indexed, dominant-normal)

**Files:**
- Modify: `packages/kernel/src/occt/__tests__/Tessellator.spec.ts`
- Modify: `packages/kernel/src/occt/Tessellator.ts`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('Tessellator — UV projection')` block:

```ts
  it('box projection → every vertex has a uv pair (length equals positions / 3 * 2)', () => {
    const box = makeBox(occt, 100, 200, 300);
    const proj: UvProjection = { mode: 'box' };
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 }, proj);
    expect(mesh.uv).toBeDefined();
    expect(mesh.uv!.length).toBe((mesh.positions.length / 3) * 2);
    disposeShape(box);
  });

  it('box projection → mesh is de-indexed (vertex count = triangle count × 3)', () => {
    const box = makeBox(occt, 100, 200, 300);
    const proj: UvProjection = { mode: 'box' };
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 }, proj);
    const nVerts = mesh.positions.length / 3;
    const nTris = mesh.indices.length / 3;
    // De-indexed: each triangle references its own 3 vertices (sequential)
    expect(nVerts).toBe(nTris * 3);
    disposeShape(box);
  });
```

- [ ] **Step 2: Run — expect failures (box mode not implemented)**

```bash
npx vitest run packages/kernel/src/occt/__tests__/Tessellator.spec.ts
```

Expected: 2 new box-mode tests FAIL.

- [ ] **Step 3: Add a private `applyBoxProjection` helper and implement box mode**

Add the helper function at the BOTTOM of `packages/kernel/src/occt/Tessellator.ts` (before the closing of the file, not exported):

```ts
/**
 * De-index a mesh and assign UVs by projecting each triangle onto the plane
 * of its dominant face normal (box/tri-planar mapping).
 *
 * Returns new positions, indices, and uv arrays. The resulting mesh is
 * de-indexed: each triangle gets its own 3 vertices so per-triangle UV
 * assignment is unambiguous even for vertices shared across different faces.
 */
function applyBoxProjection(
  positions: number[],
  indices: number[],
): { positions: Float32Array; indices: Uint32Array; uv: Float32Array } {
  const newPos: number[] = [];
  const newUv: number[] = [];
  let vertexCount = 0;

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]! * 3;
    const i1 = indices[t + 1]! * 3;
    const i2 = indices[t + 2]! * 3;

    const ax = positions[i0]!, ay = positions[i0 + 1]!, az = positions[i0 + 2]!;
    const bx = positions[i1]!, by = positions[i1 + 1]!, bz = positions[i1 + 2]!;
    const cx = positions[i2]!, cy = positions[i2 + 1]!, cz = positions[i2 + 2]!;

    // Cross product (b-a) × (c-a) gives the face normal
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const anx = Math.abs(nx), any = Math.abs(ny), anz = Math.abs(nz);

    const verts: Array<[number, number, number]> = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]];
    for (const [px, py, pz] of verts) {
      newPos.push(px, py, pz);
      vertexCount++;
      // Project onto the plane perpendicular to the dominant normal axis
      if (anz >= anx && anz >= any) {
        // Z-dominant: project onto XY plane
        newUv.push(px, py);
      } else if (any >= anx) {
        // Y-dominant: project onto XZ plane
        newUv.push(px, pz);
      } else {
        // X-dominant: project onto YZ plane
        newUv.push(py, pz);
      }
    }
  }

  // Sequential indices for the de-indexed mesh: 0,1,2, 3,4,5, …
  const seqIdx = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) seqIdx[i] = i;

  return {
    positions: new Float32Array(newPos),
    indices: seqIdx,
    uv: new Float32Array(newUv),
  };
}
```

In `tessellate`, inside the `if (projection)` block, handle `'box'` mode. Replace the existing:
```ts
    // 'box' mode handled in Task 4
```
with:
```ts
    } else if (projection.mode === 'box') {
      const boxResult = applyBoxProjection(positions, indices);
      return {
        positions: boxResult.positions,
        indices: boxResult.indices,
        boundingBox: computeBoundingBox(oc, shape),
        uv: boxResult.uv,
      };
    }
```

**Important:** The early return for box mode bypasses the `new Float32Array(positions)` line below. Make sure the function returns from the `if (projection.mode === 'box')` branch before reaching the bottom return.

- [ ] **Step 4: Run — all Tessellator tests pass**

```bash
npx vitest run packages/kernel/src/occt/__tests__/Tessellator.spec.ts
```

Expected: all tests PASS (5 original + 5 UV tests).

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/Tessellator.ts packages/kernel/src/occt/__tests__/Tessellator.spec.ts
git commit -m "feat(kernel): tessellate box projection — de-indexed, per-triangle dominant-normal UV"
```

---

## Task 5 — FeatureTree selects UV projection at tessellate call site

**Adds the bridge between grain knowledge (feature layer) and the tessellator. Panel → panelUvProjection; anything else → box mode.**

**Files:**
- Modify: `packages/kernel/src/adapter/FeatureTree.ts`
- Modify: `packages/kernel/src/adapter/features/__tests__/PanelFeature.integration.spec.ts`

- [ ] **Step 1: Write failing integration tests**

Append to `packages/kernel/src/adapter/features/__tests__/PanelFeature.integration.spec.ts`, inside `describe('PanelFeature integration')`:

```ts
  it('executeTree for panel grain=length produces mesh.uv with length = (positions.length/3)*2', async () => {
    let doc = newPart('Part1');
    doc = addFeature(doc, mkPanel({ grain: 'length' }));
    const r = await executeTree(occt, doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mesh.uv).toBeDefined();
    expect(r.value.mesh.uv!.length).toBe((r.value.mesh.positions.length / 3) * 2);
    disposeShape(r.value.finalSolid);
  }, 60_000);

  it('executeTree for panel grain=width: U spans ~400mm (width axis)', async () => {
    let doc = newPart('Part1');
    // Panel: length=600mm (X), width=400mm (Y). grain=width → U runs along Y.
    doc = addFeature(doc, mkPanel({ grain: 'width' }));
    const r = await executeTree(occt, doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const uv = r.value.mesh.uv!;
    let maxU = -Infinity, minU = Infinity;
    for (let i = 0; i < uv.length; i += 2) {
      const u = uv[i]!;
      if (u > maxU) maxU = u;
      if (u < minU) minU = u;
    }
    // U runs along Y (width=400mm), so the U range should be ~400mm
    expect(maxU - minU).toBeGreaterThan(350);
    disposeShape(r.value.finalSolid);
  }, 60_000);
```

- [ ] **Step 2: Run — expect failures (mesh.uv currently undefined)**

```bash
npx vitest run packages/kernel/src/adapter/features/__tests__/PanelFeature.integration.spec.ts
```

Expected: 2 new tests FAIL: `expect(mesh.uv).toBeDefined()` fails.

- [ ] **Step 3: Implement projection selection in `packages/kernel/src/adapter/FeatureTree.ts`**

Add imports at the top of FeatureTree.ts (alongside existing shared imports):
```ts
import { panelUvProjection, type UvProjection } from '@zilventor/shared';
```

Find the tessellate call at approximately line 892:
```ts
  const mesh = tessellate(oc, finalSolid.shape, {
    linearDeflection: adaptiveLinearDeflection(computeBoundingBox(oc, finalSolid.shape)),
  });
```

Replace it with:
```ts
  // Choose UV projection: panel → grain-aligned planar; everything else → box.
  // Origin features (workAxis, workPlane, workPoint) are skipped.
  const firstUserFeature = part.featureTree.find(
    (f) => f.kind !== 'workAxis' && f.kind !== 'workPlane' && f.kind !== 'workPoint',
  );
  const uvProjection: UvProjection = firstUserFeature?.kind === 'panel'
    ? panelUvProjection(firstUserFeature)
    : { mode: 'box' };

  const mesh = tessellate(oc, finalSolid.shape, {
    linearDeflection: adaptiveLinearDeflection(computeBoundingBox(oc, finalSolid.shape)),
  }, uvProjection);
```

- [ ] **Step 4: Run — all PanelFeature integration tests pass**

```bash
npx vitest run packages/kernel/src/adapter/features/__tests__/PanelFeature.integration.spec.ts
```

Expected: all existing tests + 2 new UV tests PASS.

- [ ] **Step 5: Run the full kernel integration suite to confirm no regression**

```bash
npx vitest run packages/kernel/src
```

Expected: all kernel tests PASS (allow up to 120s for OCCT init).

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/adapter/FeatureTree.ts packages/kernel/src/adapter/features/__tests__/PanelFeature.integration.spec.ts
git commit -m "feat(kernel): FeatureTree picks panelUvProjection or box at tessellate call site"
```

---

## Task 6 — TextureDef registry + built-in defs (stub URLs)

**URLs point to files that do NOT exist yet — Task 11 places the actual assets. These are intentional stubs; the tests only verify structure.**

**Files:**
- Create: `packages/shared/src/texture-def.ts`
- Create: `packages/shared/src/__tests__/texture-def.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/shared/src/__tests__/texture-def.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUILTIN_TEXTURE_DEFS, findTextureDef } from '../texture-def';

describe('BUILTIN_TEXTURE_DEFS', () => {
  it('has at least 6 entries', () => {
    expect(BUILTIN_TEXTURE_DEFS.length).toBeGreaterThanOrEqual(6);
  });

  it('every entry has required fields with valid values', () => {
    for (const def of BUILTIN_TEXTURE_DEFS) {
      expect(typeof def.id).toBe('string');
      expect(def.id.length).toBeGreaterThan(0);
      expect(typeof def.name).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);
      expect(typeof def.albedoUrl).toBe('string');
      expect(def.albedoUrl.length).toBeGreaterThan(0);
      expect(def.physicalWidthMm).toBeGreaterThan(0);
      expect(def.physicalHeightMm).toBeGreaterThan(0);
    }
  });

  it('all ids are unique', () => {
    const ids = BUILTIN_TEXTURE_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains oak, walnut, beech, white-melamine, black-melamine, laminate-light', () => {
    const ids = new Set(BUILTIN_TEXTURE_DEFS.map((d) => d.id));
    for (const expected of ['oak', 'walnut', 'beech', 'white-melamine', 'black-melamine', 'laminate-light']) {
      expect(ids.has(expected)).toBe(true);
    }
  });
});

describe('findTextureDef', () => {
  it('returns the def for a known id', () => {
    const d = findTextureDef('oak');
    expect(d).toBeDefined();
    expect(d!.id).toBe('oak');
    expect(d!.albedoUrl).toBeTruthy();
  });

  it('returns undefined for an unknown id', () => {
    expect(findTextureDef('nonexistent-xyz')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect import failure**

```bash
npx vitest run packages/shared/src/__tests__/texture-def.spec.ts
```

Expected: `FAIL — Cannot find module '../texture-def'`

- [ ] **Step 3: Create `packages/shared/src/texture-def.ts`**

```ts
/** A PBR texture set definition. URLs are relative to the app's public root (served by Vite). */
export interface TextureDef {
  readonly id: string;
  readonly name: string;
  /** Albedo (base color) map URL. Always required. */
  readonly albedoUrl: string;
  /** Normal map URL (optional). */
  readonly normalUrl?: string;
  /** Roughness map URL (optional). */
  readonly roughnessUrl?: string;
  /** Physical width the image spans in the real world, in millimeters.
   *  Used to compute Three.js texture.repeat: repeat.x = 1 / physicalWidthMm. */
  readonly physicalWidthMm: number;
  /** Physical height the image spans in the real world, in millimeters.
   *  Used to compute Three.js texture.repeat: repeat.y = 1 / physicalHeightMm. */
  readonly physicalHeightMm: number;
}

/**
 * Built-in texture library.
 *
 * URLs are stubs until Task 11 places the actual CC0 asset files under
 * `packages/app/public/textures/`. physicalWidthMm/physicalHeightMm values
 * must be updated to match the real-world size of the sourced images.
 */
export const BUILTIN_TEXTURE_DEFS: readonly TextureDef[] = [
  {
    id: 'oak',
    name: 'Oak',
    albedoUrl: '/textures/oak/albedo.jpg',
    normalUrl: '/textures/oak/normal.png',
    roughnessUrl: '/textures/oak/roughness.png',
    physicalWidthMm: 400,
    physicalHeightMm: 400,
  },
  {
    id: 'walnut',
    name: 'Walnut',
    albedoUrl: '/textures/walnut/albedo.jpg',
    normalUrl: '/textures/walnut/normal.png',
    roughnessUrl: '/textures/walnut/roughness.png',
    physicalWidthMm: 400,
    physicalHeightMm: 400,
  },
  {
    id: 'beech',
    name: 'Beech',
    albedoUrl: '/textures/beech/albedo.jpg',
    normalUrl: '/textures/beech/normal.png',
    roughnessUrl: '/textures/beech/roughness.png',
    physicalWidthMm: 400,
    physicalHeightMm: 400,
  },
  {
    id: 'white-melamine',
    name: 'White Melamine',
    albedoUrl: '/textures/white-melamine/albedo.jpg',
    physicalWidthMm: 400,
    physicalHeightMm: 400,
  },
  {
    id: 'black-melamine',
    name: 'Black Melamine',
    albedoUrl: '/textures/black-melamine/albedo.jpg',
    physicalWidthMm: 400,
    physicalHeightMm: 400,
  },
  {
    id: 'laminate-light',
    name: 'Laminate Light',
    albedoUrl: '/textures/laminate-light/albedo.jpg',
    normalUrl: '/textures/laminate-light/normal.png',
    roughnessUrl: '/textures/laminate-light/roughness.png',
    physicalWidthMm: 400,
    physicalHeightMm: 400,
  },
];

/** Look up a TextureDef by id. Returns `undefined` if not found. */
export function findTextureDef(id: string): TextureDef | undefined {
  return BUILTIN_TEXTURE_DEFS.find((d) => d.id === id);
}
```

- [ ] **Step 4: Export from `packages/shared/src/index.ts`**

Add:
```ts
export type { TextureDef } from './texture-def';
export { BUILTIN_TEXTURE_DEFS, findTextureDef } from './texture-def';
```

- [ ] **Step 5: Run — all tests pass**

```bash
npx vitest run packages/shared/src/__tests__/texture-def.spec.ts
```

Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/texture-def.ts packages/shared/src/__tests__/texture-def.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): TextureDef registry + BUILTIN_TEXTURE_DEFS (6 stubs, real assets in T11)"
```

---

## Task 7 — App: pipe `uv` attribute into geometry (SceneManager.setMesh + App.tsx)

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Write failing tests in SceneManager.spec.ts**

Add a test helper and two new tests. First add a `currentGeometry()` test-hook to `SceneManager` (Step 3 below implements it), then write the tests now so they fail cleanly.

Append to `packages/app/src/viewport/__tests__/SceneManager.spec.ts`:

```ts
describe('SceneManager — setMesh UV', () => {
  let canvas: HTMLCanvasElement;
  let mgr: SceneManager;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    mgr = new SceneManager(canvas);
  });

  it('setMesh with uv sets the uv BufferAttribute on the geometry', () => {
    const positions = new Float32Array([0, 0, 0,  1, 0, 0,  0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const uv = new Float32Array([0, 0,  1, 0,  0, 1]);
    mgr.setMesh(positions, indices, '#ffffff', uv);
    const geom = mgr.currentGeometry();
    expect(geom).not.toBeNull();
    const uvAttr = geom!.getAttribute('uv') as THREE.BufferAttribute;
    expect(uvAttr).toBeDefined();
    expect(uvAttr.itemSize).toBe(2);
    expect(uvAttr.count).toBe(3);
  });

  it('setMesh without uv leaves the uv attribute absent', () => {
    const positions = new Float32Array([0, 0, 0,  1, 0, 0,  0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    mgr.setMesh(positions, indices, '#ffffff');
    const geom = mgr.currentGeometry();
    expect(geom!.getAttribute('uv')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect failures**

```bash
npx vitest run --config packages/app/vitest.config.ts packages/app/src/viewport/__tests__/SceneManager.spec.ts
```

Expected: TypeScript error (no `uv` param on `setMesh`) AND `mgr.currentGeometry is not a function`.

- [ ] **Step 3: Update `SceneManager.setMesh` and add `currentGeometry()` hook**

In `packages/app/src/viewport/SceneManager.ts`, change `setMesh` (line 129):

**Old signature:**
```ts
setMesh(positions: Float32Array, indices: Uint32Array, colorHex?: string): void {
```

**New signature:**
```ts
setMesh(positions: Float32Array, indices: Uint32Array, colorHex?: string, uv?: Float32Array): void {
```

Inside `setMesh`, after `g.setIndex(...)` and BEFORE `g.computeVertexNormals()`:
```ts
    if (uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
```

Add the test-hook method (after `setMesh`, before the next public method):
```ts
  /** @internal For tests only. Returns the current part geometry or null. */
  currentGeometry(): THREE.BufferGeometry | null {
    return this.current?.geometry ?? null;
  }
```

- [ ] **Step 4: Update App.tsx to pass uv to setMesh (single-part paths)**

In `packages/app/src/App.tsx`, there are three `setMesh` call sites. Update all three:

**Line ~1079–1080** (inside the `activePart` effect):
```ts
        const partHex = activePart?.color?.kind === 'hex' ? activePart.color.hex : undefined;
        viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv);
```

**Line ~1289–1291** (inside `freshPart` param-change handler):
```ts
            const partHex = freshPart?.color?.kind === 'hex' ? freshPart.color.hex : undefined;
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv);
```

**Line ~1758–1760** (inside kernel restart handler):
```ts
            const partHex = ap?.color?.kind === 'hex' ? ap.color.hex : undefined;
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv);
```

- [ ] **Step 5: Update App.tsx assembly path (lines ~3583–3587)**

In the assembly-mode geometry-building loop, change:
```ts
            const m = res.value.mesh;
            geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
            geom.setIndex(new THREE.BufferAttribute(m.indices, 1));
            geom.computeVertexNormals();
```

to:
```ts
            const m = res.value.mesh;
            geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
            geom.setIndex(new THREE.BufferAttribute(m.indices, 1));
            if (m.uv) {
              geom.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
            }
            geom.computeVertexNormals();
```

- [ ] **Step 6: Run SceneManager tests — all pass**

```bash
npx vitest run --config packages/app/vitest.config.ts packages/app/src/viewport/__tests__/SceneManager.spec.ts
```

Expected: all previous SceneManager tests + 2 new UV tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/viewport/SceneManager.ts packages/app/src/viewport/__tests__/SceneManager.spec.ts packages/app/src/App.tsx
git commit -m "feat(app): pipe mesh.uv into BufferGeometry attribute in setMesh and assembly path"
```

---

## Task 8 — App: textureCache module (lazy load + RepeatWrapping + repeat math + dispose)

**Files:**
- Create: `packages/app/src/viewport/textureCache.ts`
- Create: `packages/app/src/viewport/__tests__/textureCache.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/app/src/viewport/__tests__/textureCache.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type * as THREE from 'three';
import type { TextureDef } from '@zilventor/shared';
import { createTextureCache } from '../textureCache';

/** Minimal fake texture returned by the mock loader. */
function makeFakeTexture(url: string) {
  return {
    _url: url,
    wrapS: 0 as number,
    wrapT: 0 as number,
    repeat: { set: vi.fn<[number, number], void>() },
    dispose: vi.fn(),
  };
}

function makeMockLoader() {
  const textures = new Map<string, ReturnType<typeof makeFakeTexture>>();
  return {
    load: vi.fn((url: string) => {
      const t = makeFakeTexture(url);
      textures.set(url, t);
      return t as unknown as THREE.Texture;
    }),
    textures,
  };
}

const OAK: TextureDef = {
  id: 'oak',
  name: 'Oak',
  albedoUrl: '/textures/oak/albedo.jpg',
  normalUrl: '/textures/oak/normal.png',
  roughnessUrl: '/textures/oak/roughness.png',
  physicalWidthMm: 400,
  physicalHeightMm: 200,
};

const MELAMINE: TextureDef = {
  id: 'white-melamine',
  name: 'White Melamine',
  albedoUrl: '/textures/white-melamine/albedo.jpg',
  physicalWidthMm: 600,
  physicalHeightMm: 600,
};

describe('createTextureCache', () => {
  it('loadTextureSet returns the same object on repeated calls (caching)', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const a = cache.loadTextureSet(OAK);
    const b = cache.loadTextureSet(OAK);
    expect(a).toBe(b);
    expect(mock.load).toHaveBeenCalledTimes(3); // albedo + normal + roughness, once
  });

  it('albedo repeat is set to (1/physicalWidthMm, 1/physicalHeightMm)', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const set = cache.loadTextureSet(OAK);
    expect(set.albedo.repeat.set).toHaveBeenCalledWith(1 / 400, 1 / 200);
  });

  it('normal and roughness maps are loaded when present', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const set = cache.loadTextureSet(OAK);
    expect(set.normal).toBeDefined();
    expect(set.roughness).toBeDefined();
  });

  it('normal and roughness are absent when def has no urls', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const set = cache.loadTextureSet(MELAMINE);
    expect(set.normal).toBeUndefined();
    expect(set.roughness).toBeUndefined();
  });

  it('disposeTextures clears cache so next load creates new textures', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const a = cache.loadTextureSet(OAK);
    cache.disposeTextures();
    const b = cache.loadTextureSet(OAK);
    expect(a).not.toBe(b);
  });

  it('disposeTextures calls dispose() on each cached texture', () => {
    const mock = makeMockLoader();
    const cache = createTextureCache(() => mock as unknown as THREE.TextureLoader);
    const set = cache.loadTextureSet(OAK);
    cache.disposeTextures();
    expect((set.albedo as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled();
    expect((set.normal as { dispose: ReturnType<typeof vi.fn> } | undefined)?.dispose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect import failure**

```bash
npx vitest run --config packages/app/vitest.config.ts packages/app/src/viewport/__tests__/textureCache.spec.ts
```

Expected: `FAIL — Cannot find module '../textureCache'`

- [ ] **Step 3: Create `packages/app/src/viewport/textureCache.ts`**

```ts
import * as THREE from 'three';
import type { TextureDef } from '@zilventor/shared';

export interface CachedTextureSet {
  albedo: THREE.Texture;
  normal?: THREE.Texture;
  roughness?: THREE.Texture;
}

export interface TextureCache {
  loadTextureSet(def: TextureDef): CachedTextureSet;
  disposeTextures(): void;
}

/**
 * Create a texture cache.
 *
 * @param loaderFactory - Optional factory for the THREE.TextureLoader; defaults to
 *   `() => new THREE.TextureLoader()`. Inject a mock in tests.
 *
 * UVs baked in the kernel are in millimeters, so:
 *   texture.repeat.set(1 / physicalWidthMm, 1 / physicalHeightMm)
 * maps UV = physicalWidthMm (mm) to exactly one image tile.
 */
export function createTextureCache(
  loaderFactory?: () => THREE.TextureLoader,
): TextureCache {
  const cache = new Map<string, CachedTextureSet>();
  const loader = loaderFactory ? loaderFactory() : new THREE.TextureLoader();

  function loadMap(url: string, wMm: number, hMm: number): THREE.Texture {
    const tex = loader.load(url);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / wMm, 1 / hMm);
    return tex;
  }

  function loadTextureSet(def: TextureDef): CachedTextureSet {
    const hit = cache.get(def.id);
    if (hit) return hit;
    const { physicalWidthMm, physicalHeightMm } = def;
    const set: CachedTextureSet = {
      albedo: loadMap(def.albedoUrl, physicalWidthMm, physicalHeightMm),
      ...(def.normalUrl
        ? { normal: loadMap(def.normalUrl, physicalWidthMm, physicalHeightMm) }
        : {}),
      ...(def.roughnessUrl
        ? { roughness: loadMap(def.roughnessUrl, physicalWidthMm, physicalHeightMm) }
        : {}),
    };
    cache.set(def.id, set);
    return set;
  }

  function disposeTextures(): void {
    for (const set of cache.values()) {
      set.albedo.dispose();
      set.normal?.dispose();
      set.roughness?.dispose();
    }
    cache.clear();
  }

  return { loadTextureSet, disposeTextures };
}

/** Module-level singleton used by SceneManager. */
export const globalTextureCache: TextureCache = createTextureCache();
```

- [ ] **Step 4: Run — all tests pass**

```bash
npx vitest run --config packages/app/vitest.config.ts packages/app/src/viewport/__tests__/textureCache.spec.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/viewport/textureCache.ts packages/app/src/viewport/__tests__/textureCache.spec.ts
git commit -m "feat(app): textureCache module — lazy PBR map loading, RepeatWrapping, repeat math, dispose"
```

---

## Task 9 — SceneManager: textured material build + unified cache key

**Adds `ComponentLeaf.textureId?`, extends `setComponentMeshes` and `setMesh` to build textured `MeshStandardMaterial`, and changes the cache key to `${textureId ?? 'none'}|${tintHex}`.**

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`

- [ ] **Step 1: Write failing tests in a NEW test file**

**IMPORTANT:** Create a SEPARATE new test file `packages/app/src/viewport/__tests__/SceneManager.textures.spec.ts` (do NOT append to the existing `SceneManager.spec.ts`). This avoids `vi.mock` hoisting contaminating unrelated tests in the existing file — `vi.mock` hoists to module top and applies file-wide.

Create `packages/app/src/viewport/__tests__/SceneManager.textures.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { pathKey } from '@zilventor/shared';
import type { ComponentLeaf } from '../SceneManager';
import { SceneManager } from '../SceneManager';

// Minimal vi.mock for textureCache so tests don't need real files
vi.mock('../textureCache', () => {
  const fakeSet = {
    albedo: { wrapS: 0, wrapT: 0, repeat: { set: () => {} }, dispose: () => {} },
    normal: { wrapS: 0, wrapT: 0, repeat: { set: () => {} }, dispose: () => {} },
    roughness: { wrapS: 0, wrapT: 0, repeat: { set: () => {} }, dispose: () => {} },
  };
  return {
    globalTextureCache: {
      loadTextureSet: () => fakeSet,
      disposeTextures: () => {},
    },
  };
});

// Mock findTextureDef in @zilventor/shared — note: vi.mock hoists to module top
// and applies to this ENTIRE FILE. The spread `...actual` preserves all real
// exports so other imports in this file (e.g. pathKey) continue to work.
vi.mock('@zilventor/shared', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    findTextureDef: (id: string) =>
      id === 'oak'
        ? { id: 'oak', name: 'Oak', albedoUrl: '/textures/oak/albedo.jpg', physicalWidthMm: 400, physicalHeightMm: 400 }
        : undefined,
  };
});

const identityPose = {
  translation: { x: 0, y: 0, z: 0 },
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
};

function leaf(opts: Partial<ComponentLeaf> & { componentPath: ReadonlyArray<string> }): ComponentLeaf {
  return {
    kind: 'leaf',
    componentPath: opts.componentPath,
    partPath: opts.partPath ?? 'p.zipt',
    worldPose: opts.worldPose ?? identityPose,
    visible: opts.visible ?? true,
    ...(opts.materialColor !== undefined ? { materialColor: opts.materialColor } : {}),
    ...(opts.textureId !== undefined ? { textureId: opts.textureId } : {}),
  };
}

describe('SceneManager — textured component materials', () => {
  let canvas: HTMLCanvasElement;
  let mgr: SceneManager;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    mgr = new SceneManager(canvas);
  });

  it('two leaves with the same textureId + materialColor share one material instance', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'], textureId: 'oak', materialColor: '#8b6914' }),
      leaf({ componentPath: ['C2'], partPath: 'p.zipt', textureId: 'oak', materialColor: '#8b6914' }),
    ]);
    const m1 = (mgr.getComponentMesh(pathKey(['C1'])) as THREE.Mesh | undefined)?.material;
    const m2 = (mgr.getComponentMesh(pathKey(['C2'])) as THREE.Mesh | undefined)?.material;
    expect(m1).toBeDefined();
    expect(m1).toBe(m2);
  });

  it('different textureId + same tint produces different materials', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'], textureId: 'oak', materialColor: '#8b6914' }),
      leaf({ componentPath: ['C2'], partPath: 'p.zipt', materialColor: '#8b6914' }), // no textureId
    ]);
    const m1 = (mgr.getComponentMesh(pathKey(['C1'])) as THREE.Mesh | undefined)?.material;
    const m2 = (mgr.getComponentMesh(pathKey(['C2'])) as THREE.Mesh | undefined)?.material;
    expect(m1).not.toBe(m2);
  });
});
```

- [ ] **Step 2: Run — expect TypeScript/runtime failures**

```bash
npx vitest run --config packages/app/vitest.config.ts packages/app/src/viewport/__tests__/SceneManager.textures.spec.ts
```

Expected: `textureId` is not a property of `ComponentLeaf`; tests fail.

- [ ] **Step 3: Add `textureId?` to `ComponentLeaf` and update SceneManager material build**

In `packages/app/src/viewport/SceneManager.ts`:

**Add `textureId?` to `ComponentLeaf`** (near line 14):
```ts
export type ComponentLeaf = {
  kind: 'leaf' | 'placeholder';
  componentPath: ComponentPath;
  partPath: string;
  worldPose: { translation: Vec3; quaternion: [number, number, number, number] };
  materialColor?: string;
  textureId?: string;
  visible: boolean;
};
```

**In the EXISTING `@zilventor/shared` import** (currently at ~line 4), ADD `findTextureDef` to the existing named-import list — do NOT add a second import statement. The existing import looks like:
```ts
import { pathKey, type ComponentPath, type ComponentPathKey, type MaterialEntry, type PanelEdgeKey } from '@zilventor/shared';
```
Change it to:
```ts
import { pathKey, findTextureDef, type ComponentPath, type ComponentPathKey, type MaterialEntry, type PanelEdgeKey } from '@zilventor/shared';
```

Also add the textureCache import after the shared import:
```ts
import { globalTextureCache } from './textureCache';
```

**Add `preserveDrawingBuffer: true`** to the `WebGLRenderer` constructor in `SceneManager.ts` (line ~96). Change:
```ts
this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
```
to:
```ts
this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
```

This is done HERE (Task 9 Step 3) — do NOT add it again in Task 12.

**Add private helper** `buildTexturedMaterial` inside the class body (before `setComponentMeshes`):
```ts
  private buildMaterial(textureId: string | undefined, tintHex: string): THREE.MeshStandardMaterial {
    if (textureId) {
      const def = findTextureDef(textureId);
      if (def) {
        const texSet = globalTextureCache.loadTextureSet(def);
        return new THREE.MeshStandardMaterial({
          map: texSet.albedo,
          normalMap: texSet.normal,
          roughnessMap: texSet.roughness,
          color: tintHex,
          side: THREE.DoubleSide,
        });
      }
    }
    return new THREE.MeshStandardMaterial({ color: tintHex, side: THREE.DoubleSide });
  }
```

**Update `setComponentMeshes`** material selection (lines ~347–355). Replace:
```ts
      if (leaf.materialColor) {
        let mat = this.colorMaterials.get(leaf.materialColor);
        if (!mat) {
          mat = new THREE.MeshStandardMaterial({ color: leaf.materialColor, side: THREE.DoubleSide });
          this.colorMaterials.set(leaf.materialColor, mat);
        }
        mesh.material = mat;
      } else {
        mesh.material = this.componentMaterial;
      }
```

with:
```ts
      if (leaf.materialColor || leaf.textureId) {
        const tintHex = leaf.materialColor ?? '#ffffff';
        const cacheKey = `${leaf.textureId ?? 'none'}|${tintHex}`;
        let mat = this.colorMaterials.get(cacheKey);
        if (!mat) {
          mat = this.buildMaterial(leaf.textureId, tintHex);
          this.colorMaterials.set(cacheKey, mat);
        }
        mesh.material = mat;
      } else {
        mesh.material = this.componentMaterial;
      }
```

**Update `setMesh`** to also accept `textureId?` (5th param, after `uv?`):

Change signature to:
```ts
setMesh(positions: Float32Array, indices: Uint32Array, colorHex?: string, uv?: Float32Array, textureId?: string): void {
```

Inside `setMesh`, replace the material creation line:
```ts
    const m = new THREE.MeshStandardMaterial({ color: colorHex ?? 0xc8c8c8, flatShading: true, side: THREE.DoubleSide });
```

with:
```ts
    const m = textureId
      ? this.buildMaterial(textureId, colorHex ?? '#ffffff')
      : new THREE.MeshStandardMaterial({ color: colorHex ?? 0xc8c8c8, flatShading: true, side: THREE.DoubleSide });
```

- [ ] **Step 4: Run — all SceneManager texture tests pass**

```bash
npx vitest run --config packages/app/vitest.config.ts packages/app/src/viewport/__tests__/SceneManager.textures.spec.ts
npx vitest run --config packages/app/vitest.config.ts packages/app/src/viewport/__tests__/SceneManager.spec.ts
```

Expected: both files PASS. The existing `SceneManager.spec.ts` tests must also remain green (no mock contamination from the new file).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/viewport/SceneManager.ts packages/app/src/viewport/__tests__/SceneManager.textures.spec.ts
git commit -m "feat(app): SceneManager textured MeshStandardMaterial + unified cache key textureId|tintHex"
```

---

## Task 10 — App.tsx: look up textureId and pass to SceneManager

**Connects the material registry to the renderer for both part-mode and assembly-mode paths. No new tests (integration tested via E2E in Task 12), but existing tests must remain green.**

**Non-TDD exception reason: App.tsx wiring is pure plumbing glue between two already-tested systems (FeatureTree UV output and SceneManager material build). The E2E in Task 12 provides the integration gate.**

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Part-mode — look up textureId from activePart.materials at each setMesh call site**

There are three `setMesh` call sites. Update each one by extracting the panel's textureId from the part's material registry.

**Site 1 (~line 1079–1080)** — inside the `activePart` effect. The local variable for the part is `activePart`.

Replace:
```ts
        const partHex = activePart?.color?.kind === 'hex' ? activePart.color.hex : undefined;
        viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv);
```

with:
```ts
        const partHex = activePart?.color?.kind === 'hex' ? activePart.color.hex : undefined;
        const panelFeat = activePart?.featureTree.find((f) => f.kind === 'panel') as PanelFeature | undefined;
        const panelMat = panelFeat ? activePart?.materials.find((m) => m.id === panelFeat.materialId) : undefined;
        viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv, panelMat?.textureId);
```

**Site 2 (~line 1289–1291)** — inside the param-change handler. Local variable: `freshPart`.

Replace:
```ts
            const partHex = freshPart?.color?.kind === 'hex' ? freshPart.color.hex : undefined;
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv);
```

with:
```ts
            const partHex = freshPart?.color?.kind === 'hex' ? freshPart.color.hex : undefined;
            const panelFeat = freshPart?.featureTree.find((f) => f.kind === 'panel') as PanelFeature | undefined;
            const panelMat = panelFeat ? freshPart?.materials.find((m) => m.id === panelFeat.materialId) : undefined;
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv, panelMat?.textureId);
```

**Site 3 (~line 1758–1760)** — inside kernel restart handler. Local variable: `ap`.

Replace:
```ts
            const partHex = ap?.color?.kind === 'hex' ? ap.color.hex : undefined;
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv);
```

with:
```ts
            const partHex = ap?.color?.kind === 'hex' ? ap.color.hex : undefined;
            const panelFeat = ap?.featureTree.find((f) => f.kind === 'panel') as PanelFeature | undefined;
            const panelMat = panelFeat ? ap?.materials.find((m) => m.id === panelFeat.materialId) : undefined;
            viewportRef.current.setMesh(res.value.mesh.positions, res.value.mesh.indices, partHex, res.value.mesh.uv, panelMat?.textureId);
```

- [ ] **Step 2: Assembly-mode — look up textureId per partPath and pass to ComponentLeaf**

In App.tsx, the assembly-mode geometry-loading loop starts at ~line 3573. Add a `partTextureIds` map BEFORE the `for (const partPath of uniquePartPaths)` loop:

```ts
      const partTextureIds = new Map<string, string | undefined>();
```

Inside the `for` loop, AFTER `const res = await kernel.execute(partId)`, add:
```ts
            const partDoc = await kernel.getPart(partId);
            if (partDoc) {
              const panelFeat = partDoc.featureTree.find((f) => f.kind === 'panel') as PanelFeature | undefined;
              const partMat = panelFeat ? partDoc.materials.find((m) => m.id === panelFeat.materialId) : undefined;
              partTextureIds.set(partPath, partMat?.textureId);
            }
```

In the `componentLeaves` map (~line 3597–3617), update the return object to include `textureId`:

```ts
        return {
          kind: l.kind,
          componentPath: l.componentPath,
          partPath: l.partPath,
          worldPose,
          ...(materialColor !== undefined ? { materialColor } : {}),
          ...(partTextureIds.get(l.partPath) !== undefined ? { textureId: partTextureIds.get(l.partPath)! } : {}),
          visible: true,
        };
```

- [ ] **Step 3: Run existing app tests to confirm no regression**

```bash
npx vitest run --config packages/app/vitest.config.ts packages/app/src
```

Expected: all app unit tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/App.tsx
git commit -m "feat(app): wire textureId from material registry to setMesh and ComponentLeaf (part + assembly)"
```

---

## Task 11 — Asset sourcing (CC0 PBR sets)

**Non-TDD — no code logic to test in isolation. This task places binary image assets. The E2E (Task 12) is the verification gate.**

**Non-TDD exception reason: These are binary image assets, not code. There is no meaningful unit test for "image file exists and looks like wood grain."**

**Files:**
- Create: `packages/app/public/textures/oak/albedo.jpg` + `normal.png` + `roughness.png`
- Create: `packages/app/public/textures/walnut/albedo.jpg` + `normal.png` + `roughness.png`
- Create: `packages/app/public/textures/beech/albedo.jpg` + `normal.png` + `roughness.png`
- Create: `packages/app/public/textures/white-melamine/albedo.jpg`
- Create: `packages/app/public/textures/black-melamine/albedo.jpg`
- Create: `packages/app/public/textures/laminate-light/albedo.jpg` + `normal.png` + `roughness.png`
- Update: `packages/shared/src/texture-def.ts` (update `physicalWidthMm`/`physicalHeightMm` to match actual sourced images)

- [ ] **Step 1: Source genuine CC0 PBR texture sets**

**MANDATORY:** Only use real CC0-licensed assets. Recommended sources:
- **Poly Haven** (polyhaven.com/textures) — CC0, high quality, wood and fabric textures.
- **AmbientCG** (ambientcg.com) — CC0, includes wood grain, melamine, laminate.
- **CC0Textures** (cc0textures.com) — CC0 library.

For each slot, download an albedo (JPEG) + normal (PNG) + roughness (PNG) map. Target 1K or 2K resolution. Wood slots need clear grain direction visible in the albedo.

**If a slot cannot be filled with a genuine CC0 asset: STOP. Do NOT fabricate, approximate, or use a solid-color placeholder. Ask the user how to proceed.**

- [ ] **Step 2: Place files**

Create the directory structure and copy files:
```bash
mkdir -p packages/app/public/textures/oak
mkdir -p packages/app/public/textures/walnut
mkdir -p packages/app/public/textures/beech
mkdir -p packages/app/public/textures/white-melamine
mkdir -p packages/app/public/textures/black-melamine
mkdir -p packages/app/public/textures/laminate-light
# Then copy or download albedo.jpg, normal.png, roughness.png into each subfolder.
```

- [ ] **Step 3: Update `BUILTIN_TEXTURE_DEFS` with real physicalWidthMm/physicalHeightMm**

Open `packages/shared/src/texture-def.ts`. For each TextureDef, update `physicalWidthMm` and `physicalHeightMm` to match the real-world physical size the image is designed to represent (typically documented by the asset source). For example, a Poly Haven oak texture might represent a 1m×1m (1000mm×1000mm) surface.

Update the values in the file accordingly. All six entries must have accurate physical dimensions.

- [ ] **Step 4: Verify the dev server serves the textures**

Start the dev server:
```bash
pnpm dev
```

Open a browser tab to `http://localhost:5173/textures/oak/albedo.jpg` — confirm the image loads (not a 404).

- [ ] **Step 5: Commit**

```bash
git add packages/app/public/textures/ packages/shared/src/texture-def.ts
git commit -m "feat(app): add CC0 PBR texture assets (oak, walnut, beech, melamines, laminate)"
```

---

## Task 12 — E2E: textured panel renders + grain direction + tint

**Files:**
- Create: `tests/e2e/pbr-textures-panel.spec.ts`

- [ ] **Step 1: Write the E2E test**

Create `tests/e2e/pbr-textures-panel.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';
import type { PanelFeature, MaterialEntry } from '@zilventor/shared';

/**
 * Bus + store accessor pattern — matches existing e2e tests in
 * tests/e2e/drawing/material-hatch-pattern.spec.ts.
 */
type ZilventorStore = {
  getState(): {
    activePart: { id: string; materials: Array<MaterialEntry>; featureTree: unknown[] } | null;
    bus: { execute(c: unknown): Promise<unknown> };
  };
};

test.describe('PBR Textures — Phase 1', () => {
  test.setTimeout(180_000);

  test('textured oak panel renders with non-uniform pixels (texture visible, not flat color)', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);

    // 1. Create a new part
    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'New Part' }).click();
    await expect(page.getByText('Part1')).toBeVisible();

    // 2. Add an oak material (textureId='oak') and a 600×400×18 panel via the bus.
    //    AddMaterialCommand does not accept textureId directly (its opts type is a
    //    subset of MaterialEntry), so: (a) add the material, then (b) set textureId
    //    via EditMaterialCommand which accepts Partial<Omit<MaterialEntry,'id'>>.
    const matId = await page.evaluate(async () => {
      const { AddMaterialCommand } = await import('/src/commands/AddMaterialCommand.ts');
      const { EditMaterialCommand } = await import('/src/commands/EditMaterialCommand.ts');

      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      const bus = store.getState().bus;

      await bus.execute(new AddMaterialCommand({ name: 'Oak Wood', defaultThickness: 18, color: '#8b6914' }));
      const mat = store.getState().activePart!.materials.find((m) => m.name === 'Oak Wood');
      if (!mat) throw new Error('material not found after AddMaterialCommand');

      await bus.execute(new EditMaterialCommand(mat.id, { textureId: 'oak' }));
      return mat.id;
    });
    expect(matId).toBeTruthy();

    // 3. Add a panel feature using that material with grain=length.
    await page.evaluate(async (materialId: string) => {
      const { AddPanelFeatureCommand } = await import('/src/commands/AddPanelFeatureCommand.ts');
      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      const bus = store.getState().bus;
      const panel: PanelFeature = {
        kind: 'panel', id: 'pf-pbr-e2e',
        length: { kind: 'literal', value: 600 },
        width: { kind: 'literal', value: 400 },
        thickness: { kind: 'literal', value: 18 },
        thicknessFromMaterial: false,
        materialId,
        grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
      };
      await bus.execute(new AddPanelFeatureCommand(panel));
    }, matId);

    // 4. Wait for the mesh to appear in the viewport.
    await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 60_000 });

    // 5. Screenshot the viewport (grain=length).
    await page.screenshot({ path: '/tmp/pbr-textures-panel-length.png' });

    // 6. Pixel-variance check — texture produces non-uniform pixels.
    //    Requires preserveDrawingBuffer=true on the WebGLRenderer (see implementation note).
    const pixelVariance = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return -1; // no canvas — treat as unavailable
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) return -1; // WebGL not available in this context
      const w = Math.min(canvas.width, 100);
      const h = Math.min(canvas.height, 100);
      const buf = new Uint8Array(w * h * 4);
      (gl as WebGLRenderingContext).readPixels(
        Math.floor(canvas.width / 2 - w / 2), Math.floor(canvas.height / 2 - h / 2),
        w, h,
        (gl as WebGLRenderingContext).RGBA,
        (gl as WebGLRenderingContext).UNSIGNED_BYTE,
        buf,
      );
      const reds = Array.from({ length: w * h }, (_, i) => buf[i * 4]!);
      const mean = reds.reduce((a, b) => a + b, 0) / reds.length;
      return reds.reduce((a, b) => a + (b - mean) ** 2, 0) / reds.length;
    });

    // First assert WebGL readback was available — fail loudly if not, rather than
    // silently bypassing the texture check (pixelVariance === -1 means the WebGL
    // context or readPixels was unavailable, which means preserveDrawingBuffer was
    // not set or the canvas had no WebGL context).
    expect(pixelVariance, 'WebGL readPixels unavailable — check preserveDrawingBuffer:true in SceneManager').not.toBe(-1);

    // Variance > 25 → std-dev > 5 → visible texture, not a solid flat color.
    expect(pixelVariance, 'pixel variance must be > 25 to confirm visible texture').toBeGreaterThan(25);
  });

  test('grain=width rotates texture 90° vs grain=length — screenshot read-back', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));

    await page.goto('/');
    await waitForKernelReady(page);

    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'New Part' }).click();
    await expect(page.getByText('Part1')).toBeVisible();

    const matId = await page.evaluate(async () => {
      const { AddMaterialCommand } = await import('/src/commands/AddMaterialCommand.ts');
      const { EditMaterialCommand } = await import('/src/commands/EditMaterialCommand.ts');
      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      const bus = store.getState().bus;
      await bus.execute(new AddMaterialCommand({ name: 'Oak Wood', defaultThickness: 18, color: '#8b6914' }));
      const mat = store.getState().activePart!.materials.find((m) => m.name === 'Oak Wood');
      if (!mat) throw new Error('material not found');
      await bus.execute(new EditMaterialCommand(mat.id, { textureId: 'oak' }));
      return mat.id;
    });

    await page.evaluate(async (materialId: string) => {
      const { AddPanelFeatureCommand } = await import('/src/commands/AddPanelFeatureCommand.ts');
      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      const bus = store.getState().bus;
      const panel: PanelFeature = {
        kind: 'panel', id: 'pf-pbr-width-e2e',
        length: { kind: 'literal', value: 600 },
        width: { kind: 'literal', value: 400 },
        thickness: { kind: 'literal', value: 18 },
        thicknessFromMaterial: false,
        materialId,
        grain: 'width',
        edgeBands: { front: null, back: null, left: null, right: null },
      };
      await bus.execute(new AddPanelFeatureCommand(panel));
    }, matId);

    await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 60_000 });
    await page.screenshot({ path: '/tmp/pbr-textures-panel-width.png' });

    // The grain=width screenshot is the read-back gate. Visual confirmation:
    // grain=width panel should show the oak grain running perpendicular to grain=length.
    // Automated check: no error dialogs.
    expect(await page.locator('[data-testid="error-dialog"]').count()).toBe(0);
  });
});
```

**IMPORTANT implementation note for the pixel-variance test:**  
The WebGL renderer must be created with `preserveDrawingBuffer: true` for `gl.readPixels` to work after the frame has been presented. This change was already applied in **Task 9 Step 3** — do NOT re-edit `SceneManager.ts` here. If Task 9 has been completed correctly, the flag is already set and `gl.readPixels` will work.

- [ ] **Step 2: Verify the exact bus/command import paths exist**

```bash
find /Users/lion/Documents/Projects/mine/zilventor/packages/app/src/commands -name "bus.ts" -o -name "SetMaterialsCommand.ts" -o -name "AddFeatureCommand.ts" 2>/dev/null | head -10
```

If any of these paths differ, update the `import()` paths in the test to match actual file locations.

- [ ] **Step 3: Run E2E test**

```bash
npx playwright test tests/e2e/pbr-textures-panel.spec.ts --reporter=dot
```

Expected: both tests PASS. The first test should find pixel variance > 25 (confirming visible texture). If textures have not been placed yet (Task 11 not done), the test may pass with variance = 0 but no error — acceptable only as a temporary state while assets are being sourced.

- [ ] **Step 4: Read back the screenshots**

Use the Read tool to view:
- `/tmp/pbr-textures-panel-length.png`
- `/tmp/pbr-textures-panel-width.png`

Confirm visually:
1. The viewport shows a panel with visible wood grain texture (not a solid flat color).
2. The grain pattern in the `width` screenshot is rotated 90° compared to the `length` screenshot.

**Do not mark Task 12 done until both screenshots have been read back and visually confirmed.**

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/pbr-textures-panel.spec.ts
git commit -m "test(e2e): PBR textured panel renders with visible grain; grain=width rotates 90°"
```

---

## Implementation Notes

### WebGL preserveDrawingBuffer
The pixel-variance check in Task 12 requires `preserveDrawingBuffer: true` on the `WebGLRenderer`. This option is added in **Task 9 Step 3** when `SceneManager.ts` is already being edited. Task 12 does NOT re-edit `SceneManager.ts`. This has a minor GPU memory cost (the back-buffer is not automatically freed after present), acceptable for a dev/test build.

### Box projection vertex count
Box projection de-indexes the mesh — every shared vertex is duplicated per triangle. A 44k-vertex imported STEP that normally has ~130k triangles will expand to ~390k vertices in box mode. This is acceptable per the spec ("for imported parts; grain has no meaning there") but flag if any STEP fixture takes unusually long to render after this change.

### `kernel.getPart` call in assembly loop
Task 10 adds `kernel.getPart(partId)` after `kernel.execute(partId)` for each unique part in the assembly path. This is a read-only call returning the cached PartDocument. It should be negligible overhead, but if it becomes a bottleneck on large assemblies, the textureId could be cached alongside the BufferGeometry in a future optimization.

### Asset sourcing (Task 11)
If a texture slot cannot be filled with a genuine CC0 asset — **stop and ask the user**. Never fabricate, approximate, or ship a placeholder file. The E2E test will pass with stub URLs (the Three.js TextureLoader will silently fail on 404 and apply a default texture), which makes it easy to accidentally skip this task. Read the screenshots in Task 12 Step 4 to confirm textures are actually visible.

### Grain-direction visual verification
The 90° grain rotation test is primarily a visual check (screenshots read back in Task 12). There is no programmatic assertion that the two screenshots differ in grain angle — only that both render without errors and have non-zero pixel variance. A future enhancement could use a structural similarity check (SSIM) or Fourier analysis, but that is out of scope for Phase 1.
