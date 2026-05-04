import type { Command } from './Command';
import { useAppStore, type HardwareDialogState } from '../store/useAppStore';

export type OpenHardwareDialogOpts = {
  onSubmit: (skuId: string, qty: number) => void;
  onCancel?: () => void;
};

export class OpenHardwareDialogCommand implements Command {
  readonly name = 'OpenHardwareDialog';
  constructor(private readonly opts: OpenHardwareDialogOpts) {}

  async apply(): Promise<void> {
    if (!useAppStore.getState().activeAssembly) throw new Error('NO_ACTIVE_ASSEMBLY');
    const slot: HardwareDialogState = {
      onSubmit: this.opts.onSubmit,
      onCancel: this.opts.onCancel ?? (() => useAppStore.getState().setHardwareDialog(null)),
    };
    useAppStore.getState().setHardwareDialog(slot);
  }

  async revert(): Promise<void> {
    // No-op: dialog state is not undoable.
  }
}
