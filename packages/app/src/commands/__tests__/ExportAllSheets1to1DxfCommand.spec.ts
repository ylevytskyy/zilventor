import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportAllSheets1to1DxfCommand } from '../ExportAllSheets1to1DxfCommand';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';

vi.mock('../../nesting/triggerDownload', () => ({
  triggerDownload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../drawing/renderDrawingDxf1to1', () => ({
  renderDrawingDxf1to1: vi.fn((_d, sheet) => `1TO1 ${sheet.name}`),
}));

import { triggerDownload } from '../../nesting/triggerDownload';
import { renderDrawingDxf1to1 } from '../../drawing/renderDrawingDxf1to1';

const baseView = { id: 'bv', kind: 'base' as const, positionMm: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 }, orientation: 'front' as const, showHidden: false,
  projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
  inputFingerprint: 'fp' };
const sheet = (id: string, name: string, withProj: boolean): DrawingSheet => ({
  id, name, size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
  views: withProj ? [baseView] : [], dimensions: [], annotations: [], dimensionGroups: [], titleBlock: {},
});
const drawing = (sheets: DrawingSheet[]): DrawingDocument => ({
  id: 'd1', name: 'MyDrawing', units: 'mm',
  source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
  sheets, activeSheetId: sheets[0]?.id ?? 's',
});

describe('ExportAllSheets1to1DxfCommand', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('ALL-1TO1-1: includes only sheets with a projected view; entries keep source index (gaps allowed) and -1to1 suffix', async () => {
    const { unzipSync } = await import('fflate');
    // sheet index 0 (no proj, skipped), index 1 (proj), index 2 (no proj, skipped), index 3 (proj)
    const dwg = drawing([
      sheet('s0', 'Cover', false),
      sheet('s1', 'Front', true),
      sheet('s2', 'Notes', false),
      sheet('s3', 'Top', true),
    ]);
    await new ExportAllSheets1to1DxfCommand({ drawing: dwg }).apply();
    expect(renderDrawingDxf1to1).toHaveBeenCalledTimes(2);
    const blob = (triggerDownload as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as Blob;
    // jsdom Blob lacks arrayBuffer(); use FileReader
    const u8 = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    const back = unzipSync(u8);
    expect(Object.keys(back).sort()).toEqual(['02-Front-1to1.dxf', '04-Top-1to1.dxf']);
    const opts = (triggerDownload as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as { suggestedName: string; mimeType: string };
    expect(opts.suggestedName).toBe('MyDrawing-all-sheets-1to1.zip');
    expect(opts.mimeType).toBe('application/zip');
  });

  it('ALL-1TO1-2: throws when no sheet has a projected view', async () => {
    const dwg = drawing([sheet('s0', 'Cover', false), sheet('s1', 'Notes', false)]);
    await expect(new ExportAllSheets1to1DxfCommand({ drawing: dwg }).apply())
      .rejects.toThrow(/projected view/i);
  });

  it('ALL-1TO1-3: revert is a no-op', async () => {
    await expect(new ExportAllSheets1to1DxfCommand({ drawing: drawing([sheet('s1', 'A', true)]) }).revert())
      .resolves.toBeUndefined();
  });
});
