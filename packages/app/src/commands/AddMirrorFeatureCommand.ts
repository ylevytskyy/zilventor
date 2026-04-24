import type { Command } from './Command';
import type { MirrorFeature, PartDocument } from '@zilventor/shared';
import type { KernelClient } from '../kernel-client/KernelClient';

export type AddMirrorFeatureStore = {
  setActivePart(p: PartDocument | null): void;
};

export type AddMirrorFeatureOpts = {
  partId: string;
  feature: MirrorFeature;
  kernel: KernelClient;
  store?: AddMirrorFeatureStore;
};

/**
 * Simpler than AddLinearPattern — mirror has no parameters of its own
 * (plane is an enum, no scratch param). Just addFeature + execute.
 */
export class AddMirrorFeatureCommand implements Command {
  readonly name = 'AddMirrorFeature';
  constructor(private opts: AddMirrorFeatureOpts) {}

  async apply(): Promise<void> {
    await this.opts.kernel.addFeature(this.opts.partId, this.opts.feature);
    await this.opts.kernel.execute(this.opts.partId);
    if (this.opts.store) {
      const next = await this.opts.kernel.getPart(this.opts.partId);
      this.opts.store.setActivePart(next);
    }
  }

  async revert(): Promise<void> {
    await this.opts.kernel.removeFeature(this.opts.partId, this.opts.feature.id);
    await this.opts.kernel.execute(this.opts.partId);
    if (this.opts.store) {
      const next = await this.opts.kernel.getPart(this.opts.partId);
      this.opts.store.setActivePart(next);
    }
  }
}
