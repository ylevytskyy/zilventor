import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, disposeShape } from '../SolidOps';
import {
  namedFace,
  attachName,
  canonicalEdgeName,
  type NamedShape,
} from '../FaceNaming';
import {
  resolveWorkPlaneRef,
  resolveWorkAxisRef,
  resolveWorkPointRef,
  evaluateWorkAxis,
  evaluateWorkPlane,
  evaluateWorkPoint,
} from '../WorkFeatureOps';
import type { FaceName, WorkFeatureValue } from '@zilventor/shared';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

/**
 * Integration coverage for plan T14: OCCT-bound work-feature resolvers
 * and evaluator modes. Each test builds a real solid via SolidOps and
 * exercises the corresponding OCCT extraction.
 */

function buildNamedBox(width: number, height: number, depth: number): {
  nm: NamedShape;
  faces: unknown[];
  faceNames: FaceName[];
  cleanup: () => void;
} {
  // makeBox returns an OcctShape (already a TopoDS_Solid wrapper). We name
  // the 6 faces in enumeration order with role 'F0'..'F5' so tests can
  // reference them by name.
  const box = makeBox(oc, width, height, depth);
  const explorer = new oc.TopExp_Explorer_2(
    box.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  const faces: unknown[] = [];
  while (explorer.More()) {
    faces.push(explorer.Current());
    explorer.Next();
  }
  explorer.delete();
  const nm: NamedShape = { shape: box, faceNames: [] };
  const names: FaceName[] = [];
  faces.forEach((f, i) => {
    const name = namedFace('B1', `F${i}`);
    attachName(nm, f, name);
    names.push(name);
  });
  return {
    nm,
    faces,
    faceNames: names,
    cleanup: () => {
      disposeShape(box);
      for (const f of faces) (f as { delete?: () => void }).delete?.();
    },
  };
}

describe('T14a — face plane resolver', () => {
  it('resolveWorkPlaneRef({ source: "face" }) returns the face plane', () => {
    const { nm, faceNames, cleanup } = buildNamedBox(10, 10, 10);
    let firstResult: { ok: boolean } | null = null;
    let anyOk = false;
    for (const name of faceNames) {
      const r = resolveWorkPlaneRef({ source: 'face', face: name }, oc, nm, new Map());
      if (firstResult === null) firstResult = r;
      if (r.ok) {
        anyOk = true;
        // Normal magnitude is 1 (unit vector).
        const n = r.value.normal;
        const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        expect(len).toBeCloseTo(1, 5);
        // Origin lies on the box bounds [0..10] in each axis.
        expect(r.value.origin.x).toBeGreaterThanOrEqual(-0.001);
        expect(r.value.origin.x).toBeLessThanOrEqual(10.001);
      }
    }
    expect(anyOk).toBe(true);
    cleanup();
  });

  it('resolveWorkPlaneRef({ source: "face" }) returns featureNotFound for an unknown face', () => {
    const { nm, cleanup } = buildNamedBox(10, 10, 10);
    const r = resolveWorkPlaneRef(
      { source: 'face', face: namedFace('NoSuch', 'role') },
      oc,
      nm,
      new Map(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('featureNotFound');
    cleanup();
  });
});

function buildNamedCylinder(radius: number, height: number): {
  nm: NamedShape;
  cylinderFace: FaceName;
  faces: unknown[];
  cleanup: () => void;
} {
  // Build a cylinder via BRepPrimAPI_MakeCylinder_2 (radius, height) at the
  // default frame (axis = +Z, origin at world origin).
  // Build a cylinder via BRepPrimAPI_MakeCylinder_3(Ax2, R, H) at the
  // default frame (Ax2 origin = (0,0,0), axis = +Z).
  const occBuild = oc as unknown as {
    gp_Pnt_3: new (x: number, y: number, z: number) => unknown;
    gp_Dir_4: new (x: number, y: number, z: number) => unknown;
    gp_Ax2_3: new (origin: unknown, dir: unknown) => unknown;
    BRepPrimAPI_MakeCylinder_3: new (frame: unknown, r: number, h: number) => { Shape: () => unknown };
  };
  const cylOrigin = new occBuild.gp_Pnt_3(0, 0, 0);
  const cylDir = new occBuild.gp_Dir_4(0, 0, 1);
  const cylFrame = new occBuild.gp_Ax2_3(cylOrigin, cylDir);
  const cyl = new occBuild.BRepPrimAPI_MakeCylinder_3(cylFrame, radius, height);
  const shape = cyl.Shape() as unknown as { handle: unknown };
  // Cylinder has 3 faces: side (cylindrical), top, bottom. Enumerate and
  // pick the cylindrical one by surface type.
  const explorer = new oc.TopExp_Explorer_2(
    shape as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  const faces: unknown[] = [];
  while (explorer.More()) {
    faces.push(explorer.Current());
    explorer.Next();
  }
  explorer.delete();
  const occAny = oc as unknown as {
    TopoDS: { Face_1: (s: unknown) => unknown };
    BRepAdaptor_Surface_2: new (face: unknown, restriction: boolean) => {
      GetType: () => unknown;
      delete?: () => void;
    };
    GeomAbs_SurfaceType: { GeomAbs_Cylinder: unknown };
  };
  let cylindricalIdx = -1;
  for (let i = 0; i < faces.length; i++) {
    const adaptor = new occAny.BRepAdaptor_Surface_2(occAny.TopoDS.Face_1(faces[i]!), true);
    const t = adaptor.GetType();
    adaptor.delete?.();
    if (t === occAny.GeomAbs_SurfaceType.GeomAbs_Cylinder) { cylindricalIdx = i; break; }
  }
  if (cylindricalIdx < 0) throw new Error('cylinder build produced no cylindrical face');
  // Use the SolidOps OcctShape wrapper shape so disposeShape works the same.
  const nm: NamedShape = { shape: { handle: shape } as never, faceNames: [] };
  const cylinderFace: FaceName = namedFace('C1', 'side');
  attachName(nm, faces[cylindricalIdx], cylinderFace);
  // Also tag the caps so downstream extractions don't choke on missing names.
  faces.forEach((f, i) => {
    if (i === cylindricalIdx) return;
    attachName(nm, f, namedFace('C1', `cap${i}`));
  });
  return {
    nm,
    cylinderFace,
    faces,
    cleanup: () => {
      // shape lives inside cyl; let GC handle. Faces explicitly cleaned.
      for (const f of faces) (f as { delete?: () => void }).delete?.();
    },
  };
}

describe('T14b — cylindricalFace axis resolver', () => {
  it('resolveWorkAxisRef({ source: "cylindricalFace" }) returns origin + +Z direction for a default cylinder', () => {
    const { nm, cylinderFace, cleanup } = buildNamedCylinder(5, 10);
    const r = resolveWorkAxisRef({ source: 'cylindricalFace', face: cylinderFace }, oc, nm, new Map());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.abs(r.value.direction.z)).toBeCloseTo(1, 5);
      expect(r.value.direction.x).toBeCloseTo(0, 5);
      expect(r.value.direction.y).toBeCloseTo(0, 5);
    }
    cleanup();
  });

  it('evaluateWorkAxis({ mode: "cylindricalFace" }) mirrors resolver', () => {
    const { nm, cylinderFace, cleanup } = buildNamedCylinder(3, 7);
    const r = evaluateWorkAxis(oc, nm, { mode: 'cylindricalFace', face: cylinderFace }, new Map());
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.value.direction.z)).toBeCloseTo(1, 5);
    cleanup();
  });

describe('T14c — edge axis resolver', () => {
  it('resolveWorkAxisRef({ source: "edge" }) returns origin + unit direction for a box edge', () => {
    const { nm, faceNames, cleanup } = buildNamedBox(10, 10, 10);
    // Try every pair of distinct faces — at least one pair shares an edge.
    let foundEdge = false;
    outer: for (let i = 0; i < faceNames.length; i++) {
      for (let j = i + 1; j < faceNames.length; j++) {
        const edgeName = canonicalEdgeName(faceNames[i]!, faceNames[j]!);
        const r = resolveWorkAxisRef({ source: 'edge', edge: edgeName }, oc, nm, new Map());
        if (r.ok) {
          const d = r.value.direction;
          const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
          expect(len).toBeCloseTo(1, 5);
          foundEdge = true;
          break outer;
        }
      }
    }
    expect(foundEdge).toBe(true);
    cleanup();
  });

  it('evaluateWorkAxis({ mode: "edge" }) mirrors resolver', () => {
    const { nm, faceNames, cleanup } = buildNamedBox(10, 10, 10);
    let foundEdge = false;
    outer: for (let i = 0; i < faceNames.length; i++) {
      for (let j = i + 1; j < faceNames.length; j++) {
        const edgeName = canonicalEdgeName(faceNames[i]!, faceNames[j]!);
        const r = evaluateWorkAxis(oc, nm, { mode: 'edge', edge: edgeName }, new Map());
        if (r.ok) {
          foundEdge = true;
          break outer;
        }
      }
    }
    expect(foundEdge).toBe(true);
    cleanup();
  });

  it('returns featureNotFound when edge faces are missing', () => {
    const { nm, cleanup } = buildNamedBox(10, 10, 10);
    const r = resolveWorkAxisRef(
      {
        source: 'edge',
        edge: canonicalEdgeName(namedFace('NoSuch', 'a'), namedFace('NoSuch', 'b')),
      },
      oc, nm, new Map(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('featureNotFound');
    cleanup();
  });
});

describe('T14d — vertex point resolver', () => {
  it('resolveWorkPointRef({ source: "vertex", end: "start" }) returns a point on a box edge', () => {
    const { nm, faceNames, cleanup } = buildNamedBox(10, 10, 10);
    let foundEdge = false;
    outer: for (let i = 0; i < faceNames.length; i++) {
      for (let j = i + 1; j < faceNames.length; j++) {
        const edgeName = canonicalEdgeName(faceNames[i]!, faceNames[j]!);
        const r = resolveWorkPointRef({ source: 'vertex', edge: edgeName, end: 'start' }, oc, nm, new Map());
        if (r.ok) {
          // Box vertices live on the [0..10] cube; coordinates are in {0, 10}.
          for (const c of [r.value.position.x, r.value.position.y, r.value.position.z]) {
            const onBound = Math.abs(c) < 0.001 || Math.abs(c - 10) < 0.001;
            expect(onBound).toBe(true);
          }
          foundEdge = true;
          break outer;
        }
      }
    }
    expect(foundEdge).toBe(true);
    cleanup();
  });

  it('start and end of the same edge differ', () => {
    const { nm, faceNames, cleanup } = buildNamedBox(10, 10, 10);
    let proven = false;
    outer: for (let i = 0; i < faceNames.length; i++) {
      for (let j = i + 1; j < faceNames.length; j++) {
        const edgeName = canonicalEdgeName(faceNames[i]!, faceNames[j]!);
        const a = resolveWorkPointRef({ source: 'vertex', edge: edgeName, end: 'start' }, oc, nm, new Map());
        const b = resolveWorkPointRef({ source: 'vertex', edge: edgeName, end: 'end' }, oc, nm, new Map());
        if (a.ok && b.ok) {
          const dx = a.value.position.x - b.value.position.x;
          const dy = a.value.position.y - b.value.position.y;
          const dz = a.value.position.z - b.value.position.z;
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 0.5) { proven = true; break outer; }
        }
      }
    }
    expect(proven).toBe(true);
    cleanup();
  });

  it('evaluateWorkPoint({ mode: "vertex" }) mirrors resolver', () => {
    const { nm, faceNames, cleanup } = buildNamedBox(10, 10, 10);
    let proven = false;
    outer: for (let i = 0; i < faceNames.length; i++) {
      for (let j = i + 1; j < faceNames.length; j++) {
        const edgeName = canonicalEdgeName(faceNames[i]!, faceNames[j]!);
        const r = evaluateWorkPoint(oc, nm, { mode: 'vertex', edge: edgeName, end: 'end' }, new Map());
        if (r.ok) { proven = true; break outer; }
      }
    }
    expect(proven).toBe(true);
    cleanup();
  });
});

describe('T14e — midpointOfEdge point evaluator', () => {
  it('evaluateWorkPoint({ mode: "midpointOfEdge" }) returns a point between the edge endpoints', () => {
    const { nm, faceNames, cleanup } = buildNamedBox(10, 10, 10);
    let proven = false;
    outer: for (let i = 0; i < faceNames.length; i++) {
      for (let j = i + 1; j < faceNames.length; j++) {
        const edgeName = canonicalEdgeName(faceNames[i]!, faceNames[j]!);
        const a = evaluateWorkPoint(oc, nm, { mode: 'vertex', edge: edgeName, end: 'start' }, new Map());
        const b = evaluateWorkPoint(oc, nm, { mode: 'vertex', edge: edgeName, end: 'end' }, new Map());
        const m = evaluateWorkPoint(oc, nm, { mode: 'midpointOfEdge', edge: edgeName }, new Map());
        if (a.ok && b.ok && m.ok) {
          const expected = {
            x: (a.value.position.x + b.value.position.x) / 2,
            y: (a.value.position.y + b.value.position.y) / 2,
            z: (a.value.position.z + b.value.position.z) / 2,
          };
          expect(m.value.position.x).toBeCloseTo(expected.x, 5);
          expect(m.value.position.y).toBeCloseTo(expected.y, 5);
          expect(m.value.position.z).toBeCloseTo(expected.z, 5);
          proven = true;
          break outer;
        }
      }
    }
    expect(proven).toBe(true);
    cleanup();
  });
});

describe('T14f — centerOfArc point evaluator', () => {
  it('evaluateWorkPoint({ mode: "centerOfArc" }) returns the cylinder axis basepoint', () => {
    const { nm, cylinderFace, cleanup } = buildNamedCylinder(5, 10);
    const r = evaluateWorkPoint(oc, nm, { mode: 'centerOfArc', face: cylinderFace }, new Map());
    expect(r.ok).toBe(true);
    if (r.ok) {
      // BRepPrimAPI_MakeCylinder_3 frame at origin, axis +Z → location (0,0,0).
      expect(r.value.position.x).toBeCloseTo(0, 5);
      expect(r.value.position.y).toBeCloseTo(0, 5);
      expect(r.value.position.z).toBeCloseTo(0, 5);
    }
    cleanup();
  });

  it('returns featureNotFound when face is non-circular (planar box face)', () => {
    const { nm, cleanup } = buildNamedBox(10, 10, 10);
    const r = evaluateWorkPoint(oc, nm, { mode: 'centerOfArc', face: namedFace('B1', 'F0') }, new Map());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('featureNotFound');
    cleanup();
  });
});

describe('T14g — tangentToSurfaceParallelToPlane evaluator', () => {
  it('cylinder R=5 along Z + parallel to YZ plane (normal +X) → tangent at x=±5', () => {
    const { nm, cylinderFace, cleanup } = buildNamedCylinder(5, 10);
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.YZ', { featureId: 'origin.YZ', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } }],
    ]);
    const r = evaluateWorkPlane(
      oc, nm,
      {
        mode: 'tangentToSurfaceParallelToPlane',
        face: cylinderFace,
        plane: { source: 'workPlane', featureId: 'origin.YZ' },
      },
      wfs,
      {},
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Origin sits on the cylinder surface where the surface normal is
      // parallel to ±X.
      expect(Math.abs(r.value.origin.x)).toBeCloseTo(5, 5);
      expect(r.value.origin.y).toBeCloseTo(0, 5);
      // Plane normal matches the reference plane normal (+X).
      expect(Math.abs(r.value.normal.x)).toBeCloseTo(1, 5);
    }
    cleanup();
  });

  it('returns invalidGeometry when reference plane normal is parallel to cylinder axis', () => {
    const { nm, cylinderFace, cleanup } = buildNamedCylinder(5, 10);
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.XY', { featureId: 'origin.XY', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = evaluateWorkPlane(
      oc, nm,
      {
        mode: 'tangentToSurfaceParallelToPlane',
        face: cylinderFace,
        plane: { source: 'workPlane', featureId: 'origin.XY' },
      },
      wfs,
      {},
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalidGeometry');
    cleanup();
  });
});






  it('resolveWorkAxisRef returns featureNotFound when face is non-cylindrical', () => {
    const { nm, cleanup } = buildNamedBox(10, 10, 10);
    const r = resolveWorkAxisRef(
      { source: 'cylindricalFace', face: namedFace('B1', 'F0') },
      oc, nm, new Map(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('featureNotFound');
    cleanup();
  });
});

