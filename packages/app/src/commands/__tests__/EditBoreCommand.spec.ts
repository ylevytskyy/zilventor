// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditBoreCommand } from '../EditBoreCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { BoreOp, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
}

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
    id, face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 10, v: 5, diameter: 7, depth: 12,
    role: 'confirmat-face', connectorId: 'c0', connectorKind: 'confirmat',
    ...overrides,
  };
}

describe('EditBoreCommand', () => {
  beforeEach(() => { useAppStore.getState().setBoreCacheInvalidator(null); });

  it('patches u on the live doc reference', () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const cmd = new EditBoreCommand({ bore, patch: { u: 99 }, partPath: 'p.zipt', doc, opfs: null });
    cmd.apply();
    expect(bore.u).toBe(99);
    expect(bore.edited).toBe(true);
  });

  it('patches diameter and depth on the live doc', () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const cmd = new EditBoreCommand({ bore, patch: { diameter: 5, depth: 20 }, partPath: 'p.zipt', doc, opfs: null });
    cmd.apply();
    expect(bore.diameter).toBe(5);
    expect(bore.depth).toBe(20);
    expect(bore.edited).toBe(true);
  });

  it('revert restores patched fields and removes edited key if it was absent before', () => {
    const bore = makeBore(); // no edited key
    const doc = { bores: [bore] };
    const cmd = new EditBoreCommand({ bore, patch: { u: 99, diameter: 5 }, partPath: 'p.zipt', doc, opfs: null });
    cmd.apply();
    expect(bore.u).toBe(99);
    cmd.revert();
    expect(bore.u).toBe(10);
    expect(bore.diameter).toBe(7);
    // exactOptionalPropertyTypes: edited key was absent before — must be absent after revert
    expect('edited' in bore).toBe(false);
  });

  it('revert restores edited=true when bore was already edited before the patch', () => {
    const bore = makeBore('b1', { edited: true, u: 50 });
    const doc = { bores: [bore] };
    const cmd = new EditBoreCommand({ bore, patch: { u: 99 }, partPath: 'p.zipt', doc, opfs: null });
    cmd.apply();
    expect(bore.u).toBe(99);
    cmd.revert();
    expect(bore.u).toBe(50);
    expect(bore.edited).toBe(true);
  });

  it('persists bore to opfs and updates bores[] in the manifest', async () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...bore }]);

    const cmd = new EditBoreCommand({ bore, patch: { u: 77, v: 33 }, partPath: 'p.zipt', doc, opfs });
    await cmd.apply();

    const persisted = await boresOf(opfs, 'p.zipt');
    expect(persisted[0]!.u).toBe(77);
    expect(persisted[0]!.v).toBe(33);
    expect(persisted[0]!.edited).toBe(true);
  });

  it('revert persists restored bore to opfs', async () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...bore }]);

    const cmd = new EditBoreCommand({ bore, patch: { u: 77 }, partPath: 'p.zipt', doc, opfs });
    await cmd.apply();
    await cmd.revert();

    const persisted = await boresOf(opfs, 'p.zipt');
    expect(persisted[0]!.u).toBe(10);
    expect('edited' in persisted[0]!).toBe(false);
  });

  it('calls boreCacheInvalidator on apply and revert', async () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    const cmd = new EditBoreCommand({ bore, patch: { u: 99 }, partPath: 'p.zipt', doc, opfs: null });
    await cmd.apply();
    expect(spy).toHaveBeenCalledWith(['p.zipt']);
    spy.mockClear();
    await cmd.revert();
    expect(spy).toHaveBeenCalledWith(['p.zipt']);
  });

  // Correction 6 Gap A: revert must also delete `edited` key from persisted OPFS file
  it('revert: persisted file has edited key ABSENT (exactOptionalPropertyTypes)', async () => {
    const bore = makeBore(); // no edited key initially
    const doc = { bores: [bore] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...bore }]);

    const cmd = new EditBoreCommand({ bore, patch: { u: 77 }, partPath: 'p.zipt', doc, opfs });
    await cmd.apply();
    await cmd.revert();

    const persisted = await boresOf(opfs, 'p.zipt');
    // After revert the edited key must be absent in the persisted file, not false or undefined.
    expect('edited' in persisted[0]!).toBe(false);
    expect(persisted[0]!.u).toBe(10);
  });
});
