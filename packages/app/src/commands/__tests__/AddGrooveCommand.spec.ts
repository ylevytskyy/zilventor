import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AddGrooveCommand } from '../AddGrooveCommand';
import { useAppStore } from '../../store/useAppStore';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { newPart } from '@zilventor/kernel/src/adapter/PartDocument';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { BoreOp, GrooveSpec, PartDocument } from '@zilventor/shared';

const groove: GrooveSpec = { faceRole: 'Top', axis: 'u', position: 200, width: 6, depth: 9 };

function bore(): BoreOp {
  return { id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 30, v: 9, diameter: 8, depth: 20, role: 'dowel-edge',
    connectorId: 'c1', connectorKind: 'dowel' };
}

async function ziptBytes(doc: PartDocument): Promise<Uint8Array> {
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  return await writeTarGz([{ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }]);
}

function makeOpfs(initial: Record<string, Uint8Array>) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: async (p: string) => { const b = files.get(p); if (!b) throw new Error(`ENOENT ${p}`); return b; },
    write: async (p: string, b: Uint8Array) => { files.set(p, b); },
  };
}

async function docOf(opfs: ReturnType<typeof makeOpfs>, path: string): Promise<PartDocument> {
  const project = await unpackProject(opfs.files.get(path)!);
  return (project.manifest as { document: PartDocument }).document;
}

describe('AddGrooveCommand', () => {
  beforeEach(() => { useAppStore.getState().setBoreCacheInvalidator(null); });

  it('apply() appends one kind:groove feature with the requested spec', async () => {
    const doc = newPart('side') as PartDocument;
    const opfs = makeOpfs({ 'side.zipt': await ziptBytes(doc) });

    await new AddGrooveCommand({ partPath: 'side.zipt', groove, opfs }).apply();

    const after = await docOf(opfs, 'side.zipt');
    const grooves = after.featureTree.filter((f) => f.kind === 'groove');
    expect(grooves).toHaveLength(1);
    expect(grooves[0]).toMatchObject({ kind: 'groove', faceRole: 'Top', axis: 'u', position: 200, width: 6, depth: 9 });
  });

  it('revert() removes the groove feature it added', async () => {
    const doc = newPart('side') as PartDocument;
    const opfs = makeOpfs({ 'side.zipt': await ziptBytes(doc) });
    const cmd = new AddGrooveCommand({ partPath: 'side.zipt', groove, opfs });
    await cmd.apply();
    await cmd.revert();
    const after = await docOf(opfs, 'side.zipt');
    expect(after.featureTree.some((f) => f.kind === 'groove')).toBe(false);
  });

  it('preserves pre-existing bores through apply AND revert (byte-snapshot must not drop them)', async () => {
    let doc = newPart('side') as PartDocument;
    doc = { ...doc, bores: [bore()] };
    const opfs = makeOpfs({ 'side.zipt': await ziptBytes(doc) });
    const cmd = new AddGrooveCommand({ partPath: 'side.zipt', groove, opfs });

    await cmd.apply();
    const afterApply = await docOf(opfs, 'side.zipt');
    expect(afterApply.bores).toHaveLength(1);
    expect(afterApply.bores![0]!.id).toBe('b1');

    await cmd.revert();
    const afterRevert = await docOf(opfs, 'side.zipt');
    expect(afterRevert.bores).toHaveLength(1);
    expect(afterRevert.bores![0]!.id).toBe('b1');
  });

  it('apply() and revert() each invalidate the geometry cache for the part path', async () => {
    const doc = newPart('side') as PartDocument;
    const opfs = makeOpfs({ 'side.zipt': await ziptBytes(doc) });
    const cmd = new AddGrooveCommand({ partPath: 'side.zipt', groove, opfs });

    const spyApply = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spyApply);
    await cmd.apply();
    expect(spyApply).toHaveBeenCalledWith(['side.zipt']);

    const spyRevert = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spyRevert);
    await cmd.revert();
    expect(spyRevert).toHaveBeenCalledWith(['side.zipt']);
  });
});
