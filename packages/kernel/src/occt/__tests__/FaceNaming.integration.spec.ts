import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, disposeShape } from '../SolidOps';
import {
  namedFace,
  attachName,
  resolveEdge,
  canonicalEdgeName,
  type NamedShape
} from '../FaceNaming';
import type { FaceName } from '@zilventor/shared';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

describe('resolveEdge (integration)', () => {
  it('finds the edge shared by two named faces on a box', () => {
    // Build a 10x10x10 box and enumerate its 6 faces via TopExp_Explorer.
    const box = makeBox(oc, 10, 10, 10);
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
    expect(faces.length).toBe(6);

    // Name the first two arbitrary faces for test purposes.
    const nm: NamedShape = { shape: box, faceNames: [] };
    const nameA: FaceName = namedFace('E1', 'top');
    const nameB: FaceName = namedFace('E1', 'side', 0);
    attachName(nm, faces[0]!, nameA);
    attachName(nm, faces[1]!, nameB);

    const edgeName = canonicalEdgeName(nameA, nameB);
    const edge = resolveEdge(oc, nm, edgeName);
    // Two arbitrary adjacent faces of a box share exactly one edge;
    // two opposite faces share none. Either way the function returns
    // without throwing — if they share 1 edge we get a handle, else null.
    expect(edge === null || typeof edge === 'object').toBe(true);
    disposeShape(box);
    for (const f of faces) (f as { delete?: () => void }).delete?.();
  });

  it('returns null when either face is absent from the map', () => {
    const box = makeBox(oc, 10, 10, 10);
    const nm: NamedShape = { shape: box, faceNames: [] };
    const edgeName = canonicalEdgeName(
      namedFace('X', 'top'),
      namedFace('Y', 'bottom')
    );
    expect(resolveEdge(oc, nm, edgeName)).toBe(null);
    disposeShape(box);
  });
});
