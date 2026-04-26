import type { Command } from './Command';
import type { AssemblyConstraint } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type EditAssemblyConstraintOpts = { id: string; patch: Partial<AssemblyConstraint> };

export class EditAssemblyConstraintCommand implements Command {
  readonly name = 'EditAssemblyConstraint';
  private prior: AssemblyConstraint | null = null;
  constructor(private opts: EditAssemblyConstraintOpts) {}

  async apply(): Promise<void> {
    const c = useAppStore.getState().activeAssembly?.constraints.find((x) => x.id === this.opts.id);
    if (!c) throw new Error(`EditAssemblyConstraint: ${this.opts.id} not found`);
    this.prior = { ...c } as AssemblyConstraint;
    useAppStore.getState().updateAssemblyConstraint(this.opts.id, this.opts.patch);
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    useAppStore.getState().updateAssemblyConstraint(this.opts.id, this.prior);
    this.prior = null;
  }
}
