// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { buildPanelBox } from './PanelOps';
import { loadOcct } from './occtLoader';
import type { OcctInstance } from './occtLoader';

let occt: OcctInstance;

beforeAll(async () => {
  occt = await loadOcct();
}, 60000);

const PENTAGON = [
  { x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 },
  { x: 300, y: 600 }, { x: 0, y: 600 },
];

/** Count faces in a TopoDS_Shape via TopExp_Explorer. */
function countFaces(oc: OcctInstance, shape: unknown): number {
  const ocAny = oc as unknown as {
    TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
      More: () => boolean;
      Next: () => void;
      delete: () => void;
    };
    TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
  };
  const expl = new ocAny.TopExp_Explorer_2(
    shape,
    ocAny.TopAbs_ShapeEnum.TopAbs_FACE,
    ocAny.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  let n = 0;
  while (expl.More()) { n++; expl.Next(); }
  expl.delete();
  return n;
}

describe('buildPanelBox — outline path (prism from polygon)', () => {
  it('rectangle without outline still works (regression)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 400, thickness: 18 });
    expect(result.bbox).toEqual([-300, -200, 0, 300, 200, 18]);
    expect(result.faceNames.Top).toBeDefined();
    expect(result.faceNames.Bottom).toBeDefined();
    expect(result.faceNames.Front).toBeDefined();
  });

  it('pentagon outline produces a solid with 7 faces (5 sides + top + bottom)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, PENTAGON);
    // shape must exist (prism built successfully)
    expect(typeof result.shape).toBe('object');
    expect(result.shape).not.toBeNull();
    // 7 faces: top + bottom + 5 sides
    expect(countFaces(occt, result.shape)).toBe(7);
    // Top and Bottom face names are present
    expect(result.faceNames.Top).toBeDefined();
    expect(result.faceNames.Bottom).toBeDefined();
  });

  it('pentagon outline AABB is full bounding rectangle (conservative for cut-list)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, PENTAGON);
    // bbox = [-L/2, -W/2, 0, L/2, W/2, T]
    expect(result.bbox).toEqual([-300, -300, 0, 300, 300, 18]);
  });

  it('pentagon faceNames does NOT have Front/Back/Left/Right (side faces unclassified)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, PENTAGON);
    // Side faces are not classified for outline panels in Slice E
    expect((result.faceNames as Record<string, unknown>).Front).toBeUndefined();
    expect((result.faceNames as Record<string, unknown>).Back).toBeUndefined();
    expect((result.faceNames as Record<string, unknown>).Left).toBeUndefined();
    expect((result.faceNames as Record<string, unknown>).Right).toBeUndefined();
  });

  it('outline with fewer than 3 vertices throws a clear error', () => {
    expect(() =>
      buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, [{ x: 0, y: 0 }, { x: 600, y: 0 }])
    ).toThrow(/at least 3 vertices/);

    expect(() =>
      buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, [])
    ).toThrow(/at least 3 vertices/);
  });
});
