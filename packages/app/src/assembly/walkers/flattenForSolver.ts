import type { AssemblyConstraint, AssemblyDocument, ComponentInstance, ComponentPath, Vec3 } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';

export type Pose = { translation: Vec3; quaternion: [number, number, number, number] };

export type SolverInput = {
  unknowns: Pose[];
  pathToUnknown: Map<string, number>;
  constraints: AssemblyConstraint[];
  /** For rigid sub-asms: which top-of-subtree path maps to which unknown. */
  rigidSubtreeRoots: Map<string, ComponentPath>;
};

function initialPose(c: ComponentInstance): Pose {
  if (c.pose) return c.pose;
  return {
    translation: { x: c.position.x, y: c.position.y, z: c.position.z },
    quaternion: [0, 0, 0, 1],
  };
}

export function flattenForSolver(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
): SolverInput {
  const unknowns: Pose[] = [];
  const pathToUnknown = new Map<string, number>();
  const constraints: AssemblyConstraint[] = [];
  const rigidSubtreeRoots = new Map<string, ComponentPath>();

  function walk(doc: AssemblyDocument, prefix: string[], inFlexible: boolean) {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      const isSubAsm = c.partPath.endsWith('.ziasm');
      if (!isSubAsm) {
        if (inFlexible || prefix.length === 0) {
          unknowns.push(initialPose(c));
          pathToUnknown.set(pathKey(path), unknowns.length - 1);
        }
        continue;
      }
      const e = cache.get(c.partPath);
      if (!e || e.kind !== 'ok') continue;
      // T14 + T15 fill in the rigid + flexible cases. For now: skip.
    }
  }
  // Top-level constraints, refs unchanged
  for (const c of activeDoc.constraints) constraints.push(c);
  walk(activeDoc, [], false);
  return { unknowns, pathToUnknown, constraints, rigidSubtreeRoots };
}
