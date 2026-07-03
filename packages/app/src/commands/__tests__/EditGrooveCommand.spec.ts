// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditGrooveCommand } from '../EditGrooveCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { GrooveFeature, Feature, PartDocument } from '@zilventor/shared';

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

function makeGroove(id = 'g1', overrides: Partial<GrooveFeature> = {}): GrooveFeature {
  return {
    kind: 'groove', id,
    faceRole: 'Front', axis: 'u', position: 10, width: 6, depth: 8,
    ...overrides,
  };
}

describe('EditGrooveCommand', () => {
  beforeEach(() => { useAppStore.getState().setBoreCacheInvalidator(null); });

  it('patches all 5 fields on the live groove reference', async () => {
    const groove = makeGroove();
    const doc = { featureTree: [groove] };
    const cmd = new EditGrooveCommand({
      groove,
      patch: { faceRole: 'Back', axis: 'v', position: 20, width: 12, depth: 15 },
      partPath: 'p.zipt', doc, opfs: null,
    });
    await cmd.apply();
    expect(groove.faceRole).toBe('Back');
    expect(groove.axis).toBe('v');
    expect(groove.position).toBe(20);
    expect(groove.width).toBe(12);
    expect(groove.depth).toBe(15);
  });

  it('revert restores every patched field', async () => {
    const groove = makeGroove();
    const doc = { featureTree: [groove] };
    const cmd = new EditGrooveCommand({
      groove,
      patch: { faceRole: 'Back', axis: 'v', position: 20, width: 12, depth: 15 },
      partPath: 'p.zipt', doc, opfs: null,
    });
    await cmd.apply();
    await cmd.revert();
    expect(groove.faceRole).toBe('Front');
    expect(groove.axis).toBe('u');
    expect(groove.position).toBe(10);
    expect(groove.width).toBe(6);
    expect(groove.depth).toBe(8);
  });

  it('persists patched groove to opfs featureTree', async () => {
    const groove = makeGroove();
    const doc = { featureTree: [groove] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...groove }]);

    const cmd = new EditGrooveCommand({
      groove,
      patch: { position: 33, width: 9 },
      partPath: 'p.zipt', doc, opfs,
    });
    await cmd.apply();

    const persisted = await featureTreeOf(opfs, 'p.zipt');
    const persistedGroove = persisted[0] as GrooveFeature;
    expect(persistedGroove.position).toBe(33);
    expect(persistedGroove.width).toBe(9);
  });

  it('revert persists restored groove to opfs featureTree', async () => {
    const groove = makeGroove();
    const doc = { featureTree: [groove] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...groove }]);

    const cmd = new EditGrooveCommand({
      groove,
      patch: { position: 33 },
      partPath: 'p.zipt', doc, opfs,
    });
    await cmd.apply();
    await cmd.revert();

    const persisted = await featureTreeOf(opfs, 'p.zipt');
    const persistedGroove = persisted[0] as GrooveFeature;
    expect(persistedGroove.position).toBe(10);
  });

  it('calls boreCacheInvalidator with [partPath] on apply and revert', async () => {
    const groove = makeGroove();
    const doc = { featureTree: [groove] };
    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    const cmd = new EditGrooveCommand({
      groove,
      patch: { position: 33 },
      partPath: 'p.zipt', doc, opfs: null,
    });
    await cmd.apply();
    expect(spy).toHaveBeenCalledWith(['p.zipt']);
    spy.mockClear();
    await cmd.revert();
    expect(spy).toHaveBeenCalledWith(['p.zipt']);
  });
});
