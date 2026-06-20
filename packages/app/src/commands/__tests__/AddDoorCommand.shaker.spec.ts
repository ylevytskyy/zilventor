// @vitest-environment node
/**
 * 1b.4.2 — shaker (framed) door: nested .ziasm of 5 members that REACH the cut-list.
 *
 * Guards the recurring "present-in-doc ≠ appears-in-cut-list" false-green (S6): the
 * proof is a real cut-list ROW via aggregateCutListRecursive — built by reading every
 * member .zipt back through resolvePanelSpec (the production path) — not doc presence.
 * The cut-list walker recurses into nested .ziasm, so the door .ziasm must be in the
 * sub-assembly cache and every member .zipt must carry a PanelFeature.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDoorCommand } from '../AddDoorCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, DoorMathInput, PartDocument } from '@zilventor/shared';
import { aggregateCutListRecursive } from '../../assembly/walkers/aggregateCutListRecursive';
import { resolvePanelSpec } from '../../shell/resolvePanelSpec';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';
import type { MaterialEntry } from '@zilventor/shared/src/material';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async exists(p: string) { return this.files.has(p); }
  async delete(p: string) { this.files.delete(p); }
}

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
const MAT: MaterialEntry[] = [{ id: 'm', name: 'MDF', defaultThickness: 18, color: '#ccc' }];

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
    materials: MAT, hardware: [],
  };
  const cabinetPath = 'Cab.ziasm';
  await opfs.write(cabinetPath, await packAssembly(cabinet, new Uint8Array()));
  const top: AssemblyDocument = {
    id: 'A_TOP', name: 'Room', units: 'mm', parameters: {}, properties: {},
    components: [{ id: 'TOP1', partPath: cabinetPath, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
    constraints: [], groundedComponentPaths: [['TOP1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: MAT, hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: top });
  useAppStore.getState().setSubAssemblyDocs({ [cabinetPath]: cabinet });
  return cabinetPath;
}

const SHAKER_SINGLE: DoorMathInput = {
  cabinet: { width: 0, height: 0, depth: 0, Tc: 0, toekickHeight: 0 }, // derived from .ziasm
  count: 'single', overlay: 'full', hingeSide: 'left',
  thickness: 18, reveal: 2, clearance: 2, centerReveal: 3,
  style: 'shaker', frameWidth: 70,
};

describe('AddDoorCommand — shaker (framed) door', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('builds a nested door .ziasm with 5 frame members, placed as a role:door component', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    await new AddDoorCommand({ cabinetPath, params: SHAKER_SINGLE, opfs, kernel }).apply();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const doors = cab.components.filter((c) => c.role === 'door');
    expect(doors).toHaveLength(1);
    // Shaker door is a nested sub-assembly, not a single .zipt panel.
    expect(doors[0]!.partPath.endsWith('.ziasm')).toBe(true);
    expect(doors[0]!.doorSpec).toBeDefined();

    // The door .ziasm holds the 5 frame members.
    const doorAsm = await unpackAssembly(await opfs.read(doors[0]!.partPath));
    expect(doorAsm.components.length).toBeGreaterThanOrEqual(4);
    expect(doorAsm.components).toHaveLength(5);
    expect(doorAsm.components.filter((c) => c.role === 'doorStile')).toHaveLength(2);
    expect(doorAsm.components.filter((c) => c.role === 'doorRail')).toHaveLength(2);
    expect(doorAsm.components.filter((c) => c.role === 'doorCenterPanel')).toHaveLength(1);
  });

  it('frame members REACH the cut-list as real rows (S6 — door 596×716, frame 70)', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    await new AddDoorCommand({ cabinetPath, params: SHAKER_SINGLE, opfs, kernel }).apply();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const door = cab.components.find((c) => c.role === 'door')!;
    const doorAsm = await unpackAssembly(await opfs.read(door.partPath));

    // Resolve every member .zipt spec via the production path.
    const panelSpecs = new Map<string, PanelSpec | null>();
    for (const c of doorAsm.components) {
      if (c.partPath.endsWith('.zipt')) await resolvePanelSpec(opfs, c.partPath, panelSpecs);
    }
    for (const c of doorAsm.components) {
      expect(panelSpecs.get(c.partPath), `spec must resolve for ${c.partPath}`).not.toBeNull();
    }

    // Sub-assembly cache must resolve BOTH the cabinet and the nested door .ziasm.
    const subAsmCache = {
      get: (p: string) =>
        p === cabinetPath ? { kind: 'ok' as const, doc: cab, partPath: p }
        : p === door.partPath ? { kind: 'ok' as const, doc: doorAsm, partPath: p }
        : undefined,
    };

    const topDoc: AssemblyDocument = {
      id: 'project', name: 'project', units: 'mm', parameters: {},
      components: [{ id: 'cab', partPath: cabinetPath, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
      constraints: [], groundedComponentPaths: [], colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: MAT, hardware: [],
    } as unknown as AssemblyDocument;

    const result = aggregateCutListRecursive(topDoc, subAsmCache, panelSpecs, MAT, new Map());

    // door 596 (600−2×2) × 716 (720−2×2); frame 70 → inner 456 × 576
    const stileRow = result.rows.find((r) => r.length === 716 && r.width === 70 && r.thickness === 18);
    expect(stileRow, 'stile row 716×70 missing').toBeDefined();
    expect(stileRow!.qty).toBe(2);

    const railRow = result.rows.find((r) => r.length === 70 && r.width === 456 && r.thickness === 18);
    expect(railRow, 'rail row 70×456 missing').toBeDefined();
    expect(railRow!.qty).toBe(2);

    const panelRow = result.rows.find((r) => r.length === 576 && r.width === 456 && r.thickness === 18);
    expect(panelRow, 'center-panel row 576×456 missing').toBeDefined();
    expect(panelRow!.qty).toBe(1);
  });

  it('raisedPanel adds a regenerable groove rebate on the center panel only (1b.4.3)', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    await new AddDoorCommand({
      cabinetPath,
      params: { ...SHAKER_SINGLE, style: 'raisedPanel' },
      opfs, kernel,
    }).apply();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const door = cab.components.find((c) => c.role === 'door')!;
    const doorAsm = await unpackAssembly(await opfs.read(door.partPath));

    const grooveKinds = async (partPath: string): Promise<string[]> => {
      const project = await unpackProject(await opfs.read(partPath));
      const tree = (project.manifest as { document: { featureTree?: Array<{ kind: string }> } }).document.featureTree ?? [];
      return tree.filter((f) => f.kind === 'groove').map((f) => f.kind);
    };

    const centerPanel = doorAsm.components.find((c) => c.role === 'doorCenterPanel')!;
    expect(await grooveKinds(centerPanel.partPath), 'center panel must carry a groove rebate').not.toHaveLength(0);

    // Frame members (stiles/rails) must NOT get the rebate.
    for (const c of doorAsm.components.filter((c) => c.role !== 'doorCenterPanel')) {
      expect(await grooveKinds(c.partPath), `${String(c.role)} must have no groove`).toHaveLength(0);
    }
  });

  it('slab/shaker styles add NO groove to the center panel', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    await new AddDoorCommand({ cabinetPath, params: SHAKER_SINGLE, opfs, kernel }).apply();
    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const door = cab.components.find((c) => c.role === 'door')!;
    const doorAsm = await unpackAssembly(await opfs.read(door.partPath));
    const centerPanel = doorAsm.components.find((c) => c.role === 'doorCenterPanel')!;
    const project = await unpackProject(await opfs.read(centerPanel.partPath));
    const tree = (project.manifest as { document: { featureTree?: Array<{ kind: string }> } }).document.featureTree ?? [];
    expect(tree.filter((f) => f.kind === 'groove')).toHaveLength(0);
  });

  it('revert removes the door component, the door .ziasm, and all 5 member .zipts', async () => {
    const opfs = new MemOpfs();
    const kernel = makeKernel();
    const cabinetPath = await seedCabinet(opfs);

    const cmd = new AddDoorCommand({ cabinetPath, params: SHAKER_SINGLE, opfs, kernel });
    await cmd.apply();

    const cab = await unpackAssembly(await opfs.read(cabinetPath));
    const door = cab.components.find((c) => c.role === 'door')!;
    const doorAsm = await unpackAssembly(await opfs.read(door.partPath));
    const memberPaths = doorAsm.components.map((c) => c.partPath);
    expect(await opfs.exists(door.partPath)).toBe(true);
    expect(kernel.registered.size).toBe(5);

    await cmd.revert();

    const afterRevert = await unpackAssembly(await opfs.read(cabinetPath));
    expect(afterRevert.components.some((c) => c.role === 'door')).toBe(false);
    expect(await opfs.exists(door.partPath)).toBe(false);
    for (const p of memberPaths) expect(await opfs.exists(p), `${p} deleted`).toBe(false);
    expect(kernel.registered.size).toBe(0);
  });
});
