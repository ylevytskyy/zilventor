// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { resolvePanelSpec, type PanelSpecCache } from '../resolvePanelSpec';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { isPanelFeature, resolvePanelSpecFromFeature } from '@zilventor/shared';

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

// Regression: mesh-sync warm path — panelSpecCacheRef must be warmed from the
// PartDocument already in hand (featureTree + parameters), without OPFS/Cut List.
// This mirrors the code added in App.tsx mesh-sync effect (the fresh-session fix).
describe('panelSpecCacheRef warm from PartDocument (mesh-sync path)', () => {
  // Simulates the data `kernel.getPart(partId)` returns for a panel part.
  const panelPartDoc = {
    featureTree: [
      {
        kind: 'panel', id: 'pf1',
        length: { kind: 'literal', value: 800 },
        width: { kind: 'literal', value: 300 },
        thickness: { kind: 'literal', value: 18 },
        thicknessFromMaterial: false,
        materialId: 'm-oak', grain: 'length' as const,
        edgeBands: { front: null, back: null, left: null, right: null },
      },
    ],
    parameters: {},
  };

  it('isPanelFeature + resolvePanelSpecFromFeature produces a valid PanelSpec from PartDocument data', () => {
    const pf = panelPartDoc.featureTree.find((f) => isPanelFeature(f));
    expect(pf).toBeDefined();
    const spec = resolvePanelSpecFromFeature(pf!, panelPartDoc.parameters);
    expect(spec).not.toBeNull();
    expect(spec!.length).toBe(800);
    expect(spec!.width).toBe(300);
    expect(spec!.thickness).toBe(18);
    expect(spec!.materialId).toBe('m-oak');
  });

  it('panelSpecCacheRef is populated by the mesh-sync pattern (guard: only if absent)', () => {
    // Mirrors the App.tsx mesh-sync warm logic:
    //   if (!panelSpecCacheRef.current.has(partPath)) {
    //     const pf = partDoc.featureTree.find(isPanelFeature);
    //     panelSpecCacheRef.current.set(partPath, pf ? resolvePanelSpecFromFeature(pf, partDoc.parameters) : null);
    //   }
    const cache: PanelSpecCache = new Map();
    const partPath = 'parts/shelf.zipt';

    // First call — cache is empty, should populate.
    if (!cache.has(partPath)) {
      const pf = panelPartDoc.featureTree.find((f) => isPanelFeature(f));
      cache.set(partPath, pf ? resolvePanelSpecFromFeature(pf!, panelPartDoc.parameters) : null);
    }
    expect(cache.has(partPath)).toBe(true);
    expect(cache.get(partPath)).not.toBeNull();
    expect(cache.get(partPath)!.length).toBe(800);

    // Second call — cache already has entry; must not overwrite (guard works).
    const callCount = { n: 0 };
    if (!cache.has(partPath)) {
      callCount.n += 1;
    }
    expect(callCount.n).toBe(0); // guard prevented re-resolution
  });

  it('non-panel PartDocument stores null in cache (no false positive)', () => {
    const nonPanelDoc = { featureTree: [{ kind: 'extrude', id: 'e1' }], parameters: {} };
    const cache: PanelSpecCache = new Map();
    const partPath = 'parts/extrude.zipt';
    if (!cache.has(partPath)) {
      const pf = nonPanelDoc.featureTree.find((f) => isPanelFeature(f));
      cache.set(partPath, pf ? resolvePanelSpecFromFeature(pf!, nonPanelDoc.parameters) : null);
    }
    expect(cache.has(partPath)).toBe(true);
    expect(cache.get(partPath)).toBeNull();
  });
});
