// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolvePartName, type PartNameCache } from '../resolvePartName';

// Build a fake Opfs with an in-memory map; reuse the project packer to write
// a real .zipt manifest.
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';

async function fakeOpfsWithCube(): Promise<{ opfs: any; reads: { count: number } }> {
  const reads = { count: 0 };
  const partDoc = { id: 'p', name: 'cube', units: 'mm', parameters: {}, featureTree: [] };
  const archive = await packProject({
    manifest: { formatVersion: 7, kind: 'part', createdAt: '', appVersion: '0.0.0', document: partDoc },
    blobs: {},
  });
  const opfs = {
    async read(path: string): Promise<Uint8Array> {
      reads.count += 1;
      if (path === 'parts/cube.zipt') return archive;
      throw new Error('ENOENT');
    },
  };
  return { opfs, reads };
}

describe('resolvePartName', () => {
  it('returns the manifest name on first call and caches', async () => {
    const { opfs, reads } = await fakeOpfsWithCube();
    const cache: PartNameCache = new Map();
    expect(await resolvePartName(opfs, 'parts/cube.zipt', cache)).toBe('cube');
    expect(await resolvePartName(opfs, 'parts/cube.zipt', cache)).toBe('cube');
    expect(reads.count).toBe(1);
  });

  it('returns "(missing part)" when the read fails', async () => {
    const opfs = { async read(_path: string) { throw new Error('ENOENT'); } };
    const cache: PartNameCache = new Map();
    expect(await resolvePartName(opfs as any, 'parts/missing.zipt', cache)).toBe('(missing part)');
    expect(cache.get('parts/missing.zipt')).toBe('(missing part)');
  });
});
