// packages/app/src/commands/__tests__/ExportDrawingDxfCommand.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportDrawingDxfCommand } from '../ExportDrawingDxfCommand';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

// Stub triggerDownload to capture args
vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));

// Stub renderDrawingDxf to avoid importing full renderer in unit test
vi.mock('../../drawing/renderDrawingDxf', () => ({
  renderDrawingDxf: vi.fn().mockReturnValue('MOCK DXF CONTENT'),
}));

import { triggerDownload } from '../../nesting/triggerDownload';
import { renderDrawingDxf } from '../../drawing/renderDrawingDxf';

const mockSheet: DrawingSheet = {
  id: 'sh1', name: 'Sheet 1',
  size: { kind: 'iso', size: 'A4' },
  orientation: 'landscape',
  views: [], dimensions: [], annotations: [], dimensionGroups: [],
  titleBlock: {},
};

const mockDrawing: DrawingDocument = {
  id: 'd1', name: 'MyDrawing', units: 'mm',
  source: { partPath: 'p.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [mockSheet],
  activeSheetId: mockSheet.id,
};

const mockPart = { id: 'p1' } as unknown as PartDocument;

describe('ExportDrawingDxfCommand', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('CMD-DXF-1: calls renderDrawingDxf with drawing, sheet, source', async () => {
    const cmd = new ExportDrawingDxfCommand({ drawing: mockDrawing, sheetId: 'sh1', source: mockPart });
    await cmd.apply();
    expect(renderDrawingDxf).toHaveBeenCalledWith(mockDrawing, mockSheet, mockPart);
  });

  it('CMD-DXF-2: calls triggerDownload with correct mimeType and extension', async () => {
    const cmd = new ExportDrawingDxfCommand({ drawing: mockDrawing, sheetId: 'sh1', source: mockPart });
    await cmd.apply();
    expect(triggerDownload).toHaveBeenCalledOnce();
    const [, opts] = (triggerDownload as ReturnType<typeof vi.fn>).mock.calls[0] as [Blob, {mimeType:string; extension:string; suggestedName:string}];
    expect(opts.mimeType).toBe('application/dxf');
    expect(opts.extension).toBe('dxf');
    expect(opts.suggestedName).toMatch(/\.dxf$/);
  });

  it('CMD-DXF-3: throws if sheetId not found', async () => {
    const cmd = new ExportDrawingDxfCommand({ drawing: mockDrawing, sheetId: 'no-such', source: mockPart });
    await expect(cmd.apply()).rejects.toThrow('Sheet no-such not found');
  });

  it('CMD-DXF-4: revert is a no-op', async () => {
    const cmd = new ExportDrawingDxfCommand({ drawing: mockDrawing, sheetId: 'sh1', source: mockPart });
    await expect(cmd.revert()).resolves.toBeUndefined();
  });
});

describe('ExportDrawingDxfCommand — null source (source-optional export)', () => {
  it('constructs and applies with a null source', async () => {
    const drawing: DrawingDocument = {
      id: 'dw1', name: 'Null-Source', units: 'mm',
      source: { partPath: 'parts/dummy.zipt', sourceKind: 'part' }, properties: {},
      sheets: [{
        id: 'sh1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape', views: [], dimensions: [], annotations: [],
        titleBlock: {}, dimensionGroups: [],
      }],
      activeSheetId: 'sh1',
    };
    const cmd = new ExportDrawingDxfCommand({ drawing, sheetId: 'sh1', source: null });
    await expect(cmd.apply()).resolves.toBeUndefined();
  });
});
