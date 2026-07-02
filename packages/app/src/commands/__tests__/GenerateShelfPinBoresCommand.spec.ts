// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GenerateShelfPinBoresCommand } from '../GenerateShelfPinBoresCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION, DEFAULT_SHELF_PIN_PARAMS } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PanelRole, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async exists(p: string) { return this.files.has(p); }
}

/** Write a minimal panel .zipt using the REAL baseCabinet dim convention
 *  (length = HEIGHT for side panels; thickness = board thickness). */
async function writePanel(
  opfs: MemOpfs, path: string,
  length: number, width: number, thickness: number,
  bores?: BoreOp[],
) {
  const doc: Partial<PartDocument> = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree: [{
      kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: length },
      width: { kind: 'literal', value: width },
      thickness: { kind: 'literal', value: thickness },
      thicknessFromMaterial: true,
      materialId: 'm', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    } as unknown as import('@zilventor/shared').Feature],
    ...(bores ? { bores } : {}),
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

const W = 600, D = 560, H = 720, Tc = 18, Tb = 6;
const CAB = 'Base Cabinet 1';
const LP = `${CAB} - Left.zipt`;
const RP = `${CAB} - Right.zipt`;
const BP = `${CAB} - Bottom.zipt`;
const TP = `${CAB} - Top.zipt`;
const ZIASM = `${CAB}.ziasm`;

/** REAL nested cabinet structure: top-level role-less wrapper → .ziasm with 4 panels. */
async function buildNestedStructure(opfs: MemOpfs): Promise<void> {
  await writePanel(opfs, LP, H,        D,      Tc);  // leftSide
  await writePanel(opfs, RP, H,        D,      Tc);  // rightSide
  await writePanel(opfs, BP, W - 2*Tc, D - Tb, Tc);  // bottom
  await writePanel(opfs, TP, W - 2*Tc, D - Tb, Tc);  // top

  const cabinetDoc: AssemblyDocument = {
    id: 'A_CAB', name: CAB, units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'C1', partPath: LP, position: { x: 0,      y: 0,  z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide'  as PanelRole },
      { id: 'C2', partPath: RP, position: { x: W - Tc, y: 0,  z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' as PanelRole },
      { id: 'C3', partPath: BP, position: { x: Tc,     y: Tb, z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom'    as PanelRole },
      { id: 'C4', partPath: TP, position: { x: Tc,     y: Tb, z: H - Tc }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'top'       as PanelRole },
    ],
    constraints: [], groundedComponentPaths: [['C1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  await opfs.write(ZIASM, await packAssembly(cabinetDoc, new Uint8Array()));

  const topDoc: AssemblyDocument = {
    id: 'A_TOP', name: 'Room', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'TOP1', partPath: ZIASM, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [], groundedComponentPaths: [['TOP1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: topDoc });
}

describe('GenerateShelfPinBoresCommand — auto recurse', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('drills shelfPin bores into BOTH side panels, none into bottom/top', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);

    await new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs }).apply();

    const lBores = await boresOf(opfs, LP);
    const rBores = await boresOf(opfs, RP);
    expect(lBores.length).toBeGreaterThan(0);
    expect(rBores.length).toBeGreaterThan(0);
    // Only side panels are drilled; horizontal panels stay empty.
    expect((await boresOf(opfs, BP)).length).toBe(0);
    expect((await boresOf(opfs, TP)).length).toBe(0);
    // Every emitted bore is a система-32 shelf pin (blind, Ø5).
    for (const b of [...lBores, ...rBores]) {
      expect(b.connectorKind).toBe('shelfPin');
      expect(b.role).toBe('shelfPin-system32');
      expect(b.diameter).toBe(DEFAULT_SHELF_PIN_PARAMS.diameter);
      expect(b.depth).toBe(DEFAULT_SHELF_PIN_PARAMS.depth); // number, NOT 'throughAll'
      // Authored on a BROAD inner face (Top/Bottom), never a narrow end face.
      expect(['Top', 'Bottom']).toContain(b.face.role);
    }
    // Left and right mirror each other in count.
    expect(lBores.length).toBe(rBores.length);
  });

  it('bores land in-bounds for the UNSWAPPED native side dims (u∈[0,H], v∈[0,D])', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    await new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs }).apply();

    for (const b of await boresOf(opfs, LP)) {
      expect(b.u).toBeGreaterThanOrEqual(0);
      expect(b.u).toBeLessThanOrEqual(H);   // u runs along native length = HEIGHT
      expect(b.v).toBeGreaterThanOrEqual(0);
      expect(b.v).toBeLessThanOrEqual(D);   // v runs along native width = DEPTH
    }
  });

  it('apply() then revert() restores the side panels to having no bores', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    const cmd = new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs });
    await cmd.apply();
    expect((await boresOf(opfs, LP)).length).toBeGreaterThan(0);

    await cmd.revert();

    // bores key must be ABSENT (not []) on each side panel — exactOptionalPropertyTypes contract.
    for (const path of [LP, RP]) {
      const project = await unpackProject(await opfs.read(path));
      const doc = (project.manifest as { document: Record<string, unknown> }).document;
      expect('bores' in doc, `${path}: bores key must be absent after revert`).toBe(false);
    }
  });

  it('revert() restores PRIOR bores when a side panel already had some', async () => {
    const opfs = new MemOpfs();
    const seedBore: BoreOp = {
      id: 'pre', face: { featureId: 'panel', role: 'Front', instance: 0 },
      u: 10, v: 10, diameter: 5, depth: 12,
      role: 'dowel-face', connectorId: 'pre-conn', connectorKind: 'dowel',
    };
    // Rebuild structure but seed the left panel with a pre-existing bore.
    await writePanel(opfs, LP, H,        D,      Tc, [seedBore]);
    await writePanel(opfs, RP, H,        D,      Tc);
    await writePanel(opfs, BP, W - 2*Tc, D - Tb, Tc);
    await writePanel(opfs, TP, W - 2*Tc, D - Tb, Tc);
    const cabinetDoc: AssemblyDocument = {
      id: 'A_CAB', name: CAB, units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: LP, position: { x: 0,      y: 0,  z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide'  as PanelRole },
        { id: 'C2', partPath: RP, position: { x: W - Tc, y: 0,  z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' as PanelRole },
        { id: 'C3', partPath: BP, position: { x: Tc,     y: Tb, z: 0      }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom'    as PanelRole },
        { id: 'C4', partPath: TP, position: { x: Tc,     y: Tb, z: H - Tc }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'top'       as PanelRole },
      ],
      constraints: [], groundedComponentPaths: [['C1']], colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    await opfs.write(ZIASM, await packAssembly(cabinetDoc, new Uint8Array()));
    const topDoc: AssemblyDocument = {
      id: 'A_TOP', name: 'Room', units: 'mm', parameters: {}, properties: {},
      components: [{ id: 'TOP1', partPath: ZIASM, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
      constraints: [], groundedComponentPaths: [['TOP1']], colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: topDoc });

    const cmd = new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs });
    await cmd.apply();
    expect((await boresOf(opfs, LP)).length).toBeGreaterThan(1);

    await cmd.revert();
    expect(await boresOf(opfs, LP)).toEqual([seedBore]);
  });
});

describe('GenerateShelfPinBoresCommand — presetValues snapshot (P9 W2a)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('overrides diameter/depth/presetLayerName/toolNumber/speed on every generated bore when presetValues is given', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    const presetValues = { diameter: 6, depth: 14, layerName: 'SHELF', toolNumber: 3, speed: 12000 };

    await new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, presetValues, opfs }).apply();

    for (const b of [...(await boresOf(opfs, LP)), ...(await boresOf(opfs, RP))]) {
      expect(b.diameter).toBe(6);
      expect(b.depth).toBe(14);
      expect(b.presetLayerName).toBe('SHELF');
      expect(b.toolNumber).toBe(3);
      expect(b.speed).toBe(12000);
    }
  });

  it('a later mutation of the source presetValues object never changes already-created bores (snapshot, not a live reference)', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    const presetValues = { diameter: 6, depth: 14, layerName: 'SHELF' };

    await new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, presetValues, opfs }).apply();
    presetValues.diameter = 999;
    presetValues.layerName = 'MUTATED';

    for (const b of await boresOf(opfs, LP)) {
      expect(b.diameter).toBe(6);
      expect(b.presetLayerName).toBe('SHELF');
    }
  });

  it('without presetValues, behavior is unchanged (no presetLayerName/toolNumber/speed on generated bores)', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);

    await new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs }).apply();

    for (const b of await boresOf(opfs, LP)) {
      expect('presetLayerName' in b).toBe(false);
      expect('toolNumber' in b).toBe(false);
      expect('speed' in b).toBe(false);
    }
  });
});

async function shelfPinParamsOf(opfs: MemOpfs, path: string) {
  const project = await unpackProject(await opfs.read(path));
  return (project.manifest as { document: { shelfPinParams?: unknown } }).document.shelfPinParams;
}

describe('GenerateShelfPinBoresCommand — persists the grid params (1a.4)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('writes the ShelfPinParams it used onto each drilled side panel doc', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    const params = { ...DEFAULT_SHELF_PIN_PARAMS, pitch: 40, startOffset: 16 };

    await new GenerateShelfPinBoresCommand({ params, opfs }).apply();

    expect(await shelfPinParamsOf(opfs, LP)).toEqual(params);
    expect(await shelfPinParamsOf(opfs, RP)).toEqual(params);
    // Horizontal panels are never drilled → never tagged.
    expect(await shelfPinParamsOf(opfs, BP)).toBeUndefined();
  });

  it('revert() removes shelfPinParams it added when none existed before', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    const cmd = new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs });
    await cmd.apply();
    expect(await shelfPinParamsOf(opfs, LP)).toBeDefined();

    await cmd.revert();

    for (const path of [LP, RP]) {
      const project = await unpackProject(await opfs.read(path));
      const doc = (project.manifest as { document: Record<string, unknown> }).document;
      expect('shelfPinParams' in doc, `${path}: shelfPinParams must be absent after revert`).toBe(false);
    }
  });
});

describe('GenerateShelfPinBoresCommand — boreCacheInvalidator', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('apply() invalidates the two side-panel paths', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    await new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs }).apply();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].sort()).toEqual([LP, RP].sort());
  });

  it('revert() invalidates the same paths', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    const cmd = new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs });
    await cmd.apply();

    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);
    await cmd.revert();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].sort()).toEqual([LP, RP].sort());
  });

  it('apply() does not throw when boreCacheInvalidator is null', async () => {
    const opfs = new MemOpfs();
    await buildNestedStructure(opfs);
    await expect(
      new GenerateShelfPinBoresCommand({ params: DEFAULT_SHELF_PIN_PARAMS, opfs }).apply(),
    ).resolves.not.toThrow();
  });
});
