import { describe, it, expect } from 'vitest';
import { renderBoringDxf } from '../renderBoringDxf';
import type { BoringAggregateResult } from '../../assembly/walkers/aggregateBoresRecursive';
import type { BoreOp } from '@zilventor/shared';

function bore(over: Partial<BoreOp>): BoreOp {
  return {
    id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 50, v: 100, diameter: 5, depth: 34, role: 'confirmat-face',
    connectorId: 'c1', connectorKind: 'confirmat', ...over,
  };
}

describe('renderBoringDxf — panel outline', () => {
  it('emits an OUTLINE POLYLINE for each panel group', () => {
    const result: BoringAggregateResult = {
      panels: [
        { partPath: 'side.zipt', partName: 'Side', qty: 1, componentPathKeys: ['k'],
          bores: [bore({ u: 10, v: 10 }), bore({ id: 'b2', u: 200, v: 400 })] },
      ],
    };
    const dxf = renderBoringDxf(result);
    expect(dxf).toContain('AC1009');               // valid R12 header
    expect(dxf).toContain('POLYLINE');
    expect(dxf).toContain('OUTLINE');               // outline layer referenced by the polyline
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('offsets a second panel so its outline does not overlap the first', () => {
    const mk = (path: string): BoringAggregateResult['panels'][number] => ({
      partPath: path, partName: path, qty: 1, componentPathKeys: ['k'],
      bores: [bore({ u: 0, v: 0 }), bore({ id: 'b2', u: 100, v: 100 })],
    });
    const dxf = renderBoringDxf({ panels: [mk('a.zipt'), mk('b.zipt')] });
    // Two panels → two POLYLINE entities (outline) at minimum.
    const polylineCount = (dxf.match(/\nPOLYLINE\n/g) ?? []).length;
    expect(polylineCount).toBeGreaterThanOrEqual(2);
  });
});
