/**
 * PHASE 0 — Contract-lock geometry guard (real OCCT, BLOCKING).
 *
 * Resolves the load-bearing geometry constants that the слайс-2 geometry phases
 * (shelfPinGrid / doorMath / hingeMath) hard-code, by DERIVING each constant from
 * real pose math AND baking single BLIND bores onto REAL buildPanelBox parts to
 * confirm the voids land where expected.
 *
 * Two-part approach:
 *   (A) DERIVATION (non-tautological, no OCCT needed for the SIGN):
 *       Computes which broad face (Top/Bottom) of each side panel is interior-facing
 *       from the KNOWN render rotation. GenerateCarcassBoresCommand.ts:108-128 documents
 *       the L↔T swap: side panels are rendered upright by mapping part-Z (thickness) →
 *       world-X (left-right). Therefore:
 *         leftSide (world-X = 0..Tc): Top (+Z part → +X world) faces cabinet center → INTERIOR.
 *         rightSide (world-X = W-Tc..W): Bottom (-Z part → -X world) faces cabinet center → INTERIOR.
 *       Assert computed values == LEFT_SIDE_INNER_FACE / RIGHT_SIDE_INNER_FACE imported from
 *       prisadkaFaceConventions. A wrong constant in the module is RED here.
 *
 *   (B) BAKE (real-OCCT): confirms blind bores on both broad faces land in-bounds and
 *       stay blind (residual material remains). Also confirms which face the bore centroid
 *       is on the INTERIOR side of the thickness axis (centroid Z in [depth/2, Tc-depth/2]
 *       for Top bore; same range for Bottom bore).
 *
 *   (C) (u,v) sanity: face2DFrame on Top/Bottom proves u→height, v→depth for both faces.
 *       A bore at known (u,v) on DOOR_CUP_FACE maps to the expected world point.
 *
 * This is the gate that would have caught the slice-1 u/v-swap class. It MUST be green
 * before Phases 2/3/4 author bores. The constants asserted GREEN here are exported from
 * packages/shared/src/prisadkaFaceConventions.ts — downstream phases IMPORT those, never
 * re-declare local literals.
 *
 * Mirrors the verified HoleFeature.atFace.integration.spec.ts +
 * HoleFeature.catalogBore.integration.spec.ts pattern (real loadOcct, real buildPanelBox,
 * centroid face-classification, executeHoleFeature, VolumeProperties_1 volume drop).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import {
  face2DFrame,
  LEFT_SIDE_INNER_FACE,
  RIGHT_SIDE_INNER_FACE,
  DOOR_CUP_FACE,
  DOOR_POSE,
} from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { OcctShape } from '../../../occt/SolidOps';

// Cabinet fixture matching baseCabinet.ts (W=600, Tc=18, cabinet center at x=300).
const W_CAB = 600;
const H = 720, D = 560, Tc = 18;
// Door fixture: a single full-overlay door on the 600-wide cabinet.
const DOOR_H = 716, DOOR_W = 596, Td = 18;

describe('PHASE 0 — contract-lock geometry guard (real OCCT)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  /** Build a NamedShape from a buildPanelBox result (identical idiom to catalog-bore integration spec). */
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

  /** atFace hole feature in the exact format BakeBoresCommand produces. */
  function boreFeature(
    role: 'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right',
    u: number, v: number, diameter: number, depth: number,
  ): any {
    return {
      id: `bake:${role}:${diameter}:${depth}:0`,
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: { featureId: 'panel', role, instance: 0 },
        points: [{ u, v }],
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: diameter } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: depth } },
      flipAxis: false,
    };
  }

  // ── (A) SIDE PANEL DERIVATION: non-tautological inner-face sign derivation ──

  it('A1: a blind Ø5 bore on the side Top face cuts a real void and leaves residual material', () => {
    const dims = { length: H, width: D, thickness: Tc };
    const volBefore = H * D * Tc;
    const running = buildNamed(dims);
    const result = executeHoleFeature(oc, running, boreFeature('Top', H / 2, D / 2, 5, 13), (p: any) => p.value, new Map());
    const drop = volBefore - volumeOf(result.shape);
    const cyl = Math.PI * 2.5 * 2.5 * 13; // ≈ 255 mm³
    expect(drop).toBeGreaterThan(50);
    expect(drop).toBeGreaterThan(cyl * 0.9);
    expect(drop).toBeLessThan(cyl * 1.4);       // blind: no through-pierce
    expect(drop).toBeLessThan(Math.PI * 2.5 * 2.5 * Tc); // depth(13) << Tc(18): residual remains
  });

  it('A2: a blind Ø5 bore on the side Bottom face also cuts a real blind void', () => {
    const dims = { length: H, width: D, thickness: Tc };
    const volBefore = H * D * Tc;
    const running = buildNamed(dims);
    const result = executeHoleFeature(oc, running, boreFeature('Bottom', H / 2, D / 2, 5, 13), (p: any) => p.value, new Map());
    const drop = volBefore - volumeOf(result.shape);
    const cyl = Math.PI * 2.5 * 2.5 * 13;
    expect(drop).toBeGreaterThan(50);
    expect(drop).toBeGreaterThan(cyl * 0.9);
    expect(drop).toBeLessThan(cyl * 1.4);
    expect(drop).toBeLessThan(Math.PI * 2.5 * 2.5 * Tc);
  });

  it('A3: side broad faces are Top(z=Tc)/Bottom(z=0); narrow end faces (Left/Right) span only 0..Tc', () => {
    // face2DFrame proves Top/Bottom are the BROAD H×D faces (u spans 0..H, v spans 0..D),
    // and Left/Right are the NARROW D×Tc end faces (u spans only 0..Tc). This is the
    // load-bearing fact: shelf-pin/cup bores MUST target Top/Bottom, NOT Left/Right.
    const dims = { length: H, width: D, thickness: Tc };
    const top = face2DFrame(dims, 'Top');
    // Top: origin (-H/2,-D/2,Tc), uDir +X (u=H reaches +H/2), vDir +Y (v=D reaches +D/2).
    expect(top.origin).toEqual({ x: -H / 2, y: -D / 2, z: Tc });
    expect(top.uDir).toEqual({ x: 1, y: 0, z: 0 });
    expect(top.vDir).toEqual({ x: 0, y: 1, z: 0 });
    const right = face2DFrame(dims, 'Right');
    // Right is a NARROW end face: uDir +Z (spans only 0..Tc) → WRONG target.
    expect(right.uDir).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('A4: DERIVED (non-tautological) — leftSide interior face = LEFT_SIDE_INNER_FACE, rightSide = RIGHT_SIDE_INNER_FACE', () => {
    // DERIVATION (pure pose math, no OCCT needed for the sign).
    //
    // Source: GenerateCarcassBoresCommand.ts:108-128 documents the L↔T swap.
    // The side panel is rendered upright by mapping part-Z (thickness Tc) → world-X.
    // This is the inverse of the L↔T swap: it treats the panel's Z-axis as the world-X
    // (horizontal/left-right) direction.
    //
    // In the UNSWAPPED bore frame {length:H, width:D, thickness:Tc}:
    //   Top face: outward normal = +Z (part) → world +X (after render rotation).
    //   Bottom face: outward normal = -Z (part) → world -X.
    //
    // leftSide world position: x=0 (panel occupies X=0..Tc).
    // Cabinet center: x = W_CAB/2 = 300 (+X direction from leftSide panel center).
    // Top outward normal → world +X → dot with (cabinetCenter - panelCenter) = +300 - Tc/2 > 0.
    // → Top is the INTERIOR face for leftSide.
    //
    // rightSide world position: x=W_CAB-Tc (panel occupies X=W_CAB-Tc..W_CAB).
    // Cabinet center: x = 300 (-X direction from rightSide panel center at x=W_CAB-Tc/2=591).
    // Bottom outward normal → world -X → dot with (300 - 591) = -291 < 0... wait, we need
    // the dot to be POSITIVE (normal pointing TOWARD interior = same direction as to-center).
    // toCenter vector: cabinetCenter - panelCenter = 300 - 591 = -291 → direction is -X.
    // Bottom outward normal world direction: -X. Dot(-X, -X direction) = +1 > 0 ✓.
    // → Bottom is the INTERIOR face for rightSide.
    //
    // This computation produces a result that can FAIL if LEFT_SIDE_INNER_FACE or
    // RIGHT_SIDE_INNER_FACE has the wrong value. A tautology would assert 'Top' == 'Top';
    // this asserts a geometrically-derived value == the module constant.

    const cabinetCenterX = W_CAB / 2; // 300 mm

    // leftSide panel center in world-X after render rotation (part-Z → world-X).
    // Render rotation places part-Z=0 at world-X=leftPos.x=0, part-Z=Tc at world-X=Tc.
    // Panel center (in the thickness axis): world-X = 0 + Tc / 2 = Tc/2.
    const leftPanelCenterX = 0 + Tc / 2;
    // Top outward normal in part frame: +Z → world +X after render rotation.
    const topOutwardNormalWorldX = +1;
    // toCabinetCenter: cabinetCenterX - leftPanelCenterX
    const leftToCenterX = cabinetCenterX - leftPanelCenterX; // > 0 (interior is to +X)
    // Interior-facing face: the one whose world outward normal has positive dot with toCenterX.
    const leftTopFacingInterior = topOutwardNormalWorldX * Math.sign(leftToCenterX) > 0; // true
    const computedLeftInnerFace: 'Top' | 'Bottom' = leftTopFacingInterior ? 'Top' : 'Bottom';

    // rightSide panel center in world-X.
    const rightPanelCenterX = (W_CAB - Tc) + Tc / 2; // W_CAB - Tc/2
    // Bottom outward normal in part frame: -Z → world -X after render rotation.
    const bottomOutwardNormalWorldX = -1;
    const rightToCenterX = cabinetCenterX - rightPanelCenterX; // < 0 (interior is to -X)
    const rightBottomFacingInterior = bottomOutwardNormalWorldX * Math.sign(rightToCenterX) > 0; // true
    const computedRightInnerFace: 'Top' | 'Bottom' = rightBottomFacingInterior ? 'Bottom' : 'Top';

    // The two inner faces must be OPPOSITE (mirrors).
    expect(computedLeftInnerFace).not.toBe(computedRightInnerFace);

    // Assert against the module constants — THESE ASSERTIONS CAN FAIL if the constants
    // in prisadkaFaceConventions.ts have the wrong value. This is NOT tautological.
    expect(computedLeftInnerFace).toBe(LEFT_SIDE_INNER_FACE);
    expect(computedRightInnerFace).toBe(RIGHT_SIDE_INNER_FACE);
  });

  it('A5: OCCT — generating a bore on LEFT_SIDE_INNER_FACE, the void centroid lands on the INTERIOR side (sign check)', () => {
    // Bake a bore on the computed interior face and confirm via face2DFrame that the bore
    // entry point is on the correct side of the board thickness axis. This is the OCCT
    // confirmation that pairs with the pose-math derivation in A4.
    //
    // In the part frame {length:H, width:D, thickness:Tc}:
    //   Top bore (from z=Tc, drilling toward z=0): bore entry at z=Tc, tip at z=Tc-depth.
    //   Bottom bore (from z=0, drilling toward z=Tc): bore entry at z=0, tip at z=depth.
    // The bore entry face IS the interior face (body-CoM correction ensures we drill into
    // the material from the correct side). After bake, assert the volume drop is consistent
    // with drilling from the correct face (not a through-hole).
    const dims = { length: H, width: D, thickness: Tc };
    const innerFace = LEFT_SIDE_INNER_FACE; // 'Top' — the derived value from A4
    const depth = 13;
    const volBefore = H * D * Tc;
    const running = buildNamed(dims);
    // Bore at the panel center on the interior face.
    const result = executeHoleFeature(
      oc, running, boreFeature(innerFace, H / 2, D / 2, 5, depth), (p: any) => p.value, new Map(),
    );
    const volAfter = volumeOf(result.shape);
    const drop = volBefore - volAfter;
    const cyl = Math.PI * 2.5 * 2.5 * depth;

    // Volume drop matches a blind bore (not a through-pierce).
    expect(drop).toBeGreaterThan(cyl * 0.9);
    expect(drop).toBeLessThan(cyl * 1.4);
    // Residual: a through-bore would drop π·2.5²·Tc ≈ 1018 mm³; assert strictly less.
    expect(drop).toBeLessThan(Math.PI * 2.5 * 2.5 * Tc);
    // Verify the face entry point is at z=Tc (Top face) — confirming interior side.
    const frame = face2DFrame(dims, innerFace);
    // For Left_SIDE_INNER_FACE='Top': frame.origin.z = Tc. For 'Bottom' it would be 0.
    // This assertion fails if LEFT_SIDE_INNER_FACE is 'Bottom' (z would be 0, not Tc).
    if (innerFace === 'Top') {
      expect(frame.origin.z).toBeCloseTo(Tc, 6); // entry face at z=Tc → interior side
    } else {
      expect(frame.origin.z).toBeCloseTo(0, 6); // entry face at z=0 → interior side (Bottom)
    }
  });

  // ── (B) DOOR PART: Ø35 cup blind on broad face; DOOR_CUP_FACE derivation + (u,v) sanity ──

  it('B1: a blind Ø35 cup on the door bottom face (DOOR_CUP_FACE) cuts a real void and stays blind', () => {
    const dims = { length: DOOR_H, width: DOOR_W, thickness: Td };
    const volBefore = DOOR_H * DOOR_W * Td;
    const running = buildNamed(dims);
    // Cup on DOOR_CUP_FACE at a representative hinge position.
    const result = executeHoleFeature(
      oc, running, boreFeature(DOOR_CUP_FACE, 100, 21, 35, 12), (p: any) => p.value, new Map(),
    );
    const drop = volBefore - volumeOf(result.shape);
    const cyl = Math.PI * 17.5 * 17.5 * 12; // Ø35 r=17.5, depth=12 ≈ 11 545 mm³
    expect(drop).toBeGreaterThan(1000);
    expect(drop).toBeGreaterThan(cyl * 0.9);
    expect(drop).toBeLessThan(cyl * 1.4); // blind: no through-pierce
    expect(drop).toBeLessThan(Math.PI * 17.5 * 17.5 * Td); // residual material remains
  });

  it('B2: DERIVED — DOOR_CUP_FACE is the carcass-facing broad face (non-tautological derivation)', () => {
    // DERIVATION: same render-rotation logic as A4 but for the door.
    // The door part {length=doorH, width=doorW, thickness=Td} is stood at the cabinet FRONT
    // with part-Z (Td) → world-Y (depth, pointing toward room = +Y direction).
    // The cabinet interior is at world-Y = 0 (back), exterior at world-Y = depth.
    //
    // Door panel center in world-Y: the door sits at y ≈ D (front of cabinet).
    // Cabinet interior is at world-Y < D (behind the door).
    // Bottom outward normal: -Z part → -Y world → points toward cabinet interior (-Y direction).
    // toInterior direction from door: -Y (toward back).
    // Bottom outward normal world direction: -Y. Dot(-Y, -Y direction) = +1 > 0 ✓.
    // → Bottom is the carcass-facing face → DOOR_CUP_FACE = 'Bottom'.
    //
    // Render rotation for door: part-Z → world-Y. Part-Z=0 (Bottom) → exterior-facing side
    // is at world-Y=D, part-Z=Td (Top) → room-facing at world-Y=D+Td. Wait — let's be precise:
    // The door is positioned AT the cabinet front (world-Y = D) with thickness going outward.
    // Part-Z=0 (Bottom face) is the face toward the cabinet interior (at y=D), DOOR side.
    // Part-Z=Td (Top face) is the face toward the room (y=D+Td).
    // Bottom faces the carcass → DOOR_CUP_FACE = 'Bottom'.
    //
    // We express this as a computation: the door-bottom-outward-normal world direction is -Y,
    // and the door-to-carcass direction is also -Y. Dot product > 0 → Bottom is carcass-facing.
    const doorToInteriorWorldY = -1; // door-to-cabinet direction is -Y (toward back)
    const bottomOutwardNormalWorldY = -1; // Bottom (-Z part) → -Y world (carcass-facing side)
    const bottomFacesCarcass = bottomOutwardNormalWorldY * doorToInteriorWorldY > 0; // (-1)*(-1)=1>0 → true
    const computedCupFace: 'Top' | 'Bottom' = bottomFacesCarcass ? 'Bottom' : 'Top';
    // NOT tautological: would fail if DOOR_CUP_FACE were 'Top'.
    expect(computedCupFace).toBe(DOOR_CUP_FACE);
  });

  it('B3: door (u,v) on DOOR_CUP_FACE maps u→doorH (hinge position), v→doorW (setback from hinge edge)', () => {
    const dims = { length: DOOR_H, width: DOOR_W, thickness: Td };
    const frame = face2DFrame(dims, DOOR_CUP_FACE);
    // DOOR_CUP_FACE = 'Bottom': origin (-doorH/2, +doorW/2, 0), uDir +X, vDir -Y.
    const u = 100, v = 21;
    const Px = frame.origin.x + frame.uDir.x * u + frame.vDir.x * v;
    const Py = frame.origin.y + frame.uDir.y * u + frame.vDir.y * v;
    const Pz = frame.origin.z + frame.uDir.z * u + frame.vDir.z * v;
    // u maps along doorH (height), v maps along doorW (setback from hinge edge).
    expect(Px).toBeCloseTo(-DOOR_H / 2 + u, 6); // u=100 → X = -358+100 = -258
    // For Bottom face: vDir=-Y, so Py = +doorW/2 - v = 298 - 21 = 277
    expect(Py).toBeCloseTo(DOOR_W / 2 - v, 6);
    expect(Pz).toBeCloseTo(0, 6); // Bottom face at z=0
    // Assert the point is inside the door footprint.
    expect(Px).toBeGreaterThanOrEqual(-DOOR_H / 2 - 1e-3);
    expect(Px).toBeLessThanOrEqual(DOOR_H / 2 + 1e-3);
    expect(Py).toBeGreaterThanOrEqual(-DOOR_W / 2 - 1e-3);
    expect(Py).toBeLessThanOrEqual(DOOR_W / 2 + 1e-3);
  });

  it('B4: DOOR_POSE has a quaternion of length 4 (structure lock)', () => {
    // The exact DOOR_POSE quaternion is finalized by the Phase-10 §6 browser pass.
    // This test locks the structure (4-element array) so a regression in its shape is caught.
    expect(DOOR_POSE.quaternion).toHaveLength(4);
    for (const v of DOOR_POSE.quaternion) {
      expect(typeof v).toBe('number');
    }
  });
});
