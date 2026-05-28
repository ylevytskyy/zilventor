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
