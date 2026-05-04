// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddHardwareCommand } from '../AddHardwareCommand';
import { useAppStore } from '../../store/useAppStore';
import type { PartDocument, Feature, SketchPrimitive } from '@zilventor/shared';

// Minimal MemOpfs for tests.
function makeOpfs(initial: Record<string, Uint8Array> = {}) {
  const store = new Map<string, Uint8Array>(Object.entries(initial));
  return {
    exists:  async (p: string) => store.has(p),
    read:    async (p: string) => store.get(p) ?? new Uint8Array(),
    write:   async (p: string, b: Uint8Array) => { store.set(p, b); },
    delete:  async (p: string) => { store.delete(p); },
    listAll: async () => [...store.keys()],
    store,
  };
}

// Builds a minimal valid .ziasm tar.gz containing a manifest with the
// given component partPaths. Used by the cross-assembly refcount test.
async function makeZiasmBytes(componentPartPaths: string[]): Promise<Uint8Array> {
  const { writeTarGz } = await import('@zilventor/kernel/src/storage/tarGzipUtil');
  const manifest = {
    formatVersion: 12,
    kind: 'assembly' as const,
    document: {
      id: 'sibling', name: 'Sibling', units: 'mm',
      parameters: {}, constraints: [], groundedComponentPaths: [],
      colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
      colorOverrides: {}, properties: {}, materials: [], hardware: [],
      components: componentPartPaths.map((p, i) => ({
        id: `c${i}`, partPath: p,
        position: { x: 0, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      })),
    },
  };
  return writeTarGz([{ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }]);
}

function makeActiveAssembly(components: Array<{ id: string; partPath: string }> = []) {
  return {
    id: 'a1', name: 'Asm', units: 'mm' as const, parameters: {}, components: components.map((c) => ({
      ...c, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true,
    })),
    constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
    cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [],
  };
}

beforeEach(() => {
  useAppStore.setState({ activeAssembly: makeActiveAssembly(), hardwareDialog: null });
});

describe('AddHardwareCommand', () => {
  it('apply() throws on unknown SKU', async () => {
    const opfs = makeOpfs();
    const cmd = new AddHardwareCommand({ skuId: 'unknown-sku', opfs, store: useAppStore });
    await expect(cmd.apply()).rejects.toThrow(/HardwareSkuNotFound|unknown-sku/i);
  });

  it('apply() writes hardware/<sku>.zipt when file does not exist', async () => {
    const opfs = makeOpfs();
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    expect(await opfs.exists('hardware/hinge-35mm-cup-full.zipt')).toBe(true);
  });

  it('apply() reuses existing file without re-writing when file already exists', async () => {
    const existing = new Uint8Array([1, 2, 3]);
    const opfs = makeOpfs({ 'hardware/hinge-35mm-cup-full.zipt': existing });
    const writeSpy = vi.spyOn(opfs, 'write');
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    expect(writeSpy).not.toHaveBeenCalledWith('hardware/hinge-35mm-cup-full.zipt', expect.anything());
  });

  it('apply() places a component into the active assembly', async () => {
    const opfs = makeOpfs();
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    const asm = useAppStore.getState().activeAssembly!;
    expect(asm.components.length).toBeGreaterThan(0);
    expect(asm.components[0]!.partPath).toBe('hardware/hinge-35mm-cup-full.zipt');
  });

  it('revert() removes the placed component', async () => {
    const opfs = makeOpfs();
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(1);
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(0);
  });

  it('revert() deletes the .zipt file when no other component references it', async () => {
    const opfs = makeOpfs();
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    await cmd.revert();
    expect(await opfs.exists('hardware/hinge-35mm-cup-full.zipt')).toBe(false);
  });

  it('revert() retains the .zipt file when the active assembly still references it', async () => {
    // Pre-populate the in-memory active assembly with an existing reference.
    useAppStore.setState({
      activeAssembly: makeActiveAssembly([
        { id: 'pre-existing', partPath: 'hardware/hinge-35mm-cup-full.zipt' },
      ]),
    });
    const existing = new Uint8Array([1, 2, 3]);
    const opfs = makeOpfs({ 'hardware/hinge-35mm-cup-full.zipt': existing });
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    await cmd.revert();
    // The pre-existing in-memory component still references the file → not deleted.
    expect(await opfs.exists('hardware/hinge-35mm-cup-full.zipt')).toBe(true);
  });

  it('revert() retains the .zipt file when a SIBLING .ziasm in OPFS references it (project-wide refcount per spec §5.2)', async () => {
    // Active assembly is empty, but a sibling .ziasm file in OPFS holds a reference.
    const opfs = makeOpfs();
    const siblingBytes = await makeZiasmBytes(['hardware/hinge-35mm-cup-full.zipt']);
    await opfs.write('Other Project Asm.ziasm', siblingBytes);

    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();   // writes hardware/<sku>.zipt + places into active assembly
    await cmd.revert();  // removes from active; project-wide scan sees sibling reference

    // Sibling still references it → file must be retained.
    expect(await opfs.exists('hardware/hinge-35mm-cup-full.zipt')).toBe(true);
  });

  it('synthesizePart: featureTree has 7 origin features + sketch + extrude + hardware = 10 (spec §1.1/§3.3)', async () => {
    const { unpackProject } = await import('@zilventor/kernel/src/storage/ProjectPacker');

    const opfs = makeOpfs();
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();

    const bytes = opfs.store.get('hardware/hinge-35mm-cup-full.zipt')!;
    const { manifest } = await unpackProject(bytes);
    const doc = (manifest as { document: PartDocument }).document;
    const tree: Feature[] = doc.featureTree;

    // Total length.
    expect(tree).toHaveLength(10);

    // First 7 are origin features.
    const originFeatures = tree.slice(0, 7);
    expect(originFeatures.every((f) => f.id.startsWith('origin.'))).toBe(true);

    // Exactly one sketch with the bbox rectangle (l=48, w=35).
    const sketches = tree.filter((f) => f.kind === 'sketch');
    expect(sketches).toHaveLength(1);
    const sketch = sketches[0] as Extract<Feature, { kind: 'sketch' }>;
    expect(sketch.primitives).toHaveLength(1);
    const rect = sketch.primitives[0] as Extract<SketchPrimitive, { kind: 'rectangle' }>;
    expect(rect.kind).toBe('rectangle');
    expect(rect.w).toBe(48); // bbox.l
    expect(rect.h).toBe(35); // bbox.w

    // Exactly one extrude with distanceParam 'hw_h' and the parameter value = bbox.h = 12.
    const extrudes = tree.filter((f) => f.kind === 'extrude');
    expect(extrudes).toHaveLength(1);
    const extrude = extrudes[0] as Extract<Feature, { kind: 'extrude' }>;
    expect(extrude.distanceParam).toBe('hw_h');
    expect(doc.parameters['hw_h']?.value).toBe(12); // bbox.h

    // HardwareFeature is present.
    const hwFeature = tree.find((f) => f.kind === 'hardware');
    expect(hwFeature).toBeDefined();
    expect((hwFeature as { hardwareSkuId: string }).hardwareSkuId).toBe('hinge-35mm-cup-full');
  });
});
