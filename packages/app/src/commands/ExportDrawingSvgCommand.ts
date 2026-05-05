import type { Command } from './Command';
import type { DrawingDocument } from '@zilventor/shared';

/** Stub — implemented in Phase 9 (T52-T55). */
export class ExportDrawingSvgCommand implements Command {
  readonly name = 'ExportDrawingSvg';
  constructor(readonly opts: { drawing: DrawingDocument; sheetId: string }) {}
  async apply(): Promise<void> { /* Phase 9 */ }
  async revert(): Promise<void> { /* n/a */ }
}
