import type { BaseCabinetParams } from '@zilventor/shared';
import type { Command } from './Command';
import { useAppStore, type CabinetDialogState } from '../store/useAppStore';

export type OpenCabinetDialogOpts = {
  template: 'baseCabinet';
  initial?: BaseCabinetParams;
  onSubmit: (params: BaseCabinetParams) => void;
  onCancel?: () => void;
};

export class OpenCabinetDialogCommand implements Command {
  readonly name = 'OpenCabinetDialog';
  constructor(private readonly opts: OpenCabinetDialogOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    if (!state.activeAssembly) throw new Error('NO_ACTIVE_ASSEMBLY');
    const slot: CabinetDialogState = {
      template: this.opts.template,
      ...(this.opts.initial ? { initial: this.opts.initial } : {}),
      onSubmit: this.opts.onSubmit,
      onCancel: this.opts.onCancel ?? (() => useAppStore.getState().setCabinetDialog(null)),
    };
    useAppStore.getState().setCabinetDialog(slot);
  }

  async revert(): Promise<void> {
    // No-op: dialog state is not undoable.
  }
}
