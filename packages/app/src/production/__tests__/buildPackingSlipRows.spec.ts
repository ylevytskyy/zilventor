import { describe, it, expect } from 'vitest';
import { buildPackingSlipRows } from '../buildPackingSlipRows';
import type { CutListResult, CutListRow } from '@zilventor/shared';
import { producedPanelKey } from '@zilventor/shared/src/production/qrPayload';

function makeRow(overrides: Partial<CutListRow> = {}): CutListRow {
  return {
    rowKey: 'k1',
    itemNumber: 1,
    qty: 5,
    length: 600,
    width: 300,
    thickness: 18,
    materialId: 'm1',
    materialName: 'Birch',
    grain: 'none',
    edgeBands: { front: null, back: null, left: null, right: null },
    partPath: 'p1',
    partName: 'Side Panel',
    componentPathKeys: [],
    ...overrides,
  };
}

function makeResult(rows: CutListRow[]): CutListResult {
  return { rows, bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };
}

describe('buildPackingSlipRows', () => {
  it('counts produced copies against qty (2 of 5 produced -> 2 produced, 3 remaining)', () => {
    const row = makeRow({ itemNumber: 1, qty: 5 });
    const producedPanels = {
      [producedPanelKey(1, 1)]: true,
      [producedPanelKey(1, 2)]: true,
    };
    const rows = buildPackingSlipRows(makeResult([row]), producedPanels);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      itemNumber: 1,
      partName: 'Side Panel',
      qty: 5,
      producedCount: 2,
      remainingCount: 3,
    });
  });

  it('treats an absent producedPanels map as nothing produced', () => {
    const row = makeRow({ itemNumber: 2, qty: 3 });
    const rows = buildPackingSlipRows(makeResult([row]), undefined);
    expect(rows[0]).toMatchObject({ itemNumber: 2, qty: 3, producedCount: 0, remainingCount: 3 });
  });

  it('ignores false entries in the produced map', () => {
    const row = makeRow({ itemNumber: 3, qty: 2 });
    const producedPanels = { [producedPanelKey(3, 1)]: false };
    const rows = buildPackingSlipRows(makeResult([row]), producedPanels);
    expect(rows[0]).toMatchObject({ producedCount: 0, remainingCount: 2 });
  });
});
