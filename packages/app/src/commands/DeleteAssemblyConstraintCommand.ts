import type { Command } from './Command';
import type { AssemblyConstraint } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class DeleteAssemblyConstraintCommand implements Command {
  readonly name = 'DeleteAssemblyConstraint';
  private prior: { constraint: AssemblyConstraint; index: number } | null = null;
  constructor(private opts: { id: string }) {}

  async apply(): Promise<void> {
    const list = useAppStore.getState().activeAssembly?.constraints ?? [];
    const idx = list.findIndex((c) => c.id === this.opts.id);
    if (idx < 0) return;
    this.prior = { constraint: { ...list[idx]! } as AssemblyConstraint, index: idx };
    useAppStore.getState().removeAssemblyConstraint(this.opts.id);
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    useAppStore.getState().addAssemblyConstraint(this.prior.constraint);
    this.prior = null;
  }
}
