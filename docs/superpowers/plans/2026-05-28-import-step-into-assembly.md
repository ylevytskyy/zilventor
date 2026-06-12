# Plan: Import STEP into Active Assembly as a Component

**Spec:** `docs/superpowers/specs/2026-05-28-import-step-into-assembly-design.md`
**Date:** 2026-05-28
**Base commit:** `133dbc0`

---

## Goal

When the user opens a `.step`/`.stp` file while an assembly is the active document, import it as a new `.zipt` part, register it with the kernel, persist it to OPFS, and insert it as a component at the assembly origin — all in one atomic undo/redo command. When the active document is a part, drawing, or absent, preserve today's behavior (new standalone part).

---

## Architecture

### New helpers / files

| File | Responsibility |
|---|---|
| `packages/app/src/import/buildImportedPartDocument.ts` | Pure function: `buildImportedPartDocument(partName, brepBlobId, fileName, partId?) → PartDocument`. Extracted from `importStepIntoNewPart`; no kernel calls. |
| `packages/app/src/import/dedupeName.ts` | `dedupeName(base: string, existingNames: string[]) → string`. Appends `(2)`, `(3)`, … on collision. |
| `packages/app/src/commands/ImportStepAsComponentCommand.ts` | Atomic command. Inputs: `{ stepBytes: ArrayBuffer; fileName: string; opfs: OpfsLike }`. Steps: importStep → buildImportedPartDocument → dedupeName → kernel.registerPart → opfs.write + saveToBytes → addComponent. Undo: removeComponent + opfs.delete + kernel.deletePart. Redo: re-registers from kept bytes. |
| `packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts` | Unit tests (assembly/part/drawing-active, name dedupe, undo, redo). |
| `packages/app/src/import/__tests__/buildImportedPartDocument.spec.ts` | Unit tests for the extracted helper (replaces the structural assertions in `importStepIntoNewPart.spec.ts`). |
| `packages/app/src/import/__tests__/dedupeName.spec.ts` | Unit tests for the dedup utility. |
| `packages/kernel/src/__tests__/importStepIntoAssembly.integration.spec.ts` | Real-OCCT kernel integration test (replaces existing `importStepIntoNewPart.integration.spec.ts` or extends it). |
| `tests/e2e/assembly/import-step-into-assembly.spec.ts` | E2E Playwright spec (Path A via File→Open, Path B via AssemblyTab button, reload persistence). |

### Modified files

| File | Change |
|---|---|
| `packages/app/src/import/importStepIntoNewPart.ts` | Delegate PartDocument construction to `buildImportedPartDocument`. Behavior unchanged. |
| `packages/app/src/shell/tabs/FileTab.tsx` | STEP branch in `handleOpen` dispatches `ImportStepAsComponentCommand` when `activeDocument.kind === 'assembly'`, existing path otherwise. |
| `packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx` | Two new test cases: assembly-active dispatch and part-active regression guard. |
| `packages/app/src/shell/tabs/AssemblyTab.tsx` | New "Insert From STEP…" button in the Component group; disabled when `!hasAssembly`. |

### No changes to

- Manifest schema (additive UX; no new document fields).
- Kernel bindings (reuses `importStep`, `registerPart`, `deletePart`, `saveToBytes`).
- Drawing, BOM, nesting, cut-list subsystems.

---

## Interfaces referenced

```ts
// packages/kernel/src/api.ts — already exist
kernel.importStep({ stepBytes: ArrayBuffer, partName: string })
  → Promise<{ brepBlobId: string; triangleCount: number; boundingBox: BoundingBox; faceCount: number }>

kernel.registerPart(part: PartDocument): Promise<void>

kernel.deletePart(partId: string): Promise<void>

kernel.saveToBytes(partId: string, thumbnail?: Uint8Array): Promise<Uint8Array>

// packages/kernel/src/storage/Opfs.ts — already exists
opfs.write(path: string, data: Uint8Array): Promise<void>
opfs.exists(path: string): Promise<boolean>
opfs.delete(path: string): Promise<void>
opfs.listAll(): Promise<string[]>

// packages/app/src/store/useAppStore.ts — already exist
store.addComponent(instance: ComponentInstance): void   // → sets activeAssembly + activeDocument
store.removeComponent(id: string): void

// packages/app/src/commands/Command.ts
type Command = { name: string; apply(): Promise<void>; revert(): Promise<void> }
```

---

## File Structure

```
packages/app/src/
  import/
    buildImportedPartDocument.ts          [NEW]
    dedupeName.ts                          [NEW]
    importStepIntoNewPart.ts               [MODIFIED — delegates to above]
    __tests__/
      buildImportedPartDocument.spec.ts    [NEW]
      dedupeName.spec.ts                   [NEW]
      importStepIntoNewPart.spec.ts        [MODIFIED — remove structural assertions now in above]
  commands/
    ImportStepAsComponentCommand.ts        [NEW]
    __tests__/
      ImportStepAsComponentCommand.spec.ts [NEW]
  shell/tabs/
    FileTab.tsx                            [MODIFIED]
    AssemblyTab.tsx                        [MODIFIED]
    __tests__/
      FileTab.spec.tsx                     [MODIFIED]

packages/kernel/src/__tests__/
  importStepIntoAssembly.integration.spec.ts  [NEW]

tests/e2e/assembly/
  import-step-into-assembly.spec.ts       [NEW]
```

---

## Tasks

---

### Task 1 — Extract `buildImportedPartDocument` helper

**Goal:** Pure function for PartDocument construction. No behavior change to `importStepIntoNewPart`.

#### 1a — RED: write unit test (failing)

Create `packages/app/src/import/__tests__/buildImportedPartDocument.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildImportedPartDocument } from '../buildImportedPartDocument';
import { ORIGIN_FEATURES } from '../originFeatures';

describe('buildImportedPartDocument', () => {
  it('builds a PartDocument with origin features + one ImportedFeature', () => {
    const part = buildImportedPartDocument('Knob', 'blob-abc', 'Knob.step');

    expect(part.name).toBe('Knob');
    expect(part.units).toBe('mm');
    expect(part.parameters).toEqual({});
    expect(part.materials).toEqual([]);
    expect(part.hardware).toEqual([]);
    expect(part.featureTree).toHaveLength(ORIGIN_FEATURES.length + 1);
    expect(part.featureTree.slice(0, ORIGIN_FEATURES.length)).toEqual(ORIGIN_FEATURES);

    const imported = part.featureTree.at(-1);
    if (!imported || imported.kind !== 'imported') throw new Error('last feature must be imported');
    expect(imported.sourceStep).toBe('Knob.step');
    expect(imported.bodyRef).toBe('blob-abc');
  });

  it('generates a stable UUID when no partId supplied', () => {
    const a = buildImportedPartDocument('x', 'b', 'x.step');
    const b = buildImportedPartDocument('x', 'b', 'x.step');
    expect(a.id).toMatch(/[0-9a-f-]{36}/);
    expect(a.id).not.toBe(b.id); // each call generates fresh UUID
  });

  it('uses provided partId when supplied', () => {
    const part = buildImportedPartDocument('x', 'b', 'x.step', 'explicit-id');
    expect(part.id).toBe('explicit-id');
  });
});
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose src/import/__tests__/buildImportedPartDocument.spec.ts
```
Expected failure: `Cannot find module '../buildImportedPartDocument'`

#### 1b — GREEN: create the helper

Create `packages/app/src/import/buildImportedPartDocument.ts`:

```ts
import type { PartDocument, ImportedFeature } from '@zilventor/shared';
import { ORIGIN_FEATURES } from './originFeatures';

/**
 * Pure: constructs a PartDocument that wraps a pre-imported BREP blob.
 * The blob must already live in the kernel's importedShapeCache (put there
 * by kernel.importStep before this is called).
 *
 * @param partName   Human-readable name (file stem, already deduped).
 * @param brepBlobId The blob ref returned by kernel.importStep.
 * @param fileName   Original STEP filename (stored in ImportedFeature.sourceStep).
 * @param partId     Optional explicit UUID; one is generated if omitted.
 */
export function buildImportedPartDocument(
  partName: string,
  brepBlobId: string,
  fileName: string,
  partId?: string,
): PartDocument {
  const id = partId ?? crypto.randomUUID();
  const importedFeature: ImportedFeature = {
    kind: 'imported',
    id: crypto.randomUUID(),
    sourceStep: fileName,
    bodyRef: brepBlobId,
  };
  return {
    id,
    name: partName,
    units: 'mm',
    parameters: {},
    featureTree: [...ORIGIN_FEATURES, importedFeature],
    properties: {},
    materials: [],
    hardware: [],
  };
}
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose src/import/__tests__/buildImportedPartDocument.spec.ts
```
Expected: all 3 tests pass.

#### 1c — REFACTOR: update `importStepIntoNewPart` to delegate

Edit `packages/app/src/import/importStepIntoNewPart.ts`:

```ts
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { PartDocument } from '@zilventor/shared';
import { stepFilenameBasename } from './originFeatures';
import { buildImportedPartDocument } from './buildImportedPartDocument';

/**
 * Imports a stand-alone STEP file as a new PartDocument and registers it
 * with the kernel. The returned part is ready to be passed to
 * `setActivePart` so the viewport will render it.
 */
export async function importStepIntoNewPart(
  file: File,
  kernel: KernelApi,
): Promise<{ partId: string; part: PartDocument }> {
  const stepBytes = await file.arrayBuffer();
  const partName = stepFilenameBasename(file.name);

  const importResult = await kernel.importStep({ stepBytes, partName });

  const part = buildImportedPartDocument(partName, importResult.brepBlobId, file.name);

  await kernel.registerPart(part);
  return { partId: part.id, part };
}
```

Verify the existing spec still passes:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose src/import/__tests__/importStepIntoNewPart.spec.ts
```
Expected: all 3 tests pass (same as before).

Run full app unit suite to confirm nothing regressed:
```bash
pnpm --filter @zilventor/app test:unit
```
Expected: same count as before (currently ~3035), all green.

#### 1d — COMMIT

```bash
git add packages/app/src/import/buildImportedPartDocument.ts \
        packages/app/src/import/__tests__/buildImportedPartDocument.spec.ts \
        packages/app/src/import/importStepIntoNewPart.ts
git commit -m "$(cat <<'EOF'
refactor(import): extract buildImportedPartDocument pure helper

importStepIntoNewPart now delegates PartDocument construction to
buildImportedPartDocument so the new ImportStepAsComponentCommand
can share the same pipeline without duplicating logic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2 — `dedupeName` utility

**Goal:** Collision-safe naming: `hinge` → `hinge (2)` → `hinge (3)` …

#### 2a — RED: write unit test (failing)

Create `packages/app/src/import/__tests__/dedupeName.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dedupeName } from '../dedupeName';

describe('dedupeName', () => {
  it('returns base unchanged when no collision', () => {
    expect(dedupeName('hinge', [])).toBe('hinge');
  });

  it('returns base unchanged when existing list does not contain base', () => {
    expect(dedupeName('hinge', ['bolt', 'screw'])).toBe('hinge');
  });

  it('appends (2) on first collision', () => {
    expect(dedupeName('hinge', ['hinge'])).toBe('hinge (2)');
  });

  it('skips to (3) when both base and (2) are taken', () => {
    expect(dedupeName('hinge', ['hinge', 'hinge (2)'])).toBe('hinge (3)');
  });

  it('handles gaps in the sequence', () => {
    expect(dedupeName('hinge', ['hinge', 'hinge (3)'])).toBe('hinge (2)');
  });

  it('works when existing list is large', () => {
    const existing = ['hinge', ...Array.from({ length: 9 }, (_, i) => `hinge (${i + 2})`)];
    expect(dedupeName('hinge', existing)).toBe('hinge (11)');
  });
});
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose src/import/__tests__/dedupeName.spec.ts
```
Expected failure: `Cannot find module '../dedupeName'`

#### 2b — GREEN: create the utility

Create `packages/app/src/import/dedupeName.ts`:

```ts
/**
 * Returns `base` if it is not in `existingNames`, otherwise appends
 * the lowest free suffix: `base (2)`, `base (3)`, …
 *
 * @param base          Desired name (e.g. `'hinge-blum-110'`).
 * @param existingNames All names already in use (e.g. from OPFS listing).
 */
export function dedupeName(base: string, existingNames: string[]): string {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose src/import/__tests__/dedupeName.spec.ts
```
Expected: all 6 tests pass.

#### 2c — COMMIT

```bash
git add packages/app/src/import/dedupeName.ts \
        packages/app/src/import/__tests__/dedupeName.spec.ts
git commit -m "$(cat <<'EOF'
feat(import): add dedupeName utility for name-collision avoidance

Appends '(2)', '(3)', … when the desired part name is already taken
in the project's OPFS listing. Matches Inventor's behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 — `ImportStepAsComponentCommand` — assembly-active path (core)

**Goal:** The command's `apply()` path for `activeDocument.kind === 'assembly'`: parses STEP, builds part, registers with kernel, persists to OPFS, inserts component.

#### 3a — RED: unit tests — assembly-active path (failing)

Create `packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { ImportStepAsComponentCommand } from '../ImportStepAsComponentCommand';
import type { AssemblyDocument } from '@zilventor/shared';

// ---------- helpers ----------------------------------------------------------

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async read(p: string) {
    const b = this.files.get(p);
    if (!b) throw new Error(`ENOENT: ${p}`);
    return b;
  }
  async exists(p: string) { return this.files.has(p); }
  async delete(p: string) { this.files.delete(p); }
  async listAll() { return [...this.files.keys()]; }
}

function makeKernel(overrides?: Partial<{
  importStep: typeof vi.fn;
  registerPart: typeof vi.fn;
  deletePart: typeof vi.fn;
  saveToBytes: typeof vi.fn;
}>) {
  return {
    importStep: overrides?.importStep ?? vi.fn(async () => ({
      brepBlobId: 'blob-123',
      triangleCount: 12,
      boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number],
      faceCount: 6,
    })),
    registerPart: overrides?.registerPart ?? vi.fn(async () => undefined),
    deletePart: overrides?.deletePart ?? vi.fn(async () => undefined),
    saveToBytes: overrides?.saveToBytes ?? vi.fn(async () => new Uint8Array([42])),
  };
}

function makeDoc(name: string, components: AssemblyDocument['components'] = []): AssemblyDocument {
  return {
    id: name, name, units: 'mm', parameters: {}, properties: {},
    components, constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
}

const STEP_BYTES = new Uint8Array([1, 2, 3, 4]);

// ---------- tests: assembly-active path ---------------------------------------

describe('ImportStepAsComponentCommand — assembly-active path', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({
      kind: 'assembly',
      document: makeDoc('cabinet'),
    });
  });

  it('apply() adds exactly one component to the active assembly', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'hinge.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();

    const { activeAssembly } = useAppStore.getState();
    expect(activeAssembly?.components).toHaveLength(1);
    const c = activeAssembly!.components[0]!;
    expect(c.partPath).toBe('hinge.zipt');
    expect(c.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(c.rotation).toEqual({ rx: 0, ry: 0, rz: 0 });
    expect(c.visible).toBe(true);
  });

  it('apply() registers the part with the kernel', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'hinge.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();

    expect(kernel.registerPart).toHaveBeenCalledOnce();
    const registered = (kernel.registerPart as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(registered.name).toBe('hinge');
    expect(registered.featureTree.at(-1)?.kind).toBe('imported');
  });

  it('apply() persists the part as <name>.zipt to OPFS', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'hinge.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();

    expect(await opfs.exists('hinge.zipt')).toBe(true);
    // saveToBytes was called → the written bytes are the archive
    expect(kernel.saveToBytes).toHaveBeenCalledOnce();
  });

  it('apply() calls importStep with the correct bytes and partName', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'MyHinge.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();

    expect(kernel.importStep).toHaveBeenCalledOnce();
    const arg = (kernel.importStep as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg.partName).toBe('MyHinge');
    expect(new Uint8Array(arg.stepBytes as ArrayBuffer)).toEqual(STEP_BYTES);
  });
});
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose src/commands/__tests__/ImportStepAsComponentCommand.spec.ts
```
Expected failure: `Cannot find module '../ImportStepAsComponentCommand'`

#### 3b — GREEN: create the command (assembly-active path only)

Create `packages/app/src/commands/ImportStepAsComponentCommand.ts`:

```ts
import type { Command } from './Command';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { ComponentInstance, PartDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { buildImportedPartDocument } from '../import/buildImportedPartDocument';
import { dedupeName } from '../import/dedupeName';
import { stepFilenameBasename } from '../import/originFeatures';

export type OpfsLike = {
  write(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  listAll(): Promise<string[]>;
};

export type ImportStepAsComponentOpts = {
  stepBytes: ArrayBuffer;
  fileName: string;
  kernel: Pick<KernelApi, 'importStep' | 'registerPart' | 'deletePart' | 'saveToBytes'>;
  opfs: OpfsLike;
};

/**
 * Atomic command: import a STEP file and (when an assembly is active)
 * insert it as a new component at the assembly origin.
 *
 * When no assembly is active (part- or drawing-active), behaves like
 * importStepIntoNewPart: creates a standalone top-level part and switches
 * the active document to it.
 *
 * Undo: removes the component + evicts the part from OPFS + kernel cache.
 * Redo: re-registers from in-memory bytes + re-persists + re-inserts.
 */
export class ImportStepAsComponentCommand implements Command {
  readonly name = 'ImportStepAsComponent';

  // Captured during apply() for undo/redo
  private placedId: string | null = null;
  private placedPartId: string | null = null;
  private placedPartPath: string | null = null;
  private placedPart: PartDocument | null = null;
  private placedArchiveBytes: Uint8Array | null = null;
  /** Whether apply() ran the assembly path (true) or standalone-part path (false). */
  private wasAssemblyInsert = false;

  constructor(private opts: ImportStepAsComponentOpts) {}

  async apply(): Promise<void> {
    const { stepBytes, fileName, kernel, opfs } = this.opts;
    const { setActivePart, setStatus, activeDocument } = useAppStore.getState();

    const baseName = stepFilenameBasename(fileName);

    // Dedupe against existing OPFS entries
    const existingFiles = await opfs.listAll();
    const existingNames = existingFiles
      .filter((p) => p.endsWith('.zipt'))
      .map((p) => p.replace(/\.zipt$/, '').split('/').pop() ?? '');
    const partName = dedupeName(baseName, existingNames);
    const partPath = `${partName}.zipt`;

    // Step 1: parse STEP → blob in kernel cache
    const importResult = await kernel.importStep({ stepBytes, partName });

    // Step 2: build PartDocument
    const part = buildImportedPartDocument(partName, importResult.brepBlobId, fileName);
    this.placedPart = part;
    this.placedPartId = part.id;
    this.placedPartPath = partPath;

    // Step 3: register with kernel
    await kernel.registerPart(part);

    // Step 4: persist to OPFS via kernel.saveToBytes (bakes the ImportedFeature blob)
    const archiveBytes = await kernel.saveToBytes(part.id);
    this.placedArchiveBytes = archiveBytes;
    await opfs.write(partPath, archiveBytes);

    // Step 5: dispatch based on active document kind
    if (activeDocument?.kind === 'assembly') {
      this.wasAssemblyInsert = true;
      const componentId = `C${Date.now()}`;
      const instance: ComponentInstance = {
        id: componentId,
        partPath,
        position: { x: 0, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      };
      useAppStore.getState().addComponent(instance);
      this.placedId = componentId;
      setStatus(`Imported '${partPath}' and inserted into assembly`);
    } else {
      // Standalone-part path: switch active document to the new part
      this.wasAssemblyInsert = false;
      setActivePart(part);
      setStatus('Imported');
    }
  }

  async revert(): Promise<void> {
    if (!this.placedPartId || !this.placedPartPath) return;
    const { kernel, opfs } = this.opts;

    if (this.wasAssemblyInsert && this.placedId) {
      useAppStore.getState().removeComponent(this.placedId);
      this.placedId = null;
    }

    // Evict from OPFS
    try {
      await opfs.delete(this.placedPartPath);
    } catch {
      // Best-effort; file may not exist if apply() failed mid-flight
    }

    // Evict from kernel cache
    try {
      await kernel.deletePart(this.placedPartId);
    } catch {
      // Best-effort
    }

    this.placedPartId = null;
    this.placedPartPath = null;
  }
}
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose src/commands/__tests__/ImportStepAsComponentCommand.spec.ts
```
Expected: all 4 assembly-active-path tests pass.

#### 3c — COMMIT

```bash
git add packages/app/src/commands/ImportStepAsComponentCommand.ts \
        packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts
git commit -m "$(cat <<'EOF'
feat(import): ImportStepAsComponentCommand — assembly-active path

Atomic command: importStep → buildImportedPartDocument → dedupeName
→ registerPart → saveToBytes + opfs.write → addComponent at origin.
Assembly-active path only; standalone-part and undo/redo in follow-up tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4 — Command — standalone-part fallback paths

**Goal:** When active document is `part`, `drawing`, or absent, the command creates a standalone part (existing behavior) rather than inserting into any assembly.

#### 4a — RED: add fallback-path tests (failing)

Add to `packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts` after the existing describe block:

```ts
// ---------- tests: non-assembly-active paths ----------------------------------

describe('ImportStepAsComponentCommand — part-active path', () => {
  beforeEach(() => {
    // Set active document to a part (no assembly)
    useAppStore.getState().setActivePart({
      id: 'part-1', name: 'MyPart', units: 'mm', parameters: {},
      featureTree: [], properties: {}, materials: [], hardware: [],
    });
  });

  it('apply() does NOT mutate any assembly (there is none)', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'bolt.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();

    expect(useAppStore.getState().activeAssembly).toBeNull();
  });

  it('apply() switches activePart to the imported part', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'bolt.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();

    expect(useAppStore.getState().activePart?.name).toBe('bolt');
  });
});

describe('ImportStepAsComponentCommand — drawing-active path', () => {
  beforeEach(() => {
    // Set active document to a drawing
    const drawing = {
      id: 'd1', name: 'Sheet1', kind: 'drawing' as const,
      sheets: [], properties: {}, parameters: {},
    } as unknown as import('@zilventor/shared').DrawingDocument;
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: drawing });
  });

  it('apply() does NOT insert into an assembly', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'bracket.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();

    expect(useAppStore.getState().activeAssembly).toBeNull();
  });

  it('apply() switches activePart to the new standalone part', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'bracket.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();

    expect(useAppStore.getState().activePart?.name).toBe('bracket');
  });
});
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose src/commands/__tests__/ImportStepAsComponentCommand.spec.ts
```
Expected: 4 assembly-path tests still pass, new 4 tests fail with `expect(received).toBeNull()` or part assertion.

#### 4b — GREEN: the non-assembly paths are already implemented in Task 3's `else` branch

The code written in Task 3 already handles these paths (the `else` branch calls `setActivePart`). The tests should now pass.

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose src/commands/__tests__/ImportStepAsComponentCommand.spec.ts
```
Expected: all 8 tests pass.

#### 4c — COMMIT

```bash
git add packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts
git commit -m "$(cat <<'EOF'
test(import): cover part-active and drawing-active fallback paths

When the active document is not an assembly, ImportStepAsComponentCommand
creates a standalone part and switches focus — no assembly mutation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5 — Command — name dedupe + undo/redo

**Goal:** Name collision coverage; undo evicts from store+OPFS+kernel; redo restores.

#### 5a — RED: add dedupe + undo/redo tests (failing)

Add to `packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts`:

```ts
// ---------- tests: name dedupe -----------------------------------------------

describe('ImportStepAsComponentCommand — name dedupe', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({
      kind: 'assembly',
      document: makeDoc('cabinet'),
    });
  });

  it('uses base name when no collision exists', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'hinge.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();
    expect(await opfs.exists('hinge.zipt')).toBe(true);
  });

  it('appends (2) when base name is taken', async () => {
    const kernel1 = makeKernel();
    const kernel2 = makeKernel();
    const opfs = new MemOpfs();

    const cmd1 = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer, fileName: 'hinge.step',
      kernel: kernel1 as any, opfs: opfs as any,
    });
    await cmd1.apply();

    const cmd2 = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer, fileName: 'hinge.step',
      kernel: kernel2 as any, opfs: opfs as any,
    });
    await cmd2.apply();

    expect(await opfs.exists('hinge.zipt')).toBe(true);
    expect(await opfs.exists('hinge (2).zipt')).toBe(true);
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(2);
  });
});

// ---------- tests: undo / redo -----------------------------------------------

describe('ImportStepAsComponentCommand — undo / redo', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({
      kind: 'assembly',
      document: makeDoc('cabinet'),
    });
  });

  it('revert() removes the component from the assembly', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer, fileName: 'hinge.step',
      kernel: kernel as any, opfs: opfs as any,
    });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(1);

    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(0);
  });

  it('revert() deletes the .zipt from OPFS', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer, fileName: 'hinge.step',
      kernel: kernel as any, opfs: opfs as any,
    });
    await cmd.apply();
    expect(await opfs.exists('hinge.zipt')).toBe(true);

    await cmd.revert();
    expect(await opfs.exists('hinge.zipt')).toBe(false);
  });

  it('revert() calls kernel.deletePart with the registered partId', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer, fileName: 'hinge.step',
      kernel: kernel as any, opfs: opfs as any,
    });
    await cmd.apply();
    const registeredId = (kernel.registerPart as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].id;

    await cmd.revert();
    expect(kernel.deletePart).toHaveBeenCalledWith(registeredId);
  });

  it('apply() after revert() (redo) re-inserts and re-persists', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer, fileName: 'hinge.step',
      kernel: kernel as any, opfs: opfs as any,
    });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(0);

    // redo = call apply() again — CommandBus does this
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(1);
    expect(await opfs.exists('hinge.zipt')).toBe(true);
  });
});
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose src/commands/__tests__/ImportStepAsComponentCommand.spec.ts
```
Expected: new dedupe and undo/redo tests fail (redo calls `kernel.registerPart` a second time which throws `"already registered"`; undo delete OPFS correct).

#### 5b — GREEN: fix redo path in the command

Edit `packages/app/src/commands/ImportStepAsComponentCommand.ts`.

Redo must skip the `kernel.importStep` call (blob still in cache) and re-use the saved `brepBlobId`. Add a `private redoState` to avoid re-parsing:

```ts
// Add at top of class:
  /** Saved state for redo: avoids re-calling importStep (blob stays in cache). */
  private redoState: {
    partName: string;
    brepBlobId: string;
    fileName: string;
    partPath: string;
    archiveBytes: Uint8Array;
  } | null = null;
```

Change `apply()` to check `this.redoState` and bypass `importStep` + `saveToBytes` on redo:

Replace the full `apply()` method with:

```ts
  async apply(): Promise<void> {
    const { stepBytes, fileName, kernel, opfs } = this.opts;
    const { setActivePart, setStatus, activeDocument } = useAppStore.getState();

    let partName: string;
    let part: PartDocument;
    let partPath: string;
    let archiveBytes: Uint8Array;

    if (this.redoState) {
      // Redo path: blob is still in the kernel's importedShapeCache.
      // Re-build the PartDocument with the same id (stable ids across undo/redo).
      const rs = this.redoState;
      partName = rs.partName;
      partPath = rs.partPath;
      part = buildImportedPartDocument(partName, rs.brepBlobId, rs.fileName, this.placedPartId ?? undefined);
      await kernel.registerPart(part);
      archiveBytes = rs.archiveBytes;
      await opfs.write(partPath, archiveBytes);
    } else {
      // First apply: full pipeline.
      const baseName = stepFilenameBasename(fileName);
      const existingFiles = await opfs.listAll();
      const existingNames = existingFiles
        .filter((p) => p.endsWith('.zipt'))
        .map((p) => p.replace(/\.zipt$/, '').split('/').pop() ?? '');
      partName = dedupeName(baseName, existingNames);
      partPath = `${partName}.zipt`;

      const importResult = await kernel.importStep({ stepBytes, partName });
      part = buildImportedPartDocument(partName, importResult.brepBlobId, fileName);
      this.placedPart = part;
      this.placedPartId = part.id;
      this.placedPartPath = partPath;

      await kernel.registerPart(part);

      archiveBytes = await kernel.saveToBytes(part.id);
      this.placedArchiveBytes = archiveBytes;
      await opfs.write(partPath, archiveBytes);

      // Save state needed for redo
      this.redoState = {
        partName,
        brepBlobId: importResult.brepBlobId,
        fileName,
        partPath,
        archiveBytes,
      };
    }

    if (activeDocument?.kind === 'assembly') {
      this.wasAssemblyInsert = true;
      const componentId = this.placedId ?? `C${Date.now()}`;
      const instance: ComponentInstance = {
        id: componentId,
        partPath,
        position: { x: 0, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      };
      useAppStore.getState().addComponent(instance);
      this.placedId = componentId;
      setStatus(`Imported '${partPath}' and inserted into assembly`);
    } else {
      this.wasAssemblyInsert = false;
      setActivePart(part);
      setStatus('Imported');
    }
  }
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose src/commands/__tests__/ImportStepAsComponentCommand.spec.ts
```
Expected: all tests pass.

Run full app suite:
```bash
pnpm --filter @zilventor/app test:unit
```
Expected: green, count ≥ 3035 + new tests.

#### 5c — COMMIT

```bash
git add packages/app/src/commands/ImportStepAsComponentCommand.ts \
        packages/app/src/commands/__tests__/ImportStepAsComponentCommand.spec.ts
git commit -m "$(cat <<'EOF'
feat(import): ImportStepAsComponentCommand undo/redo + name dedupe

Undo evicts component + OPFS + kernel cache. Redo re-registers from
saved in-memory bytes (no second STEP parse). Name dedupe appended
on OPFS collision to avoid clobbering existing parts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6 — FileTab dispatch by active-document kind

**Goal:** Wire `ImportStepAsComponentCommand` in `handleOpen`'s STEP branch. When assembly is active → new command; otherwise → existing `importStepIntoNewPart`.

#### 6a — RED: add FileTab tests (failing)

Add to `packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx`:

```tsx
// Add near top, after existing mocks:
vi.mock('../../../commands/ImportStepAsComponentCommand', () => ({
  ImportStepAsComponentCommand: vi.fn().mockImplementation(() => ({
    name: 'ImportStepAsComponent',
    apply: vi.fn().mockResolvedValue(undefined),
    revert: vi.fn().mockResolvedValue(undefined),
  })),
}));
import { ImportStepAsComponentCommand } from '../../../commands/ImportStepAsComponentCommand';
```

Add a new `describe` block at the bottom of the file:

```tsx
describe('handleOpen — STEP branch dispatches by active-document kind', () => {
  function makeFakeStepHandle(name: string) {
    const fakeFile = { name, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
  }

  beforeEach(() => {
    useAppStore.setState((s) => ({ ...s, kernel: {} as any }));
    vi.mocked(ImportStepAsComponentCommand).mockClear();
    vi.mocked(importStepIntoNewPart).mockClear();
  });

  it('STEP + assembly active → dispatches ImportStepAsComponentCommand, NOT importStepIntoNewPart', async () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
      components: [], constraints: [], groundedComponentPaths: [],
      colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeStepHandle('bolt.step')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(vi.mocked(ImportStepAsComponentCommand)).toHaveBeenCalledOnce();
    });
    expect(vi.mocked(importStepIntoNewPart)).not.toHaveBeenCalled();
  });

  it('STEP + part active → dispatches importStepIntoNewPart (regression guard)', async () => {
    const fakePart = {
      id: 'p1', name: 'MyPart', units: 'mm' as const,
      parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [],
    };
    useAppStore.getState().setActivePart(fakePart);
    vi.mocked(importStepIntoNewPart).mockResolvedValue({ partId: 'p1', part: fakePart });

    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([makeFakeStepHandle('hinge.step')]);

    render(<FileTab />);
    fireEvent.click(screen.getByRole('button', { name: /^open/i }));
    await waitFor(() => {
      expect(vi.mocked(importStepIntoNewPart)).toHaveBeenCalledOnce();
    });
    expect(vi.mocked(ImportStepAsComponentCommand)).not.toHaveBeenCalled();
  });
});
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose "src/shell/tabs/__tests__/FileTab.spec.tsx"
```
Expected: existing tests pass; new 2 dispatch-tests fail (`ImportStepAsComponentCommand not called`).

#### 6b — GREEN: modify `handleOpen` in FileTab.tsx

Edit `packages/app/src/shell/tabs/FileTab.tsx`.

Replace the STEP early-branch:

```tsx
      // STEP early-branch: dispatch by active document kind
      if (/\.(step|stp)$/i.test(file.name)) {
        const { activeDocument } = useAppStore.getState();
        if (activeDocument?.kind === 'assembly') {
          const { ImportStepAsComponentCommand } = await import('../../commands/ImportStepAsComponentCommand');
          const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
          const opfs = await Opfs.forNavigator();
          const stepBytes = await file.arrayBuffer();
          const cmd = new ImportStepAsComponentCommand({ stepBytes, fileName: file.name, kernel, opfs });
          await bus.execute(cmd);
        } else {
          const { importStepIntoNewPart } = await import('../../import/importStepIntoNewPart');
          const { part } = await importStepIntoNewPart(file, kernel);
          setActivePart(part);
          setStatus('Imported');
        }
        return;
      }
```

Note: `bus` must be destructured from `useAppStore.getState()`. Update the destructuring at the top of `handleOpen`:

```tsx
    const { kernel, setActivePart, setActiveDocument, setStatus, bus } = useAppStore.getState();
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose "src/shell/tabs/__tests__/FileTab.spec.tsx"
```
Expected: all tests pass.

#### 6c — COMMIT

```bash
git add packages/app/src/shell/tabs/FileTab.tsx \
        packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx
git commit -m "$(cat <<'EOF'
feat(shell): FileTab dispatches ImportStepAsComponentCommand for assembly-active STEP open

When the active document is an assembly, File → Open with a .step/.stp
file invokes ImportStepAsComponentCommand (undo/redo, OPFS persist,
insert as component). Existing standalone-part path unchanged for
part/drawing/absent active documents.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7 — AssemblyTab "Insert From STEP…" button

**Goal:** New ribbon button adjacent to "Place"; disabled when no active assembly; opens a file picker filtered to `.step/.stp`; dispatches `ImportStepAsComponentCommand`.

#### 7a — RED: add AssemblyTab test (failing)

Find or create `packages/app/src/shell/tabs/__tests__/AssemblyTab.spec.tsx`. If it doesn't exist, create it. Check first:

```bash
find /Users/lion/Documents/Projects/mine/zilventor/packages/app/src/shell/tabs/__tests__ -name "AssemblyTab*"
```

Create `packages/app/src/shell/tabs/__tests__/AssemblyTab.spec.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssemblyTab } from '../AssemblyTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

vi.mock('../../../commands/ImportStepAsComponentCommand', () => ({
  ImportStepAsComponentCommand: vi.fn().mockImplementation(() => ({
    name: 'ImportStepAsComponent',
    apply: vi.fn().mockResolvedValue(undefined),
    revert: vi.fn().mockResolvedValue(undefined),
  })),
}));
import { ImportStepAsComponentCommand } from '../../../commands/ImportStepAsComponentCommand';

function makeDoc(name: string): AssemblyDocument {
  return {
    id: name, name, units: 'mm', parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
}

describe('AssemblyTab — Insert From STEP… button', () => {
  beforeEach(() => {
    vi.mocked(ImportStepAsComponentCommand).mockClear();
    useAppStore.getState().setActiveDocument(null);
  });

  it('button is disabled when no active assembly', () => {
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /insert from step/i });
    expect(btn).toBeDisabled();
  });

  it('button is enabled when an assembly is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('cabinet') });
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /insert from step/i });
    expect(btn).not.toBeDisabled();
  });

  it('clicking the button calls ImportStepAsComponentCommand when a file is picked', async () => {
    useAppStore.setState((s) => ({ ...s, kernel: {} as any }));
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('cabinet') });

    const stepBytes = new Uint8Array([1, 2, 3]);
    const fakeFile = { name: 'hinge.step', arrayBuffer: async () => stepBytes.buffer };
    const fakeHandle = { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([fakeHandle]);

    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /insert from step/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(vi.mocked(ImportStepAsComponentCommand)).toHaveBeenCalledOnce();
    });
    const args = vi.mocked(ImportStepAsComponentCommand).mock.calls[0]?.[0];
    expect(args?.fileName).toBe('hinge.step');
  });
});
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose "src/shell/tabs/__tests__/AssemblyTab.spec.tsx"
```
Expected failure: button not found (`getByRole` throws "unable to find an accessible element").

#### 7b — GREEN: add button to AssemblyTab

Edit `packages/app/src/shell/tabs/AssemblyTab.tsx`.

Add an `insertFromStep` handler and button in the Component group. Add after the existing imports:

The handler (inside the component, before the return):

```tsx
  const handleInsertFromStep = async () => {
    const { kernel, bus } = useAppStore.getState();
    if (!kernel) return;
    try {
      type FSAWindow = Window & {
        showOpenFilePicker: (o: unknown) => Promise<FileSystemFileHandle[]>;
      };
      const [handle] = await (window as unknown as FSAWindow).showOpenFilePicker({
        types: [{ description: 'STEP file', accept: { 'application/step': ['.step', '.stp'] } }],
      });
      if (!handle) return;
      const file = await handle.getFile();
      const stepBytes = await file.arrayBuffer();
      const { ImportStepAsComponentCommand } = await import('../../commands/ImportStepAsComponentCommand');
      const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
      const opfs = await Opfs.forNavigator();
      const cmd = new ImportStepAsComponentCommand({ stepBytes, fileName: file.name, kernel, opfs });
      await bus.execute(cmd);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      // Surface other errors via status bar
      useAppStore.getState().setStatus(`Insert From STEP failed: ${(e as Error).message}`);
    }
  };
```

Add the button inside the Component group `<div>` in the JSX, right after the "Place" button:

```tsx
        <button
          aria-label="Insert From STEP…"
          disabled={!hasAssembly}
          onClick={handleInsertFromStep}
          style={btn}
        >
          Insert From STEP…
        </button>
```

Run:
```bash
pnpm --filter @zilventor/app test:unit -- --reporter=verbose "src/shell/tabs/__tests__/AssemblyTab.spec.tsx"
```
Expected: all 3 tests pass.

Full app suite:
```bash
pnpm --filter @zilventor/app test:unit
```
Expected: green.

#### 7c — COMMIT

```bash
git add packages/app/src/shell/tabs/AssemblyTab.tsx \
        packages/app/src/shell/tabs/__tests__/AssemblyTab.spec.tsx
git commit -m "$(cat <<'EOF'
feat(shell): AssemblyTab 'Insert From STEP…' button

Opens a .step/.stp file picker and dispatches ImportStepAsComponentCommand.
Disabled when no active assembly. Wired into the Component group adjacent
to the existing Place button. Abort-error silenced; other errors → status bar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8 — Kernel integration test (real OCCT)

**Goal:** Confirm the full pipeline composes correctly against real OCCT using `cube-10mm.step`.

#### 8a — RED: write the test (failing)

Create `packages/kernel/src/__tests__/importStepIntoAssembly.integration.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createKernelApi } from '../api';
import { buildImportedPartDocument } from '../../../app/src/import/buildImportedPartDocument';
import { dedupeName } from '../../../app/src/import/dedupeName';
import { stepFilenameBasename } from '../../../app/src/import/originFeatures';

const STEP_PATH = resolve(
  __dirname,
  '../occt/__tests__/fixtures/step/cube-10mm.step',
);

describe('importStepIntoAssembly — real OCCT pipeline', () => {
  it('imports cube-10mm.step: registers, executes, bounding box within expected extents', async () => {
    const kernel = createKernelApi();
    await kernel.init();

    const stepRaw = readFileSync(STEP_PATH);
    const stepBytes = stepRaw.buffer.slice(
      stepRaw.byteOffset,
      stepRaw.byteOffset + stepRaw.byteLength,
    );

    const fileName = 'cube-10mm.step';
    const baseName = stepFilenameBasename(fileName);
    // No collisions in a fresh kernel
    const partName = dedupeName(baseName, []);

    const importResult = await kernel.importStep({ stepBytes, partName });
    expect(importResult.brepBlobId).toBeTruthy();

    const part = buildImportedPartDocument(partName, importResult.brepBlobId, fileName);
    await kernel.registerPart(part);

    const execResult = await kernel.execute(part.id);
    expect(execResult.ok).toBe(true);
    if (!execResult.ok) throw new Error('execute failed');

    // Cube is 10mm × 10mm × 10mm; bbox should be 0..10 on all axes (within 1mm tolerance)
    const { boundingBox } = importResult;
    const [xMin, yMin, zMin, xMax, yMax, zMax] = boundingBox;
    expect(xMax - xMin).toBeGreaterThan(9);
    expect(yMax - yMin).toBeGreaterThan(9);
    expect(zMax - zMin).toBeGreaterThan(9);
    expect(xMax - xMin).toBeLessThan(11);
    expect(yMax - yMin).toBeLessThan(11);
    expect(zMax - zMin).toBeLessThan(11);

    // saveToBytes confirms the ImportedFeature blob round-trips correctly
    const bytes = await kernel.saveToBytes(part.id);
    expect(bytes.byteLength).toBeGreaterThan(0);

    // deletePart cleans up without throwing
    await expect(kernel.deletePart(part.id)).resolves.not.toThrow();
  });
});
```

Run (kernel integration suite — real OCCT, slow):
```bash
pnpm --filter @zilventor/kernel test:unit -- --reporter=verbose src/__tests__/importStepIntoAssembly.integration.spec.ts
```
Expected failure: `Cannot find module '../../../app/src/import/buildImportedPartDocument'` (cross-package import, depends on tsconfig).

**Note for implementer:** if the cross-package import fails due to a `rootDir` constraint, check `packages/kernel/tsconfig.json`. The last kernel-test commit (`a1151fc`) already dropped `rootDir` to allow cross-package test imports. Verify the tsconfig allows `../../../app/src/` paths. If still failing, use a relative path alias or inline the helper locally in the test (the helper is trivial).

#### 8b — GREEN: verify the test passes

If cross-package import works (expected per `a1151fc`):
```bash
pnpm --filter @zilventor/kernel test:unit -- --reporter=verbose src/__tests__/importStepIntoAssembly.integration.spec.ts
```
Expected: 1 test passes.

If cross-package import is blocked, inline the helper directly in the test file:

```ts
// Inline fallback if cross-package import is blocked:
import type { PartDocument, ImportedFeature } from '@zilventor/shared';

const ORIGIN_FEATURES_INLINE = [
  { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
  { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
  { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
  { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
] as const;

function buildPartLocal(partName: string, brepBlobId: string, fileName: string): PartDocument {
  const importedFeature: ImportedFeature = { kind: 'imported', id: crypto.randomUUID(), sourceStep: fileName, bodyRef: brepBlobId };
  return { id: crypto.randomUUID(), name: partName, units: 'mm', parameters: {}, featureTree: [...ORIGIN_FEATURES_INLINE, importedFeature], properties: {}, materials: [], hardware: [] };
}
```

#### 8c — COMMIT

```bash
git add packages/kernel/src/__tests__/importStepIntoAssembly.integration.spec.ts
git commit -m "$(cat <<'EOF'
test(kernel): real-OCCT integration for importStepIntoAssembly pipeline

Verifies importStep → buildImportedPartDocument → registerPart →
execute → saveToBytes → deletePart all compose against real OCCT with
the cube-10mm.step fixture. Bounding box expected 9–11mm on all axes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9 — E2E Playwright test

**Goal:** End-to-end proof: import STEP into assembly via File → Open (Path A) and via AssemblyTab button (Path B); component visible in store and viewport; reload persistence.

#### 9a — RED: write the spec (failing — new file)

Create `tests/e2e/assembly/import-step-into-assembly.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from '../helpers/buildBox';

const STEP_FILE_PATH = resolve(
  __dirname,
  '../../../packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step',
);

// Path A: File → Open with assembly active
test('import STEP into assembly via File → Open: component appears and persists on reload', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Create a new empty assembly
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Trigger File → Open with a .step file while assembly is active
  const stepBytes = readFileSync(STEP_FILE_PATH);
  const summary = await page.evaluate(
    async ([bytes]: [number[]]) => {
      const w = window as unknown as {
        __zilventorStore?: {
          getState: () => {
            kernel: any;
            bus: any;
            activeDocument: any;
          };
        };
        __zilventorGetOpfs?: () => Promise<any>;
      };

      // Import the command directly from module (available in dev build)
      const { ImportStepAsComponentCommand } = await import(
        '/src/commands/ImportStepAsComponentCommand.ts'
      );
      const { Opfs } = await import('/src/../../kernel/src/storage/Opfs.ts').catch(
        () => import('@zilventor/kernel/src/storage/Opfs'),
      );

      const store = w.__zilventorStore!.getState();
      const opfs = await (w.__zilventorGetOpfs ? w.__zilventorGetOpfs() : Opfs.forNavigator());
      const stepBuf = new Uint8Array(bytes).buffer;
      const cmd = new ImportStepAsComponentCommand({
        stepBytes: stepBuf,
        fileName: 'cube-10mm.step',
        kernel: store.kernel,
        opfs,
      });
      await store.bus.execute(cmd);
      const s = w.__zilventorStore!.getState();
      return {
        componentCount: s.activeDocument?.kind === 'assembly'
          ? (s.activeDocument as any).document.components.length
          : -1,
        statusMessage: s.statusMessage ?? '',
      };
    },
    [Array.from(stepBytes)] as [number[]],
  );

  expect(summary.componentCount).toBe(1);
  expect(summary.statusMessage).toContain('inserted into assembly');

  // 3. Wait for the assembly mesh cache to populate (proves real BREP tessellation)
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorAssemblyGeomCacheSize?.() ?? -1;
    });
  }, { timeout: 20_000 }).toBeGreaterThan(0);

  // 4. Verify the status bar shows the success message
  await expect(page.getByText(/inserted into assembly/i)).toBeVisible({ timeout: 5_000 });

  // 5. Reload and verify component still present (autosave round-trip)
  await page.reload();
  await waitForKernelReady(page);
  await page.waitForFunction(() => {
    const w = window as any;
    const doc = w.__zilventorStore?.getState().activeDocument;
    return doc?.kind === 'assembly' && doc.document.components.length > 0;
  }, { timeout: 15_000 });

  const afterReload = await page.evaluate(() => {
    const w = window as any;
    const doc = w.__zilventorStore?.getState().activeDocument;
    return doc?.kind === 'assembly' ? (doc as any).document.components.length : -1;
  });
  expect(afterReload).toBe(1);
});

// Path B: Assembly tab "Insert From STEP…" button
test('import STEP into assembly via AssemblyTab button: component appears', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // Create a new empty assembly
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Switch to Assembly tab
  await page.getByRole('tab', { name: /assembly/i }).click();

  // "Insert From STEP…" button should be visible and enabled
  const insertBtn = page.getByRole('button', { name: /insert from step/i });
  await expect(insertBtn).toBeVisible();
  await expect(insertBtn).not.toBeDisabled();

  // Inject a fake file picker that returns our fixture
  const stepBytes = readFileSync(STEP_FILE_PATH);
  await page.evaluate(
    async ([bytes]: [number[]]) => {
      const fakeFile = {
        name: 'cube-10mm.step',
        arrayBuffer: async () => new Uint8Array(bytes).buffer,
      };
      const fakeHandle = { getFile: async () => fakeFile };
      (window as any).showOpenFilePicker = async () => [fakeHandle];
    },
    [Array.from(stepBytes)] as [number[]],
  );

  await insertBtn.click();

  // Wait for component to appear
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      const doc = w.__zilventorStore?.getState().activeDocument;
      return doc?.kind === 'assembly' ? (doc as any).document.components.length : 0;
    });
  }, { timeout: 20_000 }).toBe(1);

  // Assembly mesh tessellated
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorAssemblyGeomCacheSize?.() ?? -1;
    });
  }, { timeout: 20_000 }).toBeGreaterThan(0);
});
```

Run:
```bash
pnpm test:e2e -- tests/e2e/assembly/import-step-into-assembly.spec.ts
```
Expected failure: tests fail (new file, command not wired into the app dev bundle yet — or the module import path in `page.evaluate` may differ).

**Note for implementer:** The `page.evaluate` dynamic import path for the command may need adjustment depending on how the dev server exposes module paths. If direct module import is blocked, use the `__zilventorStore.getState().bus.execute` approach with the command constructed via the `__zilventorImportStepFromBytes` hook or a new dedicated `__zilventorImportStepIntoAssembly` hook added to `App.tsx` (analogous to `__zilventorImportStepFromBytes` at line 425). A dedicated hook is simpler and more reliable for E2E. See Task 9d below.

#### 9b — Add E2E dev hook to App.tsx

To make Path A test reliable without brittle `page.evaluate` import paths, add a `__zilventorImportStepIntoAssembly` dev hook to `App.tsx` alongside the existing `__zilventorImportStepFromBytes` hook (around line 425):

```tsx
      w.__zilventorImportStepIntoAssembly = async (bytes: number[], filename: string) => {
        const { kernel: k, bus: b } = useAppStore.getState();
        if (!k) throw new Error('kernel not ready');
        const { ImportStepAsComponentCommand } = await import('./commands/ImportStepAsComponentCommand');
        const { Opfs: OpfsClass } = await import('@zilventor/kernel/src/storage/Opfs');
        const opfs = await OpfsClass.forNavigator();
        const stepBuf = new Uint8Array(bytes).buffer;
        const cmd = new ImportStepAsComponentCommand({ stepBytes: stepBuf, fileName: filename, kernel: k, opfs });
        await b.execute(cmd);
        const s = useAppStore.getState();
        const doc = s.activeDocument;
        return {
          componentCount: doc?.kind === 'assembly' ? doc.document.components.length : -1,
          statusMessage: s.statusMessage,
        };
      };
```

Rewrite the first e2e test to use this hook:

```ts
  // Replace the page.evaluate block in the first test with:
  const summary = await page.evaluate(
    async ([bytes]: [number[]]) => {
      const w = window as unknown as {
        __zilventorImportStepIntoAssembly: (b: number[], f: string) => Promise<{ componentCount: number; statusMessage: string }>;
      };
      await page.waitForFunction(() => Boolean((window as any).__zilventorImportStepIntoAssembly));
      return await w.__zilventorImportStepIntoAssembly(bytes, 'cube-10mm.step');
    },
    [Array.from(stepBytes)] as [number[]],
  );
```

Wait for hook readiness inline:

```ts
  await page.waitForFunction(() =>
    Boolean((window as any).__zilventorImportStepIntoAssembly),
  );

  const summary = await page.evaluate(
    async ([bytes]: [number[]]) => {
      const w = window as unknown as {
        __zilventorImportStepIntoAssembly: (b: number[], f: string) => Promise<{ componentCount: number; statusMessage: string }>;
      };
      return await w.__zilventorImportStepIntoAssembly(bytes, 'cube-10mm.step');
    },
    [Array.from(stepBytes)] as [number[]],
  );
```

#### 9c — GREEN: Run e2e until passing

```bash
pnpm test:e2e -- tests/e2e/assembly/import-step-into-assembly.spec.ts
```
Expected: both tests pass.

#### 9d — COMMIT

```bash
git add tests/e2e/assembly/import-step-into-assembly.spec.ts \
        packages/app/src/App.tsx
git commit -m "$(cat <<'EOF'
test(e2e): import STEP into assembly — Path A (File→Open) and Path B (ribbon button)

Two Playwright specs: component appears in the assembly store and viewport
mesh cache (real OCCT roundtrip); reload persists via autosave. Also adds
__zilventorImportStepIntoAssembly dev hook for reliable E2E injection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10 — Self-review pass + final checks

**Goal:** Verify spec coverage, run full suites, confirm no regressions.

#### 10a — Verify spec coverage checklist

Review `docs/superpowers/specs/2026-05-28-import-step-into-assembly-design.md` success criteria:

- [x] Open empty assembly → File → Open `cube-10mm.step` → component at origin visible (E2E Test 1)
- [x] Save assembly → reload → component still there (E2E Test 1 reload assertion)
- [x] Same flow via AssemblyTab "Insert From STEP…" (E2E Test 2)
- [x] `pnpm test:unit` stays green (Task 3/5/6/7 commits)
- [x] `pnpm test:e2e` passes the new spec
- [x] No regression in existing File → Open behavior (Task 6 regression guard)

#### 10b — Run full test suites

```bash
pnpm test:unit
```
Expected: all green, count ≥ 3035 + ~20 new tests.

```bash
pnpm --filter @zilventor/kernel test:unit
```
Expected: all green including the new integration spec.

```bash
pnpm test:e2e -- tests/e2e/assembly/import-step-into-assembly.spec.ts
```
Expected: both tests pass.

#### 10c — Verify status bar copy

Status bar strings per spec:
- Assembly branch: `Imported '<name>.zipt' and inserted into assembly` ✓ (set in `ImportStepAsComponentCommand.apply()`)
- New-part branch: `Imported` ✓ (unchanged from existing FileTab path)

#### 10d — Final lint pass

```bash
pnpm lint
```
Expected: no errors in changed files.

#### 10e — COMMIT

```bash
git add -p  # stage any final fixups
git commit -m "$(cat <<'EOF'
chore(import): final review pass — verify spec coverage and lint

All success criteria from the spec verified against running tests.
No new production code; only assertion of green state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Summary of task slices

| Task | File(s) | Verifiable outcome |
|---|---|---|
| 1 | `buildImportedPartDocument.ts` | 3 unit tests red→green; `importStepIntoNewPart` unchanged |
| 2 | `dedupeName.ts` | 6 unit tests red→green |
| 3 | `ImportStepAsComponentCommand.ts` (assembly path) | 4 unit tests red→green |
| 4 | Fallback paths in same command | 4 unit tests red→green |
| 5 | Undo/redo + dedupe in command | 8 unit tests red→green |
| 6 | `FileTab.tsx` dispatch | 2 unit tests red→green; existing tests remain green |
| 7 | `AssemblyTab.tsx` button | 3 unit tests red→green |
| 8 | Kernel integration (real OCCT) | 1 integration test red→green |
| 9 | E2E Playwright | 2 e2e tests pass; dev hook added |
| 10 | Lint + coverage audit | No new failures |
