import { describe, it, expect } from 'vitest';
import { projectToSketch, type SketchFrame } from '../../geometry/projectToSketch';
import type { TessellatedEdge } from '@zilventor/shared';
import { ProjectGeometryTool } from '../ProjectGeometryTool';

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

// XY-plane frame (origin.XY): origin=(0,0,0), normal=(0,0,1), xDir=(1,0,0).
// yDir = cross(normal, xDir) = (0,0,1)×(1,0,0) = (0,1,0).
// Hand-derivation: cross((0,0,1),(1,0,0)) = (0*0-1*0, 1*1-0*0, 0*0-0*1) = (0,1,0). ✓
const XY_FRAME: SketchFrame = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  xDir:   { x: 1, y: 0, z: 0 },
};

describe('projectToSketch — XY plane', () => {
  it('a point on the XY plane projects to itself (z ignored)', () => {
    // p=(3,4,0), origin=(0,0,0), rel=(3,4,0)
    // u = dot((3,4,0),(1,0,0)) = 3
    // v = dot((3,4,0),(0,1,0)) = 4
    const uv = projectToSketch({ x: 3, y: 4, z: 0 }, XY_FRAME);
    near(uv.u, 3); near(uv.v, 4);
  });

  it('a point above the plane projects to its xy footprint', () => {
    // p=(2,5,10), origin=(0,0,0), rel=(2,5,10)
    // u = dot((2,5,10),(1,0,0)) = 2
    // v = dot((2,5,10),(0,1,0)) = 5
    const uv = projectToSketch({ x: 2, y: 5, z: 10 }, XY_FRAME);
    near(uv.u, 2); near(uv.v, 5);
  });

  it('a negative-z point projects the same as zero-z', () => {
    // p=(1,-2,-3), origin=(0,0,0), rel=(1,-2,-3)
    // u = dot((1,-2,-3),(1,0,0)) = 1
    // v = dot((1,-2,-3),(0,1,0)) = -2
    const uv = projectToSketch({ x: 1, y: -2, z: -3 }, XY_FRAME);
    near(uv.u, 1); near(uv.v, -2);
  });
});

describe('projectToSketch — translated + rotated frame', () => {
  // Frame: origin=(5,0,0), normal=(0,0,1), xDir=(0,1,0).
  // yDir = cross(normal, xDir) = cross((0,0,1),(0,1,0))
  //      = (0*0-1*1, 1*0-0*0, 0*1-0*0) = (-1, 0, 0).
  // Hand-derivation verified above.
  const rotFrame: SketchFrame = {
    origin: { x: 5, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    xDir:   { x: 0, y: 1, z: 0 },
  };

  it('point (5,3,0) in rotated frame → u=3, v=0', () => {
    // rel = (5-5, 3-0, 0-0) = (0,3,0)
    // u = dot((0,3,0),(0,1,0)) = 3
    // v = dot((0,3,0),(-1,0,0)) = 0
    const uv = projectToSketch({ x: 5, y: 3, z: 0 }, rotFrame);
    near(uv.u, 3); near(uv.v, 0);
  });

  it('point (2,0,0) in rotated frame → u=0, v=3 (origin offset subtracted)', () => {
    // rel = (2-5, 0-0, 0-0) = (-3,0,0)
    // u = dot((-3,0,0),(0,1,0)) = 0
    // v = dot((-3,0,0),(-1,0,0)) = 3
    const uv = projectToSketch({ x: 2, y: 0, z: 0 }, rotFrame);
    near(uv.u, 0); near(uv.v, 3);
  });
});

// ---- ProjectGeometryTool unit tests ----

function makePGTool(frame: SketchFrame) {
  const emitted: { id: string; kind: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  const toasts: string[] = [];
  const tool = new ProjectGeometryTool({
    frame,
    emitPrimitive: (p) => emitted.push(p as typeof emitted[0]),
    showToast: (msg) => toasts.push(msg),
  });
  return { tool, emitted, toasts };
}

function makeEdge(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): TessellatedEdge {
  return {
    edgeName: { faceA: { featureId: 'f1', role: 'side', instance: 0 }, faceB: { featureId: 'f2', role: 'side', instance: 0 } },
    segments: [[{ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }]],
    faceNames: [
      { featureId: 'f1', role: 'side', instance: 0 },
      { featureId: 'f2', role: 'side', instance: 0 },
    ],
  };
}

describe('ProjectGeometryTool — emit ordinary line', () => {
  it('single-segment edge on XY plane projects to a sketch line with correct coords', () => {
    // Edge from (0,0,0) to (10,0,0) in XY frame.
    // uvA: u=dot((0,0,0),(1,0,0))=0, v=dot((0,0,0),(0,1,0))=0
    // uvB: u=dot((10,0,0),(1,0,0))=10, v=dot((10,0,0),(0,1,0))=0
    const { tool, emitted } = makePGTool(XY_FRAME);
    const edge = makeEdge(0, 0, 0, 10, 0, 0);
    tool.projectEdge(edge);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.kind).toBe('line');
    near(emitted[0]!.x1, 0); near(emitted[0]!.y1, 0);
    near(emitted[0]!.x2, 10); near(emitted[0]!.y2, 0);
  });

  it('edge on XY plane with offset projects correctly', () => {
    // Edge from (3,4,0) to (7,2,0) in XY frame.
    // uvA: u=3, v=4. uvB: u=7, v=2. (z ignored because frame is XY)
    const { tool, emitted } = makePGTool(XY_FRAME);
    const edge = makeEdge(3, 4, 0, 7, 2, 0);
    tool.projectEdge(edge);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.kind).toBe('line');
    near(emitted[0]!.x1, 3); near(emitted[0]!.y1, 4);
    near(emitted[0]!.x2, 7); near(emitted[0]!.y2, 2);
  });

  it('edge with z-offset projects to correct UV (z dropped)', () => {
    // Edge from (1,2,5) to (4,6,5) in XY frame.
    // uvA: u=1, v=2. uvB: u=4, v=6.
    const { tool, emitted } = makePGTool(XY_FRAME);
    const edge = makeEdge(1, 2, 5, 4, 6, 5);
    tool.projectEdge(edge);
    expect(emitted).toHaveLength(1);
    near(emitted[0]!.x1, 1); near(emitted[0]!.y1, 2);
    near(emitted[0]!.x2, 4); near(emitted[0]!.y2, 6);
  });
});

describe('ProjectGeometryTool — curved edge toast', () => {
  it('multi-segment edge triggers "Curved-edge projection" toast and emits nothing', () => {
    const { tool, emitted, toasts } = makePGTool(XY_FRAME);
    const curvedEdge: TessellatedEdge = {
      edgeName: { faceA: { featureId: 'f1', role: 'side', instance: 0 }, faceB: { featureId: 'f2', role: 'side', instance: 0 } },
      segments: [
        [{ x: 0, y: 0, z: 0 }, { x: 5, y: 1, z: 0 }],
        [{ x: 5, y: 1, z: 0 }, { x: 10, y: 0, z: 0 }],
      ],
      faceNames: [
        { featureId: 'f1', role: 'side', instance: 0 },
        { featureId: 'f2', role: 'side', instance: 0 },
      ],
    };
    tool.projectEdge(curvedEdge);
    expect(emitted).toHaveLength(0);
    expect(toasts[0]).toMatch(/Curved-edge/);
  });
});

describe('ProjectGeometryTool — face-sourced frame guard', () => {
  it('null frame (face-sourced sketch) triggers toast and emits nothing', () => {
    const emitted: unknown[] = [];
    const toasts: string[] = [];
    const tool = new ProjectGeometryTool({
      frame: null,
      emitPrimitive: (p) => emitted.push(p),
      showToast: (msg) => toasts.push(msg),
    });
    const edge = makeEdge(0, 0, 0, 10, 0, 0);
    tool.projectEdge(edge);
    expect(emitted).toHaveLength(0);
    expect(toasts[0]).toMatch(/workplane/);
  });
});
