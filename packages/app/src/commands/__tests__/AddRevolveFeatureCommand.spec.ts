import { describe, it, expect, vi } from 'vitest';
import { AddRevolveFeatureCommand } from '../AddRevolveFeatureCommand';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';
import { useAppStore } from '../../store/useAppStore';
import type { KernelClient } from '../../kernel-client/KernelClient';
import type { Feature } from '@zilventor/shared';

describe('AddRevolveFeatureCommand', () => {
  it('apply adds feature to kernel and parameter to registry; revert rolls both back', async () => {
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'P', units: 'mm',
      parameters: {},
      featureTree: [{ kind: 'sketch', id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] }]
    });

    const kernel = {
      addFeature: vi.fn().mockResolvedValue(undefined),
      removeFeature: vi.fn().mockResolvedValue(undefined),
      setParameter: vi.fn().mockResolvedValue(undefined),
      deleteParameter: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue({ ok: true, value: { mesh: { positions: new Float32Array(), indices: new Uint32Array(), boundingBox: [0,0,0,0,0,0] as const } } })
    } as unknown as KernelClient;

    const registry = new ParameterRegistry();
    const feature: Extract<Feature, { kind: 'revolve' }> = {
      kind: 'revolve', id: 'R1', sketchRef: 'S1',
      axisPrimitiveId: 'L1', angleParam: 'angle0',
      direction: 'normal', operation: 'new'
    };

    const cmd = new AddRevolveFeatureCommand('P1', feature, '360', kernel, registry);
    await cmd.apply();
    expect(registry.getValue('angle0')).toBe(360);
    expect(kernel.addFeature).toHaveBeenCalledWith('P1', feature);
    expect(kernel.execute).toHaveBeenCalled();

    await cmd.revert();
    expect(registry.getValue('angle0')).toBeUndefined();
    expect(kernel.removeFeature).toHaveBeenCalledWith('P1', 'R1');
  });
});
