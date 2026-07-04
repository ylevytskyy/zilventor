import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConvertImportedPartToPanelCommand, NO_IMPORTED_FEATURE } from '../ConvertImportedPartToPanelCommand';
import { useAppStore } from '../../store/useAppStore';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { ImportedFeature, PanelFeature, PartDocument } from '@zilventor/shared';

const imported: ImportedFeature = {
  kind: 'imported',
  id: 'imp1',
  sourceStep: 'foo.step',
  bodyRef: 'blob1',
};

const panel: PanelFeature = {
  kind: 'panel',
  id: 'panel1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: false,
  materialId: 'mat1',
  grain: 'none',
  edgeBands: { front: null, back: null, left: null, right: null },
};

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

function importedPartDoc(): PartDocument {
  const doc = newPart('imported-part') as PartDocument;
  return addFeature(doc, imported);
}

describe('ConvertImportedPartToPanelCommand', () => {
  beforeEach(() => { useAppStore.getState().setBoreCacheInvalidator(null); });

  it('apply() replaces the imported feature at the same index, leaving other features untouched', async () => {
    const doc = importedPartDoc();
    const importedIdx = doc.featureTree.findIndex((f) => f.kind === 'imported');
    const opfs = makeOpfs({ 'part.zipt': await ziptBytes(doc) });

    await new ConvertImportedPartToPanelCommand({ partPath: 'part.zipt', panel, opfs }).apply();

    const after = await docOf(opfs, 'part.zipt');
    expect(after.featureTree).toHaveLength(doc.featureTree.length);
    expect(after.featureTree[importedIdx]).toMatchObject({ kind: 'panel', id: 'panel1' });
    expect(after.featureTree.some((f) => f.kind === 'imported')).toBe(false);
    // origin features (everything before the imported feature) are untouched
    expect(after.featureTree.slice(0, importedIdx)).toEqual(doc.featureTree.slice(0, importedIdx));
  });

  it('throws NO_IMPORTED_FEATURE when the part has no imported feature', async () => {
    const doc = newPart('plain-part') as PartDocument;
    const opfs = makeOpfs({ 'part.zipt': await ziptBytes(doc) });

    await expect(
      new ConvertImportedPartToPanelCommand({ partPath: 'part.zipt', panel, opfs }).apply(),
    ).rejects.toThrow(NO_IMPORTED_FEATURE);
  });

  it('apply() and revert() each invalidate the geometry cache for the part path', async () => {
    const doc = importedPartDoc();
    const opfs = makeOpfs({ 'part.zipt': await ziptBytes(doc) });
    const cmd = new ConvertImportedPartToPanelCommand({ partPath: 'part.zipt', panel, opfs });

    const spyApply = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spyApply);
    await cmd.apply();
    expect(spyApply).toHaveBeenCalledWith(['part.zipt']);

    const spyRevert = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spyRevert);
    await cmd.revert();
    expect(spyRevert).toHaveBeenCalledWith(['part.zipt']);
  });

  it('revert() restores the original manifest bytes exactly', async () => {
    const doc = importedPartDoc();
    const originalBytes = await ziptBytes(doc);
    const opfs = makeOpfs({ 'part.zipt': originalBytes });
    const cmd = new ConvertImportedPartToPanelCommand({ partPath: 'part.zipt', panel, opfs });

    await cmd.apply();
    await cmd.revert();

    expect(opfs.files.get('part.zipt')).toEqual(originalBytes);
    const after = await docOf(opfs, 'part.zipt');
    expect(after.featureTree.some((f) => f.kind === 'imported')).toBe(true);
    expect(after.featureTree.some((f) => f.kind === 'panel')).toBe(false);
  });
});
