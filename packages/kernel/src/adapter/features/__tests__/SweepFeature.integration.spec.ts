import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { tessellate } from '../../../occt/Tessellator';
import { executeSweepFeature } from '../SweepFeature';

describe('executeSweepFeature — integration', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  it('Path orientation + new operation produces a cylinder solid', () => {
    const profile: any = {
      id: 'PROF', kind: 'sketch', plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    };
    const path: any = {
      id: 'PATH', kind: 'sketch', plane: { source: 'workPlane', featureId: 'origin.XZ' },
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    };
    const feature: any = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'PROF', pathSketchId: 'PATH',
      orientation: { kind: 'path' },
      operation: 'new',
    };
    const sketchById = new Map<string, any>([['PROF', profile], ['PATH', path]]);

    const result = executeSweepFeature(oc, null, feature, sketchById);
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    expect(props.Mass()).toBeCloseTo(Math.PI * 10, 0);
  });

  it('operation join fuses swept solid into running body', () => {
    // Cube 10×10×10 at origin.
    const cube = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const running: any = { shape: cube, faceNames: [] };

    // Profile: unit circle at (5,5) on XY → world (5,5,0), normal +Z.
    const profile: any = {
      id: 'PROF', kind: 'sketch', plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'C1', kind: 'circle', cx: 5, cy: 5, r: 1 }],
      constraints: [],
    };
    // Path on XZ: sketch (5,10)→(5,20) → world (5,0,10)→(5,0,20).
    // The pipe shell places the profile at the path start (5,0,10) — the
    // cube's top face — and sweeps 10 units above it.
    // Swept cylinder r=1 length=10 sits entirely above the cube.
    // Fuse volume = cube + cylinder = 1000 + π·1²·10.
    const path: any = {
      id: 'PATH', kind: 'sketch', plane: { source: 'workPlane', featureId: 'origin.XZ' },
      primitives: [{ id: 'L1', kind: 'line', x1: 5, y1: 10, x2: 5, y2: 20 }],
      constraints: [],
    };
    const feature: any = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'PROF', pathSketchId: 'PATH',
      orientation: { kind: 'path' },
      operation: 'join',
    };
    const sketchById = new Map<string, any>([['PROF', profile], ['PATH', path]]);

    const wrap = (h: any) => ({ __brand: 'OcctShape' as const, handle: h });

    // Baseline: triangle count of the cube alone.
    const cubeMesh = tessellate(oc, wrap(running.shape), { linearDeflection: 0.1 });
    const cubeTris = cubeMesh.indices.length / 3;

    const result = executeSweepFeature(oc, running, feature, sketchById);
    // Fuse adds the swept cylinder above the cube — triangle count must grow.
    const fusedMesh = tessellate(oc, wrap(result.shape), { linearDeflection: 0.1 });
    const fusedTris = fusedMesh.indices.length / 3;
    expect(fusedTris).toBeGreaterThan(cubeTris);
  });

  it('operation cut subtracts swept solid from running body', () => {
    const cube = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const running: any = { shape: cube, faceNames: [] };

    const profile: any = {
      id: 'PROF', kind: 'sketch', plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'C1', kind: 'circle', cx: 5, cy: 5, r: 1 }],
      constraints: [],
    };
    const path: any = {
      id: 'PATH', kind: 'sketch', plane: { source: 'workPlane', featureId: 'origin.XZ' },
      primitives: [{ id: 'L1', kind: 'line', x1: 5, y1: -1, x2: 5, y2: 11 }],
      constraints: [],
    };
    const feature: any = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'PROF', pathSketchId: 'PATH',
      orientation: { kind: 'path' },
      operation: 'cut',
    };
    const sketchById = new Map<string, any>([['PROF', profile], ['PATH', path]]);

    const result = executeSweepFeature(oc, running, feature, sketchById);
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    // 1000 - π·1²·10
    expect(props.Mass()).toBeCloseTo(1000 - Math.PI * 10, 0);
  });

  it('face naming: cylindrical sweep tags lateral/0 + capStart + capEnd', () => {
    const profile: any = {
      id: 'PROF', kind: 'sketch', plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    };
    const path: any = {
      id: 'PATH', kind: 'sketch', plane: { source: 'workPlane', featureId: 'origin.XZ' },
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    };
    const feature: any = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'PROF', pathSketchId: 'PATH',
      orientation: { kind: 'path' },
      operation: 'new',
    };
    const sketchById = new Map<string, any>([['PROF', profile], ['PATH', path]]);
    const result = executeSweepFeature(oc, null, feature, sketchById);
    const roles = result.faceNames.map((f: any) => f.name.role);
    expect(roles).toContain('SW1/sweep/lateral/0');
    expect(roles).toContain('SW1/sweep/capStart');
    expect(roles).toContain('SW1/sweep/capEnd');
  });
});
