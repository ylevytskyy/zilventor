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
