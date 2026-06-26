import { beforeAll, describe, expect, it } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { evaluatePanel } from '../PanelFeature';
import type { PanelFeature } from '@zilventor/shared';

/** Count faces in a TopoDS_Shape via TopExp_Explorer. */
function countFaces(oc: OcctInstance, shape: unknown): number {
  const ocAny = oc as unknown as {
    TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
      More: () => boolean;
      Next: () => void;
      delete: () => void;
    };
    TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
  };
  const expl = new ocAny.TopExp_Explorer_2(
    shape,
    ocAny.TopAbs_ShapeEnum.TopAbs_FACE,
    ocAny.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  let n = 0;
  while (expl.More()) { n++; expl.Next(); }
  expl.delete();
  return n;
}

/** Compute volume of a TopoDS solid via BRepGProp.VolumeProperties_1. */
function solidVolume(oc: OcctInstance, shape: unknown): number {
  const ocAny = oc as unknown as {
    GProp_GProps_1: new () => { Mass: () => number; delete: () => void };
    BRepGProp: { VolumeProperties_1: (s: unknown, p: unknown, a: boolean, b: boolean, c: boolean) => void };
  };
  const props = new ocAny.GProp_GProps_1();
  ocAny.BRepGProp.VolumeProperties_1(shape, props, true, false, false);
  const vol = props.Mass();
  props.delete();
  return vol;
}

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

  it('outline pentagon PanelFeature evaluates to a 7-face prism (not a 6-face rect box)', () => {
    // RED before wiring: evaluatePanel ignores feature.outline → buildPanelBox
    // falls into the rect branch → 6 faces. GREEN after forwarding outline.
    const PENTAGON = [
      { x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 },
      { x: 300, y: 600 }, { x: 0, y: 600 },
    ];
    const f = mkPanel({
      length: { kind: 'literal', value: 600 },
      width: { kind: 'literal', value: 600 },
      thickness: { kind: 'literal', value: 18 },
      outline: PENTAGON,
    });
    const r = evaluatePanel(occt, f, { parameters: {} });
    expect(r.skipped).toBeUndefined();
    // Pentagon prism = 5 side faces + top + bottom = 7 faces (rect box = 6)
    expect(countFaces(occt, r.shape)).toBe(7);
    // Volume = pentagon area (315 000 mm²) × thickness (18) = 5 670 000 mm³
    const vol = solidVolume(occt, r.shape);
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeCloseTo(5_670_000, -3);
  });
});
