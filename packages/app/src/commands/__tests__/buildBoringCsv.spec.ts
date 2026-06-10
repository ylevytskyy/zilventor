import { describe, expect, it } from 'vitest';
import { buildBoringCsv } from '../buildBoringCsv';
import type { BoringAggregateResult } from '../../assembly/walkers/aggregateBoresRecursive';
import type { BoreOp } from '@zilventor/shared';

const bore = (over: Partial<BoreOp> = {}): BoreOp => ({
  id: 'b1', face: { featureId: 'panel', role: 'Top', instance: 0 }, u: 100, v: 50, diameter: 5, depth: 34,
  role: 'confirmat-face', connectorId: 'k1', connectorKind: 'confirmat', ...over,
});

const empty: BoringAggregateResult = { panels: [] };

describe('buildBoringCsv', () => {
  it('emits the header for an empty result', () => {
    const csv = buildBoringCsv(empty);
    expect(csv).toContain('Panel,Tag,Face,X,Y,Ø,Depth,Type');
  });

  it('emits one row per bore with X=u, Y=v, Ø=diameter, numeric depth', () => {
    const result: BoringAggregateResult = {
      panels: [{
        partPath: 'parts/side.zipt', partName: 'Side', qty: 2,
        componentPathKeys: [],
        bores: [bore({ id: 'b1' }), bore({ id: 'b2', u: 200, diameter: 8 })],
      }],
    };
    const csv = buildBoringCsv(result);
    expect(csv).toContain('Side,b1,Top,100,50,5,34,confirmat');
    expect(csv).toContain('Side,b2,Top,200,50,8,34,confirmat');
  });

  it("renders depth 'throughAll' as THROUGH", () => {
    const result: BoringAggregateResult = {
      panels: [{
        partPath: 'p.zipt', partName: 'Back', qty: 1, componentPathKeys: [],
        bores: [bore({ id: 'b9', face: { featureId: 'panel', role: 'Back', instance: 0 }, depth: 'throughAll' })],
      }],
    };
    const csv = buildBoringCsv(result);
    expect(csv).toContain('Back,b9,Back,100,50,5,THROUGH,confirmat');
  });

  it('RFC-4180 quotes a panel name containing a comma', () => {
    const result: BoringAggregateResult = {
      panels: [{
        partPath: 'p.zipt', partName: 'Side, left', qty: 1, componentPathKeys: [],
        bores: [bore()],
      }],
    };
    const csv = buildBoringCsv(result);
    expect(csv).toContain('"Side, left",b1,Top,100,50,5,34,confirmat');
  });
});
