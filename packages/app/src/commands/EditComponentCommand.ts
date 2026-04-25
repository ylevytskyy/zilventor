import type { Command } from './Command';
import type { ComponentInstance } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type EditComponentOpts = {
  id: string;
  patch: Partial<ComponentInstance>;
};

export class EditComponentCommand implements Command {
  readonly name = 'EditComponent';
  private prior: ComponentInstance | null = null;
  constructor(private opts: EditComponentOpts) {}

  async apply(): Promise<void> {
    const s = useAppStore.getState();
    const c = s.activeAssembly?.components.find((x) => x.id === this.opts.id);
    if (!c) throw new Error(`EditComponent: component ${this.opts.id} not found`);
    this.prior = { ...c };
    s.updateComponent(this.opts.id, this.opts.patch);
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    useAppStore.getState().updateComponent(this.opts.id, this.prior);
    this.prior = null;
  }
}
