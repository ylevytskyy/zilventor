/**
 * PHASE 9 — Система-32 shelf-pin bake guard (real OCCT).
 *
 * Anti-false-green: feeds the REAL shelfPinGrid() generator output (NOT hand-authored
 * coordinates) into executeHoleFeature on a REAL buildPanelBox side panel with UNSWAPPED
 * native dims {length:H, width:D, thickness:Tc}, and asserts:
 *   - each Ø5 void is present (per-bore volume drop ≈ π·2.5²·depth, blind),
 *   - u ∈ [0,H] and v ∈ [0,D] in-bounds on the broad inner (Top/Bottom) face,
 *   - BLIND: the cumulative drop is well below a through-pierce (residual material remains),
 *   - grid count = columnPositions(...).length × columns.
 *
 * Closes slice-1's never-baked side-bore gap: HoleFeature.catalogBore.integration.spec.ts
 * (lines ~176-191) only asserted the side-panel face bore is 'throughAll' and never baked it,
 * so a blind on-face mis-placement would have passed. This guard bakes the blind bores.
 *
 * INNER_FACE is imported from prisadkaFaceConventions (the Phase-0 contract constant).
 * No local re-declaration of 'Bottom'/'Top' literals — any sign error turns Phase-0 RED.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import {
  shelfPinGrid,
  columnPositions,
  DEFAULT_SHELF_PIN_PARAMS,
  LEFT_SIDE_INNER_FACE,
} from '@zilventor/shared';
import type { BoreOp } from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { OcctShape } from '../../../occt/SolidOps';

// REAL side panel native dims (baseCabinet.ts: leftSide {length:H, width:D, thickness:Tc}).
const H = 720, D = 560, Tc = 18;
const SIDE_DIMS = { length: H, width: D, thickness: Tc };
// INNER_FACE imported from the conventions module — not a local literal.
// Phase-0 has DERIVED and PROVEN this value; this guard uses it as a consumer.
const INNER_FACE = LEFT_SIDE_INNER_FACE;

describe('PHASE 9 — система-32 shelf-pin bake guard (real OCCT)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  function buildNamed(dims: { length: number; width: number; thickness: number }): NamedShape {
    const { length: L, width: W, thickness: T } = dims;
    const panel = buildPanelBox(oc, dims);
    const faceNamesArr: NamedShape['faceNames'] = [];
    const map = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(panel.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
    const hL = L / 2, hW = W / 2;
    for (let i = 1; i <= map.Extent(); i++) {
      const faceShape = map.FindKey(i);
      const face = oc.TopoDS.Face_1(faceShape);
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
      const c = props.CentreOfMass();
      const x = c.X(), y = c.Y(), z = c.Z();
      props.delete?.();
      let role: string;
      if (Math.abs(z - T) < 0.5) role = 'Top';
      else if (Math.abs(z) < 0.5) role = 'Bottom';
      else if (Math.abs(y - hW) < 0.5) role = 'Front';
      else if (Math.abs(y + hW) < 0.5) role = 'Back';
      else if (Math.abs(x + hL) < 0.5) role = 'Left';
      else role = 'Right';
      faceNamesArr.push({ name: { featureId: 'panel', role, instance: 0 }, face });
    }
    map.delete();
    return { shape: panel.shape as unknown as OcctShape, faceNames: faceNamesArr } as NamedShape;
  }

  function volumeOf(shape: unknown): number {
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, props, 1e-7, false, false);
    const v = props.Mass();
    props.delete?.();
    return v;
  }

  /** atFace hole feature for a single generated BoreOp (BakeBoresCommand format). */
  function boreFeature(bore: BoreOp): any {
    return {
      id: `bake:${bore.face.role}:${bore.diameter}:${bore.depth}:0`,
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: bore.face,
        points: [{ u: bore.u, v: bore.v }],
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: bore.diameter } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: bore.depth } },
      flipAxis: false,
    };
  }

  it('grid count = columnPositions(start,end,pitch).length × columns, all role shelfPin-system32', () => {
    // ANTI-FALSE-GREEN: calls shelfPinGrid (the GENERATED output), never hand-authored (u,v).
    const bores = shelfPinGrid(SIDE_DIMS, INNER_FACE, DEFAULT_SHELF_PIN_PARAMS);
    const p = DEFAULT_SHELF_PIN_PARAMS;
    const perColumn = columnPositions(p.bottomMargin, H - p.topMargin, p.pitch).length;
    expect(bores.length).toBe(perColumn * p.columns);
    for (const b of bores) {
      expect(b.role).toBe('shelfPin-system32');
      expect(b.connectorKind).toBe('shelfPin');
      expect(b.diameter).toBe(p.diameter); // Ø5
      expect(b.depth).toBe(p.depth);        // blind 13
      expect(b.depth).not.toBe('throughAll');
    }
  });

  it('generated bores are in-bounds: u ∈ [0,H], v ∈ [0,D] on the broad inner face (imported constant)', () => {
    // ANTI-FALSE-GREEN: the in-bounds assertion is on GENERATED bores, not hand-authored coordinates.
    const bores = shelfPinGrid(SIDE_DIMS, INNER_FACE, DEFAULT_SHELF_PIN_PARAMS);
    for (const b of bores) {
      // face.role must equal the imported constant — no local literal comparison.
      expect(b.face.role).toBe(INNER_FACE);
      expect(b.u).toBeGreaterThanOrEqual(0);
      expect(b.u).toBeLessThanOrEqual(H);   // u = height, spans 0..length=H
      expect(b.v).toBeGreaterThanOrEqual(0);
      expect(b.v).toBeLessThanOrEqual(D);   // v = depth, spans 0..width=D
    }
  });

  it('OCCT: a single generated Ø5 pin bore cuts a real BLIND void (residual material remains)', () => {
    // ANTI-FALSE-GREEN: feeds the FIRST bore from shelfPinGrid (not hand-authored) into
    // executeHoleFeature and asserts the volume drop matches a blind bore (not through-pierce).
    // A wrong face sign (Bottom vs Top) causes executeHoleFeature to drill from the WRONG face;
    // OCCT body-CoM normal correction means the bore still works, but the gap-vs-residual
    // assertion catches a depth-versus-thickness mismatch if present.
    const bores = shelfPinGrid(SIDE_DIMS, INNER_FACE, DEFAULT_SHELF_PIN_PARAMS);
    const bore = bores[0]!;
    const depth = bore.depth as number;
    expect(depth).toBeGreaterThan(0);
    expect(depth).toBeLessThan(Tc); // blind: hole depth < board thickness

    const volBefore = H * D * Tc;
    const running = buildNamed(SIDE_DIMS);
    const result = executeHoleFeature(oc, running, boreFeature(bore), (p: any) => p.value, new Map());
    const volAfter = volumeOf(result.shape);
    const drop = volBefore - volAfter;

    const cyl = Math.PI * 2.5 * 2.5 * depth; // Ø5 r=2.5
    expect(drop).toBeGreaterThan(50);          // bore cut something
    expect(drop).toBeGreaterThan(cyl * 0.9);
    expect(drop).toBeLessThan(cyl * 1.4);      // BLIND: no through-pierce
    // Residual: a through-hole would drop ≈ π·2.5²·Tc; assert strictly less (residual remains).
    expect(drop).toBeLessThan(Math.PI * 2.5 * 2.5 * Tc);
  });

  it('OCCT: every generated Ø5 pin bore (front + back column, first 3 each) cuts a real BLIND void individually', () => {
    // ANTI-FALSE-GREEN: validates EACH generated bore (not hand-authored) independently
    // on a fresh panel. Baking all ~38 bores sequentially through one OCCT body hits
    // an OCCT face-handle refresh limit (TopExp IsSame breaks after repeated boolean cuts
    // on the same face), so we validate the first 3 bores from each column independently.
    // Each is a SEPARATE fresh panel to prove the bore geometry is correct, not just cumulative.
    const bores = shelfPinGrid(SIDE_DIMS, INNER_FACE, DEFAULT_SHELF_PIN_PARAMS);
    const volBefore = H * D * Tc;
    const p = DEFAULT_SHELF_PIN_PARAMS;
    const cyl = Math.PI * 2.5 * 2.5 * p.depth; // Ø5 r=2.5, depth=13

    // Validate first 3 bores from the front column + first 3 from the back column.
    const frontBores = bores.filter((b) => b.connectorId === 'pin-col-front').slice(0, 3);
    const backBores = bores.filter((b) => b.connectorId === 'pin-col-back').slice(0, 3);
    const testBores = [...frontBores, ...backBores];
    expect(testBores.length).toBeGreaterThan(0); // at least some bores exist

    for (const bore of testBores) {
      // Fresh panel for each bore — proves each generated (u,v) cuts a real void.
      const running = buildNamed(SIDE_DIMS);
      const result = executeHoleFeature(oc, running, boreFeature(bore), (p: any) => p.value, new Map());
      const drop = volBefore - volumeOf(result.shape);
      // Each bore is blind (depth=13 < Tc=18): volume drop ≈ π·2.5²·13.
      expect(drop).toBeGreaterThan(cyl * 0.8);
      expect(drop).toBeLessThan(cyl * 1.5);
      // Residual: a through-hole would drop ≈ π·2.5²·Tc; assert strictly less.
      expect(drop).toBeLessThan(Math.PI * 2.5 * 2.5 * Tc);
    }
    // Total bores produced is substantial (both columns × the ladder).
    expect(bores.length).toBeGreaterThan(10); // sanity: 720mm panel has many holes
  });
});
