import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey, parsePathKey } from '@zilventor/shared';
import type { Pose } from './flattenForSolver';

export type ComposedPosesInput = {
  pathToUnknown: Map<string, number>;
  poses: Pose[];
  rigidSubtreeRoots: Map<string, ReadonlyArray<string>>;
};

export function composePoses(parent: Pose, child: Pose): Pose {
  // q_parent * q_child for orientation, t_parent + R(q_parent)*t_child for position
  const [qx, qy, qz, qw] = parent.quaternion;
  const [px, py, pz, pw] = child.quaternion;
  // Hamilton product
  const ox = qw * px + qx * pw + qy * pz - qz * py;
  const oy = qw * py - qx * pz + qy * pw + qz * px;
  const oz = qw * pz + qx * py - qy * px + qz * pw;
  const ow = qw * pw - qx * px - qy * py - qz * pz;
  // Rotate child translation by parent quaternion (v' = q * v * q^-1, expanded for unit quat)
  const t = child.translation;
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  const rx = (1 - 2 * (yy + zz)) * t.x + 2 * (xy - wz) * t.y + 2 * (xz + wy) * t.z;
  const ry = 2 * (xy + wz) * t.x + (1 - 2 * (xx + zz)) * t.y + 2 * (yz - wx) * t.z;
  const rz = 2 * (xz - wy) * t.x + 2 * (yz + wx) * t.y + (1 - 2 * (xx + yy)) * t.z;
  return {
    translation: { x: parent.translation.x + rx, y: parent.translation.y + ry, z: parent.translation.z + rz },
    quaternion: [ox, oy, oz, ow],
  };
}

type CacheEntry = { kind: 'ok'; doc: AssemblyDocument; partPath: string; innerStaticPoses?: Map<string, Pose> } | undefined;

export function composedPoses(
  activeDoc: AssemblyDocument,
  cache: { get(p: string): CacheEntry },
  input: ComposedPosesInput,
): Map<string, Pose> {
  const out = new Map<string, Pose>();
  function walk(doc: AssemblyDocument, prefix: string[]) {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      const key = pathKey(path);
      const idx = input.pathToUnknown.get(key);
      let myPose: Pose;
      if (idx !== undefined) {
        myPose = input.poses[idx]!;
      } else {
        myPose = { translation: { x: c.position.x, y: c.position.y, z: c.position.z }, quaternion: [0, 0, 0, 1] };
      }
      out.set(key, myPose);
      if (!c.partPath.endsWith('.ziasm')) continue;
      const e = cache.get(c.partPath);
      if (!e) continue;
      if (c.flexible) {
        walk(e.doc, path);
      } else {
        // Rigid: emit each leaf inside the subtree using inner static poses composed with the composite pose
        const inner = e.innerStaticPoses ?? new Map<string, Pose>();
        for (const [innerKey, innerPose] of inner) {
          const innerPath = parsePathKey(innerKey);
          const leafKey = pathKey([...path, ...innerPath]);
          out.set(leafKey, composePoses(myPose, innerPose));
        }
      }
    }
  }
  walk(activeDoc, []);
  return out;
}
