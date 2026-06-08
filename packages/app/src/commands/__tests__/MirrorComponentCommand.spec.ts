// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { MirrorComponentCommand } from '../MirrorComponentCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async exists(p: string) { return this.files.has(p); }
  async delete(p: string) { this.files.delete(p); }
  async listAll() { return [...this.files.keys()]; }
}

function makeKernel() {
  return {
    mirrorPart: vi.fn(async () => ({ partId: 'mirror-part-id', brepBlobId: 'mirror-blob' })),
    registerPart: vi.fn(async () => undefined),
    deletePart: vi.fn(async () => undefined),
    saveToBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
}

const srcInstance: ComponentInstance = {
  id: 'src-comp',
  partPath: 'side-panel.zipt',
  position: { x: 10, y: 0, z: 0 },
  rotation: { rx: 0, ry: 0, rz: 0 },
  visible: true,
  pose: { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
};

function makeAsm(): AssemblyDocument {
  return {
    id: 'asm', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
    components: [srcInstance], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
}

describe('MirrorComponentCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAsm() });
  });

  it('apply() calls kernel.mirrorPart with sourcePartKernelId (NOT the instance id)', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'src-comp', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    expect(kernel.mirrorPart).toHaveBeenCalledWith('kernel-part-id');
  });

  it('apply() adds 1 new component to the assembly', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'src-comp', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(2);
  });

  it('apply() places mirrored instance at reflected translation (YZ plane negates X)', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'src-comp', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    const mirrored = comps.find((c) => c.id !== 'src-comp')!;
    // YZ mirror: x → -x
    expect(mirrored.pose!.translation.x).toBeCloseTo(-10, 6);
    expect(mirrored.pose!.translation.y).toBeCloseTo(0, 6);
  });

  it('apply() writes a .zipt file to opfs', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'src-comp', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    expect(opfs.files.size).toBe(1);
  });

  it('revert() removes the component and deletes the part', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'src-comp', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    await cmd.revert();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(1);
    expect(kernel.deletePart).toHaveBeenCalledWith('mirror-part-id');
    expect(opfs.files.size).toBe(0);
  });

  it('apply() noops if source instance not found', async () => {
    const kernel = makeKernel();
    const opfs = new MemOpfs();
    const cmd = new MirrorComponentCommand({ sourceInstanceId: 'no-such', sourcePartKernelId: 'kernel-part-id', plane: 'yz', kernel: kernel as any, opfs: opfs as any });
    await cmd.apply();
    const comps = useAppStore.getState().activeAssembly!.components;
    expect(comps).toHaveLength(1);
    expect(kernel.mirrorPart).not.toHaveBeenCalled();
  });
});
