import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CutListResult, CutListRow } from '@zilventor/shared';
import { ExportPanelLabelsCommand } from '../ExportPanelLabelsCommand';
import * as renderLabelsPdfModule from '../../drawing/renderLabelsPdf';

// jsdom doesn't implement URL.createObjectURL — stub it for the fallback path.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

function row(over: Partial<CutListRow>): CutListRow {
  return {
    rowKey: 'k', itemNumber: 1, qty: 2, length: 600, width: 400, thickness: 18,
    materialId: 'mdf' as CutListRow['materialId'], materialName: 'MDF 18', grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
    partPath: 'p', partName: 'Side', componentPathKeys: ['a', 'b'], ...over,
  };
}

const result: CutListResult = {
  rows: [row({})],
  bandTotals: [], excluded: { rows: [], reasons: [] } as unknown as CutListResult['excluded'],
};

describe('ExportPanelLabelsCommand', () => {
  beforeEach(() => {
    delete (globalThis as { __zilventorPanelLabelsBytes?: Uint8Array }).__zilventorPanelLabelsBytes;
    delete (globalThis as Record<string, unknown>).showSaveFilePicker;
  });

  it('stashes a %PDF byte buffer on the globalThis hook', async () => {
    await new ExportPanelLabelsCommand({ cutListResult: result, suggestedName: 'labels.pdf' }).apply();
    const bytes = (globalThis as { __zilventorPanelLabelsBytes?: Uint8Array }).__zilventorPanelLabelsBytes;
    expect(bytes).toBeDefined();
    expect([bytes![0], bytes![1], bytes![2], bytes![3]]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('produces a valid PDF when templateId is compact with header lines', async () => {
    await new ExportPanelLabelsCommand({
      cutListResult: result,
      suggestedName: 'labels.pdf',
      templateId: 'compact',
      headerLine1: 'Acme Cabinets',
      headerLine2: 'Order #123',
    }).apply();
    const bytes = (globalThis as { __zilventorPanelLabelsBytes?: Uint8Array }).__zilventorPanelLabelsBytes;
    expect(bytes).toBeDefined();
    expect([bytes![0], bytes![1], bytes![2], bytes![3]]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('forwards templateId and header lines to renderLabelsPdf', async () => {
    const spy = vi.spyOn(renderLabelsPdfModule, 'renderLabelsPdf');
    await new ExportPanelLabelsCommand({
      cutListResult: result,
      suggestedName: 'labels.pdf',
      templateId: 'compact',
      headerLine1: 'Acme Cabinets',
      headerLine2: 'Order #123',
    }).apply();
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        templateId: 'compact',
        headerLine1: 'Acme Cabinets',
        headerLine2: 'Order #123',
      }),
    );
    spy.mockRestore();
  });

  it('omits templateId/headerLine keys entirely when not provided (exactOptionalPropertyTypes-safe)', async () => {
    const spy = vi.spyOn(renderLabelsPdfModule, 'renderLabelsPdf');
    await new ExportPanelLabelsCommand({ cutListResult: result, suggestedName: 'labels.pdf' }).apply();
    const passedOpts = spy.mock.calls[0]?.[1];
    expect(passedOpts).toEqual({});
    spy.mockRestore();
  });
});
