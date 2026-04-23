import type { Command } from './Command';
import type { SketchPrimitive } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export class DragPrimitivesCommand implements Command {
  readonly name = 'DragPrimitives';
  constructor(
    private sketchId: string,
    private before: Record<string, Partial<SketchPrimitive>>,
    private after:  Record<string, Partial<SketchPrimitive>>
  ) {}
  async apply(): Promise<void>  { this.write(this.after); }
  async revert(): Promise<void> { this.write(this.before); }
  private write(snap: Record<string, Partial<SketchPrimitive>>): void {
    const diff = Object.entries(snap).map(([primitiveId, patch]) => ({ primitiveId, patch }));
    useAppStore.getState().applyCoordDiff(this.sketchId, diff);
  }
}
