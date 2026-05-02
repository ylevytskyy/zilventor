import { beforeAll, describe, expect, it } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { evaluatePanel } from '../PanelFeature';
import type { PanelFeature } from '@zilventor/shared';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

const mkPanel = (over: Partial<PanelFeature> = {}): PanelFeature => ({
  kind: 'panel', id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width:  { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-1',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  ...over,
});

describe('evaluatePanel', () => {
  it('returns a tagged shape with bbox matching L x W x T', () => {
    const r = evaluatePanel(occt, mkPanel(), { parameters: {} });
    expect(r.bbox).toEqual([-300, -200, 0, 300, 200, 18]);
  });

  it('throws PANEL_NOT_BASE_FEATURE when index !== 0', () => {
    expect(() => evaluatePanel(occt, mkPanel(), { parameters: {}, featureIndex: 2 }))
      .toThrow(/PANEL_NOT_BASE_FEATURE/);
  });

  it('throws on non-positive dimension after parameter resolution', () => {
    const f = mkPanel({ length: { kind: 'literal', value: -1 } });
    expect(() => evaluatePanel(occt, f, { parameters: {} })).toThrow(/positive/);
  });

  it('skipped when suppressed', () => {
    const r = evaluatePanel(occt, mkPanel({ suppressed: true }), { parameters: {} });
    expect(r.skipped).toBe(true);
  });

  it('resolves param-typed dimensions', () => {
    const f = mkPanel({ length: { kind: 'param', paramName: 'L' } });
    const r = evaluatePanel(occt, f, { parameters: { L: { value: 1000, expression: '1000', units: 'mm' } } });
    expect(r.bbox?.[3]).toBe(500);
  });
});
