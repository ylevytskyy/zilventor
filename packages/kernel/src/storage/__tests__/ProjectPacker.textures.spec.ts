import { describe, it, expect } from 'vitest';
import { packProject, unpackProject } from '../ProjectPacker';

describe('ProjectPacker — custom texture blobs', () => {
  it('round-trips textures/<id>.jpg entries byte-identically', async () => {
    const albedo = new Uint8Array([0xff, 0xd8, 0xff, 0x10, 0x20]); // jpeg-ish
    const normal = new Uint8Array([1, 2, 3, 4]);
    const archive = await packProject({
      manifest: { formatVersion: 20, kind: 'part', document: { id: 'p' } },
      blobs: { main: new Uint8Array([9, 9]) },
      textures: { 'tex-a': albedo, 'tex-n': normal },
    });
    const out = await unpackProject(archive);
    expect(out.textures).toBeDefined();
    expect(Array.from(out.textures!['tex-a']!)).toEqual([0xff, 0xd8, 0xff, 0x10, 0x20]);
    expect(Array.from(out.textures!['tex-n']!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(out.blobs.main!)).toEqual([9, 9]);
  });

  it('omits textures key when none supplied (back-compat)', async () => {
    const archive = await packProject({
      manifest: { formatVersion: 20, kind: 'part', document: {} },
      blobs: {},
    });
    const out = await unpackProject(archive);
    expect(out.textures ?? {}).toEqual({});
  });
});
