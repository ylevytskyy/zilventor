import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import { runInventorImport, type ImportSummary, type ImportConflict } from '../import/InventorImporter';

export type ImportFromInventorCtx = {
  pickInput: () => Promise<FileSystemDirectoryHandle>;
  pickTarget: () => Promise<FileSystemDirectoryHandle>;
  conflict: ImportConflict;
  kernel: KernelClient;
  /** Injectable for tests; defaults to runInventorImport. */
  runImport?: typeof runInventorImport;
  onProgress?: (p: { current: number; total: number; path: string }) => void;
};

export class ImportFromInventorCommand implements Command {
  readonly name = 'ImportFromInventor';
  summary: ImportSummary | null = null;

  constructor(private readonly ctx: ImportFromInventorCtx) {}

  async apply(): Promise<void> {
    const input = await this.ctx.pickInput();
    const target = await this.ctx.pickTarget();
    const run = this.ctx.runImport ?? runInventorImport;
    this.summary = await run({
      input,
      target,
      conflict: this.ctx.conflict,
      kernel: this.ctx.kernel as Parameters<typeof runInventorImport>[0]['kernel'],
      ...(this.ctx.onProgress ? { onProgress: this.ctx.onProgress } : {}),
    });
  }

  async revert(): Promise<void> {
    // Import is non-undoable (writes many OPFS files). Revert is a no-op;
    // the user clears OPFS via the file manager if they want to undo.
  }
}
