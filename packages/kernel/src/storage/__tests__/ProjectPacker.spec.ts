import { describe, it, expect } from 'vitest';
import { gzip } from 'pako';
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

  it('rejects a valid gzip containing a corrupt tar payload', async () => {
    // Random bytes that are not a valid tar archive, wrapped in valid gzip.
    const randomPayload = new Uint8Array(1024);
    for (let i = 0; i < randomPayload.length; i++) {
      randomPayload[i] = (i * 31 + 7) & 0xff;
    }
    const gzipped = gzip(randomPayload);
    await expect(unpackProject(gzipped)).rejects.toThrow(/archive is corrupt \(tar\)/);
  });

  it('produces byte-identical output for identical input across calls', async () => {
    const manifest = { formatVersion: 1, kind: 'part', name: 'Part1' };
    const blob = new Uint8Array([1, 2, 3, 4, 5]);
    const thumb = new Uint8Array([0xff, 0xd8, 0xff]);

    const input = {
      manifest,
      blobs: { 'blob-a': blob },
      thumbnail: thumb
    };

    const first = await packProject(input);
    // Wait long enough that non-deterministic mtime would differ.
    await new Promise((r) => setTimeout(r, 1100));
    const second = await packProject(input);

    expect(first.byteLength).toBe(second.byteLength);
    // Compare as array-of-bytes for a clear diff if they diverge.
    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it('round-trips properties on a part manifest verbatim', async () => {
    const manifest = {
      formatVersion: 9, kind: 'part', createdAt: 'now', appVersion: '0.0.1',
      document: {
        id: 'p1', name: 'X', units: 'mm', parameters: {}, featureTree: [],
        properties: { partNumber: 'Z-1', description: 'тест', mass: 1.5, isFinished: true },
      },
    };
    const archive = await packProject({ manifest, blobs: {} });
    const out = await unpackProject(archive);
    expect((out.manifest as { document: { properties: Record<string, unknown> } }).document.properties).toEqual({
      partNumber: 'Z-1', description: 'тест', mass: 1.5, isFinished: true,
    });
  });

  it('round-trips an ImportedFeature.bodyRef blob alongside the manifest', async () => {
    const blobBytes = new Uint8Array([0xDC, 0xCA, 0xCA, 0xFE]);
    const manifest = {
      formatVersion: 9, kind: 'part', createdAt: 'now', appVersion: '0.0.1',
      document: {
        id: 'p1', name: 'X', units: 'mm', parameters: {}, properties: {},
        featureTree: [{ kind: 'imported', id: 'imp-1', sourceStep: 'X.step', bodyRef: 'blob-imp-1' }],
      },
    };
    const archive = await packProject({ manifest, blobs: { 'blob-imp-1': blobBytes } });
    const out = await unpackProject(archive);
    expect(out.blobs['blob-imp-1']).toEqual(blobBytes);
    const tree = (out.manifest as { document: { featureTree: Array<{ kind: string; id: string; bodyRef: string }> } }).document.featureTree;
    expect(tree[0]).toMatchObject({ kind: 'imported', id: 'imp-1', bodyRef: 'blob-imp-1' });
  });
});
