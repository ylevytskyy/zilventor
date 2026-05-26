# Assembly-sourced drawing projection — TDD implementation plan

**Date:** 2026-05-26  
**Spec:** `docs/superpowers/specs/2026-05-26-assembly-sourced-drawing-projection-design.md`  
**Baseline:** 2822 unit tests (731 shared + 37 sketcher-worker + 346 kernel + 1708 app), commit `600b56c`  
**Branch:** master (feature committed directly)

---

## Resolved open items (verified against real code)

### 1. Pose translation shape + pathKey serializer
`Pose` is `{ translation: Vec3; quaternion: [number, number, number, number] }` where `Vec3 = { x: number; y: number; z: number }` (`packages/app/src/assembly/walkers/flattenForSolver.ts:5`, `packages/shared/src/types.ts:162`).

`pathKey` from `@zilventor/shared` joins `ComponentPath` with a single space: `path.join(' ')` (`packages/shared/src/componentPath.ts:6-8`). To join a visible leaf's `componentPath` to the composedPoses map key: `pathKey(leaf.componentPath)` — same call used throughout the 3D viewport.

### 2. Regenerate assembly disable
`DrawingCanvas.tsx:897-901` — `handleRegenerate` is the ONLY disable point:
```ts
if (!view || view.kind === 'section' || view.kind === 'detail') {
  // Section/detail regenerate is out of scope …
  setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
  return;
}
```
There is NO `sourceKind === 'assembly'` guard in `handleRegenerate`. The assembly disable is entirely passive: `projectViewFromSource` throws `'PART_NOT_IN_STORE'` when `activeDrawingSourcePartId` is null AND `activePart` is null (which it is for assembly drawings). After this feature, `projectViewFromSource` will have an assembly branch that reads `activeDrawingSourceComponents` instead — no guard removal needed in `handleRegenerate`.

### 3. How `state.activeDrawing.source.sourceKind` is reached from `projectViewFromSource`
`useAppStore.getState()` returns `state` where `state.activeDrawing` is type `DrawingDocument | null`. `DrawingDocument.source.sourceKind` is `'part' | 'assembly'`. The branch check is: `state.activeDrawing?.source.sourceKind === 'assembly'`.

### 4. Composite fingerprint byte-order determinism
`djb2Bytes` is a **private, non-exported** helper inside `loadDrawingSource.ts` — it cannot be imported by other modules. `loadAssemblyForProjection.ts` inlines its own running-djb2 variant (`djb2Running`). The inlined variant is the correct approach; the plan's prose note that `djb2Bytes` is "reusable (loadDrawingSource.ts:38-45)" is **incorrect** and should be ignored — do not import from `loadDrawingSource.ts`.

The deterministic traversal order is `visibleLeaves(asmDoc, cache)` which does a depth-first walk of `asmDoc.components` (same order as stored in the document, preserved across save/reopen). Asm bytes are hashed first, then leaf bytes in `visibleLeaves` traversal order. This is stable across save+reopen because `AssemblyDocument.components` array order is preserved by `unpackAssembly`/`packAssembly`.

The implementation uses a running djb2 state (NOT separate hashes of each file, which would conflate different orderings): start with `h = djb2Running(5381, asmBytes)`, then continue running `h` through each leaf's bytes in order. This gives a single 8-char hex string that changes if any file changes OR if traversal order changes.

---

## File structure map

### New files
| File | Responsibility |
|---|---|
| `packages/app/src/drawing/loadAssemblyForProjection.ts` | Load assembly tree → visibleLeaves → composed poses → kernel load → `AssemblyComponentInput[]` + composite fingerprint |
| `packages/app/src/drawing/__tests__/loadAssemblyForProjection.spec.ts` | Unit tests for the above (TDD slices 1–3) |
| `tests/e2e/drawing/T-6-19-assembly-drawing-projection.spec.ts` | E2E: 2-part assembly → drawing → base view → Save As .zidw → edit part → reopen → STALE → Regenerate |
| `tests/perf/assembly-drawing-projection.perf.spec.ts` | T63j: 10-leaf assembly projection p95 |

### Modified files
| File | Change |
|---|---|
| `packages/app/src/store/useAppStore.ts` | Add `activeDrawingSourceComponents: AssemblyComponentInput[] \| null` to `AppState` type + initial value `null` |
| `packages/app/src/store/drawingDocState.ts` | NO CHANGE (already does not reset source slots — preserve as is; add a comment noting the new slot follows the same contract) |
| `packages/app/src/store/__tests__/activeDrawingSourcePartId.spec.ts` | Add test: `drawingDocState` does NOT reset `activeDrawingSourceComponents` |
| `packages/app/src/drawing/projectViewFromSource.ts` | Add assembly branch: if `state.activeDrawing?.source.sourceKind === 'assembly'`, read `activeDrawingSourceComponents` → `getProjectorInput({ kind: 'assembly', components })` → `projectView`. Part branch unchanged. |
| `packages/app/src/drawing/__tests__/projectViewFromSource.spec.ts` | Add assembly branch test |
| `packages/app/src/commands/CreateDrawingCommand.ts` | Assembly branch: calls `loadAssemblyForProjection`, populates `activeDrawingSourceComponents` + `activeDrawingSourceFingerprint`; revert clears the new slot |
| `packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts` | Add assembly branch tests |
| `packages/app/src/drawing/activateDrawingDocument.ts` | Replace assembly bail with `loadAssemblyForProjection`; null `activeDrawingSourceComponents` + `setStatus` on failure; `setStatus('Opened')` on success |
| `packages/app/src/drawing/__tests__/activateDrawingDocument.spec.ts` | Replace/extend assembly bail tests for the new path |
| `packages/app/src/commands/__tests__/activeDrawingInvariant.guard.test.ts` | Add a case for `activeDrawingSourceComponents` |

---

## Batches

### B1 — `loadAssemblyForProjection` unit (new file + tests)
**Goal:** the new bounded unit is green in isolation. No store, no commands.

**Test file to create:** `packages/app/src/drawing/__tests__/loadAssemblyForProjection.spec.ts`

---

#### Task 1.1 — Write failing test: 2-part assembly returns correct `AssemblyComponentInput[]`

```
[ ] Write test in loadAssemblyForProjection.spec.ts
[ ] Run pnpm --filter app test:unit -- loadAssemblyForProjection.spec.ts → RED (no module)
```

Exact test to write:

```ts
// packages/app/src/drawing/__tests__/loadAssemblyForProjection.spec.ts
import { describe, it, expect, vi } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';

// ---- Fixtures ----
const PART_A_PATH = 'parts/partA.zipt';
const PART_B_PATH = 'parts/partB.zipt';
const ASM_PATH    = 'assemblies/top.ziasm';
const PART_A_BYTES = new Uint8Array([1, 2, 3]);
const PART_B_BYTES = new Uint8Array([4, 5, 6]);
const ASM_BYTES    = new Uint8Array([7, 8, 9]);

const asmDoc: AssemblyDocument = {
  id: 'asm-top',
  name: 'Top',
  units: 'mm',
  components: [
    {
      id: 'c1',
      partPath: PART_A_PATH,
      position: { x: 10, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      visible: true,
      flexible: false,
    },
    {
      id: 'c2',
      partPath: PART_B_PATH,
      position: { x: -10, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      visible: true,
      flexible: false,
    },
  ],
  constraints: [],
  properties: {},
  colorOverrides: {},
  materials: [],
  colors: {},
};

function makeOpfs() {
  return {
    exists: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path === ASM_PATH)    return ASM_BYTES;
      if (path === PART_A_PATH) return PART_A_BYTES;
      if (path === PART_B_PATH) return PART_B_BYTES;
      throw new Error(`unexpected read: ${path}`);
    }),
  };
}

function makeKernel() {
  const idMap = new Map<string, string>([
    [PART_A_PATH, 'kernel-id-A'],
    [PART_B_PATH, 'kernel-id-B'],
  ]);
  return {
    loadFromBytes: vi.fn().mockImplementation(async (bytes: Uint8Array) => {
      if (bytes === PART_A_BYTES) return 'kernel-id-A';
      if (bytes === PART_B_BYTES) return 'kernel-id-B';
      throw new Error('unexpected bytes in loadFromBytes');
    }),
    execute: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('loadAssemblyForProjection', () => {
  it('T1: returns AssemblyComponentInput[] for 2-part flat assembly with composed world poses', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const result = await loadAssemblyForProjection({
      asmPath: ASM_PATH,
      asmDoc,
      opfs: opfs as never,
      kernel: kernel as never,
    });

    expect(result.components).toHaveLength(2);

    // c1 has position {x:10,y:0,z:0}, no constraint solve → translation = {x:10,y:0,z:0}
    const compA = result.components.find((c) => c.partId === 'kernel-id-A');
    expect(compA).toBeDefined();
    expect(compA!.pose.translation).toEqual({ x: 10, y: 0, z: 0 });
    expect(compA!.pose.quaternion).toEqual([0, 0, 0, 1]);

    // c2 has position {x:-10,y:0,z:0}
    const compB = result.components.find((c) => c.partId === 'kernel-id-B');
    expect(compB).toBeDefined();
    expect(compB!.pose.translation).toEqual({ x: -10, y: 0, z: 0 });

    // kernel.execute called for each unique part
    expect(kernel.execute).toHaveBeenCalledTimes(2);
  });

  it('T2: composite fingerprint changes when one part bytes change; stable when unchanged', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const r1 = await loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc, opfs: opfs as never, kernel: kernel as never });

    // Change part A bytes
    const opfs2 = {
      ...opfs,
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === ASM_PATH)    return ASM_BYTES;
        if (path === PART_A_PATH) return new Uint8Array([99, 88, 77]); // changed
        if (path === PART_B_PATH) return PART_B_BYTES;
        throw new Error(`unexpected: ${path}`);
      }),
    };
    const r2 = await loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc, opfs: opfs2 as never, kernel: kernel as never });

    expect(r2.sourceFingerprint).not.toBe(r1.sourceFingerprint);

    // Unchanged bytes → same fingerprint
    const r3 = await loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc, opfs: opfs as never, kernel: kernel as never });
    expect(r3.sourceFingerprint).toBe(r1.sourceFingerprint);
  });

  it('T3: invisible component excluded from components list', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const asmWithInvisible: AssemblyDocument = {
      ...asmDoc,
      components: [
        { ...asmDoc.components[0]!, visible: true },
        { ...asmDoc.components[1]!, visible: false },
      ],
    };
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const r = await loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc: asmWithInvisible, opfs: opfs as never, kernel: kernel as never });
    expect(r.components).toHaveLength(1);
    expect(r.components[0]!.partId).toBe('kernel-id-A');
  });

  it('T4: missing part file → throws OPFS_READ_FAILED (fail whole projection)', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const opfsWithMissing = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === ASM_PATH)    return ASM_BYTES;
        if (path === PART_A_PATH) return PART_A_BYTES;
        throw new Error(`OPFS_READ_FAILED: ${path}`);
      }),
    };
    const kernel = makeKernel();

    await expect(
      loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc, opfs: opfsWithMissing as never, kernel: kernel as never })
    ).rejects.toThrow('OPFS_READ_FAILED');
  });

  it('T5: all-invisible assembly → empty components, no error', async () => {
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
    const allInvisible: AssemblyDocument = {
      ...asmDoc,
      components: asmDoc.components.map((c) => ({ ...c, visible: false })),
    };
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const r = await loadAssemblyForProjection({ asmPath: ASM_PATH, asmDoc: allInvisible, opfs: opfs as never, kernel: kernel as never });
    expect(r.components).toHaveLength(0);
    expect(typeof r.sourceFingerprint).toBe('string');
  });

  it('T6: 2-level nested assembly (top → sub-asm → leaf parts) yields nested leaf parts in components[]', async () => {
    // Fixture: top assembly has one sub-asm component; sub-asm has two leaf part components.
    // Verifies SubAssemblyCache.loadSubAssemblyTree resolves nested .ziasm → real leaves.
    const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');

    const SUB_ASM_PATH  = 'assemblies/sub.ziasm';
    const LEAF_C_PATH   = 'parts/partC.zipt';
    const LEAF_D_PATH   = 'parts/partD.zipt';
    const LEAF_C_BYTES  = new Uint8Array([10, 20, 30]);
    const LEAF_D_BYTES  = new Uint8Array([40, 50, 60]);
    const SUB_ASM_BYTES = new Uint8Array([70, 80, 90]);

    // Sub-assembly document: two leaf parts
    const subAsmDoc: AssemblyDocument = {
      id: 'sub-asm',
      name: 'Sub',
      units: 'mm',
      components: [
        {
          id: 'sc1', partPath: LEAF_C_PATH,
          position: { x: 5, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
          visible: true, flexible: false,
        },
        {
          id: 'sc2', partPath: LEAF_D_PATH,
          position: { x: -5, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
          visible: true, flexible: false,
        },
      ],
      constraints: [],
      properties: {},
      colorOverrides: {},
      materials: [],
      colors: {},
    };

    // Top assembly document: one sub-asm component
    const topAsmDoc: AssemblyDocument = {
      id: 'top-asm',
      name: 'Top',
      units: 'mm',
      components: [
        {
          id: 'tc1', partPath: SUB_ASM_PATH,
          position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
          visible: true, flexible: false,
        },
      ],
      constraints: [],
      properties: {},
      colorOverrides: {},
      materials: [],
      colors: {},
    };

    // OPFS mock: sub-asm bytes unpack via SubAssemblyCache; leaf part bytes returned directly.
    // SubAssemblyCache.loadSubAssemblyTree calls opfs.exists + opfs.read for SUB_ASM_PATH,
    // then unpackAssembly on the result. We mock SubAssemblyCache to avoid a real unpackAssembly
    // call in the unit test by providing SubAssemblyCache bytes that resolve to subAsmDoc.
    // Simpler approach: mock SubAssemblyCache directly in this test.
    const { SubAssemblyCache } = await import('../../assembly/SubAssemblyCache');
    const mockLoadSubAsmTree = vi.spyOn(SubAssemblyCache.prototype, 'loadSubAssemblyTree').mockImplementation(
      async function (this: InstanceType<typeof SubAssemblyCache>, _rootDoc: AssemblyDocument): Promise<void> {
        // Simulate the cache having loaded the sub-assembly entry for SUB_ASM_PATH.
        // We use the private `entries` map via a cast — unit test only.
        (this as unknown as { entries: Map<string, unknown> }).entries.set(SUB_ASM_PATH, {
          kind: 'ok',
          partPath: SUB_ASM_PATH,
          doc: subAsmDoc,
        });
      }
    );

    const nestedOpfs = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === ASM_PATH)      return ASM_BYTES;       // top-asm bytes (for fingerprint)
        if (path === SUB_ASM_PATH)  return SUB_ASM_BYTES;
        if (path === LEAF_C_PATH)   return LEAF_C_BYTES;
        if (path === LEAF_D_PATH)   return LEAF_D_BYTES;
        throw new Error(`unexpected read: ${path}`);
      }),
    };

    const nestedKernel = {
      loadFromBytes: vi.fn().mockImplementation(async (bytes: Uint8Array) => {
        if (bytes === LEAF_C_BYTES) return 'kernel-id-C';
        if (bytes === LEAF_D_BYTES) return 'kernel-id-D';
        throw new Error('unexpected bytes');
      }),
      execute: vi.fn().mockResolvedValue({ ok: true }),
    };

    const result = await loadAssemblyForProjection({
      asmPath: ASM_PATH,
      asmDoc: topAsmDoc,
      opfs: nestedOpfs as never,
      kernel: nestedKernel as never,
    });

    mockLoadSubAsmTree.mockRestore();

    // Both nested leaf parts must appear in components[] — NOT skipped as placeholders.
    expect(result.components).toHaveLength(2);
    expect(result.components.map((c) => c.partId).sort()).toEqual(['kernel-id-C', 'kernel-id-D']);
    expect(nestedKernel.execute).toHaveBeenCalledTimes(2);
  });
});
```

---

#### Task 1.2 — Implement `loadAssemblyForProjection.ts` → GREEN

```
[ ] Create packages/app/src/drawing/loadAssemblyForProjection.ts (code below)
[ ] Run pnpm --filter app test:unit -- loadAssemblyForProjection.spec.ts → GREEN
[ ] Run pnpm --filter app test:unit → confirm no regressions (baseline 1708 app)
[ ] Run pnpm -r typecheck → 0 errors
[ ] Commit: "feat(asm-drawing): add loadAssemblyForProjection — composite fingerprint + static poses"
```

**Exact implementation:**

```ts
// packages/app/src/drawing/loadAssemblyForProjection.ts
/**
 * Load an assembly tree into the kernel and build the AssemblyComponentInput[]
 * required by getProjectorInput({ kind: 'assembly', components }).
 *
 * Uses the SAME static-composition path as the 3D viewport (App.tsx:3229-3234):
 *   flattenForSolver(asmDoc, cache) → composedPoses(..., { poses: flat.unknowns }) — NO solver.
 *
 * Recursive nested assemblies: uses SubAssemblyCache.loadSubAssemblyTree(asmDoc) to
 * recursively load all nested .ziasm refs via OPFS (no constraint solver — solver=null).
 * After loadSubAssemblyTree, cache.get(partPath) returns SubAssemblyEntry | undefined
 * for any nested sub-asm. The adapter passed to visibleLeaves / flattenForSolver /
 * composedPoses is built from the populated cache — identical pattern to App.tsx:3209-3213.
 *
 * Composite fingerprint: running djb2 over asmBytes then each leaf's bytes in
 * visibleLeaves traversal order (depth-first, document order). Deterministic across
 * save+reopen because AssemblyDocument.components order is preserved by packAssembly.
 *
 * NOTE: djb2Bytes in loadDrawingSource.ts is a private (non-exported) function —
 * do NOT import it. This file inlines its own djb2Running variant.
 */
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { SubAssemblyCache } from '../assembly/SubAssemblyCache';
import { visibleLeaves } from '../assembly/walkers/visibleLeaves';
import { flattenForSolver } from '../assembly/walkers/flattenForSolver';
import { composedPoses } from '../assembly/walkers/composedPoses';
import type { AssemblyComponentInput } from '@zilventor/kernel/src/adapter/drawing/getProjectorInput';

// ---- djb2 ----
// NOTE: djb2Bytes in loadDrawingSource.ts is private/non-exported — inlined here.
function djb2Running(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h = ((h << 5) + h) ^ bytes[i]!;
    h = h >>> 0;
  }
  return h;
}

function fingerprint(h: number): string {
  return h.toString(16).padStart(8, '0');
}

export type KernelForAsmLoad = {
  loadFromBytes(bytes: Uint8Array): Promise<string>;
  execute(partId: string): Promise<{ ok: boolean; error?: unknown }>;
};

export type OpfsForAsmLoad = {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
};

export type LoadAssemblyForProjectionArgs = {
  asmPath: string;
  asmDoc: AssemblyDocument;
  opfs: OpfsForAsmLoad;
  kernel: KernelForAsmLoad;
};

export type LoadAssemblyForProjectionResult = {
  components: AssemblyComponentInput[];
  sourceFingerprint: string;
};

export async function loadAssemblyForProjection(
  args: LoadAssemblyForProjectionArgs,
): Promise<LoadAssemblyForProjectionResult> {
  const { asmPath, asmDoc, opfs, kernel } = args;

  // Step 1: Read and hash the top-level assembly bytes (fingerprint seed).
  const asmBytes = await opfs.read(asmPath);
  let fpHash = djb2Running(5381, asmBytes);

  // Step 2: Recursively load all nested .ziasm sub-assemblies via SubAssemblyCache.
  // solver=null → no constraint pre-solve (innerStaticPoses will be undefined for sub-asms,
  // which is fine — composedPoses falls back to Euler initial poses, identical to the
  // first-render path in App.tsx:3228-3234 before the solver has run).
  // loadSubAssemblyTree(asmDoc) calls walkTree(asmDoc, new Set()) which recursively
  // walks every component with a .ziasm partPath and calls loadSubAssembly (OPFS read +
  // unpackAssembly) for each, with cycle detection. After this call, cache.get(p) returns
  // the SubAssemblyEntry for any nested .ziasm path reachable from asmDoc.
  const subAsmCache = new SubAssemblyCache(opfs, null /* no solver */);
  await subAsmCache.loadSubAssemblyTree(asmDoc);

  // Step 3: Build the adapter (mirrors App.tsx:3209-3213) — passed to visibleLeaves,
  // flattenForSolver, composedPoses so nested .ziasm refs resolve to REAL leaves.
  const cacheAdapter = {
    get: (p: string) => subAsmCache.get(p),
  };

  // Step 4: Get visible leaves (depth-first, filters visible:false).
  // With a populated cacheAdapter, visibleLeaves recurses into nested sub-asm docs
  // and returns their leaf parts — no placeholder entries for loaded sub-asms.
  const leaves = visibleLeaves(asmDoc, cacheAdapter);

  // Step 5: Build composed world poses — NO solver (static/initial unknowns only).
  const flat = flattenForSolver(asmDoc, cacheAdapter);
  const posesMap = composedPoses(asmDoc, cacheAdapter, {
    pathToUnknown: flat.pathToUnknown,
    poses: flat.unknowns,
    rigidSubtreeRoots: flat.rigidSubtreeRoots,
  });

  // Step 6: Load each unique part into the kernel and build AssemblyComponentInput[].
  // Fail fast on any missing file (spec: don't drop a part silently).
  const partIdCache = new Map<string, string>(); // partPath → kernel UUID
  const components: AssemblyComponentInput[] = [];

  for (const leaf of leaves) {
    if (leaf.kind !== 'leaf') continue; // skip any remaining placeholders (missing sub-asms)

    // Load part bytes and accumulate fingerprint in traversal order.
    const partBytes = await opfs.read(leaf.partPath); // throws OPFS_READ_FAILED on miss
    fpHash = djb2Running(fpHash, partBytes);

    // Load into kernel (idempotent if already loaded; loadFromBytes re-registers).
    let partId = partIdCache.get(leaf.partPath);
    if (!partId) {
      partId = await kernel.loadFromBytes(partBytes);
      const execResult = await kernel.execute(partId);
      if (!execResult.ok) {
        throw new Error(
          `loadAssemblyForProjection: kernel.execute failed for "${leaf.partPath}": ${String(execResult.error)}`,
        );
      }
      partIdCache.set(leaf.partPath, partId);
    }

    // Compose world pose from flattenForSolver initial unknowns.
    const key = pathKey(leaf.componentPath);
    const pose = posesMap.get(key) ?? {
      translation: { x: 0, y: 0, z: 0 },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    };

    components.push({
      partId,
      pose: {
        translation: { x: pose.translation.x, y: pose.translation.y, z: pose.translation.z },
        quaternion: [...pose.quaternion] as [number, number, number, number],
      },
    });
  }

  return { components, sourceFingerprint: fingerprint(fpHash) };
}
```

---

### B2 — Store slot + `drawingDocState` invariant

**Goal:** `activeDrawingSourceComponents` exists in store, `drawingDocState` does NOT reset it.

---

#### Task 2.1 — Write failing tests

```
[ ] Add tests to packages/app/src/store/__tests__/activeDrawingSourcePartId.spec.ts
[ ] Run pnpm --filter app test:unit -- activeDrawingSourcePartId.spec.ts → RED on new tests
```

Append to `activeDrawingSourcePartId.spec.ts`:

```ts
import type { AssemblyComponentInput } from '@zilventor/kernel/src/adapter/drawing/getProjectorInput';

// ... after existing tests ...

it('activeDrawingSourceComponents defaults to null', () => {
  const state = useAppStore.getState() as unknown as { activeDrawingSourceComponents: unknown };
  expect('activeDrawingSourceComponents' in state).toBe(true);
  expect(state.activeDrawingSourceComponents).toBeNull();
});

it('activeDrawingSourceComponents can be set and read', () => {
  const comps: AssemblyComponentInput[] = [
    { partId: 'pid-1', pose: { translation: { x: 1, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
  ];
  useAppStore.setState({ activeDrawingSourceComponents: comps } as never);
  const s = useAppStore.getState() as unknown as { activeDrawingSourceComponents: AssemblyComponentInput[] | null };
  expect(s.activeDrawingSourceComponents).toEqual(comps);
});

it('drawingDocState does NOT reset activeDrawingSourceComponents', () => {
  const comps: AssemblyComponentInput[] = [
    { partId: 'pid-asm', pose: { translation: { x: 5, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
  ];
  useAppStore.setState({ activeDrawingSourceComponents: comps } as never);

  const fakeDoc = {
    id: 'drw-1', name: 'D', units: 'mm', source: { partPath: 'a.ziasm', sourceKind: 'assembly' },
    properties: {}, sheets: [], activeSheetId: 's1',
  };
  const patch = drawingDocState(fakeDoc as never);
  // patch must NOT contain activeDrawingSourceComponents
  expect((patch as unknown as { activeDrawingSourceComponents?: unknown }).activeDrawingSourceComponents).toBeUndefined();
});
```

---

#### Task 2.2 — Add store field → GREEN

```
[ ] In packages/app/src/store/useAppStore.ts:
    - Add to AppState type (after line 112, activeDrawingSourceFingerprint):
        activeDrawingSourceComponents: import('@zilventor/kernel/src/adapter/drawing/getProjectorInput').AssemblyComponentInput[] | null;
    - Add to create() initial state (after line 349, activeDrawingSourceFingerprint: null):
        activeDrawingSourceComponents: null,
[ ] drawingDocState.ts: NO CHANGE needed (it omits the slot already).
    Add comment to drawingDocState.ts confirming the new slot follows the same contract.
[ ] Run pnpm --filter app test:unit -- activeDrawingSourcePartId.spec.ts → GREEN
[ ] Run pnpm --filter app test:unit → baseline +3 tests, no regressions
[ ] Run pnpm -r typecheck → 0 errors
[ ] Commit: "feat(asm-drawing): add activeDrawingSourceComponents store slot"
```

**Exact store type line (insert after line 112 in useAppStore.ts):**
```ts
  /** Kernel-loaded components for assembly-sourced drawings. Parallel to activeDrawingSourceFingerprint.
   *  Set by CreateDrawingCommand / activateDrawingDocument for assembly sourceKind.
   *  Null for part-sourced drawings and when no drawing is active.
   *  NOT reset by drawingDocState() — same lifecycle contract as activeDrawingSourcePartId. */
  activeDrawingSourceComponents: import('@zilventor/kernel/src/adapter/drawing/getProjectorInput').AssemblyComponentInput[] | null;
```

**Exact initial state line (insert after `activeDrawingSourceFingerprint: null` in the `create()` block):**
```ts
  activeDrawingSourceComponents: null,
```

**Update revert in CreateDrawingCommand (see B4):** `prevActiveDrawingSourceComponents` snapshot.

---

### B3 — `projectViewFromSource` assembly branch

**Goal:** `projectViewFromSource` dispatches on `sourceKind`, returns geometry for assemblies.

---

#### Task 3.1 — Write failing test

```
[ ] Add to packages/app/src/drawing/__tests__/projectViewFromSource.spec.ts
[ ] Run pnpm --filter app test:unit -- projectViewFromSource.spec.ts → RED on new test
```

Look at the existing spec for test fixture patterns. Add:

```ts
// In the existing describe('projectViewFromSource') suite:

it('assembly branch: uses activeDrawingSourceComponents when sourceKind is assembly', async () => {
  // Arrange: set up store with assembly drawing + components slot
  const comps: AssemblyComponentInput[] = [
    { partId: 'pid-asm-A', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
  ];
  useAppStore.setState({
    activeDocument: {
      kind: 'drawing',
      document: {
        id: 'drw-asm', name: 'Asm Drawing', units: 'mm',
        source: { partPath: 'assemblies/cabinet.ziasm', sourceKind: 'assembly' },
        properties: {}, sheets: [], activeSheetId: 's1',
      },
    },
    activeDrawing: {
      id: 'drw-asm', name: 'Asm Drawing', units: 'mm',
      source: { partPath: 'assemblies/cabinet.ziasm', sourceKind: 'assembly' },
      properties: {}, sheets: [], activeSheetId: 's1',
    },
    activePart: null,
    activeAssembly: null,
    activeDrawingSourcePartId: null,
    activeDrawingSourceFingerprint: 'fp-asm-composite',
    activeDrawingSourceComponents: comps,
    kernel: fakeKernel as never,  // reuse existing fakeKernel fixture from the spec
  } as never);

  const { projectViewFromSource } = await import('../projectViewFromSource');
  const result = await projectViewFromSource('front');

  // kernel.getProjectorInput must be called with kind:'assembly' + the components
  expect(fakeKernel.getProjectorInput).toHaveBeenCalledWith({ kind: 'assembly', components: comps });

  // Returns a ProjectViewResult with inputFingerprint from activeDrawingSourceFingerprint
  expect(result.inputFingerprint).toBe('fp-asm-composite');
  expect(result.projection).toBeDefined();
});

it('assembly branch: throws PART_NOT_IN_STORE when components slot is null', async () => {
  useAppStore.setState({
    activeDocument: {
      kind: 'drawing',
      document: {
        id: 'drw-asm2', name: 'D2', units: 'mm',
        source: { partPath: 'assemblies/w.ziasm', sourceKind: 'assembly' },
        properties: {}, sheets: [], activeSheetId: 's1',
      },
    },
    activeDrawing: {
      id: 'drw-asm2', name: 'D2', units: 'mm',
      source: { partPath: 'assemblies/w.ziasm', sourceKind: 'assembly' },
      properties: {}, sheets: [], activeSheetId: 's1',
    },
    activePart: null,
    activeAssembly: null,
    activeDrawingSourceComponents: null,
    activeDrawingSourceFingerprint: null,
    kernel: fakeKernel as never,
  } as never);

  const { projectViewFromSource } = await import('../projectViewFromSource');
  await expect(projectViewFromSource('front')).rejects.toThrow('PART_NOT_IN_STORE');
});
```

**Important:** the existing `fakeKernel` mock must have `getProjectorInput` mock set up to return a synthetic `ProjectorInput` for `{ kind: 'assembly', components: [...] }`. Update the existing fixture if needed:

```ts
// In existing mock setup or beforeEach — ensure getProjectorInput handles assembly args:
fakeKernel.getProjectorInput.mockImplementation(async (args: { kind: string; components?: unknown[] }) => {
  if (args.kind === 'assembly') {
    return { triangles: [], edges: [], bbox: [0, 0, 0, 1, 1, 1] };
  }
  // existing part logic...
  return { triangles: [], edges: [], bbox: [0, 0, 0, 1, 1, 1] };
});
```

---

#### Task 3.2 — Implement assembly branch in `projectViewFromSource.ts` → GREEN

```
[ ] Edit packages/app/src/drawing/projectViewFromSource.ts
[ ] Run pnpm --filter app test:unit -- projectViewFromSource.spec.ts → GREEN
[ ] Run pnpm --filter app test:unit → no regressions
[ ] Run pnpm -r typecheck → 0 errors
[ ] Commit: "feat(asm-drawing): projectViewFromSource assembly branch"
```

Replace the body of `projectViewFromSource` with:

```ts
export async function projectViewFromSource(
  orientation: ViewOrientation,
): Promise<ProjectViewResult> {
  const state = useAppStore.getState();

  const kernel = state.kernel;
  if (!kernel) throw new Error('KERNEL_NOT_READY: kernel not initialized');

  // ---- Assembly branch ----
  const sourceKind = state.activeDrawing?.source.sourceKind;
  if (sourceKind === 'assembly') {
    const components = (state as unknown as { activeDrawingSourceComponents: import('@zilventor/kernel/src/adapter/drawing/getProjectorInput').AssemblyComponentInput[] | null }).activeDrawingSourceComponents;
    if (!components) {
      throw new Error(
        'PART_NOT_IN_STORE: activeDrawingSourceComponents is null. ' +
        'Ensure the assembly drawing source was loaded via CreateDrawingCommand or activateDrawingDocument before placing views.',
      );
    }
    const input = await kernel.getProjectorInput({ kind: 'assembly', components });
    if (input === null) {
      throw new Error('GEOMETRY_NOT_CACHED: getProjectorInput returned null for assembly components.');
    }
    const projection = projectView(input, orientation);
    const inputFingerprint =
      state.activeDrawingSourceFingerprint ??
      `asm-fp-missing`;
    return { projection, inputFingerprint };
  }

  // ---- Part branch (unchanged) ----
  const kernelId: string | null =
    state.activeDrawingSourcePartId ??
    state.activePart?.id ??
    null;

  if (!kernelId) {
    throw new Error(
      'PART_NOT_IN_STORE: activeDrawingSourcePartId is null and activePart is null. ' +
      'Ensure the drawing source part was loaded via CreateDrawingCommand (B0) before placing views.'
    );
  }

  const input = await kernel.getProjectorInput({ kind: 'part', partId: kernelId });
  if (input === null) {
    throw new Error(
      `GEOMETRY_NOT_CACHED: kernel.getProjectorInput returned null for partId "${kernelId}". ` +
      'The source part is not in the kernel cache. Ensure loadDrawingSource (B0) loaded and executed it.'
    );
  }

  const projection = projectView(input, orientation);

  const inputFingerprint =
    state.activeDrawingSourceFingerprint ??
    (state.activePart ? fingerprintPartState(state.activePart) : kernelId);

  return { projection, inputFingerprint };
}
```

---

### B4 — `CreateDrawingCommand` assembly branch

**Goal:** creating an assembly drawing populates `activeDrawingSourceComponents` + `activeDrawingSourceFingerprint`.

---

#### Task 4.1 — Write failing tests

```
[ ] Add to packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts
[ ] Run pnpm --filter app test:unit -- CreateDrawingCommand.spec.ts → RED on new tests
```

Add to the existing describe block (reuse the existing `fakeKernel` / `fakeOpfs` fixture pattern):

```ts
// Mock loadAssemblyForProjection for these tests
vi.mock('../../drawing/loadAssemblyForProjection', () => ({
  loadAssemblyForProjection: vi.fn().mockResolvedValue({
    components: [
      { partId: 'pid-A', pose: { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    ],
    sourceFingerprint: 'fp-asm-mock',
  }),
}));

// ... in describe:

it('apply (assembly source): sets activeDrawingSourceComponents + activeDrawingSourceFingerprint', async () => {
  const { CreateDrawingCommand } = await import('../CreateDrawingCommand');
  const cmd = new CreateDrawingCommand({
    sourcePath: 'assemblies/cabinet.ziasm',
    sourceKind: 'assembly',
  });

  // Need a real AssemblyDocument in the store for the command to pass to loadAssemblyForProjection.
  // Set up the store with an active assembly:
  const fakeAsmDoc: AssemblyDocument = {
    id: 'asm-1', name: 'Cabinet', units: 'mm',
    components: [], constraints: [], properties: {}, colorOverrides: {}, materials: [], colors: {},
  };
  useAppStore.setState({ activeAssembly: fakeAsmDoc, kernel: fakeKernel as never } as never);

  await cmd.apply();

  const s = useAppStore.getState() as unknown as {
    activeDrawingSourceComponents: unknown;
    activeDrawingSourceFingerprint: string | null;
    activeDrawingSourcePartId: string | null;
  };
  expect(s.activeDrawingSourceComponents).toEqual([
    { partId: 'pid-A', pose: { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
  ]);
  expect(s.activeDrawingSourceFingerprint).toBe('fp-asm-mock');
  // Part slot must remain null for assembly drawings
  expect(s.activeDrawingSourcePartId).toBeNull();
});

it('revert (assembly source): clears activeDrawingSourceComponents', async () => {
  const { CreateDrawingCommand } = await import('../CreateDrawingCommand');
  const cmd = new CreateDrawingCommand({
    sourcePath: 'assemblies/cabinet.ziasm',
    sourceKind: 'assembly',
  });
  const fakeAsmDoc: AssemblyDocument = {
    id: 'asm-1', name: 'Cabinet', units: 'mm',
    components: [], constraints: [], properties: {}, colorOverrides: {}, materials: [], colors: {},
  };
  useAppStore.setState({ activeAssembly: fakeAsmDoc, kernel: fakeKernel as never } as never);

  await cmd.apply();
  await cmd.revert();

  const s = useAppStore.getState() as unknown as { activeDrawingSourceComponents: unknown };
  expect(s.activeDrawingSourceComponents).toBeNull();
});
```

---

#### Task 4.2 — Implement assembly branch in `CreateDrawingCommand.ts` → GREEN

```
[ ] Edit packages/app/src/commands/CreateDrawingCommand.ts
[ ] Run pnpm --filter app test:unit -- CreateDrawingCommand.spec.ts → GREEN
[ ] Run pnpm --filter app test:unit → no regressions
[ ] Run pnpm -r typecheck → 0 errors
[ ] Commit: "feat(asm-drawing): CreateDrawingCommand assembly branch — loadAssemblyForProjection"
```

**Changes to `CreateDrawingCommand.ts`:**

1. Add `private prevActiveDrawingSourceComponents: AssemblyComponentInput[] | null = null;` to the class fields (import type from `@zilventor/kernel/src/adapter/drawing/getProjectorInput`).

2. In `apply()`, snapshot the existing slot before:
   ```ts
   this.prevActiveDrawingSourceComponents = (state as unknown as { activeDrawingSourceComponents: AssemblyComponentInput[] | null }).activeDrawingSourceComponents;
   ```

3. Replace the `if (this.opts.sourceKind === 'part')` block with:
   ```ts
   if (this.opts.sourceKind === 'part') {
     // ... existing loadDrawingSource code unchanged ...
   } else if (this.opts.sourceKind === 'assembly') {
     // Assembly branch: load all visible parts + compute composite fingerprint.
     try {
       const { loadAssemblyForProjection } = await import('../drawing/loadAssemblyForProjection');
       const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
       const kernel = useAppStore.getState().kernel;
       const asmDoc = useAppStore.getState().activeAssembly;
       if (kernel && asmDoc) {
         const opfs = await Opfs.forNavigator();
         const { components, sourceFingerprint } = await loadAssemblyForProjection({
           asmPath: this.opts.sourcePath,
           asmDoc,
           opfs,
           kernel,
         });
         useAppStore.setState({
           activeDrawingSourceComponents: components,
           activeDrawingSourceFingerprint: sourceFingerprint,
         } as never);
       }
     } catch (e) {
       console.warn('[CreateDrawingCommand] assembly source load failed:', (e as Error).message);
     }
   }
   ```

4. In `revert()`, restore the snapshot:
   ```ts
   useAppStore.setState({
     activeDrawingSourcePartId: this.prevActiveDrawingSourcePartId,
     activeDrawingSourceFingerprint: this.prevActiveDrawingSourceFingerprint,
     activeDrawingSourceComponents: this.prevActiveDrawingSourceComponents,
   } as never);
   ```

---

### B5 — `activateDrawingDocument` assembly branch (reopen path)

**Goal:** reopening an assembly `.zidw` loads components + fingerprint (not bail).

---

#### Task 5.1 — Write failing tests

```
[ ] Edit packages/app/src/drawing/__tests__/activateDrawingDocument.spec.ts
[ ] Run pnpm --filter app test:unit -- activateDrawingDocument.spec.ts → RED on new tests
```

Replace / extend the existing "assembly source: setActiveDocument called, source-load skipped, slots null" test:

```ts
// Add new mock at top of the file (alongside existing vi.mock for loadDrawingSource):
vi.mock('../loadAssemblyForProjection', () => ({
  loadAssemblyForProjection: vi.fn().mockResolvedValue({
    components: [
      { partId: 'pid-asm-A', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
    ],
    sourceFingerprint: 'fp-asm-reopened',
  }),
}));

// Replace the existing 'assembly source' test with:
it('assembly source (happy path): loads components, sets slots, status "Opened"', async () => {
  const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
  const { activateDrawingDocument } = await import('../activateDrawingDocument');
  const kernel = makeKernel();
  const opfs = makeOpfs(true);
  const asmDoc: DrawingDocument = {
    ...baseDoc,
    id: 'drw-asm',
    source: { partPath: 'assemblies/wardrobe.ziasm', sourceKind: 'assembly' },
  };

  // The assembly document must be loadable: mock opfs.read to return a parseable ziasm.
  // activateDrawingDocument must unpack the .ziasm and pass it to loadAssemblyForProjection.
  // (Implementation detail: we mock loadAssemblyForProjection so the bytes don't need to be real.)

  await activateDrawingDocument(asmDoc, { kernel: kernel as never, opfs: opfs as never });

  // loadAssemblyForProjection was called
  expect(loadAssemblyForProjection).toHaveBeenCalled();

  const s = useAppStore.getState() as unknown as {
    activeDrawingSourceComponents: unknown;
    activeDrawingSourceFingerprint: string | null;
    activeDrawingSourcePartId: string | null;
  };
  expect(s.activeDrawingSourceComponents).toEqual([
    { partId: 'pid-asm-A', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } },
  ]);
  expect(s.activeDrawingSourceFingerprint).toBe('fp-asm-reopened');
  expect(s.activeDrawingSourcePartId).toBeNull();
  expect(useAppStore.getState().statusMessage).toBe('Opened');
});

it('assembly source (load failure): drawing activated, slots null, setStatus notice', async () => {
  const { loadAssemblyForProjection } = await import('../loadAssemblyForProjection');
  (loadAssemblyForProjection as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    new Error('OPFS_READ_FAILED: assemblies/wardrobe.ziasm')
  );
  const { activateDrawingDocument } = await import('../activateDrawingDocument');
  const kernel = makeKernel();
  const opfs = makeOpfs(true);
  const asmDoc: DrawingDocument = {
    ...baseDoc,
    id: 'drw-asm2',
    source: { partPath: 'assemblies/wardrobe.ziasm', sourceKind: 'assembly' },
  };

  await activateDrawingDocument(asmDoc, { kernel: kernel as never, opfs: opfs as never });

  const doc = useAppStore.getState().activeDocument;
  expect(doc?.kind).toBe('drawing');

  const s = useAppStore.getState() as unknown as { activeDrawingSourceComponents: unknown };
  expect(s.activeDrawingSourceComponents).toBeNull();
  expect(useAppStore.getState().statusMessage).toMatch(/assembly.*failed|failed.*assembly|source.*not found/i);
});
```

---

#### Task 5.2 — Implement assembly branch in `activateDrawingDocument.ts` → GREEN

```
[ ] Edit packages/app/src/drawing/activateDrawingDocument.ts
[ ] Run pnpm --filter app test:unit -- activateDrawingDocument.spec.ts → GREEN
[ ] Run pnpm --filter app test:unit → no regressions
[ ] Run pnpm -r typecheck → 0 errors
[ ] Commit: "feat(asm-drawing): activateDrawingDocument assembly branch — replace bail with loadAssemblyForProjection"
```

The import section at the top of `activateDrawingDocument.ts` must import the new module type:

```ts
import type { KernelForLoad, OpfsForLoad } from './loadDrawingSource';
import type { AssemblyComponentInput } from '@zilventor/kernel/src/adapter/drawing/getProjectorInput';
```

Replace the `if (doc.source.sourceKind === 'assembly') { ... return; }` block with:

```ts
  if (doc.source.sourceKind === 'assembly') {
    // Assembly branch: unpack the .ziasm, load all visible leaf parts, build composed poses.
    try {
      const { loadAssemblyForProjection } = await import('./loadAssemblyForProjection');
      const { unpackAssembly } = await import('@zilventor/kernel/src/storage/AssemblyPacker');
      const asmBytes = await opfs.read(doc.source.partPath);
      const asmDoc = await unpackAssembly(asmBytes);
      const { components, sourceFingerprint } = await loadAssemblyForProjection({
        asmPath: doc.source.partPath,
        asmDoc,
        opfs,
        kernel,
      });
      useAppStore.setState({
        activeDrawingSourceComponents: components,
        activeDrawingSourceFingerprint: sourceFingerprint,
      } as never);
      useAppStore.getState().setStatus('Opened');
    } catch (e) {
      console.warn('[activateDrawingDocument] assembly source load failed:', (e as Error).message);
      useAppStore.getState().setStatus(
        'Assembly source load failed — Regenerate disabled. Ensure all assembly parts are saved.',
      );
      useAppStore.setState({
        activeDrawingSourceComponents: null,
        activeDrawingSourceFingerprint: null,
        activeDrawingSourcePartId: null,
      } as never);
    }
    return;
  }
```

Note: `unpackAssembly` is already used by `SubAssemblyCache.ts:3` via `import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker'` — same import path.

Also add null reset of the new slot in the part-source error handler (after the existing `activeDrawingSourceFingerprint: null` in the catch block):
```ts
activeDrawingSourceComponents: null,
```

---

### B6 — E2E T-6-19 + perf T63j

**Goal:** real end-to-end test using actual assembly geometry; perf baseline documented.

---

#### Task 6.1 — Write and run T-6-19 e2e → RED first, then GREEN after B1–B5 implementation

```
[ ] Create tests/e2e/drawing/T-6-19-assembly-drawing-projection.spec.ts (code below)
[ ] Run pnpm test:e2e -- tests/e2e/drawing/T-6-19-assembly-drawing-projection.spec.ts → RED
    (expected: PART_NOT_IN_STORE or no edges — assembly branch not yet wired in previous tasks)
    NOTE: B1-B5 implementation should already be done before this step; this verifies integration.
[ ] After B1–B5: pnpm test:e2e -- tests/e2e/drawing/T-6-19-assembly-drawing-projection.spec.ts → GREEN
[ ] Run full pnpm test:e2e → no regressions
[ ] Commit: "test(asm-drawing): T-6-19 assembly drawing e2e — 2-part round-trip + stale+regen"
```

**CRITICAL: No masked stand-ins.** The e2e MUST drive the real `loadAssemblyForProjection` / `packDrawing` path. The file-reopen feature shipped a masked e2e first (implementer used `packDrawingNative` stand-in) and it hid a production main-thread hang. Verify by checking that edges from both parts appear in the view.

```ts
// tests/e2e/drawing/T-6-19-assembly-drawing-projection.spec.ts
/**
 * T-6-19 — Assembly-sourced drawing projection: real 2-part assembly → base view
 * spans BOTH parts → pack→unpack round-trip → edit source → reopen → STALE → Regenerate.
 *
 * Build path:
 *   1. Build Box Part A (50×50×30) via UI; save its kernel bytes to OPFS at 'parts/t619-A.zipt'.
 *      Capture partIdA.
 *   2. Build Box Part B (40×40×20) via UI (must be BEFORE creating the drawing — Model tab
 *      disappears after CreateDrawingCommand); save bytes to OPFS at 'parts/t619-B.zipt'.
 *      Capture partIdB.
 *   3. Build an AssemblyDocument with both components at distinct poses; write a packed .ziasm
 *      to OPFS at 'assemblies/t619.ziasm'; set it as activeAssembly in the store.
 *   4. Drive CreateDrawingCommand({ sourcePath:'assemblies/t619.ziasm', sourceKind:'assembly' }).
 *      Verifies activeDrawingSourceComponents is populated (not empty) and fingerprint is set.
 *   5. AddBaseViewCommand → assert visibleEdges.length > 0 (edges from BOTH parts present).
 *   6. REAL pack→unpack round-trip (separate evaluate): packDrawing → unpackDrawing (same pattern
 *      as T-6-18 step 4). Store reopenedDoc in globalThis.__t619_reopenedDoc.
 *      Assert views preserved + inputFingerprint set.
 *   7. Overwrite OPFS 'parts/t619-A.zipt' with Part B bytes (simulates source part edited).
 *   8. activateDrawingDocument(reopenedDoc, ...) → reads new bytes → different fingerprint → stale.
 *   9. Assert stale marker visible. Click Regenerate. Assert stale clears + edges > 0.
 *
 * Drawing commands are NOT window-exposed — dynamic import inside page.evaluate.
 * Same pattern as T-6-17 and T-6-18. No mocks for loadAssemblyForProjection.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

const ASM_PATH = 'assemblies/t619.ziasm';
const PART_A_PATH = 'parts/t619-A.zipt';
const PART_B_PATH = 'parts/t619-B.zipt';

test('T-6-19: 2-part assembly drawing — base view + pack→unpack + stale + regen round-trip', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(90_000);
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // ── Step 1: Build Part A (50×50×30) via UI ──────────────────────────────────
  await buildBox(page, { width: 50, height: 50, depth: 30 });

  // Save Part A bytes to OPFS at PART_A_PATH; capture partIdA.
  const { partIdA } = await page.evaluate(
    async ({ partAPath }: { partAPath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
              saveToBytes(id: string): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-19 step 1: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytesA = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(partAPath, bytesA);
      return { partIdA: s.activePart.id };
    },
    { partAPath: PART_A_PATH },
  );

  // ── Step 2: Build Part B (40×40×20) via UI (must be before drawing creation) ─
  await buildBox(page, { width: 40, height: 40, depth: 20 });

  // Save Part B bytes to OPFS at PART_B_PATH; capture partIdB and stash bytesB.
  const { partIdB } = await page.evaluate(
    async ({ partBPath }: { partBPath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
              saveToBytes(id: string): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-19 step 2: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytesB = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(partBPath, bytesB);
      // Stash bytesB in globalThis for the source-edit step later.
      (globalThis as unknown as Record<string, unknown>)['__t619_bytesB'] = bytesB;
      return { partIdB: s.activePart.id };
    },
    { partBPath: PART_B_PATH },
  );

  // ── Step 3: Pack a .ziasm for the 2-part assembly and seed it to OPFS ────────
  await page.evaluate(
    async ({ asmPath, partAPath, partBPath, partIdA, partIdB }: {
      asmPath: string; partAPath: string; partBPath: string;
      partIdA: string; partIdB: string;
    }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      const asmDoc = {
        id: 'asm-t619',
        name: 'T619 Assembly',
        units: 'mm',
        components: [
          {
            id: partIdA, partPath: partAPath,
            position: { x: 60, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
            visible: true, flexible: false,
          },
          {
            id: partIdB, partPath: partBPath,
            position: { x: -40, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
            visible: true, flexible: false,
          },
        ],
        constraints: [],
        groundedComponentPaths: [],
        bomItemNumbers: {},
        parameters: {},
        colorOverrides: {},
        colors: {},
      };

      // Use the __zilventorPackAssembly dev hook (same as seedSubAssemblyZiasm helper).
      const w = window as unknown as {
        __zilventorPackAssembly: (doc: unknown, thumb: Uint8Array) => Promise<Uint8Array>;
      };
      const png = new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
      ]);
      const archive = await w.__zilventorPackAssembly(asmDoc, png);
      await opfsWrite(asmPath, archive);

      // Set activeAssembly in the store so CreateDrawingCommand can read it.
      const store = (window as unknown as {
        __zilventorStore: { setState(p: unknown): void };
      }).__zilventorStore;
      store.setState({ activeAssembly: asmDoc } as never);
    },
    { asmPath: ASM_PATH, partAPath: PART_A_PATH, partBPath: PART_B_PATH, partIdA, partIdB },
  );

  // ── Step 4 + 5: CreateDrawingCommand + AddBaseViewCommand ─────────────────────
  const { sheetId, baseViewId, baseViewEdgeCount } = await page.evaluate(
    async ({ asmPath }: { asmPath: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: {
              kind: string;
              document: {
                id: string;
                sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: unknown[] }; inputFingerprint?: string }> }>;
              };
            } | null;
            activeDrawingSourceComponents: unknown[] | null;
            activeDrawingSourceFingerprint: string | null;
          };
        };
      }).__zilventorStore;

      // CreateDrawingCommand reads activeAssembly from the store (set in step 3).
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath: asmPath, sourceKind: 'assembly' }).apply();

      const afterCreate = store.getState();
      if (!afterCreate.activeDrawingSourceComponents || afterCreate.activeDrawingSourceComponents.length === 0) {
        throw new Error(`T-6-19: activeDrawingSourceComponents empty after CreateDrawingCommand — loadAssemblyForProjection not wired`);
      }
      if (!afterCreate.activeDrawingSourceFingerprint) {
        throw new Error('T-6-19: activeDrawingSourceFingerprint not set after CreateDrawingCommand');
      }
      if (afterCreate.activeDrawingSourceComponents.length < 2) {
        throw new Error(`T-6-19: expected ≥2 components, got ${afterCreate.activeDrawingSourceComponents.length} — Part A or B not loaded`);
      }

      const drawingDoc = afterCreate.activeDocument!.document;
      const sheetId = drawingDoc.sheets[0]!.id;

      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId,
        positionMm: { x: 100, y: 100 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      const s2 = store.getState();
      const doc2 = s2.activeDocument?.kind === 'drawing' ? s2.activeDocument.document : null;
      const sheet = doc2?.sheets.find((sh) => sh.id === sheetId);
      const baseView = sheet?.views.find((v) => v.kind === 'base');
      if (!baseView?.projection || baseView.projection.visibleEdges.length === 0) {
        throw new Error(`T-6-19: base view has no edges after AddBaseViewCommand. projection=${JSON.stringify(baseView?.projection)}`);
      }
      if (!baseView.inputFingerprint) {
        throw new Error('T-6-19: base view inputFingerprint not set');
      }

      return {
        sheetId,
        drawingId: drawingDoc.id,
        baseViewId: baseView.id,
        baseViewEdgeCount: baseView.projection.visibleEdges.length,
      };
    },
    { asmPath: ASM_PATH },
  );

  expect(baseViewEdgeCount).toBeGreaterThan(0);

  // Switch to drawing tab and verify the base view renders.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });
  const edgeCount = await page.locator(`g[data-view-id="${baseViewId}"] polyline`).count();
  expect(edgeCount).toBeGreaterThan(0);

  // ── Step 6: REAL pack→unpack round-trip (separate evaluate — same pattern as T-6-18 step 4) ─
  const { viewCountAfterUnpack, viewHasFingerprint } = await page.evaluate(async () => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument: { kind: string; document: unknown } | null;
        };
      };
    }).__zilventorStore;

    const state = store.getState();
    if (!state.activeDocument || state.activeDocument.kind !== 'drawing') {
      throw new Error('T-6-19 step 6: activeDocument is not a drawing');
    }
    const inMemoryDoc = state.activeDocument.document;

    const { packDrawing, unpackDrawing } = await import('/src/storage/DrawingPacker.ts');
    const packedBytes = await packDrawing(inMemoryDoc as Parameters<typeof packDrawing>[0]);
    const reopenedDoc = await unpackDrawing(packedBytes);

    (globalThis as unknown as Record<string, unknown>)['__t619_reopenedDoc'] = reopenedDoc;

    const reopenedSheet = (reopenedDoc as { sheets: Array<{ views: Array<{ kind: string; inputFingerprint?: string }> }> }).sheets[0];
    const viewCountAfterUnpack = reopenedSheet?.views.length ?? 0;
    const reopenedBaseView = reopenedSheet?.views.find((v) => v.kind === 'base');
    const viewHasFingerprint = !!(reopenedBaseView?.inputFingerprint);
    return { viewCountAfterUnpack, viewHasFingerprint };
  });

  expect(viewCountAfterUnpack, 'reopenedDoc must have ≥1 view after pack→unpack').toBeGreaterThanOrEqual(1);
  expect(viewHasFingerprint, 'reopenedDoc base view must carry inputFingerprint').toBe(true);

  // ── Step 7: Overwrite OPFS Part A with Part B bytes (simulate source edit) ────
  await page.evaluate(
    async ({ partAPath }: { partAPath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }
      const bytesB = (globalThis as unknown as Record<string, unknown>)['__t619_bytesB'] as Uint8Array;
      if (!bytesB) throw new Error('T-6-19 step 7: bytesB not in globalThis');
      await opfsWrite(partAPath, bytesB);
    },
    { partAPath: PART_A_PATH },
  );

  // ── Step 8: activateDrawingDocument with the deserialized reopenedDoc ──────────
  await page.evaluate(
    async ({ asmPath }: { asmPath: string }) => {
      async function opfsRead(path: string): Promise<Uint8Array> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: false });
        const file = await fh.getFile();
        return new Uint8Array(await file.arrayBuffer());
      }
      async function opfsExists(path: string): Promise<boolean> {
        try { await opfsRead(path); return true; } catch { return false; }
      }

      const opfsShim = { exists: opfsExists, read: opfsRead };
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): { kernel: unknown };
        };
      }).__zilventorStore;
      const kernel = store.getState().kernel;

      const reopenedDoc = (globalThis as unknown as Record<string, unknown>)['__t619_reopenedDoc'];
      if (!reopenedDoc) throw new Error('T-6-19 step 8: reopenedDoc not in globalThis');

      const { activateDrawingDocument } = await import('/src/drawing/activateDrawingDocument.ts');
      await activateDrawingDocument(reopenedDoc as never, {
        kernel: kernel as never,
        opfs: opfsShim as never,
      });
      void asmPath;
    },
    { asmPath: ASM_PATH },
  );

  // ── Step 9: Assert stale marker appears; Regenerate clears it ─────────────────
  await expect(page.locator('[data-stale-marker]').first()).toBeVisible({ timeout: 10_000 });
  const staleCountBefore = await page.locator('[data-stale-marker]').count();
  expect(staleCountBefore).toBeGreaterThan(0);

  await page.locator('[data-stale-marker]').first().click();

  await expect(async () => {
    const count = await page.locator('[data-stale-marker]').count();
    expect(count).toBeLessThan(staleCountBefore);
  }).toPass({ timeout: 15_000 });

  // Edges still present after regen.
  const edgeCountAfterRegen = await page.locator(`g[data-view-id="${baseViewId}"] polyline`).count();
  expect(edgeCountAfterRegen).toBeGreaterThan(0);
});
```

---

#### Task 6.2 — Perf T63j

```
[ ] Create tests/perf/assembly-drawing-projection.perf.spec.ts (code below)
[ ] Run pnpm test:e2e -- tests/perf/assembly-drawing-projection.perf.spec.ts → documents real p95
[ ] Commit: "test(asm-drawing): T63j assembly projection p95 perf test"
```

```ts
// tests/perf/assembly-drawing-projection.perf.spec.ts
/**
 * T63j — Assembly drawing projection p95 performance.
 *
 * Budget: ~500ms (working budget; real number documented from first run).
 * Fixture: ~10-leaf assembly (10 simple box parts at distinct poses).
 * Method: window hook __zilventorAsmProjectViewMs registered in App.tsx useEffect (dev mode only).
 *
 * NOTE TO IMPLEMENTER: Register the __zilventorAsmProjectViewMs window hook in App.tsx
 * (alongside the existing __zilventorProjectViewMs hook at App.tsx:2838).
 * The hook should:
 *   1. Set up a 10-leaf in-memory assembly with pre-loaded kernel parts.
 *   2. Set activeDrawingSourceComponents on the store.
 *   3. Call projectViewFromSource('front') N times and return p95.
 *
 * Wire the hook in the same useEffect block that houses __zilventorProjectViewMs (App.tsx:2838-3083).
 * Add cleanup in the return of that useEffect.
 */
import { test, expect } from '@playwright/test';

test('Perf T63j: 10-leaf assembly projection p95 < 500ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorAsmProjectViewMs?: unknown }).__zilventorAsmProjectViewMs === 'function',
    undefined,
    { timeout: 30_000 },
  );

  const p95 = await page.evaluate(
    () => (window as { __zilventorAsmProjectViewMs?: (n: number) => Promise<number> }).__zilventorAsmProjectViewMs!(20),
  );

  console.log(`[perf] T63j assembly projection p95 = ${p95.toFixed(2)} ms (budget 500ms)`);
  expect(p95).toBeLessThan(500);
});
```

**Hook implementation to add to App.tsx** (in the same `useEffect` block that houses `__zilventorProjectViewMs`, after App.tsx:3074 `delete w.__zilventorProjectViewMs`):

```ts
// T63j: assembly projection p95 — 10 synthetic leaves, no real OPFS.
// Pre-loads 10 copies of the active part into the kernel and uses static identity poses.
// IMPORTANT: snapshot all store fields ONCE before the loop; use a synthetic fixture object
// inside the loop (do NOT spread+mutate the real activeDrawing per-iteration); restore ALL
// mutated fields in a finally block so the hook is non-destructive.
(w as unknown as { __zilventorAsmProjectViewMs: (n: number) => Promise<number> }).__zilventorAsmProjectViewMs = async (n: number): Promise<number> => {
  const kernel = useAppStore.getState().kernel;
  const activePart = useAppStore.getState().activePart;
  if (!kernel || !activePart) return 0;

  // Snapshot the relevant store fields ONCE before the loop.
  const snapActiveDocument = useAppStore.getState().activeDocument;
  const snapActiveDrawing = useAppStore.getState().activeDrawing;
  const snapActivePart = useAppStore.getState().activePart;
  const snapActiveAssembly = useAppStore.getState().activeAssembly;
  const snapFingerprint = useAppStore.getState().activeDrawingSourceFingerprint;
  const snapComponents = (useAppStore.getState() as unknown as { activeDrawingSourceComponents: unknown }).activeDrawingSourceComponents;

  // Reuse the existing kernel part ID (already loaded) for all 10 synthetic leaves.
  const partId = activePart.id;
  const syntheticComponents = Array.from({ length: 10 }, (_, i) => ({
    partId,
    pose: {
      translation: { x: i * 60, y: 0, z: 0 },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    },
  }));

  // Build a synthetic drawing fixture using a fixed object — NOT the real activeDrawing.
  // This avoids mutating the real activeDrawing doc inside the loop.
  const syntheticDrawing = {
    id: 'perf-t63j-drawing',
    name: 'Perf Fixture',
    units: 'mm' as const,
    source: { partPath: 'perf/fixture.ziasm', sourceKind: 'assembly' as const },
    properties: {},
    sheets: [],
    activeSheetId: 'none',
  };

  const samples: number[] = [];
  try {
    // Set the synthetic fixture ONCE before the loop (not per-iteration).
    useAppStore.setState({
      activeDrawing: syntheticDrawing,
      activeDocument: { kind: 'drawing', document: syntheticDrawing } as never,
      activeDrawingSourceFingerprint: 'perf-fp',
      activeDrawingSourceComponents: syntheticComponents,
      activePart: null,
      activeAssembly: null,
    } as never);

    const { projectViewFromSource } = await import('./drawing/projectViewFromSource');
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await projectViewFromSource('front');
      samples.push(performance.now() - t0);
    }
  } finally {
    // Restore ALL mutated store fields so the hook is non-destructive.
    useAppStore.setState({
      activeDocument: snapActiveDocument,
      activeDrawing: snapActiveDrawing,
      activePart: snapActivePart,
      activeAssembly: snapActiveAssembly,
      activeDrawingSourceFingerprint: snapFingerprint,
      activeDrawingSourceComponents: snapComponents,
    } as never);
  }

  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.95)] ?? 0;
};
```

Add cleanup in the return():
```ts
delete (w as unknown as { __zilventorAsmProjectViewMs?: unknown }).__zilventorAsmProjectViewMs;
```

---

## Commit + gate checklist

After all tasks:
```
[ ] pnpm -r test:unit           → ≥ 2822 + new tests, 0 failures
[ ] pnpm -r typecheck           → 0 errors
[ ] pnpm lint                   → 0 errors
[ ] pnpm test:e2e -- tests/e2e/drawing/T-6-19-assembly-drawing-projection.spec.ts → PASS
[ ] pnpm test:e2e               → existing suite still passes
[ ] pnpm test:e2e -- tests/perf/assembly-drawing-projection.perf.spec.ts → p95 < 500ms (document real number)
[ ] packages/app/src/test-setup.ts localStorage shim — NOT touched
```

---

## Key gotchas baked in

1. **drawingDocState must NOT reset `activeDrawingSourceComponents`** — same as `activeDrawingSourcePartId`. ~20 drawing-edit commands call `drawingDocState`; if the new slot were included in that function it would be nulled on every view placement.

2. **`activateDrawingDocument` must call `unpackAssembly` + `loadAssemblyForProjection` — not bail** — the old bail at lines 29-35 (`activateDrawingDocument.ts`) is the assembly disable to REPLACE. After this feature, the assembly bail is gone.

3. **`handleRegenerate` has NO assembly guard** — `DrawingCanvas.tsx:897-901` only guards `section` and `detail` kinds. The assembly "disable" is purely passive (null slots → `PART_NOT_IN_STORE` from `projectViewFromSource`). After populating the slots, Regenerate works automatically. No UI change needed.

4. **E2E must use REAL `loadAssemblyForProjection`** — no mock stand-ins. The file-reopen feature (commit `600b56c`) shipped a masked e2e that hid a main-thread deadlock in `writeTarGz`. Trust-but-verify caught it only after the implementer swapped to the real packer. Same discipline applies here.

5. **`CreateDrawingCommand` reads `activeAssembly` from the store** — the command is called when an assembly is active, so `useAppStore.getState().activeAssembly` will be non-null. In e2e, set `activeAssembly` via `setState` before calling the command (same pattern as T-6-17).

6. **pathKey serializer** — `pathKey(leaf.componentPath)` joins with a single space: `['c1', 'c2'].join(' ')`. The composedPoses map is keyed by this same function. No other serializer exists.

7. **Part branch of `projectViewFromSource` must remain byte-for-byte unchanged** — only prepend the assembly branch before the existing part logic.
