// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { resolvePanelSpec, type PanelSpecCache } from '../resolvePanelSpec';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';

// Build an in-memory OPFS shim. Real Opfs has read(path): Promise<Uint8Array>.
function makeOpfs(files: Record<string, Uint8Array>): { read: (p: string) => Promise<Uint8Array> } {
  return { read: (p) => files[p] ? Promise.resolve(files[p]) : Promise.reject(new Error('ENOENT')) };
}

// Helper: pack a manifest into the same .zipt bytes shape unpackProject expects.
async function packPart(manifest: object): Promise<Uint8Array> {
  return packProject({ manifest, blobs: {} });
}

describe('resolvePanelSpec', () => {
  it('returns null for non-panel parts (no PanelFeature at index 0)', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: { id: 'p1', name: 'P', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [] },
    });
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/a.zipt': bytes });
    const spec = await resolvePanelSpec(opfs, 'p/a.zipt', cache);
    expect(spec).toBeNull();
    expect(cache.get('p/a.zipt')).toBeNull();
  });

  it('returns a PanelSpec for a part whose feature[0] is a PanelFeature', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: {
        id: 'p1', name: 'P', units: 'mm', parameters: {},
        featureTree: [{
          kind: 'panel', id: 'pf1',
          length: { kind: 'literal', value: 600 },
          width: { kind: 'literal', value: 400 },
          thickness: { kind: 'literal', value: 18 },
          thicknessFromMaterial: false,
          materialId: 'm-birch', grain: 'length',
          edgeBands: { front: null, back: null, left: null, right: null },
        }],
        properties: {}, materials: [],
      },
    });
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/a.zipt': bytes });
    const spec = await resolvePanelSpec(opfs, 'p/a.zipt', cache);
    expect(spec).not.toBeNull();
    expect(spec!.length).toBe(600);
    expect(spec!.materialId).toBe('m-birch');
  });

  it('caches subsequent reads (only one OPFS hit)', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: { id: 'p1', name: 'P', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [] },
    });
    const read = vi.fn().mockResolvedValue(bytes);
    const cache: PanelSpecCache = new Map();
    await resolvePanelSpec({ read }, 'p/a.zipt', cache);
    await resolvePanelSpec({ read }, 'p/a.zipt', cache);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('returns null and caches null on read error', async () => {
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({}); // empty FS
    const spec = await resolvePanelSpec(opfs, 'p/missing.zipt', cache);
    expect(spec).toBeNull();
    expect(cache.has('p/missing.zipt')).toBe(true);
    expect(cache.get('p/missing.zipt')).toBeNull();
  });
});
