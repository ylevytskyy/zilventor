import type { Command } from './Command';
import type { ShelfPinParams } from '@zilventor/shared';
import { GenerateShelfPinBoresCommand } from './GenerateShelfPinBoresCommand';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

/**
 * Re-runs the carcass система-32 shelf-pin grid with a new column start offset,
 * preserving the rest of the grid params (the caller passes them — typically read
 * back from the selected panel's persisted `document.shelfPinParams`). A thin,
 * separately-named wrapper over GenerateShelfPinBoresCommand so the undo history
 * shows a distinct "start offset" entry.
 *
 * Caveat (guard/warn handled by the caller): like every shelf-pin regen, mergeBores
 * preserves bores the user manually edited (edited===true) — those will NOT follow
 * the new offset. BorePropertiesPanel warns when such edits exist.
 */
export class UpdateShelfPinStartOffsetCommand implements Command {
  readonly name = 'UpdateShelfPinStartOffset';
  private inner: GenerateShelfPinBoresCommand | null = null;

  constructor(private readonly opts: { params: ShelfPinParams; opfs: OpfsRW | null; store?: typeof useAppStore }) {}

  async apply(): Promise<void> {
    if (!this.opts.opfs) return;
    this.inner = new GenerateShelfPinBoresCommand({
      params: this.opts.params,
      opfs: this.opts.opfs,
      ...(this.opts.store ? { store: this.opts.store } : {}),
    });
    await this.inner.apply();
  }

  async revert(): Promise<void> {
    await this.inner?.revert();
  }
}
