import { describe, expect, it, vi } from 'vitest';
import { loadCutListInputs } from '../loadCutListInputs';
import type { PanelSpecCache } from '../resolvePanelSpec';

vi.mock('../resolvePanelSpec', () => ({
  resolvePanelSpec: vi.fn(async (_opfs, partPath: string, cache: PanelSpecCache) => {
    const v = partPath === 'p/a.zipt' ? { length: 600, width: 400, thickness: 18, materialId: 'm', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null } } : null;
    cache.set(partPath, v as never);
    return v as never;
  }),
}));

describe('loadCutListInputs', () => {
  it('resolves panel specs for every unique leaf partPath', async () => {
    const opfs = { read: vi.fn() };
    const cache: PanelSpecCache = new Map();
    const map = await loadCutListInputs(opfs, ['p/a.zipt', 'p/b.zipt', 'p/a.zipt'], cache);
    expect(map.size).toBe(2);
    expect(map.get('p/a.zipt')).not.toBeNull();
    expect(map.get('p/b.zipt')).toBeNull();
  });

  it('forwards an optional diagnostics out-param to every resolvePanelSpec call', async () => {
    const { resolvePanelSpec } = await import('../resolvePanelSpec');
    vi.mocked(resolvePanelSpec).mockClear();
    const opfs = { read: vi.fn() };
    const cache: PanelSpecCache = new Map();
    const diagnostics: unknown[] = [];
    await loadCutListInputs(opfs, ['p/a.zipt', 'p/b.zipt'], cache, diagnostics as never);
    expect(vi.mocked(resolvePanelSpec).mock.calls[0]?.[3]).toBe(diagnostics);
    expect(vi.mocked(resolvePanelSpec).mock.calls[1]?.[3]).toBe(diagnostics);
  });

  // P10 R1 propagation check: resolvePanelSpec now pushes diagnostics for
  // imported (non-panel) parts too (splitRequired/notManifold), not just the
  // pre-P10 missingName/missingMaterial cases. Confirms the caller-supplied
  // array (the same diagnosticsCacheRef App.tsx passes through to
  // useCutListResult/nesting) still receives whatever resolvePanelSpec pushes,
  // with no new wiring needed in this file (D5).
  it('surfaces a diagnostic pushed by resolvePanelSpec for an imported part in the caller-supplied array', async () => {
    const { resolvePanelSpec } = await import('../resolvePanelSpec');
    vi.mocked(resolvePanelSpec).mockImplementationOnce(async (_opfs, partPath, cache, diagnostics) => {
      diagnostics?.push({ partPath, reasonKey: 'panel.preflight.splitRequired', params: { name: 'Multi Body', solidCount: 3 } });
      cache.set(partPath, null);
      return null;
    });
    const opfs = { read: vi.fn() };
    const cache: PanelSpecCache = new Map();
    const diagnostics: import('@zilventor/shared').PanelPreflightDiagnostic[] = [];
    await loadCutListInputs(opfs, ['p/imported.zipt'], cache, diagnostics);
    expect(diagnostics).toEqual([
      { partPath: 'p/imported.zipt', reasonKey: 'panel.preflight.splitRequired', params: { name: 'Multi Body', solidCount: 3 } },
    ]);
  });
});
