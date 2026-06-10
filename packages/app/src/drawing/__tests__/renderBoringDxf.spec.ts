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

describe('renderBoringDxf — bore circles', () => {
  it('emits one CIRCLE per bore on a D{Ø}_T{depth} layer', () => {
    const result: BoringAggregateResult = {
      panels: [
        { partPath: 'side.zipt', partName: 'Side', qty: 1, componentPathKeys: ['k'],
          bores: [
            bore({ id: 'b1', u: 30, v: 40, diameter: 5, depth: 34 }),
            bore({ id: 'b2', u: 60, v: 80, diameter: 15, depth: 12 }),
            bore({ id: 'b3', u: 90, v: 120, diameter: 8, depth: 'throughAll' }),
          ] },
      ],
    };
    const dxf = renderBoringDxf(result);
    const circleCount = (dxf.match(/\nCIRCLE\n/g) ?? []).length;
    expect(circleCount).toBe(3);
    expect(dxf).toContain('D5_T34');
    expect(dxf).toContain('D15_T12');
    expect(dxf).toContain('D8_THROUGH');
  });

  it('places each circle at the panel-local (u,v) offset by the panel grid origin', () => {
    const result: BoringAggregateResult = {
      panels: [
        { partPath: 'a.zipt', partName: 'A', qty: 1, componentPathKeys: ['k'],
          bores: [bore({ id: 'b1', u: 25, v: 35, diameter: 5, depth: 34 })] },
      ],
    };
    const dxf = renderBoringDxf(result);
    // First panel grid origin is x0=0, so the circle center is (25,35), radius 2.5.
    expect(dxf).toMatch(/CIRCLE[\s\S]*?25\.0000[\s\S]*?35\.0000[\s\S]*?2\.5000/);
  });
});

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
