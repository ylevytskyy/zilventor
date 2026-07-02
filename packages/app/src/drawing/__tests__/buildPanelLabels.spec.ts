import { describe, it, expect } from 'vitest';
import type { CutListResult, CutListRow, NestState, NestSheet, PlacedPanel } from '@zilventor/shared';
import { buildPanelLabels } from '../buildPanelLabels';

function row(over: Partial<CutListRow>): CutListRow {
  return {
    rowKey: 'k', itemNumber: 1, qty: 1,
    length: 600, width: 400, thickness: 18,
    materialId: 'mdf' as CutListRow['materialId'], materialName: 'MDF 18',
    grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
    partPath: 'p', partName: 'Side', componentPathKeys: ['c'],
    ...over,
  };
}

function placedPanel(over: Partial<PlacedPanel>): PlacedPanel {
  return {
    itemNumber: 1, rowKey: 'rowA', instanceIndex: 1,
    x: 0, y: 0, length: 600, width: 400, rotated: false, grain: 'length',
    ...over,
  };
}

function nestWith(panels: PlacedPanel[]): NestState {
  const sheet: NestSheet = {
    materialId: 'mdf' as NestSheet['materialId'], sheetIndex: 1,
    sheetLengthMm: 2440, sheetWidthMm: 1220, panels, utilizationPct: 50,
  };
  return {
    params: { kerfMm: 3.2 }, generatedAt: 0, inputFingerprint: 'f',
    sheets: [sheet], excluded: [],
  };
}

describe('buildPanelLabels', () => {
  it('flattens each row into qty labels with 1-based copyIndex/copyCount', () => {
    const result: CutListResult = {
      rows: [
        row({ itemNumber: 1, qty: 2, partName: 'Side', materialName: 'MDF 18',
              length: 600, width: 400, thickness: 18, grain: 'length',
              edgeBands: { front: { materialId: 'pvc' as never, materialName: 'PVC', thickness: 1 }, back: null,
                           left: null, right: { materialId: 'pvc' as never, materialName: 'PVC', thickness: 1 } } }),
        row({ itemNumber: 2, qty: 3, partName: 'Shelf', materialName: 'Ply 18', grain: 'none',
              componentPathKeys: ['a', 'b', 'c'] }),
      ],
      bandTotals: [], excluded: { rows: [], reasons: [] } as unknown as CutListResult['excluded'],
    };

    const labels = buildPanelLabels(result);

    expect(labels.length).toBe(5); // 2 + 3
    expect(labels.map((l) => l.itemNumber)).toEqual([1, 1, 2, 2, 2]);
    expect(labels.map((l) => l.copyIndex)).toEqual([1, 2, 1, 2, 3]);
    expect(labels.map((l) => l.copyCount)).toEqual([2, 2, 3, 3, 3]);

    expect(labels[0]!.edges).toEqual({ front: true, back: false, left: false, right: true });
    expect(labels[0]!.materialName).toBe('MDF 18');
    expect(labels[0]!.length).toBe(600);
    expect(labels[0]!.grain).toBe('length');
    expect(labels[2]!.edges).toEqual({ front: false, back: false, left: false, right: false });
    expect(labels[2]!.grain).toBe('none');

    expect(labels[0]!.qrPayload).toBe('Z|1|1/2|600x400x18|MDF 18');
    expect(labels[4]!.qrPayload).toBe('Z|2|3/3|600x400x18|Ply 18');
  });

  it('sets rotated from the matching nested PlacedPanel (by rowKey + instanceIndex), false when unmatched', () => {
    const result: CutListResult = {
      rows: [
        row({ rowKey: 'rowA', itemNumber: 1, qty: 2 }),
        row({ rowKey: 'rowB', itemNumber: 2, qty: 1 }), // no matching placed panel → stays false
      ],
      bandTotals: [], excluded: { rows: [], reasons: [] } as unknown as CutListResult['excluded'],
    };
    const nest = nestWith([
      placedPanel({ rowKey: 'rowA', instanceIndex: 1, rotated: true }),
      placedPanel({ rowKey: 'rowA', instanceIndex: 2, rotated: false }),
    ]);

    const labels = buildPanelLabels(result, nest);

    expect(labels.map((l) => l.rotated)).toEqual([true, false, false]);
  });

  it('defaults rotated=false for every label when no nest is passed (no-nest path unchanged)', () => {
    const result: CutListResult = {
      rows: [row({ rowKey: 'rowA', itemNumber: 1, qty: 2 })],
      bandTotals: [], excluded: { rows: [], reasons: [] } as unknown as CutListResult['excluded'],
    };

    const labels = buildPanelLabels(result);

    expect(labels.map((l) => l.rotated)).toEqual([false, false]);
  });
});
