// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AddManualShelfPinBoresCommand } from '../AddManualShelfPinBoresCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION, DEFAULT_SHELF_PIN_PARAMS } from '@zilventor/shared';
import type { BoreOp, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async exists(p: string) { return this.files.has(p); }
}

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

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

const H = 720, D = 560, Tc = 18;
const PANEL = 'Custom Side.zipt';

describe('AddManualShelfPinBoresCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('drills shelfPin bores into the chosen panel on the chosen face', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, PANEL, H, D, Tc);

    await new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Top', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    }).apply();

    const bores = await boresOf(opfs, PANEL);
    expect(bores.length).toBeGreaterThan(0);
    for (const b of bores) {
      expect(b.connectorKind).toBe('shelfPin');
      expect(b.role).toBe('shelfPin-system32');
      expect(b.face.role).toBe('Top');          // honours the chosen face
      expect(b.depth).toBe(DEFAULT_SHELF_PIN_PARAMS.depth); // blind, number
      expect(b.u).toBeGreaterThanOrEqual(0);
      expect(b.u).toBeLessThanOrEqual(H);
      expect(b.v).toBeGreaterThanOrEqual(0);
      expect(b.v).toBeLessThanOrEqual(D);
    }
  });

  it('passing face:"Bottom" authors bores on the Bottom face', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, PANEL, H, D, Tc);
    await new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Bottom', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    }).apply();
    for (const b of await boresOf(opfs, PANEL)) expect(b.face.role).toBe('Bottom');
  });

  it('appends to existing bores rather than replacing them', async () => {
    const opfs = new MemOpfs();
    const seedBore: BoreOp = {
      id: 'pre', face: { featureId: 'panel', role: 'Front', instance: 0 },
      u: 10, v: 10, diameter: 5, depth: 12,
      role: 'dowel-face', connectorId: 'pre-conn', connectorKind: 'dowel',
    };
    await writePanel(opfs, PANEL, H, D, Tc, [seedBore]);

    await new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Top', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    }).apply();

    const bores = await boresOf(opfs, PANEL);
    expect(bores[0]).toEqual(seedBore);                       // existing preserved, first
    expect(bores.length).toBeGreaterThan(1);
    expect(bores.slice(1).every((b) => b.connectorKind === 'shelfPin')).toBe(true);
  });

  it('revert() removes the bores key when the panel had none before', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, PANEL, H, D, Tc);
    const cmd = new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Top', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    });
    await cmd.apply();
    expect((await boresOf(opfs, PANEL)).length).toBeGreaterThan(0);

    await cmd.revert();

    const project = await unpackProject(await opfs.read(PANEL));
    const doc = (project.manifest as { document: Record<string, unknown> }).document;
    expect('bores' in doc).toBe(false);
  });

  it('revert() restores prior bores when the panel already had some', async () => {
    const opfs = new MemOpfs();
    const seedBore: BoreOp = {
      id: 'pre', face: { featureId: 'panel', role: 'Front', instance: 0 },
      u: 10, v: 10, diameter: 5, depth: 12,
      role: 'dowel-face', connectorId: 'pre-conn', connectorKind: 'dowel',
    };
    await writePanel(opfs, PANEL, H, D, Tc, [seedBore]);
    const cmd = new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Top', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    });
    await cmd.apply();

    await cmd.revert();
    expect(await boresOf(opfs, PANEL)).toEqual([seedBore]);
  });

  it('apply() and revert() each invalidate the panel path once', async () => {
    const opfs = new MemOpfs();
    await writePanel(opfs, PANEL, H, D, Tc);
    const cmd = new AddManualShelfPinBoresCommand({
      panelPath: PANEL, face: 'Top', params: DEFAULT_SHELF_PIN_PARAMS, opfs,
    });

    const spyApply = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spyApply);
    await cmd.apply();
    expect(spyApply).toHaveBeenCalledTimes(1);
    expect(spyApply.mock.calls[0]![0]).toEqual([PANEL]);

    const spyRevert = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spyRevert);
    await cmd.revert();
    expect(spyRevert).toHaveBeenCalledTimes(1);
    expect(spyRevert.mock.calls[0]![0]).toEqual([PANEL]);
  });
});
