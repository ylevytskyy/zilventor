import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occt/occtLoader';
import { makeBox } from '../occt/SolidOps';
import { hashFace, classifyFace, mergeFaceTags, extractFaceBoundary3D } from './faceTag';
import type { Plane, FaceTagMap } from './cutBySectionPlane';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); }, 60_000);

function getFirstFace(oc: OcctInstance, shape: unknown): unknown {
  const exp = new oc.TopExp_Explorer_2(
    shape as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  const face = exp.Current();
  exp.delete();
  return face;
}

describe('hashFace', () => {
  it('returns a non-empty string for a box face', () => {
    const box = makeBox(oc, 10, 20, 30);
    const face = getFirstFace(oc, box.handle);
    const h = hashFace(oc, face);
    expect(typeof h).toBe('string');
    expect(h.length).toBeGreaterThan(0);
    (box.handle as unknown as { delete(): void }).delete();
  });

  it('two distinct faces of the same box produce different hashes', () => {
    const box = makeBox(oc, 10, 20, 30);
    const exp = new oc.TopExp_Explorer_2(
      box.handle as never,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
    );
    const faces: unknown[] = [];
    while (exp.More() && faces.length < 2) {
      faces.push(exp.Current());
      exp.Next();
    }
    exp.delete();
    const h1 = hashFace(oc, faces[0]!);
    const h2 = hashFace(oc, faces[1]!);
    expect(h1).not.toBe(h2);
    (box.handle as unknown as { delete(): void }).delete();
  });

  it('same face hashes consistently (idempotent)', () => {
    const box = makeBox(oc, 10, 20, 30);
    const face = getFirstFace(oc, box.handle);
    expect(hashFace(oc, face)).toBe(hashFace(oc, face));
    (box.handle as unknown as { delete(): void }).delete();
  });
});

describe('classifyFace', () => {
  it('top face of box at z=10 is cut-face when plane is z=10 with normal +Z', () => {
    const box = makeBox(oc, 10, 10, 10); // z∈[0,10]
    const exp = new oc.TopExp_Explorer_2(
      box.handle as never,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
    );
    let cutFaceFound = false;
    while (exp.More()) {
      const f = exp.Current();
      const plane: Plane = { origin: { x: 0, y: 0, z: 10 }, normal: { x: 0, y: 0, z: 1 } };
      const tag = classifyFace(oc, f, plane);
      if (tag === 'cut-face') cutFaceFound = true;
      exp.Next();
    }
    exp.delete();
    expect(cutFaceFound).toBe(true);
    (box.handle as unknown as { delete(): void }).delete();
  });

  it('side face of box is original-face when plane is z=10', () => {
    const box = makeBox(oc, 10, 10, 10);
    // The first face from TopExp for a MakeBox is typically the bottom (z=0),
    // which IS parallel to z-plane but NOT at z=10 → original-face
    const exp = new oc.TopExp_Explorer_2(
      box.handle as never,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
    );
    const plane: Plane = { origin: { x: 0, y: 0, z: 10 }, normal: { x: 0, y: 0, z: 1 } };
    const f = exp.Current();
    exp.delete();
    const tag = classifyFace(oc, f, plane);
    expect(tag).toBe('original-face');
    (box.handle as unknown as { delete(): void }).delete();
  });
});

describe('extractFaceBoundary3D', () => {
  it('cut-face of cube at z=5 has 4 boundary points all near z=5', () => {
    // Build a 10×10×10 cube. The top face (z=10) has a planar boundary with 4 vertices.
    const box = makeBox(oc, 10, 10, 10);
    // Find the top face (z≈10)
    const exp = new oc.TopExp_Explorer_2(
      box.handle as never,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
    );
    let topFace: unknown = null;
    while (exp.More()) {
      const f = exp.Current();
      const plane: Plane = { origin: { x: 0, y: 0, z: 10 }, normal: { x: 0, y: 0, z: 1 } };
      if (classifyFace(oc, f, plane) === 'cut-face') {
        topFace = f;
        break;
      }
      exp.Next();
    }
    exp.delete();
    expect(topFace).not.toBeNull();
    const pts = extractFaceBoundary3D(oc, topFace!);
    expect(pts.length).toBe(4);
    for (const p of pts) {
      expect(p.z).toBeCloseTo(10, 2);
    }
    (box.handle as unknown as { delete(): void }).delete();
  });
});

describe('mergeFaceTags', () => {
  it('merges two maps without collision', () => {
    const m1: FaceTagMap = new Map([
      ['k1', { tag: 'cut-face', partId: 'p1', materialId: 'm1' }],
    ]);
    const m2: FaceTagMap = new Map([
      ['k2', { tag: 'original-face', partId: 'p2', materialId: 'm2' }],
    ]);
    const merged = mergeFaceTags([m1, m2]);
    expect(merged.size).toBe(2);
    expect(merged.get('k1')?.partId).toBe('p1');
    expect(merged.get('k2')?.partId).toBe('p2');
  });

  it('later map wins on key collision', () => {
    const m1: FaceTagMap = new Map([['k1', { tag: 'cut-face',      partId: 'p1', materialId: 'm1' }]]);
    const m2: FaceTagMap = new Map([['k1', { tag: 'original-face', partId: 'p2', materialId: 'm2' }]]);
    const merged = mergeFaceTags([m1, m2]);
    expect(merged.get('k1')?.tag).toBe('original-face');
  });

  it('empty array returns empty map', () => {
    expect(mergeFaceTags([]).size).toBe(0);
  });
});
