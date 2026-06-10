import { describe, it, expect } from 'vitest';
import { BakeBoresCommand } from '../BakeBoresCommand';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { newPart } from '@zilventor/kernel/src/adapter/PartDocument';
import type { BoreOp, PartDocument } from '@zilventor/shared';

const CURRENT = 21;

function bore(over: Partial<BoreOp>): BoreOp {
  return { id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 30, v: 9, diameter: 8, depth: 20, role: 'dowel-edge',
    connectorId: 'c1', connectorKind: 'dowel', ...over };
}

// writeTarGz is async (returns Promise<Uint8Array>) — await it.
async function ziptBytes(doc: PartDocument): Promise<Uint8Array> {
  const manifest = { formatVersion: CURRENT, kind: 'part' as const, document: doc };
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

function fakeKernel() {
  const calls: string[] = [];
  return {
    calls,
    registerPart: async () => { calls.push('registerPart'); },
    execute: async () => { calls.push('execute'); return { ok: true as const, value: {} as never }; },
    saveToBytes: async () => { calls.push('saveToBytes'); return new Uint8Array(); },
    deletePart: async () => { calls.push('deletePart'); },
  };
}

describe('BakeBoresCommand', () => {
  it('appends one atFace HoleFeature per (face,Ø,depth) group, all id-prefixed bake:', async () => {
    let doc = newPart('side') as PartDocument;
    doc = { ...doc, bores: [
      bore({ id: 'a', u: 30, v: 9, diameter: 8, depth: 20 }),
      bore({ id: 'b', u: 90, v: 9, diameter: 8, depth: 20 }),  // same group as a → 1 feature, 2 points
      bore({ id: 'c', u: 60, v: 9, diameter: 5, depth: 34 }),  // different Ø/depth → 2nd group
    ] };
    const opfs = makeOpfs({ 'side.zipt': await ziptBytes(doc) });  // ziptBytes is async
    const kernel = fakeKernel();

    await new BakeBoresCommand({ partPath: 'side.zipt', opfs, kernel }).apply();

    const project = await unpackProject(opfs.files.get('side.zipt')!);
    const after = (project.manifest as { document: PartDocument }).document;
    const baked = after.featureTree.filter((f) => f.kind === 'hole' && f.id.startsWith('bake:'));
    expect(baked).toHaveLength(2);                         // 2 (face,Ø,depth) groups
    const group8 = baked.find((f) => (f as any).profile.diameter.value === 8) as any;
    expect(group8.placement.kind).toBe('atFace');
    expect(group8.placement.points).toHaveLength(2);       // a + b share the group
    expect(kernel.calls).toContain('execute');             // proved the part still builds
  });

  it('revert removes exactly the bake-authored features', async () => {
    let doc = newPart('side') as PartDocument;
    doc = { ...doc, bores: [bore({ id: 'a' })] };
    const opfs = makeOpfs({ 'side.zipt': await ziptBytes(doc) });  // ziptBytes is async
    const cmd = new BakeBoresCommand({ partPath: 'side.zipt', opfs, kernel: fakeKernel() });
    await cmd.apply();
    await cmd.revert();
    const project = await unpackProject(opfs.files.get('side.zipt')!);
    const after = (project.manifest as { document: PartDocument }).document;
    expect(after.featureTree.some((f) => f.id.startsWith('bake:'))).toBe(false);
  });
});
