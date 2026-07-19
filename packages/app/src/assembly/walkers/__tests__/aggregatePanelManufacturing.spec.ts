import { describe, it, expect } from 'vitest';
import { aggregatePanelManufacturing } from '../aggregatePanelManufacturing';
import type { CutListResult, CutListRow, BoreOp, TenonMortiseFeature, KeyholeSlotFeature } from '@zilventor/shared';
import type { BoringAggregateResult } from '../aggregateBoresRecursive';

const tenonMortise = (over: Partial<TenonMortiseFeature> = {}): TenonMortiseFeature => ({
  kind: 'tenonMortise', id: 'tm1', pairId: 'p1', role: 'mortise', faceRole: 'Top',
  axis: 'u', position: 10, width: 6, depth: 9, count: 1, spacing: 0, fitClearance: 1, ...over,
});

const keyholeSlot = (over: Partial<KeyholeSlotFeature> = {}): KeyholeSlotFeature => ({
  kind: 'keyholeSlot', id: 'ks1', faceRole: 'Top', u: 200, v: 150, axis: 'u', direction: 1,
  entryDiameter: 15, slotWidth: 8, slotLength: 30, depth: 6, ...over,
});

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
  it('threads tenonMortisesByPart onto the matching PanelManufacturingInput.tenonMortises', () => {
    const cut: CutListResult = { rows: [row()], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [panel()] };
    const tm = tenonMortise();
    const out = aggregatePanelManufacturing(cut, boring, new Map(), new Map([['p/side', [tm]]]));
    expect(out).toHaveLength(1);
    expect(out[0]!.tenonMortises).toEqual([tm]);
  });

  it('machiningSignature distinguishes panels by tenonMortises — same geometry+bores+grooves but different tenonMortises stay separate entries', () => {
    const cut: CutListResult = { rows: [
      row({ partPath: 'p/a', itemNumber: 1 }),
      row({ partPath: 'p/b', itemNumber: 2 }),
    ], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [
      panel({ partPath: 'p/a', bores: [] }), panel({ partPath: 'p/b', bores: [] }),
    ] };
    const tmByPart = new Map([
      ['p/a', [tenonMortise({ role: 'tenon', faceRole: 'Right' })]],
      ['p/b', [tenonMortise({ role: 'mortise', faceRole: 'Left' })]],
    ]);
    const out = aggregatePanelManufacturing(cut, boring, new Map(), tmByPart);
    expect(out).toHaveLength(2);
  });

  it('merges panels sharing identical tenonMortises into one entry (signature unaffected when tenonMortisesByPart is omitted)', () => {
    const cut: CutListResult = { rows: [
      row({ partPath: 'p/a', itemNumber: 1, qty: 2 }),
      row({ partPath: 'p/b', itemNumber: 2, qty: 3 }),
    ], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [
      panel({ partPath: 'p/a', bores: [] }), panel({ partPath: 'p/b', bores: [] }),
    ] };
    const out = aggregatePanelManufacturing(cut, boring, new Map());
    expect(out).toHaveLength(1);
    expect(out[0]!.tenonMortises).toEqual([]);
  });

  it('threads keyholeSlotsByPart onto the matching PanelManufacturingInput.keyholeSlots', () => {
    const cut: CutListResult = { rows: [row()], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [panel()] };
    const ks = keyholeSlot();
    const out = aggregatePanelManufacturing(cut, boring, new Map(), new Map(), new Map([['p/side', [ks]]]));
    expect(out).toHaveLength(1);
    expect(out[0]!.keyholeSlots).toEqual([ks]);
  });

  it('machiningSignature distinguishes panels by keyholeSlots — same geometry+bores+grooves+tenonMortises but different keyholeSlots stay separate entries', () => {
    const cut: CutListResult = { rows: [
      row({ partPath: 'p/a', itemNumber: 1 }),
      row({ partPath: 'p/b', itemNumber: 2 }),
    ], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [
      panel({ partPath: 'p/a', bores: [] }), panel({ partPath: 'p/b', bores: [] }),
    ] };
    const ksByPart = new Map([
      ['p/a', [keyholeSlot({ id: 'ks-a', u: 100 })]],
      ['p/b', [keyholeSlot({ id: 'ks-b', u: 700 })]],
    ]);
    const out = aggregatePanelManufacturing(cut, boring, new Map(), new Map(), ksByPart);
    expect(out).toHaveLength(2);
  });

  it('merges panels sharing identical keyholeSlots into one entry (signature unaffected when keyholeSlotsByPart is omitted)', () => {
    const cut: CutListResult = { rows: [
      row({ partPath: 'p/a', itemNumber: 1, qty: 2 }),
      row({ partPath: 'p/b', itemNumber: 2, qty: 3 }),
    ], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [
      panel({ partPath: 'p/a', bores: [] }), panel({ partPath: 'p/b', bores: [] }),
    ] };
    const out = aggregatePanelManufacturing(cut, boring, new Map());
    expect(out).toHaveLength(1);
    expect(out[0]!.keyholeSlots).toEqual([]);
  });

  it('merges identical machining signatures and accumulates partNames in merge order (R-QTY)', () => {
    const cut: CutListResult = { rows: [
      row({ partPath: 'p/a', itemNumber: 1, partName: 'Right Side' }),
      row({ partPath: 'p/b', itemNumber: 1, partName: 'Left Side' }),
    ], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [
      panel({ partPath: 'p/a', bores: [] }), panel({ partPath: 'p/b', bores: [] }),
    ] };
    const out = aggregatePanelManufacturing(cut, boring, new Map());
    expect(out).toHaveLength(1);
    expect(out[0]!.qty).toBe(4); // row() default qty is 2, merged: 2+2
    expect(out[0]!.partNames).toEqual(['Right Side', 'Left Side']);
  });

  it('a single (unmerged) row still carries its own partName as a 1-element partNames array (R-QTY)', () => {
    const cut: CutListResult = { rows: [row({ partName: 'Shelf' })], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [panel()] };
    const out = aggregatePanelManufacturing(cut, boring, new Map());
    expect(out[0]!.partNames).toEqual(['Shelf']);
  });

  it('threads a single row\'s OWN partNames (already-collapsed distinct names, e.g. Left+Right Side) through unmerged (R-QTY seed path)', () => {
    const cut: CutListResult = { rows: [
      row({ partName: 'Left Side', partNames: ['Left Side', 'Right Side'], qty: 2 }),
    ], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [panel()] };
    const out = aggregatePanelManufacturing(cut, boring, new Map());
    expect(out).toHaveLength(1);
    expect(out[0]!.qty).toBe(2);
    expect(out[0]!.partNames).toEqual(['Left Side', 'Right Side']);
  });

  it('merges two rows that EACH already carry their own multi-name partNames, concatenating all of them', () => {
    const cut: CutListResult = { rows: [
      row({ partPath: 'p/a', itemNumber: 1, partName: 'Left Side', partNames: ['Left Side', 'Right Side'], qty: 2 }),
      row({ partPath: 'p/b', itemNumber: 1, partName: 'Shelf', partNames: ['Shelf'], qty: 1 }),
    ], bandTotals: [], excluded: {} as any };
    const boring: BoringAggregateResult = { panels: [
      panel({ partPath: 'p/a', bores: [] }), panel({ partPath: 'p/b', bores: [] }),
    ] };
    const out = aggregatePanelManufacturing(cut, boring, new Map());
    expect(out).toHaveLength(1);
    expect(out[0]!.qty).toBe(3);
    expect(out[0]!.partNames).toEqual(['Left Side', 'Right Side', 'Shelf']);
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
