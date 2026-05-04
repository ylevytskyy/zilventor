import type { NestSheet } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared/src/material';
import { renderNestSheetPng } from '../nesting/renderNestSheetPng';
import { triggerDownload } from '../nesting/triggerDownload';

declare global {
  // E2E-inspectable bytes from the latest PNG export call (mirrors __zilventorNestPdfBytes).
  // eslint-disable-next-line no-var
  var __zilventorNestPngBytes: Uint8Array | undefined;
}

export class ExportNestPngCommand {
  constructor(private readonly opts: { sheet: NestSheet; materials: MaterialRegistry }) {}

  async apply(): Promise<void> {
    const { sheet, materials } = this.opts;
    const blob = await renderNestSheetPng(sheet, materials, { canvasWidthPx: 1024 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    (globalThis as { __zilventorNestPngBytes?: Uint8Array }).__zilventorNestPngBytes = buf;
    await triggerDownload(blob, {
      suggestedName: `nest-${sheet.materialId}-${sheet.sheetIndex}.png`,
      mimeType: 'image/png',
      extension: 'png',
      description: 'Nest sheet PNG',
    });
  }
}
