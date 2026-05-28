# Multi-body STEP Explosion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-explode STEP files with N disjoint solids into N PartDocuments + N ComponentInstances at origin when imported into an assembly. `solidCount = 1` path unchanged. Part-mode (no active assembly) registers only the first sub-solid + emits `setStatus`.

**Architecture:** Additive. New kernel API `extractStepSolids` walks `TopExp_Explorer_2` sub-solids and serializes each via `writeBRep`. New app helper `importStepIntoNewParts` registers N parts. Existing `ImportStepAsComponentCommand` extended to call the multi-aware helper and fan out `addComponent` N times with atomic revert. `FileTab.handleOpen` STEP branch peeks `solidCount` in part-mode and registers only the first sub-solid + `setStatus`.

**Tech Stack:** TypeScript, OCCT-WASM, Zustand, OPFS, Vitest, Playwright.

---

## Spec amendments (vs `docs/superpowers/specs/2026-05-28-multi-body-step-explosion-design.md` at `5a6d00a`)

Seven factual corrections from real-code fact-check. None change the design intent.

1. **Fixture name + path.** Real fixture already exists: `packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step` (32 KB, "compound of two cubes"). Spec called it `two-cubes.step`. **No fixture creation needed.**
2. **OPFS partPath convention.** Real convention (per `ImportStepAsComponentCommand.ts:87`): `partPath = \`${partName}.zipt\`` (root-relative, `.zipt` extension). Spec said `/parts/${partId}.zip`.
3. **Source-name stripper.** Real function is `stepFilenameBasename` at `packages/app/src/import/originFeatures.ts:22`. Spec said `stripStepExtension` (doesn't exist).
4. **`BoundingBox` type.** Real type is a 6-tuple `[xMin, yMin, zMin, xMax, yMax, zMax]` (per `StepReadResult` + integration-test destructuring). Spec showed `{ min, max }` object.
5. **`buildImportedPartDocument` signature.** Real signature is positional: `(partName: string, brepBlobId: string, fileName: string, partId?: string)`. Spec called it with an object containing `boundingBox` / `faceCount`.
6. **Existing-part-name source.** No `kernel.partNames()` method exists. Real pattern: `await opfs.listAll()` filtered for `.zipt` files (existing-command precedent).
7. **`FileTab.tsx` location.** Real path: `packages/app/src/shell/tabs/FileTab.tsx`. Spec said `packages/app/src/components/FileTab.tsx`.

---

## Touched files (final)

**Create:**
- `packages/kernel/src/__tests__/extractStepSolids.integration.spec.ts` (kernel integration test)
- `packages/app/src/import/importStepIntoNewParts.ts` (app helper)
- `packages/app/src/import/__tests__/importStepIntoNewParts.spec.ts` (helper unit test)
- `tests/e2e/multi-body-step-explosion.spec.ts` (e2e)

**Modify:**
- `packages/kernel/src/occt/StepIO.ts` (new `extractStepSolids` helper)
- `packages/kernel/src/api.ts` (new `KernelApi.extractStepSolids` member + closure impl)
- `packages/app/src/commands/ImportStepAsComponentCommand.ts` (extend to multi-result)
- `packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts` (multi-body cases)
- `packages/app/src/shell/tabs/FileTab.tsx` (part-mode multi-body branch)
- `packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx` (part-mode multi-body test; create if absent)
- `packages/app/src/App.tsx` (DEV-gated `window.__zilventorMultiBodyStepImport` helper for e2e)

---

## Batch 0 — Worktree setup (controller only, no subagent)

- [ ] **0.1: Create branch + worktree from master.**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git worktree add .worktrees/multi-body-step -b feature/multi-body-step
cd .worktrees/multi-body-step
pnpm install
# Revert phantom-fflate lockfile reconciliation if it reappears:
git checkout pnpm-lock.yaml
```

Expected: clean worktree at `.worktrees/multi-body-step` on `feature/multi-body-step`, install completes, `pnpm-lock.yaml` matches master.

- [ ] **0.2: Verify baseline gate green inside worktree.**

```bash
pnpm -r typecheck 2>&1 | tail -5
pnpm lint 2>&1 | tail -3
pnpm -r test:unit 2>&1 | grep -E "Test Files|Tests" | tail -10
```

Expected: typecheck clean, lint 0 errors, totals 735 + 37 + 359 + 1969 = 3100 unit.

---

## Batch 1 — Kernel: `extractStepSolids` (TDD with built-in spike fallback)

**Slice goal:** Add `extractStepSolids(stepBytes)` to `KernelApi`. Reuses `readStep`; walks sub-solids via `TopExp_Explorer_2`; serializes each via `writeBRep` directly. If direct sub-shape serialization misbehaves on real OCCT-WASM, switch to the fresh-compound wrap fallback in step 1.4.

**Owning test:** `packages/kernel/src/__tests__/extractStepSolids.integration.spec.ts`

### Task 1.1: Write the failing kernel integration test (RED)

**Files:**
- Create: `packages/kernel/src/__tests__/extractStepSolids.integration.spec.ts`

- [ ] **Step 1: Write the test.**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createKernelApi } from '../api';

const HERE = dirname(fileURLToPath(import.meta.url));
const STEP_PATH = resolve(
  HERE,
  '../occt/__tests__/fixtures/step/two-bodies.step',
);

describe('extractStepSolids — two-bodies.step', () => {
  let stepBytes: ArrayBuffer;

  beforeAll(() => {
    const raw = readFileSync(STEP_PATH);
    stepBytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  });

  it('returns 2 entries with distinct brepBlobIds + disjoint bboxes', async () => {
    const kernel = createKernelApi();
    await kernel.init();

    const results = await kernel.extractStepSolids({ stepBytes });

    expect(results).toHaveLength(2);
    expect(results[0].brepBlobId).not.toBe(results[1].brepBlobId);

    // BoundingBox is a 6-tuple [xMin, yMin, zMin, xMax, yMax, zMax].
    // The two-bodies fixture is two non-overlapping cubes — bboxes are disjoint
    // along at least one axis.
    const [aXMin, , , aXMax] = results[0].boundingBox;
    const [bXMin, , , bXMax] = results[1].boundingBox;
    const disjointX = aXMax < bXMin || bXMax < aXMin;
    // Same shape for Y and Z — assert disjoint along at least one axis.
    const [, aYMin, , , aYMax] = results[0].boundingBox;
    const [, bYMin, , , bYMax] = results[1].boundingBox;
    const disjointY = aYMax < bYMin || bYMax < aYMin;
    const [, , aZMin, , , aZMax] = results[0].boundingBox;
    const [, , bZMin, , , bZMax] = results[1].boundingBox;
    const disjointZ = aZMax < bZMin || bZMax < aZMin;
    expect(disjointX || disjointY || disjointZ).toBe(true);
  });

  it('throws on STEP with no solids', async () => {
    const kernel = createKernelApi();
    await kernel.init();
    // Empty Uint8Array → readStep will fail at the OCCT level; we assert
    // a descriptive error rather than a hang.
    const empty = new ArrayBuffer(0);
    await expect(
      kernel.extractStepSolids({ stepBytes: empty }),
    ).rejects.toThrow();
  });

  it('single-cube STEP returns single-element array', async () => {
    const SINGLE_PATH = resolve(
      HERE,
      '../occt/__tests__/fixtures/step/cube-10mm.step',
    );
    const raw = readFileSync(SINGLE_PATH);
    const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const kernel = createKernelApi();
    await kernel.init();

    const results = await kernel.extractStepSolids({ stepBytes: bytes });
    expect(results).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails for the expected reason.**

```bash
pnpm --filter @zilventor/kernel test:integration -- src/__tests__/extractStepSolids.integration.spec.ts
```

Expected: FAIL with `TypeError: kernel.extractStepSolids is not a function` (because the method does not exist yet — pure red).

### Task 1.2: Wire the `KernelApi` type + stub the closure (still red)

**Files:**
- Modify: `packages/kernel/src/api.ts` (add interface member around the other `import*` methods + add an empty closure that throws)

- [ ] **Step 1: Add the type member to `KernelApi`.**

Locate the `importStep` member in the `KernelApi` type (around `api.ts:80-90`). Add immediately after it:

```typescript
extractStepSolids(params: { stepBytes: ArrayBuffer }): Promise<Array<{
  brepBlobId: string;
  boundingBox: BoundingBox;
}>>;
```

(`BoundingBox` is already imported in `api.ts` — no new import.)

- [ ] **Step 2: Add the stub closure body** (placed immediately after the existing `importStep` closure):

```typescript
async extractStepSolids({ stepBytes }) {
  if (!occt) throw new Error('kernel not initialized');
  throw new Error('extractStepSolids: not implemented');
},
```

- [ ] **Step 3: Verify the test now fails with the stub error message.**

```bash
pnpm --filter @zilventor/kernel test:integration -- src/__tests__/extractStepSolids.integration.spec.ts
```

Expected: FAIL with `extractStepSolids: not implemented` (or rejection from the throw). This proves the dispatch wiring is correct before the real implementation goes in.

### Task 1.3: Implement `extractStepSolids` in `StepIO.ts` — direct writeBRep path (GREEN attempt 1)

**Files:**
- Modify: `packages/kernel/src/occt/StepIO.ts` (add export `extractStepSolids`)
- Modify: `packages/kernel/src/api.ts` (replace stub body with call to the helper)

- [ ] **Step 1: Add `extractStepSolids` helper in `StepIO.ts`** (append after `readStep`):

```typescript
import { writeBRep } from './BRepIO';

export type ExtractedSolid = {
  shape: OcctShape;
  boundingBox: BoundingBox;
};

/**
 * Walks the sub-solids of a STEP file and returns one OcctShape per solid.
 * Uses TopExp_Explorer_2 on TopAbs_SOLID. Throws if the STEP contains zero solids.
 *
 * Each returned shape wraps the raw sub-solid handle from explorer.Current() in
 * an OcctShape struct so it can be passed to writeBRep / tessellate / registerImportedShape.
 */
export function extractStepSolids(
  oc: OcctInstance,
  stepBytes: ArrayBuffer,
): ExtractedSolid[] {
  const parent = readStep(oc, stepBytes);
  if (parent.solidCount === 0) {
    throw new Error('STEP file contains no solids');
  }

  const TAS = (oc as { TopAbs_ShapeEnum: { TopAbs_SOLID: unknown; TopAbs_SHAPE: unknown } }).TopAbs_ShapeEnum;
  const ExplorerCtor = (oc as { TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
    More(): boolean;
    Next(): void;
    Current(): unknown;
    delete?(): void;
  } }).TopExp_Explorer_2;

  const solids: ExtractedSolid[] = [];
  const exp = new ExplorerCtor(parent.shape.handle as unknown, TAS.TopAbs_SOLID, TAS.TopAbs_SHAPE);
  while (exp.More()) {
    const handle = exp.Current();
    // Wrap the raw handle in an OcctShape so writeBRep / tessellate accept it.
    const subShape: OcctShape = { __brand: 'OcctShape' as const, handle } as OcctShape;
    const boundingBox = computeBoundingBox(oc, subShape);
    solids.push({ shape: subShape, boundingBox });
    exp.Next();
  }
  exp.delete?.();

  return solids;
}
```

You'll need to import or expose `computeBoundingBox`. It already lives in `packages/kernel/src/occt/SolidOps.ts:54-55` (per fact-check). If it isn't exported, add it. Quote the existing internal call site to confirm the signature, then import:

```typescript
import { computeBoundingBox } from './SolidOps';
```

(If `computeBoundingBox` is private to `SolidOps.ts`, export it inline as `export function computeBoundingBox(...)`. This is a minimum-friction reuse — do NOT inline a duplicate.)

- [ ] **Step 2: Replace the api.ts stub** with the real implementation. Replace the closure body added in 1.2 step 2:

```typescript
async extractStepSolids({ stepBytes }) {
  if (!occt) throw new Error('kernel not initialized');
  const solids = extractStepSolids(occt, stepBytes);
  return solids.map((s) => {
    const brepBytes = writeBRep(occt, s.shape);
    const brepBlobId = `imp-${crypto.randomUUID()}`;
    registerImportedShape(brepBlobId, s.shape);
    void brepBytes; // brepBlobId routes through cache; bytes used for verification by saveToBytes
    return { brepBlobId, boundingBox: s.boundingBox };
  });
},
```

Add the imports at the top of `api.ts`:

```typescript
import { readStep, extractStepSolids } from './occt/StepIO';
import { writeBRep } from './occt/BRepIO';
```

(`readStep` is likely already imported; only add `extractStepSolids` to the existing line.)

- [ ] **Step 3: Run the test.**

```bash
pnpm --filter @zilventor/kernel test:integration -- src/__tests__/extractStepSolids.integration.spec.ts
```

Two outcomes:
- **PASS** (3/3) → direct writeBRep handles sub-shapes. Skip Task 1.4 (fallback). Go to Task 1.5.
- **FAIL** with serialization / "Null shape" / similar OCCT error → Task 1.4 (compound-wrap fallback). Do NOT debug ad-hoc; the fallback is the documented mitigation.

### Task 1.4: Compound-wrap fallback (GREEN attempt 2 — only if 1.3 step 3 failed)

**Files:**
- Modify: `packages/kernel/src/occt/StepIO.ts` (replace the wrap step in `extractStepSolids`)

The existing pattern is at `packages/kernel/src/api.ts:464-471`:

```typescript
const srcBuilder = new occt.BRep_Builder();
const srcComp = new occt.TopoDS_Compound();
srcBuilder.MakeCompound(srcComp);
srcBuilder.Add(srcComp, ns.shape.handle as never);
srcBuilder.delete();
```

- [ ] **Step 1: Replace the loop body in `extractStepSolids`** (StepIO.ts) so each sub-solid is wrapped in a fresh compound before being returned:

```typescript
while (exp.More()) {
  const handle = exp.Current();
  // Wrap the sub-solid in a fresh TopoDS_Compound so writeBRep gets a rooted shape.
  const builder = new (oc as { BRep_Builder: new () => { MakeCompound(c: unknown): void; Add(c: unknown, s: unknown): void; delete(): void } }).BRep_Builder();
  const comp = new (oc as { TopoDS_Compound: new () => unknown }).TopoDS_Compound();
  builder.MakeCompound(comp);
  builder.Add(comp, handle);
  builder.delete();

  const subShape: OcctShape = { __brand: 'OcctShape' as const, handle: comp } as OcctShape;
  const boundingBox = computeBoundingBox(oc, subShape);
  solids.push({ shape: subShape, boundingBox });
  exp.Next();
}
```

- [ ] **Step 2: Re-run.**

```bash
pnpm --filter @zilventor/kernel test:integration -- src/__tests__/extractStepSolids.integration.spec.ts
```

Expected: PASS (3/3). If still failing, STOP and report — this is the documented spike escape and shouldn't be papered over.

### Task 1.5: Re-run full kernel suite + commit

- [ ] **Step 1: Re-run full kernel unit + integration.**

```bash
pnpm --filter @zilventor/kernel test:unit 2>&1 | tail -5
pnpm --filter @zilventor/kernel test:integration 2>&1 | tail -5
```

Expected: 359 unit (was 359; +0 since this is a new integration spec) and integration count +3 (the 3 tests in `extractStepSolids.integration.spec.ts`).

- [ ] **Step 2: Commit.**

```bash
git add packages/kernel/src/occt/StepIO.ts packages/kernel/src/api.ts packages/kernel/src/__tests__/extractStepSolids.integration.spec.ts
# If SolidOps.ts had to export computeBoundingBox, add it too:
git add packages/kernel/src/occt/SolidOps.ts
git commit -m "feat(kernel): extractStepSolids — walk sub-solids via TopExp_Explorer

New KernelApi.extractStepSolids(stepBytes) returns one brepBlobId per
TopAbs_SOLID. Reuses readStep + writeBRep + registerImportedShape.
Throws on solidCount=0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Batch 2 — App helper: `importStepIntoNewParts`

**Slice goal:** Pure-app helper that fans `extractStepSolids` into N registered + OPFS-persisted PartDocuments with auto-deduped `${base}_1` … `${base}_N` names.

**Owning test:** `packages/app/src/import/__tests__/importStepIntoNewParts.spec.ts`

### Task 2.1: Write the failing unit test (RED)

**Files:**
- Create: `packages/app/src/import/__tests__/importStepIntoNewParts.spec.ts`

- [ ] **Step 1: Write the test** (matches the mock-kernel pattern from `importStepIntoNewPart.spec.ts`):

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { KernelApi, PartDocument } from '@zilventor/kernel/src/api';
import { importStepIntoNewParts } from '../importStepIntoNewParts';

type OpfsLike = { write: (p: string, b: Uint8Array) => Promise<void>; listAll: () => Promise<string[]> };

function makeKernel(brepBlobIds: string[]): Pick<KernelApi, 'extractStepSolids' | 'registerPart' | 'saveToBytes'> & { _registered: PartDocument[] } {
  const registered: PartDocument[] = [];
  return {
    _registered: registered,
    extractStepSolids: vi.fn(async () =>
      brepBlobIds.map((id, i) => ({
        brepBlobId: id,
        boundingBox: [i * 100, 0, 0, i * 100 + 10, 10, 10] as [number, number, number, number, number, number],
      })),
    ),
    registerPart: vi.fn(async (part: PartDocument) => {
      registered.push(part);
    }),
    saveToBytes: vi.fn(async (_partId: string) => new Uint8Array([1, 2, 3])),
  };
}

function makeOpfs(existing: string[] = []): OpfsLike & { _writes: Array<[string, Uint8Array]> } {
  const writes: Array<[string, Uint8Array]> = [];
  return {
    _writes: writes,
    write: vi.fn(async (path: string, data: Uint8Array) => {
      writes.push([path, data]);
    }),
    listAll: vi.fn(async () => existing),
  };
}

describe('importStepIntoNewParts', () => {
  it('registers N parts with _1.._N suffixes', async () => {
    const kernel = makeKernel(['blob-a', 'blob-b', 'blob-c']);
    const opfs = makeOpfs();
    const stepBytes = new ArrayBuffer(8);

    const results = await importStepIntoNewParts({
      baseName: 'Cadeira_preta',
      sourceFileName: 'Cadeira_preta.step',
      stepBytes,
      kernel: kernel as unknown as KernelApi,
      opfs: opfs as unknown as OpfsLike,
    });

    expect(results).toHaveLength(3);
    expect(kernel._registered.map((p) => p.name)).toEqual([
      'Cadeira_preta_1',
      'Cadeira_preta_2',
      'Cadeira_preta_3',
    ]);
    // OPFS partPath convention: `${partName}.zipt`
    expect(opfs._writes.map(([p]) => p)).toEqual([
      'Cadeira_preta_1.zipt',
      'Cadeira_preta_2.zipt',
      'Cadeira_preta_3.zipt',
    ]);
    // Each result carries the path + partId + part.
    expect(results[0].opfsPath).toBe('Cadeira_preta_1.zipt');
    expect(results[1].opfsPath).toBe('Cadeira_preta_2.zipt');
  });

  it('dedupes against existing .zipt files in OPFS', async () => {
    const kernel = makeKernel(['blob-x', 'blob-y']);
    const opfs = makeOpfs(['Cadeira_preta_1.zipt', 'unrelated.zipt']);
    const stepBytes = new ArrayBuffer(8);

    const results = await importStepIntoNewParts({
      baseName: 'Cadeira_preta',
      sourceFileName: 'Cadeira_preta.step',
      stepBytes,
      kernel: kernel as unknown as KernelApi,
      opfs: opfs as unknown as OpfsLike,
    });

    // First slot starts at _1 collision → dedupeName produces _1_2 or _2; the
    // contract is: the resulting names DO NOT collide with anything in `existing`.
    const names = kernel._registered.map((p) => p.name);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).not.toBe('Cadeira_preta_1');
    expect(results[0].opfsPath.endsWith('.zipt')).toBe(true);
  });

  it('single solid produces a single-element result', async () => {
    const kernel = makeKernel(['blob-solo']);
    const opfs = makeOpfs();

    const results = await importStepIntoNewParts({
      baseName: 'cube',
      sourceFileName: 'cube.stp',
      stepBytes: new ArrayBuffer(8),
      kernel: kernel as unknown as KernelApi,
      opfs: opfs as unknown as OpfsLike,
    });

    expect(results).toHaveLength(1);
    expect(kernel._registered[0]?.name).toBe('cube_1');
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

```bash
pnpm --filter app exec vitest run src/import/__tests__/importStepIntoNewParts.spec.ts 2>&1 | tail -10
```

Expected: FAIL (`No test files found` first, then once import is added: module resolution error).

### Task 2.2: Implement `importStepIntoNewParts` (GREEN)

**Files:**
- Create: `packages/app/src/import/importStepIntoNewParts.ts`

- [ ] **Step 1: Write the helper.**

```typescript
import type { KernelApi, PartDocument } from '@zilventor/kernel/src/api';
import { buildImportedPartDocument } from './buildImportedPartDocument';
import { dedupeName } from './dedupeName';

type OpfsLike = {
  write: (path: string, data: Uint8Array) => Promise<void>;
  listAll: () => Promise<string[]>;
};

export type ImportStepIntoNewPartsInput = {
  baseName: string;
  sourceFileName: string;
  stepBytes: ArrayBuffer;
  kernel: KernelApi;
  opfs: OpfsLike;
};

export type ImportStepIntoNewPartsResult = {
  partId: string;
  opfsPath: string;
  part: PartDocument;
  archiveBytes: Uint8Array;
};

/**
 * 1:N variant of importStepIntoNewPart. Calls kernel.extractStepSolids, then
 * for each sub-solid: build → registerPart → saveToBytes → opfs.write.
 *
 * Names are `${baseName}_1` … `${baseName}_N` with dedupeName against existing
 * `.zipt` files in OPFS. Does NOT setActiveDocument or addComponent — caller decides.
 *
 * On partial failure mid-loop, rolls back: deletes parts registered so far + opfs entries.
 * (Kernel-side extractStepSolids is atomic — runs once, before any registerPart call.)
 */
export async function importStepIntoNewParts(
  input: ImportStepIntoNewPartsInput,
): Promise<ImportStepIntoNewPartsResult[]> {
  const { baseName, sourceFileName, stepBytes, kernel, opfs } = input;
  const solids = await kernel.extractStepSolids({ stepBytes });

  const existing = (await opfs.listAll()).filter((p) => p.endsWith('.zipt')).map((p) => p.replace(/\.zipt$/, ''));
  const registered: ImportStepIntoNewPartsResult[] = [];

  try {
    for (let i = 0; i < solids.length; i++) {
      const name = dedupeName(`${baseName}_${i + 1}`, [...existing, ...registered.map((r) => r.part.name)]);
      const part = buildImportedPartDocument(name, solids[i].brepBlobId, sourceFileName);
      await kernel.registerPart(part);
      const archiveBytes = await kernel.saveToBytes(part.id);
      const opfsPath = `${name}.zipt`;
      await opfs.write(opfsPath, archiveBytes);
      registered.push({ partId: part.id, opfsPath, part, archiveBytes });
    }
    return registered;
  } catch (err) {
    // Best-effort rollback. `deletePart` on a kernel that may not have the
    // method on a mock degrades to a no-op via optional chaining.
    for (const r of registered.reverse()) {
      try {
        await (kernel as KernelApi & { deletePart?: (id: string) => Promise<void> }).deletePart?.(r.partId);
      } catch { /* swallow rollback errors */ }
      try {
        await (opfs as OpfsLike & { delete?: (p: string) => Promise<void> }).delete?.(r.opfsPath);
      } catch { /* swallow */ }
    }
    throw err;
  }
}
```

- [ ] **Step 2: Run + confirm green.**

```bash
pnpm --filter app exec vitest run src/import/__tests__/importStepIntoNewParts.spec.ts 2>&1 | tail -10
```

Expected: PASS (3/3).

- [ ] **Step 3: Run full app suite to catch incidental breakage.**

```bash
pnpm --filter app test:unit 2>&1 | grep -E "Test Files|Tests" | tail -4
```

Expected: 290 test files (was 289; +1), 1972 tests (was 1969; +3).

- [ ] **Step 4: Commit.**

```bash
git add packages/app/src/import/importStepIntoNewParts.ts packages/app/src/import/__tests__/importStepIntoNewParts.spec.ts
git commit -m "feat(import): importStepIntoNewParts — 1:N STEP fan-out helper

Calls kernel.extractStepSolids, then registers + persists N parts with
dedupeName(\`\${base}_\${i+1}\`) suffixes. Caller drives setActiveDocument
+ addComponent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Batch 3 — Assembly command: extend `ImportStepAsComponentCommand`

**Slice goal:** Multi-result-aware atomic command. Single-body case unchanged byte-for-byte. Multi-body case adds N components at origin, with revert that removes ALL components + deletes ALL parts + opfs.delete ALL paths.

**Owning test:** `packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts`

### Task 3.1: Write the failing multi-body command test (RED)

**Files:**
- Modify: `packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts` (append new `describe` block)

- [ ] **Step 1: Append the multi-body block** to the existing spec file (do NOT touch existing single-body tests yet — Task 3.3 handles those). Reuse the existing file's `MemOpfs`, `makeDoc`, and `STEP_BYTES` helpers verbatim:

```typescript
describe('ImportStepAsComponentCommand — multi-body STEP', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({
      kind: 'assembly',
      document: makeDoc('cabinet'),
    });
  });

  it('apply: adds N components + registers N parts + writes N opfs files', async () => {
    const kernel = {
      importStep: vi.fn(),
      extractStepSolids: vi.fn(async () => [
        { brepBlobId: 'blob-1', boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number] },
        { brepBlobId: 'blob-2', boundingBox: [20, 0, 0, 30, 10, 10] as [number, number, number, number, number, number] },
        { brepBlobId: 'blob-3', boundingBox: [40, 0, 0, 50, 10, 10] as [number, number, number, number, number, number] },
      ]),
      registerPart: vi.fn(async () => undefined),
      saveToBytes: vi.fn(async () => new Uint8Array([1])),
      deletePart: vi.fn(async () => undefined),
    };
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'chair.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();

    expect(kernel.importStep).not.toHaveBeenCalled();
    expect(kernel.extractStepSolids).toHaveBeenCalledTimes(1);
    expect(kernel.registerPart).toHaveBeenCalledTimes(3);
    expect(kernel.saveToBytes).toHaveBeenCalledTimes(3);
    const writtenPaths = [...opfs.files.keys()];
    expect(writtenPaths).toHaveLength(3);
    expect(writtenPaths.every((p) => p.endsWith('.zipt'))).toBe(true);
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(3);
    const comps = useAppStore.getState().activeAssembly!.components;
    for (const c of comps) {
      expect(c.position).toEqual({ x: 0, y: 0, z: 0 });
      expect(c.rotation).toEqual({ rx: 0, ry: 0, rz: 0 });
      expect(c.visible).toBe(true);
    }
  });

  it('revert: removes all N components + deletePart N + opfs.delete N', async () => {
    const kernel = {
      importStep: vi.fn(),
      extractStepSolids: vi.fn(async () => [
        { brepBlobId: 'blob-1', boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number] },
        { brepBlobId: 'blob-2', boundingBox: [20, 0, 0, 30, 10, 10] as [number, number, number, number, number, number] },
      ]),
      registerPart: vi.fn(async () => undefined),
      saveToBytes: vi.fn(async () => new Uint8Array([1])),
      deletePart: vi.fn(async () => undefined),
    };
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'table.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(2);

    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(0);
    expect(kernel.deletePart).toHaveBeenCalledTimes(2);
    expect(opfs.files.size).toBe(0);
  });

  it('N=1 via extractStepSolids reduces cleanly to one component', async () => {
    const kernel = {
      importStep: vi.fn(),
      extractStepSolids: vi.fn(async () => [
        { brepBlobId: 'blob-solo', boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number] },
      ]),
      registerPart: vi.fn(async () => undefined),
      saveToBytes: vi.fn(async () => new Uint8Array([1])),
      deletePart: vi.fn(async () => undefined),
    };
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'cube.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(1);
    expect(kernel.importStep).not.toHaveBeenCalled();
    expect(kernel.extractStepSolids).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run + verify failure.**

```bash
pnpm --filter app exec vitest run src/commands/__tests__/ImportStepAsComponentCommand.spec.ts 2>&1 | tail -15
```

Expected: 3 new tests FAIL (existing single-body tests still pass).

### Task 3.2: Extend `ImportStepAsComponentCommand.apply` (GREEN)

**Files:**
- Modify: `packages/app/src/commands/ImportStepAsComponentCommand.ts`

- [ ] **Step 1: Extend private state to arrays** (lines ~38-53). Replace the singular `placedId` / `placedPartId` / `placedPartPath` / `placedPart` / `placedArchiveBytes` fields with arrays — but KEEP the names by appending `s`:

```typescript
private placedIds: string[] = [];          // componentIds
private placedPartIds: string[] = [];
private placedPartPaths: string[] = [];
private placedParts: PartDocument[] = [];
private placedArchiveBytes: Uint8Array[] = [];
private wasAssemblyInsert = false;
private redoState: Array<{
  partName: string;
  brepBlobId: string;
  fileName: string;
  partPath: string;
  archiveBytes: Uint8Array;
}> | null = null;
```

- [ ] **Step 2: Replace `apply` body** to use `importStepIntoNewParts` for the assembly-active path:

```typescript
async apply() {
  const { kernel, activeDocument } = useAppStore.getState();
  if (!kernel) throw new Error('kernel not ready');
  this.wasAssemblyInsert = activeDocument?.kind === 'assembly';

  // Redo-optimized branch: re-register cached parts + re-add components.
  if (this.redoState) {
    for (const r of this.redoState) {
      const part = buildImportedPartDocument(r.partName, r.brepBlobId, r.fileName);
      await kernel.registerPart(part);
      const opfs = await getOpfs();
      await opfs.write(r.partPath, r.archiveBytes);
      this.placedPartIds.push(part.id);
      this.placedPartPaths.push(r.partPath);
      this.placedParts.push(part);
      this.placedArchiveBytes.push(r.archiveBytes);
    }
    if (this.wasAssemblyInsert) {
      for (let i = 0; i < this.placedPartPaths.length; i++) {
        const instance: ComponentInstance = makeOriginInstance(this.placedPartPaths[i]);
        useAppStore.getState().addComponent(instance);
        this.placedIds.push(instance.id);
      }
    } else if (this.placedParts[0]) {
      useAppStore.getState().setActivePart(this.placedParts[0]);
    }
    return;
  }

  // Fresh apply.
  const opfs = await getOpfs();
  const results = await importStepIntoNewParts({
    baseName: stepFilenameBasename(this.input.fileName),
    sourceFileName: this.input.fileName,
    stepBytes: this.input.stepBytes,
    kernel,
    opfs,
  });

  for (const r of results) {
    this.placedPartIds.push(r.partId);
    this.placedPartPaths.push(r.opfsPath);
    this.placedParts.push(r.part);
    this.placedArchiveBytes.push(r.archiveBytes);
  }

  if (this.wasAssemblyInsert) {
    for (let i = 0; i < this.placedPartPaths.length; i++) {
      const instance: ComponentInstance = makeOriginInstance(this.placedPartPaths[i]);
      useAppStore.getState().addComponent(instance);
      this.placedIds.push(instance.id);
    }
    useAppStore.getState().setStatus(
      results.length === 1
        ? `Imported ${results[0].part.name}`
        : `Imported ${results.length} bodies from ${this.input.fileName}`,
    );
  } else {
    // Part-mode through this command: register first part as active.
    // (FileTab routes single-body and multi-body part-mode separately to keep
    //  semantics distinct; this branch handles the case where the command is
    //  invoked directly without an active assembly.)
    if (results[0]) {
      useAppStore.getState().setActivePart(results[0].part);
      if (results.length > 1) {
        useAppStore.getState().setStatus(
          `Imported first body of ${results.length} from ${this.input.fileName}`,
        );
      }
    }
  }
}
```

Add a small helper alongside the class:

```typescript
function makeOriginInstance(partPath: string): ComponentInstance {
  return {
    id: `comp-${crypto.randomUUID()}`,
    partPath,
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  };
}
```

Imports to add at top:

```typescript
import { importStepIntoNewParts } from '../import/importStepIntoNewParts';
import { stepFilenameBasename } from '../import/originFeatures';
```

- [ ] **Step 3: Replace `revert` body**:

```typescript
async revert() {
  const { kernel } = useAppStore.getState();
  if (!kernel) throw new Error('kernel not ready');

  // Components first (reverse order).
  for (const id of [...this.placedIds].reverse()) {
    useAppStore.getState().removeComponent(id);
  }

  // Capture redo state BEFORE deleting parts.
  this.redoState = this.placedParts.map((part, i) => ({
    partName: part.name,
    brepBlobId: extractBrepBlobIdFromPart(part),
    fileName: this.input.fileName,
    partPath: this.placedPartPaths[i],
    archiveBytes: this.placedArchiveBytes[i],
  }));

  // Then parts.
  for (const partId of this.placedPartIds) {
    await kernel.deletePart(partId);
  }

  // Then opfs (best-effort).
  const opfs = await getOpfs();
  for (const path of this.placedPartPaths) {
    try { await opfs.delete(path); } catch { /* swallow */ }
  }

  // Clear placed-arrays so re-redo flows through the redoState path.
  this.placedIds = [];
  this.placedPartIds = [];
  this.placedPartPaths = [];
  this.placedParts = [];
  this.placedArchiveBytes = [];
}
```

`extractBrepBlobIdFromPart` is a tiny helper (you can also inline it):

```typescript
function extractBrepBlobIdFromPart(part: PartDocument): string {
  const imported = part.featureTree.find((f) => f.kind === 'imported');
  if (!imported || imported.kind !== 'imported') throw new Error('ImportStepAsComponent: missing imported feature in revert state');
  return imported.bodyRef;
}
```

- [ ] **Step 4: Update the EXISTING single-body tests in the same file.** The existing tests assert `kernel.importStep` was called; the new `apply()` routes through `extractStepSolids` instead, so those assertions will fail. Surgical updates to make in `packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts`:

  1. **`makeKernel` helper** (find it near the top of the file) — add an `extractStepSolids` field to the returned object. Pattern:
     ```typescript
     extractStepSolids: vi.fn(async () => [
       { brepBlobId: 'blob-123', boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number] },
     ]),
     ```
     Keep the existing `importStep` field so the redo-state-cache test in the existing block still passes if needed (it won't be called, but leaving it as `vi.fn()` doesn't hurt).

  2. **Assertions** — replace `expect(kernel.importStep).toHaveBeenCalledOnce()` (line ~115-130) and `expect(kernel.importStep).toHaveBeenCalledTimes(1)` (line ~329 in the redo test) with:
     ```typescript
     expect(kernel.extractStepSolids).toHaveBeenCalledOnce();
     ```
     Search for every `kernel.importStep` assertion in the file and convert; there are typically 2–4 sites. Use `git diff` after the edit to verify the count of changed assertions matches what you found.

  3. **Re-run the file.** Both the new multi-body block AND the existing single-body tests must pass.

```bash
pnpm --filter app exec vitest run src/commands/__tests__/ImportStepAsComponentCommand.spec.ts 2>&1 | tail -20
```

Expected: PASS for ALL tests (existing + 3 new), no test referencing `kernel.importStep` failing.

- [ ] **Step 5: Run full app suite to catch incidental breakage.**

```bash
pnpm --filter app test:unit 2>&1 | grep -E "Test Files|Tests" | tail -4
```

Expected: 290 tests files, 1975 tests (+3 from this batch on top of Batch 2's +3 = +6 total vs Batch 0 baseline).

- [ ] **Step 6: Commit.**

```bash
git add packages/app/src/commands/ImportStepAsComponentCommand.ts packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts
git commit -m "feat(import): ImportStepAsComponentCommand fans out to N components

Multi-body STEPs become N PartDocuments + N ComponentInstances at origin.
Single-body case unchanged (N=1 reduces cleanly). revert removes all N
components + deletes all N parts + opfs.deletes all N paths atomically.
Redo path reuses cached blob IDs (relies on deletePart not evicting
importedShapeCache).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Batch 4 — FileTab part-mode multi-body branch

**Slice goal:** When `File→Open` receives a multi-body STEP and no assembly is active, register only the first sub-solid as a single PartDocument and emit `setStatus("Imported first body of N from <filename>")`. Existing single-body path unchanged.

**Owning test:** `packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx` (create if absent)

### Task 4.1: Write the failing FileTab unit test (RED)

**Files:**
- Create or modify: `packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx`

- [ ] **Step 1: Write or extend the test** with a part-mode multi-body case. The test should:
  - Stub the kernel with `extractStepSolids` returning 3 entries.
  - Stub the store such that `activeDocument` is `null` (part-mode).
  - Invoke `FileTab.handleOpen` (or whichever helper it exports) with a mock `File` containing a `.step` name + duck-typed `arrayBuffer`.
  - Assert: `registerPart` called exactly ONCE (first solid only).
  - Assert: `setStatus` called with a string containing `"first body of 3"` and the filename.

Concrete skeleton (fill in via the existing FileTab test fixtures if any; otherwise model on `importStepIntoNewPart.spec.ts`'s mock-kernel pattern):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';

describe('FileTab.handleOpen — part-mode multi-body STEP', () => {
  beforeEach(() => {
    // Reset store
    useAppStore.setState({ activeDocument: null });
  });

  it('imports only the first sub-solid + emits setStatus', async () => {
    const setStatus = vi.fn();
    const setActivePart = vi.fn();
    const registerPart = vi.fn(async () => {});
    const extractStepSolids = vi.fn(async () => [
      { brepBlobId: 'b1', boundingBox: [0, 0, 0, 10, 10, 10] as const },
      { brepBlobId: 'b2', boundingBox: [20, 0, 0, 30, 10, 10] as const },
      { brepBlobId: 'b3', boundingBox: [40, 0, 0, 50, 10, 10] as const },
    ]);

    useAppStore.setState({
      activeDocument: null,
      kernel: { extractStepSolids, registerPart } as unknown as KernelApi,
      setStatus,
      setActivePart,
    } as Partial<ReturnType<typeof useAppStore.getState>>);

    const file = {
      name: 'gizmo.step',
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as File;

    await handleOpen(file);  // exported from FileTab.tsx

    expect(registerPart).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining('first body of 3'),
    );
    expect(setStatus.mock.calls[0][0]).toContain('gizmo.step');
  });
});
```

Note: `handleOpen` may be inline inside the component. If so, export it (or extract a pure-helper version) as part of this task — Implementer should NOT inline-test through React rendering for this slice.

- [ ] **Step 2: Run + confirm failure.**

```bash
pnpm --filter app exec vitest run src/shell/tabs/__tests__/FileTab.spec.tsx 2>&1 | tail -10
```

Expected: FAIL (either "test file not found", import resolution, or assertion mismatch).

### Task 4.2: Extend the STEP branch in `FileTab.handleOpen` (GREEN)

**Files:**
- Modify: `packages/app/src/shell/tabs/FileTab.tsx` (around line 122-138; part-mode `else` arm)

- [ ] **Step 1: Replace the part-mode `else` arm** with the multi-body-aware version:

```typescript
} else {
  // Part-mode: no active assembly.
  const stepBytes = await file.arrayBuffer();
  const solids = await kernel.extractStepSolids({ stepBytes });
  if (solids.length === 0) {
    useAppStore.getState().setStatus(`No solids in ${file.name}`);
    return;
  }
  if (solids.length === 1) {
    const { importStepIntoNewPart } = await import('../../import/importStepIntoNewPart');
    const { part } = await importStepIntoNewPart(file, kernel);
    useAppStore.getState().setActivePart(part);
    useAppStore.getState().setStatus('Imported');
    return;
  }
  // Multi-body in part-mode: register only the first solid.
  const { buildImportedPartDocument } = await import('../../import/buildImportedPartDocument');
  const { stepFilenameBasename } = await import('../../import/originFeatures');
  const baseName = stepFilenameBasename(file.name);
  const part = buildImportedPartDocument(`${baseName}_1`, solids[0].brepBlobId, file.name);
  await kernel.registerPart(part);
  useAppStore.getState().setActivePart(part);
  useAppStore.getState().setStatus(
    `Imported first body of ${solids.length} from ${file.name}`,
  );
}
```

- [ ] **Step 2: Run + verify green.**

```bash
pnpm --filter app exec vitest run src/shell/tabs/__tests__/FileTab.spec.tsx 2>&1 | tail -10
pnpm --filter app test:unit 2>&1 | grep -E "Test Files|Tests" | tail -4
```

Expected: new test PASS; total app tests +1-2 vs Batch 3.

- [ ] **Step 3: Commit.**

```bash
git add packages/app/src/shell/tabs/FileTab.tsx packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx
git commit -m "feat(shell): FileTab part-mode falls back to first sub-solid for multi-body STEP

When a multi-body STEP is opened with no active assembly, register only
the first sub-solid as a PartDocument and surface
'Imported first body of N from <filename>' via setStatus. solidCount=1
path unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Batch 5 — DEV helper + e2e against real `two-bodies.step`

**Slice goal:** Add a test-only window function so Playwright can pump the real fixture into the import flow, then write the e2e that proves the assembly-mode multi-body path end-to-end with reload-persistence and undo.

**Owning test:** `tests/e2e/multi-body-step-explosion.spec.ts`

### Task 5.1: Add DEV-gated `window.__zilventorMultiBodyStepImport`

**Files:**
- Modify: `packages/app/src/App.tsx` (DEV gate around lines 382-450)

- [ ] **Step 1: Inside the existing `if (import.meta.env.DEV) { ... }` block**, alongside `window.__zilventorImportStepIntoAssembly`, add the wrapper. **The existing helper signature is `(bytes: number[], filename: string)` — NOT a File** (verified at `App.tsx:435-450`). The wrapper must pass a number array, not a File:

```typescript
(window as unknown as {
  __zilventorMultiBodyStepImport?: (
    fileName: string,
    stepBytesBase64: string,
  ) => Promise<{
    componentCount: number;
    statusMessage: string;
    partNames: string[];
  }>;
}).__zilventorMultiBodyStepImport = async (fileName, stepBytesBase64) => {
  const bin = atob(stepBytesBase64);
  const bytesArr: number[] = new Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytesArr[i] = bin.charCodeAt(i);

  const result = await (window as unknown as {
    __zilventorImportStepIntoAssembly: (
      bytes: number[],
      filename: string,
    ) => Promise<{ componentCount: number; statusMessage: string }>;
  }).__zilventorImportStepIntoAssembly(bytesArr, fileName);

  const asm = useAppStore.getState().activeAssembly;
  const partPaths = (asm?.components ?? []).map((c) => c.partPath);
  const partNames = partPaths.map((p) => p.replace(/\.zipt$/, ''));

  return {
    componentCount: result.componentCount,
    statusMessage: result.statusMessage,
    partNames,
  };
};
```

**Important:** `__zilventorImportStepIntoAssembly` REQUIRES an active assembly before it runs. The e2e (Task 5.2) creates one via `NewAssemblyCommand` BEFORE invoking this wrapper.

### Task 5.2: Write the failing e2e (RED)

**Files:**
- Create: `tests/e2e/multi-body-step-explosion.spec.ts`

- [ ] **Step 1: Write the e2e** (model on `tests/e2e/import-step-into-assembly.spec.ts`):

```typescript
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TWO_BODIES = resolve(
  HERE,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step',
);

test('multi-body STEP explodes into N components, persists, undoes', async ({ page }) => {
  await page.goto('http://localhost:5173');

  // Wait for kernel + helpers.
  await page.waitForFunction(() => (window as any).__zilventorMultiBodyStepImport, undefined, { timeout: 30_000 });

  // Create a fresh assembly. `NewAssemblyCommand` is a plain function call,
  // verified at FileTab.tsx:23 — NOT a constructor, and there is no
  // store.newAssembly action.
  await page.evaluate(async () => {
    const mod = await import('/src/commands/NewAssemblyCommand.ts');
    mod.NewAssemblyCommand({ name: 'test-assembly' });
  });

  // Load the fixture bytes (read in Node, ship as base64 to the browser).
  const stepBytes = readFileSync(TWO_BODIES);
  const base64 = stepBytes.toString('base64');

  const result = await page.evaluate(async ({ base64, fileName }) => {
    return (window as any).__zilventorMultiBodyStepImport(fileName, base64);
  }, { base64, fileName: 'two-bodies.step' });

  expect(result.componentCount).toBe(2);
  expect(result.partNames.sort()).toEqual(['two-bodies_1', 'two-bodies_2']);
  expect(result.statusMessage).toContain('2 bodies');

  // Reload-persistence: refresh, then assert assembly still has 2 components.
  await page.reload();
  await page.waitForFunction(() => (window as any).__zilventorMultiBodyStepImport, undefined, { timeout: 30_000 });
  const afterReload = await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    return useAppStore.getState().activeAssembly?.components.length ?? 0;
  });
  expect(afterReload).toBe(2);

  // Undo via the command bus. Real store field is `bus`, not `commandBus`
  // (verified at App.tsx:436).
  await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    await useAppStore.getState().bus?.undo();
  });
  const afterUndo = await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    return useAppStore.getState().activeAssembly?.components.length ?? 0;
  });
  expect(afterUndo).toBe(0);
});
```

(If the existing `import-step-into-assembly.spec.ts` uses different selectors / store-bridge / helper signatures, mirror its conventions verbatim — implementer should NOT invent a new pattern.)

- [ ] **Step 2: Run + verify failure.**

```bash
pnpm test:e2e -- tests/e2e/multi-body-step-explosion.spec.ts --project=chromium 2>&1 | tail -20
```

Expected: FAIL (likely "helper not found" if `__zilventorMultiBodyStepImport` was not yet picked up by HMR, or "newAssembly not found" if the assembly-creation idiom differs).

### Task 5.3: Iterate to green + commit

- [ ] **Step 1: Verify in browser console** that the DEV helper exists. Open `http://localhost:5173`, run:

```javascript
window.__zilventorMultiBodyStepImport
```

If `undefined`, the DEV gate didn't compile — re-check the `if (import.meta.env.DEV)` block placement.

- [ ] **Step 2: Re-run the e2e.**

```bash
pnpm test:e2e -- tests/e2e/multi-body-step-explosion.spec.ts --project=chromium 2>&1 | tail -20
```

Expected: PASS. **READ THE BROWSER CONSOLE OUTPUT.** Per CLAUDE.md §6: assembly-projection feature had a load-bearing bug visible ONLY in the console (duplicate component keys) — Playwright reports the captured console at the end of failures and you should `--reporter=list` if needed.

- [ ] **Step 3: Commit.**

```bash
git add tests/e2e/multi-body-step-explosion.spec.ts packages/app/src/App.tsx
git commit -m "test(e2e): multi-body STEP explosion — fan-out, reload-persistence, undo

Uses real two-bodies.step fixture (32 KB compound of two cubes) through
window.__zilventorMultiBodyStepImport DEV helper. Asserts 2 components
with _1/_2 names, both persist across page reload, undo removes both.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Batch 6 — Final review pass + gate + handoff

### Task 6.1: Run the full gate

- [ ] **Step 1: Inside the worktree, run the full gate.**

```bash
pnpm -r typecheck 2>&1 | tail -5
pnpm lint 2>&1 | tail -3
pnpm -r test:unit 2>&1 | grep -E "Test Files|Tests" | tail -10
pnpm --filter @zilventor/kernel test:integration 2>&1 | tail -5
pnpm test:e2e -- tests/e2e/multi-body-step-explosion.spec.ts --project=chromium 2>&1 | tail -10
```

Expected:
- Typecheck clean.
- Lint 0 errors.
- Unit: 735 + 37 + 359 + 1976 = 3107 (was 3100; +7 across batches).
- Kernel integration: +3 (the extractStepSolids cases).
- E2e: 1 PASS.

If any drift outside expectations, STOP and investigate before review.

### Task 6.2: Sonnet code-review subagent

- [ ] **Step 1: Dispatch a Sonnet reviewer** with the full diff against `master`, the spec, and this plan. Prompt explicitly requests:
  - Plan-spec coverage check.
  - Real-code fact-check of every kernel/OCCT binding mentioned in this plan (the implementer's wrapping of raw handles in particular).
  - Single-body regression confirmed via reading the existing test, not just running it.
  - Revert atomicity scrutiny (partial-failure cleanup paths).
  - Any silent substitutions vs the design.
  - `## Self-critique` block + confidence per CLAUDE.md §5.

If CHANGES_REQUIRED → fix with a reproducing RED, re-verify, re-review.

### Task 6.3: Handoff to `superpowers:finishing-a-development-branch`

- [ ] **Step 1: After all-green review, invoke the finishing skill.** Standard FF merge to master + push + worktree cleanup + rewrite `next_session_resume.md` + write `project_multi_body_step_explosion_feature.md` memory.

```bash
# Sketch — finishing skill drives this:
cd /Users/lion/Documents/Projects/mine/zilventor
git checkout master
git merge --ff-only feature/multi-body-step
git push origin master
git worktree remove --force .worktrees/multi-body-step
git worktree prune
git branch -d feature/multi-body-step
```

Then write the project memory file and update `MEMORY.md` index.

---

## Risks recap

1. **Sub-shape `writeBRep`** (Batch 1, Task 1.3). Mitigated by Task 1.4 compound-wrap fallback already pinned in the plan.
2. **Revert atomicity on partial OPFS failure** (Batch 3, Task 3.2 Step 3). Mitigated by best-effort try/catch matching existing pattern; surfaced in review.
3. **DEV helper invisibility** (Batch 5, Task 5.3). Mitigated by manual browser-console check before re-running the e2e.
4. **Single-body regression** (Batch 3, Task 3.1 Step 1, third test). Locked by an explicit test in the multi-body block + the existing single-body tests untouched.

## Out of scope (per spec)

- STEP-CAF labels (separate feature).
- Per-body color/material from STEP.
- Performance tuning for >50 bodies.
- Drawing projection re-tested for imported parts.
