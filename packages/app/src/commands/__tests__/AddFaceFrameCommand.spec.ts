// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { AddFaceFrameCommand } from '../AddFaceFrameCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string): Promise<Uint8Array> { const b = this.files.get(p); if (!b) throw new Error(`no file ${p}`); return b; }
  async write(p: string, b: Uint8Array): Promise<void> { this.files.set(p, b); }
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async delete(p: string): Promise<void> { this.files.delete(p); }
}
function makeKernel() {
  const registered = new Set<string>();
  return { registered, async registerPart(p: PartDocument) { registered.add(p.id); }, async deletePart(id: string) { registered.delete(id); } };
}

// Minimal side/bottom panel parts so deriveCabinetDims succeeds (W=600,H=720,D=560,Tc=18,tkH=100).
function panelPart(id: string, length: number, width: number, thickness: number): PartDocument {
  return { id, name: id, units: 'mm', parameters: {},
    featureTree: [{ kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: length }, width: { kind: 'literal', value: width },
      thickness: { kind: 'literal', value: thickness }, thicknessFromMaterial: false,
      materialId: 'm', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null } }],
    properties: {}, materials: [{ id: 'm', name: 'MDF', defaultThickness: 18, color: '#ccc' }], hardware: [] } as unknown as PartDocument;
}

async function seedCabinet(opfs: MemOpfs): Promise<string> {
  const cabinetPath = 'proj/cab1.ziasm';
  const leftPath = 'proj/cab-left.zipt';
  const rightPath = 'proj/cab-right.zipt';
  const bottomPath = 'proj/cab-bottom.zipt';
  const part = (id: string, l: number, w: number, t: number) =>
    packProject({ manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part', document: panelPart(id, l, w, t) }, blobs: {} });
  await opfs.write(leftPath, await part('left', 720, 560, 18));   // length=H, width=D, thickness=Tc
  await opfs.write(rightPath, await part('right', 720, 560, 18));
  await opfs.write(bottomPath, await part('bottom', 564, 560, 18));
  const cabinet: AssemblyDocument = {
    id: 'cab1', name: 'cab1', components: [
      { id: 'L', partPath: leftPath, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
      { id: 'R', partPath: rightPath, position: { x: 582, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
      { id: 'B', partPath: bottomPath, position: { x: 0, y: 0, z: 100 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom' },
    ],
    constraints: [], groundedComponentPaths: [['C1']], colors: {}, bomItemNumbers: {},
    cutListItemNumbers: {}, colorOverrides: {}, materials: [{ id: 'm', name: 'MDF', defaultThickness: 18, color: '#ccc' }], hardware: [],
  } as unknown as AssemblyDocument;
  await opfs.write(cabinetPath, await packAssembly(cabinet, new Uint8Array()));
  useAppStore.getState().setSubAssemblyDocs({ [cabinetPath]: cabinet });
  return cabinetPath;
}

describe('AddFaceFrameCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
  });

  it('apply adds cols+1 stiles + cols·(rows+1) rails; revert removes them', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const cmd = new AddFaceFrameCommand({
      cabinetPath,
      params: { rows: 2, cols: 2, stileWidth: 38, railWidth: 38, thickness: 19 },
      opfs, kernel, store: useAppStore,
    });

    await cmd.apply();
    let cab = await unpackAssembly(await opfs.read(cabinetPath));
    const stiles = cab.components.filter((c) => c.role === 'faceFrameStile');
    const rails = cab.components.filter((c) => c.role === 'faceFrameRail');
    expect(stiles).toHaveLength(3);          // cols+1
    expect(rails).toHaveLength(6);           // cols·(rows+1)
    expect(stiles[0]!.pose).toBeTruthy();
    expect(stiles[0]!.role).toBe('faceFrameStile');
    expect(kernel.registered.size).toBe(9);  // all members registered

    await cmd.revert();
    cab = await unpackAssembly(await opfs.read(cabinetPath));
    expect(cab.components.filter((c) => c.role === 'faceFrameStile')).toHaveLength(0);
    expect(cab.components.filter((c) => c.role === 'faceFrameRail')).toHaveLength(0);
    expect(kernel.registered.size).toBe(0);
  });

  it('surfaces the degenerate-opening error without writing partial state', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const before = (await unpackAssembly(await opfs.read(cabinetPath))).components.length;
    const cmd = new AddFaceFrameCommand({
      cabinetPath, params: { rows: 1, cols: 40, stileWidth: 38, railWidth: 38, thickness: 19 },
      opfs, store: useAppStore,
    });
    await expect(cmd.apply()).rejects.toThrow(/opening collapses/);
    const after = (await unpackAssembly(await opfs.read(cabinetPath))).components.length;
    expect(after).toBe(before); // no partial writes
  });
});
