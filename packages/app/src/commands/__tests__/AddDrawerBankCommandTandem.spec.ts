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
import {
  TANDEM_CABINET_FRONT_SETBACK,
  TANDEM_CABINET_RUNNER_HEIGHT,
  TANDEM_REAR_HOOK_FROM_BACK,
} from '@zilventor/shared/src/tandemConventions';
import { BOX_PANEL_THICKNESS } from '@zilventor/shared/src/drawerConventions';

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

// ── Fixture-specific expected values (derived from constants, not magic numbers) ──
// openBottomZ = TOEKICK_H + Tc = 118
// slotH (1 drawer) = CABH - TOEKICK_H - 2*Tc = 584
// runnerWorldZ (drawer 0) = openBottomZ + 0*slotH + TANDEM_CABINET_RUNNER_HEIGHT = 128
const FIXTURE_OPEN_BOTTOM_Z = TOEKICK_H + Tc;                                               // 118
const FIXTURE_SLOT_H_1DRAWER = CABH - TOEKICK_H - 2 * Tc;                                  // 584
const FIXTURE_RUNNER_WORLD_Z =
  FIXTURE_OPEN_BOTTOM_Z + 0 * FIXTURE_SLOT_H_1DRAWER + TANDEM_CABINET_RUNNER_HEIGHT;       // 128

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

  it('tandem: cabinet side panels get tandem-cabinet bores — positional', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);
    await new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 1, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    }).apply();

    const leftBores = await boresOf(opfs, 'L.zipt');
    const rightBores = await boresOf(opfs, 'R.zipt');

    // Count: 1 drawer → 2 bores per side (front + rear)
    expect(leftBores.filter((b) => b.role === 'tandem-cabinet').length).toBeGreaterThan(0);
    expect(rightBores.filter((b) => b.role === 'tandem-cabinet').length).toBeGreaterThan(0);

    // Positional: left side front-fixing hole at (u=runnerWorldZ, v=FRONT_SETBACK).
    // Fails if face routing is swapped, or u (world-Z height) / v (front setback) are wrong.
    const leftFrontFix = leftBores.find(
      (b) =>
        b.role === 'tandem-cabinet' &&
        b.u === FIXTURE_RUNNER_WORLD_Z &&
        b.v === TANDEM_CABINET_FRONT_SETBACK,
    );
    expect(leftFrontFix, 'expected front-fixing tandem-cabinet bore on left side at correct (u,v)').toBeDefined();
  });

  it('tandem: drawer-box bottom panel gets tandem-drawer-bottom bores — positional', async () => {
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

    const boxDoc = await unpackAssembly(await opfs.read(boxComps[0]!.partPath));
    const bottomComp = boxDoc.components.find((c) => c.role === 'drawerBox-bottom')!;
    expect(bottomComp).toBeDefined();

    const bottomBores = await boresOf(opfs, bottomComp.partPath);

    // Count check
    expect(bottomBores.filter((b) => b.role === 'tandem-drawer-bottom').length).toBeGreaterThan(0);

    // Positional: left runner rear-hook at (u=T, v=REAR_HOOK_FROM_BACK).
    // Fails if bottom/back bores are swapped, u/v are transposed, or wrong panel receives bores.
    const T = BOX_PANEL_THICKNESS;
    const leftRearHook = bottomBores.find(
      (b) =>
        b.role === 'tandem-drawer-bottom' &&
        b.u === T &&
        b.v === TANDEM_REAR_HOOK_FROM_BACK,
    );
    expect(leftRearHook, 'expected left-runner rear-hook bore on box bottom at (u=T, v=REAR_HOOK)').toBeDefined();
  });

  it('tandem: drawer-box back panel gets tandem-drawer-back bores — positional', async () => {
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

    // Count check
    expect(backBores.filter((b) => b.role === 'tandem-drawer-back').length).toBeGreaterThan(0);

    // Positional: left runner locking device at (u=T, v=RUNNER_HEIGHT).
    // Fails if bottom/back bores are swapped, u/v are transposed, or wrong panel receives bores.
    const T = BOX_PANEL_THICKNESS;
    const leftLock = backBores.find(
      (b) =>
        b.role === 'tandem-drawer-back' &&
        b.u === T &&
        b.v === TANDEM_CABINET_RUNNER_HEIGHT,
    );
    expect(leftLock, 'expected left-runner locking-device bore on box back at (u=T, v=RUNNER_HEIGHT)').toBeDefined();
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

  it('tandem revert: removes tandem-cabinet bores, drawerBox components, and deletes box bottom+back panels', async () => {
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

    // MINOR 3: collect box bottom+back panel paths before revert, assert deleted after.
    const cabBeforeRevert = await unpackAssembly(await opfs.read(cabinetPath));
    const boxBottomBackPaths: string[] = [];
    for (const boxComp of cabBeforeRevert.components.filter((c) => c.role === 'drawerBox')) {
      const boxDocBefore = await unpackAssembly(await opfs.read(boxComp.partPath));
      const btComp = boxDocBefore.components.find((c) => c.role === 'drawerBox-bottom');
      const bkComp = boxDocBefore.components.find((c) => c.role === 'drawerBox-back');
      if (btComp) boxBottomBackPaths.push(btComp.partPath);
      if (bkComp) boxBottomBackPaths.push(bkComp.partPath);
    }
    expect(boxBottomBackPaths.length).toBeGreaterThan(0); // 2 drawers × 2 panels = 4

    await cmd.revert();

    // Cabinet bore restoration
    expect((await boresOf(opfs, 'L.zipt')).filter((b) => b.role === 'tandem-cabinet')).toHaveLength(0);
    expect((await boresOf(opfs, 'R.zipt')).filter((b) => b.role === 'tandem-cabinet')).toHaveLength(0);

    // Component removal
    const afterRevert = await unpackAssembly(await opfs.read(cabinetPath));
    expect(afterRevert.components.filter((c) => c.role === 'drawerBox')).toHaveLength(0);

    // MINOR 3: box bottom+back panels must be deleted from OPFS
    for (const p of boxBottomBackPaths) {
      expect(await opfs.exists(p), `box panel ${p} should be deleted after revert`).toBe(false);
    }
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

  it('tandem redo (apply→revert→apply): boreCacheInvalidator includes box bottom+back panel paths', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinet(opfs);

    // Spy: record all paths passed to boreCacheInvalidator
    const calledWith: string[][] = [];
    useAppStore.getState().setBoreCacheInvalidator((paths) => calledWith.push([...paths]));

    const cmd = new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 1, overlay: 'full', thickness: 18, slideSystem: 'tandem' },
      opfs,
      kernel: makeKernel(),
      store: useAppStore,
    });

    await cmd.apply();   // first apply
    await cmd.revert();  // undo
    calledWith.length = 0; // reset — only care about what redo reports

    await cmd.apply();   // redo (second apply)

    // Identify bottom+back panel paths from the re-built box after redo
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const boxComp = cab.components.find((c) => c.role === 'drawerBox')!;
    expect(boxComp).toBeDefined();
    const boxDoc = await unpackAssembly(await opfs.read(boxComp.partPath));
    const bottomPath = boxDoc.components.find((c) => c.role === 'drawerBox-bottom')!.partPath;
    const backPath = boxDoc.components.find((c) => c.role === 'drawerBox-back')!.partPath;

    // MAJOR 1: without the fix, writeBoxBottomBores/writeBoxBackBores return values are discarded
    // and these paths never reach boreCacheInvalidator — stale bore markers persist on redo.
    const allRedoPaths = calledWith.flat();
    expect(allRedoPaths, 'box bottom panel path must appear in boreCacheInvalidator on redo').toContain(bottomPath);
    expect(allRedoPaths, 'box back panel path must appear in boreCacheInvalidator on redo').toContain(backPath);
  });
});
