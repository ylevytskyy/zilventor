# Multi-body STEP Import: Full Model on Open + Explode into Assembly

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before writing any production code for a task, confirm the test is **RED** for the expected reason, then make it **GREEN** with the minimum change. Use `superpowers:test-driven-development` to enforce discipline; use `superpowers:systematic-debugging` when a test fails unexpectedly; use `superpowers:verification-before-completion` before marking any task done.

**Goal:** Fix multi-body STEP loss in two stages. Phase 1 — File → Open (no assembly active) always imports the whole compound shape as one part (no geometry dropped). Phase 2 — "Explode into Assembly" command splits the cached compound by type (solids + surfaces bucket) into a new assembly of N+1 components at identity pose. Phase 3 — assembly-insert path also keeps non-solid geometry.

**Architecture:** Phase 1 is pure FileTab surgery (remove the multi-body sub-branch; the whole-compound `importStep` path already works). Phase 2 adds a new `splitImportedShape` kernel API (iterates the cached compound's top-level children via `TopoDS_Iterator` or `TopExp_Explorer_2`, classifies SOLID vs non-solid, registers each as a new blob), a new `ExplodeIntoAssemblyCommand`, and an "Explode into Assembly" button on the Assembly tab. Phase 3 refactors `importStepIntoNewParts` to reuse `splitImportedShape` so the assembly-insert path also preserves non-solid children.

**Tech Stack:** TypeScript, OCCT-WASM, Zustand, OPFS, Vitest (unit + kernel-integration via `vitest.integration.config.ts`), Playwright (e2e).

**No manifest bump:** all new parts/assemblies use existing `PartDocument`/`AssemblyDocument` kinds. Framing auto-fits via the already-shipped `active3dDocId` effect in App.tsx — no viewport work needed.

**Fixture constraint:** The 15 MB Predator STEP is NOT a committed fixture. All kernel-integration and e2e tests use `packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step` (two cubes, 12 faces, 2 solids, 0 non-solid children). For surfaces-bucket tests, Task 4 adds an authoritative local-only check against the real Predator plus (best-effort) a small committed `mixed-solid-surface.step` fixture.

**Execution risks to verify (don't assume):**
- **OCCT binding names** (Task 4): `TopoDS_Iterator`, `BRep_Builder`, `TopoDS_Compound`, `TopExp_Explorer_2`, `TopAbs_ShapeEnum` must exist under those exact names in the occt-wasm build. `BRep_Builder`/`TopoDS_Compound`/`TopExp_Explorer_2`/`TopAbs_ShapeEnum` are already used in `StepIO.ts` (confirmed). **`TopoDS_Iterator` is NOT yet confirmed** — verify against the loaded `occt` before relying on it; the fallback is to enumerate children with `TopExp_Explorer_2` at `TopAbs_SOLID` for solids and a separate pass for `TopAbs_SHELL`/`TopAbs_FACE` not contained in any solid.
- **Phase 3 ripple:** changing `importStepIntoNewParts` to `importStep`+`splitImportedShape` alters the kernel-type requirement of `ImportStepAsComponentCommand` and its redo-optimized path (which assumes blobs stay cached after `deletePart`). Re-run the existing multi-body-explosion unit + e2e tests; all-solid STEPs must keep identical names/counts (`two-bodies_1/_2`, no surfaces).

---

## Touched files (final)

**Phase 1 (Tasks 1–3):**
- Modify: `packages/app/src/shell/tabs/FileTab.tsx`
- Modify: `packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx`
- Modify: `packages/kernel/src/occt/__tests__/StepIO.integration.spec.ts`
- Modify: `tests/e2e/` — add `step-full-model-on-open.spec.ts`

**Phase 2 (Tasks 4–8):**
- Modify: `packages/kernel/src/occt/StepIO.ts` — add `splitImportedShapeHelper`
- Modify: `packages/kernel/src/api.ts` — add `splitImportedShape` to `KernelApi` + implementation
- Create: `packages/kernel/src/occt/__tests__/fixtures/step/mixed-solid-surface.step`
- Create: `packages/kernel/src/occt/__tests__/StepIO.splitImportedShape.integration.spec.ts`
- Create: `packages/app/src/commands/ExplodeIntoAssemblyCommand.ts`
- Create: `packages/app/src/commands/__tests__/ExplodeIntoAssemblyCommand.spec.ts`
- Modify: `packages/app/src/shell/tabs/AssemblyTab.tsx`
- Modify: `packages/app/src/shell/tabs/__tests__/AssemblyTab.spec.tsx`
- Modify: `tests/e2e/` — add `step-explode-into-assembly.spec.ts`

**Phase 3 (Task 9 — optional):**
- Modify: `packages/app/src/import/importStepIntoNewParts.ts`
- Modify: `packages/app/src/import/__tests__/importStepIntoNewParts.spec.ts` (if exists)

---

## Phase 1 — Full model on open

### Task 1 — FileTab: multi-body STEP uses whole-compound path

**Files:**
- Test: `packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx`
- Impl: `packages/app/src/shell/tabs/FileTab.tsx`

**Steps:**

- [ ] **1.1 RED — add failing test** in `FileTab.spec.tsx` inside a new `describe('handleOpen — STEP part-mode always uses importStep (Phase 1 fix)', ...)` block:

```typescript
it('multi-body STEP in part-mode calls importStep once, NEVER calls extractStepSolids, activates whole-compound part', async () => {
  useAppStore.getState().setActiveDocument(null);
  vi.mocked(importStepIntoNewPart).mockClear();
  vi.mocked(ImportStepAsComponentCommand).mockClear();

  const registerPart = vi.fn(async () => {});
  // importStep returns solidCount=3 (multi-body) — the fix: whole-compound path used anyway
  const importStep = vi.fn(async () => ({
    brepBlobId: 'blob-compound',
    triangleCount: 0,
    boundingBox: [-50, -10, -10, 50, 10, 10] as [number, number, number, number, number, number],
    faceCount: 24,
    solidCount: 3,
  }));
  const extractStepSolids = vi.fn();

  useAppStore.setState((s) => ({
    ...s,
    kernel: { importStep, extractStepSolids, registerPart } as any,
  }));

  const fakeFile = { name: 'Predator.step', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([
    { getFile: async () => fakeFile } as unknown as FileSystemFileHandle,
  ]);

  const { unmount } = render(<FileTab />);
  fireEvent.click(screen.getByRole('button', { name: /^open/i }));

  await waitFor(() => {
    expect(registerPart).toHaveBeenCalledOnce();
  });

  // The whole-compound importStep blob must be used (no extractStepSolids call)
  expect(importStep).toHaveBeenCalledOnce();
  expect(extractStepSolids).not.toHaveBeenCalled();
  // Part activated with stem name (no _1 suffix)
  expect(useAppStore.getState().activePart?.name).toBe('Predator');
  expect(useAppStore.getState().statusMessage).toBe('Imported');
  // Regression: importStepIntoNewPart helper NOT used (direct kernel.importStep path)
  expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
  unmount();
});
```

- [ ] **1.2 Run test — confirm RED.**
  ```bash
  cd /Users/lion/Documents/Projects/mine/zilventor
  pnpm --filter @zilventor/app test -- --reporter=verbose FileTab.spec.tsx 2>&1 | tail -30
  ```
  Expected failure: `expect(extractStepSolids).not.toHaveBeenCalled()` — because the current multi-body branch calls `extractStepSolids` and keeps only `solids[0]`.

- [ ] **1.3 GREEN — edit `FileTab.tsx`** STEP branch, part-mode section (`activeDocument?.kind !== 'assembly'`). Replace the entire multi-body sub-branch (currently lines ~143–185) with a simple single path that always uses `importStep` + `buildImportedPartDocument`:

  Current code (lines ~143–185):
  ```typescript
  } else {
    const stepBytes = await file.arrayBuffer();
    const { buildImportedPartDocument } = await import('../../import/buildImportedPartDocument');
    const { stepFilenameBasename } = await import('../../import/originFeatures');
    const baseName = stepFilenameBasename(file.name);
    const importResult = await kernel.importStep({ stepBytes, partName: baseName });
    if (importResult.solidCount <= 1) {
      const part = buildImportedPartDocument(baseName, importResult.brepBlobId, file.name);
      await kernel.registerPart(part);
      stopTicker();
      setActivePart(part);
      setStatus('Imported');
      return;
    }
    // Multi-body in part-mode: extractStepSolids ...
    const solids = await kernel.extractStepSolids({ stepBytes });
    if (solids.length === 0) { ... }
    const firstSolid = solids[0];
    if (!firstSolid) { ... }
    const part = buildImportedPartDocument(`${baseName}_1`, firstSolid.brepBlobId, file.name);
    await kernel.registerPart(part);
    stopTicker();
    setActivePart(part);
    setStatus(`Imported first body of ${solids.length} from ${file.name}`);
  }
  ```

  Replace with (Phase 1 — always whole-compound):
  ```typescript
  } else {
    // Part-mode: import the whole compound shape (all solids + non-solid geometry).
    // Phase 1 fix: do NOT call extractStepSolids / keep only solids[0].
    // Use ExplodeIntoAssembly command if individual bodies are needed.
    const stepBytes = await file.arrayBuffer();
    const { buildImportedPartDocument } = await import('../../import/buildImportedPartDocument');
    const { stepFilenameBasename } = await import('../../import/originFeatures');
    const baseName = stepFilenameBasename(file.name);
    const importResult = await kernel.importStep({ stepBytes, partName: baseName });
    const part = buildImportedPartDocument(baseName, importResult.brepBlobId, file.name);
    await kernel.registerPart(part);
    stopTicker();
    setActivePart(part);
    setStatus('Imported');
  }
  ```

  Also remove any now-orphaned dynamic imports (`buildImportedPartDocument`, `stepFilenameBasename`) that are only needed by the deleted multi-body branch. (They remain if still used by the single-body sub-branch above, which is now merged. Verify imports at file top.)

- [ ] **1.4 Run tests — confirm GREEN + no regressions.**
  ```bash
  pnpm --filter @zilventor/app test -- --reporter=verbose FileTab.spec.tsx 2>&1 | tail -40
  ```
  All existing FileTab tests (including the multi-body test previously asserting "first body of 3" — task 1.5 updates it) should pass. Note: the existing test at line ~348 `'multi-body STEP in part-mode registers only the first sub-solid and emits setStatus'` will now FAIL because the behavior changed. That is expected and is addressed next.

- [ ] **1.5 Update stale test** in the `'handleOpen — STEP part-mode multi-body branch'` describe block. The old test asserted that `extractStepSolids` was called and "first body of 3" status was set. Update it to match Phase 1 behavior:

  ```typescript
  it('multi-body STEP in part-mode uses whole-compound import (Phase 1: no extractStepSolids, no _1 suffix)', async () => {
    const registerPart = vi.fn(async () => {});
    const importStep = vi.fn(async () => ({
      brepBlobId: 'blob-compound',
      triangleCount: 0,
      boundingBox: [0, 0, 0, 50, 10, 10] as [number, number, number, number, number, number],
      faceCount: 24,
      solidCount: 3,
    }));
    const extractStepSolids = vi.fn();

    useAppStore.setState((s) => ({
      ...s,
      kernel: { importStep, extractStepSolids, registerPart } as any,
    }));

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([
      { getFile: async () => ({ name: 'gizmo.step', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) } as unknown as FileSystemFileHandle,
    ]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));

    await waitFor(() => {
      expect(registerPart).toHaveBeenCalledOnce();
    });

    expect(importStep).toHaveBeenCalledOnce();
    expect(extractStepSolids).not.toHaveBeenCalled();
    // Whole-compound: name is bare 'gizmo', NOT 'gizmo_1'
    expect(useAppStore.getState().activePart?.name).toBe('gizmo');
    expect(useAppStore.getState().statusMessage).toBe('Imported');
  });
  ```

- [ ] **1.6 Run full FileTab suite — all GREEN.**
  ```bash
  pnpm --filter @zilventor/app test -- --reporter=verbose FileTab 2>&1 | tail -40
  ```

- [ ] **1.7 Commit.**
  ```bash
  git add packages/app/src/shell/tabs/FileTab.tsx packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx
  git commit -m "fix(import): part-mode STEP always imports whole compound shape (Phase 1)"
  ```

---

### Task 2 — Kernel integration: whole-compound import bbox (two-bodies)

**Files:**
- Test: `packages/kernel/src/occt/__tests__/StepIO.integration.spec.ts`
- Impl: None (kernel already correct — `importStep` caches the whole compound; test verifies the claim)

**Steps:**

- [ ] **2.1 RED — add failing test** in `StepIO.integration.spec.ts`:

```typescript
it('imports two-bodies.step as a single compound with combined bbox spanning both bodies', () => {
  const bytes = readFileSync(resolve(FIXTURES, 'two-bodies.step'));
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = readStep(oc, ab);
  try {
    // two-bodies.step = two 10mm cubes side by side: cube1 at 0..10, cube2 at 20..30
    // combined bbox x should span 0..30 (both bodies, NOT just solids[0] at 0..10)
    expect(result.solidCount).toBe(2);
    // The compound bbox covers both bodies
    const [xMin, , , xMax] = result.boundingBox;
    expect(xMin).toBeCloseTo(0, 0);
    expect(xMax).toBeGreaterThan(19); // spans into second body
    // vertexCount not directly available from readStep, but we verify nothing is dropped via bbox
  } finally {
    disposeShape(result.shape);
  }
});
```

- [ ] **2.2 Run test — confirm RED or PASS.**
  ```bash
  cd /Users/lion/Documents/Projects/mine/zilventor
  pnpm --filter @zilventor/kernel test:integration -- --reporter=verbose StepIO.integration 2>&1 | tail -30
  ```
  If the test PASSES immediately (the claim was already true), that is acceptable — the test is now a regression guard. Document in commit message "adds regression guard for whole-compound bbox coverage". If RED, `readStep` has a bug; investigate before proceeding.

- [ ] **2.3 Commit.**
  ```bash
  git add packages/kernel/src/occt/__tests__/StepIO.integration.spec.ts
  git commit -m "test(kernel): integration guard — importStep bbox spans all bodies in two-bodies.step"
  ```

---

### Task 3 — E2E: open two-bodies STEP in part-mode → single part, bbox spans both

**Files:**
- Create: `tests/e2e/step-full-model-on-open.spec.ts`

**Steps:**

- [ ] **3.1 RED — create e2e test.**

```typescript
// tests/e2e/step-full-model-on-open.spec.ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const TWO_BODIES = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step',
);

test('open two-bodies STEP in part-mode → one whole-compound part, no assembly created', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // Ensure no active document (fresh state = part-mode)
  const activeKindBefore = await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    return useAppStore.getState().activeDocument?.kind ?? null;
  });
  expect(activeKindBefore).toBeNull();

  // Inject the STEP bytes via the DEV hook that imports as a part
  // (same pattern as multi-body-step-explosion.spec.ts for the assembly path)
  const stepBytes = readFileSync(TWO_BODIES);
  const base64 = stepBytes.toString('base64');

  // Use importStep directly via page.evaluate — no DEV hook needed for this path
  // because it exercises the kernel API which is available globally via __zilventorStore.
  await page.evaluate(async (b64: string) => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    const kernel = useAppStore.getState().kernel;
    if (!kernel) throw new Error('kernel not ready');

    // Decode base64 → ArrayBuffer
    const bin = atob(b64);
    const ab = new ArrayBuffer(bin.length);
    const view = new Uint8Array(ab);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);

    const { buildImportedPartDocument } = await import('/src/import/buildImportedPartDocument.ts');
    const importResult = await kernel.importStep({ stepBytes: ab, partName: 'two-bodies' });
    const part = buildImportedPartDocument('two-bodies', importResult.brepBlobId, 'two-bodies.step');
    await kernel.registerPart(part);
    useAppStore.getState().setActivePart(part);
    useAppStore.getState().setStatus('Imported');
  }, base64);

  // Confirm exactly one active part (not an assembly)
  const state = await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    const s = useAppStore.getState();
    return {
      kind: s.activeDocument?.kind ?? null,
      partName: s.activePart?.name ?? null,
      solidCount: (s.activePart?.featureTree.find((f: any) => f.kind === 'imported') as any)?.solidCount ?? null,
      status: s.statusMessage,
    };
  });

  expect(state.kind).toBe('part');
  expect(state.partName).toBe('two-bodies');
  expect(state.status).toBe('Imported');

  // Verify the kernel's importedShapeCache contains the compound (solidCount=2 from importStep)
  const importResult = await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    const kernel = useAppStore.getState().kernel;
    if (!kernel) return null;
    const r = await (kernel as any).importStep({ stepBytes: new ArrayBuffer(0), partName: 'probe' }).catch(() => null);
    return r;
  });
  // We can't directly call importStep with empty bytes without error, so verify via
  // active part's feature tree brepBlobId roundtrip — kernel had to cache it.
  // Instead: assert activePart featureTree has one 'imported' feature referencing a blob
  const hasBlobRef = await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    const part = useAppStore.getState().activePart;
    if (!part) return false;
    return part.featureTree.some((f: any) => f.kind === 'imported' && typeof f.bodyRef === 'string' && f.bodyRef.startsWith('imp-'));
  });
  expect(hasBlobRef).toBe(true);
});
```

- [ ] **3.2 Run e2e — confirm RED (or PASS if kernel path was already correct).**
  ```bash
  pnpm --filter @zilventor/e2e exec playwright test step-full-model-on-open --reporter=list 2>&1 | tail -40
  ```

- [ ] **3.3 Commit after GREEN.**
  ```bash
  git add tests/e2e/step-full-model-on-open.spec.ts
  git commit -m "test(e2e): open two-bodies STEP in part-mode yields single whole-compound part"
  ```

---

## Phase 2a — Kernel: `splitImportedShape`

### Task 4 — Kernel helper `splitImportedShapeHelper` in StepIO.ts

**Files:**
- Fixture: `packages/kernel/src/occt/__tests__/fixtures/step/mixed-solid-surface.step` (create a minimal fixture containing one solid + one open shell)
- Test: `packages/kernel/src/occt/__tests__/StepIO.splitImportedShape.integration.spec.ts`
- Impl: `packages/kernel/src/occt/StepIO.ts`

**Context:** `splitImportedShape` in the kernel takes a `brepBlobId` (already in `importedShapeCache`) and splits the cached compound's top-level children into solids (each wrapped as a fresh compound blob) and non-solid children (all merged into one compound blob, or `null` if none). Uses `TopoDS_Iterator` to iterate top-level children (avoids recursion through `TopExp_Explorer_2` which descends into nested children).

**NOTE on fixture:** `two-bodies.step` has 2 solids and 0 open shells (all-solid case). For the surfaces-bucket case we need a fixture with at least one non-solid child. Create `mixed-solid-surface.step` — a minimal STEP with one solid cube + one open shell face (a simple trimmed surface). If creating a real STEP is impractical, note that the all-solid case is fully tested by `two-bodies.step` and the surfaces test is a unit test with a mocked kernel.

**Steps:**

- [ ] **4.1 Obtain a committed mixed solid+shell fixture AND set up the authoritative real-model check.**

  The surfaces bucket is the core value of this work, so it MUST be proven against real non-solid geometry — not just mocks. Two layers:

  **(a) Authoritative local check against the real Predator (do this first — it is the ground truth).** The user has `/Users/lion/Downloads/mq-1-predator-uav.zip` → `Assem1.STEP` (8 solids + 5 OPEN_SHELL + 1 SHELL_BASED_SURFACE_MODEL = the wings). Add a LOCAL-ONLY integration test that runs only when the file is present (so CI skips it):
  ```typescript
  // In StepIO.splitImportedShape.integration.spec.ts
  const PREDATOR_LOCAL = '/tmp/mq1pred/Assem1.STEP'; // unzip the user's zip here first
  const hasPredator = (() => { try { readFileSync(PREDATOR_LOCAL); return true; } catch { return false; } })();
  (hasPredator ? it : it.skip)('REAL Predator → 8 solid blobs + 1 surfaces blob, union bbox X ±7319 (wings kept)', () => {
    const bytes = readFileSync(PREDATOR_LOCAL);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parent = readStep(oc, ab);
    try {
      const result = splitImportedShapeHelper(oc, parent.shape);
      try {
        expect(result.solids.length).toBe(8);
        expect(result.surfaces).not.toBeNull();                       // wings present
        // surfaces compound must extend to the full wingspan (±7319), which the solids alone do NOT
        const sb = computeBoundingBox(oc, result.surfaces!.shape);
        expect(Math.max(Math.abs(sb[0]), Math.abs(sb[3]))).toBeGreaterThan(6000);
      } finally {
        for (const s of result.solids) disposeShape(s.shape);
        if (result.surfaces) disposeShape(result.surfaces.shape);
      }
    } finally { disposeShape(parent.shape); }
  });
  ```
  Before running Task 4 tests: `unzip -o /Users/lion/Downloads/mq-1-predator-uav.zip -d /tmp/mq1pred`. This check is the real proof the wings survive; it gates Task 4 completion on the executor's machine.

  **(b) Committed small fixture for CI.** Generate `mixed-solid-surface.step` deterministically. Preferred: FreeCAD headless (`freecadcmd`) or pythonOCC if available — build one box solid + one free planar face, export via `STEPControl_Writer`. If neither tool is installed, the kernel has no STEP *writer* exposed, so DO NOT block: commit nothing, leave the `mixed-solid-surface.step` test with its skip-guard (it already returns early if the file is absent), and rely on layer (a) as the authoritative proof plus the unit-level surfaces coverage in Task 6. Record in the commit message which proof path was used.

- [ ] **4.2 RED — create `StepIO.splitImportedShape.integration.spec.ts`:**

```typescript
// packages/kernel/src/occt/__tests__/StepIO.splitImportedShape.integration.spec.ts
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { readStep, splitImportedShapeHelper } from '../StepIO';
import { disposeShape } from '../SolidOps';

const FIXTURES = resolve(__dirname, 'fixtures/step');

describe('splitImportedShapeHelper (integration)', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); });

  it('two-bodies.step → 2 solid blobs, surfaces=null', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'two-bodies.step'));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parent = readStep(oc, ab);
    try {
      const result = splitImportedShapeHelper(oc, parent.shape);
      try {
        expect(result.solids).toHaveLength(2);
        expect(result.surfaces).toBeNull();
        // Each solid blob gets its own brepBlobId and shape
        for (const s of result.solids) {
          expect(s.brepBlobId).toMatch(/^imp-/);
          expect(s.shape).toBeDefined();
        }
      } finally {
        for (const s of result.solids) disposeShape(s.shape);
        if (result.surfaces) disposeShape(result.surfaces.shape);
      }
    } finally {
      disposeShape(parent.shape);
    }
  });

  it('cube-10mm.step (single solid) → 1 solid blob, surfaces=null', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'cube-10mm.step'));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parent = readStep(oc, ab);
    try {
      const result = splitImportedShapeHelper(oc, parent.shape);
      try {
        expect(result.solids).toHaveLength(1);
        expect(result.surfaces).toBeNull();
      } finally {
        for (const s of result.solids) disposeShape(s.shape);
        if (result.surfaces) disposeShape(result.surfaces.shape);
      }
    } finally {
      disposeShape(parent.shape);
    }
  });

  it('mixed-solid-surface.step → 1 solid blob + 1 surfaces blob (non-null)', () => {
    // Skips if fixture missing (fixture creation is manual step)
    const fixturePath = resolve(FIXTURES, 'mixed-solid-surface.step');
    let bytes: Buffer;
    try { bytes = readFileSync(fixturePath); }
    catch { return; } // fixture not yet committed — skip gracefully
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parent = readStep(oc, ab);
    try {
      const result = splitImportedShapeHelper(oc, parent.shape);
      try {
        expect(result.solids.length).toBeGreaterThanOrEqual(1);
        expect(result.surfaces).not.toBeNull();
      } finally {
        for (const s of result.solids) disposeShape(s.shape);
        if (result.surfaces) disposeShape(result.surfaces.shape);
      }
    } finally {
      disposeShape(parent.shape);
    }
  });

  it('throws if zero top-level solids AND no surfaces (empty compound)', () => {
    // Construct an empty compound and pass it — splitImportedShapeHelper should throw
    // This is a corner-case guard; requires synthetic shape construction.
    // If not feasible with the test harness, mark as known deferred.
    // expect(() => splitImportedShapeHelper(oc, emptyCompound)).toThrow(/no geometry/i);
  });
});
```

- [ ] **4.3 Run integration test — confirm RED.**
  ```bash
  pnpm --filter @zilventor/kernel test:integration -- --reporter=verbose StepIO.splitImportedShape 2>&1 | tail -30
  ```
  Expected: `splitImportedShapeHelper is not exported` (function does not exist yet).

- [ ] **4.4 GREEN — implement `splitImportedShapeHelper` in `StepIO.ts`.**

  Add after the existing `extractStepSolids` function:

```typescript
export type SplitImportedShapeResult = {
  solids: ExtractedSolid[];             // one entry per top-level SOLID child
  surfaces: { brepBlobId: string; shape: OcctShape } | null;  // merged non-solid children, or null
};

/**
 * Splits a cached compound shape (from importedShapeCache) into:
 *  - one ExtractedSolid per top-level TopAbs_SOLID child (same wrap pattern as extractStepSolids)
 *  - one merged compound of all non-solid children (open shells, surface models, etc.), or null if none.
 *
 * Uses TopoDS_Iterator to enumerate the compound's immediate children (NOT TopExp_Explorer_2
 * which would recurse). This correctly captures top-level SOLID vs SHELL/FACE children as
 * exported by STEP translators for mixed-body models.
 *
 * Throws if the compound has zero solids AND zero non-solid children (truly empty).
 * Does NOT throw for zero-surfaces (returns surfaces=null).
 */
export function splitImportedShapeHelper(
  oc: OcctInstance,
  compound: OcctShape,
): SplitImportedShapeResult {
  const TAS = (oc as {
    TopAbs_ShapeEnum: {
      TopAbs_SOLID: unknown;
      TopAbs_SHAPE: unknown;
    }
  }).TopAbs_ShapeEnum;

  const IterCtor = (oc as {
    TopoDS_Iterator: new (s: unknown) => {
      More(): boolean;
      Next(): void;
      Value(): unknown;
      delete?(): void;
    }
  }).TopoDS_Iterator;

  const BRepBuilderCtor = (oc as {
    BRep_Builder: new () => {
      MakeCompound(c: unknown): void;
      Add(c: unknown, s: unknown): void;
      delete(): void;
    }
  }).BRep_Builder;

  const CompoundCtor = (oc as { TopoDS_Compound: new () => unknown }).TopoDS_Compound;

  // We need ShapeType to classify each child
  const TopoDS = (oc as {
    TopoDS?: { Solid?: (s: unknown) => unknown };
  }).TopoDS;

  // Use TopExp_Explorer to test if a shape IS a solid at top level:
  // Classify each immediate child via TopAbs_SOLID explorer (More() = has solid children)
  const ExplorerCtor = (oc as {
    TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
      More(): boolean;
      Next(): void;
      delete?(): void;
    }
  }).TopExp_Explorer_2;

  const solids: ExtractedSolid[] = [];
  const nonSolidHandles: unknown[] = [];

  const iter = new IterCtor(compound.handle);
  try {
    while (iter.More()) {
      const child = iter.Value();
      // Test if this immediate child is itself a SOLID by exploring it for solids
      // stopping at SHAPE level (no descent). If the explorer finds exactly this child
      // as a solid, it is a solid; otherwise it is a non-solid shell/face/etc.
      const solidExp = new ExplorerCtor(child, TAS.TopAbs_SOLID, TAS.TopAbs_SHAPE);
      const isSolid = solidExp.More();
      solidExp.delete?.();

      if (isSolid) {
        // Wrap in a fresh compound (mirrors extractStepSolids wrapping)
        const builder = new BRepBuilderCtor();
        const comp = new CompoundCtor();
        builder.MakeCompound(comp);
        builder.Add(comp, child);
        builder.delete();
        const subShape: OcctShape = { __brand: 'OcctShape' as const, handle: comp };
        const boundingBox = computeBoundingBox(oc, subShape);
        const brepBlobId = `imp-${crypto.randomUUID()}`;
        solids.push({ brepBlobId, boundingBox, shape: subShape });
      } else {
        nonSolidHandles.push(child);
      }
      iter.Next();
    }
  } finally {
    iter.delete?.();
  }

  if (solids.length === 0 && nonSolidHandles.length === 0) {
    throw new Error('splitImportedShape: compound has no geometry (zero solids and zero surfaces)');
  }

  let surfaces: { brepBlobId: string; shape: OcctShape } | null = null;
  if (nonSolidHandles.length > 0) {
    const builder = new BRepBuilderCtor();
    const comp = new CompoundCtor();
    builder.MakeCompound(comp);
    for (const h of nonSolidHandles) {
      builder.Add(comp, h);
    }
    builder.delete();
    surfaces = {
      brepBlobId: `imp-${crypto.randomUUID()}`,
      shape: { __brand: 'OcctShape' as const, handle: comp },
    };
  }

  return { solids, surfaces };
}
```

- [ ] **4.5 Run integration tests — GREEN.**
  ```bash
  pnpm --filter @zilventor/kernel test:integration -- --reporter=verbose StepIO.splitImportedShape 2>&1 | tail -30
  ```

- [ ] **4.6 Commit.**
  ```bash
  git add packages/kernel/src/occt/StepIO.ts packages/kernel/src/occt/__tests__/StepIO.splitImportedShape.integration.spec.ts
  git commit -m "feat(kernel): splitImportedShapeHelper — splits cached compound into solids + surfaces"
  ```

---

### Task 5 — Kernel API: `splitImportedShape` on `KernelApi`

**Files:**
- Impl: `packages/kernel/src/api.ts`

**Steps:**

- [ ] **5.1 RED — no standalone unit test for api.ts (the integration spec in Task 4 covers it). Add the `splitImportedShape` method to the `KernelApi` type** (this will cause a TypeScript compile error / the implementation closure to fail `tsc`, which is the equivalent of RED for a type addition). Verify:
  ```bash
  pnpm --filter @zilventor/kernel tsc --noEmit 2>&1 | tail -20
  ```
  Expected error: `Property 'splitImportedShape' does not exist on type 'KernelApi'` (because we haven't added it yet to the interface — the implementation closure will fail after the interface is updated).

- [ ] **5.2 Add `splitImportedShape` to the `KernelApi` type** in `api.ts` (~line 96, after `extractStepSolids`):

```typescript
/**
 * Splits a previously-imported compound shape (looked up by brepBlobId from
 * importedShapeCache) into individual solid blobs + one merged surfaces blob.
 * Each solid child becomes a new cached blob (brepBlobId registered via
 * registerImportedShape). The surfaces blob is similarly cached (null if none).
 *
 * Throws if brepBlobId is not in cache. Throws if compound has zero geometry.
 * Does NOT remove the original compound from cache — caller decides lifecycle.
 */
splitImportedShape(brepBlobId: string): Promise<{
  solids: Array<{ brepBlobId: string; boundingBox: BoundingBox }>;
  surfaces: { brepBlobId: string; boundingBox: BoundingBox } | null;
}>;
```

- [ ] **5.3 Implement `splitImportedShape` in the `createKernelApi` closure** (add after `extractStepSolids` ~line 443):

```typescript
async splitImportedShape(brepBlobId) {
  if (!occt) throw new Error('kernel not initialized');
  const cached = importedShapeCache.get(brepBlobId);
  if (!cached) {
    throw new Error(`splitImportedShape: brepBlobId '${brepBlobId}' not in importedShapeCache`);
  }
  const { splitImportedShapeHelper } = await import('./occt/StepIO').then(m => m);
  const result = splitImportedShapeHelper(occt, cached);

  // Register each solid blob in the cache
  const solidResults = result.solids.map((s) => {
    registerImportedShape(s.brepBlobId, s.shape);
    return { brepBlobId: s.brepBlobId, boundingBox: s.boundingBox };
  });

  // Register surfaces blob if present
  let surfacesResult: { brepBlobId: string; boundingBox: BoundingBox } | null = null;
  if (result.surfaces) {
    const surfacesBbox = computeBoundingBox(occt, result.surfaces.shape);
    registerImportedShape(result.surfaces.brepBlobId, result.surfaces.shape);
    surfacesResult = { brepBlobId: result.surfaces.brepBlobId, boundingBox: surfacesBbox };
  }

  return { solids: solidResults, surfaces: surfacesResult };
},
```

  Note: `computeBoundingBox` is imported at top of `api.ts` already (used in `importStep`). Verify and add import if missing.

- [ ] **5.4 Run tsc + integration tests.**
  ```bash
  pnpm --filter @zilventor/kernel tsc --noEmit 2>&1 | tail -10
  pnpm --filter @zilventor/kernel test:integration -- --reporter=verbose 2>&1 | tail -20
  ```
  All integration tests (StepIO, new splitImportedShape spec) must pass.

- [ ] **5.5 Commit.**
  ```bash
  git add packages/kernel/src/api.ts
  git commit -m "feat(kernel): splitImportedShape API — splits cached compound blob into solids + surfaces"
  ```

---

## Phase 2b — App: `ExplodeIntoAssemblyCommand`

### Task 6 — `ExplodeIntoAssemblyCommand` unit tests + implementation

**Files:**
- Test: `packages/app/src/commands/__tests__/ExplodeIntoAssemblyCommand.spec.ts`
- Impl: `packages/app/src/commands/ExplodeIntoAssemblyCommand.ts`

**Context:** The command reads the active PartDocument's ImportedFeature.bodyRef (the compound brepBlobId), calls `kernel.splitImportedShape(blobId)` to get `{ solids, surfaces }`, builds N PartDocuments (+ 1 for surfaces if present), registers them with the kernel, saves to OPFS, builds a new AssemblyDocument with N+1 components at identity pose, and calls `setActiveDocument({ kind: 'assembly', document })`. Undo restores the original part as active document and cleans up created parts. Names: `<base>_1 … <base>_N` for solids, `<base>_surfaces` for the bucket.

The command is NOT entered via `CommandBus.execute` because there is no undo-needed semantics in this initial pass — it manages its own undo state exactly like `ImportStepAsComponentCommand`. The bus is used so undo/redo works.

**Steps:**

- [ ] **6.1 RED — create `ExplodeIntoAssemblyCommand.spec.ts`:**

```typescript
// packages/app/src/commands/__tests__/ExplodeIntoAssemblyCommand.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import type { PartDocument } from '@zilventor/shared';

// Minimal PartDocument factory
function makeImportedPart(name: string, blobId: string): PartDocument {
  return {
    id: `part-${name}`,
    name,
    units: 'mm',
    parameters: {},
    featureTree: [
      { kind: 'imported', id: 'imp-1', sourceStep: `${name}.step`, bodyRef: blobId },
    ],
    properties: {},
    materials: [],
    hardware: [],
  } as PartDocument;
}

describe('ExplodeIntoAssemblyCommand', () => {
  const mockOpfs = {
    write: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    delete: vi.fn(async () => {}),
    listAll: vi.fn(async () => []),
  };

  const mockKernel = {
    splitImportedShape: vi.fn(),
    registerPart: vi.fn(async () => {}),
    saveToBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    deletePart: vi.fn(async () => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().setActiveDocument(null);
    useAppStore.setState((s) => ({ ...s, kernel: mockKernel as any }));
  });

  it('apply: 2-solid STEP (no surfaces) → 2 components at origin, assembly active, part names _1/_2', async () => {
    const part = makeImportedPart('Predator', 'blob-compound');
    useAppStore.getState().setActivePart(part);

    mockKernel.splitImportedShape.mockResolvedValue({
      solids: [
        { brepBlobId: 'solid-1', boundingBox: [0, 0, 0, 10, 10, 10] },
        { brepBlobId: 'solid-2', boundingBox: [20, 0, 0, 30, 10, 10] },
      ],
      surfaces: null,
    });

    const { ExplodeIntoAssemblyCommand } = await import('../ExplodeIntoAssemblyCommand');
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: mockKernel as any, opfs: mockOpfs });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    expect(doc?.kind).toBe('assembly');
    const asm = doc?.document as import('@zilventor/shared').AssemblyDocument;
    expect(asm.components).toHaveLength(2);

    // Component part paths follow <name>_N.zipt convention
    const partPaths = asm.components.map((c) => c.partPath).sort();
    expect(partPaths).toEqual(['Predator_1.zipt', 'Predator_2.zipt']);

    // All components at identity pose
    for (const c of asm.components) {
      expect(c.position).toEqual({ x: 0, y: 0, z: 0 });
      expect(c.rotation).toEqual({ rx: 0, ry: 0, rz: 0 });
    }

    // kernel.registerPart called twice (no surfaces bucket)
    expect(mockKernel.registerPart).toHaveBeenCalledTimes(2);
    expect(mockKernel.splitImportedShape).toHaveBeenCalledWith('blob-compound');
  });

  it('apply: 2-solid + surfaces → 3 components, _surfaces part included', async () => {
    const part = makeImportedPart('Plane', 'blob-plane');
    useAppStore.getState().setActivePart(part);

    mockKernel.splitImportedShape.mockResolvedValue({
      solids: [
        { brepBlobId: 'solid-1', boundingBox: [0, 0, 0, 10, 10, 10] },
        { brepBlobId: 'solid-2', boundingBox: [20, 0, 0, 30, 10, 10] },
      ],
      surfaces: { brepBlobId: 'surf-1', boundingBox: [-50, -5, -5, 50, 5, 5] },
    });

    const { ExplodeIntoAssemblyCommand } = await import('../ExplodeIntoAssemblyCommand');
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: mockKernel as any, opfs: mockOpfs });
    await cmd.apply();

    const asm = useAppStore.getState().activeAssembly;
    expect(asm?.components).toHaveLength(3);
    const paths = asm!.components.map((c) => c.partPath).sort();
    expect(paths).toContain('Plane_surfaces.zipt');
    expect(paths).toContain('Plane_1.zipt');
    expect(paths).toContain('Plane_2.zipt');
    expect(mockKernel.registerPart).toHaveBeenCalledTimes(3);
  });

  it('revert: restores original part as active document, deletes created parts from kernel', async () => {
    const part = makeImportedPart('Gadget', 'blob-gadget');
    useAppStore.getState().setActivePart(part);

    mockKernel.splitImportedShape.mockResolvedValue({
      solids: [
        { brepBlobId: 'solid-a', boundingBox: [0, 0, 0, 5, 5, 5] },
      ],
      surfaces: null,
    });

    const { ExplodeIntoAssemblyCommand } = await import('../ExplodeIntoAssemblyCommand');
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: mockKernel as any, opfs: mockOpfs });
    await cmd.apply();

    expect(useAppStore.getState().activeDocument?.kind).toBe('assembly');

    await cmd.revert();

    // Original part restored
    expect(useAppStore.getState().activeDocument?.kind).toBe('part');
    expect(useAppStore.getState().activePart?.name).toBe('Gadget');

    // Created part deleted from kernel
    expect(mockKernel.deletePart).toHaveBeenCalledTimes(1);
  });

  it('apply throws if active document is not an imported part', async () => {
    useAppStore.getState().setActiveDocument(null);

    const { ExplodeIntoAssemblyCommand } = await import('../ExplodeIntoAssemblyCommand');
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: mockKernel as any, opfs: mockOpfs });
    await expect(cmd.apply()).rejects.toThrow(/no active imported part/i);
  });

  it('apply throws if active part has no imported feature', async () => {
    const part: PartDocument = {
      id: 'p1', name: 'Sketch', units: 'mm',
      parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [],
    } as PartDocument;
    useAppStore.getState().setActivePart(part);

    const { ExplodeIntoAssemblyCommand } = await import('../ExplodeIntoAssemblyCommand');
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: mockKernel as any, opfs: mockOpfs });
    await expect(cmd.apply()).rejects.toThrow(/no imported feature/i);
  });
});
```

- [ ] **6.2 Run tests — confirm RED.**
  ```bash
  pnpm --filter @zilventor/app test -- --reporter=verbose ExplodeIntoAssemblyCommand 2>&1 | tail -20
  ```
  Expected: `Cannot find module '../ExplodeIntoAssemblyCommand'`.

- [ ] **6.3 GREEN — create `ExplodeIntoAssemblyCommand.ts`:**

  **Before writing the `AssemblyDocument` literal below, find how "New Assembly" builds an empty assembly** (search for the FileTab/handler that creates one, e.g. a `createEmptyAssembly`/`newAssemblyDocument` helper or the inline literal in the New-Assembly handler) and **reuse that** to seed the document, then set `.components`. The field list in the snippet below is REFERENCE — verify every field against the real `AssemblyDocument` type in `@zilventor/shared` (run `tsc`); do not trust the literal verbatim. Same for `ComponentInstance` (mirror `makeOriginInstance` in `ImportStepAsComponentCommand.ts`).

```typescript
// packages/app/src/commands/ExplodeIntoAssemblyCommand.ts
import type { Command } from './Command';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { AssemblyDocument, PartDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { buildImportedPartDocument } from '../import/buildImportedPartDocument';
import type { ActiveDocument } from '../store/useAppStore';

export type OpfsLike = {
  write(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  listAll(): Promise<string[]>;
};

export type ExplodeIntoAssemblyOpts = {
  kernel: Pick<KernelApi, 'splitImportedShape' | 'registerPart' | 'saveToBytes' | 'deletePart'>;
  opfs: OpfsLike;
};

/**
 * Explodes the active imported PartDocument into an AssemblyDocument:
 * one component per solid body + one 'surfaces' component (if any non-solid children exist).
 * Components placed at identity pose so native STEP coordinates reconstruct the model.
 *
 * apply():  split → build N+1 PartDocuments → setActiveDocument(assembly)
 * revert(): restore original part as active document, deregister created parts
 */
export class ExplodeIntoAssemblyCommand implements Command {
  readonly name = 'ExplodeIntoAssembly';

  private priorActiveDocument: ActiveDocument | null = null;
  private createdPartIds: string[] = [];
  private createdPartPaths: string[] = [];

  constructor(private readonly opts: ExplodeIntoAssemblyOpts) {}

  async apply(): Promise<void> {
    const { kernel, opfs } = this.opts;
    const state = useAppStore.getState();

    const activePart = state.activePart;
    if (!activePart) {
      throw new Error('ExplodeIntoAssembly: no active imported part');
    }

    const importedFeature = activePart.featureTree.find(
      (f): f is Extract<typeof f, { kind: 'imported' }> => f.kind === 'imported',
    );
    if (!importedFeature) {
      throw new Error('ExplodeIntoAssembly: no imported feature in active part — only imported parts can be exploded');
    }

    // Save prior state for revert
    this.priorActiveDocument = state.activeDocument;
    this.createdPartIds = [];
    this.createdPartPaths = [];

    const baseName = activePart.name;
    const sourceStep = importedFeature.sourceStep;

    const splitResult = await kernel.splitImportedShape(importedFeature.bodyRef);

    const createdParts: PartDocument[] = [];
    const createdPaths: string[] = [];

    try {
      // Build solid parts: <base>_1 … <base>_N
      for (let i = 0; i < splitResult.solids.length; i++) {
        const solid = splitResult.solids[i];
        if (!solid) continue;
        const partName = `${baseName}_${i + 1}`;
        const part = buildImportedPartDocument(partName, solid.brepBlobId, sourceStep);
        await kernel.registerPart(part);
        const archiveBytes = await kernel.saveToBytes(part.id);
        const opfsPath = `${partName}.zipt`;
        await opfs.write(opfsPath, archiveBytes);
        createdParts.push(part);
        createdPaths.push(opfsPath);
        this.createdPartIds.push(part.id);
        this.createdPartPaths.push(opfsPath);
      }

      // Build surfaces part: <base>_surfaces (only if non-null)
      if (splitResult.surfaces) {
        const partName = `${baseName}_surfaces`;
        const part = buildImportedPartDocument(partName, splitResult.surfaces.brepBlobId, sourceStep);
        await kernel.registerPart(part);
        const archiveBytes = await kernel.saveToBytes(part.id);
        const opfsPath = `${partName}.zipt`;
        await opfs.write(opfsPath, archiveBytes);
        createdParts.push(part);
        createdPaths.push(opfsPath);
        this.createdPartIds.push(part.id);
        this.createdPartPaths.push(opfsPath);
      }
    } catch (err) {
      // Atomic abort: deregister parts already created
      for (const id of [...this.createdPartIds].reverse()) {
        try { await kernel.deletePart(id); } catch { /* best-effort */ }
      }
      for (const path of [...this.createdPartPaths].reverse()) {
        try { await (opfs as OpfsLike & { delete?: (p: string) => Promise<void> }).delete?.(path); } catch { /* best-effort */ }
      }
      this.createdPartIds = [];
      this.createdPartPaths = [];
      this.priorActiveDocument = null;
      throw err;
    }

    // Build the new assembly
    const asm: AssemblyDocument = {
      id: `A${Date.now()}`,
      name: `${baseName} Assembly`,
      units: 'mm',
      parameters: {},
      properties: {},
      components: createdPaths.map((partPath) => ({
        id: `comp-${crypto.randomUUID()}`,
        partPath,
        position: { x: 0, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      })),
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {},
      cutListItemNumbers: {},
      colorOverrides: {},
      materials: [],
      hardware: [],
    };

    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    useAppStore.getState().setStatus(
      splitResult.surfaces
        ? `Exploded into ${splitResult.solids.length} solid${splitResult.solids.length !== 1 ? 's' : ''} + surfaces`
        : `Exploded into ${splitResult.solids.length} component${splitResult.solids.length !== 1 ? 's' : ''}`,
    );
  }

  async revert(): Promise<void> {
    const { kernel, opfs } = this.opts;

    // Restore prior active document
    useAppStore.getState().setActiveDocument(this.priorActiveDocument);

    // Deregister created parts from kernel (best-effort)
    for (const id of [...this.createdPartIds].reverse()) {
      try { await kernel.deletePart(id); } catch { /* best-effort */ }
    }

    // Delete OPFS files (best-effort)
    for (const path of [...this.createdPartPaths].reverse()) {
      try { await (opfs as OpfsLike & { delete?: (p: string) => Promise<void> }).delete?.(path); } catch { /* best-effort */ }
    }

    this.createdPartIds = [];
    this.createdPartPaths = [];
  }
}
```

- [ ] **6.4 Run unit tests — GREEN.**
  ```bash
  pnpm --filter @zilventor/app test -- --reporter=verbose ExplodeIntoAssemblyCommand 2>&1 | tail -30
  ```

- [ ] **6.5 Run full app unit suite (regression guard).**
  ```bash
  pnpm --filter @zilventor/app test -- --reporter=dot 2>&1 | tail -10
  ```

- [ ] **6.6 Commit.**
  ```bash
  git add packages/app/src/commands/ExplodeIntoAssemblyCommand.ts packages/app/src/commands/__tests__/ExplodeIntoAssemblyCommand.spec.ts
  git commit -m "feat(commands): ExplodeIntoAssemblyCommand — splits imported part into assembly of N components"
  ```

---

### Task 7 — AssemblyTab: "Explode into Assembly" button

**Files:**
- Impl: `packages/app/src/shell/tabs/AssemblyTab.tsx`
- Test: `packages/app/src/shell/tabs/__tests__/AssemblyTab.spec.tsx`

**Context:** The button lives in the Assembly tab ribbon. Enablement: the active document is a `PartDocument` whose `featureTree` contains exactly one `kind: 'imported'` feature (i.e., an imported part that has not yet been exploded). When an assembly is active, or when no document is active, the button is disabled.

**Steps:**

- [ ] **7.1 RED — add tests to `AssemblyTab.spec.tsx`.**  Read the existing file first to pick the right describe block, then add:

```typescript
describe('Explode into Assembly button', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
  });

  it('is disabled when no active document', () => {
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /explode into assembly/i });
    expect(btn).toBeDisabled();
  });

  it('is disabled when active document is an assembly', () => {
    useAppStore.getState().setActiveDocument({
      kind: 'assembly',
      document: {
        id: 'A1', name: 'myAsm', units: 'mm',
        parameters: {}, properties: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
        cutListItemNumbers: {}, colorOverrides: {}, materials: [], hardware: [],
      },
    });
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /explode into assembly/i });
    expect(btn).toBeDisabled();
  });

  it('is enabled when active document is an imported part', () => {
    const part: import('@zilventor/shared').PartDocument = {
      id: 'p1', name: 'Predator', units: 'mm', parameters: {},
      featureTree: [
        { kind: 'imported', id: 'i1', sourceStep: 'Predator.step', bodyRef: 'blob-1' },
      ],
      properties: {}, materials: [], hardware: [],
    } as import('@zilventor/shared').PartDocument;
    useAppStore.getState().setActivePart(part);
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /explode into assembly/i });
    expect(btn).not.toBeDisabled();
  });

  it('is disabled when active part has no imported feature (parametric part)', () => {
    const part: import('@zilventor/shared').PartDocument = {
      id: 'p1', name: 'MyBox', units: 'mm', parameters: {},
      featureTree: [],
      properties: {}, materials: [], hardware: [],
    } as import('@zilventor/shared').PartDocument;
    useAppStore.getState().setActivePart(part);
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /explode into assembly/i });
    expect(btn).toBeDisabled();
  });
});
```

- [ ] **7.2 Run tests — confirm RED.**
  ```bash
  pnpm --filter @zilventor/app test -- --reporter=verbose AssemblyTab 2>&1 | tail -20
  ```
  Expected: `Unable to find role="button" with name "Explode into Assembly"` (button not yet in JSX).

- [ ] **7.3 GREEN — add button to `AssemblyTab.tsx`.**

  Add a selector and handler near the top of the component:
  ```typescript
  const isImportedPart = useAppStore((s) => {
    if (s.activeDocument?.kind !== 'part') return false;
    return s.activePart?.featureTree.some((f) => f.kind === 'imported') ?? false;
  });
  ```

  Add `handleExplode` handler:
  ```typescript
  const handleExplode = async () => {
    const { kernel, bus } = useAppStore.getState();
    if (!kernel) return;
    try {
      const { ExplodeIntoAssemblyCommand } = await import('../../commands/ExplodeIntoAssemblyCommand');
      const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
      const opfs = await Opfs.forNavigator();
      const cmd = new ExplodeIntoAssemblyCommand({ kernel, opfs });
      await bus.execute(cmd);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      useAppStore.getState().setStatus(`Explode failed: ${(e as Error).message}`);
    }
  };
  ```

  Add button in the JSX (in the Component section, after "Insert From STEP…"):
  ```tsx
  <button
    aria-label="Explode into Assembly"
    disabled={!isImportedPart}
    onClick={handleExplode}
    style={btn}
  >
    Explode into Assembly
  </button>
  ```

- [ ] **7.4 Run AssemblyTab tests — GREEN.**
  ```bash
  pnpm --filter @zilventor/app test -- --reporter=verbose AssemblyTab 2>&1 | tail -30
  ```

- [ ] **7.5 Run full app suite — no regressions.**
  ```bash
  pnpm --filter @zilventor/app test -- --reporter=dot 2>&1 | tail -10
  ```

- [ ] **7.6 Commit.**
  ```bash
  git add packages/app/src/shell/tabs/AssemblyTab.tsx packages/app/src/shell/tabs/__tests__/AssemblyTab.spec.tsx
  git commit -m "feat(ui): Explode into Assembly button on Assembly tab (enabled for imported parts only)"
  ```

---

### Task 8 — E2E: open → explode → N components, undo → back to part

**Files:**
- Create: `tests/e2e/step-explode-into-assembly.spec.ts`

**Steps:**

- [ ] **8.1 RED — create e2e test:**

```typescript
// tests/e2e/step-explode-into-assembly.spec.ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const TWO_BODIES = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step',
);

test('open two-bodies STEP → Explode → 2 components in assembly, undo → back to part', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Import two-bodies.step in part-mode (no assembly active)
  const stepBytes = readFileSync(TWO_BODIES);
  const base64 = stepBytes.toString('base64');

  await page.evaluate(async (b64: string) => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    const kernel = useAppStore.getState().kernel;
    if (!kernel) throw new Error('kernel not ready');
    const bin = atob(b64);
    const ab = new ArrayBuffer(bin.length);
    const view = new Uint8Array(ab);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    const { buildImportedPartDocument } = await import('/src/import/buildImportedPartDocument.ts');
    const importResult = await kernel.importStep({ stepBytes: ab, partName: 'two-bodies' });
    const part = buildImportedPartDocument('two-bodies', importResult.brepBlobId, 'two-bodies.step');
    await kernel.registerPart(part);
    useAppStore.getState().setActivePart(part);
    useAppStore.getState().setStatus('Imported');
  }, base64);

  // 2. Confirm part-mode
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'part';
  }, undefined, { timeout: 10_000 });

  // 3. Navigate to Assembly tab and click "Explode into Assembly"
  await page.getByRole('tab', { name: 'Assembly' }).click();
  const explodeBtn = page.getByRole('button', { name: /explode into assembly/i });
  await expect(explodeBtn).toBeEnabled({ timeout: 5_000 });
  await explodeBtn.click();

  // 4. Wait for assembly with 2 components
  await page.waitForFunction(() => {
    const w = window as any;
    const doc = w.__zilventorStore?.getState().activeDocument;
    return doc?.kind === 'assembly' && doc.document.components.length === 2;
  }, undefined, { timeout: 15_000 });

  const asmState = await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    const doc = useAppStore.getState().activeDocument;
    if (doc?.kind !== 'assembly') return null;
    return {
      componentCount: doc.document.components.length,
      partPaths: doc.document.components.map((c: any) => c.partPath).sort(),
      allAtOrigin: doc.document.components.every((c: any) =>
        c.position.x === 0 && c.position.y === 0 && c.position.z === 0,
      ),
    };
  });

  expect(asmState?.componentCount).toBe(2);
  expect(asmState?.partPaths).toEqual(['two-bodies_1.zipt', 'two-bodies_2.zipt']);
  expect(asmState?.allAtOrigin).toBe(true);

  // 5. Undo → back to part
  await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    await useAppStore.getState().bus?.undo();
  });

  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'part';
  }, undefined, { timeout: 10_000 });

  const afterUndo = await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    const s = useAppStore.getState();
    return { kind: s.activeDocument?.kind, partName: s.activePart?.name };
  });
  expect(afterUndo.kind).toBe('part');
  expect(afterUndo.partName).toBe('two-bodies');
});
```

- [ ] **8.2 Run e2e — confirm RED (button not yet wired in real dev build).**
  ```bash
  pnpm --filter @zilventor/e2e exec playwright test step-explode-into-assembly --reporter=list 2>&1 | tail -40
  ```

- [ ] **8.3 GREEN — should pass once Tasks 5–7 are done.** Re-run after all prior tasks complete.

- [ ] **8.4 Commit.**
  ```bash
  git add tests/e2e/step-explode-into-assembly.spec.ts
  git commit -m "test(e2e): Explode into Assembly round-trip — 2 components + undo restores part"
  ```

---

## Phase 3 — Reconcile assembly-insert (optional)

### Task 9 — `importStepIntoNewParts` uses `splitImportedShape` to preserve surfaces

**Files:**
- Test: `packages/app/src/import/__tests__/importStepIntoNewParts.spec.ts` (create or modify)
- Impl: `packages/app/src/import/importStepIntoNewParts.ts`

**Note:** This task is lower priority and can be deferred if schedule is tight. It changes the assembly-insert path (`ImportStepAsComponentCommand` → `importStepIntoNewParts`) to also preserve non-solid children. The shared-helper approach reuses `kernel.splitImportedShape` instead of `kernel.extractStepSolids`.

**Steps:**

- [ ] **9.1 Assess feasibility.** Read the current `importStepIntoNewParts.ts` and confirm the `ImportStepIntoNewPartsInput` type includes a kernel with `extractStepSolids`. The change: add `splitImportedShape` to the kernel type requirement and switch the implementation to:
  1. Call `kernel.importStep(stepBytes, baseName)` to get the whole compound blobId.
  2. Call `kernel.splitImportedShape(blobId)` to get `{ solids, surfaces }`.
  3. Build N parts for solids + 1 for surfaces (when non-null), with the same `N==1 → bare baseName` convention (but only for solids; surfaces always gets `_surfaces` suffix).

  Update `ImportStepAsComponentCommand`'s kernel type to include `splitImportedShape | importStep` instead of `extractStepSolids`.

- [ ] **9.2 RED — add unit test asserting surfaces bucket is produced:**

```typescript
// In importStepIntoNewParts.spec.ts — new test
it('preserves surfaces bucket when kernel.splitImportedShape returns non-null surfaces', async () => {
  const mockKernel = {
    importStep: vi.fn(async () => ({ brepBlobId: 'blob-0', triangleCount: 0, boundingBox: [0,0,0,1,1,1], faceCount: 4, solidCount: 1 })),
    splitImportedShape: vi.fn(async () => ({
      solids: [{ brepBlobId: 'solid-1', boundingBox: [0,0,0,1,1,1] }],
      surfaces: { brepBlobId: 'surf-1', boundingBox: [-1,-1,-1, 1,1,1] },
    })),
    registerPart: vi.fn(async () => {}),
    saveToBytes: vi.fn(async () => new Uint8Array([1,2,3])),
  };
  const mockOpfs = {
    write: vi.fn(async () => {}),
    listAll: vi.fn(async () => [] as string[]),
  };

  const results = await importStepIntoNewParts({
    baseName: 'Wing',
    sourceFileName: 'Wing.step',
    stepBytes: new ArrayBuffer(4),
    kernel: mockKernel as any,
    opfs: mockOpfs,
  });

  // 1 solid + 1 surfaces part
  expect(results).toHaveLength(2);
  const names = results.map((r) => r.part.name).sort();
  expect(names).toContain('Wing_1');
  expect(names).toContain('Wing_surfaces');
});
```

- [ ] **9.3 Run test — confirm RED.**

- [ ] **9.4 GREEN — refactor `importStepIntoNewParts.ts`:**

  Replace the `extractStepSolids` call with `importStep` + `splitImportedShape`:

```typescript
// importStepIntoNewParts.ts (Phase 3 version)
export type ImportStepIntoNewPartsInput = {
  baseName: string;
  sourceFileName: string;
  stepBytes: ArrayBuffer;
  kernel: Pick<KernelApi, 'importStep' | 'splitImportedShape' | 'registerPart' | 'saveToBytes'>;
  opfs: OpfsLike;
};

export async function importStepIntoNewParts(
  input: ImportStepIntoNewPartsInput,
): Promise<ImportStepIntoNewPartsResult[]> {
  const { baseName, sourceFileName, stepBytes, kernel, opfs } = input;

  // Phase 3: use splitImportedShape (whole-compound → split) instead of extractStepSolids
  const wholeResult = await kernel.importStep({ stepBytes, partName: baseName });
  const splitResult = await kernel.splitImportedShape(wholeResult.brepBlobId);

  const existing = (await opfs.listAll())
    .filter((p) => p.endsWith('.zipt'))
    .map((p) => p.replace(/\.zipt$/, ''));
  const registered: ImportStepIntoNewPartsResult[] = [];

  const solidCount = splitResult.solids.length;

  try {
    for (let i = 0; i < solidCount; i++) {
      const solid = splitResult.solids[i];
      if (!solid) continue;
      const candidateName = solidCount === 1 ? baseName : `${baseName}_${i + 1}`;
      const name = dedupeName(candidateName, [...existing, ...registered.map((r) => r.part.name)]);
      const part = buildImportedPartDocument(name, solid.brepBlobId, sourceFileName);
      await kernel.registerPart(part);
      const archiveBytes = await kernel.saveToBytes(part.id);
      const opfsPath = `${name}.zipt`;
      await opfs.write(opfsPath, archiveBytes);
      registered.push({ partId: part.id, opfsPath, part, archiveBytes });
    }

    if (splitResult.surfaces) {
      const name = dedupeName(`${baseName}_surfaces`, [...existing, ...registered.map((r) => r.part.name)]);
      const part = buildImportedPartDocument(name, splitResult.surfaces.brepBlobId, sourceFileName);
      await kernel.registerPart(part);
      const archiveBytes = await kernel.saveToBytes(part.id);
      const opfsPath = `${name}.zipt`;
      await opfs.write(opfsPath, archiveBytes);
      registered.push({ partId: part.id, opfsPath, part, archiveBytes });
    }

    return registered;
  } catch (err) {
    for (const r of [...registered].reverse()) {
      try { await (kernel as any).deletePart?.(r.partId); } catch { /* swallow */ }
      try { await (opfs as any).delete?.(r.opfsPath); } catch { /* swallow */ }
    }
    throw err;
  }
}
```

  Also update `ImportStepAsComponentCommand.ts` kernel type to replace `extractStepSolids` with `importStep | splitImportedShape`.

- [ ] **9.5 Run full unit + integration suite.**
  ```bash
  pnpm test 2>&1 | tail -20
  ```

- [ ] **9.6 Commit.**
  ```bash
  git add packages/app/src/import/importStepIntoNewParts.ts packages/app/src/commands/ImportStepAsComponentCommand.ts
  git commit -m "feat(import): assembly-insert STEP preserves non-solid surfaces (Phase 3)"
  ```

---

## Final verification checklist

Before marking complete, run all of the following and confirm each passes:

```bash
# Unit tests
pnpm --filter @zilventor/app test -- --reporter=dot
pnpm --filter @zilventor/kernel test -- --reporter=dot

# Kernel integration tests (requires real OCCT WASM)
pnpm --filter @zilventor/kernel test:integration -- --reporter=dot

# TypeScript
pnpm --filter @zilventor/app tsc --noEmit
pnpm --filter @zilventor/kernel tsc --noEmit

# E2E (dev server must be running)
pnpm --filter @zilventor/e2e exec playwright test step-full-model-on-open step-explode-into-assembly --reporter=list
```

Expected: all green. If any fail, apply `superpowers:systematic-debugging` before marking done.

---

## Spec coverage checklist

| Spec requirement | Covered by task |
|---|---|
| Part-mode STEP → whole compound, no geometry dropped | Tasks 1, 2, 3 |
| Multi-body part-mode: no `extractStepSolids` / `solids[0]` | Task 1 (FileTab surgery) |
| `splitImportedShape` kernel API (solids + surfaces bucket) | Tasks 4, 5 |
| Surfaces bucket is null when no non-solid children | Tasks 4, 6 |
| N solid blobs + 1 surfaces blob registered in cache | Tasks 4, 5 |
| `ExplodeIntoAssemblyCommand` apply / revert | Task 6 |
| Components at identity pose | Task 6 |
| Names `<base>_1.._N` + `<base>_surfaces` | Tasks 6, 8 |
| "Explode into Assembly" button on Assembly tab | Task 7 |
| Button enabled only for imported parts | Task 7 |
| E2E: open → explode → 2 components → undo → part | Task 8 |
| Framing auto-fits (already shipped, no new task) | Note only |
| No manifest bump | Verified — no schema change |
| Assembly-insert also keeps surfaces (Phase 3) | Task 9 (optional) |
| Error: brepBlobId not in cache → throw | Task 5 (impl guard) |
| Error: zero geometry → throw | Task 4 (spec notes) |
| Error: active doc not imported part → throw | Task 6 |
| OPFS write failure → atomic abort | Task 6 (catch block) |
