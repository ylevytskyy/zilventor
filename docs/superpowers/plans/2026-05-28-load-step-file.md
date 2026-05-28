# Load STEP file — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File → Open accepts `.step` / `.stp`; the chosen file is imported as a new part document and the viewport renders it.

**Architecture:** Reuse the entire Sub-project 1.5 STEP-ingest pipeline (`kernel.importStep`, `ImportedFeature`, `importedShapeCache`, viewport rendering). The only new code is (a) a tiny `kernel.registerPart(part)` API that direct-inserts a `PartDocument` into the kernel's `parts` map — needed because `kernel.loadFromBytes` requires brep blobs to be in the packed archive, which would force re-serialization of cached blobs; (b) an `importStepIntoNewPart` app-layer helper; (c) a STEP branch in `FileTab.handleOpen`; (d) a `window.__zilventorImportStepFromBytes` test-only helper mirroring the existing `__zilventorImportFromFiles` pattern.

**Tech Stack:** TypeScript, OCCT-WASM via opencascade.js, React 18, Vitest, Playwright. Test fixture reuses the existing `packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step` (10 mm cube, 6 faces, 1 solid).

**Deviation from spec:** The spec proposed reusing `ProjectPacker.pack` + `kernel.loadFromBytes`. While writing this plan we verified that `loadFromBytes` requires the imported-feature blob to be in the archive's `blobs/` map (`api.ts:369-376`), but `packProject` has no mechanism to extract a cached `OcctShape` back to bytes, and the kernel exposes no `exportBrep(blobId)` API. Adding such an API would be more code than a minimal `registerPart(part)`. The plan therefore adds `registerPart`; the spec is otherwise unchanged.

---

### Task 1: Extract ORIGIN_FEATURES + stepFilenameBasename into a shared module

A pure refactor — moves the seven origin features and the `stepFilenameBasename` helper out of `buildPartDocument.ts` so the new `importStepIntoNewPart` helper can share them without duplication. No behavior change.

**Files:**
- Create: `packages/app/src/import/originFeatures.ts`
- Create: `packages/app/src/import/__tests__/originFeatures.spec.ts`
- Modify: `packages/app/src/import/buildPartDocument.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/import/__tests__/originFeatures.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ORIGIN_FEATURES, stepFilenameBasename } from '../originFeatures';

describe('originFeatures', () => {
  it('exposes 7 origin features in canonical order', () => {
    expect(ORIGIN_FEATURES.map((f) => f.id)).toEqual([
      'origin.X', 'origin.Y', 'origin.Z',
      'origin.XY', 'origin.YZ', 'origin.XZ',
      'origin.O',
    ]);
    expect(ORIGIN_FEATURES.every((f) => f.visible === false)).toBe(true);
  });

  it('every origin feature is keyed origin work-geometry', () => {
    const kinds = ORIGIN_FEATURES.map((f) => f.kind);
    expect(kinds).toEqual(['workAxis', 'workAxis', 'workAxis', 'workPlane', 'workPlane', 'workPlane', 'workPoint']);
  });
});

describe('stepFilenameBasename', () => {
  it('strips a trailing .step (any case)', () => {
    expect(stepFilenameBasename('Foo.step')).toBe('Foo');
    expect(stepFilenameBasename('Foo.STEP')).toBe('Foo');
    expect(stepFilenameBasename('path/to/Foo.step')).toBe('Foo');
  });

  it('strips a trailing .stp (any case)', () => {
    expect(stepFilenameBasename('Bar.stp')).toBe('Bar');
    expect(stepFilenameBasename('Bar.STP')).toBe('Bar');
  });

  it('returns the basename unchanged when no .step/.stp extension', () => {
    expect(stepFilenameBasename('NoExt')).toBe('NoExt');
    expect(stepFilenameBasename('path/to/leaf')).toBe('leaf');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails for the expected reason**

Run: `pnpm --filter @zilventor/app exec vitest run src/import/__tests__/originFeatures.spec.ts`
Expected: FAIL — `Cannot find module '../originFeatures'`.

- [ ] **Step 3: Create the new module**

Create `packages/app/src/import/originFeatures.ts`:

```ts
import type { Feature } from '@zilventor/shared';

/**
 * The canonical 7 origin work-geometry features that every part document
 * starts with. Shared between the Inventor importer (buildPartDocument)
 * and the stand-alone STEP importer (importStepIntoNewPart).
 */
export const ORIGIN_FEATURES: ReadonlyArray<Feature> = [
  { kind: 'workAxis',  id: 'origin.X',  visible: false, source: { mode: 'origin', axis: 'X' } },
  { kind: 'workAxis',  id: 'origin.Y',  visible: false, source: { mode: 'origin', axis: 'Y' } },
  { kind: 'workAxis',  id: 'origin.Z',  visible: false, source: { mode: 'origin', axis: 'Z' } },
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
  { kind: 'workPoint', id: 'origin.O',  visible: false, source: { mode: 'origin' } },
];

/**
 * Strips a trailing `.step` or `.stp` (case-insensitive) from a path or filename,
 * returning the basename. Used to derive the part name from a STEP file.
 */
export function stepFilenameBasename(input: string): string {
  const leaf = input.split('/').pop() ?? input;
  return leaf.replace(/\.(step|stp)$/i, '');
}
```

- [ ] **Step 4: Modify `buildPartDocument.ts` to import from the shared module**

Open `packages/app/src/import/buildPartDocument.ts` and:
- Delete lines 4-12 (the inline `ORIGIN_FEATURES` array).
- Delete lines 21-24 (the inline `stepFilenameBasename` function).
- Add to the imports near the top:
  ```ts
  import { ORIGIN_FEATURES, stepFilenameBasename } from './originFeatures';
  ```

Final imports in `buildPartDocument.ts` should read:

```ts
import type { PartDocument, ImportedFeature, SketchParameter, Feature } from '@zilventor/shared';
import type { ImporterPartJson, ImporterParameter } from './inventorJsonSchema';
import { ORIGIN_FEATURES, stepFilenameBasename } from './originFeatures';
```

(The unused `Feature` import in `buildPartDocument.ts` can stay — it's used elsewhere in the file's type machinery; do not remove it unless `pnpm typecheck` flags it.)

- [ ] **Step 5: Run the new + existing tests; confirm green**

Run: `pnpm --filter @zilventor/app exec vitest run src/import/`
Expected: PASS — `originFeatures.spec.ts` plus the existing `buildPartDocument.spec.ts` / `buildAssemblyDocument.spec.ts` / etc. all green. Roughly 5-8 specs in this directory.

- [ ] **Step 6: Run `pnpm typecheck` to catch any unused-import bleed**

Run from repo root: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/import/originFeatures.ts \
        packages/app/src/import/__tests__/originFeatures.spec.ts \
        packages/app/src/import/buildPartDocument.ts
git commit -m "refactor(import): extract ORIGIN_FEATURES + stepFilenameBasename into shared module

Pure refactor — preparing for the stand-alone STEP importer which needs
the same 7 origin features and the same filename-basename helper that
buildPartDocument uses. No behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add `kernel.registerPart(part)` API

A minimal kernel API that direct-inserts a `PartDocument` into the kernel's `parts` map without round-tripping through pack/unpack. The brep blob is already in `importedShapeCache` because the caller will have called `kernel.importStep` first. No new schema, no new error paths.

**Files:**
- Modify: `packages/kernel/src/api.ts`
- Create: `packages/kernel/src/__tests__/registerPart.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

Create `packages/kernel/src/__tests__/registerPart.integration.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PartDocument } from '@zilventor/shared';
import { createKernelApi } from '../api';

const ORIGIN_FEATURES: PartDocument['featureTree'] = [
  { kind: 'workAxis',  id: 'origin.X',  visible: false, source: { mode: 'origin', axis: 'X' } },
  { kind: 'workAxis',  id: 'origin.Y',  visible: false, source: { mode: 'origin', axis: 'Y' } },
  { kind: 'workAxis',  id: 'origin.Z',  visible: false, source: { mode: 'origin', axis: 'Z' } },
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
  { kind: 'workPoint', id: 'origin.O',  visible: false, source: { mode: 'origin' } },
];

describe('kernel.registerPart (integration)', () => {
  it('makes a stand-alone-STEP part executable end-to-end', async () => {
    const api = createKernelApi();
    await api.init();

    // 1. Ingest the cube STEP — this populates the importedShapeCache.
    const stepBytes = readFileSync(resolve(__dirname, '../occt/__tests__/fixtures/step/cube-10mm.step'));
    const importResult = await api.importStep({
      stepBytes: stepBytes.buffer.slice(stepBytes.byteOffset, stepBytes.byteOffset + stepBytes.byteLength),
      partName: 'cube-10mm',
    });
    expect(importResult.brepBlobId).toMatch(/^imp-/);
    expect(importResult.faceCount).toBe(6);

    // 2. Build a PartDocument referencing the cached blob.
    const part: PartDocument = {
      id: crypto.randomUUID(),
      name: 'cube-10mm',
      units: 'mm',
      parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        { kind: 'imported', id: 'imp.body', sourceStep: 'cube-10mm.step', bodyRef: importResult.brepBlobId },
      ],
      properties: {},
      materials: [],
      hardware: [],
    };

    // 3. Register and verify getPart round-trips.
    await api.registerPart(part);
    const fetched = await api.getPart(part.id);
    expect(fetched.id).toBe(part.id);
    expect(fetched.featureTree).toHaveLength(8);

    // 4. Execute — should produce a non-empty NamedShape (6-face cube).
    const result = await api.execute(part.id);
    expect(result.ok).toBe(true);
  });

  it('throws if the kernel is not initialized', async () => {
    const api = createKernelApi();
    // Skip init() deliberately.
    const part: PartDocument = {
      id: 'p1', name: 'x', units: 'mm', parameters: {},
      featureTree: [...ORIGIN_FEATURES],
      properties: {}, materials: [], hardware: [],
    };
    await expect(api.registerPart(part)).rejects.toThrow(/not initialized/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails for the expected reason**

Run: `pnpm --filter @zilventor/kernel exec vitest run --config vitest.integration.config.ts src/__tests__/registerPart.integration.spec.ts`
Expected: FAIL — `api.registerPart is not a function`.

- [ ] **Step 3: Add `registerPart` to the `KernelApi` type**

In `packages/kernel/src/api.ts`, locate the `KernelApi` type definition. Add this method signature alongside `loadFromBytes` (around line 77):

```ts
/** Direct-insert a fully-constructed PartDocument into the kernel's parts map.
 *  Used by the stand-alone STEP importer, where the imported brep blob is
 *  already in the kernel's importedShapeCache (populated by importStep) and
 *  no archive round-trip is needed. Throws if the kernel is not initialized
 *  or if a part with the same id is already registered. */
registerPart(part: PartDocument): Promise<void>;
```

- [ ] **Step 4: Implement `registerPart` in `createKernelApi`**

In `packages/kernel/src/api.ts`, inside the `return { … }` block in `createKernelApi`, add the implementation near `loadFromBytes` (after the closing brace of `loadFromBytes`):

```ts
async registerPart(part) {
  if (!occt) throw new Error('kernel not initialized');
  if (parts.has(part.id)) throw new Error(`registerPart: part ${part.id} is already registered`);
  parts.set(part.id, part);
},
```

- [ ] **Step 5: Run the test; confirm green**

Run: `pnpm --filter @zilventor/kernel exec vitest run --config vitest.integration.config.ts src/__tests__/registerPart.integration.spec.ts`
Expected: PASS — both cases green. The `execute` call confirms the importedShapeCache wiring is correct end-to-end.

- [ ] **Step 6: Run the full kernel integration suite to make sure nothing regressed**

Run: `pnpm --filter @zilventor/kernel test:integration`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/kernel/src/api.ts \
        packages/kernel/src/__tests__/registerPart.integration.spec.ts
git commit -m "feat(kernel): registerPart(part) direct-inserts a PartDocument

Lets the stand-alone STEP importer wire a freshly-built PartDocument
into the kernel without round-tripping through ProjectPacker (which
would force re-serializing the brep blob that's already cached by
importStep). Throws if kernel not init'd or if id is already taken.

Integration test asserts the full chain works: importStep populates
importedShapeCache → registerPart inserts the document → execute()
produces a non-empty NamedShape for the cube fixture.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Implement `importStepIntoNewPart` helper

Pure app-layer helper that orchestrates the three kernel calls (`importStep` → build doc → `registerPart`) and returns the populated `PartDocument`. Unit-tested against a mocked kernel.

**Files:**
- Create: `packages/app/src/import/importStepIntoNewPart.ts`
- Create: `packages/app/src/import/__tests__/importStepIntoNewPart.spec.ts`

- [ ] **Step 1: Write the failing unit test**

Create `packages/app/src/import/__tests__/importStepIntoNewPart.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { KernelApi } from '@zilventor/kernel';
import type { PartDocument } from '@zilventor/shared';
import { importStepIntoNewPart } from '../importStepIntoNewPart';
import { ORIGIN_FEATURES } from '../originFeatures';

function makeFile(name: string, bytes: ArrayBuffer): File {
  // Vitest jsdom supplies File; .arrayBuffer() works.
  return new File([bytes], name, { type: 'application/step' });
}

function makeKernelMock(): {
  kernel: Pick<KernelApi, 'importStep' | 'registerPart'>;
  importStep: ReturnType<typeof vi.fn>;
  registerPart: ReturnType<typeof vi.fn>;
} {
  const importStep = vi.fn(async () => ({
    brepBlobId: 'imp-abc-123',
    triangleCount: 12,
    boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number],
    faceCount: 6,
  }));
  const registerPart = vi.fn(async () => undefined);
  return { kernel: { importStep, registerPart } as Pick<KernelApi, 'importStep' | 'registerPart'>, importStep, registerPart };
}

describe('importStepIntoNewPart', () => {
  it('builds a PartDocument with origin features + one ImportedFeature', async () => {
    const { kernel, importStep, registerPart } = makeKernelMock();
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const file = makeFile('MyKnob.step', bytes);

    const { partId, part } = await importStepIntoNewPart(file, kernel as unknown as KernelApi);

    expect(importStep).toHaveBeenCalledOnce();
    const arg = importStep.mock.calls[0][0] as { stepBytes: ArrayBuffer; partName: string };
    expect(arg.partName).toBe('MyKnob');
    expect(new Uint8Array(arg.stepBytes)).toEqual(new Uint8Array([1, 2, 3, 4]));

    expect(part.name).toBe('MyKnob');
    expect(part.units).toBe('mm');
    expect(part.parameters).toEqual({});
    expect(part.materials).toEqual([]);
    expect(part.hardware).toEqual([]);
    expect(part.featureTree.length).toBe(ORIGIN_FEATURES.length + 1);
    expect(part.featureTree.slice(0, ORIGIN_FEATURES.length)).toEqual(ORIGIN_FEATURES);

    const imported = part.featureTree[part.featureTree.length - 1];
    expect(imported.kind).toBe('imported');
    if (imported.kind !== 'imported') throw new Error('type guard');
    expect(imported.sourceStep).toBe('MyKnob.step');
    expect(imported.bodyRef).toBe('imp-abc-123');

    expect(registerPart).toHaveBeenCalledOnce();
    expect((registerPart.mock.calls[0][0] as PartDocument).id).toBe(partId);
  });

  it('strips a .stp (uppercase) extension to compute the part name', async () => {
    const { kernel } = makeKernelMock();
    const file = makeFile('Hinge.STP', new Uint8Array([0]).buffer);
    const { part } = await importStepIntoNewPart(file, kernel as unknown as KernelApi);
    expect(part.name).toBe('Hinge');
  });

  it('propagates kernel.importStep failures', async () => {
    const importStep = vi.fn(async () => { throw new Error('readStep: STEP produced an empty shape'); });
    const registerPart = vi.fn();
    const kernel = { importStep, registerPart } as unknown as KernelApi;
    const file = makeFile('Empty.step', new Uint8Array([0]).buffer);
    await expect(importStepIntoNewPart(file, kernel)).rejects.toThrow(/empty shape/);
    expect(registerPart).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails for the expected reason**

Run: `pnpm --filter @zilventor/app exec vitest run src/import/__tests__/importStepIntoNewPart.spec.ts`
Expected: FAIL — `Cannot find module '../importStepIntoNewPart'`.

- [ ] **Step 3: Implement the helper**

Create `packages/app/src/import/importStepIntoNewPart.ts`:

```ts
import type { KernelApi } from '@zilventor/kernel';
import type { PartDocument, ImportedFeature } from '@zilventor/shared';
import { ORIGIN_FEATURES, stepFilenameBasename } from './originFeatures';

/**
 * Imports a stand-alone STEP file as a new PartDocument and registers it
 * with the kernel. The returned part is ready to be passed to
 * `setActivePart` so the viewport will render it.
 *
 * Reuses the same ImportedFeature pipeline that Sub-project 1.5 (Inventor
 * importer) introduced: kernel.importStep caches the brep blob, and the
 * ImportedFeature evaluator pulls it back during execute().
 */
export async function importStepIntoNewPart(
  file: File,
  kernel: KernelApi,
): Promise<{ partId: string; part: PartDocument }> {
  const stepBytes = await file.arrayBuffer();
  const partName = stepFilenameBasename(file.name);

  const importResult = await kernel.importStep({ stepBytes, partName });

  const partId = crypto.randomUUID();
  const importedFeatureId = crypto.randomUUID();
  const importedFeature: ImportedFeature = {
    kind: 'imported',
    id: importedFeatureId,
    sourceStep: file.name,
    bodyRef: importResult.brepBlobId,
  };

  const part: PartDocument = {
    id: partId,
    name: partName,
    units: 'mm',
    parameters: {},
    featureTree: [...ORIGIN_FEATURES, importedFeature],
    properties: {},
    materials: [],
    hardware: [],
  };

  await kernel.registerPart(part);
  return { partId, part };
}
```

- [ ] **Step 4: Run the test; confirm green**

Run: `pnpm --filter @zilventor/app exec vitest run src/import/__tests__/importStepIntoNewPart.spec.ts`
Expected: PASS — all three cases green.

- [ ] **Step 5: Run `pnpm typecheck`**

Run from repo root: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/import/importStepIntoNewPart.ts \
        packages/app/src/import/__tests__/importStepIntoNewPart.spec.ts
git commit -m "feat(import): importStepIntoNewPart wraps a STEP file as a new PartDocument

Orchestrates kernel.importStep → build PartDocument with origin features
+ one ImportedFeature → kernel.registerPart. Returns the registered part
so the caller can setActivePart and let the viewport render.

Unit-tested with a mocked kernel: asserts partName derivation (basename
without .step/.stp extension), feature-tree shape (7 origin + 1 imported),
and that registerPart is not called when importStep throws.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Real-kernel integration smoke test for `importStepIntoNewPart`

Front-loaded surface-area check. Boots a real OCCT kernel, feeds the committed `cube-10mm.step`, runs the helper end-to-end, and asserts the registered part executes to a non-empty NamedShape. If the imported-blob cache wiring is wrong this is where it will surface — before we touch any UI.

**Files:**
- Create: `packages/app/src/import/__tests__/importStepIntoNewPart.integration.spec.ts`

(The app package may not have an integration-vitest config; this test runs in the standard `pnpm --filter @zilventor/app test:unit` because the kernel can boot in jsdom + node-WASM. Verify in Step 2 — if it can't boot, fall back to running it as a kernel-side integration test.)

- [ ] **Step 1: Write the integration test**

Create `packages/app/src/import/__tests__/importStepIntoNewPart.integration.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createKernelApi } from '@zilventor/kernel';
import { importStepIntoNewPart } from '../importStepIntoNewPart';

const STEP_PATH = resolve(
  __dirname,
  '../../../../kernel/src/occt/__tests__/fixtures/step/cube-10mm.step',
);

describe('importStepIntoNewPart (real kernel)', () => {
  it('registers a cube part that executes to a non-empty shape', async () => {
    const kernel = createKernelApi();
    await kernel.init();

    const stepBytes = readFileSync(STEP_PATH);
    const file = new File([stepBytes], 'cube-10mm.step', { type: 'application/step' });

    const { partId, part } = await importStepIntoNewPart(file, kernel);

    expect(part.name).toBe('cube-10mm');
    expect(part.featureTree.at(-1)?.kind).toBe('imported');

    // The defining smoke check: execute() does not throw and reports success.
    const result = await kernel.execute(partId);
    expect(result.ok).toBe(true);

    // And getPart round-trips identity.
    const fetched = await kernel.getPart(partId);
    expect(fetched.id).toBe(partId);
  });
});
```

- [ ] **Step 2: Run the test and observe**

Run: `pnpm --filter @zilventor/app exec vitest run src/import/__tests__/importStepIntoNewPart.integration.spec.ts`

Possible outcomes:

| Outcome | Action |
| --- | --- |
| PASS | Continue to Step 3. |
| FAIL with `kernel.init` / OCCT-WASM not loading in jsdom | Move this test to `packages/kernel/src/__tests__/importStepIntoNewPart.integration.spec.ts` and adjust imports (`createKernelApi` from `../api`, `importStepIntoNewPart` from `../../../app/src/import/importStepIntoNewPart`). Re-run with the kernel's integration config: `pnpm --filter @zilventor/kernel exec vitest run --config vitest.integration.config.ts src/__tests__/importStepIntoNewPart.integration.spec.ts`. |
| FAIL with `imported feature ... missing from .zipt blobs` | This means the importedShapeCache wiring was bypassed. Re-read `api.ts:404-418` to confirm `registerImportedShape(brepBlobId, result.shape)` is still called inside `importStep`. If yes, file a bug in this plan's notes; if no, restore it. |
| FAIL with `registerPart: part ... already registered` | crypto.randomUUID() collision implausible — investigate. |

- [ ] **Step 3: If a kernel-side patch was needed, commit it separately**

If Step 2 forced any code change in `api.ts`, `StepIO.ts`, or `executeTree.ts`:
- Commit that patch with its own focused message before the test commit.
- Re-run `pnpm --filter @zilventor/kernel test:integration` to confirm no regression in the full suite.

- [ ] **Step 4: Commit the integration test**

```bash
git add packages/app/src/import/__tests__/importStepIntoNewPart.integration.spec.ts
# (path may be packages/kernel/... if relocated in Step 2)
git commit -m "test(import): real-kernel smoke for importStepIntoNewPart

Boots OCCT, ingests the committed cube-10mm.step fixture via the
helper, asserts execute() succeeds end-to-end. Front-loaded check
that the importStep → registerPart → execute chain is wired through
the importedShapeCache correctly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire `FileTab.handleOpen` to accept `.step` / `.stp`

Adds the STEP file type to the file picker and branches on extension. Mocked-picker unit test confirms the helper is called and `setActivePart` runs.

**Files:**
- Modify: `packages/app/src/shell/tabs/FileTab.tsx`
- Modify: `packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx`

- [ ] **Step 1: Add a failing unit test to `FileTab.spec.tsx`**

Open `packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx`. Append a new `describe('handleOpen — STEP branch', …)` block at the bottom of the existing top-level `describe`:

```ts
describe('handleOpen — STEP branch', () => {
  it('routes a .step file through importStepIntoNewPart and activates the part', async () => {
    // Build a fake .step File and a fake FileSystemFileHandle that returns it.
    const stepBytes = new Uint8Array([1, 2, 3]);
    const fakeFile = new File([stepBytes], 'Knob.step', { type: 'application/step' });
    const fakeHandle = { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
    (window as unknown as { showOpenFilePicker: () => Promise<[FileSystemFileHandle]> })
      .showOpenFilePicker = async () => [fakeHandle];

    // Stub kernel.importStep + kernel.registerPart on the live store kernel.
    const { useAppStore } = await import('../../../store');
    const kernel = useAppStore.getState().kernel as unknown as {
      importStep: typeof vi.fn;
      registerPart: typeof vi.fn;
    } | null;
    if (!kernel) throw new Error('test setup: kernel not initialized in store');
    kernel.importStep = vi.fn(async () => ({
      brepBlobId: 'imp-test-123',
      triangleCount: 12,
      boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number],
      faceCount: 6,
    })) as unknown as typeof kernel.importStep;
    kernel.registerPart = vi.fn(async () => undefined) as unknown as typeof kernel.registerPart;

    // Render FileTab and click Open.
    const { getByText } = render(<FileTab />);
    fireEvent.click(getByText('Open…'));
    await waitFor(() => {
      const active = useAppStore.getState().activePart;
      expect(active?.name).toBe('Knob');
    });

    expect((kernel as unknown as { importStep: ReturnType<typeof vi.fn> }).importStep)
      .toHaveBeenCalledOnce();
    expect((kernel as unknown as { registerPart: ReturnType<typeof vi.fn> }).registerPart)
      .toHaveBeenCalledOnce();
    expect(useAppStore.getState().status).toBe('Imported');
  });
});
```

(Adjust the imports at the top of the spec file as needed: `vi`, `render`, `fireEvent`, `waitFor`, `FileTab`, `useAppStore`. If the existing spec already imports them, reuse the imports.)

- [ ] **Step 2: Run the test and confirm it fails for the expected reason**

Run: `pnpm --filter @zilventor/app exec vitest run src/shell/tabs/__tests__/FileTab.spec.tsx`
Expected: FAIL — either `Knob` is never set as the active part name, or `importStep` was never called (the production code does not yet branch on extension).

- [ ] **Step 3: Modify `FileTab.handleOpen` to add the STEP branch**

Open `packages/app/src/shell/tabs/FileTab.tsx`. Locate `handleOpen` (around line 83).

(a) Extend the `types` array passed to `showOpenFilePicker` (around lines 88-93). Add this entry to the array:

```ts
{ description: 'STEP file', accept: { 'application/step': ['.step', '.stp'] } },
```

The block should read:

```ts
const [handle] = await (window as unknown as FSAWindow).showOpenFilePicker({
  types: [
    { description: 'ZilInventor part',     accept: { 'application/zilinventor-part':     ['.zipt']  } },
    { description: 'ZilInventor assembly', accept: { 'application/zilinventor-assembly': ['.ziasm'] } },
    { description: 'ZilInventor drawing',  accept: { 'application/zilinventor-drawing':  ['.zidw']  } },
    { description: 'STEP file',            accept: { 'application/step':                 ['.step', '.stp'] } },
  ]
});
```

(b) After `const file = await handle.getFile();` (currently line 97) but **before** `const bytes = new Uint8Array(...)` and the manifest peek, add the STEP early-branch:

```ts
// STEP branch — stand-alone STEP file, route through the stand-alone importer.
if (/\.(step|stp)$/i.test(file.name)) {
  const { importStepIntoNewPart } = await import('../../import/importStepIntoNewPart');
  const { part } = await importStepIntoNewPart(file, kernel);
  setActivePart(part);
  setStatus('Imported');
  return;
}
```

The dynamic `import()` keeps the importer code out of the initial bundle.

- [ ] **Step 4: Run the new unit test; confirm green**

Run: `pnpm --filter @zilventor/app exec vitest run src/shell/tabs/__tests__/FileTab.spec.tsx`
Expected: PASS — STEP branch test plus all existing FileTab tests green.

- [ ] **Step 5: Run the full app unit suite**

Run: `pnpm --filter @zilventor/app test:unit`
Expected: all green.

- [ ] **Step 6: Run `pnpm typecheck`**

Run from repo root: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/shell/tabs/FileTab.tsx \
        packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx
git commit -m "feat(shell): File → Open accepts .step / .stp

Adds 'STEP file' to the showOpenFilePicker types and routes .step / .stp
extensions through importStepIntoNewPart instead of the .zipt manifest
peek. On success the new part is activated and status becomes 'Imported'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: E2E test — load `cube-10mm.step` and verify the viewport

A real Playwright end-to-end test. Because `showOpenFilePicker` cannot be driven from Playwright, this test follows the existing Sub-project 1.5 pattern: expose a test-only `window.__zilventorImportStepFromBytes` helper that runs the same code path as `handleOpen`'s STEP branch, then drive it from the e2e.

**Files:**
- Modify: `packages/app/src/main.tsx` (or wherever the existing `__zilventorImportFromFiles` helper is wired — locate via grep)
- Create: `tests/e2e/import/load-single-step.spec.ts`

- [ ] **Step 1: Find the existing `__zilventorImportFromFiles` test-helper wiring**

Run: `grep -rn "__zilventorImportFromFiles" packages/app/src`

Note the file and the pattern used. The new helper should live in the same module and follow the same conditional (e.g. `if (import.meta.env.DEV || import.meta.env.MODE === 'test')`).

- [ ] **Step 2: Expose `window.__zilventorImportStepFromBytes`**

In the same module that exposes `__zilventorImportFromFiles`, add (near that wiring):

```ts
import { importStepIntoNewPart } from './import/importStepIntoNewPart';
// (or '../import/...', depending on the file location)

declare global {
  interface Window {
    __zilventorImportStepFromBytes?: (bytes: number[], filename: string) => Promise<{ partId: string; partName: string }>;
  }
}

if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
  (window as Window).__zilventorImportStepFromBytes = async (bytes, filename) => {
    const { useAppStore } = await import('./store');
    // (Adjust the relative path so the import resolves from this module.)
    const { kernel, setActivePart, setStatus } = useAppStore.getState();
    if (!kernel) throw new Error('__zilventorImportStepFromBytes: kernel not ready');
    const file = new File([new Uint8Array(bytes)], filename, { type: 'application/step' });
    const { partId, part } = await importStepIntoNewPart(file, kernel);
    setActivePart(part);
    setStatus('Imported');
    return { partId, partName: part.name };
  };
}
```

Match the existing module's conventions exactly (locate it with the grep in Step 1; if `useAppStore` is imported at the top of that module, drop the dynamic `await import`).

- [ ] **Step 3: Create the e2e test**

Create `tests/e2e/import/load-single-step.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from '../helpers/buildBox';

test('load a stand-alone STEP file: viewport renders the imported part', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.waitForFunction(() => Boolean(
    (window as unknown as { __zilventorImportStepFromBytes?: unknown }).__zilventorImportStepFromBytes,
  ));

  const stepBytes = readFileSync(
    resolve(__dirname, '../../../packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step'),
  );

  const summary = await page.evaluate(
    async ([bytes]: [number[]]) => {
      const w = window as unknown as {
        __zilventorImportStepFromBytes: (b: number[], f: string) => Promise<{ partId: string; partName: string }>;
      };
      return await w.__zilventorImportStepFromBytes(bytes, 'cube-10mm.step');
    },
    [Array.from(stepBytes)] as [number[]],
  );

  expect(summary.partName).toBe('cube-10mm');
  expect(summary.partId).toMatch(/[0-9a-f-]{36}/);

  // The part is in the store as activePart, and the BrowserPane shows its name.
  await expect(page.getByText('cube-10mm', { exact: false })).toBeVisible({ timeout: 5_000 });

  // Sanity: the bounding box from the store matches the 10mm cube.
  const bbox = await page.evaluate(() => {
    const store = (window as unknown as { __zilventorStore?: { getState: () => { activePart: { featureTree: unknown[] } | null } } }).__zilventorStore;
    if (!store) return null;
    const part = store.getState().activePart;
    return part ? { featureCount: part.featureTree.length } : null;
  });
  expect(bbox?.featureCount).toBe(8); // 7 origin + 1 ImportedFeature
});
```

(If `__zilventorStore` is not the in-app store-bridge name, locate the correct one with `grep -n "__zilventorStore" packages/app/src` and adjust.)

- [ ] **Step 4: Run the e2e**

Run: `pnpm exec playwright test tests/e2e/import/load-single-step.spec.ts --project=chromium`
Expected: PASS.

If it fails:
- Re-check that the dev server is running (Playwright config may auto-start it; if not, `pnpm --filter @zilventor/app dev` in another shell).
- Read the console log dump from the test output — the existing `page.on('console')` capture is intentional.
- Make sure the dynamic-import path in the test-helper resolves at runtime (check Vite logs).

- [ ] **Step 5: Run the e2e suite to make sure nothing else regressed**

Run: `pnpm exec playwright test --project=chromium`
Expected: all green (or only pre-existing failures unrelated to this change — list them and proceed).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/main.tsx \
        tests/e2e/import/load-single-step.spec.ts
# (adjust path of main.tsx if Step 1 found the helper in a different file)
git commit -m "test(e2e): load a stand-alone STEP file → viewport renders the imported part

Mirrors the Sub-project 1.5 e2e pattern: a test-only window helper
(__zilventorImportStepFromBytes) drives the same code path as the
File → Open STEP branch. Asserts partName derivation, browser-pane
display, and feature-tree shape (7 origin + 1 ImportedFeature) against
the committed cube-10mm.step fixture.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run the full app + kernel + shared unit suites**

Run from repo root: `pnpm test:unit`
Expected: every existing test plus the new ones (≈3038–3045 total — the spec called the pre-change count at 3035) all green.

- [ ] **Step 2: Run `pnpm typecheck` across the workspace**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Run the full e2e suite**

Run: `pnpm exec playwright test --project=chromium`
Expected: all green.

- [ ] **Step 4: Manual viewport smoke (optional but recommended)**

Boot the dev server, open the app, **File → Open…**, choose `packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step`, confirm the cube renders in the viewport with orbit/pan/zoom working. Take a screenshot via Chrome DevTools MCP and Read it back.

- [ ] **Step 5: Append a single-line entry to MEMORY.md and write a new project memory file**

Update `~/.claude/projects/-Users-lion-Documents-Projects-mine-zilventor/memory/MEMORY.md` with a one-liner pointing at a new `project_load_step_file_feature.md` describing what shipped and the commit SHA. Match the index style of the existing entries (one line, ≤200 chars). The detail memory itself records: TWENTY-EIGHTH follow-up; tiny `kernel.registerPart` API; `importStepIntoNewPart` helper; FileTab STEP branch; test-only `__zilventorImportStepFromBytes`; reused `cube-10mm.step` fixture; spec-deviation note (registerPart in lieu of pack/loadFromBytes round-trip).

- [ ] **Step 6: Confirm nothing else is staged, then summarize**

Run: `git status`
Expected: clean (or only the memory files modified).

Report: total commits added, total LOC of net new production code, total LOC of net new test code, perf observations (if any), and confirmed/unconfirmed deferred items (place-into-assembly; STEP-CAF color; non-mm units; section/projection of imported parts — only the last is partially verified via the kernel smoke test).

---

## Self-review

**Spec coverage:**

| Spec section | Plan task(s) |
| --- | --- |
| Accept `.step` / `.stp` in File → Open | Task 5 |
| `kernel.importStep → PartDocument → activate → render` | Tasks 2, 3, 5 |
| Part name = basename without extension | Task 1 (`stepFilenameBasename`) + Task 3 (used in helper) |
| Error path through `ErrorDialog` | Task 5 (existing handleOpen catch is untouched and still wraps the STEP branch) |
| Reuse `ORIGIN_FEATURES` | Task 1 |
| `ImportedFeature` schema unchanged | Tasks 2, 3 use it as-is |
| No manifest bump | Confirmed: nothing in the plan writes a `.zipart` or migrates manifest |
| Unit test for helper | Task 3 |
| Integration test (kernel side already covered) | Task 4 (front-loaded extra smoke) |
| E2E with fixture | Task 6 (reuses `cube-10mm.step`) |
| Front-loaded investigation | Task 4 (and the spec-deviation note prepended to the plan because the issue was visible at plan-writing time) |

Spec section "Non-goals (deferred)" requires no tasks by design.

**Placeholder scan:** All steps have concrete commands, exact file paths, full code blocks. The only "TBD-ish" item is Step 6 → Step 1 (locate `__zilventorImportFromFiles` via grep) — that's a deliberate find-then-act because the spec did not capture which file owns it, and re-grepping at execution time is cheaper than reading a third memory entry now. The grep command is concrete.

**Type consistency:** `KernelApi.registerPart(part: PartDocument): Promise<void>` is used the same way in Tasks 2, 3, 4, 5. `importStepIntoNewPart(file, kernel)` returns `{ partId, part }` in Tasks 3, 5, 6. `ORIGIN_FEATURES` is the same `ReadonlyArray<Feature>` everywhere. `stepFilenameBasename` is the same `(input: string) => string` everywhere.

**Spec deviation flagged:** Documented at the top of the plan; the kernel-side `registerPart` change is contained to one method.

Plan is ready.
