import type { Command } from './Command';
import type { Feature, PartDocument } from '@zilventor/shared';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { ParameterRegistry } from '../parameters/ParameterRegistry';

export type AddRevolveFeatureStore = {
  setActivePart(p: PartDocument | null): void;
};

export class AddRevolveFeatureCommand implements Command {
  readonly name = 'AddRevolveFeature';
  constructor(
    private partId: string,
    private feature: Extract<Feature, { kind: 'revolve' }>,
    private angleExpression: string,
    private kernel: KernelClient,
    private registry: ParameterRegistry,
    // Optional so the existing unit tests (which predate this wiring) keep
    // working. When supplied, the command mirrors the kernel's updated part
    // back into the store so React sees the new feature in the tree — without
    // this the Browser pane / feature tree stays stale after commit.
    private store?: AddRevolveFeatureStore
  ) {}

  async apply(): Promise<void> {
    // Register the angle parameter in the main-thread registry so any
    // dependent expressions can resolve it and the UI can read its value.
    // Fail loudly on evaluation errors — a silent skip would leave the
    // kernel and registry out of sync.
    const res = this.registry.setParameter({
      name: this.feature.angleParam,
      expression: this.angleExpression,
      unit: 'deg'
    });
    if (!res.ok) {
      throw new Error(
        `failed to register angle parameter "${this.feature.angleParam}": ${JSON.stringify(res.error)}`
      );
    }
    await this.kernel.setParameter(this.partId, {
      name: this.feature.angleParam,
      expression: this.angleExpression,
      value: this.registry.getValue(this.feature.angleParam) ?? 0,
      unit: 'deg'
    });
    await this.kernel.addFeature(this.partId, this.feature);
    await this.kernel.execute(this.partId);
    if (this.store) {
      const next = await this.kernel.getPart(this.partId);
      this.store.setActivePart(next);
    }
  }

  async revert(): Promise<void> {
    // Remove the feature first so a recompute between calls sees a part
    // without the revolve rather than one with a stale parameter.
    await this.kernel.removeFeature(this.partId, this.feature.id);
    this.registry.removeParameter(this.feature.angleParam);
    await this.kernel.deleteParameter(this.partId, this.feature.angleParam);
    await this.kernel.execute(this.partId);
    if (this.store) {
      const next = await this.kernel.getPart(this.partId);
      this.store.setActivePart(next);
    }
  }
}
