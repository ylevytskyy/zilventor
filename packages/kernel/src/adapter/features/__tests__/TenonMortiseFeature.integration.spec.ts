import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { executeTree } from '../../FeatureTree';
import { newPart, addFeature } from '../../PartDocument';
import { disposeShape, computeBoundingBox, makeBoxFromCorners, type OcctShape } from '../../../occt/SolidOps';
import { fuseShapes, cutShapes } from '../../../occt/BooleanOps';
import type { PanelFeature, TenonMortiseFeature, PartDocument } from '@zilventor/shared';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

/** Real-OCCT solid volume via BRepGProp.VolumeProperties_1 (same call GrooveFeature's test uses). */
function volumeOf(shape: { handle: unknown }): number {
  const ocAny = occt as unknown as {
    GProp_GProps_1: new () => { Mass: () => number; delete?: () => void };
    BRepGProp: { VolumeProperties_1: (h: unknown, p: unknown, a: boolean, b: boolean, c: boolean) => void };
  };
  const props = new ocAny.GProp_GProps_1();
  try {
    ocAny.BRepGProp.VolumeProperties_1(shape.handle, props, true, false, false);
    return props.Mass();
  } finally {
    props.delete?.();
  }
}

/**
 * Enumerate top-level SOLID sub-shapes of a (possibly disconnected) shape via
 * TopExp_Explorer_2(shape, SOLID, SHAPE) — the identical enumeration pattern
 * BooleanOps.ts's cutShapes uses for its no-op check, and StepIO.ts uses for
 * multi-body enumeration. Used here to prove a fused/cut result really
 * contains `count` DISCRETE tabs/pockets, not one merged blob.
 */
function explodeSolids(shape: OcctShape): OcctShape[] {
  const ocAny = occt as unknown as {
    TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
      More(): boolean; Next(): void; Current(): unknown; delete?(): void;
    };
    TopAbs_ShapeEnum: { TopAbs_SOLID: unknown; TopAbs_SHAPE: unknown };
  };
  const out: OcctShape[] = [];
  const expl = new ocAny.TopExp_Explorer_2(
    shape.handle,
    ocAny.TopAbs_ShapeEnum.TopAbs_SOLID,
    ocAny.TopAbs_ShapeEnum.TopAbs_SHAPE
  );
  while (expl.More()) {
    out.push({ __brand: 'OcctShape', handle: expl.Current() } as OcctShape);
    expl.Next();
  }
  expl.delete?.();
  return out;
}

const mkPanel = (over: Partial<PanelFeature> = {}): PanelFeature => ({
  kind: 'panel', id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-1',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  ...over,
});

async function runOne(feature?: TenonMortiseFeature, suppressedFeatureIds?: string[]) {
  let doc: PartDocument = newPart('P');
  doc = addFeature(doc, mkPanel());
  if (feature) doc = addFeature(doc, feature);
  if (suppressedFeatureIds) doc = { ...doc, suppressedFeatureIds };
  const r = await executeTree(occt, doc);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('executeTree failed');
  return r.value;
}

describe('Phase 0 — verify fuseShapes/cutShapes primitives on trivial boxes (no FeatureTree)', () => {
  it('fuseShapes unions two disjoint unit boxes into a shape with their combined volume', () => {
    const a = makeBoxFromCorners(occt, { x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }); // 1000 mm^3
    const b = makeBoxFromCorners(occt, { x: 20, y: 0, z: 0 }, { x: 30, y: 10, z: 10 }); // 1000 mm^3, disjoint
    const r = fuseShapes(occt, a, b);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(volumeOf(r.value)).toBeCloseTo(2000, 4);
    disposeShape(a);
    disposeShape(b);
    disposeShape(r.value);
  });

  it('cutShapes removes exactly the overlap of two overlapping boxes', () => {
    const a = makeBoxFromCorners(occt, { x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }); // 1000 mm^3
    const b = makeBoxFromCorners(occt, { x: 5, y: 0, z: 0 }, { x: 15, y: 10, z: 10 }); // overlap x:5..10 => 500 mm^3
    const r = cutShapes(occt, a, b);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(volumeOf(r.value)).toBeCloseTo(500, 4);
    disposeShape(a);
    disposeShape(b);
    disposeShape(r.value);
  });
});

describe('TenonMortiseFeature integration — tenon (fuse)', () => {
  it('a single tenon tab grows the bbox by exactly depth on the face-normal axis, at the predicted position', async () => {
    const plain = await runOne();
    const volPlain = volumeOf(plain.finalSolid);

    // Right face: origin=(300,200,0), uDir=+Z (thickness), vDir=-Y. axis='v' means
    // the run axis is v (so the CROSS axis 'u' is the full thickness, 0..18) —
    // this is the full-thickness box-joint MVP (P6 D6/S2).
    const tenon: TenonMortiseFeature = {
      kind: 'tenonMortise', id: 'tm-1', pairId: 'pair-1', role: 'tenon',
      faceRole: 'Right', axis: 'v', position: 250, width: 100, depth: 15,
      count: 1, spacing: 0, fitClearance: 0,
    };
    const grown = await runOne(tenon);
    const volGrown = volumeOf(grown.finalSolid);

    // Added volume = width x depth x thickness = 100 x 15 x 18.
    expect(volGrown - volPlain).toBeCloseTo(100 * 15 * 18, 0);

    // Overall bbox: X grows by exactly `depth`; Y/Z unchanged (tab is a subset).
    const bboxPlain = computeBoundingBox(occt, plain.finalSolid);
    const bboxGrown = computeBoundingBox(occt, grown.finalSolid);
    expect(bboxGrown[0]).toBeCloseTo(bboxPlain[0], 4); // xmin unchanged
    expect(bboxGrown[3] - bboxPlain[3]).toBeCloseTo(15, 4); // xmax grew by depth
    expect(bboxGrown[1]).toBeCloseTo(bboxPlain[1], 4);
    expect(bboxGrown[4]).toBeCloseTo(bboxPlain[4], 4);
    expect(bboxGrown[2]).toBeCloseTo(bboxPlain[2], 4);
    expect(bboxGrown[5]).toBeCloseTo(bboxPlain[5], 4);

    // Exact POSITION of the added slab: delta = grown - plain.
    const delta = cutShapes(occt, grown.finalSolid, plain.finalSolid);
    expect(delta.ok).toBe(true);
    if (delta.ok) {
      const [xmin, ymin, zmin, xmax, ymax, zmax] = computeBoundingBox(occt, delta.value);
      // Hand-derived from face2DFrame('Right'): origin=(300,200,0), uDir=+Z, vDir=-Y.
      // runCenter=250 (axis v), halfW=50 -> v:[200,300] -> y = 200-v -> y:[-100,0].
      // cross (u, full thickness) 0..18 -> z:[0,18]. n: 0..depth -> x:[300,315].
      expect(xmin).toBeCloseTo(300, 4);
      expect(xmax).toBeCloseTo(315, 4);
      expect(ymin).toBeCloseTo(-100, 4);
      expect(ymax).toBeCloseTo(0, 4);
      expect(zmin).toBeCloseTo(0, 4);
      expect(zmax).toBeCloseTo(18, 4);
      disposeShape(delta.value);
    }

    disposeShape(plain.finalSolid);
    disposeShape(grown.finalSolid);
  }, 120_000);

  it('count=3 produces 3 discrete tabs at the predicted spacing/positions (not one merged blob)', async () => {
    const plain = await runOne();

    const tenon: TenonMortiseFeature = {
      kind: 'tenonMortise', id: 'tm-3', pairId: 'pair-3', role: 'tenon',
      faceRole: 'Right', axis: 'v', position: 200, width: 20, depth: 10,
      count: 3, spacing: 50, fitClearance: 0,
    };
    const grown = await runOne(tenon);

    const delta = cutShapes(occt, grown.finalSolid, plain.finalSolid);
    expect(delta.ok).toBe(true);
    if (!delta.ok) { disposeShape(plain.finalSolid); disposeShape(grown.finalSolid); return; }

    const solids = explodeSolids(delta.value);
    expect(solids.length).toBe(3);

    const bboxes = solids.map((s) => computeBoundingBox(occt, s)).sort((a, b) => a[1] - b[1]);
    // Hand-derived: runCenters = 150, 200, 250 (position=200, spacing=50, centered).
    // halfW=10 -> v-intervals [140,160],[190,210],[240,260]; y = 200 - v.
    // tab (v:[240,260]) -> y:[-60,-40]; tab (v:[190,210]) -> y:[-10,10]; tab (v:[140,160]) -> y:[40,60].
    // All tabs: x:[300,310] (depth 10), z:[0,18] (full thickness).
    const expected = [
      { ymin: -60, ymax: -40 },
      { ymin: -10, ymax: 10 },
      { ymin: 40, ymax: 60 },
    ];
    for (let i = 0; i < 3; i++) {
      const box = bboxes[i]!;
      const [xmin, ymin, zmin, xmax, ymax, zmax] = box;
      expect(xmin).toBeCloseTo(300, 4);
      expect(xmax).toBeCloseTo(310, 4);
      expect(ymin).toBeCloseTo(expected[i]!.ymin, 4);
      expect(ymax).toBeCloseTo(expected[i]!.ymax, 4);
      expect(zmin).toBeCloseTo(0, 4);
      expect(zmax).toBeCloseTo(18, 4);
    }

    disposeShape(delta.value);
    disposeShape(plain.finalSolid);
    disposeShape(grown.finalSolid);
  }, 120_000);
});

describe('TenonMortiseFeature integration — mortise (cut)', () => {
  it('a bounded mortise pocket removes material ONLY within crossSpan (through-dado regression guard)', async () => {
    const plain = await runOne();
    const volPlain = volumeOf(plain.finalSolid);

    // Top face, axis='u' (run along length). Bounded cross axis (v/width) via
    // crossPosition/crossSpan — this must NOT cut a through-dado across the
    // whole 400mm width.
    const mortise: TenonMortiseFeature = {
      kind: 'tenonMortise', id: 'mt-1', pairId: 'pair-1', role: 'mortise',
      faceRole: 'Top', axis: 'u', position: 300, width: 50, depth: 6,
      count: 1, spacing: 0, fitClearance: 1,
      crossPosition: 100, crossSpan: 80,
    };
    const cutRes = await runOne(mortise);
    const volCut = volumeOf(cutRes.finalSolid);

    // Removed = (width+2fc) x (crossSpan+2fc) x (depth+fc) = 52 x 82 x 7.
    expect(volPlain - volCut).toBeCloseTo(52 * 82 * 7, 0);

    // Panel's own outer bbox is unchanged (pocket is fully interior).
    const bboxPlain = computeBoundingBox(occt, plain.finalSolid);
    const bboxCut = computeBoundingBox(occt, cutRes.finalSolid);
    for (let i = 0; i < 6; i++) expect(bboxCut[i]!).toBeCloseTo(bboxPlain[i]!, 4);

    // Regression guard: the removed material's own bbox is a strict subset of
    // the full width (-200..200) — bounded to crossSpan, not a through-dado.
    const pocket = cutShapes(occt, plain.finalSolid, cutRes.finalSolid);
    expect(pocket.ok).toBe(true);
    if (pocket.ok) {
      const [xmin, ymin, zmin, xmax, ymax, zmax] = computeBoundingBox(occt, pocket.value);
      // Hand-derived from face2DFrame('Top'): origin=(-300,-200,18), uDir=+X, vDir=+Y.
      // runA/B (u) = 300±26 -> 274..326 -> x = -300+u -> x:[-26,26].
      // crossA/B (v) = 100±41 -> 59..141 -> y = -200+v -> y:[-141,-59].
      // depth: n from OVERCUT(0.1) to -(6+1)=-7 -> z = 18+n, clipped to panel -> z:[11,18].
      expect(xmin).toBeCloseTo(-26, 2);
      expect(xmax).toBeCloseTo(26, 2);
      expect(ymin).toBeCloseTo(-141, 2);
      expect(ymax).toBeCloseTo(-59, 2);
      // Strictly inside the full width range, proving no through-dado:
      expect(ymin).toBeGreaterThan(-200);
      expect(ymax).toBeLessThan(200);
      expect(zmin).toBeCloseTo(11, 2);
      expect(zmax).toBeCloseTo(18, 2);
      disposeShape(pocket.value);
    }

    disposeShape(plain.finalSolid);
    disposeShape(cutRes.finalSolid);
  }, 120_000);

  it('soft-fails (keeps the intact body) when the mortise misses the panel entirely', async () => {
    const plain = await runOne();
    const volPlain = volumeOf(plain.finalSolid);
    disposeShape(plain.finalSolid);

    const missed: TenonMortiseFeature = {
      kind: 'tenonMortise', id: 'mt-x', pairId: 'pair-x', role: 'mortise',
      faceRole: 'Top', axis: 'u', position: 10000, width: 6, depth: 9,
      count: 1, spacing: 0, fitClearance: 0,
    };
    const r = await runOne(missed);
    expect(volumeOf(r.finalSolid)).toBeCloseTo(volPlain, 0);
    disposeShape(r.finalSolid);
  }, 120_000);
});

describe('TenonMortiseFeature integration — fitClearance', () => {
  it('fitClearance widens the mortise pocket but has no effect on a tenon tab', async () => {
    const tenonNoClear: TenonMortiseFeature = {
      kind: 'tenonMortise', id: 't-a', pairId: 'p-a', role: 'tenon',
      faceRole: 'Right', axis: 'v', position: 200, width: 40, depth: 10,
      count: 1, spacing: 0, fitClearance: 0,
    };
    const tenonClear: TenonMortiseFeature = { ...tenonNoClear, id: 't-b', fitClearance: 5 };

    const plain = await runOne();
    const volPlain = volumeOf(plain.finalSolid);
    disposeShape(plain.finalSolid);

    const rTenonA = await runOne(tenonNoClear);
    const addedA = volumeOf(rTenonA.finalSolid) - volPlain;
    disposeShape(rTenonA.finalSolid);
    const rTenonB = await runOne(tenonClear);
    const addedB = volumeOf(rTenonB.finalSolid) - volPlain;
    disposeShape(rTenonB.finalSolid);
    expect(addedB).toBeCloseTo(addedA, 4);

    const mortiseNoClear: TenonMortiseFeature = {
      kind: 'tenonMortise', id: 'm-a', pairId: 'p-a', role: 'mortise',
      faceRole: 'Top', axis: 'u', position: 300, width: 40, depth: 6,
      count: 1, spacing: 0, fitClearance: 0,
    };
    const mortiseClear: TenonMortiseFeature = { ...mortiseNoClear, id: 'm-b', fitClearance: 5 };

    const plain2 = await runOne();
    const volPlain2 = volumeOf(plain2.finalSolid);
    disposeShape(plain2.finalSolid);

    const rMortA = await runOne(mortiseNoClear);
    const removedA = volPlain2 - volumeOf(rMortA.finalSolid);
    disposeShape(rMortA.finalSolid);
    const rMortB = await runOne(mortiseClear);
    const removedB = volPlain2 - volumeOf(rMortB.finalSolid);
    disposeShape(rMortB.finalSolid);

    expect(removedB).toBeGreaterThan(removedA);
    // Hand-derived: A = 40 x 400 x 6 = 96000; B = 50 x 400 x 11 = 220000.
    expect(removedA).toBeCloseTo(40 * 400 * 6, 0);
    expect(removedB).toBeCloseTo(50 * 400 * 11, 0);
  }, 120_000);
});

describe('TenonMortiseFeature integration — suppression', () => {
  it('a suppressed tenonMortise feature id is skipped by executeTree (body identical to plain)', async () => {
    const plain = await runOne();
    const volPlain = volumeOf(plain.finalSolid);
    disposeShape(plain.finalSolid);

    const tenon: TenonMortiseFeature = {
      kind: 'tenonMortise', id: 'tm-supp', pairId: 'p-supp', role: 'tenon',
      faceRole: 'Right', axis: 'v', position: 200, width: 100, depth: 15,
      count: 1, spacing: 0, fitClearance: 0,
    };
    const rSup = await runOne(tenon, ['tm-supp']);
    expect(volumeOf(rSup.finalSolid)).toBeCloseTo(volPlain, 0);
    disposeShape(rSup.finalSolid);

    // Control: unsuppressed, the tenon DOES grow the body.
    const rCtrl = await runOne(tenon);
    expect(volumeOf(rCtrl.finalSolid) - volPlain).toBeCloseTo(100 * 15 * 18, 0);
    disposeShape(rCtrl.finalSolid);
  }, 120_000);
});
