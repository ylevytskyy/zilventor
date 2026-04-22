import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument, Parameter } from '@zilventor/shared';

type Ctx = {
  kernel: KernelClient;
  store: { activePart: PartDocument | null; setActivePart(p: PartDocument | null): void };
  parameter: Parameter;
};

export class EditParameterCommand implements Command {
  readonly name = 'EditParameter';
  private prior: Parameter | undefined;
  private partId: string | null = null;
  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    const part = this.ctx.store.activePart;
    if (!part) throw new Error('no active part');
    this.partId = part.id;
    this.prior = part.parameters[this.ctx.parameter.name];
    await this.ctx.kernel.setParameter(part.id, this.ctx.parameter);
    const next = await this.ctx.kernel.getPart(part.id);
    this.ctx.store.setActivePart(next);
  }

  async revert(): Promise<void> {
    if (!this.partId || !this.prior) return;
    await this.ctx.kernel.setParameter(this.partId, this.prior);
    const restored = await this.ctx.kernel.getPart(this.partId);
    this.ctx.store.setActivePart(restored);
  }
}
