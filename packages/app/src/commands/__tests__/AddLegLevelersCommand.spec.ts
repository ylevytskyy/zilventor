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
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PartDocument } from '@zilventor/shared';

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
});
