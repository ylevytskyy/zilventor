// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { computeRectGridPoses, computeMirroredPose, quatToMat3, axisAngleToQuat, quatMul, computeCircularPoses } from '../poseHelpers';
import type { PatternAxis } from '@zilventor/shared';
import type { Pose } from '../poseHelpers';

const identityPose = {
  translation: { x: 0, y: 0, z: 0 },
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
};

describe('computeRectGridPoses', () => {
  it('1D along X: count=3, spacing=10 → 2 poses at x=10 and x=20', () => {
    const poses = computeRectGridPoses(identityPose, 'x', 3, 10);
    expect(poses).toHaveLength(2);
    expect(poses[0]!.translation).toEqual({ x: 10, y: 0, z: 0 });
    expect(poses[1]!.translation).toEqual({ x: 20, y: 0, z: 0 });
  });

  it('1D along Y: count=2, spacing=15 → 1 pose at y=15', () => {
    const poses = computeRectGridPoses(identityPose, 'y', 2, 15);
    expect(poses).toHaveLength(1);
    expect(poses[0]!.translation).toEqual({ x: 0, y: 15, z: 0 });
  });

  it('1D along Z: count=4, spacing=5 → 3 poses', () => {
    const poses = computeRectGridPoses(identityPose, 'z', 4, 5);
    expect(poses).toHaveLength(3);
    expect(poses[2]!.translation).toEqual({ x: 0, y: 0, z: 15 });
  });

  it('2D grid: count1=3,spacing1=10 along X; count2=2,spacing2=8 along Y → 5 poses', () => {
    const poses = computeRectGridPoses(identityPose, 'x', 3, 10, 'y', 2, 8);
    // 3*2 - 1 = 5 (excludes origin cell i=0,j=0)
    expect(poses).toHaveLength(5);
  });

  it('2D grid: origin excluded, all (i=0,j=0) NOT in results', () => {
    const poses = computeRectGridPoses(identityPose, 'x', 2, 10, 'y', 2, 5);
    // cells: (0,0),(1,0),(0,1),(1,1) → exclude (0,0) → 3 poses
    expect(poses).toHaveLength(3);
    // No pose at (0,0,0)
    expect(poses.every((p) => p.translation.x !== 0 || p.translation.y !== 0)).toBe(true);
  });

  it('preserves source quaternion unchanged', () => {
    const srcPose = {
      translation: { x: 5, y: 5, z: 5 },
      quaternion: [0.1, 0.2, 0.3, 0.927] as [number, number, number, number],
    };
    const poses = computeRectGridPoses(srcPose, 'x', 2, 10);
    expect(poses[0]!.quaternion).toEqual(srcPose.quaternion);
  });

  it('source translation is base: pose at count=2 spacing=10 is src+(10,0,0)', () => {
    const src = { translation: { x: 3, y: 7, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] };
    const poses = computeRectGridPoses(src, 'x', 2, 10);
    expect(poses[0]!.translation).toEqual({ x: 13, y: 7, z: 0 });
  });
});

describe('computeMirroredPose', () => {
  it('YZ plane: reflects translation X, leaves Y/Z unchanged', () => {
    const src: Pose = { translation: { x: 5, y: 3, z: 2 }, quaternion: [0, 0, 0, 1] };
    const result = computeMirroredPose(src, 'yz');
    expect(result.translation.x).toBeCloseTo(-5, 10);
    expect(result.translation.y).toBeCloseTo(3, 10);
    expect(result.translation.z).toBeCloseTo(2, 10);
  });

  it('XZ plane: reflects translation Y', () => {
    const src: Pose = { translation: { x: 4, y: -6, z: 1 }, quaternion: [0, 0, 0, 1] };
    const result = computeMirroredPose(src, 'xz');
    expect(result.translation.x).toBeCloseTo(4, 10);
    expect(result.translation.y).toBeCloseTo(6, 10);
    expect(result.translation.z).toBeCloseTo(1, 10);
  });

  it('XY plane: reflects translation Z', () => {
    const src: Pose = { translation: { x: 1, y: 2, z: -7 }, quaternion: [0, 0, 0, 1] };
    const result = computeMirroredPose(src, 'xy');
    expect(result.translation.x).toBeCloseTo(1, 10);
    expect(result.translation.y).toBeCloseTo(2, 10);
    expect(result.translation.z).toBeCloseTo(7, 10);
  });

  it("R' is orthonormal (identity source rotation, YZ plane)", () => {
    const src: Pose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };
    const result = computeMirroredPose(src, 'yz');
    const m = quatToMat3(result.quaternion);
    // rows orthonormal: each row has unit length
    for (let i = 0; i < 3; i++) {
      const row = [m[i * 3]!, m[i * 3 + 1]!, m[i * 3 + 2]!];
      const len = Math.sqrt(row.reduce((s, v) => s + v * v, 0));
      expect(len).toBeCloseTo(1, 8);
    }
  });

  it("det(R') = +1 (proper rotation) for YZ plane, non-trivial source rotation", () => {
    // 90° around Z (quaternion [0,0,sqrt(2)/2,sqrt(2)/2])
    const sqrt2_2 = Math.SQRT2 / 2;
    const src: Pose = {
      translation: { x: 3, y: 1, z: 0 },
      quaternion: [0, 0, sqrt2_2, sqrt2_2],
    };
    const result = computeMirroredPose(src, 'yz');
    const m = quatToMat3(result.quaternion);
    const det = m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!)
              - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!)
              + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    expect(det).toBeCloseTo(1, 6);
  });

  it('round-trip: world point of source maps to M * worldPoint (YZ plane)', () => {
    // Source has 90° around Z rotation and offset (10, 0, 0).
    // R*(1,0,0) = (0,1,0). World = (0,1,0)+(10,0,0) = (10,1,0).
    // Mirror YZ: M=diag(-1,1,1). M*(10,1,0) = (-10,1,0).
    // Mirrored pose: t'=(-10,0,0). S*(1,0,0)=(-1,0,0).
    // R'*(-1,0,0) + t' must equal (-10,1,0).
    const sqrt2_2 = Math.SQRT2 / 2;
    const src: Pose = {
      translation: { x: 10, y: 0, z: 0 },
      quaternion: [0, 0, sqrt2_2, sqrt2_2],
    };
    const result = computeMirroredPose(src, 'yz');
    const localPt = { x: -1, y: 0, z: 0 }; // S * (1,0,0)
    const m = quatToMat3(result.quaternion);
    const worldX = m[0]! * localPt.x + m[1]! * localPt.y + m[2]! * localPt.z + result.translation.x;
    const worldY = m[3]! * localPt.x + m[4]! * localPt.y + m[5]! * localPt.z + result.translation.y;
    const worldZ = m[6]! * localPt.x + m[7]! * localPt.y + m[8]! * localPt.z + result.translation.z;
    expect(worldX).toBeCloseTo(-10, 6);
    expect(worldY).toBeCloseTo(1, 6);
    expect(worldZ).toBeCloseTo(0, 6);
  });

  it('round-trip: XZ plane — world point maps to M_xz * worldPoint', () => {
    // Source: 90° around Z, translation (0,10,0). Local pt p=(1,0,1).
    // R*(1,0,1) = (0,1,1) [Z-rot: x→y, y→-x, z→z]. World=(0,11,1).
    // M_xz=diag(1,-1,1) negates Y → expected world=(0,-11,1).
    // Mirrored t'=M_xz*(0,10,0)=(0,-10,0). S*(1,0,1)=(-1,0,1).
    // R'*(-1,0,1) + t' must equal (0,-11,1).
    const sqrt2_2 = Math.SQRT2 / 2;
    const srcQuat: [number, number, number, number] = [0, 0, sqrt2_2, sqrt2_2];
    const src: Pose = { translation: { x: 0, y: 10, z: 0 }, quaternion: srcQuat };
    const result = computeMirroredPose(src, 'xz');
    // Derive expected from M_xz * (R*p + t)
    const R = quatToMat3(srcQuat);
    const p = { x: 1, y: 0, z: 1 };
    const wp_x = R[0]! * p.x + R[1]! * p.y + R[2]! * p.z + src.translation.x;
    const wp_y = R[3]! * p.x + R[4]! * p.y + R[5]! * p.z + src.translation.y;
    const wp_z = R[6]! * p.x + R[7]! * p.y + R[8]! * p.z + src.translation.z;
    // M_xz negates Y
    const expectedX = wp_x;
    const expectedY = -wp_y;
    const expectedZ = wp_z;
    // Mirrored local pt = S*(1,0,1) = (-1,0,1)
    const localPt = { x: -1, y: 0, z: 1 };
    const mR = quatToMat3(result.quaternion);
    const mwX = mR[0]! * localPt.x + mR[1]! * localPt.y + mR[2]! * localPt.z + result.translation.x;
    const mwY = mR[3]! * localPt.x + mR[4]! * localPt.y + mR[5]! * localPt.z + result.translation.y;
    const mwZ = mR[6]! * localPt.x + mR[7]! * localPt.y + mR[8]! * localPt.z + result.translation.z;
    expect(mwX).toBeCloseTo(expectedX, 6);
    expect(mwY).toBeCloseTo(expectedY, 6);
    expect(mwZ).toBeCloseTo(expectedZ, 6);
  });

  it('round-trip: XY plane — world point maps to M_xy * worldPoint', () => {
    // Source: 30° around X. local pt (0,1,0).
    // R*(0,1,0) + t = world point. M_xy = diag(1,1,-1) negates Z.
    // Mirrored pose: t'=M_xy*t. S*(0,1,0)=(0,1,0) [S only negates X].
    // R'*(0,1,0) + t' must equal M_xy*(R*(0,1,0)+t).
    const halfAngle = Math.PI / 12; // 15°
    const srcQuat: [number, number, number, number] = [Math.sin(halfAngle), 0, 0, Math.cos(halfAngle)];
    const src: Pose = { translation: { x: 0, y: 5, z: 3 }, quaternion: srcQuat };
    const result = computeMirroredPose(src, 'xy');
    // Compute expected via derivation
    const R = quatToMat3(srcQuat);
    // local pt p=(0,1,0); world = R*p + t
    const wp_x = R[1]! + src.translation.x;  // R*[0,1,0] = col1
    const wp_y = R[4]! + src.translation.y;
    const wp_z = R[7]! + src.translation.z;
    // M_xy: negate Z
    const expectedX = wp_x;
    const expectedY = wp_y;
    const expectedZ = -wp_z;
    // Mirrored local pt = S*(0,1,0) = (0,1,0) [S negates X only]
    const mR = quatToMat3(result.quaternion);
    const mwX = mR[1]! + result.translation.x;
    const mwY = mR[4]! + result.translation.y;
    const mwZ = mR[7]! + result.translation.z;
    expect(mwX).toBeCloseTo(expectedX, 6);
    expect(mwY).toBeCloseTo(expectedY, 6);
    expect(mwZ).toBeCloseTo(expectedZ, 6);
  });
});

describe('axisAngleToQuat', () => {
  it('+90° about +z → [0,0,√2/2,√2/2] (hand-authored)', () => {
    const q = axisAngleToQuat({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    const s = Math.SQRT2 / 2;
    expect(q[0]).toBeCloseTo(0, 9);
    expect(q[1]).toBeCloseTo(0, 9);
    expect(q[2]).toBeCloseTo(s, 9);
    expect(q[3]).toBeCloseTo(s, 9);
  });
  it('rotated vector: +90° about +z maps [1,0,0] → [0,1,0]', () => {
    const m = quatToMat3(axisAngleToQuat({ x: 0, y: 0, z: 1 }, Math.PI / 2));
    expect(m[0]).toBeCloseTo(0, 9);
    expect(m[3]).toBeCloseTo(1, 9);
    expect(m[6]).toBeCloseTo(0, 9);
  });
});
describe('quatMul', () => {
  it('Hamilton product i·j = k: [1,0,0,0]·[0,1,0,0] → [0,0,1,0]', () => {
    const r = quatMul([1, 0, 0, 0], [0, 1, 0, 0]);
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[1]).toBeCloseTo(0, 12);
    expect(r[2]).toBeCloseTo(1, 12);
    expect(r[3]).toBeCloseTo(0, 12);
  });
  it('right identity: q·[0,0,0,1] === q', () => {
    const q: [number, number, number, number] = [0.1, 0.2, 0.3, 0.9];
    const r = quatMul(q, [0, 0, 0, 1]);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(0.2, 12);
    expect(r[2]).toBeCloseTo(0.3, 12);
    expect(r[3]).toBeCloseTo(0.9, 12);
  });
});

describe('computeCircularPoses — translation', () => {
  const srcAt = (x: number, y: number, z: number): Pose => ({
    translation: { x, y, z },
    quaternion: [0, 0, 0, 1],
  });
  it('full circle count=4 about +z at origin → 3 instances on radius-2 circle at 90/180/270°', () => {
    const poses = computeCircularPoses(srcAt(2, 0, 0), 'z', { x: 0, y: 0, z: 0 }, 4, 360, false);
    expect(poses).toHaveLength(3);
    for (const p of poses) expect(Math.hypot(p.translation.x, p.translation.y)).toBeCloseTo(2, 6);
    expect(Math.atan2(poses[0]!.translation.y, poses[0]!.translation.x)).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.atan2(poses[1]!.translation.y, poses[1]!.translation.x)).toBeCloseTo(Math.PI, 6);
    expect(Math.atan2(poses[2]!.translation.y, poses[2]!.translation.x)).toBeCloseTo(-Math.PI / 2, 6);
  });
  it('partial arc count=5 angle=180 → endpoints included: 45/90/135/180°', () => {
    const poses = computeCircularPoses(srcAt(2, 0, 0), 'z', { x: 0, y: 0, z: 0 }, 5, 180, false);
    expect(poses).toHaveLength(4);
    const ang = (i: number) => Math.atan2(poses[i]!.translation.y, poses[i]!.translation.x);
    expect(ang(0)).toBeCloseTo(Math.PI / 4, 6);
    expect(ang(1)).toBeCloseTo(Math.PI / 2, 6);
    expect(ang(2)).toBeCloseTo((3 * Math.PI) / 4, 6);
    expect(ang(3)).toBeCloseTo(Math.PI, 6);
  });
  it('off-center: orbits the center point, not the origin', () => {
    const poses = computeCircularPoses(srcAt(3, 0, 0), 'z', { x: 1, y: 0, z: 0 }, 4, 360, false);
    for (const p of poses) expect(Math.hypot(p.translation.x - 1, p.translation.y)).toBeCloseTo(2, 6);
    expect(poses[0]!.translation.x).toBeCloseTo(1, 6);
    expect(poses[0]!.translation.y).toBeCloseTo(2, 6);
  });
  it('axial height preserved: source z=5, axis z → all instances keep z≈5', () => {
    const poses = computeCircularPoses(srcAt(2, 0, 5), 'z', { x: 0, y: 0, z: 0 }, 4, 360, false);
    for (const p of poses) expect(p.translation.z).toBeCloseTo(5, 6);
  });
});

describe('computeCircularPoses — orientation', () => {
  const srcQuat = ((): [number, number, number, number] => {
    const s = Math.SQRT2 / 2;
    return [s, 0, 0, s];
  })();
  const src: Pose = { translation: { x: 2, y: 0, z: 0 }, quaternion: srcQuat };
  it('rotateInstances=true: composed orientation = R(z,θ)·R_source (world pre-multiply)', () => {
    const poses = computeCircularPoses(src, 'z', { x: 0, y: 0, z: 0 }, 4, 360, true);
    const p = { x: 1, y: 1, z: 0 };
    const Rsrc = quatToMat3(srcQuat);
    const apply = (m: number[], v: { x: number; y: number; z: number }) => ({
      x: m[0]! * v.x + m[1]! * v.y + m[2]! * v.z,
      y: m[3]! * v.x + m[4]! * v.y + m[5]! * v.z,
      z: m[6]! * v.x + m[7]! * v.y + m[8]! * v.z,
    });
    poses.forEach((pose, idx) => {
      const theta = (idx + 1) * (Math.PI / 2);
      const Rz = quatToMat3(axisAngleToQuat({ x: 0, y: 0, z: 1 }, theta));
      const expected = apply(Rz, apply(Rsrc, p));
      const actual = apply(quatToMat3(pose.quaternion), p);
      expect(actual.x).toBeCloseTo(expected.x, 6);
      expect(actual.y).toBeCloseTo(expected.y, 6);
      expect(actual.z).toBeCloseTo(expected.z, 6);
    });
  });
  it('rotateInstances=false: every instance quaternion === sourceQuat AND positions still moved', () => {
    const poses = computeCircularPoses(src, 'z', { x: 0, y: 0, z: 0 }, 4, 360, false);
    for (const pose of poses) expect(pose.quaternion).toEqual(srcQuat);
    expect(poses[0]!.translation.x).not.toBeCloseTo(2, 3);
  });
});
