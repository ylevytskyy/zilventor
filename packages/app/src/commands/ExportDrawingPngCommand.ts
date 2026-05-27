import type { DrawingDocument } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { renderDrawingPngForSheet } from '../drawing/renderDrawingPngForSheet';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportDrawingPngCommand {
  readonly name = 'ExportDrawingPng';

  constructor(
    private readonly opts: {
      drawing: DrawingDocument;
      sheetId: string;
      source: PartDocument | AssemblyDocument | null;
      canvasWidthPx?: number;
      suggestedName?: string;
    },
  ) {}

  async apply(): Promise<void> {
    const sheet = this.opts.drawing.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error(`Sheet ${this.opts.sheetId} not found`);
    const blob = await renderDrawingPngForSheet(
      this.opts.drawing,
      sheet,
      this.opts.source,
      { canvasWidthPx: this.opts.canvasWidthPx ?? 1024 },
    );
    await triggerDownload(blob, {
      suggestedName: this.opts.suggestedName ?? `drawing-${this.opts.sheetId}.png`,
      mimeType: 'image/png',
      extension: 'png',
      description: 'Drawing PNG',
    });
  }

  async revert(): Promise<void> { /* non-undoable */ }
}
