// @vitest-environment node
/**
 * AddDrawerBankCommand — tandem branch tests (M4-C).
 *
 * Reuses seedCabinet from AddDrawerBankCommand.spec.ts pattern exactly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDrawerBankCommand } from '../AddDrawerBankCommand';
import { DEFAULT_TANDEM_SLIDE_SKU } from '../buildSlidePart';
import { useAppStore } from '../../store/useAppStore';
import { unpackProject, packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { aggregateHardwareRecursive } from '../../assembly/walkers/aggregateHardwareRecursive';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string): Promise<Uint8Array> {
    const b = this.files.get(p);
    if (!b) throw new Error(`MemOpfs: no file at ${p}`);
    return b;
  }
  async write(p: string, b: Uint8Array): Promise<void> { this.files.set(p, b); }
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async delete(p: string): Promise<void> { this.files.delete(p); }
}

function makeKernel() {
  const registered = new Set<string>();
  return {
    registered,
    async registerPart(part: PartDocument) { registered.add(part.id); },
    async deletePart(partId: string) { registered.delete(partId); },
  };
}

const Tc = 18;
const CABW = 600, CABD = 560, CABH = 720, TOEKICK_H = 100;

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

async function seedCabinet(opfs: MemOpfs): Promise<string> {
  for (const path of ['L.zipt', 'R.zipt']) {
    const doc: Partial<PartDocument> = {
      id: path, name: path, units: 'mm', parameters: {},
      featureTree: [{
        kind: 'panel', id: 'panel',
        length: { kind: 'literal', value: CABH },
        width: { kind: 'literal', value: CABD },
        thickness: { kind: 'literal', value: Tc },
        thicknessFromMaterial: true, materialId: 'm', grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
      } as unknown as import('@zilventor/shared').Feature],
    };
    await opfs.write(path, await packProject({
      manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc },
      blobs: {},
    }));
  }
  const bottomDoc: Partial<PartDocument> = {
    id: 'B.zipt', name: 'B.zipt', units: 'mm', parameters: {},
    featureTree: [{
      kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: CABW - 2 * Tc },
      width: { kind: 'literal', value: CABD },
      thickness: { kind: 'literal', value: Tc },
      thicknessFromMaterial: true, materialId: 'm', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    } as unknown as import('@zilventor/shared').Feature],
  };
  await opfs.write('B.zipt', await packProject({
    manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: bottomDoc },
    blobs: {},
  }));
  const cabinet: AssemblyDocument = {
    id: 'A_CAB', name: 'Cab', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'C1', partPath: 'L.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
      { id: 'C2', partPath: 'R.zipt', position: { x: CABW - Tc, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
      { id: 'C3', partPath: 'B.zipt', position: { x: Tc, y: 0, z: TOEKICK_H }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom' },
    ],
    constraints: [], groundedComponentPaths: [['C1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  const cabinetPath = 'Cab.ziasm';
  await opfs.write(cabinetPath, await packAssembly(cabinet, new Uint8Array()));
  const top: AssemblyDocument = {
    id: 'A_TOP', name: 'Room', units: 'mm', parameters: {}, properties: {},
    components: [{ id: 'TOP1', partPath: cabinetPath, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
    constraints: [], groundedComponentPaths: [['TOP1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: top });
  useAppStore.getState().setSubAssemblyDocs({ [cabinetPath]: cabinet });
  return cabinetPath;
}

describe('AddDrawerBankCommand — slideSystem=tandem (M4-C)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('tandem: cabinet side panels get tandem-cabinet bores (> 0 on each side)', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 2, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    }).apply();

    const leftBores = await boresOf(opfs, 'L.zipt');
    const rightBores = await boresOf(opfs, 'R.zipt');
    expect(leftBores.filter((b) => b.role === 'tandem-cabinet').length).toBeGreaterThan(0);
    expect(rightBores.filter((b) => b.role === 'tandem-cabinet').length).toBeGreaterThan(0);
  });

  it('tandem: drawer-box bottom panel gets tandem-drawer-bottom bores', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 1, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    }).apply();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const boxComps = cab.components.filter((c) => c.role === 'drawerBox');
    expect(boxComps).toHaveLength(1);

    // Unpack the box .ziasm to find the bottom panel
    const boxDoc = await unpackAssembly(await opfs.read(boxComps[0]!.partPath));
    const bottomComp = boxDoc.components.find((c) => c.role === 'drawerBox-bottom')!;
    expect(bottomComp).toBeDefined();

    const bottomBores = await boresOf(opfs, bottomComp.partPath);
    expect(bottomBores.filter((b) => b.role === 'tandem-drawer-bottom').length).toBeGreaterThan(0);
  });

  it('tandem: drawer-box back panel gets tandem-drawer-back bores', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 1, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    }).apply();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const boxComps = cab.components.filter((c) => c.role === 'drawerBox');
    const boxDoc = await unpackAssembly(await opfs.read(boxComps[0]!.partPath));
    const backComp = boxDoc.components.find((c) => c.role === 'drawerBox-back')!;
    expect(backComp).toBeDefined();

    const backBores = await boresOf(opfs, backComp.partPath);
    expect(backBores.filter((b) => b.role === 'tandem-drawer-back').length).toBeGreaterThan(0);
  });

  it('tandem: drawerSlides BOM row references the TANDEM SKU', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const N = 2;
    await new AddDrawerBankCommand({
      cabinetPath,
      params: { count: N, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    }).apply();

    const hwPath = `hardware/${DEFAULT_TANDEM_SLIDE_SKU}.zipt`;
    expect(await opfs.exists(hwPath)).toBe(true);

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const cache = new Map<string, { kind: 'part'; document: { featureTree: unknown[] } }>();
    const proj = await unpackProject(await opfs.read(hwPath));
    const hwDoc = (proj.manifest as { document: { featureTree: unknown[] } }).document;
    cache.set(hwPath, { kind: 'part', document: hwDoc });

    const { rows } = aggregateHardwareRecursive(cab, cache as never, BUILTIN_CATALOG);
    const slideRow = rows.find((r) => r.skuId === DEFAULT_TANDEM_SLIDE_SKU);
    expect(slideRow, 'expected a drawerSlides BOM row for tandem SKU').toBeDefined();
    expect(slideRow!.qty).toBe(N);
  });

  it('tandem revert: removes tandem-cabinet bores and restores cabinet side panels', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const cmd = new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 2, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    });
    await cmd.apply();
    expect((await boresOf(opfs, 'L.zipt')).filter((b) => b.role === 'tandem-cabinet').length).toBeGreaterThan(0);

    await cmd.revert();
    expect((await boresOf(opfs, 'L.zipt')).filter((b) => b.role === 'tandem-cabinet')).toHaveLength(0);
    expect((await boresOf(opfs, 'R.zipt')).filter((b) => b.role === 'tandem-cabinet')).toHaveLength(0);

    const afterRevert = await unpackAssembly(await opfs.read(cabinetPath));
    expect(afterRevert.components.filter((c) => c.role === 'drawerBox')).toHaveLength(0);
  });

  it('side-mount default: slideSystem omitted → no tandem-cabinet bores (byte-identical path)', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 2, overlay: 'full', thickness: 18 }, // slideSystem omitted
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    }).apply();

    const leftBores = await boresOf(opfs, 'L.zipt');
    expect(leftBores.filter((b) => b.role === 'tandem-cabinet')).toHaveLength(0);
    expect(leftBores.filter((b) => b.role === 'drawerSlide-cabinet').length).toBeGreaterThan(0);
  });
});
