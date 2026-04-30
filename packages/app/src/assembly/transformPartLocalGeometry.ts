import { quatRotateVec } from '@zilventor/kernel/src/assembly/quat';
import type { PartLocalGeometry } from '@zilventor/kernel/src/assembly/AssemblyConstraintRefs';
import type { Pose } from './walkers/flattenForSolver';
import type { Vec3 } from '@zilventor/shared';

function applyPose(p: Pose, v: Vec3): Vec3 {
  const r = quatRotateVec(p.quaternion, v);
  return { x: p.translation.x + r.x, y: p.translation.y + r.y, z: p.translation.z + r.z };
}

function rotateOnly(p: Pose, v: Vec3): Vec3 {
  return quatRotateVec(p.quaternion, v);
}

/**
 * Pre-compose a static rigid pose into a part-local geometry. Used when a
 * top-level constraint targets a face/edge on a leaf inside a rigid sub-asm:
 * the rigid sub-asm root is the kernel's unknown, and the leaf's geometry
 * needs to live in the rigid root's frame so `rootPose * preTransformed = world`.
 */
export function transformPartLocalGeometry(g: PartLocalGeometry, pose: Pose): PartLocalGeometry {
  switch (g.kind) {
    case 'plane':
      return { kind: 'plane', P: applyPose(pose, g.P), N: rotateOnly(pose, g.N) };
    case 'axis':
      return { kind: 'axis', P: applyPose(pose, g.P), D: rotateOnly(pose, g.D) };
    case 'point':
      return { kind: 'point', P: applyPose(pose, g.P) };
    case 'circularEdge':
      return {
        kind: 'circularEdge',
        axisP: applyPose(pose, g.axisP),
        axisD: rotateOnly(pose, g.axisD),
        planeP: applyPose(pose, g.planeP),
        planeN: rotateOnly(pose, g.planeN),
      };
  }
}
