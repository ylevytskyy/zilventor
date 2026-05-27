// packages/app/src/commands/__tests__/ExportDrawing1to1DxfCommand.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportDrawing1to1DxfCommand } from '../ExportDrawing1to1DxfCommand';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../drawing/renderDrawingDxf1to1', () => ({
  renderDrawingDxf1to1: vi.fn().mockReturnValue('MOCK 1TO1 DXF'),
}));

import { triggerDownload } from '../../nesting/triggerDownload';
import { renderDrawingDxf1to1 } from '../../drawing/renderDrawingDxf1to1';

const mockSheet: DrawingSheet = {
  id: 'sh1', name: 'Sheet 1', size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
  views: [], dimensions: [], annotations: [], dimensionGroups: [], titleBlock: {},
};
const mockDrawing: DrawingDocument = {
  id: 'd1', name: 'MyDrawing', units: 'mm',
  source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
  sheets: [mockSheet], activeSheetId: 'sh1',
};

describe('ExportDrawing1to1DxfCommand', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('CMD-1TO1-1: renders the sheet and downloads with a -1to1.dxf name (no source needed)', async () => {
    const cmd = new ExportDrawing1to1DxfCommand({ drawing: mockDrawing, sheetId: 'sh1' });
    await cmd.apply();
    expect(renderDrawingDxf1to1).toHaveBeenCalledWith(mockDrawing, mockSheet);
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const opts = (triggerDownload as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as { suggestedName: string; extension: string };
    expect(opts.suggestedName).toBe('MyDrawing-Sheet 1-1to1.dxf');
    expect(opts.extension).toBe('dxf');
  });

  it('CMD-1TO1-2: throws when the sheet id is unknown', async () => {
    const cmd = new ExportDrawing1to1DxfCommand({ drawing: mockDrawing, sheetId: 'nope' });
    await expect(cmd.apply()).rejects.toThrow('Sheet nope not found');
  });
});
