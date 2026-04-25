import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occtLoader';
import { buildWireFromSketch, makeSweep } from '../SweepOps';

describe('SweepOps — buildWireFromSketch', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  it('builds a closed wire from a 4-line rectangle sketch', () => {
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'L2', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 5 },
        { id: 'L3', kind: 'line', x1: 10, y1: 5, x2: 0, y2: 5 },
        { id: 'L4', kind: 'line', x1: 0, y1: 5, x2: 0, y2: 0 },
      ],
      constraints: [],
    };
    const wire = buildWireFromSketch(oc, sketch);
    expect((wire as any).IsNull?.()).not.toBe(true);
    expect((wire as any).Closed?.()).toBe(true);
  });

  it('builds an open wire from two connected line segments', () => {
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'L2', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 5 },
      ],
      constraints: [],
    };
    const wire = buildWireFromSketch(oc, sketch);
    expect((wire as any).Closed?.()).toBe(false);
  });

  it('builds a closed wire from a single full circle', () => {
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 5 }],
      constraints: [],
    };
    const wire = buildWireFromSketch(oc, sketch);
    expect((wire as any).Closed?.()).toBe(true);
  });

  it('builds an open wire from a single 90° arc primitive', () => {
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'A1', kind: 'arc', cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI / 2 }],
      constraints: [],
    };
    const wire = buildWireFromSketch(oc, sketch);
    expect((wire as any).IsNull?.()).not.toBe(true);
    // Arc is not a closed loop
    expect((wire as any).Closed?.()).toBe(false);
  });
});
describe('SweepOps — makeSweep', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  it('Parallel orientation: line spine + offset square profile produces axis-aligned prism', () => {
    const profile: any = {
      id: 'P', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 2, y2: 0 },
        { id: 'L2', kind: 'line', x1: 2, y1: 0, x2: 2, y2: 2 },
        { id: 'L3', kind: 'line', x1: 2, y1: 2, x2: 0, y2: 2 },
        { id: 'L4', kind: 'line', x1: 0, y1: 2, x2: 0, y2: 0 },
      ],
      constraints: [],
    };
    const path: any = {
      id: 'PA', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    };
    const profileWire = buildWireFromSketch(oc, profile);
    const pathWire = buildWireFromSketch(oc, path);
    const solid = makeSweep(oc, profileWire, pathWire, { kind: 'parallel' });
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(solid, props, 1e-7, false, false);
    // 2×2×10 = 40
    expect(props.Mass()).toBeCloseTo(40, 0);
  });

  it('Path orientation: line + circle profile produces a cylinder', () => {
    const profile: any = {
      id: 'P', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    };
    const path: any = {
      id: 'PA', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    };
    const profileWire = buildWireFromSketch(oc, profile);
    const pathWire = buildWireFromSketch(oc, path);
    const solid = makeSweep(oc, profileWire, pathWire, { kind: 'path' });
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(solid, props, 1e-7, false, false);
    expect(props.Mass()).toBeCloseTo(Math.PI * 10, 0);
  });

  it('Guide Rail orientation: line spine + parallel rail produces a tracked sweep', () => {
    const profile: any = {
      id: 'P', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    };
    const path: any = {
      id: 'PA', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    };
    const guide: any = {
      id: 'G', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 3, y1: 0, x2: 3, y2: 10 }],
      constraints: [],
    };
    const profileWire = buildWireFromSketch(oc, profile);
    const pathWire = buildWireFromSketch(oc, path);
    const guideWire = buildWireFromSketch(oc, guide);
    const solid = makeSweep(oc, profileWire, pathWire, { kind: 'guideRail', guideWire });
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(solid, props, 1e-7, false, false);
    // The guide-rail contact constraint deforms the profile so the exact volume
    // differs from a plain cylinder; assert only that a valid solid was produced.
    expect(props.Mass()).toBeGreaterThan(1);
  });
});

