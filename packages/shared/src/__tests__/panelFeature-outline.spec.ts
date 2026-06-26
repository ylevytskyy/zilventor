import { describe, it, expect } from 'vitest';
import { isPanelFeature, type PanelFeature } from '../panel-feature';

const BASE: PanelFeature = {
  kind: 'panel', id: 'pf1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 600 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'm-birch',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
};

describe('PanelFeature.outline', () => {
  it('isPanelFeature accepts a panel without outline (backward compat)', () => {
    expect(isPanelFeature(BASE)).toBe(true);
  });

  it('isPanelFeature accepts a panel with a valid CCW outline', () => {
    const p: PanelFeature = {
      ...BASE,
      ...(true ? { outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }] } : {}),
    };
    expect(isPanelFeature(p)).toBe(true);
  });

  it('isPanelFeature rejects outline vertex missing y', () => {
    const bad = { ...BASE, outline: [{ x: 0 }, { x: 600, y: 0 }] };
    expect(isPanelFeature(bad as unknown)).toBe(false);
  });

  it('isPanelFeature rejects outline that is not an array', () => {
    const bad = { ...BASE, outline: 'polygon' };
    expect(isPanelFeature(bad as unknown)).toBe(false);
  });
});
