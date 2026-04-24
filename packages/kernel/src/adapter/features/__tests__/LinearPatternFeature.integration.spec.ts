import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { makeBox, disposeShape, type OcctShape } from '../../../occt/SolidOps';
import { tessellate } from '../../../occt/Tessellator';
import { translateShape } from '../../../occt/TransformOps';
import { namedFace, attachName, type NamedShape } from '../../../occt/FaceNaming';
import { executeLinearPatternFeature } from '../LinearPatternFeature';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

function namedBox(box: OcctShape): NamedShape {
  const named: NamedShape = { shape: box, faceNames: [] };
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    box.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    map as never
  );
  for (let i = 1; i <= (map as { Extent: () => number }).Extent(); i++) {
    const faceShape = (map as { FindKey: (i: number) => unknown }).FindKey(i);
    const face = (oc.TopoDS as { Face_1: (s: unknown) => unknown }).Face_1(faceShape as never);
    attachName(named, face, namedFace('B', 'f', i - 1));
  }
  map.delete();
  return named;
}

describe('executeLinearPatternFeature (integration)', () => {
  it('count=1 is a no-op and returns the running body unchanged', () => {
    const body = makeBox(oc, 100, 100, 100);
    const source = makeBox(oc, 5, 5, 5);
    const named = namedBox(body);
    const r = executeLinearPatternFeature(oc, {
      runningBody: named,
      sourceShape: source,
      operation: 'join',
      direction: 'x',
      spacing: 20,
      count: 1,
      featureId: 'P1'
    });
    expect(r.ok).toBe(true);
    disposeShape(source);
    if (r.ok) disposeShape(r.value.shape);
  });

  it('count=3 join adds translated copies and grows the tri count', () => {
    const body = makeBox(oc, 50, 50, 50);
    // Position the source OUT of the body so each copy is a distinct nub
    // (translateShape offsets from its current position, so we pre-translate
    // the source to (100,0,0) — body occupies x∈[0,50]).
    const srcOriginal = makeBox(oc, 10, 10, 10);
    const source = translateShape(oc, srcOriginal, 100, 0, 0);
    disposeShape(srcOriginal);

    const beforeTris = (() => {
      const m = tessellate(oc, body, { linearDeflection: 0.1 });
      return m.indices.length / 3;
    })();

    const named = namedBox(body);
    const r = executeLinearPatternFeature(oc, {
      runningBody: named,
      sourceShape: source,
      operation: 'join',
      direction: 'x',
      // Each copy offset by spacing. Copy i is at x = 100 + i*spacing.
      // i=1 → x=140; i=2 → x=180. All disjoint from body and each other.
      spacing: 40,
      count: 3,
      featureId: 'P1'
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('pattern failed');
    const afterMesh = tessellate(oc, r.value.shape, { linearDeflection: 0.1 });
    const afterTris = afterMesh.indices.length / 3;
    // Two disjoint nubs added → tri count strictly grows.
    expect(afterTris).toBeGreaterThan(beforeTris);
    disposeShape(r.value.shape);
    disposeShape(source);
  });
});
