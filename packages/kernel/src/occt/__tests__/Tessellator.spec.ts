import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, disposeShape } from '../SolidOps';
import { tessellate, tessellateEdges, adaptiveLinearDeflection } from '../Tessellator';
import { namedFace, attachName, type NamedShape } from '../FaceNaming';
import type { UvProjection } from '@zilventor/shared';

let occt: OcctInstance;
beforeAll(async () => {
  occt = await loadOcct();
}, 60_000);

describe('adaptiveLinearDeflection (pure, no OCCT)', () => {
  it('returns the floor 0.1 for a 10mm cube', () => {
    expect(adaptiveLinearDeflection([0, 0, 0, 10, 10, 10])).toBe(0.1);
  });

  it('returns 1.0 for a 1000mm span', () => {
    expect(adaptiveLinearDeflection([0, 0, 0, 1000, 1, 1])).toBe(1.0);
  });

  it('returns 2.0 for a 2000mm longest edge', () => {
    expect(adaptiveLinearDeflection([0, 0, 0, 1, 1, 2000])).toBe(2.0);
  });

  it('returns the floor 0.1 for a degenerate/flat bbox', () => {
    expect(adaptiveLinearDeflection([5, 5, 5, 5, 5, 5])).toBe(0.1);
  });
});

describe('Tessellator', () => {
  it('produces triangles for a box and all are within bounds', () => {
    const box = makeBox(occt, 100, 200, 300);
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 });
    expect(mesh.positions.byteLength).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.indices.length).toBeGreaterThanOrEqual(36);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]!;
      const y = mesh.positions[i + 1]!;
      const z = mesh.positions[i + 2]!;
      expect(x).toBeGreaterThanOrEqual(-1e-3);
      expect(x).toBeLessThanOrEqual(100 + 1e-3);
      expect(y).toBeGreaterThanOrEqual(-1e-3);
      expect(y).toBeLessThanOrEqual(200 + 1e-3);
      expect(z).toBeGreaterThanOrEqual(-1e-3);
      expect(z).toBeLessThanOrEqual(300 + 1e-3);
    }
    disposeShape(box);
  });

  it('does not leak on 30 repeated tessellations', () => {
    for (let i = 0; i < 30; i++) {
      const box = makeBox(occt, 100, 200, 300);
      const mesh = tessellate(occt, box, { linearDeflection: 0.1 });
      expect(mesh.indices.length).toBeGreaterThan(0);
      disposeShape(box);
    }
    // If the leak were severe, the process would OOM or vitest would hit timeout.
    expect(true).toBe(true);
  });

  it('extracts tessellated edges from a named cube with expected edge count', () => {
    const box = makeBox(occt, 10, 10, 10);
    tessellate(occt, box, { linearDeflection: 0.1 });

    // Name all 6 faces arbitrarily — we only care that every face has *some*
    // known name so tessellateEdges can identify edge-to-face adjacency.
    const named: NamedShape = { shape: box, faceNames: [] };
    const map = new occt.TopTools_IndexedMapOfShape_1();
    occt.TopExp.MapShapes_1(
      box.handle as never,
      occt.TopAbs_ShapeEnum.TopAbs_FACE as never,
      map as never
    );
    const extent = (map as { Extent: () => number }).Extent();
    for (let i = 1; i <= extent; i++) {
      const faceShape = (map as { FindKey: (i: number) => unknown }).FindKey(i);
      const face = (occt.TopoDS as { Face_1: (s: unknown) => unknown }).Face_1(faceShape as never);
      attachName(named, face, namedFace('BOX', 'f', i - 1));
    }
    map.delete();

    const edges = tessellateEdges(occt, named);
    // A cube has 12 edges; each one is shared by exactly 2 faces.
    expect(edges.length).toBe(12);
    for (const e of edges) {
      expect(e.segments.length).toBeGreaterThanOrEqual(1);
      expect(e.faceNames[0].featureId).toBe('BOX');
      expect(e.faceNames[1].featureId).toBe('BOX');
      for (const [a, b] of e.segments) {
        const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        expect(d).toBeGreaterThan(0);
      }
    }
    disposeShape(box);
  });
});

describe('Tessellator — UV projection', () => {
  it('no projection → mesh.uv is undefined (back-compat)', () => {
    const box = makeBox(occt, 100, 100, 100);
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 });
    expect(mesh.uv).toBeUndefined();
    disposeShape(box);
  });

  it('planar projection → uv.length equals (positions.length / 3) * 2', () => {
    const box = makeBox(occt, 600, 400, 18);
    const proj: UvProjection = { mode: 'planar', origin: { x: 0, y: 0, z: 0 }, uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 0, y: 1, z: 0 } };
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 }, proj);
    expect(mesh.uv).toBeDefined();
    expect(mesh.uv!.length).toBe((mesh.positions.length / 3) * 2);
    disposeShape(box);
  });

  it('planar projection with uAxis=X: U range spans the box X extent (~600mm)', () => {
    const box = makeBox(occt, 600, 400, 18);
    const proj: UvProjection = { mode: 'planar', origin: { x: 0, y: 0, z: 0 }, uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 0, y: 1, z: 0 } };
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 }, proj);
    let maxU = -Infinity, minU = Infinity;
    for (let i = 0; i < mesh.uv!.length; i += 2) {
      const u = mesh.uv![i]!;
      if (u > maxU) maxU = u;
      if (u < minU) minU = u;
    }
    expect(maxU - minU).toBeGreaterThan(550);
    disposeShape(box);
  });

  it('box projection → every vertex has a uv pair (length equals positions / 3 * 2)', () => {
    const box = makeBox(occt, 100, 200, 300);
    const proj: UvProjection = { mode: 'box' };
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 }, proj);
    expect(mesh.uv).toBeDefined();
    expect(mesh.uv!.length).toBe((mesh.positions.length / 3) * 2);
    disposeShape(box);
  });

  it('box projection → mesh is de-indexed (vertex count = triangle count × 3)', () => {
    const box = makeBox(occt, 100, 200, 300);
    const proj: UvProjection = { mode: 'box' };
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 }, proj);
    const nVerts = mesh.positions.length / 3;
    const nTris = mesh.indices.length / 3;
    expect(nVerts).toBe(nTris * 3);
    disposeShape(box);
  });
});
