import { describe, it, expect } from 'vitest';
import type {
  Feature, HoleFeature, HoleTermination,
  ParamOrLiteral, FaceName, EdgeName,
} from '../types';

describe('HoleFeature', () => {
  const faceA: FaceName = { featureId: 'E1', role: 'top' };
  const edge: EdgeName = {
    faceA, faceB: { featureId: 'E1', role: 'side', instance: 0 }
  };
  const lit5: ParamOrLiteral = { kind: 'literal', value: 5 };

  it('accepts fromSketch + simple + throughAll', () => {
    const f: HoleFeature = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: lit5 },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const u: Feature = f;
    expect(u.kind).toBe('hole');
  });

  it('accepts linear + counterbore + distance', () => {
    const f: HoleFeature = {
      id: 'H2', kind: 'hole',
      placement: {
        kind: 'linear', faceName: faceA,
        refEdge1: edge, offset1: lit5,
        refEdge2: edge, offset2: lit5,
      },
      profile: {
        kind: 'counterbore', diameter: lit5,
        cboreDiameter: lit5, cboreDepth: lit5,
      },
      termination: { kind: 'distance', depth: lit5 },
      flipAxis: true,
    };
    expect(f.placement.kind).toBe('linear');
  });

  it('accepts concentric + countersink + toFace', () => {
    const f: HoleFeature = {
      id: 'H3', kind: 'hole',
      placement: { kind: 'concentric', faceName: faceA, circularEdgeName: edge },
      profile: {
        kind: 'countersink', diameter: lit5,
        cskDiameter: lit5, cskAngle: { kind: 'literal', value: 82 },
      },
      termination: { kind: 'toFace', targetFaceName: faceA },
      flipAxis: false,
    };
    expect(f.termination.kind).toBe('toFace');
  });

  it('accepts toNext termination', () => {
    const t: HoleTermination = { kind: 'toNext' };
    expect(t.kind).toBe('toNext');
  });
});
