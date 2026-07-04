// @vitest-environment node
/**
 * AddLegLevelersCommand — TDD spec (M4-B, Task 5).
 *
 * Tests:
 *   1. appends 4*(2R) legLeveler bores to the bottom panel (R=2 → 16 bores)
 *   2. throws legLeveler.error.noToekick when cabinet has no toekick; zero bores written
 *   3. throws legLeveler.error.tooFewLegs when legsPerRow < 2
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AddLegLevelersCommand } from '../AddLegLevelersCommand';
import { useAppStore } from '../../store/useAppStore';
import { unpackProject, packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PartDocument } from '@zilventor/shared';
import { face2DFrame } from '@zilventor/shared/src/bore';

// ─── In-memory OPFS (mirrors AddDrawerBankCommand.spec.ts) ───────────────────

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

// ─── Kernel mock ─────────────────────────────────────────────────────────────

function makeKernel() {
  const registered = new Set<string>();
  return {
    registered,
    async registerPart(part: PartDocument) { registered.add(part.id); },
    async deletePart(partId: string) { registered.delete(partId); },
  };
}

// ─── Cabinet geometry constants ───────────────────────────────────────────────

const Tc = 18;
const CABW = 600, CABD = 560, CABH = 720, TOEKICK_H = 100;

// ─── Read BoreOp[] from a packed .zipt in OPFS ───────────────────────────────

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

// ─── seedCabinet — includes toekick component for leg-leveler tests ───────────

/**
 * Seeds a valid cabinet .ziasm + L/R side + bottom .zipt into MemOpfs.
 * withToekick (default true): adds a role:'toekick' component so deriveCabinetDims
 *   yields toekickHeight=TOEKICK_H and toekickSetback=50.
 * withToekick:false: sets bottom.z=0 (toekickHeight=0) and omits the toekick
 *   component, causing AddLegLevelersCommand to throw legLeveler.error.noToekick.
 */
async function seedCabinet(opfs: MemOpfs, opts?: { withToekick?: boolean }): Promise<string> {
  const withToekick = opts?.withToekick ?? true;

  // Left + right side panel .zipt files — native dims {length:H, width:D, thickness:Tc}
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

  // Bottom panel .zipt — length = CABW - 2*Tc (inner width), width = CABD
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

  // bottom.position.z = TOEKICK_H when withToekick, else 0 so toekickHeight <= 0
  const bottomZ = withToekick ? TOEKICK_H : 0;

  const components: AssemblyDocument['components'] = [
    { id: 'C1', partPath: 'L.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
    { id: 'C2', partPath: 'R.zipt', position: { x: CABW - Tc, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
    { id: 'C3', partPath: 'B.zipt', position: { x: Tc, y: 0, z: bottomZ }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom' },
  ];

  if (withToekick) {
    // toekick at y = CABD - 50 - Tc → toekickSetback = D - Tc - y = 560 - 18 - 492 = 50
    // deriveCabinetDims only reads toekickComp.position.y; no .zipt file needed.
    components.push({
      id: 'C4',
      partPath: 'TK.zipt',
      position: { x: Tc, y: CABD - 50 - Tc, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
      role: 'toekick',
    });
  }

  const cabinet: AssemblyDocument = {
    id: 'A_CAB', name: 'Cab', units: 'mm', parameters: {}, properties: {},
    components,
    constraints: [], groundedComponentPaths: [['C1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  const cabinetPath = 'Cab.ziasm';
  await opfs.write(cabinetPath, await packAssembly(cabinet, new Uint8Array()));

  // Top wrapper (matches real app structure expected by deriveCabinetDims + store)
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

// ─── Tests ────────────────────────────────────────────────────────────────────

const R = 2; // 2 rows × R=2 per row = 4 positions × 4 bores each = 16 total

describe('AddLegLevelersCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('appends 4*(2R) legLeveler bores to the bottom panel', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const before = (await boresOf(opfs, 'B.zipt')).length;
    await new AddLegLevelersCommand({ cabinetPath, params: { legsPerRow: R }, opfs, kernel: makeKernel() }).execute();
    const after = await boresOf(opfs, 'B.zipt');
    expect(after.length - before).toBe(4 * (2 * R));
    expect(after.filter((b) => b.role === 'legLeveler')).toHaveLength(4 * (2 * R));
  });

  it('throws noToekick when cabinet has no toekick; zero bores written', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs, { withToekick: false });
    await expect(
      new AddLegLevelersCommand({ cabinetPath, params: { legsPerRow: R }, opfs, kernel: makeKernel() }).execute(),
    ).rejects.toThrow('legLeveler.error.noToekick');
    expect(await boresOf(opfs, 'B.zipt')).toHaveLength(0); // no write happened
  });

  it('throws tooFewLegs when legsPerRow < 2', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await expect(
      new AddLegLevelersCommand({ cabinetPath, params: { legsPerRow: 1 }, opfs, kernel: makeKernel() }).execute(),
    ).rejects.toThrow('legLeveler.error.tooFewLegs');
  });

  it('throws noSpec when skuId has no legLeveler spec; zero bores written', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await expect(
      new AddLegLevelersCommand({
        cabinetPath,
        params: { legsPerRow: R, skuId: 'hinge-35mm-cup-full' },
        opfs,
        kernel: makeKernel(),
      }).execute(),
    ).rejects.toThrow('legLeveler.error.noSpec');
    expect(await boresOf(opfs, 'B.zipt')).toHaveLength(0); // no write happened
  });

  it('throws tooSmall when legs do not fit; zero bores written', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    // sideInset so large that 2*sideInset + patternW > CABW-2*Tc (564mm inner)
    // spec.patternW = 36, so 2*290 + 36 = 616 > 564 → triggers tooSmall
    await expect(
      new AddLegLevelersCommand({
        cabinetPath,
        params: { legsPerRow: R, sideInset: 290 },
        opfs,
        kernel: makeKernel(),
      }).execute(),
    ).rejects.toThrow('legLeveler.error.tooSmall');
    expect(await boresOf(opfs, 'B.zipt')).toHaveLength(0); // no write happened
  });

  it('bore (u,v) co-locates with leg component (x,y) via face2DFrame Bottom transform', async () => {
    // Reproduce / lock the v-mapping geometry invariant:
    // Each leg's 4 bores, converted back to cabinet world XY via the same
    // face2DFrame('Bottom') transform the viewport uses, must equal the leg
    // component's (position.x, position.y) within ±patternW/2 (=18mm).
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const cmd = new AddLegLevelersCommand({ cabinetPath, params: { legsPerRow: 2 }, opfs, kernel: makeKernel() });
    await cmd.execute();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const bottomComp = cab.components.find((c) => c.role === 'bottom')!;
    const legs = cab.components.filter((c) => c.role === 'legLeveler');
    const allBores = (await boresOf(opfs, 'B.zipt')).filter((b) => b.role === 'legLeveler');

    // Panel dims in the test (Tb=0 so panelWidth = CABD)
    const panelL = CABW - 2 * Tc;   // 564
    const panelW = CABD;              // 560
    const f = face2DFrame({ length: panelL, width: panelW, thickness: Tc }, 'Bottom');

    // worldPose.translation = comp.position + (hL, hW, 0)  (kernel centers the mesh)
    const hL = panelL / 2;
    const hW = panelW / 2;
    const tx = bottomComp.position.x + hL;  // 300
    const ty = bottomComp.position.y + hW;  // 280

    // For each of the 4 legs, find its 4 bores and assert bore centroid ≈ leg (x,y)
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]!;
      // Bores for leg i are tagged leg-${i}-*
      const legBores = allBores.filter((b) => b.id.startsWith(`leg-${i}-`));
      expect(legBores).toHaveLength(4);

      const avgU = legBores.reduce((s, b) => s + b.u, 0) / 4;
      const avgV = legBores.reduce((s, b) => s + b.v, 0) / 4;

      // world = worldPose.translation + frame.origin + u*uDir + v*vDir
      const worldX = tx + f.origin.x + avgU * f.uDir.x + avgV * f.vDir.x;
      const worldY = ty + f.origin.y + avgU * f.uDir.y + avgV * f.vDir.y;

      expect(worldX).toBeCloseTo(leg.position.x, 1);
      expect(worldY).toBeCloseTo(leg.position.y, 1);
    }
  });

  it('places 2R leg components top-aligned under the bottom panel', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const cmd = new AddLegLevelersCommand({ cabinetPath, params: { legsPerRow: 2 }, opfs, kernel: makeKernel() });
    await cmd.execute();
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const legs = cab.components.filter((c) => c.role === 'legLeveler');
    expect(legs).toHaveLength(4);
    expect(legs.every((l) => l.partPath === 'hardware/leg-leveler-100.zipt')).toBe(true);
    // top of 120mm leg aligns to underside at z = TOEKICK_H: centroid z = TOEKICK_H - 60
    expect(legs[0]!.position.z).toBeCloseTo(TOEKICK_H - 60, 3);
    expect(await opfs.exists('hardware/leg-leveler-100.zipt')).toBe(true);
  });

  it('revert removes bores and leg components', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const cmd = new AddLegLevelersCommand({ cabinetPath, params: { legsPerRow: 2 }, opfs, kernel: makeKernel() });
    await cmd.execute();
    await cmd.revert!();
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    expect(cab.components.filter((c) => c.role === 'legLeveler')).toHaveLength(0);
    expect((await boresOf(opfs, 'B.zipt')).filter((b) => b.role === 'legLeveler')).toHaveLength(0);
  });
});

describe('AddLegLevelersCommand — presetValues snapshot (P9 W2b)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('overrides diameter/depth/presetLayerName/toolNumber/speed on every generated leg bore when presetValues is given', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const presetValues = { diameter: 7, depth: 15, layerName: 'LEG-CAM', toolNumber: 4, speed: 9000 };
    await new AddLegLevelersCommand({
      cabinetPath, params: { legsPerRow: R }, presetValues, opfs, kernel: makeKernel(),
    }).execute();

    const legBores = (await boresOf(opfs, 'B.zipt')).filter((b) => b.role === 'legLeveler');
    expect(legBores.length).toBe(4 * (2 * R));
    for (const b of legBores) {
      expect(b.diameter).toBe(7);
      expect(b.depth).toBe(15);
      expect(b.presetLayerName).toBe('LEG-CAM');
      expect(b.toolNumber).toBe(4);
      expect(b.speed).toBe(9000);
    }
  });

  it('a later mutation of the source presetValues object never changes already-created bores (snapshot, not a live reference)', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    const presetValues = { diameter: 7, depth: 15, layerName: 'LEG-CAM' };
    await new AddLegLevelersCommand({
      cabinetPath, params: { legsPerRow: R }, presetValues, opfs, kernel: makeKernel(),
    }).execute();
    presetValues.diameter = 999;
    presetValues.layerName = 'MUTATED';

    const legBores = (await boresOf(opfs, 'B.zipt')).filter((b) => b.role === 'legLeveler');
    for (const b of legBores) {
      expect(b.diameter).toBe(7);
      expect(b.presetLayerName).toBe('LEG-CAM');
    }
  });

  it('without presetValues, behavior is unchanged (no presetLayerName/toolNumber/speed on generated bores)', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await new AddLegLevelersCommand({ cabinetPath, params: { legsPerRow: R }, opfs, kernel: makeKernel() }).execute();

    const legBores = (await boresOf(opfs, 'B.zipt')).filter((b) => b.role === 'legLeveler');
    for (const b of legBores) {
      expect('presetLayerName' in b).toBe(false);
      expect('toolNumber' in b).toBe(false);
      expect('speed' in b).toBe(false);
    }
  });
});

describe('AddLegLevelersCommand — SKU stamping', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('stamps sku=leg-leveler-100 (the default skuId) onto every generated bore', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await new AddLegLevelersCommand({ cabinetPath, params: { legsPerRow: R }, opfs, kernel: makeKernel() }).execute();

    const legBores = (await boresOf(opfs, 'B.zipt')).filter((b) => b.role === 'legLeveler');
    expect(legBores.length).toBe(4 * (2 * R));
    for (const b of legBores) expect(b.sku).toBe('leg-leveler-100');
  });
});
