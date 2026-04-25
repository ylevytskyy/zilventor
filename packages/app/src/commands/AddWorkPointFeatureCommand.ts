import type { Command } from './Command';
import type { PartDocument, WorkPointFeature } from '@zilventor/shared';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { ParameterRegistry } from '../parameters/ParameterRegistry';

export type AddWorkPointFeatureStore = {
  setActivePart(p: PartDocument | null): void;
};

export type AddWorkPointFeatureOpts = {
  partId: string;
  feature: WorkPointFeature;
  parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }>;
  kernel: KernelClient;
  registry: ParameterRegistry;
  store?: AddWorkPointFeatureStore;
};

/**
 * Mirrors AddWorkPlaneFeatureCommand. WorkPoint modes don't currently
 * carry ParamOrLiteral values, but `parameterExpressions` is kept for
 * symmetry with the plane/axis commands.
 */
export class AddWorkPointFeatureCommand implements Command {
  readonly name = 'AddWorkPointFeature';
  private writtenParams: string[] = [];
  constructor(private opts: AddWorkPointFeatureOpts) {}

  async apply(): Promise<void> {
    for (const [name, { expression, unit }] of Object.entries(this.opts.parameterExpressions)) {
      const res = this.opts.registry.setParameter({ name, expression, unit });
      if (!res.ok) {
        for (const n of this.writtenParams) this.opts.registry.removeParameter(n);
        this.writtenParams = [];
        throw new Error(`Parameter setup failed: ${JSON.stringify(res.error)}`);
      }
      this.writtenParams.push(name);
    }
    try {
      for (const name of this.writtenParams) {
        const val = this.opts.registry.getValue(name);
        const exprData = this.opts.parameterExpressions[name]!;
        await this.opts.kernel.setParameter(this.opts.partId, {
          name, expression: exprData.expression, value: val ?? 0, unit: exprData.unit,
        });
      }
      await this.opts.kernel.addFeature(this.opts.partId, this.opts.feature);
      await this.opts.kernel.execute(this.opts.partId);
      if (this.opts.store) {
        const next = await this.opts.kernel.getPart(this.opts.partId);
        this.opts.store.setActivePart(next);
      }
    } catch (e) {
      for (const n of this.writtenParams) this.opts.registry.removeParameter(n);
      this.writtenParams = [];
      throw e;
    }
  }

  async revert(): Promise<void> {
    await this.opts.kernel.removeFeature(this.opts.partId, this.opts.feature.id);
    for (const name of this.writtenParams) {
      this.opts.registry.removeParameter(name);
      await this.opts.kernel.deleteParameter(this.opts.partId, name);
    }
    this.writtenParams = [];
    await this.opts.kernel.execute(this.opts.partId);
    if (this.opts.store) {
      const next = await this.opts.kernel.getPart(this.opts.partId);
      this.opts.store.setActivePart(next);
    }
  }
}
