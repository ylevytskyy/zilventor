// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FlipBoreFaceCommand } from '../FlipBoreFaceCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { BoreOp, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
}

const PANEL_DIMS = { length: 800, width: 600, thickness: 18 };

async function writePanel(opfs: MemOpfs, path: string, bores: BoreOp[]) {
  const doc: Partial<PartDocument> = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree: [],
    bores,
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

function makeBore(id = 'b1', overrides: Partial<BoreOp> = {}): BoreOp {
  return {
    id, face: { featureId: 'panel', role: 'Top', instance: 0 },
    u: 10, v: 150, diameter: 7, depth: 12,
    role: 'shelfPin-system32', connectorId: 'c0', connectorKind: 'shelfPin',
    ...overrides,
  };
}

describe('FlipBoreFaceCommand', () => {
  beforeEach(() => { useAppStore.getState().setBoreCacheInvalidator(null); });

  it('flips a Top bore to Bottom with mirrored v and edited:true', async () => {
    const bore = makeBore(); // v=150, Top role, width=600 -> v'=450
    const doc = { bores: [bore] };
    const cmd = new FlipBoreFaceCommand({ bore, panelDims: PANEL_DIMS, partPath: 'p.zipt', doc, opfs: null });
    await cmd.apply();
    expect(bore.face.role).toBe('Bottom');
    expect(bore.v).toBe(450);
    expect(bore.u).toBe(10);
    expect(bore.edited).toBe(true);
  });

  it('apply on a Front-role bore is a full no-op', async () => {
    const bore = makeBore('b1', { face: { featureId: 'panel', role: 'Front', instance: 0 }, u: 3, v: 4 });
    const doc = { bores: [bore] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...bore }]);
    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    const cmd = new FlipBoreFaceCommand({ bore, panelDims: PANEL_DIMS, partPath: 'p.zipt', doc, opfs });
    await cmd.apply();

    expect(bore.face.role).toBe('Front');
    expect(bore.u).toBe(3);
    expect(bore.v).toBe(4);
    expect('edited' in bore).toBe(false);
    expect(spy).not.toHaveBeenCalled();

    const persisted = await boresOf(opfs, 'p.zipt');
    expect(persisted[0]!.face.role).toBe('Front');
    expect('edited' in persisted[0]!).toBe(false);
  });

  it('revert restores face/u/v exactly and restores absent-edited', async () => {
    const bore = makeBore(); // no edited key initially
    const doc = { bores: [bore] };
    const cmd = new FlipBoreFaceCommand({ bore, panelDims: PANEL_DIMS, partPath: 'p.zipt', doc, opfs: null });
    await cmd.apply();
    expect(bore.face.role).toBe('Bottom');
    await cmd.revert();
    expect(bore.face.role).toBe('Top');
    expect(bore.u).toBe(10);
    expect(bore.v).toBe(150);
    expect('edited' in bore).toBe(false);
  });

  it('revert restores edited=true when bore was already edited before the flip', async () => {
    const bore = makeBore('b1', { edited: true });
    const doc = { bores: [bore] };
    const cmd = new FlipBoreFaceCommand({ bore, panelDims: PANEL_DIMS, partPath: 'p.zipt', doc, opfs: null });
    await cmd.apply();
    await cmd.revert();
    expect(bore.face.role).toBe('Top');
    expect(bore.edited).toBe(true);
  });

  it('revert on a no-op apply (Front role) is also a no-op', async () => {
    const bore = makeBore('b1', { face: { featureId: 'panel', role: 'Front', instance: 0 } });
    const doc = { bores: [bore] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...bore }]);
    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    const cmd = new FlipBoreFaceCommand({ bore, panelDims: PANEL_DIMS, partPath: 'p.zipt', doc, opfs });
    await cmd.apply();
    await cmd.revert();

    expect(bore.face.role).toBe('Front');
    expect(spy).not.toHaveBeenCalled();
  });

  it('persists flipped bore to opfs', async () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...bore }]);

    const cmd = new FlipBoreFaceCommand({ bore, panelDims: PANEL_DIMS, partPath: 'p.zipt', doc, opfs });
    await cmd.apply();

    const persisted = await boresOf(opfs, 'p.zipt');
    expect(persisted[0]!.face.role).toBe('Bottom');
    expect(persisted[0]!.v).toBe(450);
    expect(persisted[0]!.edited).toBe(true);
  });

  it('revert persists restored state to opfs', async () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...bore }]);

    const cmd = new FlipBoreFaceCommand({ bore, panelDims: PANEL_DIMS, partPath: 'p.zipt', doc, opfs });
    await cmd.apply();
    await cmd.revert();

    const persisted = await boresOf(opfs, 'p.zipt');
    expect(persisted[0]!.face.role).toBe('Top');
    expect(persisted[0]!.v).toBe(150);
    expect('edited' in persisted[0]!).toBe(false);
  });

  it('calls boreCacheInvalidator on apply and revert for a real flip', async () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    const cmd = new FlipBoreFaceCommand({ bore, panelDims: PANEL_DIMS, partPath: 'p.zipt', doc, opfs: null });
    await cmd.apply();
    expect(spy).toHaveBeenCalledWith(['p.zipt']);
    spy.mockClear();
    await cmd.revert();
    expect(spy).toHaveBeenCalledWith(['p.zipt']);
  });
});
