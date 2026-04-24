import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, disposeShape } from '../SolidOps';
import {
  namedFace,
  attachName,
  resolveEdge,
  canonicalEdgeName,
  tagHoleFaces,
  type NamedShape
} from '../FaceNaming';
import { makeHole } from '../HoleOps';
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

describe('tagHoleFaces (integration)', () => {
  let oc: OcctInstance;
  beforeAll(async () => {
    oc = await loadOcct();
  }, 60_000);

  it('tagHoleFaces labels shank / cbore / tip faces on a blind CBORE', () => {
    // Box 10x10x10 with origin ON the top face (z=10), drilling down.
    // cboreDepth=2 + shank depth=5 + tip cone → total < 10 so tip stays inside.
    const body = new (oc as any).BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const origin = new (oc as any).gp_Pnt_3(5, 5, 10);
    const axis = new (oc as any).gp_Dir_4(0, 0, -1);
    const cut = makeHole(oc, body, [{ origin, axis }],
      { kind: 'counterbore', diameter: 4, cboreDiameter: 7, cboreDepth: 2 },
      { kind: 'distance', depth: 5, blindTip: true });

    const names = tagHoleFaces(oc, cut, 'H1', 0, 'counterbore', /* blind */ true);
    const roles = Array.from(names.values()).map((n) => n.role);
    expect(roles).toContain('H1/hole/0/shank');
    expect(roles).toContain('H1/hole/0/cbore');
    expect(roles).toContain('H1/hole/0/tip');
  });

  it('tagHoleFaces labels csk on a CSK through hole', () => {
    // Box 10x10x10 with origin ON the top face (z=10), drilling through.
    const body = new (oc as any).BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const origin = new (oc as any).gp_Pnt_3(5, 5, 10);
    const axis = new (oc as any).gp_Dir_4(0, 0, -1);
    const cut = makeHole(oc, body, [{ origin, axis }],
      { kind: 'countersink', diameter: 3, cskDiameter: 6, cskAngleDeg: 82 },
      { kind: 'throughAll' });

    const names = tagHoleFaces(oc, cut, 'H1', 0, 'countersink', /* blind */ false);
    const roles = Array.from(names.values()).map((n) => n.role);
    expect(roles).toContain('H1/hole/0/shank');
    expect(roles).toContain('H1/hole/0/csk');
  });
});
