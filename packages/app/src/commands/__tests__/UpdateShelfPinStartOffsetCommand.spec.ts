// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GenerateShelfPinBoresCommand } from '../GenerateShelfPinBoresCommand';
import { UpdateShelfPinStartOffsetCommand } from '../UpdateShelfPinStartOffsetCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION, DEFAULT_SHELF_PIN_PARAMS } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PanelRole, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
}

const W = 600, D = 560, H = 720, Tc = 18, Tb = 6;
const CAB = 'Base Cabinet 1';
const LP = `${CAB} - Left.zipt`;
const RP = `${CAB} - Right.zipt`;
const BP = `${CAB} - Bottom.zipt`;
const TP = `${CAB} - Top.zipt`;
const ZIASM = `${CAB}.ziasm`;

async function writePanel(opfs: MemOpfs, path: string, length: number, width: number, thickness: number) {
  const doc: Partial<PartDocument> = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree: [{
      kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: length },
      width: { kind: 'literal', value: width },
      thickness: { kind: 'literal', value: thickness },
      thicknessFromMaterial: true, materialId: 'm', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    } as unknown as import('@zilventor/shared').Feature],
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

async function seed(opfs: MemOpfs): Promise<void> {
  await writePanel(opfs, LP, H, D, Tc);
  await writePanel(opfs, RP, H, D, Tc);
  await writePanel(opfs, BP, W - 2 * Tc, D - Tb, Tc);
  await writePanel(opfs, TP, W - 2 * Tc, D - Tb, Tc);
  const cabinetDoc: AssemblyDocument = {
    id: 'A_CAB', name: CAB, units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'C1', partPath: LP, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' as PanelRole },
      { id: 'C2', partPath: RP, position: { x: W - Tc, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' as PanelRole },
      { id: 'C3', partPath: BP, position: { x: Tc, y: Tb, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom' as PanelRole },
      { id: 'C4', partPath: TP, position: { x: Tc, y: Tb, z: H - Tc }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'top' as PanelRole },
    ],
    constraints: [], groundedComponentPaths: [['C1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [], hardware: [],
  };
  await opfs.write(ZIASM, await packAssembly(cabinetDoc, new Uint8Array()));
  const topDoc: AssemblyDocument = {
    id: 'A_TOP', name: 'Room', units: 'mm', parameters: {}, properties: {},
    components: [{ id: 'TOP1', partPath: ZIASM, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
    constraints: [], groundedComponentPaths: [['TOP1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [], hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: topDoc });
}

const frontUs = (bores: BoreOp[]) =>
  bores.filter((b) => b.connectorId === 'pin-col-front').map((b) => b.u).sort((a, b) => a - b);

describe('UpdateShelfPinStartOffsetCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('re-anchors the first hole at bottomMargin+startOffset while preserving custom pitch', async () => {
    const opfs = new MemOpfs();
    await seed(opfs);
    const custom = { ...DEFAULT_SHELF_PIN_PARAMS, pitch: 40 };
    await new GenerateShelfPinBoresCommand({ params: custom, opfs }).apply();
    const before = frontUs(await boresOf(opfs, LP)); // centered ladder (lead 16 → first 80)

    await new UpdateShelfPinStartOffsetCommand({ params: { ...custom, startOffset: 48 }, opfs }).apply();

    const after = frontUs(await boresOf(opfs, LP));
    expect(after[0]).toBeCloseTo(custom.bottomMargin + 48, 9); // anchored: 64 + 48 = 112
    expect(after[0]).not.toBeCloseTo(before[0] ?? 0, 6);       // distinct from the centered layout
    expect((after[1] ?? 0) - (after[0] ?? 0)).toBeCloseTo(40, 9); // custom pitch preserved
  });

  it('is undoable — revert restores the pre-offset bores', async () => {
    const opfs = new MemOpfs();
    await seed(opfs);
    await new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs }).apply();
    const before = await boresOf(opfs, LP);

    const cmd = new UpdateShelfPinStartOffsetCommand({
      params: { ...DEFAULT_SHELF_PIN_PARAMS, startOffset: 16 }, opfs,
    });
    await cmd.apply();
    expect(frontUs(await boresOf(opfs, LP))[0]).toBeCloseTo(DEFAULT_SHELF_PIN_PARAMS.bottomMargin + 16, 9);

    await cmd.revert();
    expect(await boresOf(opfs, LP)).toEqual(before);
  });
});
