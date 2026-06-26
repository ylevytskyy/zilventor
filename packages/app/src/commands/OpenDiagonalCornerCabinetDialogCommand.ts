import type { DiagonalCornerCabinetParams } from '@zilventor/shared';
import type { Command } from './Command';
import { useAppStore, type DiagonalCornerCabinetDialogState } from '../store/useAppStore';

export type OpenDiagonalCornerCabinetDialogOpts = {
  initial?: DiagonalCornerCabinetParams;
  onSubmit: (params: DiagonalCornerCabinetParams) => void;
  onCancel?: () => void;
};

export class OpenDiagonalCornerCabinetDialogCommand implements Command {
  readonly name = 'OpenDiagonalCornerCabinetDialog';
  constructor(private readonly opts: OpenDiagonalCornerCabinetDialogOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    if (!state.activeAssembly) throw new Error('NO_ACTIVE_ASSEMBLY');
    const slot: DiagonalCornerCabinetDialogState = {
      ...(this.opts.initial ? { initial: this.opts.initial } : {}),
      onSubmit: this.opts.onSubmit,
      onCancel: this.opts.onCancel ?? (() => useAppStore.getState().setDiagonalCornerCabinetDialog(null)),
    };
    useAppStore.getState().setDiagonalCornerCabinetDialog(slot);
  }

  async revert(): Promise<void> {
    // No-op: dialog state is not undoable.
  }
}
