import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument, SketchPrimitive } from '@zilventor/shared';

type Ctx = {
  kernel: KernelClient;
  store: { activePart: PartDocument | null; setActivePart(p: PartDocument | null): void };
  sketchId: string;
  primitive: SketchPrimitive;
};

export class AddPrimitiveCommand implements Command {
  readonly name = 'AddPrimitive';
  private prior: PartDocument | null = null;

  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    const part = this.ctx.store.activePart;
    if (!part) throw new Error('no active part');
    this.prior = part;
    await this.ctx.kernel.addPrimitive(part.id, this.ctx.sketchId, this.ctx.primitive);
    const next = await this.ctx.kernel.getPart(part.id);
    this.ctx.store.setActivePart(next);
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    await this.ctx.kernel.removePrimitive(this.prior.id, this.ctx.sketchId, this.ctx.primitive.id);
    this.ctx.store.setActivePart(this.prior);
  }
}
