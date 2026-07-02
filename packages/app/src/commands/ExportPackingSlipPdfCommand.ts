import type { PackingSlipRow } from '../production/buildPackingSlipRows';
import { renderPackingSlipPdfBytes } from '../production/renderPackingSlipPdf';
import { triggerDownload } from '../nesting/triggerDownload';

declare global {
  // E2E-inspectable bytes from the latest export call (mirrors __zilventorNestPdfBytes).
  // eslint-disable-next-line no-var
  var __zilventorPackingSlipPdfBytes: Uint8Array | undefined;
}

export class ExportPackingSlipPdfCommand {
  constructor(private readonly opts: {
    rows: PackingSlipRow[];
    suggestedName: string;
    headerLine1?: string;
    headerLine2?: string;
  }) {}

  async apply(): Promise<void> {
    const buf = renderPackingSlipPdfBytes(this.opts.rows, {
      ...(this.opts.headerLine1 !== undefined ? { headerLine1: this.opts.headerLine1 } : {}),
      ...(this.opts.headerLine2 !== undefined ? { headerLine2: this.opts.headerLine2 } : {}),
    });
    (globalThis as { __zilventorPackingSlipPdfBytes?: Uint8Array }).__zilventorPackingSlipPdfBytes = buf;
    const blob = new Blob([buf as unknown as BlobPart], { type: 'application/pdf' });
    await triggerDownload(blob, {
      suggestedName: this.opts.suggestedName,
      mimeType: 'application/pdf', extension: 'pdf', description: 'Packing Slip PDF',
    });
  }
}
