// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GenerateCarcassBoresCommand } from '../GenerateCarcassBoresCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PanelRole, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
}

/**
 * Write a minimal panel .zipt. dims are in WORLD-AXIS convention:
 *   length = X-span, width = Y-span, thickness = Z-span.
 * This matches what GenerateCarcassBoresCommand reads back for worldAABB construction.
 */
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

function instance(
  id: string, partPath: string, role: PanelRole,
  pos: { x: number; y: number; z: number },
) {
  return { id, partPath, position: pos, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, role };
}

/**
 * Cabinet fixture — 600×560×720mm carcass, T=18mm.
 *
 * Panels are authored with WORLD-AXIS dims (L=X-span, W=Y-span, T=Z-span) and
 * CORNER positions, so that GenerateCarcassBoresCommand's center-correction
 * ({x+L/2, y+W/2, z+T/2}) produces geometrically correct world AABBs that
 * contact each other:
 *
 *   Left  side: x∈[0,18],    y∈[0,560], z∈[0,720]  — thin in X
 *   Right side: x∈[582,600], y∈[0,560], z∈[0,720]  — thin in X
 *   Bottom:     x∈[18,582],  y∈[0,560], z∈[0,18]   — thin in Z
 *   Top:        x∈[18,582],  y∈[0,560], z∈[702,720] — thin in Z
 *
 * Side inner face (x=18) touches Bottom/Top left end (x=18) → X-axis butt joints.
 * Right side inner face (x=582) touches Bottom/Top right end (x=582) → X-axis butt joints.
 * This is the REALISTIC POSE TEST: non-centered positions, correct world contacts.
 */
function seedCabinetAssembly(opfs: MemOpfs): AssemblyDocument {
  const W = 600, T = 18;
  const doc: AssemblyDocument = {
    id: 'A1', name: 'Cab', units: 'mm', parameters: {}, properties: {},
    components: [
      instance('C1', 'L.zipt', 'leftSide',  { x: 0,     y: 0, z: 0 }),
      instance('C2', 'R.zipt', 'rightSide', { x: W - T, y: 0, z: 0 }),
      instance('C3', 'B.zipt', 'bottom',    { x: T,     y: 0, z: 0 }),
      instance('C4', 'T.zipt', 'top',       { x: T,     y: 0, z: 720 - T }),
    ],
    constraints: [], groundedComponentPaths: [['C1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
  return doc;
}

async function writeCabinetPanels(opfs: MemOpfs) {
  const W = 600, D = 560, H = 720, T = 18;
  // dims: L=X-span, W=Y-span, T=Z-span  (WORLD-AXIS convention)
  await writePanel(opfs, 'L.zipt', T,         D, H);       // Left  side: 18×560×720
  await writePanel(opfs, 'R.zipt', T,         D, H);       // Right side: 18×560×720
  await writePanel(opfs, 'B.zipt', W - 2 * T, D, T);       // Bottom:     564×560×18
  await writePanel(opfs, 'T.zipt', W - 2 * T, D, T);       // Top:        564×560×18
}

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

const PARAMS = {
  endSetback: 60, maxSpacing: 250, minCount: 2,
  confirmat: true, minifix: false, dowel: false,
};

describe('GenerateCarcassBoresCommand — auto', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('writes bores to the involved panels and links A/B by connectorId', async () => {
    const opfs = new MemOpfs();
    await writeCabinetPanels(opfs);
    seedCabinetAssembly(opfs);

    await new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply();

    const lBores = await boresOf(opfs, 'L.zipt');
    const bBores = await boresOf(opfs, 'B.zipt');
    expect(lBores.length).toBeGreaterThan(0);
    expect(bBores.length).toBeGreaterThan(0);
    // A-side and B-side bores share connectorIds
    const lConn = new Set(lBores.map((x) => x.connectorId));
    const bConn = new Set(bBores.map((x) => x.connectorId));
    expect([...bConn].some((id) => lConn.has(id))).toBe(true);
    // all confirmat
    expect(lBores.every((b) => b.connectorKind === 'confirmat')).toBe(true);
  });

  it('right side bores mirror the left side count', async () => {
    const opfs = new MemOpfs();
    await writeCabinetPanels(opfs);
    seedCabinetAssembly(opfs);
    await new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply();
    expect((await boresOf(opfs, 'L.zipt')).length).toBe((await boresOf(opfs, 'R.zipt')).length);
  });

  it('REALISTIC-POSE: corner positions with center-correction produce correct joints', async () => {
    // Verify that the 4-panel fixture produces joints at both the bottom AND top,
    // on BOTH sides — 4 joints total → bores on all 4 panels.
    const opfs = new MemOpfs();
    await writeCabinetPanels(opfs);
    seedCabinetAssembly(opfs);
    await new GenerateCarcassBoresCommand({ params: PARAMS, opfs }).apply();

    for (const path of ['L.zipt', 'R.zipt', 'B.zipt', 'T.zipt']) {
      expect((await boresOf(opfs, path)).length).toBeGreaterThan(0);
    }
    // Left+right sides get bores from BOTH bottom and top joints → more bores than one joint alone
    // joint length = H = 720mm, setback=60, maxSpacing=250 → usable=600, count=max(2,ceil(600/250)+1)=4 bores/joint
    // Each side has 2 joints (bottom+top) × 4 bores = 8 confirmat-face bores on each side face
    const lBores = await boresOf(opfs, 'L.zipt');
    const bBores = await boresOf(opfs, 'B.zipt');
    // joint length for side-bottom: Z overlap = [0,18], along Z-other or X-other?
    // Actually joint line runs along the LONGEST overlap axis.
    // For left-side ↔ bottom joint: X contact at x=18.
    // Other axes: Y overlap [0,560] len=560, Z overlap [0,18] len=18 → lineAxis=Y (len=560).
    // So joint length=560, setback=60 → usable=440, count=max(2,ceil(440/250)+1)=max(2,3)=3 per joint.
    // Left side has 2 joints (bottom+top) × 3 bores = 6 confirmat-face bores minimum.
    expect(lBores.length).toBeGreaterThanOrEqual(6);
    expect(bBores.length).toBeGreaterThanOrEqual(3);
  });
});
