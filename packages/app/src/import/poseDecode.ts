import type { Vec3 } from '@zilventor/shared';
import type { ImporterPose } from './inventorJsonSchema';

export type DecodedPose = {
  translation: Vec3;
  quaternion: [number, number, number, number];
};

export function decodePose(p: ImporterPose): DecodedPose {
  const [x, y, z, w] = p.quaternion;
  const len = Math.hypot(x, y, z, w);
  if (len < 1e-12) {
    throw new Error(`decodePose: zero-length quaternion ${JSON.stringify(p.quaternion)}`);
  }
  return {
    translation: { x: p.translation.x, y: p.translation.y, z: p.translation.z },
    quaternion: [x / len, y / len, z / len, w / len],
  };
}
