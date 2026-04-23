import type { Command } from './Command';
import type { SketchConstraint } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddConstraintCommand implements Command {
  readonly name = 'AddConstraint';
  constructor(private sketchId: string, private constraint: SketchConstraint) {}
  async apply(): Promise<void> {
    useAppStore.getState().addConstraintToActiveSketch(this.sketchId, this.constraint);
  }
  async revert(): Promise<void> {
    useAppStore.getState().removeConstraintFromActiveSketch(this.sketchId, this.constraint.id);
  }
}
