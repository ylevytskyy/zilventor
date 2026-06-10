/**
 * CATALOG-DRIVEN guard: minifix and dowel bores produced by generateMinifix() /
 * generateDowel() with REAL cabinet dims (including the L↔T side-panel swap)
 * actually cut valid voids in real OCCT.
 *
 * Anti-false-green: bore coordinates come from the REAL generators (not hand-authored).
 *
 * Cabinet fixture: 600×560×720mm, Tc=18mm board thickness.
 * Joint: leftSide ↔ bottom (same as confirmat guard).
 *   panelA = side panel AFTER L↔T swap: dims={length:18, width:560, thickness:720}, boardThicknessA=18.
 *   panelB = bottom panel: dims={length:564, width:554, thickness:18}, boardThicknessB=18.
 *   endB = 'Left', jointLen = 554mm → 3 bore positions at v∈{60,277,494}.
 *
 * Minifix bores on bottom panel (boresB, face='Left'):
 *   bolt: Ø8, depth = min(34,17)=17, u≈9, v∈{60,277,494}
 *   → volume drop per bore ≈ π×4²×17 ≈ 855mm³
 *
 * Dowel bores on bottom panel (boresB, face='Left'):
 *   end: Ø8, depth = min(13,17)=13, u≈9, v∈{60,277,494}
 *   → volume drop per bore ≈ π×4²×13 ≈ 654mm³
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import { generateMinifix, generateDowel, type JointInput, type BoringParams } from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { OcctShape } from '../../../occt/SolidOps';

// Cabinet constants matching confirmat guard fixture
const W_CAB = 600, D = 560, H = 720, Tc = 18, Tb = 6;
const BOTTOM_DIMS = { length: W_CAB - 2 * Tc, width: D - Tb, thickness: Tc }; // 564×554×18

const BORING_PARAMS: BoringParams = { endSetback: 60, maxSpacing: 250, minCount: 2 };

/** Same JointInput as the confirmat guard — leftSide↔bottom with swapped side dims. */
function realCabinetJoint(): JointInput {
  return {
    line: { p0: { x: Tc, y: Tb, z: Tc / 2 }, p1: { x: Tc, y: D, z: Tc / 2 } },
    panelA: {
      dims: { length: Tc, width: D, thickness: H }, // SWAPPED side panel
      pose: { translation: { x: Tc / 2, y: D / 2, z: H / 2 }, quaternion: [0, 0, 0, 1] },
    },
    panelB: {
      dims: BOTTOM_DIMS,
      pose: {
        translation: {
          x: Tc + BOTTOM_DIMS.length / 2,
          y: Tb + BOTTOM_DIMS.width / 2,
          z: BOTTOM_DIMS.thickness / 2,
        },
        quaternion: [0, 0, 0, 1],
      },
    },
    faceA: 'Right',
    endB: 'Left',
    boardThicknessA: Tc,
    boardThicknessB: Tc,
  };
}

describe('catalog-driven minifix/dowel bores — real OCCT volume drop (integration)', () => {
  let oc: any;

  beforeAll(async () => { oc = await loadOcct(); });

  function buildBottomPanel() {
    const { length: L, width: W, thickness: T } = BOTTOM_DIMS;
    const panel = buildPanelBox(oc, BOTTOM_DIMS);
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

  function boreHoleFeature(bore: { face: { featureId: string; role: string; instance: number }; u: number; v: number; diameter: number; depth: number | 'throughAll' }): any {
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

  const volBefore = BOTTOM_DIMS.length * BOTTOM_DIMS.width * BOTTOM_DIMS.thickness;

  // ── MINIFIX: generator outputs ──────────────────────────────────────────────

  it('MINIFIX: catalog-generated bolt depth positive and ≤ boardThicknessB=18', () => {
    const { boresB } = generateMinifix(realCabinetJoint(), BORING_PARAMS);
    const bolts = boresB.filter((b) => b.role === 'minifix-bolt');
    expect(bolts.length).toBe(3);
    for (const b of bolts) {
      expect(typeof b.depth).toBe('number');
      expect(b.depth as number).toBeGreaterThan(0);
      expect(b.depth as number).toBeLessThanOrEqual(Tc);
    }
  });

  it('MINIFIX: catalog-generated bolt u≈9 (thickness-centerline) and v∈{60,277,494}', () => {
    const { boresB } = generateMinifix(realCabinetJoint(), BORING_PARAMS);
    const bolts = boresB.filter((b) => b.role === 'minifix-bolt');
    const expectedSpacings = [60, 277, 494];
    const vs = bolts.map((b) => b.v).sort((a, b) => a - b);
    expect(vs).toHaveLength(3);
    for (let i = 0; i < 3; i++) expect(vs[i]).toBeCloseTo(expectedSpacings[i]!, 1);
    for (const b of bolts) {
      expect(b.u).toBeGreaterThanOrEqual(0);
      expect(b.u).toBeLessThanOrEqual(Tc);
      expect(b.u).toBeCloseTo(Tc / 2, 1); // = 9
    }
  });

  it('MINIFIX: catalog-generated bolt bore cuts real void in bottom panel (volume drops)', () => {
    const { boresB } = generateMinifix(realCabinetJoint(), BORING_PARAMS);
    const bolt = boresB.find((b) => b.role === 'minifix-bolt' && (b.v as number) < 100);
    expect(bolt).toBeDefined();
    const depth = bolt!.depth as number;
    expect(depth).toBeGreaterThan(0);
    expect(depth).toBeLessThanOrEqual(Tc);

    const running = buildBottomPanel();
    const result = executeHoleFeature(oc, running, boreHoleFeature(bolt!), (p: any) => p.value, new Map());
    const volAfter = volumeOf(result.shape);
    const drop = volBefore - volAfter;

    // Expected: π × 4² × depth (r=4 for Ø8)
    const cylinderVol = Math.PI * 4 * 4 * depth;
    expect(drop).toBeGreaterThan(100);
    expect(drop).toBeGreaterThan(cylinderVol * 0.9);
    expect(drop).toBeLessThan(cylinderVol * 1.4);
  });

  it('MINIFIX: cam bore (face A) depth positive and ≤ boardThicknessA=18', () => {
    const { boresA } = generateMinifix(realCabinetJoint(), BORING_PARAMS);
    const cams = boresA.filter((b) => b.role === 'minifix-cam');
    expect(cams.length).toBe(3);
    for (const c of cams) {
      expect(typeof c.depth).toBe('number');
      expect(c.depth as number).toBeGreaterThan(0);
      expect(c.depth as number).toBeLessThanOrEqual(Tc);
    }
  });

  it('MINIFIX: cross bore (face A) depth positive and ≤ boardThicknessA=18', () => {
    const { boresA } = generateMinifix(realCabinetJoint(), BORING_PARAMS);
    const cross = boresA.filter((b) => b.role === 'minifix-cross');
    expect(cross.length).toBe(3);
    for (const c of cross) {
      expect(typeof c.depth).toBe('number');
      expect(c.depth as number).toBeGreaterThan(0);
      expect(c.depth as number).toBeLessThanOrEqual(Tc);
    }
  });

  // ── DOWEL: generator outputs ────────────────────────────────────────────────

  it('DOWEL: catalog-generated end-bore depth positive and ≤ boardThicknessB=18', () => {
    const { boresB } = generateDowel(realCabinetJoint(), BORING_PARAMS);
    expect(boresB.length).toBe(3);
    for (const b of boresB) {
      expect(typeof b.depth).toBe('number');
      expect(b.depth as number).toBeGreaterThan(0);
      expect(b.depth as number).toBeLessThanOrEqual(Tc);
    }
  });

  it('DOWEL: catalog-generated end-bore u≈9 (thickness-centerline) and v∈{60,277,494}', () => {
    const { boresB } = generateDowel(realCabinetJoint(), BORING_PARAMS);
    const expectedSpacings = [60, 277, 494];
    const vs = boresB.map((b) => b.v).sort((a, b) => a - b);
    expect(vs).toHaveLength(3);
    for (let i = 0; i < 3; i++) expect(vs[i]).toBeCloseTo(expectedSpacings[i]!, 1);
    for (const b of boresB) {
      expect(b.u).toBeGreaterThanOrEqual(0);
      expect(b.u).toBeLessThanOrEqual(Tc);
      expect(b.u).toBeCloseTo(Tc / 2, 1);
    }
  });

  it('DOWEL: catalog-generated end bore cuts real void in bottom panel (volume drops)', () => {
    const { boresB } = generateDowel(realCabinetJoint(), BORING_PARAMS);
    const bore = boresB.find((b) => b.v < 100);
    expect(bore).toBeDefined();
    const depth = bore!.depth as number;
    expect(depth).toBeGreaterThan(0);
    expect(depth).toBeLessThanOrEqual(Tc);

    const running = buildBottomPanel();
    const result = executeHoleFeature(oc, running, boreHoleFeature(bore!), (p: any) => p.value, new Map());
    const volAfter = volumeOf(result.shape);
    const drop = volBefore - volAfter;

    // Expected: π × 4² × depth (r=4 for Ø8)
    const cylinderVol = Math.PI * 4 * 4 * depth;
    expect(drop).toBeGreaterThan(100);
    expect(drop).toBeGreaterThan(cylinderVol * 0.9);
    expect(drop).toBeLessThan(cylinderVol * 1.4);
  });

  it('DOWEL: face bore (face A) depth=12 and ≤ boardThicknessA=18', () => {
    const { boresA } = generateDowel(realCabinetJoint(), BORING_PARAMS);
    expect(boresA.length).toBe(3);
    for (const b of boresA) {
      expect(b.depth).toBe(12);
      expect(b.depth as number).toBeLessThanOrEqual(Tc);
      expect(b.role).toBe('dowel-face');
    }
  });
});
