import type { Command } from './Command';
import type { DimensionConstraint } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class AddDimensionCommand implements Command {
  readonly name = 'AddDimension';
  constructor(private sketchId: string, private dimension: DimensionConstraint) {}
  async apply(): Promise<void> {
    useAppStore.getState().addDimensionToActiveSketch(this.sketchId, this.dimension);
  }
  async revert(): Promise<void> {
    useAppStore.getState().removeDimensionFromActiveSketch(this.sketchId, this.dimension.id);
  }
}
