import { describe, expect, it } from 'vitest';
import { isPanelFeature, resolvePanelSpecFromFeature, type PanelFeature } from '../panel-feature';
import type { Feature } from '../types';
import type { SketchParameter } from '../parameters';

const PANEL: PanelFeature = {
  kind: 'panel',
  id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-birch-18',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
};

describe('PanelFeature', () => {
  it('isPanelFeature accepts a well-formed feature', () => {
    expect(isPanelFeature(PANEL)).toBe(true);
  });

  it('isPanelFeature rejects another feature kind', () => {
    expect(isPanelFeature({ ...PANEL, kind: 'extrude' } as unknown)).toBe(false);
  });

  it('rejects unknown grain value', () => {
    expect(isPanelFeature({ ...PANEL, grain: 'diagonal' } as unknown)).toBe(false);
  });

  it('typechecks as Feature', () => {
    const f: Feature = PANEL;
    expect(f.kind).toBe('panel');
  });

  it('edge band slot accepts null and {materialId}', () => {
    const banded: PanelFeature = {
      ...PANEL,
      edgeBands: {
        front: { materialId: 'mat-pvc-1' },
        back: null,
        left: { materialId: 'mat-pvc-1' },
        right: null,
      },
    };
    expect(isPanelFeature(banded)).toBe(true);
  });
});

describe('resolvePanelSpecFromFeature', () => {
  const baseFeature: PanelFeature = {
    kind: 'panel',
    id: 'pf1',
    length: { kind: 'literal', value: 600 },
    width: { kind: 'literal', value: 400 },
    thickness: { kind: 'literal', value: 18 },
    thicknessFromMaterial: false,
    materialId: 'm-birch',
    grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
  };

  it('resolves literal L/W/T into a PanelSpec', () => {
    const spec = resolvePanelSpecFromFeature(baseFeature, {});
    expect(spec).not.toBeNull();
    expect(spec!.length).toBe(600);
    expect(spec!.width).toBe(400);
    expect(spec!.thickness).toBe(18);
    expect(spec!.materialId).toBe('m-birch');
    expect(spec!.grain).toBe('length');
  });

  it('resolves param-ref L against parameters map', () => {
    const params: Record<string, SketchParameter> = {
      panelL: { name: 'panelL', expression: '700', value: 700, unit: 'mm' },
    };
    const f: PanelFeature = { ...baseFeature, length: { kind: 'param', paramName: 'panelL' } };
    const spec = resolvePanelSpecFromFeature(f, params);
    expect(spec!.length).toBe(700);
  });

  it('returns null on broken param ref', () => {
    const f: PanelFeature = { ...baseFeature, length: { kind: 'param', paramName: 'doesNotExist' } };
    expect(resolvePanelSpecFromFeature(f, {})).toBeNull();
  });

  it('returns null on non-positive resolved length', () => {
    const f: PanelFeature = { ...baseFeature, length: { kind: 'literal', value: 0 } };
    expect(resolvePanelSpecFromFeature(f, {})).toBeNull();
  });

  it('returns null on NaN resolved width', () => {
    const f: PanelFeature = { ...baseFeature, width: { kind: 'literal', value: Number.NaN } };
    expect(resolvePanelSpecFromFeature(f, {})).toBeNull();
  });

  it('preserves edgeBand materialIds in the spec', () => {
    const f: PanelFeature = {
      ...baseFeature,
      edgeBands: {
        front: { materialId: 'm-pvc' },
        back: null,
        left: { materialId: 'm-pvc' },
        right: null,
      },
    };
    const spec = resolvePanelSpecFromFeature(f, {})!;
    expect(spec.edgeBands.front).toEqual({ materialId: 'm-pvc' });
    expect(spec.edgeBands.back).toBeNull();
    expect(spec.edgeBands.left).toEqual({ materialId: 'm-pvc' });
    expect(spec.edgeBands.right).toBeNull();
  });
});
