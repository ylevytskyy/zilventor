import { describe, it, expect } from 'vitest';
import type { RegionParent, DetailView, Vec2, ViewScale, DrawingView } from '../types';

describe('RegionParent shape', () => {
  it('has center (Vec2) and radiusMm (number)', () => {
    const rp: RegionParent = {
      center: { x: 10, y: 8 },
      radiusMm: 5,
    };
    expect(rp.center.x).toBe(10);
    expect(rp.center.y).toBe(8);
    expect(rp.radiusMm).toBe(5);
  });

  it('survives JSON round-trip without drift', () => {
    const rp: RegionParent = { center: { x: 25.5, y: 13.25 }, radiusMm: 7.5 };
    const parsed = JSON.parse(JSON.stringify(rp)) as RegionParent;
    expect(parsed.center.x).toBe(25.5);
    expect(parsed.radiusMm).toBe(7.5);
  });
});

describe('DetailView shape', () => {
  const scale: ViewScale = { numerator: 2, denominator: 1 };

  it('kind discriminator is "detail"', () => {
    const dv: DetailView = {
      id: 'dv1',
      kind: 'detail',
      parentViewId: 'v1',
      regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
      label: 'A',
      positionMm: { x: 50, y: 150 },
      scale,
      showHidden: false,
    };
    expect(dv.kind).toBe('detail');
  });

  it('survives JSON round-trip preserving all required fields', () => {
    const dv: DetailView = {
      id: 'dv2',
      kind: 'detail',
      parentViewId: 'pv1',
      regionParent: { center: { x: 0, y: 0 }, radiusMm: 12 },
      label: 'B',
      positionMm: { x: 100, y: 200 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: true,
    };
    const parsed = JSON.parse(JSON.stringify(dv)) as DetailView;
    expect(parsed.kind).toBe('detail');
    expect(parsed.parentViewId).toBe('pv1');
    expect(parsed.regionParent.radiusMm).toBe(12);
    expect(parsed.label).toBe('B');
    expect(parsed.scale.numerator).toBe(2);
    expect(parsed.showHidden).toBe(true);
  });

  it('optional fields (projection, inputFingerprint) are absent when not set', () => {
    const dv: DetailView = {
      id: 'dv3',
      kind: 'detail',
      parentViewId: 'pv1',
      regionParent: { center: { x: 5, y: 5 }, radiusMm: 3 },
      label: 'C',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };
    expect(dv.projection).toBeUndefined();
    expect(dv.inputFingerprint).toBeUndefined();
  });

  it('optional projection field carries visibleEdges, hiddenEdges, bbox', () => {
    const dv: DetailView = {
      id: 'dv4',
      kind: 'detail',
      parentViewId: 'pv2',
      regionParent: { center: { x: 0, y: 0 }, radiusMm: 10 },
      label: 'A',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
      projection: {
        visibleEdges: [],
        hiddenEdges: [],
        bbox: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      },
      inputFingerprint: 'abc123',
    };
    expect(dv.projection!.bbox.minX).toBe(-5);
    expect(dv.inputFingerprint).toBe('abc123');
  });
});

describe('DrawingView union exhaustiveness — detail variant', () => {
  it('detail kind is reachable in a switch over DrawingView', () => {
    function label(v: DrawingView): string {
      switch (v.kind) {
        case 'base':      return 'base';
        case 'projected': return 'projected';
        case 'iso':       return 'iso';
        case 'section':   return 'section';
        case 'detail':    return 'detail';
        default: {
          const _exhaustive: never = v;
          return _exhaustive;
        }
      }
    }

    const dv: DrawingView = {
      id: 'dv-union-test',
      kind: 'detail',
      parentViewId: 'pv1',
      regionParent: { center: { x: 0, y: 0 }, radiusMm: 5 },
      label: 'A',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };
    expect(label(dv)).toBe('detail');
  });
});
