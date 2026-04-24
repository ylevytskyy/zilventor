import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { makeBox, disposeShape, type OcctShape } from '../../../occt/SolidOps';
import { tessellate } from '../../../occt/Tessellator';
import {
  namedFace,
  attachName,
  type NamedShape
} from '../../../occt/FaceNaming';
import { executeShellFeature } from '../ShellFeature';
import { ok, type ShellFeature } from '@zilventor/shared';

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

describe('executeShellFeature (integration)', () => {
  it('shells a box with the top face removed and names the new internal faces', () => {
    const box = makeBox(oc, 20, 20, 20);
    const named = nameBoxFaces(oc, box, 'E1');
    const feature: ShellFeature = {
      kind: 'shell',
      id: 'SH1',
      facesToRemove: [namedFace('E1', 'top')],
      // Negative thickness = hollow inward, standard "cup" pattern.
      thickness: { kind: 'literal', value: -1 }
    };
    const r = executeShellFeature(oc, named, feature, (p) =>
      p.kind === 'literal' ? ok(p.value) : ok(1)
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Original cube: 6 faces. Shelled cube with top removed and 1 mm wall:
      // 5 outer faces (bottom + 4 sides) stay, 5 inner faces appear, 1 top-rim
      // strip appears — exact count varies with OCCT but must exceed 6.
      expect(r.value.faceNames.length).toBeGreaterThan(6);
      const hasShell = r.value.faceNames.some((f) => f.name.role === 'shell');
      expect(hasShell).toBe(true);
      disposeShape(r.value.shape);
    }
    disposeShape(box);
  });

  it('produces a cavity — tessellated tri count grows after shelling a box', () => {
    const makeBoxTris = (): number => {
      const box = makeBox(oc, 20, 20, 20);
      const mesh = tessellate(oc, box, { linearDeflection: 0.1 });
      const tris = mesh.indices.length / 3;
      disposeShape(box);
      return tris;
    };
    const makeShelledTris = (): number => {
      const box = makeBox(oc, 20, 20, 20);
      const named = nameBoxFaces(oc, box, 'E1');
      const feature: ShellFeature = {
        kind: 'shell',
        id: 'SH1',
        facesToRemove: [namedFace('E1', 'top')],
        thickness: { kind: 'literal', value: -1 }
      };
      const r = executeShellFeature(oc, named, feature, (p) =>
        p.kind === 'literal' ? ok(p.value) : ok(1)
      );
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('shell failed');
      const mesh = tessellate(oc, r.value.shape, { linearDeflection: 0.1 });
      const tris = mesh.indices.length / 3;
      disposeShape(r.value.shape);
      disposeShape(box);
      return tris;
    };

    const plain = makeBoxTris();
    const shelled = makeShelledTris();
    // Shelled solid has at least the original outer faces plus inner ones;
    // tri count must be strictly greater.
    expect(shelled).toBeGreaterThan(plain);
  });
});
