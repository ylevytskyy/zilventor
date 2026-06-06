import { describe, it, expect } from 'vitest';
import { panelUvProjection } from '../uv-projection';
import type { PanelFeature } from '../panel-feature';

function mkPanel(grain: 'length' | 'width' | 'none'): PanelFeature {
  return {
    kind: 'panel', id: 'p1',
    length: { kind: 'literal', value: 600 },
    width: { kind: 'literal', value: 400 },
    thickness: { kind: 'literal', value: 18 },
    thicknessFromMaterial: true,
    materialId: 'm1',
    grain,
    edgeBands: { front: null, back: null, left: null, right: null },
  };
}

describe('panelUvProjection', () => {
  it('returns mode planar for all grain values', () => {
    expect(panelUvProjection(mkPanel('length')).mode).toBe('planar');
    expect(panelUvProjection(mkPanel('width')).mode).toBe('planar');
    expect(panelUvProjection(mkPanel('none')).mode).toBe('planar');
  });

  it('grain=length: uAxis along X (length), vAxis along Y (width)', () => {
    const proj = panelUvProjection(mkPanel('length'));
    if (proj.mode !== 'planar') throw new Error('not planar');
    expect(proj.uAxis).toEqual({ x: 1, y: 0, z: 0 });
    expect(proj.vAxis).toEqual({ x: 0, y: 1, z: 0 });
    expect(proj.origin).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('grain=width: uAxis along Y (width), vAxis along X — 90° swap from length', () => {
    const proj = panelUvProjection(mkPanel('width'));
    if (proj.mode !== 'planar') throw new Error('not planar');
    expect(proj.uAxis).toEqual({ x: 0, y: 1, z: 0 });
    expect(proj.vAxis).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('grain=none: identical result to grain=length', () => {
    const noneProj = panelUvProjection(mkPanel('none'));
    const lengthProj = panelUvProjection(mkPanel('length'));
    expect(noneProj).toEqual(lengthProj);
  });
});
