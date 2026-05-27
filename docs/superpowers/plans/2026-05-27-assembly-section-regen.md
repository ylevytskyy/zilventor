# Assembly Section Cut — Pose-Aware, Components-Based — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assembly-sourced section views cut correctly (pose-aware, per-component) at BOTH create and Regenerate, for all three modes (full / half / stepped), replacing the pose-blind all-cache dump and the regen "not yet supported" bail.

**Architecture:** Feed the existing tested per-component cut a flat `components: {partId, pose}[]` list (the `activeDrawingSourceComponents` slot, exactly as assembly *projection* does). The only new algorithm is an OCCT pose→shape transform; the rest is a small kernel-module refactor (factor a leaves-based core) + two new components-based kernel api methods + thin app wrappers + swapping two call-sites.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes` ON), OCCT WASM (opencascade.js), Comlink kernel worker, Vitest (kernel occt unit + app mocked-kernel unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-05-27-assembly-section-regen-design.md`

**No manifest bump** (read-only geometry; `activeDrawingSourceComponents` is runtime-only).

**Key conventions / facts (verified against code):**
- `Comlink.expose(api, …)` (`packages/kernel/src/worker.ts:5`) exposes the whole api object → new methods auto-cross the boundary; no allowlist to update.
- App cut wrappers return `CutResult = { ok: true; compound: ProjectorInput; faceTags: FaceTagMap } | { ok: false; reason }` (`packages/app/src/kernel/cutBySectionPlane.ts:12`); kernel api returns `CutSectionResult = { ok:true; projectorInput; faceTags } | …` (`api.ts:52`). The app wrapper maps `projectorInput → compound`.
- `AssemblyComponentInput = { partId: string; pose: { translation:{x,y,z}; quaternion: readonly [number,number,number,number] } }` (`packages/kernel/src/adapter/drawing/getProjectorInput.ts:7`). Store slot `activeDrawingSourceComponents: AssemblyComponentInput[] | null` (`useAppStore.ts:117`).
- App unit tests mock `../kernel/cutBySectionPlane` via `vi.mock` (stated in that file's header). Kernel-module section tests init OCCT directly (`packages/kernel/src/section/cutBySectionPlane.spec.ts`).
- Bindings: `gp_Trsf_1`, `gp_Trsf.SetValues`, `BRepBuilderAPI_Transform_2(shape, trsf, copy)` all exist. Use `SetValues` (quaternion→matrix in JS) — binding-safe, single call.
- Run kernel tests: `pnpm --filter @zilventor/kernel exec vitest run <path>`. App: `pnpm --filter app exec vitest run <path-relative-to-packages/app>`. E2E from ROOT: `pnpm test:e2e -- tests/e2e/drawing/<spec> --project=chromium`.

---

## File Structure

**Modified:**
- `packages/kernel/src/occt/TransformOps.ts` — add `transformShapeByPose`.
- `packages/kernel/src/section/cutBySectionPlane.ts` — factor `cutLeavesBySectionPlane` + `cutLeavesByStepSegments` cores; existing `cutAssemblyBySectionPlane`/`cutAssemblyByStepSegments(asm,…)` delegate.
- `packages/kernel/src/api.ts` — add `cutAssemblyComponentsBySectionPlane` + `cutAssemblyComponentsByStepSegments` (impl + `KernelApi` type); import `transformShapeByPose`.
- `packages/app/src/kernel/cutBySectionPlane.ts` — add `cutAssemblyComponentsBySectionPlane` + `cutAssemblyComponentsByStepSegments` wrappers.
- `packages/app/src/commands/AddSectionViewCommand.ts` — assembly branch (full/half + stepped) reads `activeDrawingSourceComponents` → new components cut.
- `packages/app/src/drawing/regenerateSectionView.ts` — replace assembly bail with components cut (all 3 modes).

**Created:**
- `packages/kernel/src/occt/__tests__/TransformOps.spec.ts` (if no existing TransformOps spec — else append).
- `tests/e2e/drawing/T-6-28-assembly-section-regen.spec.ts`.
- Perf probe under `tests/perf/` (e.g. `assembly-section-cut.perf.spec.ts`).

**Pose type alias (used throughout):** `type Pose = AssemblyComponentInput['pose']`.

---

### Task 1: `transformShapeByPose` — pose a cached OCCT shape

**Files:**
- Modify: `packages/kernel/src/occt/TransformOps.ts`
- Test: `packages/kernel/src/occt/__tests__/TransformOps.spec.ts` (create; if a TransformOps spec already exists elsewhere, append there)

- [ ] **Step 1: Write the failing test**

Create `packages/kernel/src/occt/__tests__/TransformOps.spec.ts`, reusing the real SolidOps helpers (`makeBox`, `computeBoundingBox` → `[xmin,ymin,zmin,xmax,ymax,zmax]`, `disposeShape`) and the real loader `loadOcct`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../occtLoader';
import { makeBox, computeBoundingBox, disposeShape } from '../SolidOps';
import { transformShapeByPose } from '../TransformOps';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); });

describe('transformShapeByPose', () => {
  it('translates a box by the pose translation (identity rotation)', () => {
    const box = makeBox(oc, 10, 10, 10);
    const posed = transformShapeByPose(oc, box, {
      translation: { x: 100, y: 0, z: 0 },
      quaternion: [0, 0, 0, 1],
    });
    expect(computeBoundingBox(oc, posed)[0]).toBeCloseTo(100, 3); // xmin moved to 100
    expect(computeBoundingBox(oc, box)[0]).toBeCloseTo(0, 3);     // source unchanged (copy=true)
    disposeShape(posed);
    disposeShape(box);
  });

  it('rotates a box 90° about Z so it occupies x∈[-10,0], y∈[0,10]', () => {
    const box = makeBox(oc, 10, 10, 10);
    const s = Math.SQRT1_2; // 90° about Z → quaternion [0,0,sin45,cos45]
    const posed = transformShapeByPose(oc, box, {
      translation: { x: 0, y: 0, z: 0 },
      quaternion: [0, 0, s, s],
    });
    const [xmin, ymin] = computeBoundingBox(oc, posed);
    expect(xmin).toBeCloseTo(-10, 2);
    expect(ymin).toBeCloseTo(0, 2);
    disposeShape(posed);
    disposeShape(box);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/kernel exec vitest run src/occt/__tests__/TransformOps.spec.ts`
Expected: FAIL — `transformShapeByPose is not a function` (not exported yet).

- [ ] **Step 3: Write minimal implementation**

Append to `packages/kernel/src/occt/TransformOps.ts`:

```typescript
/**
 * Return a new shape that is `shape` posed by `pose` (rotation then translation).
 * Builds a gp_Trsf via SetValues from the quaternion-derived 3×3 rotation matrix
 * + translation column, then BRepBuilderAPI_Transform_2(copy=true).
 * The caller owns the returned shape and must disposeShape it.
 */
export function transformShapeByPose(
  oc: OcctInstance,
  shape: OcctShape,
  pose: {
    translation: { x: number; y: number; z: number };
    quaternion: readonly [number, number, number, number];
  },
): OcctShape {
  const [x, y, z, w] = pose.quaternion;
  const { x: tx, y: ty, z: tz } = pose.translation;
  // Quaternion [x,y,z,w] → row-major 3×3 rotation matrix.
  const r00 = 1 - 2 * (y * y + z * z);
  const r01 = 2 * (x * y - w * z);
  const r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y);
  const r21 = 2 * (y * z + w * x);
  const r22 = 1 - 2 * (x * x + y * y);

  const trsf = new oc.gp_Trsf_1();
  (trsf as { SetValues: (...a: number[]) => void }).SetValues(
    r00, r01, r02, tx,
    r10, r11, r12, ty,
    r20, r21, r22, tz,
  );
  const transform = new oc.BRepBuilderAPI_Transform_2(
    shape.handle as never,
    trsf as never,
    true as never,
  );
  const out = (transform as { Shape: () => unknown }).Shape();
  (transform as { delete: () => void }).delete();
  (trsf as { delete: () => void }).delete();
  return { __brand: 'OcctShape', handle: out };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zilventor/kernel exec vitest run src/occt/__tests__/TransformOps.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/TransformOps.ts packages/kernel/src/occt/__tests__/TransformOps.spec.ts
git commit -m "feat(asm-section-regen): transformShapeByPose OCCT helper"
```

---

### Task 2: Leaves-based cut cores (factor + delegate)

Factor the per-leaf loop out of the two existing `cutAssembly*(asm,…)` functions so a pre-flattened components list can drive it. The cores additionally **dispose each posed body** after cutting.

**Files:**
- Modify: `packages/kernel/src/section/cutBySectionPlane.ts`
- Test: `packages/kernel/src/section/cutBySectionPlane.spec.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/kernel/src/section/cutBySectionPlane.spec.ts`. Add `transformShapeByPose` (from `../occt/TransformOps`) and `cutLeavesBySectionPlane` to the spec's imports; `makeBox` (from `../occt/SolidOps`) and the spec-local `disposeOcctShape` helper are already present. Note `Plane = { origin, normal }` (NOT `point`):

```typescript
describe('cutLeavesBySectionPlane — pose-aware per-component', () => {
  it('cuts two leaves at their posed positions (not stacked at origin)', () => {
    // Leaf B posed +100 in X. A plane through x=10 (normal +X) cuts BOTH
    // (A near origin, B near +100) — proving per-component poses are applied.
    const leaves = [
      { partId: 'A', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0,0,0,1] as const } },
      { partId: 'B', pose: { translation: { x: 100, y: 0, z: 0 }, quaternion: [0,0,0,1] as const } },
    ];
    const bodyResolver = (_id: string, pose: (typeof leaves)[number]['pose']) =>
      transformShapeByPose(oc, makeBox(oc, 20, 20, 20), pose);
    const plane = { origin: { x: 10, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
    const result = cutLeavesBySectionPlane(oc, leaves, plane, 1, {
      bodyResolver,
      materialResolver: () => '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Both components contributed faces → merged faceTags from two partIds.
      const partIds = new Set([...result.faceTags.values()].map((v) => v.partId));
      expect(partIds.has('A')).toBe(true);
      expect(partIds.has('B')).toBe(true);
      disposeOcctShape(oc, result.compound); // spec-local disposal helper
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/kernel exec vitest run src/section/cutBySectionPlane.spec.ts`
Expected: FAIL — `cutLeavesBySectionPlane is not exported`.

- [ ] **Step 3: Write minimal implementation**

In `packages/kernel/src/section/cutBySectionPlane.ts`, add a leaves-options type and two core functions, and make the existing `cutAssemblyBySectionPlane`/`cutAssemblyByStepSegments` delegate.

Add an import for the disposal helper at the top of the file: `import { disposeShape } from '../occt/SolidOps';` (the module does not yet import it; `disposeShape(shape)` is 1-arg).

Add near `AssemblyCutOptions`. Define a NEW exported `ComponentLeaf` (do NOT name it `Leaf` — a private `type Leaf` already exists in this file at ~line 416; reusing that private name in an exported signature is fragile). `ComponentLeaf` is structurally identical to the private `Leaf`, so `flattenLeaves(...)`'s `Leaf[]` is assignable to `ComponentLeaf[]`:

```typescript
export type ComponentLeaf = { partId: string; pose: Parameters<AssemblyBodyResolver>[1] };

export type LeafCutOptions = {
  bodyResolver: AssemblyBodyResolver;
  materialResolver: (partId: string) => string;
};
```

Add the section-plane core (extracted from the current `cutAssemblyBySectionPlane` loop, plus posed-body disposal):

```typescript
export function cutLeavesBySectionPlane(
  oc: OcctInstance,
  leaves: readonly ComponentLeaf[],
  plane: Plane,
  arrowDirection: -1 | 1,
  opts: LeafCutOptions,
  splitPlane?: Plane,
  splitSide?: -1 | 1,
): Result {
  const builder = new oc.BRep_Builder();
  const resultCompound = new oc.TopoDS_Compound();
  builder.MakeCompound(resultCompound);
  const mergedTags: FaceTagMap = new Map();
  let anyOk = false;

  for (const { partId, pose } of leaves) {
    const body = opts.bodyResolver(partId, pose);
    if (!body) continue;

    const srcBuilder = new oc.BRep_Builder();
    const srcComp = new oc.TopoDS_Compound();
    srcBuilder.MakeCompound(srcComp);
    srcBuilder.Add(srcComp, body.handle as never);
    srcBuilder.delete();

    const r = cutBySectionPlane(oc, srcComp, plane, arrowDirection, splitPlane, splitSide);
    srcComp.delete();
    disposeShape(body);   // posed body is a fresh copy — free it

    if (!r.ok) {
      if (r.reason === 'tangent') console.warn(`cutLeavesBySectionPlane: tangent on part ${partId}, skipping`);
      continue;
    }
    anyOk = true;
    builder.Add(resultCompound, r.compound as never);
    (r.compound as unknown as { delete?(): void }).delete?.();

    const matId = opts.materialResolver(partId);
    for (const [key, val] of r.faceTags) {
      mergedTags.set(key, {
        tag: val.tag, partId, materialId: matId,
        ...(val.polygon3D ? { polygon3D: val.polygon3D } : {}),
        ...(val.planeSource ? { planeSource: val.planeSource } : {}),
      });
    }
  }
  builder.delete();
  if (!anyOk) { resultCompound.delete(); return { ok: false, reason: 'empty' }; }
  return { ok: true, compound: resultCompound, faceTags: mergedTags };
}
```

Add the stepped core (same shape, per-leaf call is `cutByStepSegments`):

```typescript
export function cutLeavesByStepSegments(
  oc: OcctInstance,
  leaves: readonly ComponentLeaf[],
  planes: readonly Plane[],
  arrowDirection: -1 | 1,
  opts: LeafCutOptions,
): Result {
  const builder = new oc.BRep_Builder();
  const resultCompound = new oc.TopoDS_Compound();
  builder.MakeCompound(resultCompound);
  const mergedTags: FaceTagMap = new Map();
  let anyOk = false;

  for (const { partId, pose } of leaves) {
    const body = opts.bodyResolver(partId, pose);
    if (!body) continue;

    const srcBuilder = new oc.BRep_Builder();
    const srcComp = new oc.TopoDS_Compound();
    srcBuilder.MakeCompound(srcComp);
    srcBuilder.Add(srcComp, body.handle as never);
    srcBuilder.delete();

    const r = cutByStepSegments(oc, srcComp, planes, arrowDirection);
    srcComp.delete();
    disposeOcctShape(oc, body);

    if (!r.ok) continue;
    anyOk = true;
    builder.Add(resultCompound, r.compound as never);
    (r.compound as unknown as { delete?(): void }).delete?.();

    const matId = opts.materialResolver(partId);
    for (const [key, val] of r.faceTags) {
      mergedTags.set(key, {
        tag: val.tag, partId, materialId: matId,
        ...(val.polygon3D ? { polygon3D: val.polygon3D } : {}),
        ...(val.planeSource ? { planeSource: val.planeSource } : {}),
      });
    }
  }
  builder.delete();
  if (!anyOk) { resultCompound.delete(); return { ok: false, reason: 'empty' }; }
  return { ok: true, compound: resultCompound, faceTags: mergedTags };
}
```

Then replace the bodies of the existing `cutAssemblyBySectionPlane(oc, asm, …)` and `cutAssemblyByStepSegments(oc, asm, …)` to delegate:

```typescript
export function cutAssemblyBySectionPlane(oc, asm, plane, arrowDirection, opts, splitPlane?, splitSide?): Result {
  const leaves = flattenLeaves(asm, opts.lookupSubAsm, opts.partPathToId);
  return cutLeavesBySectionPlane(oc, leaves, plane, arrowDirection,
    { bodyResolver: opts.bodyResolver, materialResolver: opts.materialResolver }, splitPlane, splitSide);
}

export function cutAssemblyByStepSegments(oc, asm, planes, arrowDirection, opts): Result {
  const leaves = flattenLeaves(asm, opts.lookupSubAsm, opts.partPathToId);
  return cutLeavesByStepSegments(oc, leaves, planes, arrowDirection,
    { bodyResolver: opts.bodyResolver, materialResolver: opts.materialResolver });
}
```

**Disposal-contract note:** the cores now dispose `body`. The existing asm-path tests pass a `bodyResolver` that returns a freshly-built shape, so disposal is correct. If any existing asm test reuses a single shape across leaves (double-free risk), update that test's resolver to return a fresh copy per call (`transformShapeByPose(oc, base, pose)` or a fresh `makeBox()`).

- [ ] **Step 4: Run test to verify it passes (incl. existing asm tests)**

Run: `pnpm --filter @zilventor/kernel exec vitest run src/section/cutBySectionPlane.spec.ts`
Expected: PASS — the new leaves test + ALL existing `cutAssemblyBySectionPlane`/`cutAssemblyByStepSegments`/nested-subassembly tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/section/cutBySectionPlane.ts packages/kernel/src/section/cutBySectionPlane.spec.ts
git commit -m "feat(asm-section-regen): leaves-based section-cut cores (asm fns delegate)"
```

---

### Task 3: Kernel api components-based cut methods

Wiring layer (no standalone occt unit test — correctness is proven by Task 2's cores + the Task 6 e2e; the RED here is the typecheck error from the new `KernelApi` members referenced by Task 4's app wrappers). Mirror the existing cut wrappers exactly (`api.ts:416–553`).

**Files:**
- Modify: `packages/kernel/src/api.ts`

- [ ] **Step 1: Add the `KernelApi` type members**

After the existing `cutAssemblyByStepSegments` declaration (around `api.ts:124`), add to the `KernelApi` type:

```typescript
  cutAssemblyComponentsBySectionPlane(
    components: readonly { partId: string; pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] } }[],
    plane: Plane, arrowDirection: -1 | 1, splitPlane?: Plane, splitSide?: -1 | 1,
  ): Promise<CutSectionResult>;
  cutAssemblyComponentsByStepSegments(
    components: readonly { partId: string; pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] } }[],
    planes: readonly Plane[], arrowDirection: -1 | 1,
  ): Promise<CutSectionResult>;
```

- [ ] **Step 2: Add the implementations**

Import the cores + helper at the top of `api.ts` (alongside the existing `kernelCutBySectionPlane` import and `transformShapeByPose`):

```typescript
import { cutLeavesBySectionPlane, cutLeavesByStepSegments } from './section/cutBySectionPlane';
import { transformShapeByPose } from './occt/TransformOps';
```

After `cutAssemblyByStepSegments` (around `api.ts:553`), add the two methods to the returned api object. Build a `bodyResolver` from the cache + pose helper and a no-op `materialResolver` (material is a documented non-goal):

```typescript
    async cutAssemblyComponentsBySectionPlane(components, plane, arrowDirection, splitPlane, splitSide) {
      if (!occt) throw new Error('kernel not initialized');
      const bodyResolver = (partId: string, pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] }) => {
        const ns = namedShapeCache.get(partId);
        return ns ? transformShapeByPose(occt!, ns.shape, pose) : null;
      };
      const r = cutLeavesBySectionPlane(occt, components, plane, arrowDirection,
        { bodyResolver, materialResolver: () => '' }, splitPlane, splitSide);
      if (!r.ok) return r;
      const cutShape: OcctShape = { __brand: 'OcctShape', handle: r.compound };
      const mesh = tessellate(occt, cutShape, { linearDeflection: 0.05, angularDeflection: 0.3 });
      (r.compound as unknown as { delete?(): void }).delete?.();
      const triangles = buildTriangles(mesh);
      const projectorInput: ProjectorInput = { triangles, edges: [], bbox: mesh.boundingBox };
      const faceTags = serializeFaceTags(r.faceTags);
      return { ok: true, projectorInput, faceTags };
    },

    async cutAssemblyComponentsByStepSegments(components, planes, arrowDirection) {
      if (!occt) throw new Error('kernel not initialized');
      const bodyResolver = (partId: string, pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] }) => {
        const ns = namedShapeCache.get(partId);
        return ns ? transformShapeByPose(occt!, ns.shape, pose) : null;
      };
      const r = cutLeavesByStepSegments(occt, components, planes, arrowDirection,
        { bodyResolver, materialResolver: () => '' });
      if (!r.ok) return r;
      const cutShape: OcctShape = { __brand: 'OcctShape', handle: r.compound };
      const mesh = tessellate(occt, cutShape, { linearDeflection: 0.05, angularDeflection: 0.3 });
      (r.compound as unknown as { delete?(): void }).delete?.();
      const triangles = buildTriangles(mesh);
      const projectorInput: ProjectorInput = { triangles, edges: [], bbox: mesh.boundingBox };
      const faceTags = serializeFaceTags(r.faceTags);
      return { ok: true, projectorInput, faceTags };
    },
```

(`components` is structurally a `readonly Leaf[]` for the cores. If TS complains about the readonly-tuple `quaternion`, the cores already accept `Parameters<AssemblyBodyResolver>[1]` which matches.)

- [ ] **Step 3: Typecheck to verify it compiles**

Run: `pnpm --filter @zilventor/kernel exec tsc --noEmit`
Expected: clean (no errors). The new methods satisfy the `KernelApi` type.

- [ ] **Step 4: Commit**

```bash
git add packages/kernel/src/api.ts
git commit -m "feat(asm-section-regen): kernel api cutAssemblyComponents* (pose-aware)"
```

---

### Task 4: App kernel-client wrappers

**Files:**
- Modify: `packages/app/src/kernel/cutBySectionPlane.ts`

- [ ] **Step 1: Add the wrappers**

Append to `packages/app/src/kernel/cutBySectionPlane.ts` (mirror the existing `cutAssemblyBySectionPlane` wrapper; import `AssemblyComponentInput`):

```typescript
import type { AssemblyComponentInput } from '@zilventor/kernel/src/adapter/drawing/getProjectorInput';

/** Pose-aware components-based assembly section cut (full/half). */
export async function cutAssemblyComponentsBySectionPlane(
  components: readonly AssemblyComponentInput[],
  plane: Plane,
  arrowDirection: -1 | 1 = 1,
  splitPlane?: Plane,
  splitSide?: -1 | 1,
): Promise<CutResult> {
  const kernel = useAppStore.getState().kernel;
  if (!kernel) throw new Error('cutAssemblyComponentsBySectionPlane: kernel not ready');
  const r = await kernel.cutAssemblyComponentsBySectionPlane(components, plane, arrowDirection, splitPlane, splitSide);
  if (!r.ok) return r;
  return { ok: true, compound: r.projectorInput, faceTags: new Map(r.faceTags) };
}

/** Pose-aware components-based assembly stepped-section cut. */
export async function cutAssemblyComponentsByStepSegments(
  components: readonly AssemblyComponentInput[],
  planes: readonly Plane[],
  arrowDirection: -1 | 1 = 1,
): Promise<CutResult> {
  const kernel = useAppStore.getState().kernel;
  if (!kernel) throw new Error('cutAssemblyComponentsByStepSegments: kernel not ready');
  const r = await kernel.cutAssemblyComponentsByStepSegments(components, planes, arrowDirection);
  if (!r.ok) return r;
  return { ok: true, compound: r.projectorInput, faceTags: new Map(r.faceTags) };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter app exec tsc --noEmit 2>&1 | grep cutBySectionPlane | head`
Expected: no output (the kernel KernelApi members from Task 3 satisfy the calls).

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/kernel/cutBySectionPlane.ts
git commit -m "feat(asm-section-regen): app wrappers for components-based assembly cut"
```

---

### Task 5: Wire create + regen to the components cut (all 3 modes)

**Files:**
- Modify: `packages/app/src/commands/AddSectionViewCommand.ts` (assembly branch — full/half ~117–122, stepped sibling)
- Modify: `packages/app/src/drawing/regenerateSectionView.ts:55-57` (+ imports + assembly path)
- Test: `packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts` (append or create) and `packages/app/src/commands/__tests__/AddSectionViewCommand.spec.ts` (append)

- [ ] **Step 1: Write the failing test (regen no longer bails for assembly)**

Append to the regenerate spec (mock `../kernel/cutBySectionPlane` so the new wrappers are spied). Read the spec's existing mock setup first and mirror it:

```typescript
// In the vi.mock factory for '../kernel/cutBySectionPlane', add:
//   cutAssemblyComponentsBySectionPlane: vi.fn(async () => ({ ok: true, compound: FAKE_PROJ, faceTags: new Map() })),
//   cutAssemblyComponentsByStepSegments: vi.fn(async () => ({ ok: true, compound: FAKE_PROJ, faceTags: new Map() })),

it('REGEN assembly full-section: calls cutAssemblyComponentsBySectionPlane (no throw)', async () => {
  // Seed store: activeDocument = assembly-sourced drawing with a full-mode SectionView,
  // activeDrawingSourceComponents = [{ partId:'p1', pose:{translation:{x:0,y:0,z:0}, quaternion:[0,0,0,1]} }],
  // resolveSectionSource(view, drawing) → { kind:'assembly' }.
  // (Mirror the part-path regen test's store seeding; flip the drawing source to assembly.)
  await expect(regenerateSectionView(assemblyFullView, sheetId, bus)).resolves.toBeUndefined();
  expect(cutAssemblyComponentsBySectionPlane).toHaveBeenCalledTimes(1);
});
```

Add analogous tests asserting `cutAssemblyComponentsByStepSegments` is called for a stepped assembly view, and that half-mode passes `splitPlane`/`cutSide`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/regenerateSectionView.spec.ts`
Expected: FAIL — current code throws `"Assembly section Regenerate is not yet supported"`.

- [ ] **Step 3: Implement — regenerateSectionView assembly path**

In `packages/app/src/drawing/regenerateSectionView.ts`:

Update imports (line 5–8):
```typescript
import {
  cutBySectionPlane,
  cutByStepSegments,
  cutAssemblyComponentsBySectionPlane,
  cutAssemblyComponentsByStepSegments,
} from '../kernel/cutBySectionPlane';
```

Replace the bail (lines 51–57) with a branch that runs the components cut for the right mode. Insert this in place of the throw, and guard the part-only `kernelId` (line 61) so it only runs for parts:

```typescript
  let compound: unknown;
  let faceTags: Map<string, unknown>;

  if (source.kind === 'assembly') {
    const components = state.activeDrawingSourceComponents;
    if (!components || components.length === 0) {
      throw new Error('REGEN_SECTION: assembly components not loaded — reopen the drawing.');
    }
    if (view.mode === 'stepped') {
      if (!view.stepSegments || view.stepSegments.length < 2) throw new Error('REGEN_SECTION: stepped view missing stepSegments');
      const parentView = drawing.sheets.flatMap((s) => s.views).find((v) => v.id === view.parentViewId);
      const viewMatrix = ((parentView as { viewMatrix?: number[] })?.viewMatrix ?? new Array(16).fill(0) as number[]) as Mat4;
      const planes = deriveStepPlanes(view.stepSegments, viewMatrix, view.arrowDirection);
      const result = await cutAssemblyComponentsByStepSegments(components, planes, view.arrowDirection);
      if (!result.ok) throw new Error(`REGEN_SECTION assembly stepped cut failed: ${result.reason}`);
      compound = result.compound; faceTags = result.faceTags;
    } else {
      if (!view.plane) throw new Error('REGEN_SECTION: full/half view missing plane');
      const result = await cutAssemblyComponentsBySectionPlane(components, view.plane, view.arrowDirection, view.splitPlane, view.cutSide);
      if (!result.ok) throw new Error(`REGEN_SECTION assembly cut failed: ${result.reason}`);
      compound = result.compound; faceTags = result.faceTags;
    }
  } else {
    const kernelId: string = state.activeDrawingSourcePartId ?? state.activePart?.id ?? source.id;
    if (view.mode === 'stepped') {
      // ... existing part stepped branch (unchanged) ...
    } else {
      // ... existing part full/half branch (unchanged) ...
    }
  }
```

Keep the rest (steps 4–7: sectionViewMatrix, hatchLookup, projectSectionView, atomic store write) unchanged — they consume `compound`/`faceTags`. Move the existing part-path `compound`/`faceTags` assignments inside the `else` branch (don't redeclare).

- [ ] **Step 4: Implement — AddSectionViewCommand assembly create path**

In `packages/app/src/commands/AddSectionViewCommand.ts`, change the assembly branch (full/half, ~117–122):

```typescript
      const result = source.kind === 'assembly'
        ? await cutAssemblyComponentsBySectionPlane(
            state.activeDrawingSourceComponents ?? [],
            plane, this.payload.arrowDirection, splitPlane, this.payload.cutSide)
        : await cutBySectionPlane(
            state.activeDrawingSourcePartId ?? state.activePart?.id ?? source.id,
            plane, this.payload.arrowDirection, splitPlane, this.payload.cutSide);
```

Apply the identical swap to the stepped sibling branch (which currently calls `cutAssemblyByStepSegments(kernelId, planes, dir)` → `cutAssemblyComponentsByStepSegments(state.activeDrawingSourceComponents ?? [], planes, dir)`; the part branch stays `cutByStepSegments(kernelId, …)`). Update the import at the top of the file (line ~7) to add `cutAssemblyComponentsBySectionPlane, cutAssemblyComponentsByStepSegments` and **remove** `cutAssemblyBySectionPlane, cutAssemblyByStepSegments` — after this swap they are unused, and the no-unused-imports lint rule is active (would fail the gate otherwise).

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/regenerateSectionView.spec.ts src/commands/__tests__/AddSectionViewCommand.spec.ts`
Expected: PASS — assembly regen no longer throws and calls the components wrappers for each mode; AddSectionViewCommand assembly path calls the components wrappers; part paths unchanged.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter app exec tsc --noEmit` → clean.
```bash
git add packages/app/src/drawing/regenerateSectionView.ts packages/app/src/commands/AddSectionViewCommand.ts packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts packages/app/src/commands/__tests__/AddSectionViewCommand.spec.ts
git commit -m "feat(asm-section-regen): wire create + regen to pose-aware components cut (all 3 modes)"
```

---

### Task 6: E2E — assembly section reopen → edit → Regenerate (T-6-28)

Real Chromium. Mirror `tests/e2e/drawing/T-6-19-assembly-drawing-projection.spec.ts` (assembly build + drawing + reopen) and `T-6-21-section-detail-regen.spec.ts` (part section regen) for structure.

**Files:**
- Create: `tests/e2e/drawing/T-6-28-assembly-section-regen.spec.ts`

- [ ] **Step 1: Write the e2e**

Read T-6-19 (assembly→drawing build + reopen via store bridge) and T-6-21 (section view + Regenerate assertions) first. The spec must:
1. Build a 2-part assembly with a **non-trivial component pose** (one part translated, e.g. +100mm X) so a poseless cut would visibly differ.
2. Create a drawing from the assembly with a base view, then add a section view (full mode). Capture the section's `hatchSegments.length` (must be > 0).
3. Save → reopen the `.zidw` (so source = component parts via `activeDrawingSourceComponents`, no asmId).
4. Edit a source part param (or just trigger stale), then click Regenerate (or call `regenerateSectionView` via the store/import bridge as T-6-21 does).
5. Assert: Regenerate does NOT throw (no "not yet supported"), the section view re-projects (hatchSegments recomputed, length > 0), and the cut reflects the pose (e.g. the section projection bbox / hatch spans the posed position, not collapsed to origin). Read the browser console — must be clean (no errors/pageerrors).

- [ ] **Step 2: Run + read console**

Run (from ROOT): `pnpm test:e2e -- tests/e2e/drawing/T-6-28-assembly-section-regen.spec.ts --project=chromium`
Expected: PASS, console clean.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/drawing/T-6-28-assembly-section-regen.spec.ts
git commit -m "test(asm-section-regen): T-6-28 real-env assembly section reopen+regen e2e"
```

---

### Task 7: Perf probe — N-component assembly section cut

**Files:**
- Create: `tests/perf/assembly-section-cut.perf.spec.ts` (mirror an existing `tests/perf/*` section probe, e.g. the T63 section probe)

- [ ] **Step 1: Write the probe**

Read an existing section perf probe (the one added for part section cut — grep `tests/perf` for `cutBySectionPlane`/`section`). Build an N-component assembly (N≈10–20 posed boxes), run `cutAssemblyComponentsBySectionPlane` (via the same harness the existing section perf probe uses), record p95 over several iterations, assert under a generous budget (e.g. 800ms — assembly projection p95 was ~87ms; N boolean cuts cost more; pick a budget with clear headroom and document the observed p95).

- [ ] **Step 2: Run**

Run (from ROOT): `pnpm test:perf -- tests/perf/assembly-section-cut.perf.spec.ts`
Expected: PASS; record observed p95.

- [ ] **Step 3: Commit**

```bash
git add tests/perf/assembly-section-cut.perf.spec.ts
git commit -m "test(asm-section-regen): perf probe for N-component assembly section cut"
```

---

### Task 8: Full verification gate

**Files:** none.

- [ ] **Step 1: Typecheck** — `pnpm -r typecheck` → clean (all 5 packages).
- [ ] **Step 2: Lint** — `pnpm lint` → 0 errors (16 warnings baseline; run inside the worktree).
- [ ] **Step 3: Full unit suite** — `pnpm -r test:unit` → all green; confirm kernel count rose (+TransformOps +leaves-core) and app count rose (+regen/command assembly tests), 0 failures.
- [ ] **Step 4: Re-run e2e + perf** — `pnpm test:e2e -- tests/e2e/drawing/T-6-28-assembly-section-regen.spec.ts --project=chromium` (console clean) and the perf probe.
- [ ] **Step 5:** Only if a verification-driven fix was needed, commit it.

---

## Self-Review

**1. Spec coverage:**
- transformShapeByPose (new OCCT helper) → Task 1. ✓
- leaves-based core factored from existing asm fns, posed-body disposal → Task 2. ✓
- 2 new kernel api components methods → Task 3. ✓
- app wrappers → Task 4. ✓
- create (AddSectionViewCommand) + regen (regenerateSectionView) wired, all 3 modes → Task 5. ✓
- material non-goal (materialResolver ⇒ '') → Task 3 (explicit). ✓
- e2e reopen→regen posed → Task 6. ✓
- perf probe → Task 7. ✓
- no manifest bump → nothing serialized changed. ✓

**2. Placeholder scan:** Task 5's "existing part branch (unchanged)" comments refer to code already present and shown in the spec context (regenerateSectionView lines 67–89); the surrounding new branch code is complete. Test seeding in Task 5 Step 1 references "mirror the part-path regen test's store seeding" — this is a concrete pointer to an existing test, not a placeholder, because the exact store shape (activeDocument drawing + SectionView + activeDrawingSourceComponents) is enumerated. E2E/perf tasks point at concrete sibling specs to mirror (real, named files). No TBD/TODO.

**3. Type consistency:** `Leaf`/`LeafCutOptions` (Task 2) consumed by `cutLeavesBySectionPlane`/`cutLeavesByStepSegments` and the api methods (Task 3). `CutResult { compound: ProjectorInput; faceTags }` (app wrapper) consistent across Task 4 + consumed by Task 5 / projectSectionView. `AssemblyComponentInput` used in Task 4 wrappers + Task 5 call-sites + matches the kernel api `components` param shape (Task 3). `transformShapeByPose(oc, shape, pose)` signature identical in Tasks 1, 2 (test), 3. ✓

**Dependency order:** Task 1 (helper) → Task 2 (cores use helper in test) → Task 3 (api uses cores + helper) → Task 4 (wrappers use api types) → Task 5 (call-sites use wrappers) → Task 6 (e2e) → Task 7 (perf) → Task 8 (gate). Required for each step to typecheck/run.
