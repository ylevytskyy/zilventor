import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

export class OpenNestDialogCommand implements Command {
  readonly name = 'OpenNestDialog';

  async apply(): Promise<void> {
    useAppStore.getState().setNestDialog({ kind: 'open' });
  }

  async revert(): Promise<void> {
    // No-op: dialog state is not undoable.
  }
}
