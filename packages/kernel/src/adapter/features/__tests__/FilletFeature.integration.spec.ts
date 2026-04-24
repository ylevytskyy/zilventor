import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { makeBox, disposeShape, type OcctShape } from '../../../occt/SolidOps';
import { tessellate } from '../../../occt/Tessellator';
import {
  namedFace,
  attachName,
  type NamedShape
} from '../../../occt/FaceNaming';
import { executeFilletFeature } from '../FilletFeature';
import {
  canonicalEdgeName,
  ok,
  type Result,
  type KernelError,
  type FilletFeature,
  type ParamOrLiteral
} from '@zilventor/shared';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

/**
 * Test-local helper: name a box's 6 faces using the same centroid-based
 * classification as ExtrudeFeature.ts (T7):
 *   - lowest Z centroid = 'bottom'
 *   - highest Z centroid = 'top'
 *   - remaining 4 faces = 'side' sorted by atan2 around the solid center
 *
 * We use TopExp.MapShapes_1 + TopTools_IndexedMapOfShape_1 for unique face
 * enumeration (avoids per-owner double-counts) and TopoDS.Face_1 to downcast
 * each unique shape to a TopoDS_Face handle. Labelled faces are OWNED by the
 * returned NamedShape and MUST NOT be disposed independently by the caller.
 */
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

describe('executeFilletFeature (integration)', () => {
  it('fillets one top edge by name', () => {
    const box = makeBox(oc, 10, 10, 10);
    const named = nameBoxFaces(oc, box, 'E1');
    const resolveParam = (p: ParamOrLiteral): Result<number, KernelError> =>
      p.kind === 'literal' ? ok(p.value) : ok(2);
    const feature: FilletFeature = {
      kind: 'fillet',
      id: 'F1',
      mode: 'constant',
      edges: [
        {
          edgeId: canonicalEdgeName(
            namedFace('E1', 'top'),
            namedFace('E1', 'side', 0)
          ),
          selectionMode: 'edge',
          radius: { kind: 'literal', value: 2 }
        }
      ],
      setbacks: []
    };
    const r = executeFilletFeature(oc, named, feature, resolveParam);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.faceNames.length).toBeGreaterThan(0);
      const hasBlend = r.value.faceNames.some((f) => f.name.role === 'blend');
      expect(hasBlend).toBe(true);
      disposeShape(r.value.shape);
    }
    disposeShape(box);
  });

  it('returns edgeNotFound when the edgeId maps to missing faces', () => {
    const box = makeBox(oc, 10, 10, 10);
    const named: NamedShape = { shape: box, faceNames: [] };
    const feature: FilletFeature = {
      kind: 'fillet',
      id: 'F1',
      mode: 'constant',
      edges: [
        {
          edgeId: canonicalEdgeName(namedFace('X', 'top'), namedFace('Y', 'side')),
          selectionMode: 'edge',
          radius: { kind: 'literal', value: 2 }
        }
      ],
      setbacks: []
    };
    const r = executeFilletFeature(oc, named, feature, (p) =>
      p.kind === 'literal' ? ok(p.value) : ok(0)
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('edgeNotFound');
    disposeShape(box);
  });

  it('produces geometry whose vertex positions vary with fillet radius', () => {
    // Regression guard for the fillet parametric cascade. The triangle count
    // alone is not a reliable signal that MakeFillet reacted to a radius
    // change — at linearDeflection=0.1, a 10 mm cube filleted at 0.5 mm and
    // at 4.5 mm happens to tessellate to the same number of tris (40). The
    // vertex positions, however, do differ, because the blend face lives at
    // different distances from the corner. Hash the tessellated positions
    // (FNV-1a over 0.001 mm-quantised floats) to confirm MakeFillet is
    // actually consuming the radius we hand it.
    const mkPosHash = (radius: number): string => {
      const box = makeBox(oc, 10, 10, 10);
      const named = nameBoxFaces(oc, box, 'E1');
      const feature: FilletFeature = {
        kind: 'fillet',
        id: 'F1',
        mode: 'constant',
        edges: [
          {
            edgeId: canonicalEdgeName(
              namedFace('E1', 'top'),
              namedFace('E1', 'side', 0)
            ),
            selectionMode: 'edge',
            radius: { kind: 'literal', value: radius }
          }
        ],
        setbacks: []
      };
      const r = executeFilletFeature(oc, named, feature, (p) =>
        p.kind === 'literal' ? ok(p.value) : ok(2)
      );
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('fillet failed');
      const mesh = tessellate(oc, r.value.shape, { linearDeflection: 0.1 });
      let h = 2166136261;
      for (let i = 0; i < mesh.positions.length; i++) {
        h = Math.imul(h ^ Math.round(mesh.positions[i]! * 1000), 16777619);
      }
      disposeShape(r.value.shape);
      disposeShape(box);
      return (h >>> 0).toString(16);
    };

    const hashSmall = mkPosHash(0.5);
    const hashLarge = mkPosHash(4.5);
    expect(hashSmall).not.toBe(hashLarge);
  });
});
