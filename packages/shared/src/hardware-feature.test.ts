import { describe, it, expect } from 'vitest';
import {
  isHardwareFeature,
  type HardwareFeature,
  type HardwareEntry,
} from './hardware-feature';

const validFeature: HardwareFeature = {
  kind: 'hardware',
  id: 'hf-1',
  hardwareSkuId: 'hinge-35mm-cup-full',
  bboxMm: { l: 48, w: 35, h: 12 },
  attachPoints: [
    { name: 'cup-center', position: { x: 0, y: 17.5, z: 0 } },
    { name: 'arm-mount',  position: { x: 48, y: 17.5, z: 0 } },
  ],
};

describe('isHardwareFeature', () => {
  it('returns true for a valid HardwareFeature', () => {
    expect(isHardwareFeature(validFeature)).toBe(true);
  });

  it('returns false for a PanelFeature-shaped object', () => {
    expect(isHardwareFeature({ kind: 'panel', id: 'pf-1' })).toBe(false);
  });

  it('returns false for null and non-objects', () => {
    expect(isHardwareFeature(null)).toBe(false);
    expect(isHardwareFeature('hardware')).toBe(false);
    expect(isHardwareFeature(42)).toBe(false);
  });

  it('returns false when kind is missing', () => {
    expect(isHardwareFeature({ id: 'hf-1', hardwareSkuId: 'x', bboxMm: {}, attachPoints: [] })).toBe(false);
  });
});

describe('HardwareEntry shape', () => {
  it('compiles and accepts a valid entry', () => {
    const entry: HardwareEntry = {
      id: 'hinge-35mm-cup-full',
      name: '35mm Cup Hinge — Full Overlay',
      category: 'hinges',
      vendor: 'Blum',
      notes: 'Requires 35mm Forstner bit',
    };
    expect(entry.category).toBe('hinges');
  });
});
