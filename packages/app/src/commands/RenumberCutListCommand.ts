import { useAppStore } from '../store/useAppStore';
import { compareCutListRowsForRenumber, type CutListResult } from '@zilventor/shared/src/cutListRow';

export class RenumberCutListCommand {
  constructor(private opts: { result: CutListResult }) {}
  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    const sorted = [...this.opts.result.rows].sort(compareCutListRowsForRenumber);
    const next: Record<string, number> = {};
    sorted.forEach((r, i) => { next[r.rowKey] = i + 1; });
    useAppStore.getState().setCutListItemNumbers(next);
  }
}
