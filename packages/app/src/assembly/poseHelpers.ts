import type { PatternAxis, MirrorPlane, Vec3 } from '@zilventor/shared';

export type Pose = { translation: Vec3; quaternion: [number, number, number, number] };

function axisVec(axis: PatternAxis): Vec3 {
  return axis === 'x' ? { x: 1, y: 0, z: 0 }
       : axis === 'y' ? { x: 0, y: 1, z: 0 }
       :                { x: 0, y: 0, z: 1 };
}

/**
 * Returns count1*count2 - 1 poses (origin cell excluded).
 * Each pose = sourcePose.translation + i*spacing1*axis(dir1) + j*spacing2*axis(dir2).
 * Quaternion is copied unchanged from sourcePose.
 */
export function computeRectGridPoses(
  sourcePose: Pose,
  dir1: PatternAxis,
  count1: number,
  spacing1: number,
  dir2?: PatternAxis,
  count2?: number,
  spacing2?: number,
): Pose[] {
  const a1 = axisVec(dir1);
  const a2 = dir2 ? axisVec(dir2) : { x: 0, y: 0, z: 0 };
  const c2 = dir2 && count2 ? count2 : 1;
  const s2 = dir2 && spacing2 ? spacing2 : 0;
  const poses: Pose[] = [];
  for (let j = 0; j < c2; j++) {
    for (let i = 0; i < count1; i++) {
      if (i === 0 && j === 0) continue; // exclude origin
      poses.push({
        translation: {
          x: sourcePose.translation.x + i * spacing1 * a1.x + j * s2 * a2.x,
          y: sourcePose.translation.y + i * spacing1 * a1.y + j * s2 * a2.y,
          z: sourcePose.translation.z + i * spacing1 * a1.z + j * s2 * a2.z,
        },
        quaternion: [...sourcePose.quaternion] as [number, number, number, number],
      });
    }
  }
  return poses;
}
