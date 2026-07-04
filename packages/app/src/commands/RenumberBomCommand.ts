import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';
import { aggregateBom, compareBomRowsForRenumber } from '@zilventor/shared/src/bomRow';
import type { PartInfo } from '@zilventor/shared';

/**
 * Resequences activeAssembly.bomItemNumbers to 1..N by row order.
 * Undoable: revert restores the exact prior map, including keys that were
 * absent before apply (a fresh deep-copy snapshot, not a merge).
 */
export class RenumberBomCommand implements Command {
  readonly name = 'RenumberBom';
  private priorMap: Record<string, number> | null = null;

  constructor(private opts: { partInfo: Map<string, PartInfo> }) {}

  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    this.priorMap = { ...a.bomItemNumbers };
    const rows = aggregateBom(a, this.opts.partInfo).slice().sort(compareBomRowsForRenumber);
    const next: Record<string, number> = {};
    rows.forEach((r, i) => { next[r.rowKey] = i + 1; });
    useAppStore.getState().setBomItemNumbers(next);
  }

  async revert(): Promise<void> {
    if (!this.priorMap) return;
    useAppStore.getState().setBomItemNumbers(this.priorMap);
    this.priorMap = null;
  }
}
