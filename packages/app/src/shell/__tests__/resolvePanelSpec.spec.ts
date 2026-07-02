// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { resolvePanelSpec, type PanelSpecCache } from '../resolvePanelSpec';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { isPanelFeature, resolvePanelSpecFromFeature, type PanelPreflightDiagnostic } from '@zilventor/shared';

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

// R1 preflight wiring: a resolved PanelFeature whose name/material is missing must
// surface a named diagnostic instead of silently flowing downstream as a valid spec.
describe('resolvePanelSpec — R1 preflight diagnostics', () => {
  it('logs a named diagnostic and returns null when the panel has no material assigned', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: {
        id: 'p1', name: 'Left Side', units: 'mm', parameters: {},
        featureTree: [{
          kind: 'panel', id: 'pf1',
          length: { kind: 'literal', value: 600 },
          width: { kind: 'literal', value: 400 },
          thickness: { kind: 'literal', value: 18 },
          thicknessFromMaterial: false,
          materialId: '', grain: 'length',
          edgeBands: { front: null, back: null, left: null, right: null },
        }],
        properties: {}, materials: [],
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/a.zipt': bytes });
    const spec = await resolvePanelSpec(opfs, 'p/a.zipt', cache);
    expect(spec).toBeNull();
    expect(cache.get('p/a.zipt')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('panel.preflight.missingMaterial'));
    warn.mockRestore();
  });

  it('logs a named diagnostic and returns null when the part has no name', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: {
        id: 'p1', name: '', units: 'mm', parameters: {},
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/a.zipt': bytes });
    const spec = await resolvePanelSpec(opfs, 'p/a.zipt', cache);
    expect(spec).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('panel.preflight.missingName'));
    warn.mockRestore();
  });

  it('collects a PanelPreflightDiagnostic into the optional out-param array when material is missing', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: {
        id: 'p1', name: 'Left Side', units: 'mm', parameters: {},
        featureTree: [{
          kind: 'panel', id: 'pf1',
          length: { kind: 'literal', value: 600 },
          width: { kind: 'literal', value: 400 },
          thickness: { kind: 'literal', value: 18 },
          thicknessFromMaterial: false,
          materialId: '', grain: 'length',
          edgeBands: { front: null, back: null, left: null, right: null },
        }],
        properties: {}, materials: [],
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/a.zipt': bytes });
    const diagnostics: PanelPreflightDiagnostic[] = [];
    await resolvePanelSpec(opfs, 'p/a.zipt', cache, diagnostics);
    expect(diagnostics).toEqual([
      { partPath: 'p/a.zipt', reasonKey: 'panel.preflight.missingMaterial', params: { name: 'Left Side' } },
    ]);
    warn.mockRestore();
  });

  it('does not push to the out-param array when preflight passes', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: {
        id: 'p1', name: 'Left Side', units: 'mm', parameters: {},
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
    const diagnostics: PanelPreflightDiagnostic[] = [];
    await resolvePanelSpec(opfs, 'p/a.zipt', cache, diagnostics);
    expect(diagnostics).toEqual([]);
  });
});

// P10 R1: imported STEP parts (no PanelFeature) must surface split-required /
// notManifold diagnostics instead of the pre-P10 silent `return null`. resolvePanelSpec
// is the single choke point both boring (useBoringResult) and cut-list/DXF/nesting
// (loadCutListInputs -> useCutListResult) read via the shared panelSpecCacheRef/diagnosticsCacheRef.
describe('resolvePanelSpec — R1 preflight for imported (non-panel) parts', () => {
  it('pushes a splitRequired diagnostic when an imported part carries >1 solid', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: {
        id: 'p1', name: 'Multi Body', units: 'mm', parameters: {},
        featureTree: [{
          kind: 'imported', id: 'imp1', sourceStep: 'multi.step', bodyRef: 'blob-1',
          solidColors: ['#fff', null, '#000'],
        }],
        properties: {}, materials: [],
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/imported.zipt': bytes });
    const diagnostics: PanelPreflightDiagnostic[] = [];
    const spec = await resolvePanelSpec(opfs, 'p/imported.zipt', cache, diagnostics);
    expect(spec).toBeNull();
    expect(cache.get('p/imported.zipt')).toBeNull();
    expect(diagnostics).toEqual([
      { partPath: 'p/imported.zipt', reasonKey: 'panel.preflight.splitRequired', params: { name: 'Multi Body', solidCount: 3 } },
    ]);
    warn.mockRestore();
  });

  it('pushes a notManifold diagnostic when an imported single-solid part has isManifold: false', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: {
        id: 'p1', name: 'Broken Bracket', units: 'mm', parameters: {},
        featureTree: [{
          kind: 'imported', id: 'imp1', sourceStep: 'bracket.step', bodyRef: 'blob-1',
          solidColors: ['#fff'], isManifold: false,
        }],
        properties: {}, materials: [],
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/imported.zipt': bytes });
    const diagnostics: PanelPreflightDiagnostic[] = [];
    const spec = await resolvePanelSpec(opfs, 'p/imported.zipt', cache, diagnostics);
    expect(spec).toBeNull();
    expect(diagnostics).toEqual([
      { partPath: 'p/imported.zipt', reasonKey: 'panel.preflight.notManifold', params: { name: 'Broken Bracket' } },
    ]);
    warn.mockRestore();
  });

  it('does not push a diagnostic for a plain single-solid, manifold imported part (guard: must not overreach)', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: {
        id: 'p1', name: 'Hardware Bracket', units: 'mm', parameters: {},
        featureTree: [{
          kind: 'imported', id: 'imp1', sourceStep: 'hw.step', bodyRef: 'blob-1',
          solidColors: ['#fff'], isManifold: true,
        }],
        properties: {}, materials: [],
      },
    });
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/imported.zipt': bytes });
    const diagnostics: PanelPreflightDiagnostic[] = [];
    const spec = await resolvePanelSpec(opfs, 'p/imported.zipt', cache, diagnostics);
    expect(spec).toBeNull();
    expect(diagnostics).toEqual([]);
  });

  it('does not push a diagnostic when isManifold is absent (assumed valid, pre-P10 default)', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: {
        id: 'p1', name: 'Legacy Import', units: 'mm', parameters: {},
        featureTree: [{
          kind: 'imported', id: 'imp1', sourceStep: 'legacy.step', bodyRef: 'blob-1',
          solidColors: ['#fff'],
        }],
        properties: {}, materials: [],
      },
    });
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/imported.zipt': bytes });
    const diagnostics: PanelPreflightDiagnostic[] = [];
    const spec = await resolvePanelSpec(opfs, 'p/imported.zipt', cache, diagnostics);
    expect(spec).toBeNull();
    expect(diagnostics).toEqual([]);
  });

  it('empty featureTree (no PanelFeature, no ImportedFeature) still returns null with no diagnostics (pre-existing case, must keep passing)', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: { id: 'p1', name: 'P', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [] },
    });
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/a.zipt': bytes });
    const diagnostics: PanelPreflightDiagnostic[] = [];
    const spec = await resolvePanelSpec(opfs, 'p/a.zipt', cache, diagnostics);
    expect(spec).toBeNull();
    expect(diagnostics).toEqual([]);
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
