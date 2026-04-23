import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument, SketchPrimitive, Feature } from '@zilventor/shared';

type Ctx = {
  kernel: KernelClient;
  store: { activePart: PartDocument | null; setActivePart(p: PartDocument | null): void };
  sketchId: string;
  primitiveId: string;
};

export class DeletePrimitiveCommand implements Command {
  readonly name = 'DeletePrimitive';
  private prior: PartDocument | null = null;
  private deletedPrimitive: SketchPrimitive | null = null;

  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    const part = this.ctx.store.activePart;
    if (!part) throw new Error('no active part');
    const sketch = part.featureTree.find(
      (f): f is Extract<Feature, { kind: 'sketch' }> => f.kind === 'sketch' && f.id === this.ctx.sketchId
    );
    if (!sketch) throw new Error(`no sketch ${this.ctx.sketchId}`);
    const prim = sketch.primitives.find((p) => p.id === this.ctx.primitiveId);
    if (!prim) throw new Error(`no primitive ${this.ctx.primitiveId}`);
    this.prior = part;
    this.deletedPrimitive = prim;
    await this.ctx.kernel.removePrimitive(part.id, this.ctx.sketchId, this.ctx.primitiveId);
    const next = await this.ctx.kernel.getPart(part.id);
    this.ctx.store.setActivePart(next);
  }

  async revert(): Promise<void> {
    if (!this.prior || !this.deletedPrimitive) return;
    await this.ctx.kernel.addPrimitive(this.prior.id, this.ctx.sketchId, this.deletedPrimitive);
    this.ctx.store.setActivePart(this.prior);
  }
}
