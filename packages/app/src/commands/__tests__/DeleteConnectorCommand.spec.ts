// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeleteConnectorCommand } from '../DeleteConnectorCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { BoreOp, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  private writeLog: string[] = [];
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.writeLog.push(p); this.files.set(p, b); }
  getWriteLog() { return [...this.writeLog]; }
  clearWriteLog() { this.writeLog = []; }
}

async function writePanel(
  opfs: MemOpfs, path: string,
  bores: BoreOp[],
  suppressedConnectorIds?: string[],
) {
  const doc: Partial<PartDocument> & { suppressedConnectorIds?: string[] } = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree: [], bores,
    ...(suppressedConnectorIds ? { suppressedConnectorIds } : {}),
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

async function docOf(opfs: MemOpfs, path: string) {
  const project = await unpackProject(await opfs.read(path));
  return (project.manifest as { document: Record<string, unknown> }).document;
}

function makeBore(id: string, connectorId: string, overrides: Partial<BoreOp> = {}): BoreOp {
  return {
    id, face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 10, v: 5, diameter: 7, depth: 12,
    role: 'confirmat-face', connectorId, connectorKind: 'confirmat',
    ...overrides,
  } as BoreOp;
}

describe('DeleteConnectorCommand — mode:connector', () => {
  beforeEach(() => { useAppStore.getState().setBoreCacheInvalidator(null); });

  it('removes all bores with matching connectorId from doc', async () => {
    const b1 = makeBore('b1', 'c0');
    const b2 = makeBore('b2', 'c0');
    const b3 = makeBore('b3', 'c1');
    const doc = { bores: [b1, b2, b3], } as { bores: BoreOp[]; suppressedConnectorIds?: string[] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [b1, b2, b3]);

    const cmd = new DeleteConnectorCommand({
      targetId: 'c0', mode: 'connector',
      affectedDocs: [{ partPath: 'p.zipt', doc }],
      opfs,
    });
    await cmd.apply();

    expect(doc.bores).toHaveLength(1);
    expect(doc.bores![0]!.connectorId).toBe('c1');
    expect(doc.suppressedConnectorIds).toContain('c0');
  });

  it('persists removal to opfs (bores key reflects deleted bores)', async () => {
    const b1 = makeBore('b1', 'c0');
    const b2 = makeBore('b2', 'c1');
    const doc = { bores: [b1, b2], } as { bores: BoreOp[]; suppressedConnectorIds?: string[] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [b1, b2]);

    const cmd = new DeleteConnectorCommand({
      targetId: 'c0', mode: 'connector',
      affectedDocs: [{ partPath: 'p.zipt', doc }],
      opfs,
    });
    await cmd.apply();

    const persisted = await docOf(opfs, 'p.zipt');
    const bores = (persisted.bores as BoreOp[] | undefined) ?? [];
    expect(bores.every((b) => b.connectorId !== 'c0')).toBe(true);
    const suppressed = persisted.suppressedConnectorIds as string[] | undefined;
    expect(suppressed).toContain('c0');
  });

  it('revert restores prior bores[] and removes suppressedConnectorId if it was absent before', async () => {
    const b1 = makeBore('b1', 'c0');
    const b2 = makeBore('b2', 'c1');
    const doc = { bores: [b1, b2], } as { bores: BoreOp[]; suppressedConnectorIds?: string[] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [b1, b2]);

    const cmd = new DeleteConnectorCommand({
      targetId: 'c0', mode: 'connector',
      affectedDocs: [{ partPath: 'p.zipt', doc }],
      opfs,
    });
    await cmd.apply();
    await cmd.revert();

    expect(doc.bores).toHaveLength(2);
    // suppressedConnectorIds was absent before — key must be absent after revert
    expect('suppressedConnectorIds' in doc).toBe(false);
  });

  it('revert preserves prior suppressedConnectorIds when doc already had some', async () => {
    const b1 = makeBore('b1', 'c0');
    const doc = { bores: [b1], suppressedConnectorIds: ['c-pre'] as string[] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [b1], ['c-pre']);

    const cmd = new DeleteConnectorCommand({
      targetId: 'c0', mode: 'connector',
      affectedDocs: [{ partPath: 'p.zipt', doc }],
      opfs,
    });
    await cmd.apply();
    expect(doc.suppressedConnectorIds).toContain('c-pre');
    expect(doc.suppressedConnectorIds).toContain('c0');

    await cmd.revert();
    // c-pre survives; c0 removed
    expect(doc.suppressedConnectorIds).toEqual(['c-pre']);
  });

  it('absent-not-empty: does NOT write suppressedConnectorIds:[] after revert (deletes key)', async () => {
    const b1 = makeBore('b1', 'c0');
    const doc = { bores: [b1], } as { bores: BoreOp[]; suppressedConnectorIds?: string[] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [b1]);

    const cmd = new DeleteConnectorCommand({
      targetId: 'c0', mode: 'connector',
      affectedDocs: [{ partPath: 'p.zipt', doc }],
      opfs,
    });
    await cmd.apply();
    await cmd.revert();

    const persisted = await docOf(opfs, 'p.zipt');
    expect('suppressedConnectorIds' in persisted).toBe(false);
  });
});

describe('DeleteConnectorCommand — mode:bore', () => {
  it('removes only the single bore by id', async () => {
    const b1 = makeBore('shelf-pin-0', 'pin-col-front');
    const b2 = makeBore('shelf-pin-1', 'pin-col-front');
    const doc = { bores: [b1, b2], } as { bores: BoreOp[]; suppressedConnectorIds?: string[] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [b1, b2]);

    const cmd = new DeleteConnectorCommand({
      targetId: 'shelf-pin-0', mode: 'bore',
      affectedDocs: [{ partPath: 'p.zipt', doc }],
      opfs,
    });
    await cmd.apply();

    expect(doc.bores).toHaveLength(1);
    expect(doc.bores![0]!.id).toBe('shelf-pin-1');
    expect(doc.suppressedConnectorIds).toContain('shelf-pin-0');
  });

  it('revert restores the single deleted bore', async () => {
    const b1 = makeBore('shelf-pin-0', 'pin-col-front');
    const b2 = makeBore('shelf-pin-1', 'pin-col-front');
    const doc = { bores: [b1, b2], } as { bores: BoreOp[]; suppressedConnectorIds?: string[] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [b1, b2]);

    const cmd = new DeleteConnectorCommand({
      targetId: 'shelf-pin-0', mode: 'bore',
      affectedDocs: [{ partPath: 'p.zipt', doc }],
      opfs,
    });
    await cmd.apply();
    await cmd.revert();

    expect(doc.bores).toHaveLength(2);
    expect('suppressedConnectorIds' in doc).toBe(false);
  });

  // Correction 6 Gap C: mode:bore revert persisted state
  it('mode:bore revert: persisted file has bore restored and suppressedConnectorIds absent', async () => {
    const b1 = makeBore('shelf-pin-0', 'pin-col-front');
    const b2 = makeBore('shelf-pin-1', 'pin-col-front');
    const doc = { bores: [b1, b2], } as { bores: BoreOp[]; suppressedConnectorIds?: string[] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [b1, b2]);

    const cmd = new DeleteConnectorCommand({
      targetId: 'shelf-pin-0', mode: 'bore',
      affectedDocs: [{ partPath: 'p.zipt', doc }],
      opfs,
    });
    await cmd.apply();
    await cmd.revert();

    const persisted = await docOf(opfs, 'p.zipt');
    const bores = (persisted.bores as BoreOp[] | undefined) ?? [];
    expect(bores).toHaveLength(2);
    // suppressedConnectorIds was absent before — must be absent after revert in persisted file.
    expect('suppressedConnectorIds' in persisted).toBe(false);
  });
});

describe('DeleteConnectorCommand — cross-doc atomicity', () => {
  it('ATOMIC: rolls back first doc write when second write throws, invalidator NOT called', async () => {
    const b1 = makeBore('b1', 'c0');
    const b2 = makeBore('b2', 'c0');
    const docA = { bores: [b1], } as { bores: BoreOp[]; suppressedConnectorIds?: string[] };
    const docB = { bores: [b2], } as { bores: BoreOp[]; suppressedConnectorIds?: string[] };

    let writeCount = 0;
    const backing = new MemOpfs();
    await writePanel(backing, 'a.zipt', [b1]);
    await writePanel(backing, 'b.zipt', [b2]);

    const faultyOpfs = {
      files: backing.files,
      async read(p: string) {
        const bb = backing.files.get(p);
        if (!bb) throw new Error(`no ${p}`);
        return bb;
      },
      async write(p: string, b: Uint8Array) {
        writeCount++;
        if (writeCount === 2) throw new Error('DISK_FULL');
        backing.files.set(p, b);
      },
    };

    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    const cmd = new DeleteConnectorCommand({
      targetId: 'c0', mode: 'connector',
      affectedDocs: [
        { partPath: 'a.zipt', doc: docA },
        { partPath: 'b.zipt', doc: docB },
      ],
      opfs: faultyOpfs as never,
    });

    await expect(cmd.apply()).rejects.toThrow('DISK_FULL');
    expect(spy).not.toHaveBeenCalled();
    // In-memory state reverted.
    expect(docA.bores).toHaveLength(1);
    expect(docB.bores).toHaveLength(1);
  });

  it('calls boreCacheInvalidator with all affected partPaths on successful apply', async () => {
    const b1 = makeBore('b1', 'c0');
    const doc = { bores: [b1], } as { bores: BoreOp[]; suppressedConnectorIds?: string[] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [b1]);

    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    const cmd = new DeleteConnectorCommand({
      targetId: 'c0', mode: 'connector',
      affectedDocs: [{ partPath: 'p.zipt', doc }],
      opfs,
    });
    await cmd.apply();
    expect(spy).toHaveBeenCalledWith(['p.zipt']);
  });
});
