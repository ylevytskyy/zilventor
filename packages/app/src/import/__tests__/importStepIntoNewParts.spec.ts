import { describe, it, expect, vi } from 'vitest';
import type { KernelApi } from '@zilventor/kernel/src/api';
import type { PartDocument } from '@zilventor/shared';
import { importStepIntoNewParts } from '../importStepIntoNewParts';

type OpfsLike = { write: (p: string, b: Uint8Array) => Promise<void>; listAll: () => Promise<string[]> };

function makeKernel(brepBlobIds: string[]): Pick<KernelApi, 'extractStepSolids' | 'registerPart' | 'saveToBytes'> & { _registered: PartDocument[] } {
  const registered: PartDocument[] = [];
  return {
    _registered: registered,
    extractStepSolids: vi.fn(async () =>
      brepBlobIds.map((id, i) => ({
        brepBlobId: id,
        boundingBox: [i * 100, 0, 0, i * 100 + 10, 10, 10] as [number, number, number, number, number, number],
      })),
    ),
    registerPart: vi.fn(async (part: PartDocument) => {
      registered.push(part);
    }),
    saveToBytes: vi.fn(async (_partId: string) => new Uint8Array([1, 2, 3])),
  };
}

function makeOpfs(existing: string[] = []): OpfsLike & { _writes: Array<[string, Uint8Array]> } {
  const writes: Array<[string, Uint8Array]> = [];
  return {
    _writes: writes,
    write: vi.fn(async (path: string, data: Uint8Array) => {
      writes.push([path, data]);
    }),
    listAll: vi.fn(async () => existing),
  };
}

describe('importStepIntoNewParts', () => {
  it('registers N parts with _1.._N suffixes', async () => {
    const kernel = makeKernel(['blob-a', 'blob-b', 'blob-c']);
    const opfs = makeOpfs();
    const stepBytes = new ArrayBuffer(8);

    const results = await importStepIntoNewParts({
      baseName: 'Cadeira_preta',
      sourceFileName: 'Cadeira_preta.step',
      stepBytes,
      kernel: kernel as unknown as KernelApi,
      opfs: opfs as unknown as OpfsLike,
    });

    expect(results).toHaveLength(3);
    expect(kernel._registered.map((p) => p.name)).toEqual([
      'Cadeira_preta_1',
      'Cadeira_preta_2',
      'Cadeira_preta_3',
    ]);
    // OPFS partPath convention: `${partName}.zipt`
    expect(opfs._writes.map(([p]) => p)).toEqual([
      'Cadeira_preta_1.zipt',
      'Cadeira_preta_2.zipt',
      'Cadeira_preta_3.zipt',
    ]);
    // Each result carries the path + partId + part.
    expect(results[0]?.opfsPath).toBe('Cadeira_preta_1.zipt');
    expect(results[1]?.opfsPath).toBe('Cadeira_preta_2.zipt');
  });

  it('dedupes against existing .zipt files in OPFS', async () => {
    const kernel = makeKernel(['blob-x', 'blob-y']);
    const opfs = makeOpfs(['Cadeira_preta_1.zipt', 'unrelated.zipt']);
    const stepBytes = new ArrayBuffer(8);

    const results = await importStepIntoNewParts({
      baseName: 'Cadeira_preta',
      sourceFileName: 'Cadeira_preta.step',
      stepBytes,
      kernel: kernel as unknown as KernelApi,
      opfs: opfs as unknown as OpfsLike,
    });

    // First slot starts at _1 collision → dedupeName produces _1 (2) or similar; the
    // contract is: the resulting names DO NOT collide with anything in `existing`.
    const names = kernel._registered.map((p) => p.name);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).not.toBe('Cadeira_preta_1');
    expect(results[0]?.opfsPath.endsWith('.zipt')).toBe(true);
  });

  it('single solid produces a single-element result', async () => {
    const kernel = makeKernel(['blob-solo']);
    const opfs = makeOpfs();

    const results = await importStepIntoNewParts({
      baseName: 'cube',
      sourceFileName: 'cube.stp',
      stepBytes: new ArrayBuffer(8),
      kernel: kernel as unknown as KernelApi,
      opfs: opfs as unknown as OpfsLike,
    });

    expect(results).toHaveLength(1);
    expect(kernel._registered[0]?.name).toBe('cube');
  });
});
