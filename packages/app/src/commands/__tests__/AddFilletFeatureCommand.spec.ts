import { describe, it, expect, vi } from 'vitest';
import { AddFilletFeatureCommand } from '../AddFilletFeatureCommand';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';
import { useAppStore } from '../../store/useAppStore';
import type { KernelClient } from '../../kernel-client/KernelClient';
import type { FilletFeature } from '@zilventor/shared';

describe('AddFilletFeatureCommand', () => {
  it('apply writes parameters + feature; revert rolls them back', async () => {
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'P', units: 'mm', parameters: {}, properties: {}, featureTree: [], materials: []
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
    const feature: FilletFeature = {
      kind: 'fillet', id: 'F1', mode: 'constant',
      edges: [{
        edgeId: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side', instance: 0 } },
        selectionMode: 'edge',
        radius: { kind: 'param', paramName: 'r_fillet' }
      }],
      setbacks: []
    };
    const cmd = new AddFilletFeatureCommand({
      partId: 'P1',
      feature,
      parameterExpressions: { r_fillet: { expression: '2', unit: 'mm' } },
      kernel,
      registry,
      store: { setActivePart: useAppStore.getState().setActivePart }
    });
    await cmd.apply();
    expect(registry.getValue('r_fillet')).toBe(2);
    expect(kernel.addFeature).toHaveBeenCalledWith('P1', feature);
    await cmd.revert();
    expect(registry.getValue('r_fillet')).toBeUndefined();
    expect(kernel.removeFeature).toHaveBeenCalledWith('P1', 'F1');
  });
});
