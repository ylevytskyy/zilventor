import type { Command } from './Command';
import type { DimensionConstraint } from '@zilventor/shared';
import type { AddDimensionResult } from '@zilventor/sketcher-worker';
import type { SketcherClient } from '../sketcher/SketcherClient';
import { useAppStore } from '../store/useAppStore';

/** Thrown when the worker rejects the dimension add as over-defining the sketch.
 *  Caught by the caller (App.tsx onDialogCommit) to show the toast + highlight. */
export class AddDimensionConflictError extends Error {
  constructor(public result: Extract<AddDimensionResult, { ok: false }>) {
    super(`Dimension over-defines sketch: ${result.reason}`);
  }
}

export class AddDimensionCommand implements Command {
  readonly name = 'AddDimension';
  constructor(
    private sketchId: string,
    private dimension: DimensionConstraint,
    private resolvedValue: number,
    private sketcherClient?: SketcherClient
  ) {}

  async apply(): Promise<void> {
    if (this.sketcherClient) {
      const res = await this.sketcherClient.addDimension(this.dimension, this.resolvedValue);
      if (!res.ok) throw new AddDimensionConflictError(res);
    }
    useAppStore.getState().addDimensionToActiveSketch(this.sketchId, this.dimension);
  }

  async revert(): Promise<void> {
    useAppStore.getState().removeDimensionFromActiveSketch(this.sketchId, this.dimension.id);
    if (this.sketcherClient) {
      await this.sketcherClient.removeDimension(this.dimension.id);
    }
  }
}
