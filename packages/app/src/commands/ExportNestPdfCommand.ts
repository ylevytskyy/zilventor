import type { NestState } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared/src/material';
import { renderNestPdfBytes } from '../nesting/renderNestPdf';
import { triggerDownload } from '../nesting/triggerDownload';

declare global {
  // E2E-inspectable bytes from the latest export call (mirrors __zilventorCutListCsvBytes).
  // eslint-disable-next-line no-var
  var __zilventorNestPdfBytes: Uint8Array | undefined;
}

export class ExportNestPdfCommand {
  constructor(private readonly opts: { nest: NestState; materials: MaterialRegistry; suggestedName?: string }) {}

  async apply(): Promise<void> {
    const buf = renderNestPdfBytes(this.opts.nest, this.opts.materials);
    (globalThis as { __zilventorNestPdfBytes?: Uint8Array }).__zilventorNestPdfBytes = buf;
    const blob = new Blob([buf], { type: 'application/pdf' });
    await triggerDownload(blob, {
      suggestedName: this.opts.suggestedName ?? `nest-${timestamp()}.pdf`,
      mimeType: 'application/pdf', extension: 'pdf', description: 'Nest PDF',
    });
  }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
