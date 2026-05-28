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
  extractStepSolids: typeof vi.fn;
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
    extractStepSolids: overrides?.extractStepSolids ?? vi.fn(async () => [
      {
        brepBlobId: 'blob-123',
        boundingBox: [0, 0, 0, 10, 10, 10] as [number, number, number, number, number, number],
      },
    ]),
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

  it('apply() calls extractStepSolids with the correct bytes', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new ImportStepAsComponentCommand({
      stepBytes: STEP_BYTES.buffer,
      fileName: 'MyHinge.step',
      kernel: kernel as any,
      opfs: opfs as any,
    });
    await cmd.apply();

    expect(kernel.importStep).not.toHaveBeenCalled();
    expect(kernel.extractStepSolids).toHaveBeenCalledOnce();
    const arg = (kernel.extractStepSolids as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(new Uint8Array(arg.stepBytes as ArrayBuffer)).toEqual(STEP_BYTES);
    // partName flows through baseName → dedupeName → registered part (N=1 → bare name, no suffix)
    const registered = (kernel.registerPart as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(registered.name).toBe('MyHinge');
  });
});

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

    // redo = call apply() again
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(1);
    expect(await opfs.exists('hinge.zipt')).toBe(true);

    // Regression guard: redo MUST take the redoState branch and skip the
    // expensive STEP parse + archive serialize. If redoState were removed,
    // these would be called twice (once per apply) and the test would fail.
    expect(kernel.importStep).not.toHaveBeenCalled();
    expect(kernel.extractStepSolids).toHaveBeenCalledTimes(1);
    expect(kernel.saveToBytes).toHaveBeenCalledTimes(1);
  });
});

// ---------- tests: multi-body STEP -------------------------------------------

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
    expect([...writtenPaths].sort()).toEqual(['chair_1.zipt', 'chair_2.zipt', 'chair_3.zipt']);
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
