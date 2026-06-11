// @vitest-environment node
/**
 * AddDrawerBankCommand — TDD spec (Chunk H, присадка slice 4).
 *
 * Seed mirrors AddDoorCommand.spec.ts exactly (C-6 — FULL AssemblyDocument seed).
 * Tests:
 *   H1-apply:  N=3 drawers → 3 drawerFront + 3 drawerBox components, unique box partPaths,
 *              cabinet LEFT/RIGHT side panels gain drawerSlide-cabinet bores.
 *   H1-degenerate: openW ≤ 57 → apply() rejects with drawerBank.error.tooSmall, 0 components added.
 *   H2-revert:  all components removed, written blobs deleted (opfs.exists===false),
 *              cabinet-side prior bore count restored.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDrawerBankCommand } from '../AddDrawerBankCommand';
import { useAppStore } from '../../store/useAppStore';
import { unpackProject, packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PartDocument } from '@zilventor/shared';

// ─── In-memory OPFS (same as AddDoorCommand.spec) ────────────────────────────

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
    async registerPart(part: PartDocument) {
      registered.add(part.id);
    },
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

// ─── seedCabinet — mirrors AddDoorCommand.spec.ts exactly (C-6) ──────────────

/**
 * Seeds a valid cabinet .ziasm + left/right side .zipt + bottom .zipt into MemOpfs,
 * sets the active document (top wrapper) + subAssemblyDocs, returns cabinetPath.
 */
async function seedCabinet(opfs: MemOpfs): Promise<string> {
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

  // Bottom panel — position.z = TOEKICK_H tells deriveCabinetDims the toekick height
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

  // Top wrapper pointing at the cabinet (matches real app structure)
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
 * Seeds a DEGENERATE cabinet: openW = 50 (< 57 guard threshold).
 * Side panel width = 50 → rightSide position.x = 50 - Tc = 32.
 */
async function seedDegenerateCabinet(opfs: MemOpfs): Promise<string> {
  const TINY_W = 50; // openW = TINY_W - 2*Tc = 50 - 36 = 14 < 57
  for (const path of ['TL.zipt', 'TR.zipt']) {
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
    id: 'TB.zipt', name: 'TB.zipt', units: 'mm', parameters: {},
    featureTree: [{
      kind: 'panel', id: 'panel',
      length: { kind: 'literal', value: TINY_W - 2 * Tc },
      width: { kind: 'literal', value: CABD },
      thickness: { kind: 'literal', value: Tc },
      thicknessFromMaterial: true, materialId: 'm', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    } as unknown as import('@zilventor/shared').Feature],
  };
  await opfs.write('TB.zipt', await packProject({
    manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: bottomDoc },
    blobs: {},
  }));

  const cabinet: AssemblyDocument = {
    id: 'A_TINY', name: 'TinyCab', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'TC1', partPath: 'TL.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'leftSide' },
      { id: 'TC2', partPath: 'TR.zipt', position: { x: TINY_W - Tc, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'rightSide' },
      { id: 'TC3', partPath: 'TB.zipt', position: { x: Tc, y: 0, z: TOEKICK_H }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role: 'bottom' },
    ],
    constraints: [], groundedComponentPaths: [['TC1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  const cabinetPath = 'TinyCab.ziasm';
  await opfs.write(cabinetPath, await packAssembly(cabinet, new Uint8Array()));

  const top: AssemblyDocument = {
    id: 'A_TOP_TINY', name: 'Room', units: 'mm', parameters: {}, properties: {},
    components: [{ id: 'TOP2', partPath: cabinetPath, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
    constraints: [], groundedComponentPaths: [['TOP2']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: top });
  useAppStore.getState().setSubAssemblyDocs({ [cabinetPath]: cabinet });
  return cabinetPath;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AddDrawerBankCommand — apply (H1)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('adds N=3 drawerFront + N=3 drawerBox components; box partPaths unique and OPFS-present', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const cmd = new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 3, overlay: 'full', thickness: 18 },
      opfs,
      kernel,
      store: useAppStore,
    });
    await cmd.apply();

    // Reload cabinet from OPFS bytes (proves persistence, not in-memory state)
    const cab = await unpackAssembly(await opfs.read(cabinetPath));

    const fronts = cab.components.filter((c) => c.role === 'drawerFront');
    const boxes = cab.components.filter((c) => c.role === 'drawerBox');
    expect(fronts).toHaveLength(3);
    expect(boxes).toHaveLength(3);

    // Box partPaths must all be unique
    const boxPaths = boxes.map((c) => c.partPath);
    expect(new Set(boxPaths).size).toBe(3);

    // Each box .ziasm must be written to OPFS
    for (const p of boxPaths) {
      expect(await opfs.exists(p), `box .ziasm ${p} must exist in OPFS`).toBe(true);
    }

    // Each front .zipt must be written to OPFS
    const frontPaths = fronts.map((c) => c.partPath);
    for (const p of frontPaths) {
      expect(await opfs.exists(p), `front .zipt ${p} must exist in OPFS`).toBe(true);
    }
  });

  it('adds drawerSlide-cabinet bores to cabinet LEFT and RIGHT side panels (> 0 bores each)', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const cmd = new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 3, overlay: 'full', thickness: 18 },
      opfs,
      kernel,
      store: useAppStore,
    });
    await cmd.apply();

    const leftBores = await boresOf(opfs, 'L.zipt');
    const rightBores = await boresOf(opfs, 'R.zipt');

    const leftSlideBores = leftBores.filter((b) => b.role === 'drawerSlide-cabinet');
    const rightSlideBores = rightBores.filter((b) => b.role === 'drawerSlide-cabinet');

    expect(leftSlideBores.length).toBeGreaterThan(0);
    expect(rightSlideBores.length).toBeGreaterThan(0);
  });

  it('degenerate guard (C-8): openW ≤ 57 → apply() rejects with drawerBank.error.tooSmall, 0 components added', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    // Seed: TINY_W=50 → openW = 50 - 2*18 = 14 → well below guard threshold 57
    const cabinetPath = await seedDegenerateCabinet(opfs);

    const cmd = new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 3, overlay: 'full', thickness: 18 },
      opfs,
      kernel,
      store: useAppStore,
    });

    await expect(cmd.apply()).rejects.toThrow(/drawerBank\.error\.tooSmall/);

    // No components should have been added (guard fires before any write)
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const added = cab.components.filter((c) => c.role === 'drawerFront' || c.role === 'drawerBox');
    expect(added).toHaveLength(0);
  });
});

describe('AddDrawerBankCommand — revert (H2)', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('after apply+revert: components back to baseline, blobs deleted, cabinet-side bores restored', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    // Baseline: no drawer components, no slide bores
    const baselineCab = await unpackAssembly(await opfs.read(cabinetPath));
    const baselineComponentCount = baselineCab.components.length;
    const baselineLeftBores = await boresOf(opfs, 'L.zipt');
    const baselineRightBores = await boresOf(opfs, 'R.zipt');
    expect(baselineLeftBores.filter((b) => b.role === 'drawerSlide-cabinet')).toHaveLength(0);
    expect(baselineRightBores.filter((b) => b.role === 'drawerSlide-cabinet')).toHaveLength(0);

    const cmd = new AddDrawerBankCommand({
      cabinetPath,
      params: { count: 3, overlay: 'full', thickness: 18 },
      opfs,
      kernel,
      store: useAppStore,
    });
    await cmd.apply();

    // Capture the paths of all written blobs (fronts + boxes + box panel parts)
    const afterApplyCab = await unpackAssembly(await opfs.read(cabinetPath));
    const drawerComps = afterApplyCab.components.filter(
      (c) => c.role === 'drawerFront' || c.role === 'drawerBox',
    );
    expect(drawerComps.length).toBe(6); // 3 fronts + 3 boxes

    // Collect all box panel .zipt paths by unpacking each box .ziasm
    const allBlobPaths: string[] = [];
    for (const c of drawerComps) {
      expect(await opfs.exists(c.partPath)).toBe(true);
      allBlobPaths.push(c.partPath);

      // For box .ziasm: unpack and collect the nested panel .zipt paths too
      if (c.role === 'drawerBox') {
        const boxAsm = await unpackAssembly(await opfs.read(c.partPath));
        for (const panel of boxAsm.components) {
          expect(await opfs.exists(panel.partPath), `box panel ${panel.partPath} must exist before revert`).toBe(true);
          allBlobPaths.push(panel.partPath);
        }
      }
    }

    // Cabinet side panels have slide bores after apply
    expect((await boresOf(opfs, 'L.zipt')).filter((b) => b.role === 'drawerSlide-cabinet').length).toBeGreaterThan(0);

    // ─── REVERT ──────────────────────────────────────────────────────────────
    await cmd.revert();

    // Cabinet components back to baseline count
    const afterRevertCab = await unpackAssembly(await opfs.read(cabinetPath));
    expect(afterRevertCab.components.length).toBe(baselineComponentCount);
    expect(afterRevertCab.components.filter((c) => c.role === 'drawerFront' || c.role === 'drawerBox')).toHaveLength(0);

    // ALL written blobs deleted — fronts, box .ziasms, AND box panel .zipt files (C-9, no OPFS leak)
    for (const p of allBlobPaths) {
      expect(await opfs.exists(p), `blob ${p} must be deleted after revert`).toBe(false);
    }

    // Cabinet-side bores restored to baseline (no drawerSlide-cabinet bores)
    const revertedLeftBores = await boresOf(opfs, 'L.zipt');
    const revertedRightBores = await boresOf(opfs, 'R.zipt');
    expect(revertedLeftBores.filter((b) => b.role === 'drawerSlide-cabinet')).toHaveLength(0);
    expect(revertedRightBores.filter((b) => b.role === 'drawerSlide-cabinet')).toHaveLength(0);
  });
});
