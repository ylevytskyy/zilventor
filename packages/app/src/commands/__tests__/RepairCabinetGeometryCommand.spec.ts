// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { RepairCabinetGeometryCommand, hasRepairableLegacyPose } from '../RepairCabinetGeometryCommand';
import { CreateCabinetCommand, type CreateCabinetOpts } from '../CreateCabinetCommand';
import type { OpfsLike } from '../../assembly/SubAssemblyCache';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument, MaterialEntry, ComponentInstance } from '@zilventor/shared';
import { DOOR_POSE } from '@zilventor/shared';
import { unpackAssembly, packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';

/**
 * Locking tests for RepairCabinetGeometryCommand (cabinet-pose-fix Worker 2).
 *
 * Fixture strategy: build a REAL cabinet via CreateCabinetCommand (real .ziasm +
 * .zipt files, proven-correct poses per baseCabinetPose.spec.ts et al — the
 * "fresh" ground truth), then simulate the legacy backfill
 * (fileFormat.ts:545-569 backfillAssembly4b — pose.translation = position,
 * quaternion = identity) to produce a realistic legacy doc, overwrite the
 * cabinet .ziasm with that legacy doc, and assert apply() restores poses to
 * match the fresh ground truth.
 */

class MemOpfs implements OpfsLike {
  files = new Map<string, Uint8Array>();
  async exists(p: string) { return this.files.has(p); }
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async delete(p: string) { this.files.delete(p); }
  async list(): Promise<string[]> { return Array.from(this.files.keys()); }
}

const carcass: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const back: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };

function seedAssembly(): void {
  const doc: AssemblyDocument = {
    id: 'A1', name: 'Project', units: 'mm',
    parameters: {}, properties: {},
    components: [], constraints: [],
    groundedComponentPaths: [], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [carcass, back],
    hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
}

/**
 * Local re-implementation of fileFormat.ts:533-543's eulerXYZToQuat — the
 * exact transform backfillAssembly4b applies to legacy components on load.
 * Duplicated here (rather than imported) as an independent test oracle, per
 * the pattern established by baseCabinetPose.spec.ts's quatRotateVec.
 */
function eulerXYZToQuat(rx: number, ry: number, rz: number): [number, number, number, number] {
  const cx = Math.cos((rx * Math.PI) / 360); const sx = Math.sin((rx * Math.PI) / 360);
  const cy = Math.cos((ry * Math.PI) / 360); const sy = Math.sin((ry * Math.PI) / 360);
  const cz = Math.cos((rz * Math.PI) / 360); const sz = Math.sin((rz * Math.PI) / 360);
  const x = sx * cy * cz + cx * sy * sz;
  const y = cx * sy * cz - sx * cy * sz;
  const z = cx * cy * sz + sx * sy * cz;
  const w = cx * cy * cz - sx * sy * sz;
  return [x, y, z, w];
}

/** Backfills every component's pose the way backfillAssembly4b does on legacy load. */
function toLegacyPose(cab: AssemblyDocument): AssemblyDocument {
  return {
    ...cab,
    components: cab.components.map((c): ComponentInstance => ({
      ...c,
      pose: {
        translation: { ...c.position },
        quaternion: eulerXYZToQuat(c.rotation.rx, c.rotation.ry, c.rotation.rz),
      },
    })),
  };
}

function expectVec3Close(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 3);
  expect(actual.y).toBeCloseTo(expected.y, 3);
  expect(actual.z).toBeCloseTo(expected.z, 3);
}

function expectQuatClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual[0]).toBeCloseTo(expected[0]!, 3);
  expect(actual[1]).toBeCloseTo(expected[1]!, 3);
  expect(actual[2]).toBeCloseTo(expected[2]!, 3);
  expect(actual[3]).toBeCloseTo(expected[3]!, 3);
}

/** Builds a real cabinet via CreateCabinetCommand, returns {opfs, cabinetPath, freshCab}. */
async function buildFreshCabinet(
  makeOpts: (opfs: MemOpfs) => CreateCabinetOpts,
  cabinetName: string,
): Promise<{ opfs: MemOpfs; cabinetPath: string; freshCab: AssemblyDocument }> {
  seedAssembly();
  const opfs = new MemOpfs();
  await new CreateCabinetCommand(makeOpts(opfs)).apply();
  const cabinetPath = `${cabinetName}.ziasm`;
  const freshCab = await unpackAssembly(await opfs.read(cabinetPath));
  return { opfs, cabinetPath, freshCab };
}

/** Overwrites the cabinet .ziasm in `opfs` with a legacy (identity-pose) copy of `freshCab`. */
async function seedLegacyDoc(opfs: MemOpfs, cabinetPath: string, freshCab: AssemblyDocument): Promise<Uint8Array> {
  const legacyCab = toLegacyPose(freshCab);
  const legacyBytes = await packAssembly(legacyCab, new Uint8Array());
  await opfs.write(cabinetPath, legacyBytes);
  return legacyBytes;
}

const BASE_DEFAULTS = {
  name: 'Base Cabinet 1',
  width: 600, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 50, shelfCount: 1,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
} as const;

const CORNER_DEFAULTS = {
  name: 'Corner 1',
  width1: 900, depth1: 350,
  width2: 600, depth2: 350,
  height: 720,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
} as const;

const BLIND_DEFAULTS = {
  name: 'Blind 1',
  width: 900, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 60,
  openingWidth: 450, blindSide: 'left' as const,
  shelfCount: 0,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
} as const;

const DIAGONAL_DEFAULTS = {
  name: 'Diag 1',
  wallWidth1: 900, wallWidth2: 900,
  returnDepth1: 560, returnDepth2: 560,
  height: 720, toekickHeight: 100, toekickSetback: 60,
  stileWidth: 50,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
} as const;

describe('RepairCabinetGeometryCommand — baseCabinet', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('repairs every carcass component pose to match the fresh-build ground truth, without touching position/rotation', async () => {
    const { opfs, cabinetPath, freshCab } = await buildFreshCabinet(
      (opfs) => ({ template: 'baseCabinet', params: { ...BASE_DEFAULTS }, opfs }),
      BASE_DEFAULTS.name,
    );
    await seedLegacyDoc(opfs, cabinetPath, freshCab);

    await new RepairCabinetGeometryCommand({ cabinetPath, opfs }).apply();

    const repairedCab = await unpackAssembly(await opfs.read(cabinetPath));
    expect(repairedCab.components).toHaveLength(freshCab.components.length);

    for (const fresh of freshCab.components) {
      const repaired = repairedCab.components.find((c) => c.id === fresh.id)!;
      expect(repaired).toBeDefined();
      expect(repaired.pose).toBeDefined();
      expectVec3Close(repaired.pose!.translation, fresh.pose!.translation);
      expectQuatClose(repaired.pose!.quaternion, fresh.pose!.quaternion);
      // position/rotation are the ORIGINAL stored numbers — never touched by repair.
      expect(repaired.position).toEqual(fresh.position);
      expect(repaired.rotation).toEqual(fresh.rotation);
    }
  });

  it('is idempotent: a second apply() leaves OPFS bytes byte-for-byte unchanged', async () => {
    const { opfs, cabinetPath, freshCab } = await buildFreshCabinet(
      (opfs) => ({ template: 'baseCabinet', params: { ...BASE_DEFAULTS }, opfs }),
      BASE_DEFAULTS.name,
    );
    await seedLegacyDoc(opfs, cabinetPath, freshCab);

    await new RepairCabinetGeometryCommand({ cabinetPath, opfs }).apply();
    const afterFirst = await opfs.read(cabinetPath);

    await new RepairCabinetGeometryCommand({ cabinetPath, opfs }).apply();
    const afterSecond = await opfs.read(cabinetPath);

    expect(Array.from(afterSecond)).toEqual(Array.from(afterFirst));
  });

  it('revert() restores the pre-repair bytes exactly', async () => {
    const { opfs, cabinetPath, freshCab } = await buildFreshCabinet(
      (opfs) => ({ template: 'baseCabinet', params: { ...BASE_DEFAULTS }, opfs }),
      BASE_DEFAULTS.name,
    );
    const legacyBytes = await seedLegacyDoc(opfs, cabinetPath, freshCab);

    const cmd = new RepairCabinetGeometryCommand({ cabinetPath, opfs });
    await cmd.apply();
    expect(Array.from(await opfs.read(cabinetPath))).not.toEqual(Array.from(legacyBytes));

    await cmd.revert();
    expect(Array.from(await opfs.read(cabinetPath))).toEqual(Array.from(legacyBytes));
  });
});

describe('RepairCabinetGeometryCommand — cornerCabinet (leg-2 permutation)', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('repairs Leg 1 End / Leg 2 End / Corner Post to match the fresh-build ground truth', async () => {
    const { opfs, cabinetPath, freshCab } = await buildFreshCabinet(
      (opfs) => ({ template: 'cornerCabinet', params: { ...CORNER_DEFAULTS }, opfs }),
      CORNER_DEFAULTS.name,
    );
    await seedLegacyDoc(opfs, cabinetPath, freshCab);

    await new RepairCabinetGeometryCommand({ cabinetPath, opfs }).apply();

    const repairedCab = await unpackAssembly(await opfs.read(cabinetPath));
    for (const fresh of freshCab.components) {
      const repaired = repairedCab.components.find((c) => c.id === fresh.id)!;
      expectVec3Close(repaired.pose!.translation, fresh.pose!.translation);
      expectQuatClose(repaired.pose!.quaternion, fresh.pose!.quaternion);
      expect(repaired.position).toEqual(fresh.position);
      expect(repaired.rotation).toEqual(fresh.rotation);
    }
  });
});

describe('RepairCabinetGeometryCommand — blindCornerCabinet (Door decision-tree branch)', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('repairs carcass panels AND the Door (translation=position, quaternion=DOOR_POSE), leaves hinge hardware untouched', async () => {
    const { opfs, cabinetPath, freshCab } = await buildFreshCabinet(
      (opfs) => ({ template: 'blindCornerCabinet', params: { ...BLIND_DEFAULTS }, opfs }),
      BLIND_DEFAULTS.name,
    );

    const hingeComponent = freshCab.components.find((c) => c.partPath.startsWith('hardware/'));
    expect(hingeComponent).toBeDefined(); // sanity: fixture actually has a foreign/hardware component

    const doorFresh = freshCab.components.find((c) => c.partPath === `${BLIND_DEFAULTS.name} - Door.zipt`)!;
    expect(doorFresh).toBeDefined();

    expect(hasRepairableLegacyPose(toLegacyPose(freshCab))).toBe(true);

    await seedLegacyDoc(opfs, cabinetPath, freshCab);
    await new RepairCabinetGeometryCommand({ cabinetPath, opfs }).apply();

    const repairedCab = await unpackAssembly(await opfs.read(cabinetPath));

    // Carcass panels match ground truth.
    for (const fresh of freshCab.components) {
      if (fresh.partPath.startsWith('hardware/') || fresh.partPath.endsWith('Door.zipt')) continue;
      const repaired = repairedCab.components.find((c) => c.id === fresh.id)!;
      expectVec3Close(repaired.pose!.translation, fresh.pose!.translation);
      expectQuatClose(repaired.pose!.quaternion, fresh.pose!.quaternion);
    }

    // Door: translation recovered from position (already correct pre-repair per the
    // template), quaternion corrected to DOOR_POSE (identity after legacy backfill).
    const doorRepaired = repairedCab.components.find((c) => c.id === doorFresh.id)!;
    expectVec3Close(doorRepaired.pose!.translation, doorFresh.position);
    expectQuatClose(doorRepaired.pose!.quaternion, DOOR_POSE.quaternion);
    expect(doorRepaired.position).toEqual(doorFresh.position);
    expect(doorRepaired.rotation).toEqual(doorFresh.rotation);

    // Foreign hardware component: completely untouched (no pose added).
    const hingeRepaired = repairedCab.components.find((c) => c.id === hingeComponent!.id)!;
    expect(hingeRepaired).toEqual(hingeComponent);
  });
});

describe('RepairCabinetGeometryCommand — diagonalCornerCabinet (Door skip branch)', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('repairs carcass panels but SKIPS the Door (already correct via real-Euler backfill)', async () => {
    const { opfs, cabinetPath, freshCab } = await buildFreshCabinet(
      (opfs) => ({ template: 'diagonalCornerCabinet', params: { ...DIAGONAL_DEFAULTS }, opfs }),
      DIAGONAL_DEFAULTS.name,
    );

    const doorFresh = freshCab.components.find((c) => c.partPath === `${DIAGONAL_DEFAULTS.name} - Door.zipt`)!;
    expect(doorFresh).toBeDefined();
    // The template attaches no `pose` to the diagonal Door layout entry, but
    // unpackAssembly's own migrateManifest backfill (fileFormat.ts:545-569)
    // fills it in from the component's REAL (non-identity) `rotation` —
    // already correct, unlike blindCorner's identity-rotation Door.
    expect(doorFresh.pose).toBeDefined();

    const legacyCab = toLegacyPose(freshCab);
    const doorLegacy = legacyCab.components.find((c) => c.id === doorFresh.id)!;
    await opfs.write(cabinetPath, await packAssembly(legacyCab, new Uint8Array()));

    await new RepairCabinetGeometryCommand({ cabinetPath, opfs }).apply();

    const repairedCab = await unpackAssembly(await opfs.read(cabinetPath));
    const doorRepaired = repairedCab.components.find((c) => c.id === doorFresh.id)!;
    // Untouched: still whatever the legacy backfill produced from the door's real rotation.
    expectVec3Close(doorRepaired.pose!.translation, doorLegacy.pose!.translation);
    expectQuatClose(doorRepaired.pose!.quaternion, doorLegacy.pose!.quaternion);

    // Carcass panels still get repaired.
    const bottomFresh = freshCab.components.find((c) => c.partPath === `${DIAGONAL_DEFAULTS.name} - Bottom.zipt`)!;
    const bottomRepaired = repairedCab.components.find((c) => c.id === bottomFresh.id)!;
    expectVec3Close(bottomRepaired.pose!.translation, bottomFresh.pose!.translation);
    expectQuatClose(bottomRepaired.pose!.quaternion, bottomFresh.pose!.quaternion);
  });
});

describe('hasRepairableLegacyPose (BrowserPane gating heuristic)', () => {
  it('returns false for a doc whose poses are already correct (fresh-built)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...BASE_DEFAULTS }, opfs }).apply();
    const freshCab = await unpackAssembly(await opfs.read('Base Cabinet 1.ziasm'));
    expect(hasRepairableLegacyPose(freshCab)).toBe(false);
  });

  it('returns true for a legacy (identity-pose-backfilled) doc', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...BASE_DEFAULTS }, opfs }).apply();
    const freshCab = await unpackAssembly(await opfs.read('Base Cabinet 1.ziasm'));
    expect(hasRepairableLegacyPose(toLegacyPose(freshCab))).toBe(true);
  });
});
