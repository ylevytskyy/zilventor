// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditKeyholeSlotCommand } from '../EditKeyholeSlotCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { KeyholeSlotFeature, Feature, PartDocument } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
}

async function writePanel(opfs: MemOpfs, path: string, featureTree: Feature[]) {
  const doc: Partial<PartDocument> = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree,
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

async function featureTreeOf(opfs: MemOpfs, path: string): Promise<Feature[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { featureTree?: Feature[] } }).document.featureTree) ?? [];
}

function makeKeyholeSlot(id = 'k1', overrides: Partial<KeyholeSlotFeature> = {}): KeyholeSlotFeature {
  return {
    kind: 'keyholeSlot', id,
    faceRole: 'Bottom', u: 150, v: 80, axis: 'u', direction: 1,
    entryDiameter: 15, slotWidth: 8, slotLength: 25, depth: 6,
    ...overrides,
  };
}

describe('EditKeyholeSlotCommand', () => {
  beforeEach(() => { useAppStore.getState().setBoreCacheInvalidator(null); });

  it('patches all 9 fields on the live keyhole slot reference', async () => {
    const keyholeSlot = makeKeyholeSlot();
    const doc = { featureTree: [keyholeSlot] };
    const cmd = new EditKeyholeSlotCommand({
      keyholeSlot,
      patch: {
        faceRole: 'Top', u: 200, v: 120, axis: 'v', direction: -1,
        entryDiameter: 20, slotWidth: 10, slotLength: 30, depth: 8,
      },
      partPath: 'p.zipt', doc, opfs: null,
    });
    await cmd.apply();
    expect(keyholeSlot.faceRole).toBe('Top');
    expect(keyholeSlot.u).toBe(200);
    expect(keyholeSlot.v).toBe(120);
    expect(keyholeSlot.axis).toBe('v');
    expect(keyholeSlot.direction).toBe(-1);
    expect(keyholeSlot.entryDiameter).toBe(20);
    expect(keyholeSlot.slotWidth).toBe(10);
    expect(keyholeSlot.slotLength).toBe(30);
    expect(keyholeSlot.depth).toBe(8);
  });

  it('revert restores every patched field', async () => {
    const keyholeSlot = makeKeyholeSlot();
    const doc = { featureTree: [keyholeSlot] };
    const cmd = new EditKeyholeSlotCommand({
      keyholeSlot,
      patch: {
        faceRole: 'Top', u: 200, v: 120, axis: 'v', direction: -1,
        entryDiameter: 20, slotWidth: 10, slotLength: 30, depth: 8,
      },
      partPath: 'p.zipt', doc, opfs: null,
    });
    await cmd.apply();
    await cmd.revert();
    expect(keyholeSlot.faceRole).toBe('Bottom');
    expect(keyholeSlot.u).toBe(150);
    expect(keyholeSlot.v).toBe(80);
    expect(keyholeSlot.axis).toBe('u');
    expect(keyholeSlot.direction).toBe(1);
    expect(keyholeSlot.entryDiameter).toBe(15);
    expect(keyholeSlot.slotWidth).toBe(8);
    expect(keyholeSlot.slotLength).toBe(25);
    expect(keyholeSlot.depth).toBe(6);
  });

  it('persists patched keyhole slot to opfs featureTree', async () => {
    const keyholeSlot = makeKeyholeSlot();
    const doc = { featureTree: [keyholeSlot] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...keyholeSlot }]);

    const cmd = new EditKeyholeSlotCommand({
      keyholeSlot,
      patch: { u: 220, slotWidth: 11 },
      partPath: 'p.zipt', doc, opfs,
    });
    await cmd.apply();

    const persisted = await featureTreeOf(opfs, 'p.zipt');
    const persistedKeyholeSlot = persisted[0] as KeyholeSlotFeature;
    expect(persistedKeyholeSlot.u).toBe(220);
    expect(persistedKeyholeSlot.slotWidth).toBe(11);
  });

  it('revert persists restored keyhole slot to opfs featureTree', async () => {
    const keyholeSlot = makeKeyholeSlot();
    const doc = { featureTree: [keyholeSlot] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...keyholeSlot }]);

    const cmd = new EditKeyholeSlotCommand({
      keyholeSlot,
      patch: { u: 220 },
      partPath: 'p.zipt', doc, opfs,
    });
    await cmd.apply();
    await cmd.revert();

    const persisted = await featureTreeOf(opfs, 'p.zipt');
    const persistedKeyholeSlot = persisted[0] as KeyholeSlotFeature;
    expect(persistedKeyholeSlot.u).toBe(150);
  });

  it('calls boreCacheInvalidator with [partPath] on apply and revert', async () => {
    const keyholeSlot = makeKeyholeSlot();
    const doc = { featureTree: [keyholeSlot] };
    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    const cmd = new EditKeyholeSlotCommand({
      keyholeSlot,
      patch: { u: 220 },
      partPath: 'p.zipt', doc, opfs: null,
    });
    await cmd.apply();
    expect(spy).toHaveBeenCalledWith(['p.zipt']);
    spy.mockClear();
    await cmd.revert();
    expect(spy).toHaveBeenCalledWith(['p.zipt']);
  });
});
