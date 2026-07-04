// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AddDoorCommand } from '../AddDoorCommand';
import { useAppStore } from '../../store/useAppStore';
import { unpackProject, packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, DoorMathInput, MachiningPresetValues, PartDocument } from '@zilventor/shared';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async exists(p: string) { return this.files.has(p); }
  async delete(p: string) { this.files.delete(p); }
}

/** Minimal in-memory kernel mock: tracks registered/deleted part ids. */
function makeKernel() {
  const registered = new Set<string>();
  return {
    registered,
    async registerPart(part: PartDocument) {
      if (registered.has(part.id)) throw new Error(`already registered ${part.id}`);
      registered.add(part.id);
    },
    async deletePart(partId: string) { registered.delete(partId); },
  };
}

const Tc = 18;
const CABW = 600, CABD = 560, CABH = 720, TOEKICK_H = 100;

/** Cabinet .ziasm with the two side panels (the ones that carry hinge plates). */
async function seedCabinet(opfs: MemOpfs): Promise<string> {
  // Side panel .zipt files — native dims {length:H, width:D, thickness:Tc}.
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
  // Bottom panel .zipt — its position.z tells AddDoorCommand the toekick height.
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
  // Active top-level assembly holds a wrapper pointing at the cabinet (matches real structure).
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

/**
 * NOTE: `params.cabinet` here passes ZEROS for width/height/depth/Tc/toekickHeight.
 * AddDoorCommand.apply() MUST derive these from the unpacked .ziasm before calling doorMath.
 * This is load-bearing: passing zeros should FAIL (doorMath returns negative door dims) unless
 * the command overrides them from real panel dims. If this test passes with zeros persisting
 * into doorMath, it is a false-green — the assertion on doorBores.length > 0 would fail first.
 */
const SINGLE_DOOR_ZERO_DIMS: DoorMathInput = {
  cabinet: { width: 0, height: 0, depth: 0, Tc: 0, toekickHeight: 0 }, // INTENTIONALLY ZERO
  count: 'single', overlay: 'full', hingeSide: 'left',
  thickness: 18, reveal: 2, clearance: 2, centerReveal: 3,
};

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

// ── Task 1: apply happy path (dims derivation + door part + component push) ──

describe('AddDoorCommand — apply (cabinet dims derivation + door part + component)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('derives cabinet dims from the .ziasm side-panel PanelFeature and passes positive values to doorMath', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    // Command is constructed with zero dims — apply() must override from the unpacked assembly.
    const cmd = new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel });
    await cmd.apply();

    // Cabinet .ziasm now has one extra role:door component carrying doorSpec.
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const doors = cab.components.filter((c) => c.role === 'door');
    expect(doors.length).toBe(1);
    expect(doors[0]!.doorSpec).toBeDefined();
    expect(doors[0]!.doorSpec!.hingeSide).toBe('left');

    // The referenced door .zipt exists, was registered, and carries Ø35 cup bores.
    const doorPath = doors[0]!.partPath;
    expect(await opfs.exists(doorPath)).toBe(true);
    const doorBores = await boresOf(opfs, doorPath);
    // If doorMath received zero dims it would return a zero/negative-size door with no valid bores,
    // so a non-zero bores array proves cabinet dims were correctly derived (strictly positive).
    expect(doorBores.length).toBeGreaterThan(0);
    expect(doorBores.every((b) => b.connectorKind === 'hinge')).toBe(true);
    expect(doorBores.some((b) => b.role === 'hingeCup' && b.diameter === 35)).toBe(true);
    expect(kernel.registered.size).toBe(1);
  });

  it('throws if derived cabinet dims are not all strictly positive', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    // Seed a cabinet with NO side panels — dims derivation should fail the positive assertion.
    const emptyCab: AssemblyDocument = {
      id: 'A_EMPTY', name: 'Empty', units: 'mm', parameters: {}, properties: {},
      components: [], constraints: [], groundedComponentPaths: [],
      colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    const cabPath = 'Empty.ziasm';
    await opfs.write(cabPath, await packAssembly(emptyCab, new Uint8Array()));
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyCab });
    useAppStore.getState().setSubAssemblyDocs({ [cabPath]: emptyCab });

    const cmd = new AddDoorCommand({ cabinetPath: cabPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel });
    await expect(cmd.apply()).rejects.toThrow(/dims.*positive|positive.*dims|cabinet.*dims|width.*height|leftSide/i);
  });
});

// ── Task 2: plate bores into side panels + boreCacheInvalidator ──

describe('AddDoorCommand — apply (plate bores + cache invalidation)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('writes Ø5 hinge-plate bores onto the hinge-side panel and invalidates its cache', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    // hingeSide:'left' → plates land on the leftSide panel (L.zipt).
    // params.cabinet is zeros — command derives dims from .ziasm (same addendum §4 path).
    await new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel }).apply();

    const lBores = await boresOf(opfs, 'L.zipt');
    const plates = lBores.filter((b) => b.role === 'hingePlate');
    expect(plates.length).toBeGreaterThan(0);
    expect(plates.every((b) => b.connectorKind === 'hinge' && b.diameter === 5)).toBe(true);

    // Cup connectorIds (door part) and plate connectorIds (side panel) must share ids per hinge.
    const doorComps = (await unpackAssembly(await opfs.read(cabinetPath))).components.filter((c) => c.role === 'door');
    const cupConn = new Set((await boresOf(opfs, doorComps[0]!.partPath)).map((b) => b.connectorId));
    const plateConn = new Set(plates.map((b) => b.connectorId));
    expect([...plateConn].every((id) => cupConn.has(id))).toBe(true);

    // The side panel path was passed to the cache invalidator.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain('L.zipt');

    // The opposite side (R.zipt) receives no plate bores for a left-hinged single door.
    expect((await boresOf(opfs, 'R.zipt')).filter((b) => b.role === 'hingePlate').length).toBe(0);
  });
});

// ── Task 3: Revert — restore side bores + remove component + delete door part ──

describe('AddDoorCommand — revert', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('removes the door component, deletes the door .zipt, and restores side bores to baseline', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    // Baseline: side panel has no bores; cabinet has no door.
    const baselineL = await boresOf(opfs, 'L.zipt');
    expect(baselineL.length).toBe(0);

    // params.cabinet is zeros — command derives dims from .ziasm (addendum §4 path).
    const cmd = new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel });
    await cmd.apply();

    const afterApply = await unpackAssembly(await opfs.read(cabinetPath));
    const door = afterApply.components.find((c) => c.role === 'door')!;
    const doorPath = door.partPath;
    expect(await opfs.exists(doorPath)).toBe(true);
    expect((await boresOf(opfs, 'L.zipt')).length).toBeGreaterThan(0);
    expect(kernel.registered.size).toBe(1);

    await cmd.revert();

    // Door component gone.
    const afterRevert = await unpackAssembly(await opfs.read(cabinetPath));
    expect(afterRevert.components.some((c) => c.role === 'door')).toBe(false);
    // Door .zipt deleted + de-registered.
    expect(await opfs.exists(doorPath)).toBe(false);
    expect(kernel.registered.size).toBe(0);
    // Side bores back to baseline (bores key absent since it had none before).
    const project = await unpackProject(await opfs.read('L.zipt'));
    const sdoc = (project.manifest as { document: Record<string, unknown> }).document;
    expect('bores' in sdoc).toBe(false);
    // subAssemblyDocs entry refreshed (no door).
    const mirrored = useAppStore.getState().subAssemblyDocs[cabinetPath]!;
    expect(mirrored.components.some((c) => c.role === 'door')).toBe(false);
  });
});

// ── Task 4: Round-trip + undo/redo locking tests ──

/** Count of bore markers that would render = door cup bores + side plate bores. */
async function totalBoreMarkers(opfs: MemOpfs, cabinetPath: string): Promise<number> {
  const cab = await unpackAssembly(await opfs.read(cabinetPath));
  let total = 0;
  for (const c of cab.components) {
    if (!c.partPath.endsWith('.zipt')) continue;
    total += (await boresOf(opfs, c.partPath)).length;
  }
  return total;
}

describe('AddDoorCommand — round-trip + undo/redo (locking)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('LOCKING: door + bores persist across a fresh byte-OPFS reload of the .ziasm', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    // params.cabinet is zeros — command derives dims from .ziasm (addendum §4).
    await new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel }).apply();

    // Re-read straight from the persisted bytes (simulates app reload — no in-memory state reused).
    const reloaded = await unpackAssembly(await opfs.read(cabinetPath));
    const door = reloaded.components.find((c) => c.role === 'door');
    expect(door, 'door survives reload').toBeDefined();
    expect(door!.doorSpec, 'doorSpec survives reload').toBeDefined();
    // Door part .zipt readable + carries cup bores after reload.
    expect((await boresOf(opfs, door!.partPath)).length).toBeGreaterThan(0);
  });

  it('LOCKING: undo returns total bore-marker count to baseline AND removes the door .zipt', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const baseline = await totalBoreMarkers(opfs, cabinetPath);
    expect(baseline).toBe(0);

    // params.cabinet is zeros — command derives dims from .ziasm (addendum §4).
    const cmd = new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel });
    await cmd.apply();
    const afterApply = await totalBoreMarkers(opfs, cabinetPath);
    expect(afterApply).toBeGreaterThan(0);
    const doorPath = (await unpackAssembly(await opfs.read(cabinetPath)))
      .components.find((c) => c.role === 'door')!.partPath;

    await cmd.revert();
    expect(await totalBoreMarkers(opfs, cabinetPath)).toBe(baseline);
    expect(await opfs.exists(doorPath)).toBe(false);
  });

  it('LOCKING: redo (apply→revert→apply) restores the door + bores without double-registering', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    // params.cabinet is zeros — command derives dims from .ziasm (addendum §4).
    const cmd = new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel });
    await cmd.apply();
    const afterFirst = await totalBoreMarkers(opfs, cabinetPath);

    await cmd.revert();
    await cmd.apply(); // redo

    const afterRedo = await totalBoreMarkers(opfs, cabinetPath);
    expect(afterRedo).toBe(afterFirst);
    const doors = (await unpackAssembly(await opfs.read(cabinetPath))).components.filter((c) => c.role === 'door');
    expect(doors.length, 'exactly one door after redo — no duplicate component').toBe(1);
    expect(kernel.registered.size, 'exactly one registered door part after redo').toBe(1);
  });
});

// ── P15: machining-preset snapshot onto hinge-cup / hinge-plate bores ──

const CUP_PRESET: MachiningPresetValues = { diameter: 40, depth: 14, layerName: 'CUP-CAM', toolNumber: 3, speed: 12000 };
const PLATE_PRESET: MachiningPresetValues = { diameter: 6, depth: 15, layerName: 'PLATE-CAM' };

describe('AddDoorCommand — machining-preset snapshot (P15)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('cupPresetValues snapshots diameter/depth/layerName/toolNumber/speed onto every hinge-cup bore', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const cmd = new AddDoorCommand({
      cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel,
      cupPresetValues: CUP_PRESET,
    });
    await cmd.apply();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const door = cab.components.find((c) => c.role === 'door')!;
    const cupBores = (await boresOf(opfs, door.partPath)).filter((b) => b.role === 'hingeCup');
    expect(cupBores.length).toBeGreaterThan(0);
    for (const b of cupBores) {
      expect(b.diameter).toBe(CUP_PRESET.diameter);
      expect(b.depth).toBe(CUP_PRESET.depth);
      expect(b.presetLayerName).toBe(CUP_PRESET.layerName);
      expect(b.toolNumber).toBe(CUP_PRESET.toolNumber);
      expect(b.speed).toBe(CUP_PRESET.speed);
    }

    // Plate bores on the side panel must be UNAFFECTED by a cup-only preset.
    const plates = (await boresOf(opfs, 'L.zipt')).filter((b) => b.role === 'hingePlate');
    expect(plates.length).toBeGreaterThan(0);
    for (const b of plates) {
      expect(b.diameter).toBe(5);
      expect(b.presetLayerName).toBeUndefined();
    }
  });

  it('platePresetValues snapshots diameter/depth/layerName onto every hinge-plate bore on the hinge-side panel', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const cmd = new AddDoorCommand({
      cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel,
      platePresetValues: PLATE_PRESET,
    });
    await cmd.apply();

    const plates = (await boresOf(opfs, 'L.zipt')).filter((b) => b.role === 'hingePlate');
    expect(plates.length).toBeGreaterThan(0);
    for (const b of plates) {
      expect(b.diameter).toBe(PLATE_PRESET.diameter);
      expect(b.depth).toBe(PLATE_PRESET.depth);
      expect(b.presetLayerName).toBe(PLATE_PRESET.layerName);
      expect(b.toolNumber).toBeUndefined();
      expect(b.speed).toBeUndefined();
    }

    // Cup bores on the door must be UNAFFECTED by a plate-only preset.
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const door = cab.components.find((c) => c.role === 'door')!;
    const cupBores = (await boresOf(opfs, door.partPath)).filter((b) => b.role === 'hingeCup');
    expect(cupBores.length).toBeGreaterThan(0);
    for (const b of cupBores) {
      expect(b.diameter).toBe(35);
      expect(b.presetLayerName).toBeUndefined();
    }
  });

  it('no preset supplied → cup and plate bores are byte-identical to pre-P15 default behavior', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    await new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel }).apply();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const door = cab.components.find((c) => c.role === 'door')!;
    const cupBores = await boresOf(opfs, door.partPath);
    const plateBores = (await boresOf(opfs, 'L.zipt')).filter((b) => b.role === 'hingePlate');

    for (const b of cupBores) {
      expect(b.diameter).toBe(35);
      expect(b.depth).toBe(12);
      expect(b.presetLayerName).toBeUndefined();
      expect(b.toolNumber).toBeUndefined();
      expect(b.speed).toBeUndefined();
    }
    for (const b of plateBores) {
      expect(b.diameter).toBe(5);
      expect(b.depth).toBe(13);
      expect(b.presetLayerName).toBeUndefined();
      expect(b.toolNumber).toBeUndefined();
      expect(b.speed).toBeUndefined();
    }
  });
});

// ── SKU stamping: hinge-35mm-cup-<overlay> onto cup + plate bores ──

describe('AddDoorCommand — SKU stamping (hinge-35mm-cup-<overlay>)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('stamps sku=hinge-35mm-cup-full onto every cup and plate bore for overlay=full', async () => {
    // SINGLE_DOOR_ZERO_DIMS uses overlay:'full' — must resolve to the BUILTIN_CATALOG entry.
    expect(BUILTIN_CATALOG.some((e) => e.id === 'hinge-35mm-cup-full')).toBe(true);

    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    await new AddDoorCommand({ cabinetPath, params: SINGLE_DOOR_ZERO_DIMS, opfs, kernel }).apply();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const door = cab.components.find((c) => c.role === 'door')!;
    const cupBores = (await boresOf(opfs, door.partPath)).filter((b) => b.role === 'hingeCup');
    expect(cupBores.length).toBeGreaterThan(0);
    for (const b of cupBores) expect(b.sku).toBe('hinge-35mm-cup-full');

    const plateBores = (await boresOf(opfs, 'L.zipt')).filter((b) => b.role === 'hingePlate');
    expect(plateBores.length).toBeGreaterThan(0);
    for (const b of plateBores) expect(b.sku).toBe('hinge-35mm-cup-full');
  });
});
