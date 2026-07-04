import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';
import { compareCutListRowsForRenumber, type CutListResult } from '@zilventor/shared/src/cutListRow';

/**
 * Resequences `cutListItemNumbers` to 1..N in sort order.
 * Undoable: revert restores the exact prior `cutListItemNumbers` map,
 * including any keys apply() dropped (apply replaces the whole map with one
 * keyed only by the rows in `result`, so stale keys from before apply are
 * lost unless snapshotted first).
 */
export class RenumberCutListCommand implements Command {
  readonly name = 'RenumberCutList';
  /** Deep-copy snapshot of the full map before apply(); null if apply no-op'd. */
  private prior: Record<string, number> | null = null;

  constructor(private opts: { result: CutListResult }) {}

  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    this.prior = { ...a.cutListItemNumbers };
    const sorted = [...this.opts.result.rows].sort(compareCutListRowsForRenumber);
    const next: Record<string, number> = {};
    sorted.forEach((r, i) => { next[r.rowKey] = i + 1; });
    useAppStore.getState().setCutListItemNumbers(next);
  }

  async revert(): Promise<void> {
    if (this.prior === null) return;
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    useAppStore.getState().setCutListItemNumbers(this.prior);
  }
}
