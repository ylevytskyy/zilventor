import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClearBoresCommand } from '../ClearBoresCommand';
import { useAppStore } from '../../store/useAppStore';
import type { BoreOp } from '@zilventor/shared';

const bore: BoreOp = {
  id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
  u: 10, v: 10, diameter: 5, depth: 12,
  role: 'confirmat-face', connectorId: 'conn1', connectorKind: 'confirmat',
};

function makePanelDoc(bores: BoreOp[]) {
  return { featureTree: [], bores: [...bores] };
}

describe('ClearBoresCommand', () => {
  it('removes all bores from the panel document (bores key absent after apply)', async () => {
    const doc = makePanelDoc([bore]);
    const snapshot = [...doc.bores];
    const cmd = new ClearBoresCommand({ doc, partPath: 'panel.zipt', opfs: null });
    await cmd.apply();
    // exactOptionalPropertyTypes contract: key must be absent, not set to []
    expect('bores' in doc).toBe(false);
    // revert restores the original bores
    await cmd.revert();
    expect(doc.bores).toEqual(snapshot);
  });

  it('is a no-op on a panel with no bores (does not throw)', async () => {
    const doc = makePanelDoc([]);
    const cmd = new ClearBoresCommand({ doc, partPath: 'panel.zipt', opfs: null });
    await expect(async () => { await cmd.apply(); await cmd.revert(); }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CACHE INVALIDATOR: apply + revert must call the registered boreCacheInvalidator
// ---------------------------------------------------------------------------
describe('ClearBoresCommand — boreCacheInvalidator', () => {
  beforeEach(() => {
    useAppStore.getState().setBoreCacheInvalidator(null);
  });

  it('apply() calls boreCacheInvalidator with the part path', async () => {
    const doc = makePanelDoc([bore]);
    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    await new ClearBoresCommand({ doc, partPath: 'panel.zipt', opfs: null }).apply();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toEqual(['panel.zipt']);
  });

  it('revert() calls boreCacheInvalidator with the part path', async () => {
    const doc = makePanelDoc([bore]);
    const cmd = new ClearBoresCommand({ doc, partPath: 'panel.zipt', opfs: null });
    await cmd.apply();

    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);

    await cmd.revert();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toEqual(['panel.zipt']);
  });
});
