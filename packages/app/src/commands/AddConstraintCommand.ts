import type { Command } from './Command';
import type { SketchConstraint } from '@zilventor/shared';
import type { SketcherClient } from '../sketcher/SketcherClient';
import { useAppStore } from '../store/useAppStore';

export class AddConstraintCommand implements Command {
  readonly name = 'AddConstraint';
  constructor(
    private sketchId: string,
    private constraint: SketchConstraint,
    private sketcherClient?: SketcherClient
  ) {}

  async apply(): Promise<void> {
    useAppStore.getState().addConstraintToActiveSketch(this.sketchId, this.constraint);
    if (this.sketcherClient) {
      await this.sketcherClient.addConstraint(this.constraint);
    }
  }

  async revert(): Promise<void> {
    useAppStore.getState().removeConstraintFromActiveSketch(this.sketchId, this.constraint.id);
    if (this.sketcherClient) {
      await this.sketcherClient.removeConstraint(this.constraint.id);
    }
  }
}
