import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument } from '@zilventor/shared';

type Ctx = {
  kernel: KernelClient;
  store: { setActivePart(p: PartDocument | null): void };
  name: string;
};

export class CreatePartCommand implements Command {
  readonly name = 'CreatePart';
  private partId: string | null = null;
  constructor(private ctx: Ctx) {}

  async apply(): Promise<void> {
    this.partId = await this.ctx.kernel.createPart(this.ctx.name);
    const part = await this.ctx.kernel.getPart(this.partId);
    this.ctx.store.setActivePart(part);
  }

  async revert(): Promise<void> {
    // MVP: just set activePart to null. A future task may remove the part from the kernel.
    this.ctx.store.setActivePart(null);
  }
}
