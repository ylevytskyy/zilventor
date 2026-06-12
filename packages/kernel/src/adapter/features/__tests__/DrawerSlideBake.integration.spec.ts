/**
 * Chunk I — Ø5 drawer-slide bore volume guard (real OCCT).
 *
 * Anti-false-green: feeds the REAL drawerSlideMath() producer output (NOT hand-authored
 * u/v) into executeHoleFeature on REAL buildPanelBox panels, and asserts that a genuine
 * volume drop occurs on BOTH the cabinet side panel AND the box side panel.
 *
 * This is the ground-truth geometry proof that the D/E convention chain
 * (drawerBoxMath §14.2 side length=bh → u-axis=height; drawerSlideMath §14.4 rail
 * world-Z alignment) is correct end-to-end.  A wrong face-role, u/v swap, or
 * out-of-bounds coordinate will cause OCCT to skip or misplace the holes and the
 * volume-drop assertion will fail.
 *
 * Fixture (§14.2/§14.4):
 *   Cabinet: H=720, D=500, Tc=18  →  side panel native dims {length:720, width:500, thickness:18}
 *   Slot: drawerIndex=0, openBottomZ=100, slotH=200
 *     → bh = 200 - 2×12 = 176, bd = 500 - 10 = 490
 *   slideWorldZ = 100 + 0×200 + 12 + 88 = 200
 *     → uCabinet = 200 (in [0,720] ✓)
 *     → uBox     = bh/2 = 88 (in [0,176] ✓)
 *   slideLength=100 → holeCount = max(2, floor((100−37)/32)+1) = 2
 *     → v positions [37, 69] (in [0,500] ✓ and [0,490] ✓)
 *
 * Expected volume drop per bore: π × 2.5² × 12 ≈ 235.6 mm³.
 * Tolerance: ±15% (OCCT drill-tip minor deviation).
 *
 * BakeBoresCommand code path: all bores sharing (face.role|Ø|depth) → ONE grouped
 * HoleFeature with points[] = all (u,v) pairs → ONE executeHoleFeature call.
 * That is the exact path tested here (mirrors system32-grouped guard).
 *
 * INNER_FACE constants imported from prisadkaFaceConventions — NOT local literals.
 * C-1 confirmed: BakeBoresCommand is generic; drawerSlide needs no separate catalog entry.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import {
  drawerSlideMath,
  DRAWER_SLIDE_HOLE_DIAMETER,
  DRAWER_SLIDE_HOLE_DEPTH,
  BOX_VERT_CLEARANCE,
  BOX_BACK_CLEARANCE,
  LEFT_SIDE_INNER_FACE,
  RIGHT_SIDE_INNER_FACE,
} from '@zilventor/shared';
import type { BoreOp, HoleFeature } from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { OcctShape } from '../../../occt/SolidOps';

// ── Cabinet fixture ──────────────────────────────────────────────────────────
const H = 720;   // cabinet height mm
const D = 500;   // cabinet depth mm
const Tc = 18;   // cabinet side thickness mm
const CABINET_SIDE_DIMS = { length: H, width: D, thickness: Tc };

// ── Drawer slot ──────────────────────────────────────────────────────────────
const DRAWER_INDEX = 0;
const OPEN_BOTTOM_Z = 100;
const SLOT_H = 200;
const bh = SLOT_H - 2 * BOX_VERT_CLEARANCE;          // 176 mm
const bd = D - BOX_BACK_CLEARANCE;                    // 490 mm
const BOX_T = 16; // BOX_PANEL_THICKNESS from drawerConventions
const BOX_SIDE_DIMS = { length: bh, width: bd, thickness: BOX_T };

// Independent oracle (§14.4 third constant):
// slideWorldZ = openBottomZ + i·slotH + BOX_VERT_CLEARANCE + bh/2
const SLIDE_WORLD_Z = OPEN_BOTTOM_Z + DRAWER_INDEX * SLOT_H + BOX_VERT_CLEARANCE + bh / 2;
// = 100 + 0 + 12 + 88 = 200

// Expected volume drop per bore: π × r² × depth, r=DRAWER_SLIDE_HOLE_DIAMETER/2
const HOLE_RADIUS = DRAWER_SLIDE_HOLE_DIAMETER / 2; // 2.5 mm
const CYL_VOL = Math.PI * HOLE_RADIUS * HOLE_RADIUS * DRAWER_SLIDE_HOLE_DEPTH; // ≈ 235.6 mm³

describe('Chunk I — Ø5 drawer-slide bore volume guard (real OCCT)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Build a named panel box matching the face-naming scheme used by all
   * HoleFeature integration tests (centroid-based role assignment).
   */
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
      if (Math.abs(z - T) < 0.5)   role = 'Top';
      else if (Math.abs(z) < 0.5)   role = 'Bottom';
      else if (Math.abs(y - hW) < 0.5) role = 'Front';
      else if (Math.abs(y + hW) < 0.5) role = 'Back';
      else if (Math.abs(x + hL) < 0.5) role = 'Left';
      else                           role = 'Right';
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

  /**
   * Build the GROUPED HoleFeature exactly as BakeBoresCommand does:
   * all bores sharing (face.role|Ø|depth) → ONE feature with points[].
   * (Plan C-1: BakeBoresCommand is GENERIC; no separate drawerSlide catalog entry needed.)
   */
  function groupedHoleFeature(bores: ReadonlyArray<BoreOp>): HoleFeature {
    const first = bores[0]!;
    return {
      id: `bake:${first.face.role}:${first.diameter}:${first.depth}`,
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: first.face,
        points: bores.map((b) => ({ u: b.u, v: b.v })),
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: first.diameter } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: first.depth as number } },
      flipAxis: false,
    };
  }

  // ── Drawer slide math contract assertions ──────────────────────────────────

  it('drawerSlideMath emits ≥2 cabinet bores and ≥2 box bores per side (Ø5, depth 12)', () => {
    // ANTI-FALSE-GREEN: call the REAL producer, not hand-authored bores.
    const { cabinetBores, boxBores } = drawerSlideMath({
      drawerIndex: DRAWER_INDEX,
      openBottomZ: OPEN_BOTTOM_Z,
      slotH: SLOT_H,
      bh,
      cabinet: { H, D, Tc },
      box: { bd },
      slideLength: 100, // short slide → exactly 2 holes per side
    });

    // Each side (Left + Right) gets bores.
    const leftCab = cabinetBores.filter((b) => b.face.role === LEFT_SIDE_INNER_FACE);
    const rightCab = cabinetBores.filter((b) => b.face.role === RIGHT_SIDE_INNER_FACE);
    expect(leftCab.length).toBeGreaterThanOrEqual(2);
    expect(rightCab.length).toBeGreaterThanOrEqual(2);
    expect(rightCab.length).toBe(leftCab.length); // symmetric

    const leftBox = boxBores.filter((b) => b.face.role === LEFT_SIDE_INNER_FACE);
    const rightBox = boxBores.filter((b) => b.face.role === RIGHT_SIDE_INNER_FACE);
    expect(leftBox.length).toBe(leftCab.length);   // cabinet + box have same count per side
    expect(rightBox.length).toBe(rightCab.length);

    // All diameters and depths match the named constants.
    for (const b of [...cabinetBores, ...boxBores]) {
      expect(b.diameter).toBe(DRAWER_SLIDE_HOLE_DIAMETER); // 5
      expect(b.depth).toBe(DRAWER_SLIDE_HOLE_DEPTH);       // 12
      expect(b.connectorKind).toBe('drawerSlide');
    }
  });

  it('cabinet bores: uCabinet matches independent rail world-Z oracle', () => {
    // ANTI-FALSE-GREEN (§14.4 / C-7): assert against a THIRD CONSTANT derived
    // from first principles, NOT against the box bore or the producer's comment.
    //
    // Cabinet side panel: {length:H, width:D, thickness:Tc}
    // face2DFrame('Top'): origin=(-H/2,-D/2,Tc), uDir=(1,0,0)
    // For a bore at (u_local, v_local): world point = (-H/2+u_local, -D/2+v_local, Tc)
    // The panel's length-axis (H) maps to world height.
    // Cabinet bottom is at world-Z=0; panel's u=0 → H-bottom; u=H → H-top.
    // Therefore uCabinet = slideWorldZ — the rail's world-Z height coordinate.
    const { cabinetBores } = drawerSlideMath({
      drawerIndex: DRAWER_INDEX,
      openBottomZ: OPEN_BOTTOM_Z,
      slotH: SLOT_H,
      bh,
      cabinet: { H, D, Tc },
      box: { bd },
      slideLength: 100,
    });
    const leftBores = cabinetBores.filter((b) => b.face.role === LEFT_SIDE_INNER_FACE);
    expect(leftBores.length).toBeGreaterThan(0);
    for (const b of leftBores) {
      expect(b.u).toBeCloseTo(SLIDE_WORLD_Z, 6); // 200
    }
    // Right side mirrors the same u (height doesn't change with side).
    const rightBores = cabinetBores.filter((b) => b.face.role === RIGHT_SIDE_INNER_FACE);
    for (const b of rightBores) {
      expect(b.u).toBeCloseTo(SLIDE_WORLD_Z, 6);
    }
  });

  it('box bores: uBox = bh/2 (rail at box mid-height, independently derived)', () => {
    // ANTI-FALSE-GREEN (C-7): independent oracle for box side.
    // Box side panel: {length:bh, width:bd, thickness:BOX_T}
    // face2DFrame('Top'): uDir along length=bh; u=bh/2 = box mid-height.
    // Box bottom is at world-Z = OPEN_BOTTOM_Z + i·slotH + BOX_VERT_CLEARANCE.
    // slideWorldZ (world space) = boxOriginZ + uBox
    //   → uBox = slideWorldZ - boxOriginZ = (OPEN_BOTTOM_Z + i·slotH + BOX_VERT_CLEARANCE + bh/2)
    //                                     - (OPEN_BOTTOM_Z + i·slotH + BOX_VERT_CLEARANCE)
    //                                     = bh/2.
    const U_BOX_EXPECTED = bh / 2; // 88 mm (independent third constant)

    const { boxBores } = drawerSlideMath({
      drawerIndex: DRAWER_INDEX,
      openBottomZ: OPEN_BOTTOM_Z,
      slotH: SLOT_H,
      bh,
      cabinet: { H, D, Tc },
      box: { bd },
      slideLength: 100,
    });
    const leftBox = boxBores.filter((b) => b.face.role === LEFT_SIDE_INNER_FACE);
    expect(leftBox.length).toBeGreaterThan(0);
    for (const b of leftBox) {
      expect(b.u).toBeCloseTo(U_BOX_EXPECTED, 6);
    }
    const rightBox = boxBores.filter((b) => b.face.role === RIGHT_SIDE_INNER_FACE);
    for (const b of rightBox) {
      expect(b.u).toBeCloseTo(U_BOX_EXPECTED, 6);
    }
  });

  // ── Real OCCT volume-drop tests ────────────────────────────────────────────

  it('OCCT cabinet-side LEFT (Top face): drawerSlideMath bores drop ≈ N×π·r²·12 mm³', () => {
    // ANTI-FALSE-GREEN: REAL drawerSlideMath() output baked on a REAL buildPanelBox solid.
    const { cabinetBores } = drawerSlideMath({
      drawerIndex: DRAWER_INDEX,
      openBottomZ: OPEN_BOTTOM_Z,
      slotH: SLOT_H,
      bh,
      cabinet: { H, D, Tc },
      box: { bd },
      slideLength: 100,
    });

    // Extract LEFT side (Top face) bores only.
    const leftBores = cabinetBores.filter((b) => b.face.role === LEFT_SIDE_INNER_FACE);
    const N = leftBores.length;
    expect(N).toBeGreaterThanOrEqual(2); // sanity: ≥2 holes produced by the generator

    // All bores in this group share the same (face.role, diameter, depth) — one grouped feature.
    const allSameGroup = leftBores.every(
      (b) => b.face.role === leftBores[0]!.face.role
           && b.diameter === leftBores[0]!.diameter
           && b.depth === leftBores[0]!.depth,
    );
    expect(allSameGroup).toBe(true);

    const volBefore = H * D * Tc; // exact box volume = 720×500×18 = 6 480 000 mm³
    const running = buildNamed(CABINET_SIDE_DIMS);

    // ONE grouped executeHoleFeature call — the EXACT BakeBoresCommand code path.
    const feature = groupedHoleFeature(leftBores);
    const result = executeHoleFeature(oc, running, feature, (param: any) => param.value, new Map());

    const volAfter = volumeOf(result.shape);
    const drop = volBefore - volAfter;

    // Expected: N × π × r² × depth
    const expectedDrop = N * CYL_VOL;

    // ANTI-FALSE-GREEN: ±15% band — a wrong-face bore would miss the face entirely
    // (OCCT error or zero drop) or pierce through (drop >> expected).
    expect(drop).toBeGreaterThan(0);                        // sanity: bore cut something
    expect(drop).toBeGreaterThan(expectedDrop * 0.85);
    expect(drop).toBeLessThan(expectedDrop * 1.15);
    // BLIND: depth(12) < thickness(18) → residual material remains
    expect(drop).toBeLessThan(N * Math.PI * HOLE_RADIUS * HOLE_RADIUS * Tc);

    console.log(
      `[cab-left] N=${N}, expected=${expectedDrop.toFixed(1)} mm³, ` +
      `measured=${drop.toFixed(1)} mm³, ratio=${(drop / expectedDrop).toFixed(3)}, ` +
      `uCabinet=${leftBores[0]!.u.toFixed(1)} (oracle=${SLIDE_WORLD_Z})`
    );
  });

  it('OCCT cabinet-side RIGHT (Bottom face): drawerSlideMath bores drop ≈ N×π·r²·12 mm³', () => {
    const { cabinetBores } = drawerSlideMath({
      drawerIndex: DRAWER_INDEX,
      openBottomZ: OPEN_BOTTOM_Z,
      slotH: SLOT_H,
      bh,
      cabinet: { H, D, Tc },
      box: { bd },
      slideLength: 100,
    });

    const rightBores = cabinetBores.filter((b) => b.face.role === RIGHT_SIDE_INNER_FACE);
    const N = rightBores.length;
    expect(N).toBeGreaterThanOrEqual(2);

    const volBefore = H * D * Tc;
    const running = buildNamed(CABINET_SIDE_DIMS);

    const feature = groupedHoleFeature(rightBores);
    const result = executeHoleFeature(oc, running, feature, (param: any) => param.value, new Map());

    const volAfter = volumeOf(result.shape);
    const drop = volBefore - volAfter;
    const expectedDrop = N * CYL_VOL;

    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeGreaterThan(expectedDrop * 0.85);
    expect(drop).toBeLessThan(expectedDrop * 1.15);
    expect(drop).toBeLessThan(N * Math.PI * HOLE_RADIUS * HOLE_RADIUS * Tc);

    console.log(
      `[cab-right] N=${N}, expected=${expectedDrop.toFixed(1)} mm³, ` +
      `measured=${drop.toFixed(1)} mm³, ratio=${(drop / expectedDrop).toFixed(3)}, ` +
      `uCabinet=${rightBores[0]!.u.toFixed(1)} (oracle=${SLIDE_WORLD_Z})`
    );
  });

  it('OCCT box-side LEFT (Top face): drawerSlideMath bores drop ≈ N×π·r²·12 mm³', () => {
    const { boxBores } = drawerSlideMath({
      drawerIndex: DRAWER_INDEX,
      openBottomZ: OPEN_BOTTOM_Z,
      slotH: SLOT_H,
      bh,
      cabinet: { H, D, Tc },
      box: { bd },
      slideLength: 100,
    });

    const leftBores = boxBores.filter((b) => b.face.role === LEFT_SIDE_INNER_FACE);
    const N = leftBores.length;
    expect(N).toBeGreaterThanOrEqual(2);

    const allSameGroup = leftBores.every(
      (b) => b.face.role === leftBores[0]!.face.role
           && b.diameter === leftBores[0]!.diameter
           && b.depth === leftBores[0]!.depth,
    );
    expect(allSameGroup).toBe(true);

    // Box side panel: {length:bh=176, width:bd=490, thickness:BOX_T=16}
    const volBefore = bh * bd * BOX_T; // 176×490×16 = 1 379 840 mm³

    const running = buildNamed(BOX_SIDE_DIMS);

    const feature = groupedHoleFeature(leftBores);
    const result = executeHoleFeature(oc, running, feature, (param: any) => param.value, new Map());

    const volAfter = volumeOf(result.shape);
    const drop = volBefore - volAfter;
    const expectedDrop = N * CYL_VOL;

    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeGreaterThan(expectedDrop * 0.85);
    expect(drop).toBeLessThan(expectedDrop * 1.15);
    // BLIND: depth(12) < box thickness(16) → residual material remains
    expect(drop).toBeLessThan(N * Math.PI * HOLE_RADIUS * HOLE_RADIUS * BOX_T);

    console.log(
      `[box-left] N=${N}, expected=${expectedDrop.toFixed(1)} mm³, ` +
      `measured=${drop.toFixed(1)} mm³, ratio=${(drop / expectedDrop).toFixed(3)}, ` +
      `uBox=${leftBores[0]!.u.toFixed(1)} (oracle=${bh / 2})`
    );
  });

  it('OCCT box-side RIGHT (Bottom face): drawerSlideMath bores drop ≈ N×π·r²·12 mm³', () => {
    const { boxBores } = drawerSlideMath({
      drawerIndex: DRAWER_INDEX,
      openBottomZ: OPEN_BOTTOM_Z,
      slotH: SLOT_H,
      bh,
      cabinet: { H, D, Tc },
      box: { bd },
      slideLength: 100,
    });

    const rightBores = boxBores.filter((b) => b.face.role === RIGHT_SIDE_INNER_FACE);
    const N = rightBores.length;
    expect(N).toBeGreaterThanOrEqual(2);

    const volBefore = bh * bd * BOX_T;
    const running = buildNamed(BOX_SIDE_DIMS);

    const feature = groupedHoleFeature(rightBores);
    const result = executeHoleFeature(oc, running, feature, (param: any) => param.value, new Map());

    const volAfter = volumeOf(result.shape);
    const drop = volBefore - volAfter;
    const expectedDrop = N * CYL_VOL;

    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeGreaterThan(expectedDrop * 0.85);
    expect(drop).toBeLessThan(expectedDrop * 1.15);
    expect(drop).toBeLessThan(N * Math.PI * HOLE_RADIUS * HOLE_RADIUS * BOX_T);

    console.log(
      `[box-right] N=${N}, expected=${expectedDrop.toFixed(1)} mm³, ` +
      `measured=${drop.toFixed(1)} mm³, ratio=${(drop / expectedDrop).toFixed(3)}, ` +
      `uBox=${rightBores[0]!.u.toFixed(1)} (oracle=${bh / 2})`
    );
  });
});
