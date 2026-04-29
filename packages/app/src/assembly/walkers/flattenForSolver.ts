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

function prefixRef<T extends { componentPath: ComponentPath }>(ref: T, prefix: ComponentPath): T {
  return { ...ref, componentPath: [...prefix, ...ref.componentPath] };
}

function prefixConstraint(c: AssemblyConstraint, prefix: ComponentPath): AssemblyConstraint {
  switch (c.kind) {
    case 'mate':
    case 'flush':
      return { ...c, refA: prefixRef(c.refA, prefix), refB: prefixRef(c.refB, prefix) };
    case 'angle':
      return { ...c, refA: prefixRef(c.refA, prefix), refB: prefixRef(c.refB, prefix) };
    case 'insert':
      return {
        ...c,
        refA: { ...c.refA, componentPath: [...prefix, ...c.refA.componentPath] },
        refB: { ...c.refB, componentPath: [...prefix, ...c.refB.componentPath] },
      };
  }
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
      const subDoc = e.doc;
      if (!c.flexible) {
        unknowns.push(initialPose(c));
        pathToUnknown.set(pathKey(path), unknowns.length - 1);
        rigidSubtreeRoots.set(pathKey(path), path);
        // Do NOT recurse into rigid subtrees — leaves are computed in composedPoses.
        continue;
      }
      // flexible: placement is an unknown anchor, recurse with inFlexible=true,
      // inline sub-asm constraints with path-prefixed refs.
      unknowns.push(initialPose(c));
      pathToUnknown.set(pathKey(path), unknowns.length - 1);
      walk(subDoc, path, true);
      for (const innerC of subDoc.constraints) {
        constraints.push(prefixConstraint(innerC, path));
      }
    }
  }
  // Top-level constraints, refs unchanged
  for (const c of activeDoc.constraints) constraints.push(c);
  walk(activeDoc, [], false);
  return { unknowns, pathToUnknown, constraints, rigidSubtreeRoots };
}
