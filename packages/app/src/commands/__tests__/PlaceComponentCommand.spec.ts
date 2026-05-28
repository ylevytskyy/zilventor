// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { PlaceComponentCommand } from '../PlaceComponentCommand';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { AssemblyDocument } from '@zilventor/shared';

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

function makeDoc(name: string, components: AssemblyDocument['components'] = []): AssemblyDocument {
  return {
    id: name, name, units: 'mm', parameters: {}, properties: {},
    components, constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [],
    hardware: [],
  };
}

describe('PlaceComponentCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('a') });
  });

  it('apply() adds a ComponentInstance to the active assembly', async () => {
    const cmd = new PlaceComponentCommand({ partPath: 'leg.zipt' });
    await cmd.apply();
    const s = useAppStore.getState();
    expect(s.activeAssembly?.components).toHaveLength(1);
    expect(s.activeAssembly?.components[0]!.partPath).toBe('leg.zipt');
  });

  it('revert() removes the placed component', async () => {
    const cmd = new PlaceComponentCommand({ partPath: 'leg.zipt' });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(0);
  });

  it('refuses to place a .ziasm that would create a cycle and sets a status message', async () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('top') });
    const opfs = new MemOpfs();
    // candidate.ziasm contains a component pointing back at top.ziasm -> cycle
    const candidate = makeDoc('candidate', [
      { id: 'inner', partPath: 'top.ziasm',
        position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('candidate.ziasm', await packAssembly(candidate, new Uint8Array()));
    const cmd = new PlaceComponentCommand({ partPath: 'candidate.ziasm', opfs: opfs as any });
    await cmd.apply();
    const s = useAppStore.getState();
    expect(s.activeAssembly?.components).toHaveLength(0);
    expect(s.statusMessage.toLowerCase()).toContain('cycle');
  });

  it('places a non-cyclic .ziasm normally', async () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('top') });
    const opfs = new MemOpfs();
    const drawer = makeDoc('drawer');
    await opfs.write('drawer.ziasm', await packAssembly(drawer, new Uint8Array()));
    const cmd = new PlaceComponentCommand({ partPath: 'drawer.ziasm', opfs: opfs as any });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(1);
  });

  it('places a panel-bearing .zipt: copies scratchpad material into assembly registry and rewrites panel id when a same-key entry already exists', async () => {
    const { CURRENT_FORMAT_VERSION } = await import('@zilventor/shared');
    const { writeTarGz, readTarGz } = await import('@zilventor/kernel/src/storage/tarGzipUtil');
    const { newPart, addFeature } = await import('@zilventor/kernel/src/adapter/PartDocument');
    const opfs = new MemOpfs();

    const partMat = { id: 'mat-part-1', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b' } as const;
    const panel = {
      kind: 'panel' as const, id: 'pf-1',
      length: { kind: 'literal' as const, value: 600 },
      width: { kind: 'literal' as const, value: 400 },
      thickness: { kind: 'literal' as const, value: 18 },
      thicknessFromMaterial: true,
      materialId: 'mat-part-1',
      grain: 'length' as const,
      edgeBands: { front: null, back: null, left: null, right: null },
    };
    const partDoc = addFeature({ ...newPart('Birch panel'), materials: [partMat] }, panel);
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: partDoc };
    const partBytes = await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]);
    await opfs.write('parts/birch-panel.zipt', partBytes);

    // Seed assembly with an existing material whose key (name|thickness) matches.
    const existing = { id: 'mat-asm-existing', name: 'Birch 18', defaultThickness: 18, color: '#000000' } as const;
    useAppStore.getState().setActiveDocument({
      kind: 'assembly',
      document: { ...makeDoc('top'), materials: [existing] },
    });

    const cmd = new PlaceComponentCommand({ partPath: 'parts/birch-panel.zipt', opfs: opfs as any });
    await cmd.apply();

    const asm = useAppStore.getState().activeAssembly!;
    expect(asm.components).toHaveLength(1);
    // Registry shouldn't grow — same-key entry exists.
    expect(asm.materials).toHaveLength(1);
    expect(asm.materials[0]!.id).toBe('mat-asm-existing');

    // Verify the part on disk had its panel materialId rewritten.
    const reread = await readTarGz(opfs.files.get('parts/birch-panel.zipt')!);
    const m = JSON.parse(new TextDecoder().decode(reread.find((e) => e.name === 'manifest.json')!.data));
    const rewrittenPanel = m.document.featureTree.find((f: any) => f.kind === 'panel');
    expect(rewrittenPanel.materialId).toBe('mat-asm-existing');
  });

  it('places a panel-bearing .zipt with a brand-new material: copies it into assembly registry, no rewrite', async () => {
    const { CURRENT_FORMAT_VERSION } = await import('@zilventor/shared');
    const { writeTarGz } = await import('@zilventor/kernel/src/storage/tarGzipUtil');
    const { newPart, addFeature } = await import('@zilventor/kernel/src/adapter/PartDocument');
    const opfs = new MemOpfs();
    const partMat = { id: 'mat-part-1', name: 'Walnut 18', defaultThickness: 18, color: '#5a3a1a' } as const;
    const panel = {
      kind: 'panel' as const, id: 'pf-2',
      length: { kind: 'literal' as const, value: 600 },
      width: { kind: 'literal' as const, value: 400 },
      thickness: { kind: 'literal' as const, value: 18 },
      thicknessFromMaterial: true,
      materialId: 'mat-part-1',
      grain: 'length' as const,
      edgeBands: { front: null, back: null, left: null, right: null },
    };
    const partDoc = addFeature({ ...newPart('Walnut panel'), materials: [partMat] }, panel);
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: partDoc };
    const partBytes = await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]);
    await opfs.write('parts/walnut-panel.zipt', partBytes);
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('top') });

    const cmd = new PlaceComponentCommand({ partPath: 'parts/walnut-panel.zipt', opfs: opfs as any });
    await cmd.apply();

    const asm = useAppStore.getState().activeAssembly!;
    expect(asm.materials).toHaveLength(1);
    expect(asm.materials[0]!.id).toBe('mat-part-1');
  });
});

// --- Block A: null-guard (assembly active — the common case) ---
describe('PlaceComponentCommand — kernel sync (assembly active)', () => {
  afterEach(() => {
    useAppStore.setState({ kernel: null } as never);
    vi.restoreAllMocks();
  });

  it('addMaterial call from reconciliation does NOT call kernel.setMaterials (null guard)', async () => {
    const mockSetMaterials = vi.fn().mockResolvedValue(undefined);
    // Partial mock — no setKernel action on store.
    useAppStore.setState({ kernel: { setMaterials: mockSetMaterials } as never } as never);

    // Assembly active, activePart is null — syncPartMaterials must no-op.
    // Run reconciliation by placing a panel part with a new material.
    const { CURRENT_FORMAT_VERSION } = await import('@zilventor/shared');
    const { writeTarGz } = await import('@zilventor/kernel/src/storage/tarGzipUtil');
    const { newPart, addFeature } = await import('@zilventor/kernel/src/adapter/PartDocument');
    const opfs = new MemOpfs();
    const partMat = { id: 'mat-sync-a', name: 'Sync A', defaultThickness: 18, color: '#aabbcc' } as const;
    const panel = {
      kind: 'panel' as const, id: 'pf-sync-a',
      length: { kind: 'literal' as const, value: 600 },
      width: { kind: 'literal' as const, value: 400 },
      thickness: { kind: 'literal' as const, value: 18 },
      thicknessFromMaterial: true,
      materialId: 'mat-sync-a',
      grain: 'length' as const,
      edgeBands: { front: null, back: null, left: null, right: null },
    };
    const partDoc = addFeature({ ...newPart('Sync panel A'), materials: [partMat] }, panel);
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: partDoc };
    const partBytes = await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]);
    await opfs.write('parts/sync-panel-a.zipt', partBytes);
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('top') });

    const cmd = new PlaceComponentCommand({ partPath: 'parts/sync-panel-a.zipt', opfs: opfs as any });
    await cmd.apply();

    // Assembly is active → activePart is null → syncPartMaterials no-op.
    expect(mockSetMaterials).not.toHaveBeenCalled();
  });
});

// --- Block B: part-active integration fixture (proves the wiring is symmetric) ---
// This is an ARTIFICIAL test-only configuration: PlaceComponentCommand normally runs
// under an assembly context, but the helper's invariant (if activePart is set, call kernel)
// should hold regardless. We test syncPartMaterials directly with a non-null activePart.
describe('PlaceComponentCommand — kernel sync (part active, artificial fixture)', () => {
  afterEach(() => {
    useAppStore.setState({ kernel: null, activePart: null } as never);
    vi.restoreAllMocks();
  });

  it('calls kernel.setMaterials when activePart is set after addMaterial', async () => {
    const mockSetMaterials = vi.fn().mockResolvedValue(undefined);
    const fakePart = {
      id: 'part-pc-sync', name: 'FakePart', units: 'mm' as const,
      parameters: {}, properties: {}, featureTree: [], materials: [], hardware: [],
    };
    // Partial mock — no setKernel action on store.
    useAppStore.setState({
      kernel: { setMaterials: mockSetMaterials } as never,
      activePart: fakePart,
    } as never);

    // Simulate the command's addMaterial + syncPartMaterials call.
    const { syncPartMaterials } = await import('../../store/syncPartMaterials');
    useAppStore.getState().addMaterial({
      id: 'mat-pc-new', name: 'NewMat', defaultThickness: 18, color: '#aabbcc',
    });
    await syncPartMaterials();

    expect(mockSetMaterials).toHaveBeenCalledOnce();
    const callArgs = mockSetMaterials.mock.calls[0] as [string, unknown[]];
    expect(callArgs[0]).toBe('part-pc-sync');
  });
});
