import type { DrawingDocument, PartDocument, AssemblyDocument } from '@zilventor/shared';
import { renderDrawingDxf } from '../drawing/renderDrawingDxf';
import { buildDxfZip } from '../drawing/dxfZip';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportAllSheetsDxfCommand {
  readonly name = 'ExportAllSheetsDxf';

  constructor(
    private readonly opts: {
      drawing: DrawingDocument;
      source: PartDocument | AssemblyDocument | null;
    },
  ) {}

  async apply(): Promise<void> {
    const { drawing, source } = this.opts;
    if (drawing.sheets.length === 0) throw new Error('Drawing has no sheets to export');
    const entries: Record<string, string> = {};
    drawing.sheets.forEach((sheet, i) => {
      const idx = String(i + 1).padStart(2, '0');
      entries[`${idx}-${sheet.name}.dxf`] = renderDrawingDxf(drawing, sheet, source);
    });
    const blob = new Blob([buildDxfZip(entries) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
    await triggerDownload(blob, {
      suggestedName: `${drawing.name}-all-sheets.zip`,
      mimeType: 'application/zip',
      extension: 'zip',
      description: 'DXF drawing set (one DXF per sheet)',
    });
  }

  async revert(): Promise<void> { /* non-undoable */ }
}
