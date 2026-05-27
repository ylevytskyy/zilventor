import type { DrawingDocument } from '@zilventor/shared';
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
import { renderDrawingPdfBytes } from '../drawing/renderDrawingPdf';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportDrawingPdfCommand {
  readonly name = 'ExportDrawingPdf';

  constructor(
    private readonly opts: {
      drawing: DrawingDocument;
      source: PartDocument | AssemblyDocument | null;
      suggestedName?: string;
    },
  ) {}

  async apply(): Promise<void> {
    const buf = renderDrawingPdfBytes(this.opts.drawing, this.opts.source);
    // E2E-inspectable bytes hook (mirrors __zilventorNestPdfBytes in ExportNestPdfCommand)
    (globalThis as { __zilventorDrawingPdfBytes?: Uint8Array }).__zilventorDrawingPdfBytes = buf;
    const blob = new Blob([buf.buffer as ArrayBuffer], { type: 'application/pdf' });
    await triggerDownload(blob, {
      suggestedName: this.opts.suggestedName ?? `drawing-${timestamp()}.pdf`,
      mimeType: 'application/pdf',
      extension: 'pdf',
      description: 'Drawing PDF',
    });
  }

  async revert(): Promise<void> { /* non-undoable */ }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
