import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

export class ToggleGroundedCommand implements Command {
  readonly name = 'ToggleGrounded';
  constructor(private opts: { componentId: string }) {}

  async apply(): Promise<void> {
    useAppStore.getState().toggleGrounded(this.opts.componentId);
  }

  async revert(): Promise<void> {
    useAppStore.getState().toggleGrounded(this.opts.componentId);
  }
}
