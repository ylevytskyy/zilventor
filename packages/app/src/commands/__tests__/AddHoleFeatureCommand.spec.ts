import { describe, it, expect, vi } from 'vitest';
import { AddHoleFeatureCommand } from '../AddHoleFeatureCommand';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';
import { useAppStore } from '../../store/useAppStore';
import type { KernelClient } from '../../kernel-client/KernelClient';
import type { HoleFeature } from '@zilventor/shared';

describe('AddHoleFeatureCommand', () => {
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
    const feature: HoleFeature = {
      kind: 'hole',
      id: 'H1',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 5 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const setActivePart = vi.fn();
    const cmd = new AddHoleFeatureCommand({
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
    const feature: HoleFeature = {
      kind: 'hole',
      id: 'H2',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: { kind: 'param', paramName: 'hole_d' } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 10 } },
      flipAxis: false,
    };
    const cmd = new AddHoleFeatureCommand({
      partId: 'P1',
      feature,
      parameterExpressions: { hole_d: { expression: '5', unit: 'mm' } },
      kernel,
      registry,
    });

    await cmd.apply();

    expect(registry.getValue('hole_d')).toBe(5);
    expect(kernel.setParameter).toHaveBeenCalledWith('P1', expect.objectContaining({ name: 'hole_d' }));
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
    const feature: HoleFeature = {
      kind: 'hole',
      id: 'H3',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: { kind: 'param', paramName: 'hole_d2' } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const cmd = new AddHoleFeatureCommand({
      partId: 'P1',
      feature,
      parameterExpressions: { hole_d2: { expression: '3', unit: 'mm' } },
      kernel,
      registry,
    });

    await cmd.apply();
    expect(registry.getValue('hole_d2')).toBe(3);

    await cmd.revert();
    expect(registry.getValue('hole_d2')).toBeUndefined();
    expect(kernel.removeFeature).toHaveBeenCalledWith('P1', 'H3');
    expect(kernel.deleteParameter).toHaveBeenCalledWith('P1', 'hole_d2');
  });
});
