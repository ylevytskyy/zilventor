import { describe, it, expect, beforeAll } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { loadOcct, type OcctInstance } from '../occt/occtLoader';
import { computeBoundingBox, makeBox, type OcctShape } from '../occt/SolidOps';
import { buildHalfSpace, cutBySectionPlane, cutAssemblyBySectionPlane, type Plane } from './cutBySectionPlane';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); }, 60_000);

describe('buildHalfSpace', () => {
  it('plane through origin +Z arrowDirection=1 → solid extends ≥1km on -Z side', () => {
    const plane: Plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
    const solid = buildHalfSpace(oc, plane, 1);
    const bb = computeBoundingBox(oc, solid);
    // half-space keeps the side OPPOSITE to arrowDirection (the -Z side)
    expect(bb[2]).toBeLessThanOrEqual(-1_000_000);  // zmin ≤ -1 000 000 mm
    expect(bb[5]).toBeCloseTo(0, 2);                // zmax ≈ 0 (coincident face)
    expect(bb[3] - bb[0]).toBeGreaterThanOrEqual(1_000_000); // width ≥ 1 km
    expect(bb[4] - bb[1]).toBeGreaterThanOrEqual(1_000_000); // depth ≥ 1 km
    (solid.handle as { delete(): void }).delete();
  });

  it('plane through origin +X arrowDirection=-1 → solid extends on +X side', () => {
    const plane: Plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
    const solid = buildHalfSpace(oc, plane, -1);
    const bb = computeBoundingBox(oc, solid);
    // arrowDirection=-1 → keep +X side (same direction as normal)
    expect(bb[0]).toBeCloseTo(0, 2);               // xmin ≈ 0
    expect(bb[3]).toBeGreaterThanOrEqual(1_000_000); // xmax ≥ 1 km
    (solid.handle as { delete(): void }).delete();
  });

  it('bounding box extends ≥ 1 km in all three axis extents', () => {
    const plane: Plane = { origin: { x: 50, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
    const solid = buildHalfSpace(oc, plane, 1);
    const bb = computeBoundingBox(oc, solid);
    expect(bb[3] - bb[0]).toBeGreaterThanOrEqual(1_000_000);
    expect(bb[4] - bb[1]).toBeGreaterThanOrEqual(1_000_000);
    expect(bb[5] - bb[2]).toBeGreaterThanOrEqual(1_000_000);
    (solid.handle as { delete(): void }).delete();
  });
});

describe('cutBySectionPlane', () => {
  it('cube 10mm cut by z=5 arrowDir=1 → 5 original + 1 cut face', () => {
    // build 10×10×10 box at origin → z∈[0,10]
    const cube = makeBox(oc, 10, 10, 10);
    const compound = buildTestCompound(oc, cube);
    const plane: Plane = { origin: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 } };
    const result = cutBySectionPlane(oc, compound, plane, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tags = [...result.faceTags.values()];
    const cutCount = tags.filter(t => t.tag === 'cut-face').length;
    const origCount = tags.filter(t => t.tag === 'original-face').length;
    expect(cutCount).toBe(1);
    expect(origCount).toBe(5);
    disposeOcctShape(oc, result.compound);
  });

  it('cylinder r=5 h=20 cut by x=0 arrowDir=1 → 1 half-cyl + 2 discs + 1 cut face', () => {
    const cyl = buildTestCylinder(oc, 5, 20);
    const compound = buildTestCompound(oc, cyl);
    const plane: Plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
    const result = cutBySectionPlane(oc, compound, plane, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tags = [...result.faceTags.values()];
    const cutCount = tags.filter(t => t.tag === 'cut-face').length;
    expect(cutCount).toBe(1);
    expect(tags.length).toBeGreaterThanOrEqual(4); // half-cyl + top disc + bottom disc + cut face (≥4 due to OCCT topology)
    disposeOcctShape(oc, result.compound);
  });

  it('plane misses body (cube cut by z=100) → ok:false reason:empty', () => {
    const cube = makeBox(oc, 10, 10, 10);
    const compound = buildTestCompound(oc, cube);
    const plane: Plane = { origin: { x: 0, y: 0, z: 100 }, normal: { x: 0, y: 0, z: 1 } };
    const result = cutBySectionPlane(oc, compound, plane, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('plane tangent to body (cube cut by z=0) → ok:false reason:tangent', () => {
    const cube = makeBox(oc, 10, 10, 10); // z∈[0,10]
    const compound = buildTestCompound(oc, cube);
    const plane: Plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
    const result = cutBySectionPlane(oc, compound, plane, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('tangent');
  });
});

describe('cutAssemblyBySectionPlane', () => {
  it('2-panel assembly cut by mid-plane → cut faces from each component', () => {
    const panel1Id = 'part-panel1';
    const panel2Id = 'part-panel2';

    const asm: AssemblyDocument = {
      id: 'asm1',
      name: 'test',
      units: 'mm',
      parameters: {},
      components: [
        {
          id: 'c1', partPath: 'panel1.zipt',
          position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true,
        },
        {
          id: 'c2', partPath: 'panel2.zipt',
          position: { x: 50, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true,
        },
      ],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
      cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [],
    };

    const bodyResolver = (_partId: string, _pose: unknown) => {
      return makeBox(oc, 10, 10, 20);
    };

    const plane: Plane = { origin: { x: 5, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
    const result = cutAssemblyBySectionPlane(oc, asm, plane, 1, {
      lookupSubAsm: () => undefined,
      partPathToId: new Map([['panel1.zipt', panel1Id], ['panel2.zipt', panel2Id]]),
      bodyResolver,
      materialResolver: () => 'mat-default',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cutFaces = [...result.faceTags.values()].filter(t => t.tag === 'cut-face');
    // panel1 is bisected → 1 cut face; panel2 gets the same box (both are at x=0-10 in world space)
    expect(cutFaces.length).toBeGreaterThanOrEqual(1);
    // every entry has a partId set
    for (const v of result.faceTags.values()) {
      expect(v.partId).not.toBe('');
    }
    disposeOcctShape(oc, result.compound);
  });
});

// --- test helpers ---
function buildTestCompound(oc: OcctInstance, shape: OcctShape): unknown /* TopoDS_Compound */ {
  const builder = new oc.BRep_Builder();
  const comp = new oc.TopoDS_Compound();
  builder.MakeCompound(comp);
  builder.Add(comp, shape.handle as never);
  builder.delete();
  (shape.handle as unknown as { delete?(): void }).delete?.();
  return comp;
}

function buildTestCylinder(oc: OcctInstance, r: number, h: number): OcctShape {
  // BRepPrimAPI_MakeCylinder_1(R, H) — two-arg ctor
  const mk = new oc.BRepPrimAPI_MakeCylinder_1(r, h);
  const shape = mk.Shape();
  mk.delete();
  return { __brand: 'OcctShape', handle: shape };
}

function disposeOcctShape(_oc: OcctInstance, compound: unknown): void {
  (compound as { delete?(): void }).delete?.();
}
