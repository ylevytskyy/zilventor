import { describe, it, expect } from 'vitest';
import { importStepIntoNewParts } from '../importStepIntoNewParts';

function makeKernel() {
  return {
    importStep: async () => ({ brepBlobId: 'whole', triangleCount: 0, boundingBox: [0, 0, 0, 1, 1, 1] as const, faceCount: 1, solidCount: 2 }),
    splitImportedShape: async () => ({
      solids: [
        { brepBlobId: 's0', boundingBox: [0, 0, 0, 1, 1, 1] as const, color: '#ff0000' },
        { brepBlobId: 's1', boundingBox: [0, 0, 0, 1, 1, 1] as const },
      ],
      surfaces: { brepBlobId: 'surf', boundingBox: [0, 0, 0, 1, 1, 1] as const },
    }),
    registerPart: async () => {},
    saveToBytes: async () => new Uint8Array([1]),
  };
}

describe('importStepIntoNewParts color', () => {
  it('threads per-solid color onto each part; surfaces part stays uncolored', async () => {
    const writes: string[] = [];
    const opfs = { write: async (p: string) => { writes.push(p); }, listAll: async () => [] };
    const res = await importStepIntoNewParts({
      baseName: 'boxes', sourceFileName: 'boxes.step', stepBytes: new ArrayBuffer(8),
      kernel: makeKernel() as never, opfs,
    });
    const byBlob = new Map(res.map((r) => [r.part.featureTree.find((f) => f.kind === 'imported')!.bodyRef, r.part]));
    expect(byBlob.get('s0')!.color).toEqual({ kind: 'hex', hex: '#ff0000' });
    expect(byBlob.get('s1')!.color).toBeUndefined();
    expect(byBlob.get('surf')!.color).toBeUndefined();
  });
});
