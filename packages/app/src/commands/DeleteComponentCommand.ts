import type { Command } from './Command';
import type { ComponentInstance } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type DeleteComponentOpts = { id: string };

export class DeleteComponentCommand implements Command {
  readonly name = 'DeleteComponent';
  private prior: ComponentInstance | null = null;
  constructor(private opts: DeleteComponentOpts) {}

  async apply(): Promise<void> {
    const s = useAppStore.getState();
    const c = s.activeAssembly?.components.find((x) => x.id === this.opts.id);
    if (!c) throw new Error(`DeleteComponent: component ${this.opts.id} not found`);
    this.prior = { ...c };
    s.removeComponent(this.opts.id);
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    useAppStore.getState().addComponent(this.prior);
    this.prior = null;
  }
}
