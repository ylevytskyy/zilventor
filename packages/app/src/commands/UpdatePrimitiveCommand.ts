import type { Command } from './Command';
import type { SketchPrimitive } from '@zilventor/shared';
import type { SketcherClient } from '../sketcher/SketcherClient';
import { useAppStore } from '../store/useAppStore';

type Ctx = {
  sketchId: string;
  id: string;
  patch: Partial<SketchPrimitive>;
  sketcherClient?: SketcherClient | undefined;
};

/**
 * UpdatePrimitiveCommand — merges a Partial<SketchPrimitive> patch into the
 * primitive with matching id in the active sketch (apply), and restores the
 * prior field values on revert.
 *
 * If a sketcherClient is provided, also calls sketcherClient.updatePrimitive
 * to keep the GCS solver in sync.
 *
 * Mirrors AddPrimitiveCommand's dependency style; uses applyCoordDiff (same as
 * DragPrimitivesCommand) for the Zustand store update — no kernel RPC needed
 * since primitives in the sketch are store-only for coord edits.
 */
export class UpdatePrimitiveCommand implements Command {
  readonly name = 'UpdatePrimitive';
  private priorPatch: Partial<SketchPrimitive> | null = null;

  constructor(private readonly ctx: Ctx) {}

  async apply(): Promise<void> {
    const part = useAppStore.getState().activePart;
    if (!part) return;

    // Capture the prior values for the patched keys so we can revert.
    const sketch = part.featureTree.find(
      (f) => f.kind === 'sketch' && f.id === this.ctx.sketchId
    );
    if (!sketch || sketch.kind !== 'sketch') return;
    const prim = sketch.primitives.find((p) => p.id === this.ctx.id);
    if (!prim) return;

    const prior: Partial<SketchPrimitive> = {};
    for (const key of Object.keys(this.ctx.patch) as (keyof SketchPrimitive)[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prior as any)[key] = (prim as any)[key];
    }
    this.priorPatch = prior;

    useAppStore.getState().applyCoordDiff(this.ctx.sketchId, [
      { primitiveId: this.ctx.id, patch: this.ctx.patch },
    ]);

    if (this.ctx.sketcherClient) {
      await this.ctx.sketcherClient.updatePrimitive(this.ctx.id, this.ctx.patch);
    }
  }

  async revert(): Promise<void> {
    if (!this.priorPatch) return;
    const part = useAppStore.getState().activePart;
    if (!part) return;

    useAppStore.getState().applyCoordDiff(this.ctx.sketchId, [
      { primitiveId: this.ctx.id, patch: this.priorPatch },
    ]);

    if (this.ctx.sketcherClient) {
      await this.ctx.sketcherClient.updatePrimitive(this.ctx.id, this.priorPatch);
    }
  }
}
