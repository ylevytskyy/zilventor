import { describe, it, expect } from 'vitest';
import { BakeBoresCommand } from '../BakeBoresCommand';
import { UnbakeBoresCommand } from '../UnbakeBoresCommand';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { newPart } from '@zilventor/kernel/src/adapter/PartDocument';
import type { BoreOp, PartDocument } from '@zilventor/shared';

// writeTarGz is async — await it at every call site.
async function ziptBytes(doc: PartDocument): Promise<Uint8Array> {
  const manifest = { formatVersion: 21, kind: 'part' as const, document: doc };
  return await writeTarGz([{ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }]);
}
function makeOpfs(initial: Record<string, Uint8Array>) {
  const files = new Map(Object.entries(initial));
  return { files,
    read: async (p: string) => { const b = files.get(p); if (!b) throw new Error('ENOENT'); return b; },
    write: async (p: string, b: Uint8Array) => { files.set(p, b); } };
}
function fakeKernel() {
  return { registerPart: async () => {}, execute: async () => ({ ok: true as const, value: {} as never }),
    saveToBytes: async () => new Uint8Array(), deletePart: async () => {} };
}
async function featuresOf(opfs: ReturnType<typeof makeOpfs>): Promise<PartDocument['featureTree']> {
  const project = await unpackProject(opfs.files.get('side.zipt')!);
  return (project.manifest as { document: PartDocument }).document.featureTree;
}

describe('UnbakeBoresCommand', () => {
  const bore: BoreOp = { id: 'a', face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 30, v: 9, diameter: 8, depth: 20, role: 'dowel-edge', connectorId: 'c1', connectorKind: 'dowel' };

  it('removes all bake: HoleFeatures; revert re-adds them', async () => {
    let doc = newPart('side') as PartDocument;
    doc = { ...doc, bores: [bore] };
    const opfs = makeOpfs({ 'side.zipt': await ziptBytes(doc) });  // ziptBytes is async
    await new BakeBoresCommand({ partPath: 'side.zipt', opfs, kernel: fakeKernel() }).apply();
    expect((await featuresOf(opfs)).some((f) => f.id.startsWith('bake:'))).toBe(true);

    const unbake = new UnbakeBoresCommand({ partPath: 'side.zipt', opfs, kernel: fakeKernel() });
    await unbake.apply();
    expect((await featuresOf(opfs)).some((f) => f.id.startsWith('bake:'))).toBe(false);

    await unbake.revert();
    expect((await featuresOf(opfs)).some((f) => f.id.startsWith('bake:'))).toBe(true);
  });
});
