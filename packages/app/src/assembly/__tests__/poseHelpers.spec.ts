// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { computeRectGridPoses } from '../poseHelpers';
import type { PatternAxis } from '@zilventor/shared';

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
