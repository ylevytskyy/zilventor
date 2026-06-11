import { describe, it, expect } from 'vitest';
import { translateConnectorAlong, type ConnectorMember } from '../connectorCoupling';
import { face2DFrame } from '../bore';
import { generateConfirmat, DEFAULT_BORING_PARAMS, type JointInput } from '../connectorCatalog';
import type { BoreOp } from '../bore';

// ── Shared rotation helper (mirrors jointMath.rotate — kept in test to stay independent) ──
function rotate(
  v: { x: number; y: number; z: number },
  q: [number, number, number, number],
): { x: number; y: number; z: number } {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  return {
    x: v.x + qw * tx + (qy * tz - qz * ty),
    y: v.y + qw * ty + (qz * tx - qx * tz),
    z: v.z + qw * tz + (qx * ty - qy * tx),
  };
}

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

const PANEL_A_DIMS = { length: 18, width: 560, thickness: 720 };
const PANEL_B_DIMS = { length: 564, width: 554, thickness: 18 };
const IDENTITY_POSE = {
  translation: { x: 0, y: 0, z: 0 },
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
};
const WORLD_DIR_Y: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 };

function makeBoreA(u: number, v: number): BoreOp {
  return {
    id: 'confirmat-0-A-0', face: { featureId: 'panel', role: 'Left', instance: 0 },
    u, v, diameter: 7, depth: 'throughAll', role: 'confirmat-face',
    connectorId: 'confirmat-0', connectorKind: 'confirmat',
  };
}
function makeBoreB(u: number, v: number): BoreOp {
  return {
    id: 'confirmat-0-B-0', face: { featureId: 'panel', role: 'Left', instance: 0 },
    u, v, diameter: 5, depth: 32, role: 'confirmat-edge',
    connectorId: 'confirmat-0', connectorKind: 'confirmat',
  };
}

describe('translateConnectorAlong — projection math', () => {
  it('Left face, worldDir=+Y, delta=10: u unchanged, v+=10 (spec §7 bSwapUV worked example)', () => {
    const bA = makeBoreA(9, 60);
    const bB = makeBoreB(9, 60);

    const members: ConnectorMember[] = [
      { bore: bA, panelDims: PANEL_A_DIMS, worldPose: IDENTITY_POSE },
      { bore: bB, panelDims: PANEL_B_DIMS, worldPose: IDENTITY_POSE },
    ];

    translateConnectorAlong(members, WORLD_DIR_Y, 10);

    // Left face frame: uDir={0,0,1}, vDir={0,1,0}
    // du = 10 * dot({0,1,0}, {0,0,1}) = 0  => u unchanged
    // dv = 10 * dot({0,1,0}, {0,1,0}) = 10 => v += 10
    expect(bA.u).toBeCloseTo(9, 9);
    expect(bA.v).toBeCloseTo(70, 9);
    expect(bB.u).toBeCloseTo(9, 9);
    expect(bB.v).toBeCloseTo(70, 9);
  });

  it('Top face, worldDir=+X, delta=20: u+=20, v unchanged', () => {
    // face2DFrame(dims, 'Top'): uDir={1,0,0}, vDir={0,1,0}
    // du = 20 * dot({1,0,0},{1,0,0}) = 20; dv = 20 * dot({1,0,0},{0,1,0}) = 0
    const bTop: BoreOp = {
      id: 'shelfPin-0', face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 100, v: 32, diameter: 5, depth: 13, role: 'shelfPin-system32',
      connectorId: 'pin-col-front', connectorKind: 'shelfPin',
    };
    const WORLD_DIR_X = { x: 1, y: 0, z: 0 };
    translateConnectorAlong(
      [{ bore: bTop, panelDims: { length: 720, width: 560, thickness: 18 }, worldPose: IDENTITY_POSE }],
      WORLD_DIR_X,
      20,
    );
    expect(bTop.u).toBeCloseTo(120, 9);
    expect(bTop.v).toBeCloseTo(32, 9);
  });

  it('Bottom face, worldDir=+X, delta=15: u+=15, v unchanged', () => {
    // face2DFrame(dims, 'Bottom'): uDir={1,0,0}, vDir={0,-1,0}
    // du = 15 * dot({1,0,0},{1,0,0}) = 15; dv = 15 * dot({1,0,0},{0,-1,0}) = 0
    const bBot: BoreOp = {
      id: 'cup-0', face: { featureId: 'panel', role: 'Bottom', instance: 0 },
      u: 100, v: 21, diameter: 35, depth: 12, role: 'hingeCup',
      connectorId: 'hinge-0', connectorKind: 'hinge',
    };
    const WORLD_DIR_X = { x: 1, y: 0, z: 0 };
    translateConnectorAlong(
      [{ bore: bBot, panelDims: { length: 716, width: 596, thickness: 18 }, worldPose: IDENTITY_POSE }],
      WORLD_DIR_X,
      15,
    );
    expect(bBot.u).toBeCloseTo(115, 9);
    expect(bBot.v).toBeCloseTo(21, 9);
  });

  it('rotated panel pose: worldDir projects correctly through quaternion', () => {
    // Panel rotated 90° around Z (quat [0, 0, sin45, cos45]).
    // Part +X → world +Y, part +Y → world -X.
    // Top face uDir=part+X → world+Y; vDir=part+Y → world-X.
    // worldDir=+X: du = delta*dot(+X, world+Y) = 0; dv = delta*dot(+X, world-X) = -delta.
    const sin45 = Math.SQRT2 / 2;
    const rotZ90Pose = {
      translation: { x: 0, y: 0, z: 0 },
      quaternion: [0, 0, sin45, sin45] as [number, number, number, number],
    };
    const bRot: BoreOp = {
      id: 'shelfPin-rot', face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 100, v: 32, diameter: 5, depth: 13, role: 'shelfPin-system32',
      connectorId: 'pin-col-front', connectorKind: 'shelfPin',
    };
    translateConnectorAlong(
      [{ bore: bRot, panelDims: { length: 720, width: 560, thickness: 18 }, worldPose: rotZ90Pose }],
      { x: 1, y: 0, z: 0 },
      10,
    );
    // du = 10 * dot({1,0,0}, rotate([0,0,sin45,sin45], {1,0,0})) = 10 * dot({1,0,0},{0,1,0}) = 0
    // dv = 10 * dot({1,0,0}, rotate([0,0,sin45,sin45], {0,1,0})) = 10 * dot({1,0,0},{-1,0,0}) = -10
    expect(bRot.u).toBeCloseTo(100, 6);
    expect(bRot.v).toBeCloseTo(22, 6);
  });

  it('zero delta: bore unchanged', () => {
    const b = makeBoreA(9, 60);
    translateConnectorAlong(
      [{ bore: b, panelDims: PANEL_A_DIMS, worldPose: IDENTITY_POSE }],
      WORLD_DIR_Y,
      0,
    );
    expect(b.u).toBeCloseTo(9, 9);
    expect(b.v).toBeCloseTo(60, 9);
  });

  it('FLIP-TO-RED guard: negating worldDir negates both deltas', () => {
    const b = makeBoreA(9, 60);
    const bNeg = makeBoreA(9, 60);
    translateConnectorAlong(
      [{ bore: b, panelDims: PANEL_A_DIMS, worldPose: IDENTITY_POSE }],
      WORLD_DIR_Y,
      10,
    );
    translateConnectorAlong(
      [{ bore: bNeg, panelDims: PANEL_A_DIMS, worldPose: IDENTITY_POSE }],
      { x: -WORLD_DIR_Y.x, y: -WORLD_DIR_Y.y, z: -WORLD_DIR_Y.z },
      10,
    );
    // forward: v = 70; reverse: v = 50 (60 - 10 because -worldDir flips the projection)
    expect(b.v).toBeCloseTo(70, 9);
    expect(bNeg.v).toBeCloseTo(50, 9);
    // confirm forward ≠ reverse
    expect(b.v).not.toBeCloseTo(bNeg.v, 3);
  });
});

// ── Full round-trip: swappedSideBottomJoint confirmat — RUNTIME-DERIVED expectations (Correction 1) ──
describe('translateConnectorAlong — full round-trip with swappedSideBottomJoint (bSwapUV case) — RUNTIME-DERIVED expectations', () => {
  /** Returns the swapped-side-bottom joint used in connectorCatalog.spec.ts BLOCKER guard. */
  function swappedSideBottomJoint(): JointInput {
    return {
      line: { p0: { x: 18, y: 6, z: 9 }, p1: { x: 18, y: 560, z: 9 } },
      panelA: {
        dims: { length: 18, width: 560, thickness: 720 },
        pose: { translation: { x: 9, y: 280, z: 360 }, quaternion: [0, 0, 0, 1] },
      },
      panelB: {
        dims: { length: 564, width: 554, thickness: 18 },
        pose: { translation: { x: 300, y: 280, z: 9 }, quaternion: [0, 0, 0, 1] },
      },
      faceA: 'Right',
      endB: 'Left',
      boardThicknessA: 18,
      boardThicknessB: 18,
    };
  }

  /** Compute expected du and dv for a single member entirely from face2DFrame + pose quaternion. */
  function computeExpectedDelta(
    faceName: 'Top' | 'Bottom' | 'Left' | 'Right' | 'Front' | 'Back',
    dims: { length: number; width: number; thickness: number },
    poseQuat: [number, number, number, number],
    worldDir: { x: number; y: number; z: number },
    delta: number,
  ): { du: number; dv: number } {
    const { uDir, vDir } = face2DFrame(dims, faceName);
    const worldUDir = rotate(uDir, poseQuat);
    const worldVDir = rotate(vDir, poseQuat);
    return {
      du: delta * dot(worldDir, worldUDir),
      dv: delta * dot(worldDir, worldVDir),
    };
  }

  it('confirmat A (Right face) + B (Left face, bSwapUV): world shift equals Δ·jointDir for BOTH members — expectations derived from face2DFrame at runtime', () => {
    const j = swappedSideBottomJoint();
    const { boresA, boresB } = generateConfirmat(j, DEFAULT_BORING_PARAMS);

    // jointDir comes from the bore itself (generated by Chunk B.3) — NOT hand-authored
    const jointDir = boresA[0]!.jointDir!;
    expect(jointDir).toBeDefined();
    const mag = Math.sqrt(jointDir.x ** 2 + jointDir.y ** 2 + jointDir.z ** 2);
    expect(mag).toBeCloseTo(1, 6);

    // Snapshot before
    const preA = boresA.map(b => ({ u: b.u, v: b.v }));
    const preB = boresB.map(b => ({ u: b.u, v: b.v }));

    const DELTA = 10;
    const IDENTITY_POSE_LOCAL = {
      translation: { x: 0, y: 0, z: 0 },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    };

    const members: ConnectorMember[] = [
      ...boresA.map(b => ({ bore: b, panelDims: j.panelA.dims, worldPose: IDENTITY_POSE_LOCAL })),
      ...boresB.map(b => ({ bore: b, panelDims: j.panelB.dims, worldPose: IDENTITY_POSE_LOCAL })),
    ];

    translateConnectorAlong(members, jointDir, DELTA);

    // ── A-side: face='Right', uDir={0,0,1}, vDir={0,-1,0} (from face2DFrame, read at runtime) ──
    // jointDir ≈ {0, 1, 0}  (normalize({0, 554, 0}))
    // du_A = DELTA * dot(jointDir, rotate(IDENTITY, {0,0,1})) = DELTA * dot({0,1,0},{0,0,1}) = 0
    // dv_A = DELTA * dot(jointDir, rotate(IDENTITY, {0,-1,0})) = DELTA * dot({0,1,0},{0,-1,0}) = -DELTA
    for (let i = 0; i < boresA.length; i++) {
      const { du, dv } = computeExpectedDelta(
        boresA[i]!.face.role as 'Right',
        j.panelA.dims,
        IDENTITY_POSE_LOCAL.quaternion,
        jointDir,
        DELTA,
      );
      expect(boresA[i]!.u).toBeCloseTo(preA[i]!.u + du, 5);
      expect(boresA[i]!.v).toBeCloseTo(preA[i]!.v + dv, 5);
    }

    // ── B-side: face='Left' (bSwapUV), uDir={0,0,1}, vDir={0,1,0} (from face2DFrame) ──
    // du_B = DELTA * dot({0,1,0},{0,0,1}) = 0
    // dv_B = DELTA * dot({0,1,0},{0,1,0}) = DELTA
    for (let i = 0; i < boresB.length; i++) {
      const { du, dv } = computeExpectedDelta(
        boresB[i]!.face.role as 'Left',
        j.panelB.dims,
        IDENTITY_POSE_LOCAL.quaternion,
        jointDir,
        DELTA,
      );
      expect(boresB[i]!.u).toBeCloseTo(preB[i]!.u + du, 5);
      expect(boresB[i]!.v).toBeCloseTo(preB[i]!.v + dv, 5);
    }

    // ── Sanity: A and B vDir signs are OPPOSITE (Right.vDir={0,-1,0} vs Left.vDir={0,1,0}) ──
    // A: v -= DELTA, B: v += DELTA — proves the asymmetry the spec flags
    const aFrameVDir = face2DFrame(j.panelA.dims, 'Right').vDir;
    const bFrameVDir = face2DFrame(j.panelB.dims, 'Left').vDir;
    expect(dot(aFrameVDir, bFrameVDir)).toBeCloseTo(-1, 9); // exactly opposite
  });

  it('FLIP-TO-RED: negating one member projection produces non-coplanar shift — assert fails with not.toBeCloseTo', () => {
    const j = swappedSideBottomJoint();
    const { boresA, boresB } = generateConfirmat(j, DEFAULT_BORING_PARAMS);
    const jointDir = boresA[0]!.jointDir!;
    const DELTA = 10;
    const IDENTITY_POSE_LOCAL = {
      translation: { x: 0, y: 0, z: 0 },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    };

    // Take first bore from each side
    const aClone = { ...boresA[0]! };

    // CORRECT: both shift by same world vector
    const membersCorrect: ConnectorMember[] = [
      { bore: aClone, panelDims: j.panelA.dims, worldPose: IDENTITY_POSE_LOCAL },
      { bore: { ...boresB[0]! }, panelDims: j.panelB.dims, worldPose: IDENTITY_POSE_LOCAL },
    ];
    const preAv = aClone.v;
    translateConnectorAlong(membersCorrect, jointDir, DELTA);
    const correctADelta = aClone.v - preAv; // should be -DELTA (Right face, vDir={0,-1,0})

    // WRONG: negate one member's projection by using negated worldDir for just the A bore
    const aWrong = { ...boresA[0]! };
    const memberWrong: ConnectorMember[] = [
      { bore: aWrong, panelDims: j.panelA.dims, worldPose: IDENTITY_POSE_LOCAL },
    ];
    const preAWrong = aWrong.v;
    translateConnectorAlong(memberWrong, { x: -jointDir.x, y: -jointDir.y, z: -jointDir.z }, DELTA);
    const wrongADelta = aWrong.v - preAWrong; // should be +DELTA (negated dir)

    // Flip-to-RED: correct gives -DELTA, wrong gives +DELTA → they differ by 2*DELTA
    expect(correctADelta).toBeCloseTo(-DELTA, 5);
    expect(wrongADelta).toBeCloseTo(+DELTA, 5);
    // Confirm they are NOT equal (the assertion the real guard would fail on)
    expect(Math.abs(correctADelta - wrongADelta)).toBeGreaterThan(DELTA); // 2*DELTA apart
  });

  it('FLIP-TO-RED: zeroing jointDir (simulating missing-jointDir bug) means caller can detect absence — bore.jointDir is truthy on real bores', () => {
    const j = swappedSideBottomJoint();
    const { boresA } = generateConfirmat(j, DEFAULT_BORING_PARAMS);

    // All real carcass bores must have jointDir
    for (const b of boresA) {
      expect(b.jointDir).toBeDefined();
      // A hand-crafted bore without jointDir would fail this assertion
    }

    // A hand-crafted bore (simulating pre-slice-3 bore) has no jointDir
    const legacyBore: BoreOp = {
      id: 'legacy', face: { featureId: 'panel', role: 'Right', instance: 0 },
      u: 60, v: 9, diameter: 7, depth: 'throughAll', role: 'confirmat-face',
      connectorId: 'confirmat-0', connectorKind: 'confirmat',
    };
    // Flip-to-RED: if generator stopped setting jointDir, boresA[0]!.jointDir would be undefined
    // and the test above would fail — proving this suite IS load-bearing
    expect(legacyBore.jointDir).toBeUndefined();
  });
});
