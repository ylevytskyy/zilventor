import type { Command } from './Command';
import type { SketchConstraint } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class RemoveConstraintCommand implements Command {
  readonly name = 'RemoveConstraint';
  constructor(private sketchId: string, private snapshot: SketchConstraint) {}
  async apply(): Promise<void> {
    useAppStore.getState().removeConstraintFromActiveSketch(this.sketchId, this.snapshot.id);
  }
  async revert(): Promise<void> {
    useAppStore.getState().addConstraintToActiveSketch(this.sketchId, this.snapshot);
  }
}
