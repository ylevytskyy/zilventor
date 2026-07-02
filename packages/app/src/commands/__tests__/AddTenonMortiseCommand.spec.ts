// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AddTenonMortiseCommand } from '../AddTenonMortiseCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AssemblyDocument, Feature, PartDocument, TenonMortiseFeature } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
}

async function writePanel(
  opfs: MemOpfs, path: string, length: number, width: number, thickness: number,
  extra?: Partial<PartDocument>,
) {
  const doc: Partial<PartDocument> = {
    id: `uuid-${path}-deadbeef`, name: path, units: 'mm', parameters: {},
    featureTree: [{ kind: 'panel', id: 'panel', length, width, thickness, materialId: 'm', edgeBands: {} } as unknown as Feature],
    ...extra,
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

async function tenonMortisesOf(opfs: MemOpfs, path: string): Promise<TenonMortiseFeature[]> {
  const project = await unpackProject(await opfs.read(path));
  const doc = (project.manifest as { document: PartDocument }).document;
  return doc.featureTree.filter((f): f is TenonMortiseFeature => f.kind === 'tenonMortise');
}

// Two panels forming a butt joint (same geometry as AddManualJointBoresCommand.spec.ts):
// L.zipt: side panel — thin in X (length=18, width=720, thickness=560), face-host (→ mortise).
// B.zipt: horizontal panel — thin in Z (length=564, width=560, thickness=18), end-host (→ tenon).
function seedTwoPanels(): AssemblyDocument {
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

const PARAMS = { width: 20, depth: 12, count: 2, spacing: 60, fitClearance: 0.2 };

describe('AddTenonMortiseCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('appends a mortise feature to the face-host panel and a tenon feature to the end-host panel, sharing pairId', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, 'L.zipt', 18, 720, 560);
    await writePanel(opfs, 'B.zipt', 564, 560, 18);
    seedTwoPanels();

    await new AddTenonMortiseCommand({
      panelPathA: 'L.zipt', panelPathB: 'B.zipt', params: PARAMS, opfs,
    }).apply();

    const mortises = await tenonMortisesOf(opfs, 'L.zipt');
    const tenons = await tenonMortisesOf(opfs, 'B.zipt');
    expect(mortises).toHaveLength(1);
    expect(tenons).toHaveLength(1);

    const mortise = mortises[0]!;
    const tenon = tenons[0]!;
    expect(mortise).toMatchObject({
      kind: 'tenonMortise', role: 'mortise', faceRole: 'Right',
      width: 20, depth: 12, count: 2, spacing: 60, fitClearance: 0.2,
    });
    expect(tenon).toMatchObject({
      kind: 'tenonMortise', role: 'tenon', faceRole: 'Left',
      width: 20, depth: 12, count: 2, spacing: 60, fitClearance: 0.2,
    });

    // pairId links both sides.
    expect(mortise.pairId).toBe(tenon.pairId);
    expect(mortise.id).not.toBe(tenon.id);

    // crossPosition/crossSpan are part of the mortise spec (bounds the pocket to the
    // mating panel's end footprint) and MUST be absent on the tenon (exactOptionalPropertyTypes
    // absent-not-zero contract — the tenon's own full thickness IS the full cross extent).
    expect(mortise.crossPosition).toBeCloseTo(9); // crossCoord(tenon-host thickness=18) = 9
    expect(mortise.crossSpan).toBe(18);
    expect('crossPosition' in tenon).toBe(false);
    expect('crossSpan' in tenon).toBe(false);
  });

  it('is a no-op when the two panels do not form a butt joint', async () => {
    const opfs = new MemOpfs();
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

    await new AddTenonMortiseCommand({
      panelPathA: 'L.zipt', panelPathB: 'B.zipt', params: PARAMS, opfs,
    }).apply();

    expect(await tenonMortisesOf(opfs, 'L.zipt')).toEqual([]);
    expect(await tenonMortisesOf(opfs, 'B.zipt')).toEqual([]);
  });

  it('preserves pre-existing bores on either panel through apply AND revert', async () => {
    const opfs = new MemOpfs();
    const priorBoreL = { id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
      u: 30, v: 9, diameter: 8, depth: 20, role: 'dowel-edge', connectorId: 'c1', connectorKind: 'dowel' };
    await writePanel(opfs, 'L.zipt', 18, 720, 560, { bores: [priorBoreL] } as unknown as Partial<PartDocument>);
    await writePanel(opfs, 'B.zipt', 564, 560, 18);
    seedTwoPanels();
    const cmd = new AddTenonMortiseCommand({
      panelPathA: 'L.zipt', panelPathB: 'B.zipt', params: PARAMS, opfs,
    });

    await cmd.apply();
    const afterApplyL = await unpackProject(await opfs.read('L.zipt'));
    const docAfterApply = (afterApplyL.manifest as { document: PartDocument & { bores?: unknown[] } }).document;
    expect(docAfterApply.bores).toEqual([priorBoreL]);
    expect(docAfterApply.featureTree.some((f) => f.kind === 'tenonMortise')).toBe(true);

    await cmd.revert();
    const afterRevertL = await unpackProject(await opfs.read('L.zipt'));
    const docAfterRevert = (afterRevertL.manifest as { document: PartDocument & { bores?: unknown[] } }).document;
    expect(docAfterRevert.bores).toEqual([priorBoreL]);
    expect(docAfterRevert.featureTree.some((f) => f.kind === 'tenonMortise')).toBe(false);
  });

  it('revert() restores byte-identical prior manifests on both files', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, 'L.zipt', 18, 720, 560);
    await writePanel(opfs, 'B.zipt', 564, 560, 18);
    seedTwoPanels();
    const priorL = opfs.files.get('L.zipt')!.slice();
    const priorB = opfs.files.get('B.zipt')!.slice();

    const cmd = new AddTenonMortiseCommand({
      panelPathA: 'L.zipt', panelPathB: 'B.zipt', params: PARAMS, opfs,
    });
    await cmd.apply();
    expect(await tenonMortisesOf(opfs, 'L.zipt')).toHaveLength(1);

    await cmd.revert();

    expect(opfs.files.get('L.zipt')).toEqual(priorL);
    expect(opfs.files.get('B.zipt')).toEqual(priorB);
    expect(await tenonMortisesOf(opfs, 'L.zipt')).toEqual([]);
    expect(await tenonMortisesOf(opfs, 'B.zipt')).toEqual([]);
  });

  it('apply() calls boreCacheInvalidator with both panel paths', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, 'L.zipt', 18, 720, 560);
    await writePanel(opfs, 'B.zipt', 564, 560, 18);
    seedTwoPanels();

    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    await new AddTenonMortiseCommand({
      panelPathA: 'L.zipt', panelPathB: 'B.zipt', params: PARAMS, opfs,
    }).apply();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]!.sort()).toEqual(['B.zipt', 'L.zipt']);
  });

  it('revert() calls boreCacheInvalidator with both panel paths', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, 'L.zipt', 18, 720, 560);
    await writePanel(opfs, 'B.zipt', 564, 560, 18);
    seedTwoPanels();

    const cmd = new AddTenonMortiseCommand({
      panelPathA: 'L.zipt', panelPathB: 'B.zipt', params: PARAMS, opfs,
    });
    await cmd.apply();

    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    await cmd.revert();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]!.sort()).toEqual(['B.zipt', 'L.zipt']);
  });
});
