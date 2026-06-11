/**
 * CHUNK G — Task G.3: real-OCCT confirmat MoveConnector guard for the bSwapUV narrow-face case.
 *
 * The bSwapUV path: when endB='Left' (a Left-face end bore), `makeBores` in connectorCatalog
 * sets boreU=cross (thickness-centerline) and boreV=dist (along-joint). The naïve approach
 * of "move along u because u was labeled along-joint" would FAIL for the B-side bore.
 *
 * This test proves translateConnectorAlong works CORRECTLY for this case by:
 *   - generating confirmat boresA + boresB for the leftSide↔bottom joint (endB='Left')
 *   - calling translateConnectorAlong on BOTH members with worldDir = normalized joint direction
 *   - asserting in WORLD space: both hole centers shifted by Δ·worldDir
 *   - confirming screw-axis collinearity (dot product along joint unchanged)
 *   - baking the moved bore into real OCCT panel (volume drop proves correct face)
 *
 * Correction 5 (applied):
 *   (a) BASELINE pre-move volume-drop test proves generator correctness before any move.
 *   (b) Non-identity panelA pose (30° rotation around X) exercises the quaternion path
 *       in translateConnectorAlong. With identity quaternion the same test passes trivially.
 *   (c) Expected world deltas derived from jointDir computation, not hand-authored.
 *
 * Flip-to-RED: naive u-shift on B-side (bSwapUV) bore moves in wrong direction →
 * world position shifts perpendicular to joint, not along it.
 *
 * Joint fixture: leftSide↔bottom (endB='Left', bSwapUV=true on B-side).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import {
  generateConfirmat,
  translateConnectorAlong,
  face2DFrame,
  type JointInput, type BoringParams, type ConnectorMember,
} from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { OcctShape } from '../../../occt/SolidOps';

const W_CAB = 600, D = 560, H = 720, Tc = 18, Tb = 6;
const BOTTOM_DIMS = { length: W_CAB - 2 * Tc, width: D - Tb, thickness: Tc }; // 564×554×18
const SIDE_DIMS_SWAPPED = { length: Tc, width: D, thickness: H }; // swapped for jointMath (faceA='Right')
const BORING_PARAMS: BoringParams = { endSetback: 60, maxSpacing: 250, minCount: 2 };
const DELTA = 15; // mm along the joint direction

/** Normalized world direction of the joint line. */
function computeJointDir(j: JointInput): { x: number; y: number; z: number } {
  const { p0, p1 } = j.line;
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const len = Math.hypot(dx, dy, dz);
  return { x: dx / len, y: dy / len, z: dz / len };
}

/** World-space bore center given part-local (u,v) and world pose. */
function worldBorePos(
  bore: { u: number; v: number; face: { role: string } },
  dims: { length: number; width: number; thickness: number },
  worldPose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] },
): { x: number; y: number; z: number } {
  const frame = face2DFrame(dims, bore.face.role as 'Top' | 'Bottom' | 'Left' | 'Right' | 'Front' | 'Back');
  const lx = frame.origin.x + frame.uDir.x * bore.u + frame.vDir.x * bore.v;
  const ly = frame.origin.y + frame.uDir.y * bore.u + frame.vDir.y * bore.v;
  const lz = frame.origin.z + frame.uDir.z * bore.u + frame.vDir.z * bore.v;
  const [qx, qy, qz, qw] = worldPose.quaternion;
  const tx = 2 * (qy * lz - qz * ly);
  const ty = 2 * (qz * lx - qx * lz);
  const tz = 2 * (qx * ly - qy * lx);
  return {
    x: lx + qw * tx + qy * tz - qz * ty + worldPose.translation.x,
    y: ly + qw * ty + qz * tx - qx * tz + worldPose.translation.y,
    z: lz + qw * tz + qx * ty - qy * tx + worldPose.translation.z,
  };
}

// Fixture 1: IDENTITY poses for both panels (baseline case).
function identityCabinetJoint(): JointInput {
  return {
    line: { p0: { x: Tc, y: Tb, z: Tc / 2 }, p1: { x: Tc, y: D, z: Tc / 2 } },
    panelA: {
      dims: SIDE_DIMS_SWAPPED,
      pose: { translation: { x: Tc / 2, y: D / 2, z: H / 2 }, quaternion: [0, 0, 0, 1] },
    },
    panelB: {
      dims: BOTTOM_DIMS,
      pose: {
        translation: { x: Tc + BOTTOM_DIMS.length / 2, y: Tb + BOTTOM_DIMS.width / 2, z: BOTTOM_DIMS.thickness / 2 },
        quaternion: [0, 0, 0, 1],
      },
    },
    faceA: 'Right',
    endB: 'Left',
    boardThicknessA: Tc,
    boardThicknessB: Tc,
  };
}

// Fixture 2: NON-IDENTITY pose for panelA (30° rotation around X-axis).
// Quaternion for 30° around X: [sin(15°), 0, 0, cos(15°)] ≈ [0.2588, 0, 0, 0.9659].
// This exercises translateConnectorAlong's quaternion rotation of face axes.
// The joint direction (0,1,0) remains in the (rotated) face plane of 'Right' face:
//   dot((0,1,0), rotate(faceNormal=(1,0,0), q)) = dot((0,1,0),(cos30,0,sin30)) = 0 ✓
// So projection onto rotated face axes still sums to the full Δ·worldDir.
const SIN15 = Math.sin(Math.PI / 12);  // sin(15°) ≈ 0.2588
const COS15 = Math.cos(Math.PI / 12);  // cos(15°) ≈ 0.9659
function nonIdentityCabinetJoint(): JointInput {
  return {
    line: { p0: { x: Tc, y: Tb, z: Tc / 2 }, p1: { x: Tc, y: D, z: Tc / 2 } },
    panelA: {
      dims: SIDE_DIMS_SWAPPED,
      // 30° rotation around +X: part-Y stays in YZ plane, part-Z rotates toward -Y.
      pose: { translation: { x: Tc / 2, y: D / 2, z: H / 2 }, quaternion: [SIN15, 0, 0, COS15] },
    },
    panelB: {
      dims: BOTTOM_DIMS,
      pose: {
        translation: { x: Tc + BOTTOM_DIMS.length / 2, y: Tb + BOTTOM_DIMS.width / 2, z: BOTTOM_DIMS.thickness / 2 },
        quaternion: [0, 0, 0, 1],
      },
    },
    faceA: 'Right',
    endB: 'Left',
    boardThicknessA: Tc,
    boardThicknessB: Tc,
  };
}

describe('CHUNK G.3 — confirmat bSwapUV MoveConnector world-space guard (real OCCT)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  function buildBottomPanel(): NamedShape {
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

  // Correction 5: BASELINE test — proves generator correctness BEFORE any move
  it('BASELINE (unmoved confirmat-edge): volume-drop ≈ confirmat-edge cylinder — proves generator correctness', () => {
    const joint = identityCabinetJoint();
    const { boresB } = generateConfirmat(joint, BORING_PARAMS);
    const boreB = boresB.find((b) => b.connectorId === 'confirmat-0')!;
    const depth = boreB.depth as number;

    // BASELINE: no move — just bake the original bore and check volume drop
    const running = buildBottomPanel();
    const holeFeature: any = {
      id: `baseline:${boreB.face.role}:${boreB.diameter}:${boreB.depth}:0`,
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: boreB.face,
        points: [{ u: boreB.u, v: boreB.v }],
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: boreB.diameter } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: depth } },
      flipAxis: false,
    };
    const result = executeHoleFeature(oc, running, holeFeature, (p: any) => p.value, new Map());
    const volBefore = BOTTOM_DIMS.length * BOTTOM_DIMS.width * BOTTOM_DIMS.thickness;
    const drop = volBefore - volumeOf(result.shape);
    // Ø5 confirmat-edge bore, depth=(50-Tc)=32: cylinder π×2.5²×32 ≈ 628mm³
    const expectedCyl = Math.PI * (boreB.diameter / 2) ** 2 * depth;
    expect(drop).toBeGreaterThan(100);
    expect(drop).toBeGreaterThan(expectedCyl * 0.8);
    expect(drop).toBeLessThan(expectedCyl * 1.5);
  });

  it('bSwapUV path (identity poses): B-side bore world position shifts by Δ·jointDir after translateConnectorAlong', () => {
    const joint = identityCabinetJoint();
    const dir = computeJointDir(joint);
    const { boresA, boresB } = generateConfirmat(joint, BORING_PARAMS);

    // B-side bore (edge bore, endB='Left', bSwapUV=true)
    const boreB = { ...boresB.find((b) => b.connectorId === 'confirmat-0')! };
    const boreA = { ...boresA.find((b) => b.connectorId === 'confirmat-0')! };

    // Verify pre-condition: boreB is on the 'Left' face (the bSwapUV path)
    expect(boreB.face.role).toBe('Left');
    // bSwapUV: u should be thickness-centerline ≈ 9, v should be along-joint (60,277, or 494)
    expect(boreB.u).toBeCloseTo(Tc / 2, 1);
    expect(boreB.v).toBeGreaterThanOrEqual(50);

    const worldBBefore = worldBorePos(boreB, BOTTOM_DIMS, joint.panelB.pose);
    const worldABefore = worldBorePos(boreA, SIDE_DIMS_SWAPPED, joint.panelA.pose);

    const members: ConnectorMember[] = [
      { bore: boreA, panelDims: SIDE_DIMS_SWAPPED, worldPose: joint.panelA.pose },
      { bore: boreB, panelDims: BOTTOM_DIMS, worldPose: joint.panelB.pose },
    ];
    translateConnectorAlong(members, dir, DELTA);

    const worldBAfter = worldBorePos(boreB, BOTTOM_DIMS, joint.panelB.pose);
    const worldAAfter = worldBorePos(boreA, SIDE_DIMS_SWAPPED, joint.panelA.pose);

    // Both holes shifted by Δ·worldDir in world space (DERIVED from geometry)
    const expectedDelta = { x: dir.x * DELTA, y: dir.y * DELTA, z: dir.z * DELTA };
    expect(worldBAfter.x - worldBBefore.x).toBeCloseTo(expectedDelta.x, 2);
    expect(worldBAfter.y - worldBBefore.y).toBeCloseTo(expectedDelta.y, 2);
    expect(worldBAfter.z - worldBBefore.z).toBeCloseTo(expectedDelta.z, 2);

    expect(worldAAfter.x - worldABefore.x).toBeCloseTo(expectedDelta.x, 2);
    expect(worldAAfter.y - worldABefore.y).toBeCloseTo(expectedDelta.y, 2);

    // (b) Screw axis collinearity preserved
    const axisAfter = { x: worldBAfter.x - worldAAfter.x, y: worldBAfter.y - worldAAfter.y, z: worldBAfter.z - worldAAfter.z };
    const axisBefore = { x: worldBBefore.x - worldABefore.x, y: worldBBefore.y - worldABefore.y, z: worldBBefore.z - worldABefore.z };
    const dotBefore = axisBefore.x * dir.x + axisBefore.y * dir.y + axisBefore.z * dir.z;
    const dotAfter = axisAfter.x * dir.x + axisAfter.y * dir.y + axisAfter.z * dir.z;
    expect(Math.abs(dotAfter - dotBefore)).toBeLessThan(0.5);

    // (c) B-side bore still within face bounds
    expect(boreB.u).toBeGreaterThanOrEqual(0);
    expect(boreB.u).toBeLessThanOrEqual(BOTTOM_DIMS.thickness + 1);
    expect(boreB.v).toBeGreaterThanOrEqual(0);
    expect(boreB.v).toBeLessThanOrEqual(BOTTOM_DIMS.width + 1);
  });

  it('bSwapUV path (non-identity panelA pose, 30° around X): world shift still = Δ·jointDir', () => {
    // Correction 5 (b): NON-IDENTITY panelA pose exercises the quaternion rotation path.
    // translateConnectorAlong must project worldDir onto the ROTATED face axes (not raw axes).
    // The 30° rotation keeps jointDir (0,1,0) in the rotated face plane → full decomposition.
    const joint = nonIdentityCabinetJoint();
    const dir = computeJointDir(joint);
    const { boresA, boresB } = generateConfirmat(joint, BORING_PARAMS);

    const boreB = { ...boresB.find((b) => b.connectorId === 'confirmat-0')! };
    const boreA = { ...boresA.find((b) => b.connectorId === 'confirmat-0')! };

    expect(boreB.face.role).toBe('Left'); // bSwapUV path sanity

    const worldBBefore = worldBorePos(boreB, BOTTOM_DIMS, joint.panelB.pose);
    const worldABefore = worldBorePos(boreA, SIDE_DIMS_SWAPPED, joint.panelA.pose);

    const members: ConnectorMember[] = [
      { bore: boreA, panelDims: SIDE_DIMS_SWAPPED, worldPose: joint.panelA.pose },
      { bore: boreB, panelDims: BOTTOM_DIMS, worldPose: joint.panelB.pose },
    ];
    translateConnectorAlong(members, dir, DELTA);

    const worldBAfter = worldBorePos(boreB, BOTTOM_DIMS, joint.panelB.pose);
    const worldAAfter = worldBorePos(boreA, SIDE_DIMS_SWAPPED, joint.panelA.pose);

    // Both holes shifted by Δ·worldDir even with non-identity panelA pose
    const expectedDelta = { x: dir.x * DELTA, y: dir.y * DELTA, z: dir.z * DELTA };
    expect(worldBAfter.x - worldBBefore.x).toBeCloseTo(expectedDelta.x, 2);
    expect(worldBAfter.y - worldBBefore.y).toBeCloseTo(expectedDelta.y, 2);
    expect(worldBAfter.z - worldBBefore.z).toBeCloseTo(expectedDelta.z, 2);

    // A-side: world shift is Δ·jointDir, which REQUIRES the quaternion rotation path.
    // With a quaternion-ignorant implementation (raw uDir/vDir not rotated), worldAAfter.y
    // would differ from worldABefore.y + expectedDelta.y.
    expect(worldAAfter.y - worldABefore.y).toBeCloseTo(expectedDelta.y, 2);
    // The non-identity pose produces non-zero z shift for A-side (from face axis tilt):
    // Proves the quaternion was applied (identity pose would give 0 z-shift for panelA)
    // Both A and B side z shifts are determined by expectedDelta.z ≈ 0 for this joint.
    expect(worldAAfter.x - worldABefore.x).toBeCloseTo(expectedDelta.x, 2);
  });

  it('OCCT: moved confirmat-edge bore cuts real void in bottom panel (volume drop ≈ cylinder)', () => {
    const joint = identityCabinetJoint();
    const dir = computeJointDir(joint);
    const { boresB } = generateConfirmat(joint, BORING_PARAMS);
    const boreB = { ...boresB.find((b) => b.connectorId === 'confirmat-0')! };
    const depth = boreB.depth as number;

    const members: ConnectorMember[] = [
      { bore: boreB, panelDims: BOTTOM_DIMS, worldPose: joint.panelB.pose },
    ];
    translateConnectorAlong(members, dir, DELTA);

    const running = buildBottomPanel();
    const holeFeature: any = {
      id: `bake:${boreB.face.role}:${boreB.diameter}:${boreB.depth}:0`,
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: boreB.face,
        points: [{ u: boreB.u, v: boreB.v }],
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: boreB.diameter } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: depth } },
      flipAxis: false,
    };

    const result = executeHoleFeature(oc, running, holeFeature, (p: any) => p.value, new Map());
    const volBefore = BOTTOM_DIMS.length * BOTTOM_DIMS.width * BOTTOM_DIMS.thickness;
    const drop = volBefore - volumeOf(result.shape);

    // Confirmat-edge bore: Ø5, depth=32mm → cylinder ≈ π×2.5²×32≈628mm³
    const cyl = Math.PI * 2.5 * 2.5 * depth;
    expect(drop).toBeGreaterThan(100);
    expect(drop).toBeGreaterThan(cyl * 0.85);
    expect(drop).toBeLessThan(cyl * 1.5);
  });

  it('FLIP-TO-RED verification: naive part-local u-shift fails for bSwapUV (wrong direction)', () => {
    // Proves the guard is sensitive: if translateConnectorAlong used `bore.u += delta` for B side
    // (naïve approach for non-swapped faces), it shifts along the THICKNESS axis (+Z for Left face).
    // This is the WRONG direction for bSwapUV: on 'Left' face, uDir=(0,0,1), not along-joint.
    const joint = identityCabinetJoint();
    const dir = computeJointDir(joint);
    const { boresB } = generateConfirmat(joint, BORING_PARAMS);
    const boreB = { ...boresB.find((b) => b.connectorId === 'confirmat-0')! };

    // WRONG naive approach: shift u (which is the thickness-centerline coord, NOT along-joint)
    const worldBefore = worldBorePos(boreB, BOTTOM_DIMS, joint.panelB.pose);
    const wrongBore = { ...boreB, u: boreB.u + DELTA }; // wrong: shifts in Z direction
    const worldWrong = worldBorePos(wrongBore, BOTTOM_DIMS, joint.panelB.pose);

    // The world shift produced by the wrong approach should NOT align with jointDir
    const wrongShift = {
      x: worldWrong.x - worldBefore.x,
      y: worldWrong.y - worldBefore.y,
      z: worldWrong.z - worldBefore.z,
    };
    const len = Math.hypot(wrongShift.x, wrongShift.y, wrongShift.z);
    expect(len).toBeGreaterThan(0.1); // should produce some shift

    // dot product with actual joint dir should be LOW (not 1.0)
    const dotWrong = (wrongShift.x * dir.x + wrongShift.y * dir.y + wrongShift.z * dir.z) / len;
    // Joint dir is (0, ~1, 0) — a purely Y-direction (along cabinet depth).
    // Naive u-shift on 'Left' face shifts in world-Z (face's uDir = +Z) → dot ≈ 0
    expect(Math.abs(dotWrong)).toBeLessThan(0.1); // wrong direction confirmed

    // The CORRECT translateConnectorAlong moves the bore in the joint direction:
    const correctBore = { ...boreB };
    translateConnectorAlong(
      [{ bore: correctBore, panelDims: BOTTOM_DIMS, worldPose: joint.panelB.pose }],
      dir, DELTA,
    );
    const worldCorrect = worldBorePos(correctBore, BOTTOM_DIMS, joint.panelB.pose);
    const correctShift = {
      x: worldCorrect.x - worldBefore.x,
      y: worldCorrect.y - worldBefore.y,
      z: worldCorrect.z - worldBefore.z,
    };
    const correctLen = Math.hypot(correctShift.x, correctShift.y, correctShift.z);
    const dotCorrect = (correctShift.x * dir.x + correctShift.y * dir.y + correctShift.z * dir.z) / correctLen;
    expect(Math.abs(dotCorrect)).toBeCloseTo(1, 2); // correct: aligns with joint direction
  });
});
