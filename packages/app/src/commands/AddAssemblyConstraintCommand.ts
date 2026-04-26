import type { Command } from './Command';
import type { AssemblyConstraint } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type AddAssemblyConstraintOpts = { constraint: AssemblyConstraint };

export class AddAssemblyConstraintCommand implements Command {
  readonly name = 'AddAssemblyConstraint';
  constructor(private opts: AddAssemblyConstraintOpts) {}

  async apply(): Promise<void> {
    useAppStore.getState().addAssemblyConstraint(this.opts.constraint);
  }

  async revert(): Promise<void> {
    useAppStore.getState().removeAssemblyConstraint(this.opts.constraint.id);
  }
}
