import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey, parsePathKey } from '@zilventor/shared';
import { quatMultiply, quatRotateVec } from '@zilventor/kernel/src/assembly/quat';
import type { Pose } from './flattenForSolver';

export type ComposedPosesInput = {
  pathToUnknown: Map<string, number>;
  poses: Pose[];
  rigidSubtreeRoots: Map<string, ReadonlyArray<string>>;
};

export function composePoses(parent: Pose, child: Pose): Pose {
  // q_parent * q_child for orientation, t_parent + R(q_parent)*t_child for position
  const q = quatMultiply(parent.quaternion, child.quaternion);
  const r = quatRotateVec(parent.quaternion, child.translation);
  return {
    translation: {
      x: parent.translation.x + r.x,
      y: parent.translation.y + r.y,
      z: parent.translation.z + r.z,
    },
    quaternion: q,
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
