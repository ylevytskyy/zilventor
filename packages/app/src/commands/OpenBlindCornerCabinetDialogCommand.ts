import type { BlindCornerCabinetParams } from '@zilventor/shared';
import type { Command } from './Command';
import { useAppStore, type BlindCornerCabinetDialogState } from '../store/useAppStore';

export type OpenBlindCornerCabinetDialogOpts = {
  initial?: BlindCornerCabinetParams;
  onSubmit: (params: BlindCornerCabinetParams) => void;
  onCancel?: () => void;
};

export class OpenBlindCornerCabinetDialogCommand implements Command {
  readonly name = 'OpenBlindCornerCabinetDialog';
  constructor(private readonly opts: OpenBlindCornerCabinetDialogOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    if (!state.activeAssembly) throw new Error('NO_ACTIVE_ASSEMBLY');
    const slot: BlindCornerCabinetDialogState = {
      ...(this.opts.initial ? { initial: this.opts.initial } : {}),
      onSubmit: this.opts.onSubmit,
      onCancel: this.opts.onCancel ?? (() => useAppStore.getState().setBlindCornerCabinetDialog(null)),
    };
    useAppStore.getState().setBlindCornerCabinetDialog(slot);
  }

  async revert(): Promise<void> {
    // No-op: dialog state is not undoable.
  }
}
