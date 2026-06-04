// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { ExplodeIntoAssemblyCommand } from '../ExplodeIntoAssemblyCommand';
import type { PartDocument } from '@zilventor/shared';

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

type SplitResult = {
  solids: Array<{ brepBlobId: string; boundingBox: [number, number, number, number, number, number] }>;
  surfaces: { brepBlobId: string; boundingBox: [number, number, number, number, number, number] } | null;
};

function makeKernel(splitResult: SplitResult) {
  return {
    splitImportedShape: vi.fn(async () => splitResult),
    registerPart: vi.fn(async () => undefined),
    deletePart: vi.fn(async () => undefined),
    saveToBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
}

/** Build a PartDocument with an imported feature — the "active imported part" */
function makeImportedPart(name: string, bodyRef: string, sourceStep: string): PartDocument {
  return {
    id: 'part-imported-id',
    name,
    units: 'mm',
    parameters: {},
    featureTree: [
      {
        kind: 'imported' as const,
        id: 'feat-imported-id',
        sourceStep,
        bodyRef,
      },
    ],
    properties: {},
    materials: [],
    hardware: [],
  };
}

// ---------- tests: apply 2 solids, surfaces null ------------------------------

describe('ExplodeIntoAssemblyCommand — 2 solids, no surfaces', () => {
  let kernel: ReturnType<typeof makeKernel>;
  let opfs: MemOpfs;

  beforeEach(() => {
    kernel = makeKernel({
      solids: [
        { brepBlobId: 'solid-blob-1', boundingBox: [0, 0, 0, 10, 10, 10] },
        { brepBlobId: 'solid-blob-2', boundingBox: [20, 0, 0, 30, 10, 10] },
      ],
      surfaces: null,
    });
    opfs = new MemOpfs();

    const part = makeImportedPart('Predator', 'body-ref-abc', 'Predator.step');
    useAppStore.getState().setActivePart(part);
  });

  it('apply: activeDocument becomes assembly with exactly 2 components', async () => {
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    expect(activeDocument?.kind).toBe('assembly');
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    expect(activeDocument.document.components).toHaveLength(2);
  });

  it('apply: components have partPaths Predator_1.zipt and Predator_2.zipt (sorted)', async () => {
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    const paths = activeDocument.document.components.map(c => c.partPath).sort();
    expect(paths).toEqual(['Predator_1.zipt', 'Predator_2.zipt']);
  });

  it('apply: all components are at identity pose', async () => {
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    for (const c of activeDocument.document.components) {
      expect(c.position).toEqual({ x: 0, y: 0, z: 0 });
      expect(c.rotation).toEqual({ rx: 0, ry: 0, rz: 0 });
      expect(c.visible).toBe(true);
    }
  });

  it('apply: registerPart called exactly 2 times', async () => {
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    expect(kernel.registerPart).toHaveBeenCalledTimes(2);
  });

  it('apply: splitImportedShape called with the part imported bodyRef', async () => {
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    expect(kernel.splitImportedShape).toHaveBeenCalledTimes(1);
    expect(kernel.splitImportedShape).toHaveBeenCalledWith('body-ref-abc');
  });
});

// ---------- tests: apply 2 solids + surfaces non-null ------------------------

describe('ExplodeIntoAssemblyCommand — 2 solids + surfaces', () => {
  let kernel: ReturnType<typeof makeKernel>;
  let opfs: MemOpfs;

  beforeEach(() => {
    kernel = makeKernel({
      solids: [
        { brepBlobId: 'solid-blob-1', boundingBox: [0, 0, 0, 10, 10, 10] },
        { brepBlobId: 'solid-blob-2', boundingBox: [20, 0, 0, 30, 10, 10] },
      ],
      surfaces: { brepBlobId: 'surf-blob-1', boundingBox: [0, 0, 0, 100, 100, 5] },
    });
    opfs = new MemOpfs();

    const part = makeImportedPart('Frame', 'body-ref-frame', 'Frame.step');
    useAppStore.getState().setActivePart(part);
  });

  it('apply: activeDocument becomes assembly with 3 components (2 solids + surfaces)', async () => {
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    expect(activeDocument?.kind).toBe('assembly');
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    expect(activeDocument.document.components).toHaveLength(3);
  });

  it('apply: includes a surfaces component named <base>_surfaces.zipt', async () => {
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    const paths = activeDocument.document.components.map(c => c.partPath);
    expect(paths).toContain('Frame_surfaces.zipt');
  });

  it('apply: registerPart called exactly 3 times (solids + surfaces)', async () => {
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    expect(kernel.registerPart).toHaveBeenCalledTimes(3);
  });
});

// ---------- tests: revert ----------------------------------------------------

describe('ExplodeIntoAssemblyCommand — revert', () => {
  let kernel: ReturnType<typeof makeKernel>;
  let opfs: MemOpfs;
  let originalPart: PartDocument;

  beforeEach(() => {
    kernel = makeKernel({
      solids: [
        { brepBlobId: 'solid-blob-1', boundingBox: [0, 0, 0, 10, 10, 10] },
        { brepBlobId: 'solid-blob-2', boundingBox: [20, 0, 0, 30, 10, 10] },
      ],
      surfaces: null,
    });
    opfs = new MemOpfs();
    originalPart = makeImportedPart('Widget', 'body-ref-widget', 'Widget.step');
    useAppStore.getState().setActivePart(originalPart);
  });

  it('revert: restores activeDocument to kind=part with the original part name', async () => {
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    expect(useAppStore.getState().activeDocument?.kind).toBe('assembly');

    await cmd.revert();
    const { activeDocument } = useAppStore.getState();
    expect(activeDocument?.kind).toBe('part');
    if (activeDocument?.kind !== 'part') throw new Error('guard');
    expect(activeDocument.document.name).toBe('Widget');
  });

  it('revert: calls deletePart for each created part', async () => {
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    expect(kernel.registerPart).toHaveBeenCalledTimes(2);

    await cmd.revert();
    expect(kernel.deletePart).toHaveBeenCalledTimes(2);
  });
});

// ---------- tests: redo (apply → revert → apply) -----------------------------

describe('ExplodeIntoAssemblyCommand — redo', () => {
  let kernel: ReturnType<typeof makeKernel>;
  let opfs: MemOpfs;

  beforeEach(() => {
    kernel = makeKernel({
      solids: [
        { brepBlobId: 'solid-blob-1', boundingBox: [0, 0, 0, 10, 10, 10] },
        { brepBlobId: 'solid-blob-2', boundingBox: [20, 0, 0, 30, 10, 10] },
      ],
      surfaces: null,
    });
    opfs = new MemOpfs();
    const part = makeImportedPart('Cube', 'body-ref-cube', 'Cube.step');
    useAppStore.getState().setActivePart(part);
  });

  it('apply → revert → apply (redo) succeeds: activeDocument is assembly with 2 components', async () => {
    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });

    // First apply
    await cmd.apply();
    expect(useAppStore.getState().activeDocument?.kind).toBe('assembly');

    // Revert (undo)
    await cmd.revert();
    expect(useAppStore.getState().activeDocument?.kind).toBe('part');

    // Re-apply (redo) — must not throw; re-runs splitImportedShape
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    expect(activeDocument?.kind).toBe('assembly');
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    expect(activeDocument.document.components).toHaveLength(2);
  });
});

// ---------- tests: atomic abort on saveToBytes failure -----------------------

describe('ExplodeIntoAssemblyCommand — atomic abort', () => {
  it('apply rejects on saveToBytes failure; cleans up only created parts; does not switch activeDocument', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const kernel = {
      splitImportedShape: vi.fn(async () => ({
        solids: [
          { brepBlobId: 'solid-blob-1', boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number] },
          { brepBlobId: 'solid-blob-2', boundingBox: [20, 0, 0, 30, 10, 10] as [number, number, number, number, number, number] },
        ],
        surfaces: null,
      })),
      registerPart: vi.fn(async () => undefined),
      deletePart: vi.fn(async () => undefined),
      // First part succeeds; second throws (disk full)
      saveToBytes: vi.fn()
        .mockResolvedValueOnce(bytes)
        .mockRejectedValueOnce(new Error('disk full')),
    };
    const opfs = new MemOpfs();
    const deleteSpy = vi.spyOn(opfs, 'delete');

    const part = makeImportedPart('Frame', 'body-ref-frame', 'Frame.step');
    useAppStore.getState().setActivePart(part);
    const priorActiveDocument = useAppStore.getState().activeDocument;

    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });

    // apply() must reject
    await expect(cmd.apply()).rejects.toThrow(/disk full/i);

    // Only 1 part was created before the throw; deletePart called exactly once for cleanup
    expect(kernel.deletePart).toHaveBeenCalledTimes(1);

    // OPFS delete called for the first part path
    expect(deleteSpy).toHaveBeenCalledWith('Frame_1.zipt');

    // activeDocument was NOT switched — it's still the original part doc (not assembly)
    const { activeDocument } = useAppStore.getState();
    expect(activeDocument).toEqual(priorActiveDocument);
    expect(activeDocument?.kind).not.toBe('assembly');
  });
});

// ---------- tests: single-solid naming (Issue 2) -----------------------------

describe('ExplodeIntoAssemblyCommand — single solid, no surfaces (bare name)', () => {
  it('apply: single solid uses bare base name (no _1 suffix)', async () => {
    const kernel = makeKernel({
      solids: [{ brepBlobId: 'solid-blob-only', boundingBox: [0, 0, 0, 10, 10, 10] }],
      surfaces: null,
    });
    const opfs = new MemOpfs();
    const part = makeImportedPart('Widget', 'body-ref-widget', 'Widget.step');
    useAppStore.getState().setActivePart(part);

    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    expect(activeDocument.document.components).toHaveLength(1);
    expect(activeDocument.document.components[0]!.partPath).toBe('Widget.zipt');
  });
});

describe('ExplodeIntoAssemblyCommand — single solid + surfaces', () => {
  it('apply: single solid uses bare base name; surfaces uses <base>_surfaces', async () => {
    const kernel = makeKernel({
      solids: [{ brepBlobId: 'solid-blob-only', boundingBox: [0, 0, 0, 10, 10, 10] }],
      surfaces: { brepBlobId: 'surf-blob', boundingBox: [0, 0, 0, 100, 100, 5] },
    });
    const opfs = new MemOpfs();
    const part = makeImportedPart('Bracket', 'body-ref-bracket', 'Bracket.step');
    useAppStore.getState().setActivePart(part);

    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    const paths = activeDocument.document.components.map(c => c.partPath).sort();
    expect(paths).toEqual(['Bracket.zipt', 'Bracket_surfaces.zipt']);
  });
});

describe('ExplodeIntoAssemblyCommand — OPFS dedupe collision (Issue 1)', () => {
  it('apply: dedupes when OPFS already has a file with the same name', async () => {
    const kernel = makeKernel({
      solids: [
        { brepBlobId: 'solid-blob-1', boundingBox: [0, 0, 0, 10, 10, 10] },
        { brepBlobId: 'solid-blob-2', boundingBox: [20, 0, 0, 30, 10, 10] },
      ],
      surfaces: null,
    });
    // Pre-populate OPFS: Predator_1.zipt already exists
    const opfs = new MemOpfs();
    await opfs.write('Predator_1.zipt', new Uint8Array([9, 9, 9]));

    const part = makeImportedPart('Predator', 'body-ref-abc', 'Predator.step');
    useAppStore.getState().setActivePart(part);

    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();

    const { activeDocument } = useAppStore.getState();
    if (activeDocument?.kind !== 'assembly') throw new Error('guard');
    const paths = activeDocument.document.components.map(c => c.partPath);

    // The pre-existing file must not be overwritten
    const preExistingBytes = await opfs.read('Predator_1.zipt');
    expect(preExistingBytes).toEqual(new Uint8Array([9, 9, 9]));

    // The new solid's path must differ from 'Predator_1.zipt'
    // dedupeName produces 'Predator_1 (2)' for the collision
    expect(paths).not.toContain('Predator_1.zipt');
    expect(paths.some(p => p !== 'Predator_1.zipt' && p !== 'Predator_2.zipt')).toBe(true);
    // Specifically: first solid collides → 'Predator_1 (2)', second solid → 'Predator_2'
    expect(paths).toContain('Predator_1 (2).zipt');
    expect(paths).toContain('Predator_2.zipt');
  });
});

// ---------- tests: guard throws ----------------------------------------------

describe('ExplodeIntoAssemblyCommand — guard throws', () => {
  it('apply throws /no active imported part/i when activeDocument is null', async () => {
    const kernel = makeKernel({ solids: [], surfaces: null });
    const opfs = new MemOpfs();
    useAppStore.getState().setActiveDocument(null);

    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await expect(cmd.apply()).rejects.toThrow(/no active imported part/i);
  });

  it('apply throws /no active imported part/i when activeDocument is assembly', async () => {
    const kernel = makeKernel({ solids: [], surfaces: null });
    const opfs = new MemOpfs();
    useAppStore.getState().setActiveDocument({
      kind: 'assembly',
      document: {
        id: 'asm1', name: 'MyAsm', units: 'mm', parameters: {}, components: [],
        constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
        cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [],
      },
    });

    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await expect(cmd.apply()).rejects.toThrow(/no active imported part/i);
  });

  it('apply throws /no imported feature/i when active part has no imported feature', async () => {
    const kernel = makeKernel({ solids: [], surfaces: null });
    const opfs = new MemOpfs();
    // A plain part with no imported feature
    useAppStore.getState().setActivePart({
      id: 'plain-part', name: 'PlainPart', units: 'mm', parameters: {},
      featureTree: [], properties: {}, materials: [], hardware: [],
    });

    const cmd = new ExplodeIntoAssemblyCommand({ kernel: kernel as any, opfs: opfs as any });
    await expect(cmd.apply()).rejects.toThrow(/no imported feature/i);
  });
});
