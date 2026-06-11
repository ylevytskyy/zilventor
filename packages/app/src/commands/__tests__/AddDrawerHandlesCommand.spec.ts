// @vitest-environment node
/**
 * AddDrawerHandlesCommand — TDD spec (Chunk F, присадка slice 6).
 *
 * Seed: FULL AssemblyDocument (not a bare shim — bare makeAsm crashes addComponent).
 * Mirrors AddDrawerBankCommand.spec.ts seed discipline (C-6 carried forward to F).
 *
 * Tests:
 *   F1-apply-parts:      apply() writes hardware/<skuId>.zipt + adds N pull components (role='drawerHandle')
 *   F2-apply-bores:      each drawer front gains exactly 2 handleScrew bores; connectorIds DISTINCT
 *   F3-apply-distinctIds: 2N total handleScrew bores across N fronts all have distinct connectorIds
 *   F4-revert-structural: revert() re-reads each front .zipt; handleScrew bores gone; pull comps gone
 *   F5-no-fronts:        no drawerFront components → apply() is a no-op (no throw, 0 pull comps)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AddDrawerHandlesCommand } from '../AddDrawerHandlesCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PartDocument } from '@zilventor/shared';

// ─── In-memory OPFS ──────────────────────────────────────────────────────────

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string): Promise<Uint8Array> {
    const b = this.files.get(p);
    if (!b) throw new Error(`MemOpfs: no file at '${p}'`);
    return b;
  }
  async write(p: string, b: Uint8Array): Promise<void> { this.files.set(p, b); }
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async delete(p: string): Promise<void> { this.files.delete(p); }
  has(p: string): boolean { return this.files.has(p); }
}

// ─── Helper: read BoreOps from a packed .zipt ────────────────────────────────

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

// ─── Cabinet + drawer front seed ─────────────────────────────────────────────

/** Front panel dimensions (must satisfy cc=128 width guard: 128+5=133 < 300). */
const FRONT_H = 500;   // length = front height
const FRONT_W = 300;   // width  = front width
const FRONT_T = 19;    // thickness
const CABINET_DEPTH = 560;

/**
 * Pack a minimal panel .zipt (no blobs needed — the command reads bores from the
 * doc's manifest, not from OCCT, so a stub manifest is sufficient for tests).
 */
async function makeDrawerFrontZipt(id: string): Promise<Uint8Array> {
  const doc: Partial<PartDocument> = {
    id,
    name: id,
    units: 'mm',
    parameters: {},
    featureTree: [{
      kind: 'panel',
      id: 'panel',
      length: { kind: 'literal', value: FRONT_H },
      width: { kind: 'literal', value: FRONT_W },
      thickness: { kind: 'literal', value: FRONT_T },
      thicknessFromMaterial: false,
      materialId: 'm',
      grain: 'length' as const,
      edgeBands: { front: null, back: null, left: null, right: null },
    } as unknown as import('@zilventor/shared').Feature],
    bores: [],
    properties: {},
    materials: [],
    hardware: [],
  };
  return packProject({
    manifest: { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc },
    blobs: {},
  });
}

/**
 * Seeds a full cabinet assembly with N drawer fronts into MemOpfs.
 * Sets the active document + subAssemblyDocs (required by AddDrawerBankCommand.reloadCabinet pattern).
 * Returns cabinetPath.
 */
async function seedCabinetWithFronts(opfs: MemOpfs, n: number): Promise<string> {
  const frontComponents: AssemblyDocument['components'] = [];

  for (let i = 0; i < n; i++) {
    const frontId = `front-${i}`;
    const frontPath = `parts/${frontId}.zipt`;
    await opfs.write(frontPath, await makeDrawerFrontZipt(frontId));

    frontComponents.push({
      id: `DF-${i}`,
      partPath: frontPath,
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
      // Front center translation.y = dims.depth (per drawerFrontMath line 97)
      pose: {
        translation: { x: 150, y: CABINET_DEPTH, z: 100 + i * 100 },
        quaternion: [0.5, 0.5, 0.5, -0.5],
      },
      role: 'drawerFront' as const,
    });
  }

  const cabinet: AssemblyDocument = {
    id: 'CAB1',
    name: 'Cabinet',
    units: 'mm',
    parameters: {},
    properties: {},
    components: frontComponents,
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    materials: [],
    hardware: [],
  };

  const cabinetPath = 'Cabinet.ziasm';
  await opfs.write(cabinetPath, await packAssembly(cabinet, new Uint8Array()));

  // Wire into store (needed by reloadCabinet in the command)
  const top: AssemblyDocument = {
    id: 'TOP1',
    name: 'Room',
    units: 'mm',
    parameters: {},
    properties: {},
    components: [{ id: 'T1', partPath: cabinetPath, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
    constraints: [],
    groundedComponentPaths: [['T1']],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    materials: [],
    hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: top });
  useAppStore.getState().setSubAssemblyDocs({ [cabinetPath]: cabinet });

  return cabinetPath;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AddDrawerHandlesCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setSubAssemblyDocs({});
  });

  it('F1-apply-parts: writes hardware/bar-pull-128.zipt and adds N=2 drawerHandle components', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinetWithFronts(opfs, 2);

    const cmd = new AddDrawerHandlesCommand({
      cabinetPath,
      cc: 128,
      opfs,
    });
    await cmd.apply();

    // Hardware .zipt must be written
    expect(opfs.has('hardware/bar-pull-128.zipt')).toBe(true);

    // Cabinet must now have 2 drawerFront + 2 drawerHandle components (= 4 total)
    const updatedCab = await unpackAssembly(await opfs.read(cabinetPath));
    const handleComps = updatedCab.components.filter((c) => c.role === 'drawerHandle');
    expect(handleComps).toHaveLength(2);
    // All handle comps reference the same hardware path
    for (const hc of handleComps) {
      expect(hc.partPath).toBe('hardware/bar-pull-128.zipt');
    }
    // Pull has identity quaternion [0,0,0,1]
    for (const hc of handleComps) {
      expect(hc.pose?.quaternion).toEqual([0, 0, 0, 1]);
    }
  });

  it('F2-apply-bores: each front gets exactly 2 handleScrew bores with distinct connectorIds', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinetWithFronts(opfs, 2);

    const cmd = new AddDrawerHandlesCommand({ cabinetPath, cc: 128, opfs });
    await cmd.apply();

    // Reload the cabinet to find front paths
    const updatedCab = await unpackAssembly(await opfs.read(cabinetPath));
    const frontComps = updatedCab.components.filter((c) => c.role === 'drawerFront');
    expect(frontComps).toHaveLength(2);

    for (const fc of frontComps) {
      const bores = await boresOf(opfs, fc.partPath);
      const handleBores = bores.filter((b) => b.connectorKind === 'handleScrew');
      // Each front must have exactly 2 handleScrew bores
      expect(handleBores).toHaveLength(2);
      // Bores must have correct properties
      expect(handleBores[0]!.diameter).toBe(5);
      expect(handleBores[0]!.depth).toBe('throughAll');
      // §13.4 / PC-1: connectorIds DISTINCT per bore (BOM = 2 per pull)
      expect(handleBores[0]!.connectorId).not.toBe(handleBores[1]!.connectorId);
    }
  });

  it('F3-apply-distinctIds: 2N=4 total handleScrew bores across 2 fronts, all connectorIds distinct', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinetWithFronts(opfs, 2);

    const cmd = new AddDrawerHandlesCommand({ cabinetPath, cc: 128, opfs });
    await cmd.apply();

    const updatedCab = await unpackAssembly(await opfs.read(cabinetPath));
    const frontComps = updatedCab.components.filter((c) => c.role === 'drawerFront');

    const allHandleConnectorIds: string[] = [];
    for (const fc of frontComps) {
      const bores = await boresOf(opfs, fc.partPath);
      const handleBores = bores.filter((b) => b.connectorKind === 'handleScrew');
      for (const b of handleBores) {
        allHandleConnectorIds.push(b.connectorId);
      }
    }

    // Total 2*N = 4 bores
    expect(allHandleConnectorIds).toHaveLength(4);
    // ALL connectorIds must be distinct (no cross-front collision)
    expect(new Set(allHandleConnectorIds).size).toBe(4);
  });

  it('F4-revert-structural: after revert, re-reading each front .zipt shows 0 handleScrew bores and pull comps gone', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinetWithFronts(opfs, 2);

    const cmd = new AddDrawerHandlesCommand({ cabinetPath, cc: 128, opfs });
    await cmd.apply();
    await cmd.revert();

    // Re-read cabinet from OPFS (structural check — not in-memory state)
    const revertedCab = await unpackAssembly(await opfs.read(cabinetPath));
    const handleComps = revertedCab.components.filter((c) => c.role === 'drawerHandle');
    // Pull components must be gone
    expect(handleComps).toHaveLength(0);

    // Re-read each front .zipt (structural undo — real bytes, not component count)
    const frontComps = revertedCab.components.filter((c) => c.role === 'drawerFront');
    for (const fc of frontComps) {
      const bores = await boresOf(opfs, fc.partPath);
      const handleBores = bores.filter((b) => b.connectorKind === 'handleScrew');
      // After revert, zero handleScrew bores
      expect(handleBores).toHaveLength(0);
    }
  });

  it('F5-no-fronts: cabinet with zero drawerFront components → no-op (no throw, no pull comps)', async () => {
    const opfs = new MemOpfs();
    const cabinetPath = await seedCabinetWithFronts(opfs, 0); // N=0

    const cmd = new AddDrawerHandlesCommand({ cabinetPath, cc: 128, opfs });
    await expect(cmd.apply()).resolves.not.toThrow();

    const updatedCab = await unpackAssembly(await opfs.read(cabinetPath));
    const handleComps = updatedCab.components.filter((c) => c.role === 'drawerHandle');
    expect(handleComps).toHaveLength(0);
  });
});
