import { describe, it, expect } from 'vitest';
import { packProject, unpackProject } from '../ProjectPacker';

describe('ProjectPacker', () => {
  it('packs and unpacks a manifest + blobs losslessly', async () => {
    const manifest = { formatVersion: 1, kind: 'part', name: 'Part1' };
    const blob = new Uint8Array([1, 2, 3, 4, 5]);
    const thumb = new Uint8Array([0xff, 0xd8, 0xff]);

    const archive = await packProject({
      manifest,
      blobs: { 'blob-a': blob },
      thumbnail: thumb
    });

    expect(archive).toBeInstanceOf(Uint8Array);
    expect(archive.length).toBeGreaterThan(0);

    const unpacked = await unpackProject(archive);
    expect(unpacked.manifest).toEqual(manifest);
    expect(unpacked.blobs['blob-a']).toEqual(blob);
    expect(unpacked.thumbnail).toEqual(thumb);
  });

  it('rejects an archive with a corrupt gzip header', async () => {
    const bad = new Uint8Array([0, 1, 2, 3]);
    await expect(unpackProject(bad)).rejects.toThrow(/corrupt|gzip/i);
  });
});
