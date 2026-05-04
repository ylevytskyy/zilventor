import { describe, it, expect } from 'vitest';
import { resolveHardwareSpec } from '../resolveHardwareSpec';
import type { HardwareFeature, HardwareRegistry } from '@zilventor/shared';

const registry: HardwareRegistry = [
  {
    id: 'hinge-35mm-cup-full',
    name: '35mm Cup Hinge — Full Overlay',
    category: 'hinges',
    vendor: 'Blum',
    notes: 'Requires 35mm Forstner bit',
  },
];

const hardwareFeature: HardwareFeature = {
  kind: 'hardware',
  id: 'hf-1',
  hardwareSkuId: 'hinge-35mm-cup-full',
  bboxMm: { l: 48, w: 35, h: 12 },
  attachPoints: [],
};

const panelLike = { kind: 'panel', id: 'pf-1', hardwareSkuId: undefined };

describe('resolveHardwareSpec', () => {
  it('returns null when featureTree is empty', () => {
    const part = { featureTree: [] } as never;
    expect(resolveHardwareSpec(part, registry)).toBeNull();
  });

  it('returns null when featureTree has no HardwareFeature', () => {
    const part = { featureTree: [panelLike] } as never;
    expect(resolveHardwareSpec(part, registry)).toBeNull();
  });

  it('returns null when SKU is not found in registry', () => {
    const unknownFeature: HardwareFeature = { ...hardwareFeature, hardwareSkuId: 'unknown-sku' };
    const part = { featureTree: [unknownFeature] } as never;
    expect(resolveHardwareSpec(part, registry)).toBeNull();
  });

  it('returns { entry, feature } for a valid HardwareFeature + matching SKU', () => {
    const part = { featureTree: [hardwareFeature] } as never;
    const result = resolveHardwareSpec(part, registry);
    expect(result).not.toBeNull();
    expect(result!.feature).toBe(hardwareFeature);
    expect(result!.entry.id).toBe('hinge-35mm-cup-full');
  });
});
