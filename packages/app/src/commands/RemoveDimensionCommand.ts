import type { Command } from './Command';
import type { DimensionConstraint } from '@zilventor/shared';
import type { SketcherClient } from '../sketcher/SketcherClient';
import { useAppStore } from '../store/useAppStore';

export class RemoveDimensionCommand implements Command {
  readonly name = 'RemoveDimension';
  constructor(
    private sketchId: string,
    private snapshot: DimensionConstraint,
    private resolvedValue: number,
    private sketcherClient?: SketcherClient
  ) {}

  async apply(): Promise<void> {
    useAppStore.getState().removeDimensionFromActiveSketch(this.sketchId, this.snapshot.id);
    if (this.sketcherClient) {
      await this.sketcherClient.removeDimension(this.snapshot.id);
    }
  }

  async revert(): Promise<void> {
    useAppStore.getState().addDimensionToActiveSketch(this.sketchId, this.snapshot);
    if (this.sketcherClient) {
      await this.sketcherClient.addDimension(this.snapshot, this.resolvedValue);
    }
  }
}
