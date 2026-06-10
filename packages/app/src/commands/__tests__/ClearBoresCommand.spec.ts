import { describe, it, expect } from 'vitest';
import { ClearBoresCommand } from '../ClearBoresCommand';
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
  it('removes all bores from the panel document (bores key absent after apply)', () => {
    const doc = makePanelDoc([bore]);
    const snapshot = [...doc.bores];
    const cmd = new ClearBoresCommand({ doc, partPath: 'panel.zipt', opfs: null });
    cmd.apply();
    // exactOptionalPropertyTypes contract: key must be absent, not set to []
    expect('bores' in doc).toBe(false);
    // revert restores the original bores
    cmd.revert();
    expect(doc.bores).toEqual(snapshot);
  });

  it('is a no-op on a panel with no bores (does not throw)', () => {
    const doc = makePanelDoc([]);
    const cmd = new ClearBoresCommand({ doc, partPath: 'panel.zipt', opfs: null });
    expect(() => { cmd.apply(); cmd.revert(); }).not.toThrow();
  });
});
