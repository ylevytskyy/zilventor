import type { Command } from './Command';
import type { DimensionConstraint } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class RemoveDimensionCommand implements Command {
  readonly name = 'RemoveDimension';
  constructor(private sketchId: string, private snapshot: DimensionConstraint) {}
  async apply(): Promise<void> {
    useAppStore.getState().removeDimensionFromActiveSketch(this.sketchId, this.snapshot.id);
  }
  async revert(): Promise<void> {
    useAppStore.getState().addDimensionToActiveSketch(this.sketchId, this.snapshot);
  }
}
