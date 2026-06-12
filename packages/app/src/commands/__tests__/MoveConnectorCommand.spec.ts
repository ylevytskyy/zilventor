// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MoveConnectorCommand } from '../MoveConnectorCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { BoreOp, PartDocument } from '@zilventor/shared';

// Minimal stub for connectorCoupling if not yet implemented in shared.
// translateConnectorAlong mutates bore.u by delta along worldDir.
// For tests: worldDir={x:1,y:0,z:0}, panelDims irrelevant, pose identity.
// We mock the module so MoveConnectorCommand calls the stub.
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    translateConnectorAlong: (
      members: Array<{ bore: BoreOp; panelDims: unknown; worldPose: unknown }>,
      worldDir: { x: number; y: number; z: number },
      delta: number,
    ) => {
      // Simplified: move bore.u by delta * worldDir.x (sufficient for unit tests).
      for (const m of members) {
        m.bore.u += delta * worldDir.x;
        m.bore.v += delta * worldDir.y;
      }
    },
  };
});

class MemOpfs {
  files = new Map<string, Uint8Array>();
  private writeLog: string[] = [];
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.writeLog.push(p); this.files.set(p, b); }
  getWriteLog() { return [...this.writeLog]; }
  clearWriteLog() { this.writeLog = []; }
}

async function writePanel(opfs: MemOpfs, path: string, bores: BoreOp[]) {
  const doc: Partial<PartDocument> = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree: [], bores,
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

function makeBore(id: string, connectorId: string, u = 100, overrides: Partial<BoreOp> = {}): BoreOp {
  return {
    id, face: { featureId: 'panel', role: 'Front', instance: 0 },
    u, v: 9, diameter: 7, depth: 12,
    role: 'confirmat-face', connectorId, connectorKind: 'confirmat',
    jointDir: { x: 1, y: 0, z: 0 },
    ...overrides,
  } as BoreOp;
}

const IDENTITY_POSE = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] };
const PANEL_DIMS = { length: 600, width: 560, thickness: 18 };

describe('MoveConnectorCommand', () => {
  beforeEach(() => { useAppStore.getState().setBoreCacheInvalidator(null); });

  it('moves bore.u by delta on apply (via translateConnectorAlong stub)', async () => {
    const bore = makeBore('b1', 'c0');
    const doc = { bores: [bore] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...bore }]);

    const cmd = new MoveConnectorCommand({
      members: [{ bore, partPath: 'p.zipt', doc, panelDims: PANEL_DIMS, worldPose: IDENTITY_POSE }],
      worldDir: { x: 1, y: 0, z: 0 },
      delta: 10,
      opfs,
    });
    await cmd.apply();

    expect(bore.u).toBe(110);
    expect(bore.edited).toBe(true);
  });

  it('revert restores bore.u and removes edited key if it was absent before', async () => {
    const bore = makeBore('b1', 'c0');
    const doc = { bores: [bore] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...bore }]);

    const cmd = new MoveConnectorCommand({
      members: [{ bore, partPath: 'p.zipt', doc, panelDims: PANEL_DIMS, worldPose: IDENTITY_POSE }],
      worldDir: { x: 1, y: 0, z: 0 },
      delta: 10,
      opfs,
    });
    await cmd.apply();
    expect(bore.u).toBe(110);
    await cmd.revert();
    expect(bore.u).toBe(100);
    expect('edited' in bore).toBe(false);
  });

  it('cross-doc: applies to both documents and writes both to opfs', async () => {
    const boreA = makeBore('bA', 'c0', 100);
    const boreB = makeBore('bB', 'c0', 100);
    const docA = { bores: [boreA] };
    const docB = { bores: [boreB] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'a.zipt', [{ ...boreA }]);
    await writePanel(opfs, 'b.zipt', [{ ...boreB }]);
    opfs.clearWriteLog();

    const cmd = new MoveConnectorCommand({
      members: [
        { bore: boreA, partPath: 'a.zipt', doc: docA, panelDims: PANEL_DIMS, worldPose: IDENTITY_POSE },
        { bore: boreB, partPath: 'b.zipt', doc: docB, panelDims: PANEL_DIMS, worldPose: IDENTITY_POSE },
      ],
      worldDir: { x: 1, y: 0, z: 0 },
      delta: 5,
      opfs,
    });
    await cmd.apply();

    // Both bores moved.
    expect(boreA.u).toBe(105);
    expect(boreB.u).toBe(105);
    // Both files written.
    expect(opfs.getWriteLog()).toContain('a.zipt');
    expect(opfs.getWriteLog()).toContain('b.zipt');
  });

  // Correction 6 Gap B: assert OPFS a.zipt bytes are restored on rollback
  it('ATOMIC: rolls back first doc write when second write throws — opfs a.zipt bytes restored + invalidator NOT called', async () => {
    const boreA = makeBore('bA', 'c0', 100);
    const boreB = makeBore('bB', 'c0', 100);
    const docA = { bores: [boreA] };
    const docB = { bores: [boreB] };

    const backing = new MemOpfs();
    await writePanel(backing, 'a.zipt', [{ ...boreA }]);
    await writePanel(backing, 'b.zipt', [{ ...boreB }]);

    // Capture a.zipt original bytes before the command touches it.
    const originalABytes = await backing.read('a.zipt');

    let writeCount = 0;
    const faultyOpfs = {
      files: backing.files,
      async read(p: string) {
        const b = backing.files.get(p);
        if (!b) throw new Error(`no ${p}`);
        return b;
      },
      async write(p: string, b: Uint8Array) {
        writeCount++;
        if (writeCount === 2) throw new Error('DISK_FULL');
        backing.files.set(p, b);
      },
    };

    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    const cmd = new MoveConnectorCommand({
      members: [
        { bore: boreA, partPath: 'a.zipt', doc: docA, panelDims: PANEL_DIMS, worldPose: IDENTITY_POSE },
        { bore: boreB, partPath: 'b.zipt', doc: docB, panelDims: PANEL_DIMS, worldPose: IDENTITY_POSE },
      ],
      worldDir: { x: 1, y: 0, z: 0 },
      delta: 5,
      opfs: faultyOpfs as unknown as Parameters<typeof MoveConnectorCommand.prototype.apply>[never],
    });

    await expect(cmd.apply()).rejects.toThrow('DISK_FULL');

    // Invalidator must NOT have been called (partial write — not committed).
    expect(spy).not.toHaveBeenCalled();

    // In-memory bores reverted.
    expect(boreA.u).toBe(100);
    expect(boreB.u).toBe(100);
    expect('edited' in boreA).toBe(false);

    // OPFS: a.zipt bytes must be restored to pre-command state.
    // (The rollback wrote back priorBytes captured before the first write.)
    const aAfter = await backing.read('a.zipt');
    expect(aAfter).toEqual(originalABytes);
  });

  it('calls boreCacheInvalidator with all affected partPaths on successful apply', async () => {
    const boreA = makeBore('bA', 'c0', 100);
    const docA = { bores: [boreA] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'a.zipt', [{ ...boreA }]);

    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    const cmd = new MoveConnectorCommand({
      members: [{ bore: boreA, partPath: 'a.zipt', doc: docA, panelDims: PANEL_DIMS, worldPose: IDENTITY_POSE }],
      worldDir: { x: 1, y: 0, z: 0 },
      delta: 5,
      opfs,
    });
    await cmd.apply();

    expect(spy).toHaveBeenCalledWith(['a.zipt']);
  });
});
