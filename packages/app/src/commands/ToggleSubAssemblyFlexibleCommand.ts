import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

export class ToggleSubAssemblyFlexibleCommand implements Command {
  readonly name = 'ToggleSubAssemblyFlexible';
  private prev: boolean | undefined;
  constructor(private readonly args: { componentId: string }) {}

  async apply(): Promise<void> {
    const s = useAppStore.getState();
    if (s.activeDocument?.kind !== 'assembly') return;
    const c = s.activeDocument.document.components.find((x) => x.id === this.args.componentId);
    if (!c) return;
    this.prev = c.flexible;
    s.setComponentFlexible(this.args.componentId, !c.flexible);
  }

  async revert(): Promise<void> {
    if (this.prev === undefined) {
      // No previous flag means component was rigid (undefined). Reset to false
      // and then clear by setting to undefined-equivalent (false).
      useAppStore.getState().setComponentFlexible(this.args.componentId, false);
      return;
    }
    useAppStore.getState().setComponentFlexible(this.args.componentId, this.prev);
  }
}
