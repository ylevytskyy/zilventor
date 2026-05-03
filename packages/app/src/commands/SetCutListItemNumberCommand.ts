import { useAppStore } from '../store/useAppStore';

export class SetCutListItemNumberCommand {
  constructor(private opts: { rowKey: string; n: number }) {}
  async apply(): Promise<void> {
    useAppStore.getState().setCutListItemNumber(this.opts.rowKey, this.opts.n);
  }
}
