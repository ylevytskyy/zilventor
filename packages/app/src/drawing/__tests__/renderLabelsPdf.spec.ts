import { describe, it, expect } from 'vitest';
import { renderLabelsPdf } from '../renderLabelsPdf';
import { buildPanelLabels } from '../buildPanelLabels';
import type { CutListResult, CutListRow } from '@zilventor/shared';

function row(over: Partial<CutListRow>): CutListRow {
  return {
    rowKey: 'k', itemNumber: 1, qty: 1, length: 600, width: 400, thickness: 18,
    materialId: 'mdf' as CutListRow['materialId'], materialName: 'MDF 18', grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
    partPath: 'p', partName: 'Side', componentPathKeys: ['c'], ...over,
  };
}

describe('renderLabelsPdf', () => {
  it('returns a non-empty PDF (%PDF header) for >10 labels', () => {
    const result: CutListResult = {
      rows: [row({ itemNumber: 1, qty: 12 })],
      bandTotals: [], excluded: { rows: [], reasons: [] } as unknown as CutListResult['excluded'],
    };
    const bytes = renderLabelsPdf(buildPanelLabels(result));
    expect(bytes.length).toBeGreaterThan(0);
    // "%PDF" magic = 0x25 0x50 0x44 0x46
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('produces a valid PDF for zero labels (single blank page, no throw)', () => {
    const bytes = renderLabelsPdf([]);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });
});
