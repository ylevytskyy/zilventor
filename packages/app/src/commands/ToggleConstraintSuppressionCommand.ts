import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

export class ToggleConstraintSuppressionCommand implements Command {
  readonly name = 'ToggleConstraintSuppression';
  constructor(private opts: { id: string }) {}

  async apply(): Promise<void> {
    useAppStore.getState().toggleConstraintSuppression(this.opts.id);
  }

  async revert(): Promise<void> {
    useAppStore.getState().toggleConstraintSuppression(this.opts.id);
  }
}
