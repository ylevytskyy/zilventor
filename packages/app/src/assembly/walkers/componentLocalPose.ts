import type { ComponentInstance } from '@zilventor/shared';
import { quatFromEulerXYZ } from '@zilventor/kernel/src/assembly/quat';
import type { Pose } from './flattenForSolver';

/**
 * Derives a ComponentInstance's local pose: `c.pose` if present, else a pose
 * built from `c.position` (translation) and `c.rotation` (quaternion via
 * quatFromEulerXYZ). Single shared source of truth for the "derive local
 * pose from ComponentInstance" logic previously duplicated across six sites.
 */
export function componentLocalPose(c: ComponentInstance): Pose {
  if (c.pose) return c.pose;
  return {
    translation: { x: c.position.x, y: c.position.y, z: c.position.z },
    quaternion: quatFromEulerXYZ(c.rotation.rx, c.rotation.ry, c.rotation.rz),
  };
}
