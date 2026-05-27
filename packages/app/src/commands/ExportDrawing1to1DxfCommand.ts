// packages/app/src/commands/ExportDrawing1to1DxfCommand.ts
import type { DrawingDocument } from '@zilventor/shared';
import { renderDrawingDxf1to1 } from '../drawing/renderDrawingDxf1to1';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportDrawing1to1DxfCommand {
  readonly name = 'ExportDrawing1to1Dxf';

  constructor(
    private readonly opts: { drawing: DrawingDocument; sheetId: string },
  ) {}

  async apply(): Promise<void> {
    const sheet = this.opts.drawing.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error(`Sheet ${this.opts.sheetId} not found`);
    const dxfStr = renderDrawingDxf1to1(this.opts.drawing, sheet);
    const blob = new Blob([dxfStr], { type: 'application/dxf' });
    await triggerDownload(blob, {
      suggestedName: `${this.opts.drawing.name}-${sheet.name}-1to1.dxf`,
      mimeType: 'application/dxf',
      extension: 'dxf',
      description: 'DXF drawing (1:1 machining size)',
    });
  }

  async revert(): Promise<void> { /* non-undoable */ }
}
