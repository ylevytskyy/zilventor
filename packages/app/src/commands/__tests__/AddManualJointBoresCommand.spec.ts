// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { AddManualJointBoresCommand } from '../AddManualJointBoresCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, BoreOp, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
}
async function writePanel(opfs: MemOpfs, path: string, length: number, width: number, thickness: number) {
  const doc: Partial<PartDocument> = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree: [{ kind: 'panel', id: 'panel', length, width, thickness, materialId: 'm', edgeBands: {} } as unknown as import('@zilventor/shared').Feature],
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}
async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}
// Two panels forming a butt joint using standard L→X, W→Y, T→Z panel-local convention.
// L.zipt: side panel — thin in X (L=18 in X direction).
//   writePanel(L.zipt, length=18, width=720, thickness=560)
//   center = {9, 360, 280}, AABB: x[0,18], y[0,720], z[0,560], thin axis=X
// B.zipt: horizontal panel — thin in Z (T=18 in Z direction).
//   writePanel(B.zipt, length=564, width=560, thickness=18)
//   corner at {18,0,0}, center = {300, 280, 9}, AABB: x[18,582], y[0,560], z[0,18], thin axis=Z
// Contact: L.max.x = 18 = B.min.x ✓, overlap Y[0,560] ✓, overlap Z[0,18] ✓ → valid butt joint.
function seedTwoPanels(opfs: MemOpfs): AssemblyDocument {
  const T = 18;
  const doc: AssemblyDocument = {
    id: 'A1', name: 'Cab', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'C1', partPath: 'L.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'C3', partPath: 'B.zipt', position: { x: T, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [], groundedComponentPaths: [['C1']], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
  return doc;
}
const PARAMS = { endSetback: 60, maxSpacing: 250, minCount: 2 };

describe('AddManualJointBoresCommand', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('appends linked bores to both picked panels for a valid butt joint', async () => {
    const opfs = new MemOpfs();
    // L: side slab thin in X (length=18, width=720, thickness=560); B: horiz panel thin in Z (length=564, width=560, thickness=18).
    await writePanel(opfs, 'L.zipt', 18, 720, 560);
    await writePanel(opfs, 'B.zipt', 564, 560, 18);
    seedTwoPanels(opfs);

    await new AddManualJointBoresCommand({
      panelPathA: 'L.zipt', panelPathB: 'B.zipt', kind: 'confirmat', params: PARAMS, opfs,
    }).apply();

    const a = await boresOf(opfs, 'L.zipt');
    const b = await boresOf(opfs, 'B.zipt');
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.every((x) => x.connectorKind === 'confirmat')).toBe(true);
    const aConn = new Set(a.map((x) => x.connectorId));
    expect(b.some((x) => aConn.has(x.connectorId))).toBe(true);
  });

  it('is a no-op when the two panels do not form a butt joint', async () => {
    const opfs = new MemOpfs();
    // Two far-apart panels (5000mm gap) — inferManualJoint returns null.
    await writePanel(opfs, 'L.zipt', 18, 720, 560);
    await writePanel(opfs, 'B.zipt', 564, 560, 18);
    const doc: AssemblyDocument = {
      id: 'A1', name: 'Cab', units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: 'L.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'B.zipt', position: { x: 5000, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [], groundedComponentPaths: [['C1']], colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });

    await new AddManualJointBoresCommand({
      panelPathA: 'L.zipt', panelPathB: 'B.zipt', kind: 'confirmat', params: PARAMS, opfs,
    }).apply();

    expect(await boresOf(opfs, 'L.zipt')).toEqual([]);
    expect(await boresOf(opfs, 'B.zipt')).toEqual([]);
  });
});

describe('AddManualJointBoresCommand — revert', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('removes the bores key on both panels when they had none before', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, 'L.zipt', 18, 720, 560);
    await writePanel(opfs, 'B.zipt', 564, 560, 18);
    seedTwoPanels(opfs);
    const cmd = new AddManualJointBoresCommand({
      panelPathA: 'L.zipt', panelPathB: 'B.zipt', kind: 'confirmat', params: PARAMS, opfs,
    });
    await cmd.apply();
    expect((await boresOf(opfs, 'L.zipt')).length).toBeGreaterThan(0);

    await cmd.revert();

    for (const p of ['L.zipt', 'B.zipt']) {
      const project = await unpackProject(await opfs.read(p));
      const doc = (project.manifest as { document: Record<string, unknown> }).document;
      expect('bores' in doc).toBe(false);
    }
  });
});
