// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolvePartInfo, type PartInfoCache } from '../resolvePartInfo';

// Build a fake Opfs with an in-memory map; reuse the project packer to write
// a real .zipt manifest.
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';

async function fakeOpfsWithCube(properties: Record<string, string | number | boolean> = {}): Promise<{ opfs: any; reads: { count: number } }> {
  const reads = { count: 0 };
  const partDoc = { id: 'p', name: 'cube', units: 'mm', parameters: {}, properties, featureTree: [] };
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

describe('resolvePartInfo', () => {
  it('returns the manifest name on first call and caches', async () => {
    const { opfs, reads } = await fakeOpfsWithCube();
    const cache: PartInfoCache = new Map();
    expect((await resolvePartInfo(opfs, 'parts/cube.zipt', cache)).name).toBe('cube');
    expect((await resolvePartInfo(opfs, 'parts/cube.zipt', cache)).name).toBe('cube');
    expect(reads.count).toBe(1);
  });

  it('returns "(missing part)" when the read fails', async () => {
    const opfs = { async read(_path: string) { throw new Error('ENOENT'); } };
    const cache: PartInfoCache = new Map();
    const info = await resolvePartInfo(opfs as any, 'parts/missing.zipt', cache);
    expect(info.name).toBe('(missing part)');
    expect(info.partNumber).toBeUndefined();
    expect(info.description).toBeUndefined();
    expect(cache.get('parts/missing.zipt')?.name).toBe('(missing part)');
  });

  it('surfaces partNumber and description from manifest properties when present', async () => {
    const { opfs } = await fakeOpfsWithCube({ partNumber: 'CUBE-001', description: 'A test cube' });
    const cache: PartInfoCache = new Map();
    const info = await resolvePartInfo(opfs, 'parts/cube.zipt', cache);
    expect(info.name).toBe('cube');
    expect(info.partNumber).toBe('CUBE-001');
    expect(info.description).toBe('A test cube');
  });

  it('omits partNumber and description when properties are absent or non-string', async () => {
    const { opfs } = await fakeOpfsWithCube({ partNumber: 42 });
    const cache: PartInfoCache = new Map();
    const info = await resolvePartInfo(opfs, 'parts/cube.zipt', cache);
    expect(info.name).toBe('cube');
    expect(info.partNumber).toBeUndefined();
    expect(info.description).toBeUndefined();
  });
});
