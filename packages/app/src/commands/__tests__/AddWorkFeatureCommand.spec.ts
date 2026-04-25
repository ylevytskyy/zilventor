import { describe, it, expect, vi } from 'vitest';
import { AddWorkPlaneFeatureCommand } from '../AddWorkPlaneFeatureCommand';
import { AddWorkAxisFeatureCommand } from '../AddWorkAxisFeatureCommand';
import { AddWorkPointFeatureCommand } from '../AddWorkPointFeatureCommand';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';
import type { KernelClient } from '../../kernel-client/KernelClient';
import type { WorkPlaneFeature, WorkAxisFeature, WorkPointFeature } from '@zilventor/shared';

function mockKernel(): KernelClient {
  return {
    addFeature: vi.fn().mockResolvedValue(undefined),
    removeFeature: vi.fn().mockResolvedValue(undefined),
    setParameter: vi.fn().mockResolvedValue(undefined),
    deleteParameter: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({ ok: true }),
    getPart: vi.fn().mockResolvedValue({ id: 'P1', name: 'p', units: 'mm', parameters: {}, featureTree: [] }),
  } as unknown as KernelClient;
}

describe('AddWorkPlaneFeatureCommand', () => {
  it('apply writes a param-driven offset and adds the feature', async () => {
    const kernel = mockKernel();
    const registry = new ParameterRegistry();
    const feature: WorkPlaneFeature = {
      kind: 'workPlane', id: 'WP1', visible: true,
      source: {
        mode: 'offsetFromPlane',
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        offset: { kind: 'param', paramName: 'wp_offset' },
      },
    };
    const cmd = new AddWorkPlaneFeatureCommand({
      partId: 'P1',
      feature,
      parameterExpressions: { wp_offset: { expression: '10', unit: 'mm' } },
      kernel,
      registry,
    });
    await cmd.apply();
    expect(registry.getValue('wp_offset')).toBe(10);
    expect(kernel.setParameter).toHaveBeenCalledWith('P1', expect.objectContaining({ name: 'wp_offset' }));
    expect(kernel.addFeature).toHaveBeenCalledWith('P1', feature);
    expect(kernel.execute).toHaveBeenCalledWith('P1');
  });

  it('revert removes feature and drops parameters', async () => {
    const kernel = mockKernel();
    const registry = new ParameterRegistry();
    const feature: WorkPlaneFeature = {
      kind: 'workPlane', id: 'WP2', visible: true,
      source: { mode: 'origin', plane: 'XY' },
    };
    const cmd = new AddWorkPlaneFeatureCommand({
      partId: 'P1',
      feature,
      parameterExpressions: { wp_d: { expression: '5', unit: 'mm' } },
      kernel,
      registry,
    });
    await cmd.apply();
    await cmd.revert();
    expect(registry.getValue('wp_d')).toBeUndefined();
    expect(kernel.removeFeature).toHaveBeenCalledWith('P1', 'WP2');
    expect(kernel.deleteParameter).toHaveBeenCalledWith('P1', 'wp_d');
  });

  it('apply calls store.setActivePart when store is provided', async () => {
    const kernel = mockKernel();
    const registry = new ParameterRegistry();
    const setActivePart = vi.fn();
    const feature: WorkPlaneFeature = {
      kind: 'workPlane', id: 'WP3', visible: true,
      source: { mode: 'origin', plane: 'XY' },
    };
    const cmd = new AddWorkPlaneFeatureCommand({
      partId: 'P1',
      feature,
      parameterExpressions: {},
      kernel,
      registry,
      store: { setActivePart },
    });
    await cmd.apply();
    expect(setActivePart).toHaveBeenCalled();
  });
});

describe('AddWorkAxisFeatureCommand', () => {
  it('apply adds a workAxis feature', async () => {
    const kernel = mockKernel();
    const registry = new ParameterRegistry();
    const feature: WorkAxisFeature = {
      kind: 'workAxis', id: 'WA1', visible: true,
      source: { mode: 'origin', axis: 'X' },
    };
    const cmd = new AddWorkAxisFeatureCommand({
      partId: 'P1', feature, parameterExpressions: {}, kernel, registry,
    });
    await cmd.apply();
    expect(kernel.addFeature).toHaveBeenCalledWith('P1', feature);
  });

  it('revert removes the feature', async () => {
    const kernel = mockKernel();
    const registry = new ParameterRegistry();
    const feature: WorkAxisFeature = {
      kind: 'workAxis', id: 'WA2', visible: true,
      source: { mode: 'origin', axis: 'Y' },
    };
    const cmd = new AddWorkAxisFeatureCommand({
      partId: 'P1', feature, parameterExpressions: {}, kernel, registry,
    });
    await cmd.apply();
    await cmd.revert();
    expect(kernel.removeFeature).toHaveBeenCalledWith('P1', 'WA2');
  });
});

describe('AddWorkPointFeatureCommand', () => {
  it('apply adds a workPoint feature', async () => {
    const kernel = mockKernel();
    const registry = new ParameterRegistry();
    const feature: WorkPointFeature = {
      kind: 'workPoint', id: 'WPT1', visible: true,
      source: { mode: 'origin' },
    };
    const cmd = new AddWorkPointFeatureCommand({
      partId: 'P1', feature, parameterExpressions: {}, kernel, registry,
    });
    await cmd.apply();
    expect(kernel.addFeature).toHaveBeenCalledWith('P1', feature);
  });

  it('revert removes the feature', async () => {
    const kernel = mockKernel();
    const registry = new ParameterRegistry();
    const feature: WorkPointFeature = {
      kind: 'workPoint', id: 'WPT2', visible: true,
      source: { mode: 'origin' },
    };
    const cmd = new AddWorkPointFeatureCommand({
      partId: 'P1', feature, parameterExpressions: {}, kernel, registry,
    });
    await cmd.apply();
    await cmd.revert();
    expect(kernel.removeFeature).toHaveBeenCalledWith('P1', 'WPT2');
  });
});
