import type { DrawingDocument } from '@zilventor/shared';
import { renderDrawingDxf1to1 } from '../drawing/renderDrawingDxf1to1';
import { buildDxfZip } from '../drawing/dxfZip';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportAllSheets1to1DxfCommand {
  readonly name = 'ExportAllSheets1to1Dxf';

  constructor(private readonly opts: { drawing: DrawingDocument }) {}

  async apply(): Promise<void> {
    const { drawing } = this.opts;
    const entries: Record<string, string> = {};
    drawing.sheets.forEach((sheet, i) => {
      if (!sheet.views.some((v) => v.projection != null)) return;
      const idx = String(i + 1).padStart(2, '0');
      entries[`${idx}-${sheet.name}-1to1.dxf`] = renderDrawingDxf1to1(drawing, sheet);
    });
    if (Object.keys(entries).length === 0) {
      throw new Error('No sheet has a projected view to export');
    }
    const blob = new Blob([buildDxfZip(entries)], { type: 'application/zip' });
    await triggerDownload(blob, {
      suggestedName: `${drawing.name}-all-sheets-1to1.zip`,
      mimeType: 'application/zip',
      extension: 'zip',
      description: 'DXF drawing set at 1:1 (machining size)',
    });
  }

  async revert(): Promise<void> { /* non-undoable */ }
}
