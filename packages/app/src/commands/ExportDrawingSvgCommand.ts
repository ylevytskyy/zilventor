import type { DrawingDocument } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { renderDrawingSvg } from '../drawing/renderDrawingSvg';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportDrawingSvgCommand {
  readonly name = 'ExportDrawingSvg';

  constructor(
    private readonly opts: {
      drawing: DrawingDocument;
      sheetId: string;
      source: PartDocument | AssemblyDocument;
      suggestedName?: string;
    },
  ) {}

  async apply(): Promise<void> {
    const sheet = this.opts.drawing.sheets.find((s) => s.id === this.opts.sheetId);
    if (!sheet) throw new Error(`Sheet ${this.opts.sheetId} not found`);
    const svgStr = renderDrawingSvg(this.opts.drawing, sheet, this.opts.source);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    await triggerDownload(blob, {
      suggestedName: this.opts.suggestedName ?? `drawing-${this.opts.sheetId}.svg`,
      mimeType: 'image/svg+xml',
      extension: 'svg',
      description: 'Drawing SVG',
    });
  }

  async revert(): Promise<void> { /* non-undoable */ }
}
