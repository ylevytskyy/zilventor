// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { AssemblyDocument, MaterialEntry, PanelFeature } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';
import { CreateAndPlacePanelCommand } from '../CreateAndPlacePanelCommand';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async read(p: string) {
    const b = this.files.get(p);
    if (!b) throw new Error('ENOENT');
    return b;
  }
  async exists(p: string) { return this.files.has(p); }
}

const emptyAssembly = (): AssemblyDocument => ({
  id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
  components: [], constraints: [], groundedComponentPaths: [],
  colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
});

const PANEL: PanelFeature = {
  kind: 'panel',
  id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-part-1',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
};

const PART_MATS: MaterialEntry[] = [
  { id: 'mat-part-1', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b' },
];

describe('CreateAndPlacePanelCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyAssembly() });
  });

  it('persists a new .zipt, copies the material into the assembly registry, and places a component', async () => {
    const opfs = new MemOpfs();
    const cmd = new CreateAndPlacePanelCommand({
      partName: 'Birch panel',
      partPath: 'parts/birch-panel.zipt',
      panel: PANEL,
      partMaterials: PART_MATS,
      opfs,
    });
    await cmd.apply();
    const asm = useAppStore.getState().activeAssembly!;
    expect(asm.components).toHaveLength(1);
    expect(asm.components[0]!.partPath).toBe('parts/birch-panel.zipt');
    expect(asm.materials).toHaveLength(1);
    expect(asm.materials[0]!.id).toBe('mat-part-1');
    expect(opfs.files.has('parts/birch-panel.zipt')).toBe(true);
  });

  it('rewrites panel materialId to the existing assembly entry when names+thickness match', async () => {
    // Seed assembly with a material whose key matches the part material.
    const seeded: MaterialEntry = {
      id: 'mat-asm-existing', name: 'Birch 18', defaultThickness: 18, color: '#000000',
    };
    useAppStore.getState().addMaterial(seeded);

    const opfs = new MemOpfs();
    const cmd = new CreateAndPlacePanelCommand({
      partName: 'Birch panel',
      partPath: 'parts/birch-panel.zipt',
      panel: PANEL,
      partMaterials: PART_MATS,
      opfs,
    });
    await cmd.apply();
    const asm = useAppStore.getState().activeAssembly!;
    // Registry should not grow — the entry already exists.
    expect(asm.materials).toHaveLength(1);
    expect(asm.materials[0]!.id).toBe('mat-asm-existing');

    // Decode persisted bytes and assert the panel's materialId was rewritten.
    const bytes = opfs.files.get('parts/birch-panel.zipt')!;
    const { readTarGz } = await import('@zilventor/kernel/src/storage/tarGzipUtil');
    const entries = await readTarGz(bytes);
    const manifestEntry = entries.find((e) => e.name === 'manifest.json')!;
    const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
    const panel = manifest.document.featureTree.find((f: any) => f.kind === 'panel');
    expect(panel.materialId).toBe('mat-asm-existing');
  });

  it('revert removes the placed component and restores assembly materials', async () => {
    const opfs = new MemOpfs();
    const cmd = new CreateAndPlacePanelCommand({
      partName: 'Birch panel',
      partPath: 'parts/birch-panel.zipt',
      panel: PANEL,
      partMaterials: PART_MATS,
      opfs,
    });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.materials).toHaveLength(1);
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(1);

    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(0);
    expect(useAppStore.getState().activeAssembly!.materials).toHaveLength(0);
  });

  it('throws NO_ACTIVE_ASSEMBLY when no assembly is active', async () => {
    useAppStore.getState().setActivePart(null);
    const opfs = new MemOpfs();
    const cmd = new CreateAndPlacePanelCommand({
      partName: 'Birch panel',
      partPath: 'parts/birch-panel.zipt',
      panel: PANEL,
      partMaterials: PART_MATS,
      opfs,
    });
    await expect(cmd.apply()).rejects.toThrow(/NO_ACTIVE_ASSEMBLY/);
  });
});

// CreateAndPlacePanelCommand always asserts activeAssembly (activePart is null).
// syncPartMaterials() is wired per the kernel-sync spec but is a no-op here.
describe('CreateAndPlacePanelCommand — kernel sync (assembly active)', () => {
  beforeEach(() => {
    // Ensure assembly is active before injecting kernel mock.
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyAssembly() });
  });

  afterEach(() => {
    useAppStore.setState({ kernel: null } as never);
    vi.restoreAllMocks();
  });

  it('addMaterial call does NOT call kernel.setMaterials (null guard, assembly active)', async () => {
    const mockSetMaterials = vi.fn().mockResolvedValue(undefined);
    // Partial mock — no setKernel action on store.
    useAppStore.setState({ kernel: { setMaterials: mockSetMaterials } as never } as never);

    const opfs = new MemOpfs();
    const cmd = new CreateAndPlacePanelCommand({
      partName: 'Sync Test Panel',
      partPath: 'parts/sync-panel.zipt',
      panel: PANEL,
      partMaterials: PART_MATS,
      opfs,
    });
    await cmd.apply();

    // Assembly active — activePart is null — syncPartMaterials is a no-op.
    expect(mockSetMaterials).not.toHaveBeenCalled();
  });
});
