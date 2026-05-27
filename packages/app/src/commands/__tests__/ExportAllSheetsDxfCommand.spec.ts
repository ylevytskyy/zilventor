import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportAllSheetsDxfCommand } from '../ExportAllSheetsDxfCommand';
import type { DrawingDocument, DrawingSheet, PartDocument } from '@zilventor/shared';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../drawing/renderDrawingDxf', () => ({
  renderDrawingDxf: vi.fn((_d, sheet) => `DXF for ${sheet.name}`),
}));

import { triggerDownload } from '../../nesting/triggerDownload';
import { renderDrawingDxf } from '../../drawing/renderDrawingDxf';

const sheet = (id: string, name: string): DrawingSheet => ({
  id, name, size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
  views: [], dimensions: [], annotations: [], dimensionGroups: [], titleBlock: {},
});
const source = { id: 'p1', name: 'W', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [] } as unknown as PartDocument;
const drawing = (sheets: DrawingSheet[]): DrawingDocument => ({
  id: 'd1', name: 'MyDrawing', units: 'mm',
  source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
  sheets, activeSheetId: sheets[0]?.id ?? 's',
});

describe('ExportAllSheetsDxfCommand', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('ALL-DXF-1: renders every sheet and downloads one zip', async () => {
    const dwg = drawing([sheet('s1', 'Sheet 1'), sheet('s2', 'Sheet 2')]);
    await new ExportAllSheetsDxfCommand({ drawing: dwg, source }).apply();
    expect(renderDrawingDxf).toHaveBeenCalledTimes(2);
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob, opts] = (triggerDownload as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]! as [Blob, { suggestedName: string; mimeType: string; extension: string }];
    expect(opts.suggestedName).toBe('MyDrawing-all-sheets.zip');
    expect(opts.mimeType).toBe('application/zip');
    expect(opts.extension).toBe('zip');
    expect(blob.type).toBe('application/zip');
  });

  it('ALL-DXF-2: zip entries are index-prefixed per sheet, byte-exact', async () => {
    const { unzipSync, strFromU8 } = await import('fflate');
    const dwg = drawing([sheet('s1', 'Front'), sheet('s2', 'Top')]);
    await new ExportAllSheetsDxfCommand({ drawing: dwg, source }).apply();
    const blob = (triggerDownload as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as Blob;
    // jsdom Blob lacks arrayBuffer(); use FileReader (jsdom does implement it)
    const u8 = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    const back = unzipSync(u8);
    expect(Object.keys(back).sort()).toEqual(['01-Front.dxf', '02-Top.dxf']);
    expect(strFromU8(back['01-Front.dxf']!)).toBe('DXF for Front');
  });

  it('ALL-DXF-3: throws when the drawing has no sheets', async () => {
    await expect(new ExportAllSheetsDxfCommand({ drawing: drawing([]), source }).apply())
      .rejects.toThrow(/no sheets/i);
  });

  it('ALL-DXF-4: revert is a no-op', async () => {
    await expect(new ExportAllSheetsDxfCommand({ drawing: drawing([sheet('s1', 'A')]), source }).revert())
      .resolves.toBeUndefined();
  });
});
