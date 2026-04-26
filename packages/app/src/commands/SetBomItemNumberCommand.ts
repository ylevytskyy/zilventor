import { useAppStore } from '../store/useAppStore';

export class SetBomItemNumberCommand {
  constructor(private opts: { rowKey: string; n: number }) {}
  async apply(): Promise<void> {
    useAppStore.getState().setBomItemNumber(this.opts.rowKey, this.opts.n);
  }
}
