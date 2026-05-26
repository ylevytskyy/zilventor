import type { DrawingDocument, PartDocument, AssemblyDocument } from '@zilventor/shared';
import { renderDrawingDxf } from '../drawing/renderDrawingDxf';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportDrawingDxfCommand {
  readonly name = 'ExportDrawingDxf';

  constructor(
    private readonly opts: {
      drawing: DrawingDocument;
      sheetId: string;
      source: PartDocument | AssemblyDocument;
    },
  ) {}

  async apply(): Promise<void> {
    const sheet = this.opts.drawing.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error(`Sheet ${this.opts.sheetId} not found`);
    const dxfStr = renderDrawingDxf(this.opts.drawing, sheet, this.opts.source);
    const blob = new Blob([dxfStr], { type: 'application/dxf' });
    await triggerDownload(blob, {
      suggestedName: `${this.opts.drawing.name}-${sheet.name}.dxf`,
      mimeType: 'application/dxf',
      extension: 'dxf',
      description: 'DXF drawing',
    });
  }

  async revert(): Promise<void> { /* non-undoable */ }
}
