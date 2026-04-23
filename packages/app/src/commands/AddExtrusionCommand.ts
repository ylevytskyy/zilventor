import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument, Feature, Parameter } from '@zilventor/shared';

type Ctx = {
  kernel: KernelClient;
  store: { activePart: PartDocument | null; setActivePart(p: PartDocument | null): void };
  parameter: Parameter;
  feature: Extract<Feature, { kind: 'extrude' }>;
};

export class AddExtrusionCommand implements Command {
  readonly name = 'AddExtrusion';
  private prior: PartDocument | null = null;
  // Snapshot of the parameter the command is about to (over)write, so we can
  // distinguish "freshly created" (undefined) from "edited" (prior value) on revert.
  private priorParameter: Parameter | undefined;
  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    const part = this.ctx.store.activePart;
    if (!part) throw new Error('no active part');
    this.prior = part;
    this.priorParameter = part.parameters[this.ctx.parameter.name];
    await this.ctx.kernel.setParameter(part.id, this.ctx.parameter);
    await this.ctx.kernel.addFeature(part.id, this.ctx.feature);
    const next = await this.ctx.kernel.getPart(part.id);
    this.ctx.store.setActivePart(next);
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    // Remove the feature first, then roll the parameter back. Order matters:
    // if a re-execute happens between the two, a part without the extrude
    // feature is less broken than one with a stale parameter.
    await this.ctx.kernel.removeFeature(this.prior.id, this.ctx.feature.id);
    // Roll the parameter back in the kernel. If we freshly added it, delete it;
    // otherwise restore the previous value.
    if (this.priorParameter) {
      await this.ctx.kernel.setParameter(this.prior.id, this.priorParameter);
    } else {
      await this.ctx.kernel.deleteParameter(this.prior.id, this.ctx.parameter.name);
    }
    this.ctx.store.setActivePart(this.prior);
  }
}
