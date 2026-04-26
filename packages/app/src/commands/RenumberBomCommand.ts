import { useAppStore } from '../store/useAppStore';
import { aggregateBom, compareBomRowsForRenumber } from '@zilventor/shared/src/bomRow';

export class RenumberBomCommand {
  constructor(private opts: { partNames: Map<string, string> }) {}
  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    const rows = aggregateBom(a, this.opts.partNames).slice().sort(compareBomRowsForRenumber);
    const next: Record<string, number> = {};
    rows.forEach((r, i) => { next[r.rowKey] = i + 1; });
    useAppStore.getState().setBomItemNumbers(next);
  }
}
