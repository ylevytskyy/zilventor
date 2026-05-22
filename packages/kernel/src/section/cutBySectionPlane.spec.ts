import { describe, it, expect, beforeAll } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { loadOcct, type OcctInstance } from '../occt/occtLoader';
import { computeBoundingBox, makeBox, type OcctShape } from '../occt/SolidOps';
import {
  buildHalfSpace,
  buildQuarterBox,
  cutBySectionPlane,
  cutAssemblyBySectionPlane,
  cutByStepSegments,                 // NEW (Drawing F1.2 Batch 2)
  type Plane,
} from './cutBySectionPlane';

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

  it('cut-face has polygon3D with 4 boundary points all at z≈5', () => {
    const cube = makeBox(oc, 10, 10, 10);
    const compound = buildTestCompound(oc, cube);
    const plane: Plane = { origin: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 } };
    const result = cutBySectionPlane(oc, compound, plane, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cutFace = [...result.faceTags.values()].find(t => t.tag === 'cut-face');
    expect(cutFace).toBeDefined();
    expect(cutFace!.polygon3D).toBeDefined();
    expect(cutFace!.polygon3D!.length).toBe(4);
    for (const p of cutFace!.polygon3D!) {
      expect(p.z).toBeCloseTo(5, 2);
    }
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

  it('HS-K-2: splitPlane omitted → result identical to F1 full-section (10mm cube at z=5)', () => {
    // Regression guard: full-section path is unchanged when splitPlane is undefined.
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

    // Full-section path does not set planeSource
    const cutFace = tags.find(t => t.tag === 'cut-face')!;
    expect((cutFace as { planeSource?: string }).planeSource).toBeUndefined();

    disposeOcctShape(oc, result.compound);
  });

  it('HS-K-3: half-section on 50×50×30 box — quarter removed, two cut faces', () => {
    const box = makeBox(oc, 50, 50, 30);
    const compound = buildTestCompound(oc, box);
    const sectionPlane: Plane = { origin: { x: 0, y: 0, z: 15 }, normal: { x: 0, y: 0, z: 1 } };
    const splitPlane: Plane   = { origin: { x: 25, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };

    const result = cutBySectionPlane(oc, compound, sectionPlane, 1, splitPlane, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Volume: 50×50×30 = 75000; removed 25×50×15 = 18750; kept ≈ 56250 ± 750
    const vol = shapeVolumePublic(oc, result.compound);
    expect(vol).toBeGreaterThan(55500);
    expect(vol).toBeLessThan(57000);

    const tags = [...result.faceTags.values()];
    const sectionCutFaces = tags.filter(t => t.tag === 'cut-face' && (t as { planeSource?: string }).planeSource === 'section');
    const splitCutFaces   = tags.filter(t => t.tag === 'cut-face' && (t as { planeSource?: string }).planeSource === 'split');
    expect(sectionCutFaces.length).toBeGreaterThanOrEqual(1);
    expect(splitCutFaces.length).toBeGreaterThanOrEqual(1);

    disposeOcctShape(oc, result.compound);
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

  it('nested sub-assembly: panel world pose is outer(100,0,0) + inner(0,50,0) = (100,50,0)', () => {
    // Outer assembly has a sub-assembly component at x=100; sub-assembly has a panel at y=50.
    // Expected world position of panel: (100, 50, 0).
    // Without the fix, flattenLeaves ignores the outer pose, placing the panel at (0, 50, 0).
    const panelId = 'part-nested-panel';

    const innerAsm: AssemblyDocument = {
      id: 'inner-asm',
      name: 'inner',
      units: 'mm',
      parameters: {},
      components: [
        {
          id: 'ci1',
          partPath: 'panel.zipt',
          position: { x: 0, y: 50, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true,
          pose: { translation: { x: 0, y: 50, z: 0 }, quaternion: [0, 0, 0, 1] as const },
        },
      ],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
      cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [],
    };

    const outerAsm: AssemblyDocument = {
      id: 'outer-asm',
      name: 'outer',
      units: 'mm',
      parameters: {},
      components: [
        {
          id: 'co1',
          partPath: 'inner.ziasm',
          position: { x: 100, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true,
          pose: { translation: { x: 100, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const },
        },
      ],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
      cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [],
    };

    // The panel is a 10×10×10 box. The body resolver positions it using the world pose from flattenLeaves.
    // World pose should be (100, 50, 0). We use a section plane at x=105 to bisect it.
    // Without the fix: panel placed at (0,50,0) → plane at x=105 misses it → result ok:false.
    // With the fix:    panel placed at (100,50,0) → plane at x=105 bisects it → result ok:true.
    const bodyResolver = (_partId: string, pose: { translation: { x: number; y: number; z: number } }) => {
      // Translate a 10×10×10 box to the given world position
      const mk = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
      const raw = mk.Shape();
      mk.delete();
      const tx = new oc.gp_Trsf_1();
      const tv = new oc.gp_Vec_4(pose.translation.x, pose.translation.y, pose.translation.z);
      (tx as unknown as { SetTranslation_1(v: unknown): void }).SetTranslation_1(tv as never);
      const transformed = new oc.BRepBuilderAPI_Transform_2(raw as never, tx as never, true as never);
      const shape = (transformed as unknown as { Shape(): unknown }).Shape();
      (transformed as unknown as { delete(): void }).delete();
      (tx as unknown as { delete(): void }).delete();
      (tv as unknown as { delete(): void }).delete();
      return { __brand: 'OcctShape' as const, handle: shape };
    };

    const plane: Plane = { origin: { x: 105, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
    const result = cutAssemblyBySectionPlane(oc, outerAsm, plane, 1, {
      lookupSubAsm: (path) => path === 'inner.ziasm' ? innerAsm : undefined,
      partPathToId: new Map([['panel.zipt', panelId]]),
      bodyResolver,
      materialResolver: () => 'mat-default',
    });

    // With correct pose composition the panel is at x∈[100,110], plane at x=105 bisects it → ok:true
    expect(result.ok).toBe(true);
    if (result.ok) disposeOcctShape(oc, result.compound);
  });
});

// Helper for volume computation in tests — mirrors shapeVolume in cutBySectionPlane.ts
function shapeVolumePublic(oc: OcctInstance, shape: unknown): number {
  const props = new oc.GProp_GProps_1();
  try {
    oc.BRepGProp.VolumeProperties_1(shape as never, props, true as never, false as never, false as never);
    return props.Mass();
  } finally {
    props.delete();
  }
}

describe('cutBySectionPlane — planeSource field (HS-K-4)', () => {
  it('HS-K-4: half-section — planeSource populated on all cut faces', () => {
    const box = makeBox(oc, 50, 50, 30);
    const compound = buildTestCompound(oc, box);
    const sectionPlane: Plane = { origin: { x: 0, y: 0, z: 15 }, normal: { x: 0, y: 0, z: 1 } };
    const splitPlane: Plane   = { origin: { x: 25, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };

    const result = cutBySectionPlane(oc, compound, sectionPlane, 1, splitPlane, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tags = [...result.faceTags.values()];
    // Every cut-face must have planeSource
    const cutWithoutSource = tags.filter(t => t.tag === 'cut-face' && t.planeSource === undefined);
    expect(cutWithoutSource).toHaveLength(0);
    // original-face entries must NOT have planeSource
    const origWithSource = tags.filter(t => t.tag === 'original-face' && t.planeSource !== undefined);
    expect(origWithSource).toHaveLength(0);
    // At least one of each source
    expect(tags.some(t => t.tag === 'cut-face' && t.planeSource === 'section')).toBe(true);
    expect(tags.some(t => t.tag === 'cut-face' && t.planeSource === 'split')).toBe(true);

    disposeOcctShape(oc, result.compound);
  });
});

describe('buildQuarterBox', () => {
  it('HS-K-1: box for +X/+Z quadrant of a 50×50×30 fixture spans correct octant', () => {
    const fixture = makeBox(oc, 50, 50, 30);
    const sectionPlane: Plane = { origin: { x: 0, y: 0, z: 15 }, normal: { x: 0, y: 0, z: 1 } };
    const splitPlane: Plane   = { origin: { x: 25, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };

    const qBox = buildQuarterBox(oc, fixture, sectionPlane, 1, splitPlane, 1);
    const bb = computeBoundingBox(oc, qBox);

    expect(bb[0]).toBeLessThanOrEqual(25);     // xmin ≤ 25
    expect(bb[3]).toBeGreaterThanOrEqual(51);  // xmax ≥ 51
    expect(bb[5]).toBeGreaterThanOrEqual(16);  // zmax ≥ 16

    (qBox.handle as { delete(): void }).delete();
    (fixture.handle as { delete(): void }).delete();
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

describe('cutAssemblyBySectionPlane — half-section propagation (HS-K-5)', () => {
  it('HS-K-5: splitPlane/splitSide propagated — assembly cut removes correct quadrant', () => {
    const asm: AssemblyDocument = {
      id: 'hs-asm1', name: 'hs-test', units: 'mm', parameters: {},
      components: [
        { id: 'hc1', partPath: 'p1.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'hc2', partPath: 'p2.zipt', position: { x: 0, y: 60, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
      cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [],
    };
    const bodyResolver = (_id: string, pose: { translation: { x: number; y: number; z: number } }) => {
      const mk = new oc.BRepPrimAPI_MakeBox_2(50, 50, 30);
      const raw = mk.Shape(); mk.delete();
      const tx = new oc.gp_Trsf_1();
      const tv = new oc.gp_Vec_4(pose.translation.x, pose.translation.y, pose.translation.z);
      (tx as unknown as { SetTranslation_1(v: unknown): void }).SetTranslation_1(tv as never);
      const xf = new oc.BRepBuilderAPI_Transform_2(raw as never, tx as never, true as never);
      const shape = (xf as unknown as { Shape(): unknown }).Shape();
      (xf as unknown as { delete(): void }).delete();
      (tx as unknown as { delete(): void }).delete();
      (tv as unknown as { delete(): void }).delete();
      (raw as unknown as { delete?(): void }).delete?.();
      return { __brand: 'OcctShape' as const, handle: shape };
    };
    const sectionPlane: Plane = { origin: { x: 0, y: 0, z: 15 }, normal: { x: 0, y: 0, z: 1 } };
    const splitPlane: Plane   = { origin: { x: 25, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };

    const result = cutAssemblyBySectionPlane(oc, asm, sectionPlane, 1, {
      lookupSubAsm: () => undefined,
      partPathToId: new Map([['p1.zipt', 'part-1'], ['p2.zipt', 'part-2']]),
      bodyResolver,
      materialResolver: () => 'mat-default',
    }, splitPlane, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tags = [...result.faceTags.values()];
    expect(tags.filter(t => t.tag === 'cut-face' && t.planeSource === 'section').length).toBeGreaterThanOrEqual(2);
    expect(tags.filter(t => t.tag === 'cut-face' && t.planeSource === 'split').length).toBeGreaterThanOrEqual(2);

    disposeOcctShape(oc, result.compound);
  });
});

describe('cutByStepSegments — invariants and core cut (SS-K-1..10)', () => {
  it('SS-K-4: 1-segment input throws stepped-section-invariant-violated (clause 2)', () => {
    const cube = makeBox(oc, 50, 50, 30);
    const compound = buildTestCompound(oc, cube);
    const planes: Plane[] = [
      { origin: { x: 0, y: 0, z: 15 }, normal: { x: 0, y: 0, z: 1 } },
    ];
    expect(() => cutByStepSegments(oc, compound, planes, 1))
      .toThrow(/stepped-section-invariant-violated/);
    disposeOcctShape(oc, compound);
  });

  it('SS-K-5: 9-segment input throws stepped-section-invariant-violated (clause 3)', () => {
    const cube = makeBox(oc, 50, 50, 30);
    const compound = buildTestCompound(oc, cube);
    const planes: Plane[] = Array.from({ length: 9 }, (_, i) => ({
      origin: { x: i, y: 0, z: 15 },
      normal: { x: i % 2 === 0 ? 0 : 1, y: 0, z: i % 2 === 0 ? 1 : 0 },
    }));
    expect(() => cutByStepSegments(oc, compound, planes, 1))
      .toThrow(/stepped-section-invariant-violated/);
    disposeOcctShape(oc, compound);
  });

  it('SS-K-1: canonical 2-segment cut on 100×60×40 box — both planes contribute, all faces tagged "section"', () => {
    const box = makeBox(oc, 100, 60, 40);
    const compound = buildTestCompound(oc, box);
    const planes: Plane[] = [
      { origin: { x: 0,  y: 0, z: 20 }, normal: { x: 0, y: 0, z: 1 } }, // segment 1: horizontal cut
      { origin: { x: 50, y: 0, z: 0  }, normal: { x: 1, y: 0, z: 0 } }, // segment 2: vertical cut (one jog)
    ];
    const result = cutByStepSegments(oc, compound, planes, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tags = [...result.faceTags.values()];
    const cutFaces = tags.filter(t => t.tag === 'cut-face');
    // Each segment contributes at least one cut face on a box; total >= 2.
    expect(cutFaces.length).toBeGreaterThanOrEqual(2);

    // Face-tag contract: every cut face from any segment is 'section' (B2 axis).
    // The 'split' value from F1.1 must NEVER appear in stepped cuts.
    for (const face of cutFaces) {
      expect((face as { planeSource?: string }).planeSource).toBe('section');
    }
    const splitFaces = tags.filter(t => (t as { planeSource?: string }).planeSource === 'split');
    expect(splitFaces).toHaveLength(0);

    disposeOcctShape(oc, result.compound);
  });
});
