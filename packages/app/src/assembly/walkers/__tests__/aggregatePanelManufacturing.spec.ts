import { describe, it, expect } from 'vitest';
import { aggregatePanelManufacturing } from '../aggregatePanelManufacturing';
import type { CutListResult, CutListRow, BoreOp } from '@zilventor/shared';
import type { BoringAggregateResult } from '../aggregateBoresRecursive';

const row = (over: Partial<CutListRow> = {}): CutListRow => ({
  rowKey: 'k', itemNumber: 1, qty: 2, length: 800, width: 600, thickness: 18,
  materialId: 'm1' as any, materialName: 'White 18', grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  partPath: 'p/side', partName: 'Side', componentPathKeys: [], ...over,
});
const panel = (over: Partial<any> = {}) => ({
  partPath: 'p/side', partName: 'Side', qty: 2, componentPathKeys: [],
  length: 800, width: 600, thickness: 18, bores: [], ...over,
});

const bore = (faceRole: string, u = 10, v = 10): BoreOp => ({
  id: `b-${faceRole}-${u}-${v}`,
  face: { featureId: 'panel', role: faceRole, instance: 0 },
  u, v, diameter: 5, depth: 12,
  role: 'dowel-face',
  connectorId: 'c1',
  connectorKind: 'dowel',
});

describe('aggregatePanelManufacturing', () => {
  it('produces one input per cut-list row joined to its bores', () => {
    const cut: CutListResult = { rows: [row()], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [panel({ bores: [bore('Top')] })] };
    const out = aggregatePanelManufacturing(cut, boring, new Map());
    expect(out).toHaveLength(1);
    expect(out[0]!.itemNumber).toBe(1);
    expect(out[0]!.bores).toHaveLength(1);
    expect(out[0]!.qty).toBe(2);
  });
  it('splits same-size panels with DIFFERENT boring into separate inputs', () => {
    const cut: CutListResult = { rows: [
      row({ partPath: 'p/a', itemNumber: 1 }),
      row({ partPath: 'p/b', itemNumber: 2 }),
    ], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [
      panel({ partPath: 'p/a', bores: [bore('Top', 10, 10)] }),
      panel({ partPath: 'p/b', bores: [bore('Top', 99, 99)] }),
    ] };
    const out = aggregatePanelManufacturing(cut, boring, new Map());
    expect(out).toHaveLength(2);
  });
  it('merges identical machining signatures and sums qty', () => {
    const cut: CutListResult = { rows: [
      row({ partPath: 'p/a', itemNumber: 1, qty: 2 }),
      row({ partPath: 'p/b', itemNumber: 2, qty: 3 }),
    ], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [
      panel({ partPath: 'p/a', bores: [] }), panel({ partPath: 'p/b', bores: [] }),
    ] };
    const out = aggregatePanelManufacturing(cut, boring, new Map());
    expect(out).toHaveLength(1);
    expect(out[0]!.qty).toBe(5);
    expect(out[0]!.itemNumber).toBe(1); // first wins
  });
  it('faceKey distinguishes bores by face.role — Top vs Bottom on same geometry are separate entries', () => {
    const cut: CutListResult = { rows: [
      row({ partPath: 'p/a', itemNumber: 1 }),
      row({ partPath: 'p/b', itemNumber: 2 }),
    ], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [
      panel({ partPath: 'p/a', bores: [bore('Top', 10, 10)] }),
      panel({ partPath: 'p/b', bores: [bore('Bottom', 10, 10)] }),
    ] };
    const out = aggregatePanelManufacturing(cut, boring, new Map());
    expect(out).toHaveLength(2);
  });
});
