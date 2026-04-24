import type { Command } from './Command';
import type { SketcherClient } from '../sketcher/SketcherClient';
import { useAppStore } from '../store/useAppStore';

export class UpdateDimensionValueCommand implements Command {
  readonly name = 'UpdateDimensionValue';
  constructor(
    private sketchId: string,
    private dimId: string,
    private before: number,
    private after: number,
    private sketcherClient?: SketcherClient
  ) {}

  async apply(): Promise<void> {
    useAppStore.getState().updateDimensionValueInStore(this.sketchId, this.dimId, this.after);
    if (this.sketcherClient) {
      await this.sketcherClient.updateDimensionValue(this.dimId, this.after);
    }
  }

  async revert(): Promise<void> {
    useAppStore.getState().updateDimensionValueInStore(this.sketchId, this.dimId, this.before);
    if (this.sketcherClient) {
      await this.sketcherClient.updateDimensionValue(this.dimId, this.before);
    }
  }
}
