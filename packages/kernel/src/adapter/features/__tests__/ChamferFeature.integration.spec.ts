import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { makeBox, disposeShape, type OcctShape } from '../../../occt/SolidOps';
import { tessellate } from '../../../occt/Tessellator';
import {
  namedFace,
  attachName,
  type NamedShape
} from '../../../occt/FaceNaming';
import { executeChamferFeature } from '../ChamferFeature';
import {
  canonicalEdgeName,
  ok,
  type ChamferFeature
} from '@zilventor/shared';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

function nameBoxFaces(
  oc: OcctInstance,
  box: OcctShape,
  featureId: string
): NamedShape {
  const named: NamedShape = { shape: box, faceNames: [] };
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    box.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    map as never
  );
  const faces: unknown[] = [];
  const n = (map as { Extent: () => number }).Extent();
  for (let i = 1; i <= n; i++) {
    const raw = (map as { FindKey: (i: number) => unknown }).FindKey(i);
    faces.push((oc.TopoDS as { Face_1: (s: unknown) => unknown }).Face_1(raw as never));
  }
  map.delete();

  const withCentroids = faces.map((f) => {
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.SurfaceProperties_1(
      f as never,
      props,
      false as never,
      false as never
    );
    const c = props.CentreOfMass();
    const coord: [number, number, number] = [c.X(), c.Y(), c.Z()];
    c.delete();
    props.delete();
    return { face: f, c: coord };
  });

  withCentroids.sort((a, b) => a.c[2] - b.c[2]);
  const bottom = withCentroids[0]!;
  const top = withCentroids[withCentroids.length - 1]!;
  const sides = withCentroids.slice(1, withCentroids.length - 1);
  attachName(named, bottom.face, namedFace(featureId, 'bottom'));
  attachName(named, top.face, namedFace(featureId, 'top'));
  const cx = (top.c[0] + bottom.c[0]) / 2;
  const cy = (top.c[1] + bottom.c[1]) / 2;
  sides.sort(
    (a, b) =>
      Math.atan2(a.c[1] - cy, a.c[0] - cx) - Math.atan2(b.c[1] - cy, b.c[0] - cx)
  );
  sides.forEach((s, i) =>
    attachName(named, s.face, namedFace(featureId, 'side', i))
  );
  return named;
}

describe('executeChamferFeature (integration)', () => {
  it('chamfers one top edge by name and names the new bevel face', () => {
    const box = makeBox(oc, 10, 10, 10);
    const named = nameBoxFaces(oc, box, 'E1');
    const feature: ChamferFeature = {
      kind: 'chamfer',
      id: 'C1',
      edges: [
        {
          edgeId: canonicalEdgeName(
            namedFace('E1', 'top'),
            namedFace('E1', 'side', 0)
          ),
          selectionMode: 'edge',
          distance: { kind: 'literal', value: 2 }
        }
      ]
    };
    const r = executeChamferFeature(oc, named, feature, (p) =>
      p.kind === 'literal' ? ok(p.value) : ok(2)
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.faceNames.length).toBeGreaterThan(0);
      const hasBlend = r.value.faceNames.some((f) => f.name.role === 'blend');
      expect(hasBlend).toBe(true);
      disposeShape(r.value.shape);
    }
    disposeShape(box);
  });

  it('produces geometry whose vertex positions vary with chamfer distance', () => {
    const mkPosHash = (distance: number): string => {
      const box = makeBox(oc, 10, 10, 10);
      const named = nameBoxFaces(oc, box, 'E1');
      const feature: ChamferFeature = {
        kind: 'chamfer',
        id: 'C1',
        edges: [
          {
            edgeId: canonicalEdgeName(
              namedFace('E1', 'top'),
              namedFace('E1', 'side', 0)
            ),
            selectionMode: 'edge',
            distance: { kind: 'literal', value: distance }
          }
        ]
      };
      const r = executeChamferFeature(oc, named, feature, (p) =>
        p.kind === 'literal' ? ok(p.value) : ok(1)
      );
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('chamfer failed');
      const mesh = tessellate(oc, r.value.shape, { linearDeflection: 0.1 });
      let h = 2166136261;
      for (let i = 0; i < mesh.positions.length; i++) {
        h = Math.imul(h ^ Math.round(mesh.positions[i]! * 1000), 16777619);
      }
      disposeShape(r.value.shape);
      disposeShape(box);
      return (h >>> 0).toString(16);
    };

    const a = mkPosHash(0.5);
    const b = mkPosHash(3);
    expect(a).not.toBe(b);
  });
});
