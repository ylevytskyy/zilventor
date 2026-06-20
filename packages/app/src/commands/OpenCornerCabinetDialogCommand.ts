import type { CornerCabinetParams } from '@zilventor/shared';
import type { Command } from './Command';
import { useAppStore, type CornerCabinetDialogState } from '../store/useAppStore';

export type OpenCornerCabinetDialogOpts = {
  initial?: CornerCabinetParams;
  onSubmit: (params: CornerCabinetParams) => void;
  onCancel?: () => void;
};

export class OpenCornerCabinetDialogCommand implements Command {
  readonly name = 'OpenCornerCabinetDialog';
  constructor(private readonly opts: OpenCornerCabinetDialogOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    if (!state.activeAssembly) throw new Error('NO_ACTIVE_ASSEMBLY');
    const slot: CornerCabinetDialogState = {
      ...(this.opts.initial ? { initial: this.opts.initial } : {}),
      onSubmit: this.opts.onSubmit,
      onCancel: this.opts.onCancel ?? (() => useAppStore.getState().setCornerCabinetDialog(null)),
    };
    useAppStore.getState().setCornerCabinetDialog(slot);
  }

  async revert(): Promise<void> {
    // No-op: dialog state is not undoable.
  }
}
