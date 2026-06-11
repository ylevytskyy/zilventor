// @vitest-environment node
// Characterization guard for §9.D: MoveConnectorCommand is bus-compatible.
// If this test FAILS, the command's apply/revert interface is broken — fix before wiring the panel.
import { describe, it, expect, vi } from 'vitest';
import { createCommandBus } from '../CommandBus';
import { MoveConnectorCommand } from '../MoveConnectorCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { BoreOp, PartDocument } from '@zilventor/shared';

// Reuse the same translateConnectorAlong stub as MoveConnectorCommand.spec.ts
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    translateConnectorAlong: (
      members: Array<{ bore: BoreOp; panelDims: unknown; worldPose: unknown }>,
      worldDir: { x: number; y: number; z: number },
      delta: number,
    ) => {
      for (const m of members) {
        m.bore.u += delta * worldDir.x;
        m.bore.v += delta * worldDir.y;
      }
    },
  };
});

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) {
    const b = this.files.get(p);
    if (!b) throw new Error(`no file: ${p}`);
    return b;
  }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
}

async function writePanel(opfs: MemOpfs, path: string, bores: BoreOp[]) {
  const doc: Partial<PartDocument> = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree: [], bores,
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

function makeBore(id: string, connectorId: string, u = 100): BoreOp {
  return {
    id, face: { featureId: 'panel', role: 'Front', instance: 0 },
    u, v: 9, diameter: 7, depth: 12,
    role: 'confirmat-face', connectorId, connectorKind: 'confirmat',
    jointDir: { x: 1, y: 0, z: 0 },
  } as BoreOp;
}

const IDENTITY_POSE = {
  translation: { x: 0, y: 0, z: 0 },
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
};
const PANEL_DIMS = { length: 600, width: 560, thickness: 18 };

function makeMoveFixture() {
  const boreA = makeBore('bA', 'c0', 100);
  const boreB = makeBore('bB', 'c0', 100);
  const docA = { bores: [boreA] };
  const docB = { bores: [boreB] };
  const opfs = new MemOpfs();

  const members = [
    { bore: boreA, partPath: 'a.zipt', doc: docA, panelDims: PANEL_DIMS, worldPose: IDENTITY_POSE },
    { bore: boreB, partPath: 'b.zipt', doc: docB, panelDims: PANEL_DIMS, worldPose: IDENTITY_POSE },
  ];

  const worldDir = { x: 1, y: 0, z: 0 };

  // readU reads boreA.u (both bores move identically — boreA is the tracked one)
  const readU = () => boreA.u;

  return { members, opfs, worldDir, readU, boreA, boreB, docA, docB };
}

describe('MoveConnectorCommand on the bus (§9.D characterization guard)', () => {
  it('execute moves u, undo restores, redo re-applies', async () => {
    // Set up OPFS with persisted docs (required for apply/revert persistence)
    const { members, opfs, worldDir, readU, boreA, boreB, docA, docB } = makeMoveFixture();
    await writePanel(opfs, 'a.zipt', [{ ...boreA }]);
    await writePanel(opfs, 'b.zipt', [{ ...boreB }]);

    // Suppress boreCacheInvalidator noise
    useAppStore.getState().setBoreCacheInvalidator(null);

    const bus = createCommandBus();
    const before = readU();
    expect(before).toBe(100);

    // execute: applies the command and pushes onto undo stack
    await bus.execute(new MoveConnectorCommand({ members, worldDir, delta: 12, opfs }));
    const afterExecute = readU();
    expect(afterExecute).not.toBe(before); // proves apply() ran — u changed
    expect(afterExecute).toBe(112);       // delta=12 along x, du=1

    // undo: reverts
    await bus.undo();
    expect(readU()).toBe(before);          // restored to 100

    // redo: re-applies
    await bus.redo();
    expect(readU()).not.toBe(before);      // changed again
    expect(readU()).toBe(112);
  });
});
