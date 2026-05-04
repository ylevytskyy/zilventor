import { describe, it, expect, vi } from 'vitest';
import { AddSweepFeatureCommand } from '../AddSweepFeatureCommand';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';
import { useAppStore } from '../../store/useAppStore';
import type { KernelClient } from '../../kernel-client/KernelClient';
import type { SweepFeature } from '@zilventor/shared';

describe('AddSweepFeatureCommand', () => {
  it('apply calls kernel.addFeature + execute + store.setActivePart', async () => {
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'P', units: 'mm', parameters: {}, properties: {}, featureTree: [], materials: [],
      hardware: [],
    });
    const kernel = {
      addFeature: vi.fn().mockResolvedValue(undefined),
      removeFeature: vi.fn().mockResolvedValue(undefined),
      setParameter: vi.fn().mockResolvedValue(undefined),
      deleteParameter: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue({ ok: true, value: { mesh: { positions: new Float32Array(), indices: new Uint32Array(), boundingBox: [0,0,0,0,0,0] as const } } }),
      getPart: vi.fn().mockResolvedValue({ id: 'P1', name: 'P', units: 'mm', parameters: {}, featureTree: [] })
    } as unknown as KernelClient;
    const registry = new ParameterRegistry();
    const feature: SweepFeature = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'P', pathSketchId: 'A',
      orientation: { kind: 'path' },
      operation: 'new',
    };
    const setActivePart = vi.fn();
    const cmd = new AddSweepFeatureCommand({
      partId: 'P1',
      feature,
      parameterExpressions: {},
      kernel,
      registry,
      store: { setActivePart },
    });

    await cmd.apply();

    expect(kernel.addFeature).toHaveBeenCalledWith('P1', feature);
    expect(kernel.execute).toHaveBeenCalledWith('P1');
    expect(kernel.getPart).toHaveBeenCalledWith('P1');
    expect(setActivePart).toHaveBeenCalled();
  });

  it('apply writes parameters then calls kernel pipeline', async () => {
    const kernel = {
      addFeature: vi.fn().mockResolvedValue(undefined),
      removeFeature: vi.fn().mockResolvedValue(undefined),
      setParameter: vi.fn().mockResolvedValue(undefined),
      deleteParameter: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue({ ok: true }),
      getPart: vi.fn().mockResolvedValue({ id: 'P1', name: 'P', units: 'mm', parameters: {}, featureTree: [] }),
    } as unknown as KernelClient;
    const registry = new ParameterRegistry();
    const feature: SweepFeature = {
      id: 'SW2', kind: 'sweep',
      profileSketchId: 'P', pathSketchId: 'A',
      orientation: { kind: 'path' },
      operation: 'new',
    };
    const cmd = new AddSweepFeatureCommand({
      partId: 'P1',
      feature,
      parameterExpressions: { sweep_d: { expression: '5', unit: 'mm' } },
      kernel,
      registry,
    });

    await cmd.apply();

    expect(registry.getValue('sweep_d')).toBe(5);
    expect(kernel.setParameter).toHaveBeenCalledWith('P1', expect.objectContaining({ name: 'sweep_d' }));
    expect(kernel.addFeature).toHaveBeenCalledWith('P1', feature);
  });

  it('revert removes feature and drops parameters', async () => {
    const kernel = {
      addFeature: vi.fn().mockResolvedValue(undefined),
      removeFeature: vi.fn().mockResolvedValue(undefined),
      setParameter: vi.fn().mockResolvedValue(undefined),
      deleteParameter: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue({ ok: true }),
      getPart: vi.fn().mockResolvedValue({ id: 'P1', name: 'P', units: 'mm', parameters: {}, featureTree: [] }),
    } as unknown as KernelClient;
    const registry = new ParameterRegistry();
    const feature: SweepFeature = {
      id: 'SW3', kind: 'sweep',
      profileSketchId: 'P', pathSketchId: 'A',
      orientation: { kind: 'path' },
      operation: 'new',
    };
    const cmd = new AddSweepFeatureCommand({
      partId: 'P1',
      feature,
      parameterExpressions: { sweep_d2: { expression: '3', unit: 'mm' } },
      kernel,
      registry,
    });

    await cmd.apply();
    expect(registry.getValue('sweep_d2')).toBe(3);

    await cmd.revert();
    expect(registry.getValue('sweep_d2')).toBeUndefined();
    expect(kernel.removeFeature).toHaveBeenCalledWith('P1', 'SW3');
    expect(kernel.deleteParameter).toHaveBeenCalledWith('P1', 'sweep_d2');
  });
});
