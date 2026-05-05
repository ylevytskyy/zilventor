import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';

/** Stub — implemented in Phase 9 (T52-T55). */
export class ExportDrawingPdfCommand implements Command {
  readonly name = 'ExportDrawingPdf';
  constructor(readonly opts: { drawing: DrawingDocument }) {}
  async apply(): Promise<void> { /* Phase 9 */ }
  async revert(): Promise<void> { /* n/a */ }
}
