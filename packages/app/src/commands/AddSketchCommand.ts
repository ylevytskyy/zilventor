import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument, Feature } from '@zilventor/shared';

type Ctx = {
  kernel: KernelClient;
  store: { activePart: PartDocument | null; setActivePart(p: PartDocument | null): void };
  feature: Extract<Feature, { kind: 'sketch' }>;
};

export class AddSketchCommand implements Command {
  readonly name = 'AddSketch';
  private prior: PartDocument | null = null;
  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    const part = this.ctx.store.activePart;
    if (!part) throw new Error('no active part');
    this.prior = part;
    await this.ctx.kernel.addFeature(part.id, this.ctx.feature);
    const next = await this.ctx.kernel.getPart(part.id);
    this.ctx.store.setActivePart(next);
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    await this.ctx.kernel.removeFeature(this.prior.id, this.ctx.feature.id);
    this.ctx.store.setActivePart(this.prior);
  }
}
